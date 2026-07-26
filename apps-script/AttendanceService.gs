var ATTENDANCE_STAFF_ALLOWLIST = 'ATTENDANCE_STAFF_ALLOWLIST';

/**
 * Returns a privacy-safe, consistent ticket snapshot. This operation never writes.
 * @param {Object} payload
 * @return {Object}
 */
function verifyTicket(payload) {
  return runAttendanceService_(function() {
    return withScriptLock(function() {
      var match = findAttendanceTicket_(payload && payload.token);
      return attendancePublicProjection_(match);
    });
  });
}

/**
 * Records one staff-authorized attendance row for one registered session.
 * @param {Object} payload
 * @return {Object}
 */
function checkIn(payload) {
  return runAttendanceService_(function() {
    return withScriptLock(function() {
      if (!payload || typeof payload !== 'object' ||
          typeof payload.sessionId !== 'string' || !payload.sessionId.trim() ||
          typeof payload.staffIdentity !== 'string' || !payload.staffIdentity.trim()) {
        attendanceError_('INVALID_REQUEST');
      }
      var staffIdentity = String(payload.staffIdentity).trim().toLowerCase();
      if (!isAuthorizedAttendanceStaff_(staffIdentity)) attendanceError_('STAFF_NOT_AUTHORIZED');

      var match = findAttendanceTicket_(payload.token);
      if (match.status !== 'active') attendanceError_('TICKET_INACTIVE');
      if (String(match.event.status || '').toLowerCase() !== 'live') attendanceError_('CHECK_IN_CLOSED');

      var sessionId = payload.sessionId.trim();
      var session = match.sessions.filter(function(candidate) {
        return candidate.sessionId === sessionId;
      })[0];
      if (!session) attendanceError_('SESSION_NOT_REGISTERED');
      var sessionStatus = String(session.status || '').toLowerCase();
      if (sessionStatus !== 'live' && sessionStatus !== 'open') attendanceError_('CHECK_IN_CLOSED');

      var serverNow = new Date();
      if (!isWithinAttendanceWindow_(session, serverNow)) attendanceError_('CHECK_IN_CLOSED');
      var duplicate = readRows('签到记录').some(function(record) {
        return record.registrationId === match.registrationId &&
          record.sessionId === sessionId &&
          String(record.status || '').toLowerCase() === 'checked_in';
      });
      if (duplicate) attendanceError_('ALREADY_CHECKED_IN');

      var row = {
        checkInId: Utilities.getUuid(),
        registrationId: match.registrationId,
        eventId: match.event.eventId,
        sessionId: sessionId,
        checkedInAt: serverNow.toISOString(),
        checkedInBy: staffIdentity,
        status: 'checked_in'
      };
      var spreadsheet = getConfiguredSpreadsheet();
      var sheet = getRequiredSheet_(spreadsheet, '签到记录');
      var values = normalizeRow_('签到记录', row);
      sheet.getRange(sheet.getLastRow() + 1, 1, 1, values.length).setValues([values]);
      return {
        status: 'checked_in',
        sessionId: sessionId,
        checkedInAt: row.checkedInAt
      };
    });
  });
}

function runAttendanceService_(callback) {
  try {
    return { ok: true, data: callback() };
  } catch (error) {
    var code = error && error.publicCode ? error.publicCode : 'INTERNAL';
    return attendanceFailure_(code);
  }
}

function attendanceFailure_(code) {
  var messages = {
    INVALID_REQUEST: '提交信息无效，请检查后重试。',
    TOKEN_INVALID: '凭证无效或已过期。',
    STAFF_NOT_AUTHORIZED: '当前员工身份无权签到。',
    TICKET_INACTIVE: '该凭证当前不可签到。',
    SESSION_NOT_REGISTERED: '该凭证未报名此场讲座。',
    CHECK_IN_CLOSED: '当前不在此场讲座的签到时间内。',
    ALREADY_CHECKED_IN: '此场讲座已完成签到。',
    INTERNAL: '请求未能完成，请稍后重试。'
  };
  var safeCode = Object.prototype.hasOwnProperty.call(messages, code) ? code : 'INTERNAL';
  return { ok: false, code: safeCode, message: messages[safeCode] };
}

function attendanceError_(code) {
  var error = new Error(code);
  error.publicCode = code;
  throw error;
}

