var ATTENDANCE_STAFF_ALLOWLIST = 'ATTENDANCE_STAFF_ALLOWLIST';

/** Read-only ticket lookup for the authenticated staff page. */
function getStaffTicketForCheckIn(payload) {
  return runStaffAttendanceService_(function() {
    var staffIdentity = requireAuthorizedStaffSession_();
    var result = invokeInternalBackend_('staff.getTicket', payload || {}, staffIdentity);
    if (!result.ok) staffAttendanceError_(result.code);
    return result.data;
  });
}

/** Records one server-timestamped row for one ticket and registered session. */
function checkIn(payload) {
  return runStaffAttendanceService_(function() {
    var staffIdentity = requireAuthorizedStaffSession_();
    var result = invokeInternalBackend_('staff.checkIn', payload || {}, staffIdentity);
    if (!result.ok) staffAttendanceError_(result.code);
    return result.data;
  });
}

function runStaffAttendanceService_(callback) {
  try {
    return { ok: true, data: callback() };
  } catch (error) {
    return staffAttendanceFailure_(error && error.publicCode ? error.publicCode : 'INTERNAL');
  }
}

function staffAttendanceFailure_(code) {
  var messages = {
    INVALID_REQUEST: '提交信息无效，请检查后重试。',
    TOKEN_INVALID: '凭证无效或已过期。',
    STAFF_ACTION_DENIED: '员工签到不可用。',
    TICKET_INACTIVE: '该凭证当前不可签到。',
    SESSION_NOT_REGISTERED: '该凭证未报名此场讲座。',
    CHECK_IN_CLOSED: '当前不在此场讲座的签到时间内。',
    CHECK_IN_DISABLED: '此活动不需要签到，二维码仍可用于验票。',
    ALREADY_CHECKED_IN: '此场讲座已完成签到。',
    CHECKPOINT_REQUIRED: '请选择要进行的签到次数。',
    CHECKPOINT_INVALID: '所选签到次数无效。',
    ALL_CHECK_INS_COMPLETE: '这张票在此场次的所有签到都已完成。',
    MAINTENANCE: '系统正在切换数据连接，请稍后重试。',
    INTERNAL: '请求未能完成，请稍后重试。'
  };
  var safeCode = Object.prototype.hasOwnProperty.call(messages, code) ? code : 'INTERNAL';
  return { ok: false, code: safeCode, message: messages[safeCode] };
}

function staffAttendanceError_(code) {
  var error = new Error(code);
  error.publicCode = code;
  throw error;
}

function requireAuthorizedStaffSession_() {
  var identity = '';
  try {
    identity = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  } catch (_ignored) {
    identity = '';
  }
  if (!identity || !isAllowlistedStaffIdentity_(identity)) {
    staffAttendanceError_('STAFF_ACTION_DENIED');
  }
  return identity;
}

function isAllowlistedStaffIdentity_(identity) {
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

function findStaffTicket_(spreadsheet, token, route) {
  if (typeof token !== 'string' || !token.trim() || token.length > 512) {
    staffAttendanceError_('TOKEN_INVALID');
  }
  var normalizedToken = token.trim();
  var normalizedRoute = normalizeStaffAttendanceRoute_(route);
  if (digestTicketToken_(normalizedToken) !== normalizedRoute.tokenDigest) {
    staffAttendanceError_('INTEGRITY_ERROR');
  }
  var records = readRows_(spreadsheet, '报名项目').filter(function(record) {
    if (String(record.status || '').toLowerCase() === 'pending') return false;
    return storedStaffTicketToken_(record.answers) === normalizedToken;
  });
  if (!records.length) staffAttendanceError_('TOKEN_INVALID');
  if (records.some(function(record) {
    return record.registrationId !== normalizedRoute.registrationId ||
      record.ticketNumber !== normalizedRoute.ticketNumber ||
      record.eventId !== normalizedRoute.eventId;
  })) {
    staffAttendanceError_('INTEGRITY_ERROR');
  }
  if (normalizedRoute.status !== staffRegistrationRouteStatus_(records)) {
    staffAttendanceError_('INTEGRITY_ERROR');
  }

  var registrationId = normalizedRoute.registrationId;
  var eventId = normalizedRoute.eventId;
  records = records.filter(function(record) {
    return record.registrationId === registrationId && record.eventId === eventId;
  });
  var event = readRows_(spreadsheet, '活动').filter(function(candidate) {
    return candidate.eventId === eventId;
  })[0];
  if (!event) staffAttendanceError_('TOKEN_INVALID');
  var participant = readRows_(spreadsheet, '参加者').filter(function(candidate) {
    return candidate.participantId === records[0].participantId;
  })[0] || {};
  var selected = {};
  records.forEach(function(record) {
    staffStringArray_(record.sessionIds).forEach(function(sessionId) { selected[sessionId] = true; });
  });
  var sessions = readRows_(spreadsheet, '场次').filter(function(session) {
    return session.eventId === eventId && selected[session.sessionId];
  });
  var seats = readRows_(spreadsheet, '座位').filter(function(seat) {
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

function normalizeStaffAttendanceRoute_(route) {
  var normalized = {
    ticketNumber: route && typeof route.ticketNumber === 'string' ? route.ticketNumber.trim() : '',
    tokenDigest: route && typeof route.tokenDigest === 'string'
      ? route.tokenDigest.trim().toLowerCase() : '',
    eventId: route && typeof route.eventId === 'string' ? route.eventId.trim() : '',
    registrationId: route && typeof route.registrationId === 'string'
      ? route.registrationId.trim() : '',
    status: route && typeof route.status === 'string' ? route.status.trim().toLowerCase() : ''
  };
  if (!normalized.ticketNumber || !/^[a-f0-9]{64}$/.test(normalized.tokenDigest) ||
      !normalized.eventId || !normalized.registrationId || !normalized.status) {
    staffAttendanceError_('INTEGRITY_ERROR');
  }
  return normalized;
}

function staffRegistrationRouteStatus_(records) {
  if (records.every(function(record) {
    return String(record.status || '').toLowerCase() === 'cancelled';
  })) {
    return 'cancelled';
  }
  if (records.every(function(record) {
    var status = String(record.status || '').toLowerCase();
    return status === 'active' || status === 'confirmed';
  })) {
    return 'active';
  }
  staffAttendanceError_('INTEGRITY_ERROR');
}

function storedStaffTicketToken_(serialized) {
  try {
    var parsed = typeof serialized === 'string' ? JSON.parse(serialized) : serialized;
    return parsed && typeof parsed.ticketToken === 'string' ? parsed.ticketToken : '';
  } catch (_ignored) {
    return '';
  }
}

function staffStringArray_(serialized) {
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

function staffTicketProjection_(match) {
  return {
    participantName: maskStaffName_(match.participant.name),
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
      return { label: String(seat.label || ''), sessionId: String(seat.sessionId || '') };
    }),
    status: match.status
  };
}

function maskStaffName_(value) {
  var text = String(value || '').trim();
  if (!text) return '';
  return text.slice(0, 1) + new Array(Math.max(2, text.length)).join('*');
}

function isWithinStaffAttendanceWindow_(registry, session, now) {
  var startsAt = Date.parse(session.startsAt);
  var endsAt = Date.parse(session.endsAt);
  if (!isFinite(startsAt) || !isFinite(endsAt) || endsAt <= startsAt) return false;
  var settings = typeof getAdminSettings_ === 'function' ? getAdminSettings_(registry) : {};
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
