/**
 * Looks up a ticket only after ticket-number and configured-value verification.
 * @param {Object} payload
 * @return {Object} ApiResult<Ticket>
 */
function lookupTicket(payload) {
  return runTicketService_(function() {
    return withScriptLock(function() {
      var spreadsheet = getConfiguredSpreadsheet();
      recoverPendingTransactions_(spreadsheet);
      var match = requireVerifiedTicket_(payload, readRows('报名项目'));
      return ticketProjectionFromRecords_(match);
    });
  });
}

/**
 * Preserves registration rows and releases their capacity and seats by status.
 * @param {Object} payload
 * @return {Object} ApiResult<Ticket>
 */
function cancelRegistration(payload) {
  return runTicketService_(function() {
    return withScriptLock(function() {
      var spreadsheet = getConfiguredSpreadsheet();
      recoverPendingTransactions_(spreadsheet);
      var match = requireVerifiedTicket_(payload, readRows('报名项目'));
      if (match.records.every(function(record) { return record.status === 'cancelled'; })) {
        return ticketProjectionFromRecords_(match);
      }
      var registrationSnapshots = snapshotTicketRows_(spreadsheet, '报名项目', match.records);
      var occupiedSeats = readRows('座位').filter(function(seat) {
        return seatBelongsToRegistration_(seat, match.registrationId);
      });
      var seatSnapshots = snapshotTicketRows_(spreadsheet, '座位', occupiedSeats);
      var auditSnapshot = null;
      try {
        updateTicketRegistrationRows_(spreadsheet, match.records, function(record) {
          record.status = 'cancelled';
          record.updatedAt = new Date().toISOString();
          return record;
        });
        releaseTicketSeats_(spreadsheet, occupiedSeats);
        auditSnapshot = appendTicketAudit_(spreadsheet, 'CANCEL_REGISTRATION', match.registrationId, {
          eventId: match.event.eventId
        });
        match.records.forEach(function(record) { record.status = 'cancelled'; });
        match.status = 'cancelled';
        return ticketProjectionFromRecords_(match);
      } catch (error) {
        var restoreFailures = restoreTicketSnapshots_(registrationSnapshots.concat(seatSnapshots));
        var auditRollbackFailure = rollbackTicketAudit_(auditSnapshot);
        if (auditRollbackFailure) restoreFailures.push(auditRollbackFailure);
        if (restoreFailures.length) {
          raiseTicketIntegrityError_(spreadsheet, match.registrationId, 'CANCEL_REGISTRATION', restoreFailures);
        }
        throw error;
      }
    });
  });
}

/**
 * Atomically claims a new seat, updates the ticket, releases the old seat,
 * audits the exchange, and rotates the QR token.
 * @param {Object} payload
 * @return {Object} ApiResult<Ticket>
 */
