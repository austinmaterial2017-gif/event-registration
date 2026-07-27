/**
 * Looks up a ticket only after ticket-number and configured-value verification.
 * @param {Object} payload
 * @return {Object} ApiResult<Ticket>
 */
function lookupTicket(payload) {
  return runTicketService_(function() {
    return withScriptLock(function() {
      var registry = getRegistrySpreadsheet_();
      var route = requireTicketNumberRoute_(registry, payload);
      var spreadsheet = getEventSpreadsheet_(registry, route.eventId);
      recoverPendingTransactions_(spreadsheet);
      cleanupStaleTicketSeats_(spreadsheet);
      var match = requireVerifiedTicket_(
        spreadsheet, registry, payload, readRows(spreadsheet, '报名项目'), route
      );
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
      var registry = getRegistrySpreadsheet_();
      requireNoSwitchMaintenance_(registry);
      var route = requireTicketNumberRoute_(registry, payload);
      var spreadsheet = getEventSpreadsheet_(registry, route.eventId);
      var recoveryFailures = recoverPendingTransactions_(spreadsheet);
      if (recoveryFailures.length) ticketError_('INTEGRITY_ERROR');
      cleanupStaleTicketSeats_(spreadsheet);
      var match = requireVerifiedTicket_(
        spreadsheet, registry, payload, readRows(spreadsheet, '报名项目'), route
      );
      var routeSnapshot = snapshotTicketRoute_(registry, route);
      if (match.records.every(function(record) { return record.status === 'cancelled'; })) {
        if (route.status !== 'cancelled') {
          try {
            updateTicketRouteSnapshot_(registry, routeSnapshot, {
              status: 'cancelled',
              updatedAt: new Date().toISOString()
            });
          } catch (routeError) {
            var idempotentRestoreFailures = restoreTicketSnapshots_([routeSnapshot]);
            if (idempotentRestoreFailures.length) {
              raiseTicketIntegrityError_(
                spreadsheet,
                match.registrationId,
                'CANCEL_ROUTE_REPAIR',
                idempotentRestoreFailures
              );
            }
            throw routeError;
          }
        }
        return ticketProjectionFromRecords_(match);
      }
      if (!match.policy.cancellationEnabled) ticketError_('CANCELLATION_DISABLED');
      var registrationSnapshots = snapshotTicketRows_(spreadsheet, '报名项目', match.records);
      var occupiedSeats = readRows(spreadsheet, '座位').filter(function(seat) {
        return seatBelongsToRegistration_(seat, match.registrationId);
      });
      var seatSnapshots = snapshotTicketRows_(spreadsheet, '座位', occupiedSeats);
      var auditSnapshot = null;
      var routeWriteAttempted = false;
      try {
        var cancelledAt = new Date().toISOString();
        updateTicketRegistrationRows_(spreadsheet, match.records, function(record) {
          record.status = 'cancelled';
          record.updatedAt = cancelledAt;
          return record;
        });
        releaseTicketSeats_(spreadsheet, occupiedSeats);
        auditSnapshot = appendTicketAudit_(spreadsheet, 'CANCEL_REGISTRATION', match.registrationId, {
          eventId: match.event.eventId
        });
        routeWriteAttempted = true;
        updateTicketRouteSnapshot_(registry, routeSnapshot, {
          status: 'cancelled',
          updatedAt: cancelledAt
        });
        match.records.forEach(function(record) { record.status = 'cancelled'; });
        match.status = 'cancelled';
        return ticketProjectionFromRecords_(match);
      } catch (error) {
        var rollbackSnapshots = registrationSnapshots.concat(seatSnapshots);
        if (routeWriteAttempted) rollbackSnapshots.push(routeSnapshot);
        var restoreFailures = restoreTicketSnapshots_(rollbackSnapshots);
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
      var registry = getRegistrySpreadsheet_();
      requireNoSwitchMaintenance_(registry);
      var route = requireTicketNumberRoute_(registry, payload);
      requireActiveTicketRoute_(route);
      var spreadsheet = getEventSpreadsheet_(registry, route.eventId);
      var recoveryFailures = recoverPendingTransactions_(spreadsheet);
      if (recoveryFailures.length) ticketError_('INTEGRITY_ERROR');
      var match = requireVerifiedTicket_(
        spreadsheet, registry, payload, readRows(spreadsheet, '报名项目'), route
      );
      var cleanupFailures = cleanupStaleTicketSeats_(spreadsheet);
      if (cleanupFailures[match.registrationId]) ticketError_('EXCHANGE_PENDING_CLEANUP');
      var policy = getRegistrationPolicy_(getAdminSettings(registry), match.event.eventId);
      if (!policy.seatExchangeEnabled) ticketError_('SEAT_EXCHANGE_DISABLED');
      if (!payload || typeof payload.newSeatId !== 'string' || !payload.newSeatId.trim()) {
        ticketError_('INVALID_REQUEST');
      }

      var allSeats = readRows(spreadsheet, '座位').filter(function(seat) {
        return seat.eventId === match.event.eventId;
      });
      var oldSeats = allSeats.filter(function(seat) { return seatBelongsToRegistration_(seat, match.registrationId); });
      var oldSeat = payload.oldSeatId
        ? oldSeats.filter(function(seat) { return seat.seatId === payload.oldSeatId; })[0]
        : oldSeats[0];
      if (!oldSeat) ticketError_('SEAT_UNAVAILABLE');
      var newSeat = allSeats.filter(function(seat) {
        return (seat.seatId === payload.newSeatId || seat.label === payload.newSeatId) &&
          String(seat.sessionId || '') === String(oldSeat.sessionId || '');
      })[0];
      var exchangeNow = new Date();
      if (newSeat) expireSeatHold_(newSeat, policy, exchangeNow);
      if (!newSeat || newSeat.seatId === oldSeat.seatId ||
          !isSeatAvailableForRegistration_(newSeat, policy, String(payload.seatHoldOwner || ''), exchangeNow)) {
        ticketError_('SEAT_UNAVAILABLE');
      }

      var registrationSnapshots = snapshotTicketRows_(spreadsheet, '报名项目', match.records);
      var newSeatSnapshots = snapshotTicketRows_(spreadsheet, '座位', [newSeat]);
      var oldSeatSnapshots = snapshotTicketRows_(spreadsheet, '座位', [oldSeat]);
      var routeSnapshot = snapshotTicketRoute_(registry, route);
      var rotatedToken = rotateTicketToken_(match.records);
      var exchangeMutationStarted = false;
      var routeWriteAttempted = false;
      var auditSnapshot = null;
      try {
        exchangeMutationStarted = true;
        claimExchangedSeat_(spreadsheet, newSeat, match.registrationId);
        updateExchangeRegistrationRows_(spreadsheet, match.records, oldSeat.seatId, newSeat.seatId, rotatedToken);
        routeWriteAttempted = true;
        updateTicketRouteSnapshot_(registry, routeSnapshot, {
          tokenDigest: digestTicketToken_(rotatedToken),
          updatedAt: new Date().toISOString()
        });
        releaseTicketSeats_(spreadsheet, [oldSeat]);
        auditSnapshot = appendTicketAudit_(spreadsheet, 'EXCHANGE_SEAT', match.registrationId, {
          oldSeatId: oldSeat.seatId,
          newSeatId: newSeat.seatId
        });
        match.token = rotatedToken;
        newSeat.holderRegistrationId = match.registrationId;
        newSeat.status = 'registered';
        match.seats = readRows(spreadsheet, '座位').filter(function(seat) {
          return seatBelongsToRegistration_(seat, match.registrationId);
        });
        return ticketProjectionFromRecords_(match);
      } catch (error) {
        var exchangeRollbackSnapshots = registrationSnapshots
          .concat(newSeatSnapshots)
          .concat(oldSeatSnapshots);
        if (routeWriteAttempted) exchangeRollbackSnapshots.push(routeSnapshot);
        var restoreFailures = exchangeMutationStarted || routeWriteAttempted
          ? restoreExchangeSnapshots_(exchangeRollbackSnapshots)
          : [];
        var auditRollbackFailure = rollbackTicketAudit_(auditSnapshot);
        if (auditRollbackFailure) restoreFailures.push(auditRollbackFailure);
        if (restoreFailures.length) {
          raiseTicketIntegrityError_(spreadsheet, match.registrationId, 'EXCHANGE_TRANSACTION', restoreFailures);
        }
        throw error;
      }
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
    CANCELLATION_DISABLED: 'Cancellation is not enabled for this event.',
    INVALID_REQUEST: '提交信息无效，请检查后重试。',
    TICKET_NOT_FOUND: '未找到对应凭证。',
    TICKET_VERIFICATION_FAILED: '验证信息不匹配。',
    TICKET_INACTIVE: '该凭证当前不可更换座位。',
    SEAT_EXCHANGE_DISABLED: '该活动不允许更换座位。',
    SEAT_UNAVAILABLE: '所选座位不可用。',
    INTEGRITY_ERROR: '数据一致性检查失败，请联系管理员。',
    EXCHANGE_PENDING_CLEANUP: '座位更换正在清理旧座位，请稍后重试。',
    MAINTENANCE: '系统正在切换数据连接，请稍后重试。',
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

function requireTicketNumberRoute_(registry, payload) {
  if (!payload || typeof payload !== 'object' ||
      typeof payload.ticketNumber !== 'string' || !payload.ticketNumber.trim() ||
      typeof payload.verificationValue !== 'string' || !payload.verificationValue.trim()) {
    ticketError_('INVALID_REQUEST');
  }
  return getTicketRouteByNumber_(registry, payload.ticketNumber);
}

function requireActiveTicketRoute_(route) {
  if (String(route && route.status || '').trim().toLowerCase() !== 'active') {
    ticketError_('TICKET_INACTIVE');
  }
}

function requireVerifiedTicket_(spreadsheet, registry, payload, registrations, route) {
  if (!payload || typeof payload !== 'object' ||
      typeof payload.ticketNumber !== 'string' || !payload.ticketNumber.trim() ||
      typeof payload.verificationValue !== 'string' || !payload.verificationValue.trim()) {
    ticketError_('INVALID_REQUEST');
  }
  var normalizedRoute = normalizeTicketRoute_(route, payload.ticketNumber);
  var records = registrations.filter(function(record) {
    return record.ticketNumber === payload.ticketNumber.trim() &&
      record.status !== 'pending';
  });
  if (!records.length) ticketError_('TICKET_NOT_FOUND');
  if (records.some(function(record) {
    return record.ticketNumber !== normalizedRoute.ticketNumber ||
      record.registrationId !== normalizedRoute.registrationId ||
      record.eventId !== normalizedRoute.eventId;
  })) {
    ticketError_('INTEGRITY_ERROR');
  }
  if (String(normalizedRoute.status || '').toLowerCase() !== ticketRegistrationRouteStatus_(records)) {
    ticketError_('INTEGRITY_ERROR');
  }

  var event = readRows(spreadsheet, '活动').filter(function(candidate) {
    return candidate.eventId === normalizedRoute.eventId;
  })[0];
  if (!event) ticketError_('TICKET_NOT_FOUND');
  var policy = getRegistrationPolicy_(getAdminSettings(registry), event.eventId);
  var stored = parseStoredRegistrationAnswers_(records[0].answers);
  var verificationField = stored.verificationField || policy.verificationField || policy.identityFields[0];
  if (!verificationField ||
      normalizeIdentityValue_(stored.values[verificationField]) !== normalizeIdentityValue_(payload.verificationValue)) {
    ticketError_('TICKET_VERIFICATION_FAILED');
  }
  if (!stored.ticketToken ||
      digestTicketToken_(stored.ticketToken) !== normalizedRoute.tokenDigest) {
    ticketError_('INTEGRITY_ERROR');
  }
  var participant = readRows(spreadsheet, '参加者').filter(function(candidate) {
    return candidate.participantId === records[0].participantId;
  })[0] || {};
  var sessions = collectTicketSessions_(spreadsheet, records, event.eventId);
  var registrationId = records[0].registrationId;
  var allSeats = readRows(spreadsheet, ticketSheetNameByHeader_('seatId')).filter(function(seat) {
    return seat.eventId === event.eventId;
  });
  var questions = readRows(
    spreadsheet, ticketSheetNameByHeader_('questionId')
  ).filter(function(question) {
    return question.eventId === event.eventId;
  });
  var ticketFields = Array.isArray(stored.ticketFields)
    ? stored.ticketFields
    : buildStoredTicketFields_(questions, stored.values, policy);
  var seats = readRows(spreadsheet, '座位').filter(function(seat) {
    return seatBelongsToRegistration_(seat, registrationId);
  });
  return {
    registrationId: registrationId,
    ticketNumber: records[0].ticketNumber,
    token: stored.ticketToken || '',
    status: combinedTicketStatus_(records, event),
    event: event,
    participant: participant,
    sessions: sessions,
    seats: seats,
    allSeats: allSeats,
    policy: policy,
    ticketFields: ticketFields,
    records: records,
    route: normalizedRoute
  };
}

function ticketRegistrationRouteStatus_(records) {
  if (records.every(function(record) {
    return String(record.status || '').toLowerCase() === 'cancelled';
  })) {
    return 'cancelled';
  }
  if (records.every(function(record) {
    return REGISTRATION_ACTIVE_STATUSES[String(record.status || '').toLowerCase()];
  })) {
    return 'active';
  }
  ticketError_('INTEGRITY_ERROR');
}

function normalizeTicketRoute_(route, expectedTicketNumber) {
  var normalized = {
    ticketNumber: route && typeof route.ticketNumber === 'string' ? route.ticketNumber.trim() : '',
    tokenDigest: route && typeof route.tokenDigest === 'string'
      ? route.tokenDigest.trim().toLowerCase() : '',
    eventId: route && typeof route.eventId === 'string' ? route.eventId.trim() : '',
    registrationId: route && typeof route.registrationId === 'string'
      ? route.registrationId.trim() : '',
    status: route && typeof route.status === 'string' ? route.status.trim() : '',
    createdAt: route && typeof route.createdAt === 'string' ? route.createdAt.trim() : '',
    updatedAt: route && typeof route.updatedAt === 'string' ? route.updatedAt.trim() : ''
  };
  if (!normalized.ticketNumber ||
      normalized.ticketNumber !== String(expectedTicketNumber || '').trim() ||
      !/^[a-f0-9]{64}$/.test(normalized.tokenDigest) ||
      !normalized.eventId || !normalized.registrationId || !normalized.status ||
      !normalized.createdAt || !normalized.updatedAt) {
    ticketError_('INTEGRITY_ERROR');
  }
  return normalized;
}

function seatBelongsToRegistration_(seat, registrationId) {
  return seat.holderRegistrationId === registrationId ||
    seat.holderRegistrationId === 'PENDING|' + registrationId;
}

function cleanupStaleTicketSeats_(spreadsheet) {
  var activeChoices = {};
  var knownRegistrationIds = {};
  readRows(spreadsheet, '报名项目').forEach(function(record) {
    knownRegistrationIds[record.registrationId] = true;
    if (!REGISTRATION_ACTIVE_STATUSES[String(record.status || '').toLowerCase()]) return;
    if (!activeChoices[record.registrationId]) activeChoices[record.registrationId] = {};
    parseStringArray_(record.seatChoices).forEach(function(seatId) {
      activeChoices[record.registrationId][seatId] = true;
    });
  });
  var failures = {};
  var seatSheet = getRequiredSheet_(spreadsheet, '座位');
  readRows(spreadsheet, '座位').forEach(function(seat) {
    var holder = String(seat.holderRegistrationId || '');
    var pendingMatch = /^PENDING\|(.+)$/.exec(holder);
    var registrationId = pendingMatch ? pendingMatch[1] : holder;
    if (!registrationId) return;
    if (!pendingMatch && !knownRegistrationIds[registrationId]) return;
    if (pendingMatch && activeChoices[registrationId] && activeChoices[registrationId][seat.seatId]) return;
    if (!pendingMatch && activeChoices[registrationId] && activeChoices[registrationId][seat.seatId]) return;
    var values = normalizeRow_('座位', {
      seatId: seat.seatId,
      eventId: seat.eventId,
      sessionId: seat.sessionId,
      label: seat.label,
      zone: seat.zone,
      status: 'available',
      holderRegistrationId: '',
      createdAt: seat.createdAt,
      updatedAt: new Date().toISOString()
    });
    try {
      seatSheet.getRange(seat.rowNumber, 1, 1, values.length).setValues([values]);
      appendTicketAuditSafely_(spreadsheet, 'SEAT_RELEASE_RESOLVED', registrationId, {
        seatId: seat.seatId
      });
    } catch (error) {
      failures[registrationId] = true;
      appendTicketAuditSafely_(spreadsheet, 'SEAT_RELEASE_RETRY', registrationId, {
        seatId: seat.seatId
      });
    }
  });
  return failures;
}

function collectTicketSessions_(spreadsheet, records, eventId) {
  var selected = {};
  records.forEach(function(record) {
    parseStringArray_(record.sessionIds).forEach(function(sessionId) { selected[sessionId] = true; });
  });
  return readRows(spreadsheet, '场次').filter(function(session) {
    return session.eventId === eventId && selected[session.sessionId];
  });
}

function combinedTicketStatus_(records, event) {
  if (records.every(function(record) { return record.status === 'cancelled'; }) ||
      String(event && event.status || '').toLowerCase() === 'cancelled') return 'cancelled';
  var eventStatus = String(event && event.status || '').toLowerCase();
  return eventStatus === 'ended' || eventStatus === 'archived' ? 'ended' : 'active';
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
    verifyUrl: typeof buildPublicVerificationUrl_ === 'function'
      ? buildPublicVerificationUrl_(match.token)
      : '',
    eventId: match.event.eventId,
    eventTitle: match.event.title,
    location: match.event.location,
    status: match.status,
    participant: {
      name: maskName_(match.participant.name),
      phone: maskPrivateValue_(match.participant.phone),
      email: maskPrivateValue_(match.participant.email)
    },
    displayFields: projectTicketDisplayFields_(match.ticketFields),
    capabilities: ticketCapabilities_(match.status, match.policy),
    exchangeOptions: buildTicketExchangeOptions_(
      match.allSeats || [], match.seats || [], match.policy, match.status, new Date()
    ),
    sessions: match.sessions.map(function(session) {
      return {
        sessionId: session.sessionId,
        title: session.title,
        speaker: session.speaker,
        startsAt: session.startsAt,
        endsAt: session.endsAt,
        location: session.location || match.event.location
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

function snapshotTicketRoute_(registry, route) {
  var normalizedRoute = normalizeTicketRoute_(route, route && route.ticketNumber);
  var matches = readRows(registry, '票券索引').filter(function(candidate) {
    return String(candidate.ticketNumber || '').trim() === normalizedRoute.ticketNumber;
  });
  if (matches.length !== 1) ticketError_('INTEGRITY_ERROR');
  var storedRoute = normalizeTicketRoute_(matches[0], normalizedRoute.ticketNumber);
  if (storedRoute.tokenDigest !== normalizedRoute.tokenDigest ||
      storedRoute.eventId !== normalizedRoute.eventId ||
      storedRoute.registrationId !== normalizedRoute.registrationId ||
      storedRoute.status !== normalizedRoute.status ||
      storedRoute.createdAt !== normalizedRoute.createdAt ||
      storedRoute.updatedAt !== normalizedRoute.updatedAt) {
    ticketError_('INTEGRITY_ERROR');
  }
  return {
    sheet: getRequiredSheet_(registry, '票券索引'),
    row: matches[0].rowNumber,
    values: normalizeRow_('票券索引', storedRoute),
    route: storedRoute
  };
}

function updateTicketRouteSnapshot_(registry, snapshot, changes) {
  var current = snapshot && snapshot.route;
  if (!current || !snapshot.sheet || !Number.isInteger(snapshot.row)) {
    ticketError_('INTEGRITY_ERROR');
  }
  var updated = {
    ticketNumber: current.ticketNumber,
    tokenDigest: changes && changes.tokenDigest !== undefined
      ? changes.tokenDigest : current.tokenDigest,
    eventId: current.eventId,
    registrationId: current.registrationId,
    status: changes && changes.status !== undefined ? changes.status : current.status,
    createdAt: current.createdAt,
    updatedAt: changes && changes.updatedAt !== undefined
      ? changes.updatedAt : current.updatedAt
  };
  updated = normalizeTicketRoute_(updated, current.ticketNumber);
  var digestCollision = readRows(registry, '票券索引').some(function(candidate) {
    return candidate.rowNumber !== snapshot.row &&
      String(candidate.tokenDigest || '').trim().toLowerCase() === updated.tokenDigest;
  });
  if (digestCollision) ticketError_('INTEGRITY_ERROR');
  snapshot.sheet.getRange(
    snapshot.row, 1, 1, SHEET_DEFINITIONS['票券索引'].length
  ).setValues([normalizeRow_('票券索引', updated)]);
  return updated;
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

function ticketSheetNameByHeader_(header) {
  var names = Object.keys(SHEET_DEFINITIONS || {}).filter(function(name) {
    return Array.isArray(SHEET_DEFINITIONS[name]) &&
      SHEET_DEFINITIONS[name].indexOf(header) !== -1;
  });
  if (names.length !== 1) ticketError_('INTERNAL');
  return names[0];
}