function findAttendanceTicket_(token) {
  if (typeof token !== 'string' || !token.trim() || token.length > 512) attendanceError_('TOKEN_INVALID');
  var normalizedToken = token.trim();
  var records = readRows('报名项目').filter(function(record) {
    if (String(record.status || '').toLowerCase() === 'pending') return false;
    return attendanceStoredToken_(record.answers) === normalizedToken;
  });
  if (!records.length) attendanceError_('TOKEN_INVALID');

  var registrationId = records[0].registrationId;
  records = records.filter(function(record) {
    return record.registrationId === registrationId && record.eventId === records[0].eventId;
  });
  var event = readRows('活动').filter(function(candidate) {
    return candidate.eventId === records[0].eventId;
  })[0];
  if (!event) attendanceError_('TOKEN_INVALID');
  var participant = readRows('参加者').filter(function(candidate) {
    return candidate.participantId === records[0].participantId;
  })[0] || {};
  var selected = {};
  records.forEach(function(record) {
    attendanceStringArray_(record.sessionIds).forEach(function(sessionId) { selected[sessionId] = true; });
  });
  var sessions = readRows('场次').filter(function(session) {
    return session.eventId === event.eventId && selected[session.sessionId];
  });
  var seats = readRows('座位').filter(function(seat) {
    return seat.holderRegistrationId === registrationId ||
      seat.holderRegistrationId === 'PENDING|' + registrationId;
  });
  var registrationCancelled = records.every(function(record) {
    return String(record.status || '').toLowerCase() === 'cancelled';
  });
  var eventStatus = String(event.status || '').toLowerCase();
  var status = registrationCancelled || eventStatus === 'cancelled'
    ? 'cancelled'
    : eventStatus === 'ended' || eventStatus === 'archived' ? 'ended' : 'active';
  return {
    registrationId: registrationId,
    event: event,
    participant: participant,
    sessions: sessions,
    seats: seats,
    status: status
  };
}

function attendanceStoredToken_(serialized) {
  try {
    var parsed = typeof serialized === 'string' ? JSON.parse(serialized) : serialized;
    return parsed && typeof parsed.ticketToken === 'string' ? parsed.ticketToken : '';
  } catch (_ignored) {
    return '';
  }
}

function attendanceStringArray_(serialized) {
  if (Array.isArray(serialized)) {
    return serialized.filter(function(value) { return typeof value === 'string'; });
  }
  try {
    var parsed = JSON.parse(serialized || '[]');
    return Array.isArray(parsed)
      ? parsed.filter(function(value) { return typeof value === 'string'; })
      : [];
  } catch (_ignored) {
    return [];
  }
}

function attendanceMaskName_(value) {
  var text = String(value || '').trim();
  if (!text) return '';
  return text.slice(0, 1) + new Array(Math.max(2, text.length)).join('*');
}

function attendancePublicProjection_(match) {
  return {
    participantName: attendanceMaskName_(match.participant.name),
    event: {
      title: String(match.event.title || ''),
      location: String(match.event.location || '')
    },
    sessions: match.sessions.map(function(session) {
      return {
        sessionId: session.sessionId,
        title: String(session.title || ''),
        speaker: String(session.speaker || ''),
        startsAt: String(session.startsAt || ''),
        endsAt: String(session.endsAt || ''),
        location: String(session.location || match.event.location || '')
      };
    }),
    seats: match.seats.map(function(seat) {
      return {
        label: String(seat.label || ''),
        sessionId: String(seat.sessionId || '')
      };
    }),
    status: match.status
  };
}

function isAuthorizedAttendanceStaff_(identity) {
  var serialized = PropertiesService.getScriptProperties().getProperty(ATTENDANCE_STAFF_ALLOWLIST);
  if (!serialized) return false;
  var values;
  try {
    values = JSON.parse(serialized);
  } catch (_ignored) {
    values = String(serialized).split(',');
  }
  if (!Array.isArray(values)) return false;
  return values.some(function(candidate) {
    return typeof candidate === 'string' && candidate.trim().toLowerCase() === identity;
  });
}

function isWithinAttendanceWindow_(session, now) {
  var startsAt = Date.parse(session.startsAt);
  var endsAt = Date.parse(session.endsAt);
  if (!isFinite(startsAt) || !isFinite(endsAt) || endsAt <= startsAt) return false;
  var settings = typeof getAdminSettings === 'function' ? getAdminSettings() : {};
  var attendance = settings && settings.attendance && typeof settings.attendance === 'object'
    ? settings.attendance : {};
  var earlyMinutes = Number(attendance.earlyMinutes);
  var lateMinutes = Number(attendance.lateMinutes);
  if (!isFinite(earlyMinutes) || earlyMinutes < 0) earlyMinutes = 60;
  if (!isFinite(lateMinutes) || lateMinutes < 0) lateMinutes = 60;
  var timestamp = now.getTime();
  return timestamp >= startsAt - earlyMinutes * 60000 &&
    timestamp <= endsAt + lateMinutes * 60000;
}