function exchangeSeat(payload) {
  return runTicketService_(function() {
    return withScriptLock(function() {
      var spreadsheet = getConfiguredSpreadsheet();
      recoverPendingTransactions_(spreadsheet);
      var match = requireVerifiedTicket_(payload, readRows('报名项目'));
      var policy = getRegistrationPolicy_(getAdminSettings(), match.event.eventId);
      if (!policy.seatExchangeEnabled) ticketError_('SEAT_EXCHANGE_DISABLED');
      if (!payload || typeof payload.newSeatId !== 'string' || !payload.newSeatId.trim()) {
        ticketError_('INVALID_REQUEST');
      }

      var allSeats = readRows('座位').filter(function(seat) { return seat.eventId === match.event.eventId; });
      var oldSeats = allSeats.filter(function(seat) { return seatBelongsToRegistration_(seat, match.registrationId); });
      var oldSeat = payload.oldSeatId
        ? oldSeats.filter(function(seat) { return seat.seatId === payload.oldSeatId; })[0]
        : oldSeats[0];
      if (!oldSeat) ticketError_('SEAT_UNAVAILABLE');
      var newSeat = allSeats.filter(function(seat) {
        return (seat.seatId === payload.newSeatId || seat.label === payload.newSeatId) &&
          (!oldSeat.sessionId || !seat.sessionId || seat.sessionId === oldSeat.sessionId);
      })[0];
      var exchangeNow = new Date();
      if (newSeat) expireSeatHold_(newSeat, policy, exchangeNow);
      if (!newSeat || newSeat.seatId === oldSeat.seatId ||
          !isSeatAvailableForRegistration_(newSeat, policy, String(payload.seatHoldOwner || ''), exchangeNow)) {
        ticketError_('SEAT_UNAVAILABLE');
      }

      var registrationSnapshots = snapshotTicketRows_(spreadsheet, '报名项目', match.records);
      var newSeatSnapshots = snapshotTicketRows_(spreadsheet, '座位', [newSeat]);
      var rotatedToken = rotateTicketToken_(match.records);
      var newSeatClaimed = false;
      try {
        claimExchangedSeat_(spreadsheet, newSeat, match.registrationId);
        newSeatClaimed = true;
        updateExchangeRegistrationRows_(spreadsheet, match.records, oldSeat.seatId, newSeat.seatId, rotatedToken);
      } catch (error) {
        var restoreFailures = newSeatClaimed
          ? restoreExchangeSnapshots_(registrationSnapshots.concat(newSeatSnapshots))
          : [];
        if (restoreFailures.length) {
          raiseTicketIntegrityError_(spreadsheet, match.registrationId, 'EXCHANGE_PRECOMMIT', restoreFailures);
        }
        throw error;
      }

      match.token = rotatedToken;
      newSeat.holderRegistrationId = match.registrationId;
      newSeat.status = 'registered';
      var releaseFailed = false;
      try {
        releaseTicketSeats_(spreadsheet, [oldSeat]);
      } catch (releaseError) {
        releaseFailed = true;
        appendTicketAuditSafely_(spreadsheet, 'SEAT_RELEASE_RETRY', match.registrationId, {
          oldSeatId: oldSeat.seatId,
          newSeatId: newSeat.seatId
        });
      }
      if (!releaseFailed) {
        appendTicketAuditSafely_(spreadsheet, 'EXCHANGE_SEAT', match.registrationId, {
          oldSeatId: oldSeat.seatId,
          newSeatId: newSeat.seatId
        });
      }
      match.seats = readRows('座位').filter(function(seat) {
        return seatBelongsToRegistration_(seat, match.registrationId);
      });
      return ticketProjectionFromRecords_(match);
    });
  });
}

function runTicketService_(callback) {
  try {
    return { ok: true, data: callback() };
  } catch (error) {
    var code = error && error.publicCode ? error.publicCode : 'INTERNAL';
    return ticketFailure_(code);
  }
}

function ticketFailure_(code) {
  var messages = {
    INVALID_REQUEST: '提交信息无效，请检查后重试。',
    TICKET_NOT_FOUND: '未找到对应凭证。',
    TICKET_VERIFICATION_FAILED: '验证信息不匹配。',
    SEAT_EXCHANGE_DISABLED: '该活动不允许更换座位。',
    SEAT_UNAVAILABLE: '所选座位不可用。',
    INTEGRITY_ERROR: '数据一致性检查失败，请联系管理员。',
    INTERNAL: '请求未能完成，请稍后重试。'
  };
  var safeCode = Object.prototype.hasOwnProperty.call(messages, code) ? code : 'INTERNAL';
  return { ok: false, code: safeCode, message: messages[safeCode] };
}

function ticketError_(code) {
  var error = new Error(code);
  error.publicCode = code;
  throw error;
}

