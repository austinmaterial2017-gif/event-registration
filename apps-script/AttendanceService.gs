/**
 * Returns a privacy-safe, consistent ticket snapshot. This operation never writes.
 * @param {Object} payload
 * @return {Object}
 */
function verifyTicket(payload) {
  return runAttendanceService_(function() {
    return withScriptLock(function() {
      var registry = getRegistrySpreadsheet_();
      var route = requireAttendanceTicketRoute_(registry, payload && payload.token);
      var spreadsheet = getEventSpreadsheet_(registry, route.eventId);
      var match = findAttendanceTicket_(spreadsheet, payload && payload.token, route);
      return attendancePublicProjection_(match);
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

function requireAttendanceTicketRoute_(registry, token) {
  if (typeof token !== 'string' || !token.trim() || token.length > 512) attendanceError_('TOKEN_INVALID');
  try {
    return getTicketRouteByToken_(registry, token);
  } catch (error) {
    if (error && error.publicCode === 'TICKET_NOT_FOUND') attendanceError_('TOKEN_INVALID');
    throw error;
  }
}

function findAttendanceTicket_(spreadsheet, token, route) {
  if (typeof token !== 'string' || !token.trim() || token.length > 512) attendanceError_('TOKEN_INVALID');
  var normalizedToken = token.trim();
  var normalizedRoute = normalizeAttendanceTicketRoute_(route);
  if (digestTicketToken_(normalizedToken) !== normalizedRoute.tokenDigest) {
    attendanceError_('INTEGRITY_ERROR');
  }
  var records = readRows(spreadsheet, '报名项目').filter(function(record) {
    if (String(record.status || '').toLowerCase() === 'pending') return false;
    return attendanceStoredToken_(record.answers) === normalizedToken;
  });
  if (!records.length) attendanceError_('TOKEN_INVALID');
  if (records.some(function(record) {
    return record.registrationId !== normalizedRoute.registrationId ||
      record.ticketNumber !== normalizedRoute.ticketNumber ||
      record.eventId !== normalizedRoute.eventId;
  })) {
    attendanceError_('INTEGRITY_ERROR');
  }

  var registrationId = normalizedRoute.registrationId;
  records = records.filter(function(record) {
    return record.registrationId === registrationId && record.eventId === normalizedRoute.eventId;
  });
  var event = readRows(spreadsheet, '活动').filter(function(candidate) {
    return candidate.eventId === normalizedRoute.eventId;
  })[0];
  if (!event) attendanceError_('TOKEN_INVALID');
  var participant = readRows(spreadsheet, '参加者').filter(function(candidate) {
    return candidate.participantId === records[0].participantId;
  })[0] || {};
  var selected = {};
  records.forEach(function(record) {
    attendanceStringArray_(record.sessionIds).forEach(function(sessionId) { selected[sessionId] = true; });
  });
  var sessions = readRows(spreadsheet, '场次').filter(function(session) {
    return session.eventId === event.eventId && selected[session.sessionId];
  });
  var seats = readRows(spreadsheet, '座位').filter(function(seat) {
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

function normalizeAttendanceTicketRoute_(route) {
  var normalized = {
    ticketNumber: route && typeof route.ticketNumber === 'string' ? route.ticketNumber.trim() : '',
    tokenDigest: route && typeof route.tokenDigest === 'string'
      ? route.tokenDigest.trim().toLowerCase() : '',
    eventId: route && typeof route.eventId === 'string' ? route.eventId.trim() : '',
    registrationId: route && typeof route.registrationId === 'string'
      ? route.registrationId.trim() : ''
  };
  if (!normalized.ticketNumber || !/^[a-f0-9]{64}$/.test(normalized.tokenDigest) ||
      !normalized.eventId || !normalized.registrationId) {
    attendanceError_('INTEGRITY_ERROR');
  }
  return normalized;
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
