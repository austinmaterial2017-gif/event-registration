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
        routeWriteAttempted = true;
        updateTicketRouteSnapshot_(registry, routeSnapshot, {
          status: 'cancelled',
          updatedAt: cancelledAt
        });
        auditSnapshot = appendTicketAudit_(spreadsheet, 'CANCEL_REGISTRATION', match.registrationId, {
          eventId: match.event.eventId
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

/**
 * Updates the sessions attached to one verified ticket.
 * The complete locked transaction is implemented by the ticket service.
 * @param {Object} payload
 * @return {Object} ApiResult<Ticket>
 */
function updateRegistrationSessions(payload) {
  return runTicketService_(function() {
    return withScriptLock(function() {
      var registry = getRegistrySpreadsheet_();
      requireNoSwitchMaintenance_(registry);
      var route = requireTicketNumberRoute_(registry, payload);
      requireActiveTicketRoute_(route);
      var spreadsheet = getEventSpreadsheet_(registry, route.eventId);
      var recoveryFailures = recoverPendingTransactions_(spreadsheet);
      if (recoveryFailures.length) ticketError_('INTEGRITY_ERROR');
      cleanupStaleTicketSeats_(spreadsheet);
      var registrationSheetName = ticketSheetNameByHeader_('sessionIds');
      var registrations = readRows(spreadsheet, registrationSheetName);
      var match = requireVerifiedTicket_(spreadsheet, registry, payload, registrations, route);
      var now = new Date();
      var event;
      try {
        event = requireOpenEvent_(spreadsheet, match.event.eventId, now);
      } catch (openError) {
        if (openError && (openError.publicCode === 'REGISTRATION_CLOSED' ||
            openError.publicCode === 'REGISTRATION_NOT_OPEN')) {
          ticketError_('REGISTRATION_UPDATE_CLOSED');
        }
        throw openError;
      }
      var sessionSheetName = ticketSheetNameByHeaders_(['sessionId', 'speaker', 'capacity']);
      var sessions = readRows(spreadsheet, sessionSheetName).filter(function(session) {
        var status = String(session.status || '').toLowerCase();
        return session.eventId === event.eventId && (status === 'active' || status === 'open');
      });
      var submittedIds = payload && Array.isArray(payload.sessionIds) ? payload.sessionIds : [];
      sessions.forEach(function(session) {
        if (registrationTruthy_(session.required) &&
            submittedIds.indexOf(session.sessionId) === -1) {
          ticketError_('REQUIRED_SESSION');
        }
      });
      var selectedSessions = validateSessionSelection_(
        event, sessions, payload && payload.sessionIds, match.policy
      );
      try {
        validateSessionCapacity_(selectedSessions, registrations.filter(function(record) {
          return record.registrationId !== match.registrationId;
        }));
      } catch (capacityError) {
        if (capacityError && capacityError.publicCode === 'REGISTRATION_FULL') {
          ticketError_('SESSION_FULL');
        }
        throw capacityError;
      }
      try {
        validateSessionConflicts_(selectedSessions);
      } catch (conflictError) {
        if (conflictError && conflictError.publicCode === 'INVALID_REQUEST') {
          ticketError_('SESSION_CONFLICT');
        }
        throw conflictError;
      }

      var targetById = {};
      selectedSessions.forEach(function(session) { targetById[session.sessionId] = true; });
      var currentById = {};
      match.records.forEach(function(record) {
        if (!REGISTRATION_ACTIVE_STATUSES[String(record.status || '').toLowerCase()]) return;
        parseStringArray_(record.sessionIds).forEach(function(sessionId) {
          currentById[sessionId] = record;
        });
      });
      var addedIds = Object.keys(targetById).filter(function(sessionId) { return !currentById[sessionId]; });
      var removedIds = Object.keys(currentById).filter(function(sessionId) { return !targetById[sessionId]; });
      sessions.forEach(function(session) {
        if (addedIds.indexOf(session.sessionId) === -1 &&
            removedIds.indexOf(session.sessionId) === -1) return;
        var startsAt = parseRegistrationDate_(session.startsAt);
        if (startsAt !== null && startsAt <= now.getTime()) ticketError_('SESSION_STARTED');
      });
      var attendanceSheetName = ticketOptionalSheetNameByHeaders_(
        ['checkInId', 'registrationId', 'sessionId', 'checkedInAt']
      );
      if (attendanceSheetName && readRows(spreadsheet, attendanceSheetName).some(function(record) {
        return record.registrationId === match.registrationId &&
          removedIds.indexOf(record.sessionId) !== -1 &&
          String(record.status || '').toLowerCase() !== 'cancelled';
      })) {
        ticketError_('SESSION_CHECKED_IN');
      }
      if (!addedIds.length && !removedIds.length) return ticketProjectionFromRecords_(match);

      var seatUpdate = prepareTicketSessionSeatUpdate_(
        match, selectedSessions, payload && payload.seatChoices,
        payload && payload.seatHoldOwner, now
      );
      var rowSnapshots = snapshotTicketRows_(spreadsheet, registrationSheetName, match.records);
      var seatSheetName = ticketSheetNameByHeader_('seatId');
      var seatSnapshots = snapshotTicketRows_(
        spreadsheet, seatSheetName, seatUpdate.currentSeats.concat(seatUpdate.newSeats)
      );
      var appendedRows = [];
      var auditSnapshot = null;
      try {
        var updatedAt = now.toISOString();
        seatUpdate.newSeats.forEach(function(seat) {
          claimExchangedSeat_(spreadsheet, seat, match.registrationId);
        });
        updateTicketRegistrationRows_(spreadsheet, match.records, function(record) {
          var recordIds = parseStringArray_(record.sessionIds);
          if (recordIds.some(function(sessionId) { return removedIds.indexOf(sessionId) !== -1; })) {
            record.status = 'cancelled';
            record.seatChoices = JSON.stringify([]);
            record.updatedAt = updatedAt;
          } else if (recordIds.length) {
            record.seatChoices = JSON.stringify(
              ticketSeatIdsForSession_(seatUpdate.targetSeats, recordIds[0])
            );
          }
          return record;
        });
        addedIds.forEach(function(sessionId) {
          var historical = match.records.filter(function(record) {
            return String(record.status || '').toLowerCase() === 'cancelled' &&
              parseStringArray_(record.sessionIds).indexOf(sessionId) !== -1;
          })[0];
          if (historical) {
            historical.status = 'active';
            historical.seatChoices = JSON.stringify(
              ticketSeatIdsForSession_(seatUpdate.targetSeats, sessionId)
            );
            historical.updatedAt = updatedAt;
            var historicalValues = normalizeRow_(registrationSheetName, historical);
            getRequiredSheet_(spreadsheet, registrationSheetName)
              .getRange(historical.rowNumber, 1, 1, historicalValues.length)
              .setValues([historicalValues]);
            return;
          }
          var source = match.records[0];
          var newRecord = {
            registrationId: match.registrationId,
            eventId: match.event.eventId,
            participantId: source.participantId,
            ticketNumber: match.ticketNumber,
            status: 'active',
            sessionIds: JSON.stringify([sessionId]),
            seatChoices: JSON.stringify(
              ticketSeatIdsForSession_(seatUpdate.targetSeats, sessionId)
            ),
            answers: source.answers,
            createdAt: updatedAt,
            updatedAt: updatedAt
          };
          var sheet = getRequiredSheet_(spreadsheet, registrationSheetName);
          var rowNumber = sheet.getLastRow() + 1;
          var values = normalizeRow_(registrationSheetName, newRecord);
          sheet.getRange(rowNumber, 1, 1, values.length).setValues([values]);
          appendedRows.push({ sheet: sheet, row: rowNumber });
        });
        releaseTicketSeats_(spreadsheet, seatUpdate.releasedSeats);
        auditSnapshot = appendTicketAudit_(spreadsheet, 'UPDATE_REGISTRATION_SESSIONS', match.registrationId, {
          addedSessionIds: addedIds,
          removedSessionIds: removedIds,
          addedSeatIds: seatUpdate.newSeats.map(function(seat) { return seat.seatId; }),
          releasedSeatIds: seatUpdate.releasedSeats.map(function(seat) { return seat.seatId; })
        });
        var refreshedRegistrations = readRows(spreadsheet, registrationSheetName);
        var refreshed = requireVerifiedTicket_(
          spreadsheet, registry, payload, refreshedRegistrations, route
        );
        return ticketProjectionFromRecords_(refreshed);
      } catch (error) {
        var restoreFailures = restoreTicketSnapshots_(rowSnapshots.concat(seatSnapshots));
        appendedRows.reverse().forEach(function(appended) {
          try {
            appended.sheet.deleteRow(appended.row);
          } catch (deleteError) {
            restoreFailures.push(deleteError);
          }
        });
        var auditRollbackFailure = rollbackTicketAudit_(auditSnapshot);
        if (auditRollbackFailure) restoreFailures.push(auditRollbackFailure);
        if (restoreFailures.length) {
          raiseTicketIntegrityError_(
            spreadsheet, match.registrationId, 'UPDATE_REGISTRATION_SESSIONS', restoreFailures
          );
        }
        throw error;
      }
    });
  });
}

function prepareTicketSessionSeatUpdate_(match, selectedSessions, submittedChoices, holdOwner, now) {
  var choices = Array.isArray(submittedChoices) ? submittedChoices : [];
  var seatMode = String(match.event.seatMode || 'none').toLowerCase();
  if (seatMode === 'none') {
    if (choices.length) ticketError_('INVALID_REQUEST');
    return { currentSeats: match.seats.slice(), targetSeats: [], newSeats: [], releasedSeats: match.seats.slice() };
  }
  if (!{ auto: true, self: true, zone: true }[seatMode]) ticketError_('INVALID_REQUEST');
  var selectedById = {};
  selectedSessions.forEach(function(session) { selectedById[session.sessionId] = true; });
  var currentSeats = match.seats.slice();
  var retained = currentSeats.filter(function(seat) {
    return !seat.sessionId || selectedById[seat.sessionId];
  });
  var released = currentSeats.filter(function(seat) { return retained.indexOf(seat) === -1; });
  var allSeats = match.allSeats.slice();
  allSeats.forEach(function(seat) { expireSeatHold_(seat, match.policy, now); });
  var newSeats = [];
  var used = {};
  retained.forEach(function(seat) { used[seat.seatId] = true; });

  function selectCandidate(sessionId) {
    var candidates = allSeats.filter(function(seat) {
      if (used[seat.seatId] || String(seat.sessionId || '') !== String(sessionId || '')) return false;
      if (seatMode === 'self' && choices.indexOf(seat.seatId) === -1 &&
          choices.indexOf(seat.label) === -1) return false;
      if (seatMode === 'zone' && choices.indexOf(seat.zone) === -1 &&
          choices.indexOf(seat.seatId) === -1) return false;
      return isSeatAvailableForRegistration_(seat, match.policy, String(holdOwner || ''), now);
    });
    var selected = candidates[0];
    if (!selected) ticketError_('SEAT_UNAVAILABLE');
    used[selected.seatId] = true;
    newSeats.push(selected);
  }

  var sharedRetained = retained.some(function(seat) { return !seat.sessionId; });
  var sharedAvailable = allSeats.some(function(seat) { return !seat.sessionId; });
  if (!sharedRetained && sharedAvailable) {
    selectCandidate('');
  } else if (!sharedRetained) {
    selectedSessions.forEach(function(session) {
      var alreadyRetained = retained.some(function(seat) {
        return seat.sessionId === session.sessionId;
      });
      if (!alreadyRetained) selectCandidate(session.sessionId);
    });
  }
  var targetSeats = retained.concat(newSeats);
  return {
    currentSeats: currentSeats,
    targetSeats: targetSeats,
    newSeats: newSeats,
    releasedSeats: released
  };
}

function ticketSeatIdsForSession_(seats, sessionId) {
  return seats.filter(function(seat) {
    return !seat.sessionId || seat.sessionId === sessionId;
  }).map(function(seat) { return seat.seatId; });
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
    REGISTRATION_UPDATE_CLOSED: '已超过报名修改期限。',
    REQUIRED_SESSION: '必选场次不能取消。',
    SESSION_STARTED: '已开始的场次不能取消。',
    SESSION_CHECKED_IN: '已签到的场次不能取消。',
    SESSION_FULL: '所选场次名额已满。',
    SESSION_CONFLICT: '所选场次时间冲突。',
    REGISTRATION_CHANGED: '报名资料已变化，请重新载入电子票。',
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
    spreadsheet: spreadsheet,
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
  var hasActive = records.some(function(record) {
    return REGISTRATION_ACTIVE_STATUSES[String(record.status || '').toLowerCase()];
  });
  var allKnown = records.every(function(record) {
    var status = String(record.status || '').toLowerCase();
    return REGISTRATION_ACTIVE_STATUSES[status] || status === 'cancelled';
  });
  if (hasActive && allKnown) {
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
    if (!REGISTRATION_ACTIVE_STATUSES[String(record.status || '').toLowerCase()]) return;
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
  var management = buildTicketSessionManagement_(match, new Date());
  var capabilities = ticketCapabilities_(match.status, match.policy);
  capabilities.canManageSessions = management.canManage;
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
    capabilities: capabilities,
    sessionManagement: management.projection,
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

function buildTicketSessionManagement_(match, now) {
  var eventStatus = String(match.event.status || '').toLowerCase();
  var closesAt = parseRegistrationDate_(match.event.closesAt);
  var canManage = match.status === 'active' && eventStatus === 'open' &&
    (closesAt === null || now.getTime() < closesAt);
  var selected = {};
  match.sessions.forEach(function(session) { selected[session.sessionId] = true; });
  var sessionSheetName = ticketSheetNameByHeaders_(['sessionId', 'speaker', 'capacity']);
  var sessions = readRows(match.spreadsheet, sessionSheetName).filter(function(session) {
    var status = String(session.status || '').toLowerCase();
    return session.eventId === match.event.eventId && (status === 'active' || status === 'open');
  });
  var activeRegistrations = readRows(
    match.spreadsheet, ticketSheetNameByHeader_('sessionIds')
  ).filter(function(record) {
    return record.registrationId !== match.registrationId &&
      REGISTRATION_ACTIVE_STATUSES[String(record.status || '').toLowerCase()];
  });
  var ownedSeats = {};
  match.seats.forEach(function(seat) { ownedSeats[seat.seatId] = true; });
  var checkedInSessions = {};
  var attendanceSheetName = ticketOptionalSheetNameByHeaders_(
    ['checkInId', 'registrationId', 'sessionId', 'checkedInAt']
  );
  if (attendanceSheetName) {
    readRows(match.spreadsheet, attendanceSheetName).forEach(function(record) {
      if (record.registrationId === match.registrationId &&
          String(record.status || '').toLowerCase() !== 'cancelled') {
        checkedInSessions[record.sessionId] = true;
      }
    });
  }
  var projectedSessions = sessions.map(function(session) {
    var disabledReason = '';
    var startsAt = parseRegistrationDate_(session.startsAt);
    if (selected[session.sessionId] && registrationTruthy_(session.required)) {
      disabledReason = '必选场次';
    } else if (selected[session.sessionId] && checkedInSessions[session.sessionId]) {
      disabledReason = '已经签到';
    } else if (startsAt !== null && startsAt <= now.getTime()) {
      disabledReason = '场次已经开始';
    } else if (!selected[session.sessionId]) {
      var capacity = Number(session.capacity || 0);
      if (capacity > 0) {
        var counted = {};
        activeRegistrations.forEach(function(record) {
          if (parseStringArray_(record.sessionIds).indexOf(session.sessionId) !== -1) {
            counted[record.registrationId] = true;
          }
        });
        if (Object.keys(counted).length >= capacity) disabledReason = '场次名额已满';
      }
    }
    return {
      sessionId: session.sessionId,
      title: session.title,
      speaker: session.speaker,
      startsAt: session.startsAt,
      endsAt: session.endsAt,
      location: session.location || match.event.location,
      selected: !!selected[session.sessionId],
      required: registrationTruthy_(session.required),
      disabledReason: disabledReason,
      seats: match.allSeats.filter(function(seat) {
        return !seat.sessionId || seat.sessionId === session.sessionId;
      }).map(function(seat) {
        var owned = !!ownedSeats[seat.seatId];
        return {
          seatId: seat.seatId,
          label: seat.label,
          zone: seat.zone,
          selected: owned,
          available: owned || isSeatAvailableForRegistration_(
            seat, match.policy, '', now
          )
        };
      }).filter(function(seat) { return seat.selected || seat.available; })
    };
  });
  return {
    canManage: canManage,
    projection: {
      closesAt: match.event.closesAt || '',
      selectionMode: match.event.selectionMode || 'free',
      minChoices: Number(match.event.minChoices || 0),
      maxChoices: Number(match.event.maxChoices || projectedSessions.length),
      seatMode: match.event.seatMode || 'none',
      sessions: canManage ? projectedSessions : []
    }
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

function ticketSheetNameByHeaders_(headers) {
  var required = Array.isArray(headers) ? headers : [];
  var names = Object.keys(SHEET_DEFINITIONS || {}).filter(function(name) {
    return Array.isArray(SHEET_DEFINITIONS[name]) && required.every(function(header) {
      return SHEET_DEFINITIONS[name].indexOf(header) !== -1;
    });
  });
  if (!required.length || names.length !== 1) ticketError_('INTERNAL');
  return names[0];
}

function ticketOptionalSheetNameByHeaders_(headers) {
  var required = Array.isArray(headers) ? headers : [];
  var names = Object.keys(SHEET_DEFINITIONS || {}).filter(function(name) {
    return Array.isArray(SHEET_DEFINITIONS[name]) && required.every(function(header) {
      return SHEET_DEFINITIONS[name].indexOf(header) !== -1;
    });
  });
  if (!required.length || names.length > 1) ticketError_('INTERNAL');
  return names[0] || '';
}