function requireVerifiedTicket_(payload, registrations) {
  if (!payload || typeof payload !== 'object' ||
      typeof payload.ticketNumber !== 'string' || !payload.ticketNumber.trim() ||
      typeof payload.verificationValue !== 'string' || !payload.verificationValue.trim()) {
    ticketError_('INVALID_REQUEST');
  }
  var records = registrations.filter(function(record) {
    return record.ticketNumber === payload.ticketNumber.trim() &&
      record.status !== 'pending';
  });
  if (!records.length) ticketError_('TICKET_NOT_FOUND');

  var event = readRows('活动').filter(function(candidate) {
    return candidate.eventId === records[0].eventId;
  })[0];
  if (!event) ticketError_('TICKET_NOT_FOUND');
  var policy = getRegistrationPolicy_(getAdminSettings(), event.eventId);
  var stored = parseStoredRegistrationAnswers_(records[0].answers);
  var verificationField = stored.verificationField || policy.verificationField || policy.identityFields[0];
  if (!verificationField ||
      normalizeIdentityValue_(stored.values[verificationField]) !== normalizeIdentityValue_(payload.verificationValue)) {
    ticketError_('TICKET_VERIFICATION_FAILED');
  }
  var participant = readRows('参加者').filter(function(candidate) {
    return candidate.participantId === records[0].participantId;
  })[0] || {};
  var sessions = collectTicketSessions_(records, event.eventId);
  var registrationId = records[0].registrationId;
  var seats = readRows('座位').filter(function(seat) {
    return seatBelongsToRegistration_(seat, registrationId);
  });
  return {
    registrationId: registrationId,
    ticketNumber: records[0].ticketNumber,
    token: stored.ticketToken || '',
    status: combinedTicketStatus_(records),
    event: event,
    participant: participant,
    sessions: sessions,
    seats: seats,
    records: records
  };
}

function seatBelongsToRegistration_(seat, registrationId) {
  return seat.holderRegistrationId === registrationId ||
    seat.holderRegistrationId === 'PENDING|' + registrationId;
}

function collectTicketSessions_(records, eventId) {
  var selected = {};
  records.forEach(function(record) {
    parseStringArray_(record.sessionIds).forEach(function(sessionId) { selected[sessionId] = true; });
  });
  return readRows('场次').filter(function(session) {
    return session.eventId === eventId && selected[session.sessionId];
  });
}

function combinedTicketStatus_(records) {
  return records.every(function(record) { return record.status === 'cancelled'; }) ? 'cancelled' : 'active';
}

function ticketProjectionFromRecords_(match) {
  var createdAt = match.records[0].createdAt;
  var updatedAt = match.records.reduce(function(latest, record) {
    return String(record.updatedAt || '') > String(latest || '') ? record.updatedAt : latest;
  }, createdAt);
  return {
    registrationId: match.registrationId,
    ticketNumber: match.ticketNumber,
    token: match.token,
    eventId: match.event.eventId,
    eventTitle: match.event.title,
    status: match.status,
    participant: {
      name: maskName_(match.participant.name),
      phone: maskPrivateValue_(match.participant.phone),
      email: maskPrivateValue_(match.participant.email)
    },
    sessions: match.sessions.map(function(session) {
      return {
        sessionId: session.sessionId,
        title: session.title,
        startsAt: session.startsAt,
        endsAt: session.endsAt
      };
    }),
    seats: match.seats.map(function(seat) {
      return { seatId: seat.seatId, label: seat.label, zone: seat.zone, sessionId: seat.sessionId };
    }),
    createdAt: createdAt,
    updatedAt: updatedAt
  };
}

function maskName_(value) {
  var text = String(value || '').trim();
  if (!text) return '';
  return text.slice(0, 1) + new Array(Math.max(2, text.length)).join('*');
}

function maskPrivateValue_(value) {
  var text = String(value || '');
  if (!text) return '';
  if (text.indexOf('@') !== -1) {
    var parts = text.split('@');
    return parts[0].slice(0, 1) + '***@' + parts.slice(1).join('@');
  }
  return text.length <= 4 ? '****' : text.slice(0, 2) + '****' + text.slice(-2);
}

function snapshotTicketRows_(spreadsheet, sheetName, rows) {
  var sheet = getRequiredSheet_(spreadsheet, sheetName);
  return rows.map(function(record) {
    return {
      sheet: sheet,
      row: record.rowNumber,
      values: normalizeRow_(sheetName, record)
    };
  });
}

function restoreTicketSnapshots_(snapshots) {
  var failures = [];
  snapshots.forEach(function(snapshot) {
    try {
      snapshot.sheet.getRange(snapshot.row, 1, 1, snapshot.values.length).setValues([snapshot.values]);
    } catch (error) {
      failures.push(error);
    }
  });
  return failures;
}

function restoreExchangeSnapshots_(snapshots) {
  return restoreTicketSnapshots_(snapshots);
}

function updateTicketRegistrationRows_(spreadsheet, records, transform) {
  var sheet = getRequiredSheet_(spreadsheet, '报名项目');
  records.forEach(function(record) {
    var values = normalizeRow_('报名项目', transform(record));
    sheet.getRange(record.rowNumber, 1, 1, values.length).setValues([values]);
  });
}

function releaseTicketSeats_(spreadsheet, seats) {
  var sheet = getRequiredSheet_(spreadsheet, '座位');
  seats.forEach(function(seat) {
    var updated = {
      seatId: seat.seatId,
      eventId: seat.eventId,
      sessionId: seat.sessionId,
      label: seat.label,
      zone: seat.zone,
      status: 'available',
      holderRegistrationId: '',
      createdAt: seat.createdAt,
      updatedAt: new Date().toISOString()
    };
    var values = normalizeRow_('座位', updated);
    sheet.getRange(seat.rowNumber, 1, 1, values.length).setValues([values]);
  });
}

function rotateTicketToken_(records) {
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  records.forEach(function(record) {
    var stored = parseStoredRegistrationAnswers_(record.answers);
    stored.ticketToken = token;
    record.answers = JSON.stringify(stored);
  });
  return token;
}

function updateExchangeRegistrationRows_(spreadsheet, records, oldSeatId, newSeatId, rotatedToken) {
  var sheet = getRequiredSheet_(spreadsheet, '报名项目');
  records.forEach(function(record) {
    var seatIds = parseStringArray_(record.seatChoices).map(function(seatId) {
      return seatId === oldSeatId ? newSeatId : seatId;
    });
    var stored = parseStoredRegistrationAnswers_(record.answers);
    stored.ticketToken = rotatedToken;
    record.answers = JSON.stringify(stored);
    record.seatChoices = JSON.stringify(seatIds);
    record.updatedAt = new Date().toISOString();
    var values = normalizeRow_('报名项目', record);
    sheet.getRange(record.rowNumber, 1, 1, values.length).setValues([values]);
  });
}

function claimExchangedSeat_(spreadsheet, seat, registrationId) {
  var sheet = getRequiredSheet_(spreadsheet, '座位');
  var updated = {
    seatId: seat.seatId,
    eventId: seat.eventId,
    sessionId: seat.sessionId,
    label: seat.label,
    zone: seat.zone,
    status: 'registered',
    holderRegistrationId: registrationId,
    createdAt: seat.createdAt,
    updatedAt: new Date().toISOString()
  };
  var values = normalizeRow_('座位', updated);
  sheet.getRange(seat.rowNumber, 1, 1, values.length).setValues([values]);
}

function appendTicketAudit_(spreadsheet, action, registrationId, details) {
  var sheet = getRequiredSheet_(spreadsheet, '操作记录');
  var values = [
    Utilities.getUuid(), action, 'registration', registrationId, 'system',
    JSON.stringify(details), new Date().toISOString()
  ];
  var row = sheet.getLastRow() + 1;
  sheet.getRange(row, 1, 1, values.length).setValues([values]);
  return { sheet: sheet, row: row };
}

function appendTicketAuditSafely_(spreadsheet, action, registrationId, details) {
  try {
    appendTicketAudit_(spreadsheet, action, registrationId, details);
    return null;
  } catch (error) {
    if (action !== 'AUDIT_RETRY') {
      try {
        appendTicketAudit_(spreadsheet, 'AUDIT_RETRY', registrationId, {
          failedAction: action
        });
      } catch (_auditRetryError) {
        // The committed seat state remains authoritative.
      }
    }
    return error;
  }
}

function rollbackTicketAudit_(snapshot) {
  if (!snapshot) return null;
  try {
    snapshot.sheet.deleteRow(snapshot.row);
    return null;
  } catch (error) {
    return error;
  }
}

function raiseTicketIntegrityError_(spreadsheet, registrationId, stage, restoreFailures) {
  var auditFailure = null;
  try {
    appendTicketAudit_(spreadsheet, 'INTEGRITY_ALERT', registrationId, {
      stage: stage,
      restoreFailureCount: restoreFailures.length
    });
  } catch (error) {
    auditFailure = error;
  }
  var integrityError = new Error('INTEGRITY_ERROR');
  integrityError.publicCode = 'INTEGRITY_ERROR';
  integrityError.restoreFailures = restoreFailures;
  integrityError.auditFailure = auditFailure;
  throw integrityError;
}
