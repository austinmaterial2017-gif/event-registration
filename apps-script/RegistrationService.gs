var REGISTRATION_ACTIVE_STATUSES = { active: true, confirmed: true };

/**
 * Atomically validates and creates a participant registration.
 * @param {Object} payload
 * @return {Object} ApiResult<Ticket>
 */
function createRegistration(payload) {
  return runRegistrationService_(function() {
    return withScriptLock(function() {
      var request = requireRegistrationPayload_(payload);
      var registry = getRegistrySpreadsheet_();
      requireNoSwitchMaintenance_(registry);
      var spreadsheet = getConfiguredSpreadsheet(registry);
      var recoveryFailures = recoverPendingTransactions_(spreadsheet);
      if (recoveryFailures.length) registrationError_('INTEGRITY_ERROR');
      cleanupStaleTicketSeats_(spreadsheet);
      var now = new Date();
      var event = requireOpenEvent_(spreadsheet, request.eventId, now);
      var settings = getAdminSettings(registry);
      var policy = getRegistrationPolicy_(settings, event.eventId);
      var questions = readRows(spreadsheet, '报名问题').filter(function(question) {
        return question.eventId === event.eventId && question.status !== 'inactive';
      });
      var sessions = readRows(spreadsheet, '场次').filter(function(session) {
        var status = String(session.status || '').toLowerCase();
        return session.eventId === event.eventId && (status === 'active' || status === 'open');
      });
      var registrations = readRows(spreadsheet, '报名项目');
      var answers = validateDynamicAnswers_(questions, request.answers);
      var selectedSessions = validateSessionSelection_(event, sessions, request.sessionIds, policy);

      validateSessionCapacity_(selectedSessions, registrations);
      validateDuplicateIdentity_(policy.identityFields, answers, registrations, event.eventId);
      validateSessionConflicts_(selectedSessions);

      var seats = readRows(spreadsheet, '座位').filter(function(seat) { return seat.eventId === event.eventId; });
      var selectedSeats = selectRegistrationSeats_(
        event,
        policy,
        selectedSessions,
        seats,
        request.seatChoices,
        request.seatHoldOwner,
        now
      );
      var expiredSeats = seats.filter(function(seat) {
        return seat.expiredHold === true && selectedSeats.indexOf(seat) === -1;
      });

      var registrationId = Utilities.getUuid();
      var participantId = Utilities.getUuid();
      var ticketNumber = 'EVT-' + Utilities.getUuid().replace(/-/g, '').slice(0, 10).toUpperCase();
      var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
      var createdAt = now.toISOString();
      var seatSnapshots = snapshotSeatRows_(spreadsheet, selectedSeats.concat(expiredSeats));
      var participant = null;
      var registrationBatch = null;

      try {
        participant = appendParticipantRow_(spreadsheet, participantId, answers, policy, createdAt);
        var rowsToWrite = selectedSessions.length ? selectedSessions : [null];
        registrationBatch = appendRegistrationRows_(
          spreadsheet,
          registrationId,
          participantId,
          event.eventId,
          ticketNumber,
          rowsToWrite,
          selectedSeats,
          answers,
          token,
          policy,
          questions,
          createdAt
        );
        clearExpiredSeatHolds_(spreadsheet, expiredSeats, createdAt);
        claimPendingRegistrationSeats_(spreadsheet, selectedSeats, registrationId, createdAt);
        activateRegistrationRows_(registrationBatch);
      } catch (error) {
        var cleanupFailures = cleanupPendingRegistration_(
          seatSnapshots,
          participant,
          registrationBatch
        );
        if (cleanupFailures.length) {
          raiseRegistrationIntegrityError_(spreadsheet, registrationId, cleanupFailures);
        }
        throw error;
      }

      var finalizeFailures = finalizePendingRegistrationSeats_(spreadsheet, selectedSeats, registrationId, createdAt);
      if (finalizeFailures.length) {
        appendRegistrationRecoveryAudit_(spreadsheet, 'SEAT_FINALIZE_RETRY', registrationId, finalizeFailures.length);
      }
      appendRegistrationAuditSafely_(spreadsheet, 'CREATE_REGISTRATION', registrationId, {
        eventId: event.eventId,
        sessionCount: selectedSessions.length,
        seatCount: selectedSeats.length
      });
      return registrationTicketProjection_(
        event,
        registrationId,
        ticketNumber,
        token,
        'active',
        participant.values,
        selectedSessions,
        selectedSeats,
        seats,
        policy,
        buildStoredTicketFields_(questions, answers, policy),
        createdAt
      );
    });
  });
}

/**
 * Temporarily reserves one selectable seat for a browser-scoped opaque owner.
 * The hold and registration claim use the same public-project script lock.
 */
function createSeatHold(payload) {
  return runRegistrationService_(function() {
    return withScriptLock(function() {
      var request = requireSeatHoldPayload_(payload);
      var registry = getRegistrySpreadsheet_();
      requireNoSwitchMaintenance_(registry);
      var spreadsheet = getEventSpreadsheet_(registry, request.eventId);
      var now = new Date();
      var event = requireOpenEvent_(spreadsheet, request.eventId, now);
      var policy = getRegistrationPolicy_(getAdminSettings(registry), event.eventId);
      if (!policy.seatHoldsEnabled) registrationError_('SEAT_HOLD_DISABLED');
      if (String(event.seatMode || '').toLowerCase() !== 'self') {
        registrationError_('SEAT_HOLD_DISABLED');
      }
      var sheetName = registrationSheetNameByHeader_('seatId');
      var seat = readRows(spreadsheet, sheetName).filter(function(candidate) {
        return candidate.eventId === event.eventId &&
          (candidate.seatId === request.seatId || candidate.label === request.seatId);
      })[0];
      if (!seat) registrationError_('SEAT_UNAVAILABLE');
      expireSeatHold_(seat, policy, now);
      var existingHold = parseSeatHold_(seat);
      var available = (String(seat.status || 'available').toLowerCase() === 'available' ||
        String(seat.status || '').toLowerCase() === 'open') &&
        !seat.holderRegistrationId;
      if (!available && (!existingHold || existingHold.holdOwner !== request.holdOwner ||
          existingHold.holdExpiresAt <= now.getTime())) {
        registrationError_('SEAT_UNAVAILABLE');
      }
      var expiresAtMs = now.getTime() + policy.seatHoldMinutes * 60000;
      writeSeatHoldState_(
        spreadsheet,
        sheetName,
        seat,
        'held',
        'HOLD|' + request.holdOwner + '|' + expiresAtMs,
        now.toISOString()
      );
      appendRegistrationAuditSafely_(spreadsheet, 'CREATE_SEAT_HOLD', seat.seatId, {
        eventId: event.eventId,
        expiresAt: new Date(expiresAtMs).toISOString()
      });
      return {
        seatId: String(seat.seatId || ''),
        holdOwner: request.holdOwner,
        expiresAt: new Date(expiresAtMs).toISOString(),
        serverNow: now.toISOString()
      };
    });
  });
}

/** Releases only a hold owned by the submitted browser-scoped owner. */
function releaseSeatHold(payload) {
  return runRegistrationService_(function() {
    return withScriptLock(function() {
      var request = requireSeatHoldPayload_(payload);
      var registry = getRegistrySpreadsheet_();
      requireNoSwitchMaintenance_(registry);
      var spreadsheet = getEventSpreadsheet_(registry, request.eventId);
      var policy = getRegistrationPolicy_(getAdminSettings(registry), request.eventId);
      var sheetName = registrationSheetNameByHeader_('seatId');
      var seat = readRows(spreadsheet, sheetName).filter(function(candidate) {
        return candidate.eventId === request.eventId &&
          (candidate.seatId === request.seatId || candidate.label === request.seatId);
      })[0];
      if (!seat) registrationError_('SEAT_UNAVAILABLE');
      var hold = parseSeatHold_(seat);
      if (!hold) return { seatId: String(seat.seatId || ''), released: false };
      var now = new Date();
      if (hold.holdOwner !== request.holdOwner && hold.holdExpiresAt > now.getTime()) {
        registrationError_('SEAT_HOLD_OWNERSHIP');
      }
      writeSeatHoldState_(
        spreadsheet, sheetName, seat, 'available', '', now.toISOString()
      );
      appendRegistrationAuditSafely_(spreadsheet, 'RELEASE_SEAT_HOLD', seat.seatId, {
        eventId: request.eventId
      });
      return { seatId: String(seat.seatId || ''), released: true };
    });
  });
}

function runRegistrationService_(callback) {
  try {
    return { ok: true, data: callback() };
  } catch (error) {
    var code = error && error.publicCode ? error.publicCode : 'INTERNAL';
    return registrationFailure_(code);
  }
}

function registrationFailure_(code) {
  var allowed = {
    SEAT_HOLD_DISABLED: 'Seat holds are not enabled for this event.',
    SEAT_HOLD_OWNERSHIP: 'This seat hold belongs to another browser session.',
    EVENT_NOT_FOUND: '未找到该活动。',
    INVALID_REQUEST: '提交信息无效，请检查后重试。',
    REGISTRATION_CLOSED: '报名已截止。',
    REGISTRATION_FULL: '报名名额已满。',
    REGISTRATION_NOT_OPEN: '报名尚未开放。',
    DUPLICATE_REGISTRATION: '相同身份信息已报名。',
    SEAT_UNAVAILABLE: '所选座位不可用。',
    INTEGRITY_ERROR: '数据一致性检查失败，请联系管理员。',
    MAINTENANCE: '系统正在切换数据连接，请稍后重试。',
    INTERNAL: '请求未能完成，请稍后重试。'
  };
  var safeCode = Object.prototype.hasOwnProperty.call(allowed, code) ? code : 'INTERNAL';
  return { ok: false, code: safeCode, message: allowed[safeCode] };
}

function registrationError_(code) {
  var error = new Error(code);
  error.publicCode = code;
  throw error;
}

function requireRegistrationPayload_(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) registrationError_('INVALID_REQUEST');
  if (typeof payload.eventId !== 'string' || !payload.eventId.trim()) registrationError_('INVALID_REQUEST');
  if (payload.answers && (typeof payload.answers !== 'object' || Array.isArray(payload.answers))) {
    registrationError_('INVALID_REQUEST');
  }
  return {
    eventId: payload.eventId.trim(),
    sessionIds: payload.sessionIds === undefined ? [] : payload.sessionIds,
    seatChoices: payload.seatChoices === undefined ? [] : payload.seatChoices,
    answers: payload.answers || {},
    seatHoldOwner: typeof payload.seatHoldOwner === 'string' ? payload.seatHoldOwner : ''
  };
}

function requireOpenEvent_(spreadsheet, eventId, now) {
  var event = readRows(spreadsheet, '活动').filter(function(candidate) {
    return candidate.eventId === eventId;
  })[0];
  if (!event) registrationError_('EVENT_NOT_FOUND');
  if (event.status !== 'open') {
    registrationError_(event.status === 'upcoming' ? 'REGISTRATION_NOT_OPEN' : 'REGISTRATION_CLOSED');
  }
  var nowMs = now.getTime();
  var opensAt = parseRegistrationDate_(event.opensAt);
  var closesAt = parseRegistrationDate_(event.closesAt);
  if (hasRegistrationValue_(event.opensAt) && opensAt === null) registrationError_('INVALID_REQUEST');
  if (hasRegistrationValue_(event.closesAt) && closesAt === null) registrationError_('INVALID_REQUEST');
  if (opensAt !== null && nowMs < opensAt) registrationError_('REGISTRATION_NOT_OPEN');
  if (closesAt !== null && nowMs >= closesAt) registrationError_('REGISTRATION_CLOSED');
  return event;
}

function validateDynamicAnswers_(questions, submittedAnswers) {
  var answers = submittedAnswers || {};
  var normalized = {};
  var supportedTypes = {
    text: true, textarea: true, number: true, tel: true, email: true,
    date: true, radio: true, checkbox: true, select: true, boolean: true
  };

  questions.forEach(function(question) {
    var type = String(question.type || '').toLowerCase();
    if (!supportedTypes[type]) registrationError_('INVALID_REQUEST');
    var value = answers[question.questionId];
    var required = registrationTruthy_(question.required);
    var missing = value === undefined || value === null ||
      (typeof value === 'string' && !value.trim()) ||
      (Array.isArray(value) && value.length === 0) ||
      (type === 'boolean' && value !== true);
    if (required && missing) registrationError_('INVALID_REQUEST');
    if (missing) {
      normalized[question.questionId] = type === 'checkbox' ? [] : '';
      return;
    }

    var constraints = parseQuestionOptions_(question.options);
    if (type === 'number') {
      if (typeof value === 'string') {
        var numericText = value.trim();
        if (!/^-?(?:\d+|\d*\.\d+)(?:[eE][+-]?\d+)?$/.test(numericText)) registrationError_('INVALID_REQUEST');
        value = Number(numericText);
      }
      if (typeof value !== 'number' || !isFinite(value)) registrationError_('INVALID_REQUEST');
      if (constraints.min !== undefined && value < Number(constraints.min)) registrationError_('INVALID_REQUEST');
      if (constraints.max !== undefined && value > Number(constraints.max)) registrationError_('INVALID_REQUEST');
    } else if (type === 'checkbox') {
      if (!Array.isArray(value) || value.some(function(item) { return typeof item !== 'string'; })) {
        registrationError_('INVALID_REQUEST');
      }
      var uniqueValues = {};
      value.forEach(function(item) {
        if (uniqueValues[item]) registrationError_('INVALID_REQUEST');
        uniqueValues[item] = true;
      });
      validateChoiceValues_(value, constraints);
      var minimumSelections = registrationConstraintInteger_(constraints.minSelections);
      var maximumSelections = registrationConstraintInteger_(constraints.maxSelections);
      if (minimumSelections !== null && value.length < minimumSelections) registrationError_('INVALID_REQUEST');
      if (maximumSelections !== null && value.length > maximumSelections) registrationError_('INVALID_REQUEST');
      if (minimumSelections !== null && maximumSelections !== null &&
          minimumSelections > maximumSelections) registrationError_('INVALID_REQUEST');
    } else if (type === 'boolean') {
      if (typeof value !== 'boolean') registrationError_('INVALID_REQUEST');
    } else {
      if (typeof value !== 'string') registrationError_('INVALID_REQUEST');
      var trimmed = value.trim();
      if (type === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) registrationError_('INVALID_REQUEST');
      if (type === 'tel' && !/^[+()\-\s0-9]{6,30}$/.test(trimmed)) registrationError_('INVALID_REQUEST');
      if (type === 'date' && parseRegistrationDate_(trimmed) === null) registrationError_('INVALID_REQUEST');
      if (constraints.minLength !== undefined && trimmed.length < Number(constraints.minLength)) registrationError_('INVALID_REQUEST');
      if (constraints.maxLength !== undefined && trimmed.length > Number(constraints.maxLength)) registrationError_('INVALID_REQUEST');
      if (constraints.pattern) {
        try {
          if (!(new RegExp(constraints.pattern)).test(trimmed)) registrationError_('INVALID_REQUEST');
        } catch (_invalidPattern) {
          registrationError_('INVALID_REQUEST');
        }
      }
      if (type === 'radio' || type === 'select') validateChoiceValues_([trimmed], constraints);
      value = trimmed;
    }
    normalized[question.questionId] = value;
  });
  return normalized;
}

function validateSessionSelection_(event, sessions, submittedSessionIds, policy) {
  if (!Array.isArray(submittedSessionIds)) registrationError_('INVALID_REQUEST');
  var seen = {};
  var selected = submittedSessionIds.map(function(sessionId) {
    if (typeof sessionId !== 'string' || !sessionId.trim() || seen[sessionId]) registrationError_('INVALID_REQUEST');
    seen[sessionId] = true;
    var session = sessions.filter(function(candidate) { return candidate.sessionId === sessionId; })[0];
    if (!session) registrationError_('INVALID_REQUEST');
    return session;
  });

  var selectionMode = String(event.selectionMode || 'free').toLowerCase();
  var allowedSelectionModes = { none: true, single: true, all: true, free: true, mixed: true, multiple: true };
  if (!allowedSelectionModes[selectionMode]) registrationError_('INVALID_REQUEST');
  if (selectionMode === 'none' && selected.length) registrationError_('INVALID_REQUEST');
  if (selectionMode === 'single' && selected.length !== 1) registrationError_('INVALID_REQUEST');
  if (selectionMode === 'all' && selected.length !== sessions.length) registrationError_('INVALID_REQUEST');
  var minChoices = registrationNumber_(event.minChoices, 0);
  var maxChoices = registrationNumber_(event.maxChoices, sessions.length);
  if (selected.length < minChoices || selected.length > maxChoices) registrationError_('INVALID_REQUEST');
  sessions.forEach(function(session) {
    if (registrationTruthy_(session.required) && !seen[session.sessionId]) registrationError_('INVALID_REQUEST');
  });
  validateSessionGroups_(sessions, seen, policy);
  return selected;
}

function validateSessionGroups_(sessions, selectedById, policy) {
  var sessionPolicies = policy && policy.sessions && typeof policy.sessions === 'object'
    ? policy.sessions : {};
  var groups = {};
  sessions.forEach(function(session) {
    var sessionPolicy = sessionPolicies[session.sessionId] &&
      typeof sessionPolicies[session.sessionId] === 'object'
      ? sessionPolicies[session.sessionId] : {};
    var rule = registrationGroupRule_(sessionPolicy.groupRule);
    if (!rule) return;
    if (!groups[rule.id]) {
      groups[rule.id] = { min: rule.min, max: rule.max, selected: 0 };
    } else if (groups[rule.id].min !== rule.min || groups[rule.id].max !== rule.max) {
      registrationError_('INVALID_REQUEST');
    }
    if (selectedById[session.sessionId]) groups[rule.id].selected += 1;
  });
  Object.keys(groups).forEach(function(groupId) {
    var group = groups[groupId];
    if (group.selected < group.min || group.selected > group.max) {
      registrationError_('INVALID_REQUEST');
    }
  });
}

function registrationGroupRule_(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    var text = value.trim();
    return text ? { id: text, min: 0, max: 1 } : null;
  }
  if (typeof value !== 'object' || Array.isArray(value)) registrationError_('INVALID_REQUEST');
  var id = String(value.id || value.groupId || '').trim();
  var min = registrationConstraintInteger_(value.min);
  var max = registrationConstraintInteger_(value.max);
  if (!id) registrationError_('INVALID_REQUEST');
  if (min === null) min = 0;
  if (max === null) max = 1;
  if (min > max) registrationError_('INVALID_REQUEST');
  return { id: id, min: min, max: max };
}

function validateSessionCapacity_(selectedSessions, registrations) {
  selectedSessions.forEach(function(session) {
    var capacity = registrationNumber_(session.capacity, 0);
    if (capacity <= 0) return;
    var counted = {};
    registrations.forEach(function(registration) {
      if (!REGISTRATION_ACTIVE_STATUSES[String(registration.status || '').toLowerCase()]) return;
      var sessionIds = parseStringArray_(registration.sessionIds);
      if (sessionIds.indexOf(session.sessionId) !== -1) counted[registration.registrationId] = true;
    });
    if (Object.keys(counted).length >= capacity) registrationError_('REGISTRATION_FULL');
  });
}

function validateDuplicateIdentity_(identityFields, answers, registrations, eventId) {
  var fields = Array.isArray(identityFields) ? identityFields.filter(function(field) {
    return typeof field === 'string' && field.trim();
  }) : [];
  if (!fields.length) return;
  var identity = fields.map(function(field) {
    if (answers[field] === undefined || answers[field] === null || String(answers[field]).trim() === '') {
      registrationError_('INVALID_REQUEST');
    }
    return normalizeIdentityValue_(answers[field]);
  });

  var duplicate = registrations.some(function(registration) {
    if (registration.eventId !== eventId ||
        !REGISTRATION_ACTIVE_STATUSES[String(registration.status || '').toLowerCase()]) return false;
    var stored = parseStoredRegistrationAnswers_(registration.answers).values;
    return fields.every(function(field, index) {
      return normalizeIdentityValue_(stored[field]) === identity[index];
    });
  });
  if (duplicate) registrationError_('DUPLICATE_REGISTRATION');
}

function validateSessionConflicts_(selectedSessions) {
  var intervals = selectedSessions.map(function(session) {
    var startsAt = parseRegistrationDate_(session.startsAt);
    var endsAt = parseRegistrationDate_(session.endsAt);
    if (startsAt === null || endsAt === null || endsAt <= startsAt) registrationError_('INVALID_REQUEST');
    return { startsAt: startsAt, endsAt: endsAt };
  }).sort(function(left, right) { return left.startsAt - right.startsAt; });
  for (var index = 1; index < intervals.length; index += 1) {
    if (intervals[index].startsAt < intervals[index - 1].endsAt) registrationError_('INVALID_REQUEST');
  }
}

function selectRegistrationSeats_(event, policy, selectedSessions, seats, submittedChoices, holdOwner, now) {
  if (!Array.isArray(submittedChoices)) registrationError_('INVALID_REQUEST');
  var seatMode = String(event.seatMode || 'none').toLowerCase();
  if (!{ none: true, auto: true, self: true, zone: true }[seatMode]) registrationError_('INVALID_REQUEST');
  if (seatMode === 'none') {
    if (submittedChoices.length) registrationError_('INVALID_REQUEST');
    return [];
  }
  seats.forEach(function(seat) { expireSeatHold_(seat, policy, now); });
  var sharedSeats = seats.filter(function(seat) { return !seat.sessionId; });
  var sessionGroups = selectedSessions.map(function(session) {
    return {
      sessionId: session.sessionId,
      seats: seats.filter(function(seat) { return seat.sessionId === session.sessionId; })
    };
  });
  var chosen = [];
  var used = {};
  var choices = submittedChoices.slice();
  var groupCount = sessionGroups.length || 1;
  if ((seatMode === 'self' || seatMode === 'zone') &&
      choices.length !== 1 && choices.length !== groupCount) registrationError_('INVALID_REQUEST');

  if (sharedSeats.length && choices.length <= 1) {
    var sharedChoice = choices[0];
    var sharedCandidate = sharedSeats.filter(function(seat) {
      if (seatMode === 'self' && seat.seatId !== sharedChoice && seat.label !== sharedChoice) return false;
      if (seatMode === 'zone' && seat.zone !== sharedChoice) return false;
      return isSeatAvailableForRegistration_(seat, policy, holdOwner, now);
    })[0];
    if (sharedCandidate) return [sharedCandidate];
  }

  if (!sessionGroups.length) registrationError_('SEAT_UNAVAILABLE');

  for (var index = 0; index < sessionGroups.length; index += 1) {
    var group = sessionGroups[index];
    var choice = choices.length === 1 ? choices[0] : choices[index];
    var candidate = group.seats.filter(function(seat) {
      if (used[seat.seatId]) return false;
      if (seatMode === 'self' && seat.seatId !== choice && seat.label !== choice) return false;
      if (seatMode === 'zone' && seat.zone !== choice) return false;
      return isSeatAvailableForRegistration_(seat, policy, holdOwner, now);
    })[0];
    if (!candidate) registrationError_('SEAT_UNAVAILABLE');
    used[candidate.seatId] = true;
    chosen.push(candidate);
  }
  return chosen;
}

function isSeatAvailableForRegistration_(seat, policy, holdOwner, now) {
  var status = String(seat.status || 'available').toLowerCase();
  if (status === 'pending') return false;
  if ((status === 'available' || status === 'open') && !seat.holderRegistrationId) return true;
  if (status !== 'held' || !policy.seatHoldsEnabled) return false;
  var hold = parseSeatHold_(seat);
  return !!hold && hold.holdOwner === holdOwner && hold.holdExpiresAt > now.getTime();
}

function expireSeatHold_(seat, policy, now) {
  if (String(seat.status || '').toLowerCase() !== 'held' || !policy.seatHoldsEnabled) return;
  var hold = parseSeatHold_(seat);
  if (hold && hold.holdExpiresAt !== null && hold.holdExpiresAt <= now.getTime()) {
    seat.expiredHoldSnapshot = {
      seatId: seat.seatId, eventId: seat.eventId, sessionId: seat.sessionId,
      label: seat.label, zone: seat.zone, status: seat.status,
      holderRegistrationId: seat.holderRegistrationId,
      createdAt: seat.createdAt, updatedAt: seat.updatedAt
    };
    seat.status = 'available';
    seat.holderRegistrationId = '';
    seat.expiredHold = true;
  }
}

function parseSeatHold_(seat) {
  if (seat.holdOwner && seat.holdExpiresAt) {
    return { holdOwner: String(seat.holdOwner), holdExpiresAt: parseRegistrationDate_(seat.holdExpiresAt) };
  }
  var match = /^HOLD\|([^|]+)\|(\d+)$/.exec(String(seat.holderRegistrationId || ''));
  return match ? { holdOwner: match[1], holdExpiresAt: Number(match[2]) } : null;
}

function getRegistrationPolicy_(settings, eventId) {
  var registration = settings && settings.registration && typeof settings.registration === 'object'
    ? settings.registration : {};
  var eventSettings = registration.events && registration.events[eventId] &&
    typeof registration.events[eventId] === 'object' ? registration.events[eventId] : {};
  return {
    identityFields: Array.isArray(eventSettings.identityFields) ? eventSettings.identityFields :
      (Array.isArray(registration.identityFields) ? registration.identityFields : []),
    verificationField: eventSettings.verificationField || registration.verificationField || '',
    seatHoldsEnabled: eventSettings.seatHoldsEnabled === true || registration.seatHoldsEnabled === true,
    seatExchangeEnabled: eventSettings.seatExchangeEnabled === true,
    cancellationEnabled: eventSettings.cancellationEnabled === true,
    seatHoldMinutes: registrationPositiveNumber_(
      eventSettings.seatHoldMinutes !== undefined
        ? eventSettings.seatHoldMinutes : registration.seatHoldMinutes,
      5
    ),
    fieldRoles: eventSettings.fieldRoles && typeof eventSettings.fieldRoles === 'object' &&
      !Array.isArray(eventSettings.fieldRoles) ? eventSettings.fieldRoles : {},
    showOnTicketFields: Array.isArray(eventSettings.showOnTicketFields)
      ? eventSettings.showOnTicketFields : [],
    sessions: eventSettings.sessions && typeof eventSettings.sessions === 'object' &&
      !Array.isArray(eventSettings.sessions) ? eventSettings.sessions : {}
  };
}

function appendParticipantRow_(spreadsheet, participantId, answers, policy, createdAt) {
  answers = registrationAnswersWithRoles_(answers, policy);
  var sheet = getRequiredSheet_(spreadsheet, '参加者');
  var values = normalizeRow_('参加者', {
    participantId: participantId,
    name: firstAnswer_(answers, ['name', '姓名']),
    phone: firstAnswer_(answers, ['phone', '电话', '手机']),
    email: firstAnswer_(answers, ['email', '邮箱']),
    createdAt: createdAt,
    updatedAt: createdAt
  });
  var rowNumber = sheet.getLastRow() + 1;
  sheet.getRange(rowNumber, 1, 1, values.length).setValues([values]);
  return { sheet: sheet, rowNumber: rowNumber, values: values };
}

function appendRegistrationRows_(spreadsheet, registrationId, participantId, eventId, ticketNumber,
  sessions, selectedSeats, answers, token, policy, questions, createdAt) {
  var sheet = getRequiredSheet_(spreadsheet, '报名项目');
  var storedAnswers = JSON.stringify({
    values: answers,
    ticketToken: token,
    verificationField: policy.verificationField || (policy.identityFields[0] || ''),
    ticketFields: buildStoredTicketFields_(questions, answers, policy),
    transactionId: registrationId
  });
  var pendingRows = sessions.map(function(session) {
    var sessionId = session ? session.sessionId : '';
    var seatIds = selectedSeats.filter(function(seat) {
      return !sessionId || !seat.sessionId || seat.sessionId === sessionId;
    }).map(function(seat) { return seat.seatId; });
    return normalizeRow_('报名项目', {
      registrationId: registrationId,
      eventId: eventId,
      participantId: participantId,
      ticketNumber: ticketNumber,
      status: 'pending',
      sessionIds: JSON.stringify(session ? [sessionId] : []),
      seatChoices: JSON.stringify(seatIds),
      answers: storedAnswers,
      createdAt: createdAt,
      updatedAt: createdAt
    });
  });
  var activeRows = pendingRows.map(function(row) {
    var active = row.slice();
    active[4] = 'active';
    return active;
  });
  var rowNumber = sheet.getLastRow() + 1;
  sheet.getRange(rowNumber, 1, pendingRows.length, pendingRows[0].length).setValues(pendingRows);
  return {
    sheet: sheet,
    rowNumber: rowNumber,
    rowCount: pendingRows.length,
    activeRows: activeRows
  };
}

function activateRegistrationRows_(batch) {
  batch.sheet.getRange(batch.rowNumber, 1, batch.rowCount, batch.activeRows[0].length)
    .setValues(batch.activeRows);
}

function claimPendingRegistrationSeats_(spreadsheet, seats, registrationId, updatedAt) {
  if (!seats.length) return;
  var sheet = getRequiredSheet_(spreadsheet, '座位');
  seats.forEach(function(seat) {
    var values = normalizeRow_('座位', {
      seatId: seat.seatId,
      eventId: seat.eventId,
      sessionId: seat.sessionId,
      label: seat.label,
      zone: seat.zone,
      status: 'pending',
      holderRegistrationId: 'PENDING|' + registrationId,
      createdAt: seat.createdAt,
      updatedAt: updatedAt
    });
    sheet.getRange(seat.rowNumber, 1, 1, values.length).setValues([values]);
  });
}

function finalizePendingRegistrationSeats_(spreadsheet, seats, registrationId, updatedAt) {
  var failures = [];
  if (!seats.length) return failures;
  var sheet = getRequiredSheet_(spreadsheet, '座位');
  seats.forEach(function(seat) {
    try {
      var values = normalizeRow_('座位', {
        seatId: seat.seatId,
        eventId: seat.eventId,
        sessionId: seat.sessionId,
        label: seat.label,
        zone: seat.zone,
        status: 'registered',
        holderRegistrationId: registrationId,
        createdAt: seat.createdAt,
        updatedAt: updatedAt
      });
      sheet.getRange(seat.rowNumber, 1, 1, values.length).setValues([values]);
    } catch (error) {
      failures.push(error);
    }
  });
  return failures;
}

function clearExpiredSeatHolds_(spreadsheet, seats, updatedAt) {
  if (!seats.length) return;
  var sheet = getRequiredSheet_(spreadsheet, '座位');
  seats.forEach(function(seat) {
    var values = normalizeRow_('座位', {
      seatId: seat.seatId,
      eventId: seat.eventId,
      sessionId: seat.sessionId,
      label: seat.label,
      zone: seat.zone,
      status: 'available',
      holderRegistrationId: '',
      createdAt: seat.createdAt,
      updatedAt: updatedAt
    });
    sheet.getRange(seat.rowNumber, 1, 1, values.length).setValues([values]);
  });
}

function snapshotSeatRows_(spreadsheet, seats) {
  if (!seats.length) return [];
  var sheet = getRequiredSheet_(spreadsheet, '座位');
  return seats.map(function(seat) {
    return {
      sheet: sheet,
      rowNumber: seat.rowNumber,
      values: normalizeRow_('座位', seat.expiredHoldSnapshot || seat)
    };
  });
}

function restoreSeatSnapshots_(snapshots) {
  var failures = [];
  snapshots.forEach(function(snapshot) {
    try {
      snapshot.sheet.getRange(snapshot.rowNumber, 1, 1, snapshot.values.length).setValues([snapshot.values]);
    } catch (error) {
      failures.push(error);
    }
  });
  return failures;
}

function cleanupPendingRegistration_(seatSnapshots, participant, registrationBatch) {
  var failures = restoreSeatSnapshots_(seatSnapshots);
  if (failures.length) return failures;
  if (participant) {
    try {
      participant.sheet.deleteRow(participant.rowNumber);
    } catch (error) {
      failures.push(error);
      return failures;
    }
  }
  if (registrationBatch) {
    try {
      if (registrationBatch.rowCount > 1) {
        registrationBatch.sheet.deleteRows(registrationBatch.rowNumber, registrationBatch.rowCount);
      } else {
        registrationBatch.sheet.deleteRow(registrationBatch.rowNumber);
      }
    } catch (error) {
      failures.push(error);
    }
  }
  return failures;
}

function recoverPendingTransactions_(spreadsheet) {
  var failures = [];
  var registrations = readRows(spreadsheet, '报名项目');
  var pending = registrations.filter(function(record) { return record.status === 'pending'; });
  var activeIds = {};
  registrations.forEach(function(record) {
    if (REGISTRATION_ACTIVE_STATUSES[String(record.status || '').toLowerCase()]) {
      activeIds[record.registrationId] = true;
    }
  });
  var seatSheet = getRequiredSheet_(spreadsheet, '座位');
  readRows(spreadsheet, '座位').forEach(function(seat) {
    var match = /^PENDING\|(.+)$/.exec(String(seat.holderRegistrationId || ''));
    if (!match) return;
    var registrationId = match[1];
    var owned = !!activeIds[registrationId];
    var values = normalizeRow_('座位', {
      seatId: seat.seatId,
      eventId: seat.eventId,
      sessionId: seat.sessionId,
      label: seat.label,
      zone: seat.zone,
      status: owned ? 'registered' : 'available',
      holderRegistrationId: owned ? registrationId : '',
      createdAt: seat.createdAt,
      updatedAt: new Date().toISOString()
    });
    try {
      seatSheet.getRange(seat.rowNumber, 1, 1, values.length).setValues([values]);
    } catch (error) {
      failures.push({ registrationId: registrationId, error: error });
      appendRegistrationRecoveryAudit_(spreadsheet, 'PENDING_RECOVERY_RETRY', registrationId, 1);
    }
  });
  if (!pending.length) return failures;

  var pendingParticipants = {};
  var blockedRegistrationIds = {};
  pending.forEach(function(record) { pendingParticipants[record.participantId] = record.registrationId; });
  var participantSheet = getRequiredSheet_(spreadsheet, '参加者');
  readRows(spreadsheet, '参加者').slice().reverse().forEach(function(participant) {
    if (!pendingParticipants[participant.participantId]) return;
    var hasCommittedRegistration = registrations.some(function(record) {
      return record.participantId === participant.participantId && record.status !== 'pending';
    });
    if (hasCommittedRegistration) return;
    try {
      participantSheet.deleteRow(participant.rowNumber);
    } catch (error) {
      blockedRegistrationIds[pendingParticipants[participant.participantId]] = true;
      failures.push({
        registrationId: pendingParticipants[participant.participantId],
        error: error
      });
      appendRegistrationRecoveryAudit_(
        spreadsheet,
        'PENDING_RECOVERY_RETRY',
        pendingParticipants[participant.participantId],
        1
      );
    }
  });
  var registrationSheet = getRequiredSheet_(spreadsheet, '报名项目');
  pending.slice().reverse().forEach(function(record) {
    if (blockedRegistrationIds[record.registrationId]) return;
    try {
      registrationSheet.deleteRow(record.rowNumber);
    } catch (error) {
      failures.push({ registrationId: record.registrationId, error: error });
      appendRegistrationRecoveryAudit_(spreadsheet, 'PENDING_RECOVERY_RETRY', record.registrationId, 1);
    }
  });
  appendRegistrationRecoveryAudit_(spreadsheet, 'RECOVER_PENDING_REGISTRATION', 'batch', pending.length);
  return failures;
}

function appendRegistrationRecoveryAudit_(spreadsheet, action, registrationId, failureCount) {
  try {
    appendRegistrationAudit_(spreadsheet, action, registrationId, {
      recoveryCount: failureCount
    });
    return null;
  } catch (error) {
    if (typeof console !== 'undefined' && console.error) console.error(action, registrationId);
    return error;
  }
}

function raiseRegistrationIntegrityError_(spreadsheet, registrationId, rollbackFailures) {
  var auditFailure = null;
  try {
    appendRegistrationAudit_(spreadsheet, 'INTEGRITY_ALERT', registrationId, {
      stage: 'CREATE_REGISTRATION',
      restoreFailureCount: rollbackFailures.length
    });
  } catch (error) {
    auditFailure = error;
  }
  var integrityError = new Error('INTEGRITY_ERROR');
  integrityError.publicCode = 'INTEGRITY_ERROR';
  integrityError.restoreFailures = rollbackFailures;
  integrityError.auditFailure = auditFailure;
  throw integrityError;
}

function appendRegistrationAudit_(spreadsheet, action, registrationId, details) {
  var sheet = getRequiredSheet_(spreadsheet, '操作记录');
  sheet.appendRow([
    Utilities.getUuid(), action, 'registration', registrationId, 'system',
    JSON.stringify(details), new Date().toISOString()
  ]);
}

function appendRegistrationAuditSafely_(spreadsheet, action, registrationId, details) {
  try {
    appendRegistrationAudit_(spreadsheet, action, registrationId, details);
    return null;
  } catch (error) {
    appendRegistrationRecoveryAudit_(spreadsheet, 'AUDIT_RETRY', registrationId, 1);
    return error;
  }
}

function registrationTicketProjection_(event, registrationId, ticketNumber, token, status,
  participantValues, sessions, seats, allSeats, policy, ticketFields, createdAt) {
  var capabilities = ticketCapabilities_(status, policy);
  return {
    registrationId: registrationId,
    ticketNumber: ticketNumber,
    token: token,
    verifyUrl: typeof buildPublicVerificationUrl_ === 'function'
      ? buildPublicVerificationUrl_(token)
      : '',
    eventId: event.eventId,
    eventTitle: event.title,
    location: event.location,
    status: status,
    participant: {
      name: maskRegistrationName_(participantValues[1] || ''),
      phone: maskRegistrationPrivateValue_(participantValues[2] || ''),
      email: maskRegistrationPrivateValue_(participantValues[3] || '')
    },
    displayFields: projectTicketDisplayFields_(ticketFields),
    capabilities: capabilities,
    exchangeOptions: buildTicketExchangeOptions_(
      allSeats || [], seats || [], policy, status, new Date()
    ),
    sessions: sessions.map(function(session) {
      return {
        sessionId: session.sessionId,
        title: session.title,
        speaker: session.speaker,
        startsAt: session.startsAt,
        endsAt: session.endsAt,
        location: session.location || event.location
      };
    }),
    seats: seats.map(function(seat) {
      return { seatId: seat.seatId, label: seat.label, zone: seat.zone, sessionId: seat.sessionId };
    }),
    createdAt: createdAt,
    updatedAt: createdAt
  };
}

function maskRegistrationName_(value) {
  var text = String(value || '').trim();
  if (!text) return '';
  return text.slice(0, 1) + new Array(Math.max(2, text.length)).join('*');
}

function maskRegistrationPrivateValue_(value) {
  var text = String(value || '');
  if (!text) return '';
  if (text.indexOf('@') !== -1) {
    var parts = text.split('@');
    return parts[0].slice(0, 1) + '***@' + parts.slice(1).join('@');
  }
  return text.length <= 4 ? '****' : text.slice(0, 2) + '****' + text.slice(-2);
}

function parseStoredRegistrationAnswers_(serialized) {
  try {
    var parsed = typeof serialized === 'string' ? JSON.parse(serialized) : serialized;
    if (parsed && typeof parsed === 'object' && parsed.values && typeof parsed.values === 'object') return parsed;
    return { values: parsed && typeof parsed === 'object' ? parsed : {}, ticketToken: '', verificationField: '' };
  } catch (_ignored) {
    return { values: {}, ticketToken: '', verificationField: '' };
  }
}

function parseQuestionOptions_(serialized) {
  if (!serialized) return {};
  try {
    var parsed = typeof serialized === 'string' ? JSON.parse(serialized) : serialized;
    if (Array.isArray(parsed)) return { choices: parsed };
    if (!parsed || typeof parsed !== 'object') return {};
    var validation = parsed.validation && typeof parsed.validation === 'object' &&
      !Array.isArray(parsed.validation) ? parsed.validation : {};
    var normalized = {};
    Object.keys(parsed).forEach(function(key) {
      if (key !== 'validation') normalized[key] = parsed[key];
    });
    Object.keys(validation).forEach(function(key) {
      if (normalized[key] === undefined) normalized[key] = validation[key];
    });
    return normalized;
  } catch (_ignored) {
    registrationError_('INVALID_REQUEST');
  }
}

function validateChoiceValues_(values, constraints) {
  var choices = Array.isArray(constraints) ? constraints : constraints.choices || constraints.options;
  if (!Array.isArray(choices)) return;
  if (values.some(function(value) { return choices.indexOf(value) === -1; })) registrationError_('INVALID_REQUEST');
}

function parseStringArray_(serialized) {
  if (Array.isArray(serialized)) return serialized;
  try {
    var parsed = JSON.parse(serialized || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (_ignored) {
    return [];
  }
}

function parseRegistrationDate_(value) {
  if (value === '' || value === undefined || value === null) return null;
  if (value instanceof Date) return isFinite(value.getTime()) ? value.getTime() : null;
  var text = String(value).trim();
  var dateParts = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(text);
  if (!dateParts) return null;
  var year = Number(dateParts[1]);
  var month = Number(dateParts[2]);
  var day = Number(dateParts[3]);
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null;
  var timestamp = new Date(text).getTime();
  return isFinite(timestamp) ? timestamp : null;
}

function hasRegistrationValue_(value) {
  return value !== '' && value !== undefined && value !== null;
}

function normalizeIdentityValue_(value) {
  return String(value === undefined || value === null ? '' : value).trim().toLowerCase();
}

function registrationTruthy_(value) {
  return value === true || value === 1 || String(value).toLowerCase() === 'true' || String(value) === '1';
}

function registrationNumber_(value, fallback) {
  var number = Number(value);
  return isFinite(number) && number >= 0 ? number : fallback;
}

function firstAnswer_(answers, keys) {
  for (var index = 0; index < keys.length; index += 1) {
    if (typeof keys[index] === 'string' && keys[index] &&
        answers[keys[index]] !== undefined && answers[keys[index]] !== null) {
      return answers[keys[index]];
    }
  }
  return '';
}

function registrationConstraintInteger_(value) {
  if (value === undefined || value === null || value === '') return null;
  var number = Number(value);
  if (!isFinite(number) || number < 0 || Math.floor(number) !== number) {
    registrationError_('INVALID_REQUEST');
  }
  return number;
}

function registrationPositiveNumber_(value, fallback) {
  var number = Number(value);
  return isFinite(number) && number > 0 ? number : fallback;
}

function registrationAnswersWithRoles_(answers, policy) {
  var normalized = {};
  Object.keys(answers || {}).forEach(function(key) { normalized[key] = answers[key]; });
  var roles = policy && policy.fieldRoles && typeof policy.fieldRoles === 'object'
    ? policy.fieldRoles : {};
  ['name', 'phone', 'email'].forEach(function(role) {
    var questionId = roles[role];
    if (typeof questionId === 'string' && questionId &&
        normalized[questionId] !== undefined) {
      normalized[role] = normalized[questionId];
    }
  });
  return normalized;
}

function buildStoredTicketFields_(questions, answers, policy) {
  var allowed = {};
  (policy && Array.isArray(policy.showOnTicketFields)
    ? policy.showOnTicketFields : []).forEach(function(questionId) {
    if (typeof questionId === 'string' && questionId) allowed[questionId] = true;
  });
  return (questions || []).filter(function(question) {
    return allowed[question.questionId] === true;
  }).map(function(question) {
    return {
      id: String(question.questionId || ''),
      label: String(question.label || ''),
      value: answers[question.questionId]
    };
  });
}

function projectTicketDisplayFields_(fields) {
  return (Array.isArray(fields) ? fields : []).map(function(field) {
    var raw = field && field.value;
    var value = Array.isArray(raw)
      ? raw.join(', ')
      : raw === true ? 'Yes' : raw === false ? 'No' : String(raw || '');
    return {
      id: String(field && field.id || ''),
      label: String(field && field.label || ''),
      value: maskRegistrationPrivateValue_(value)
    };
  });
}

function ticketCapabilities_(status, policy) {
  var active = String(status || '').toLowerCase() === 'active';
  return {
    canCancel: active && !!(policy && policy.cancellationEnabled),
    canExchangeSeat: active && !!(policy && policy.seatExchangeEnabled)
  };
}

function buildTicketExchangeOptions_(allSeats, currentSeats, policy, status, _now) {
  if (!ticketCapabilities_(status, policy).canExchangeSeat) return [];
  var currentIds = {};
  (currentSeats || []).forEach(function(seat) { currentIds[seat.seatId] = true; });
  var result = [];
  (currentSeats || []).forEach(function(oldSeat) {
    (allSeats || []).forEach(function(candidate) {
      if (currentIds[candidate.seatId]) return;
      if (String(candidate.sessionId || '') !== String(oldSeat.sessionId || '')) return;
      var candidateStatus = String(candidate.status || 'available').toLowerCase();
      if ((candidateStatus !== 'available' && candidateStatus !== 'open') ||
          candidate.holderRegistrationId) return;
      result.push({
        seatId: String(candidate.seatId || ''),
        label: String(candidate.label || ''),
        zone: String(candidate.zone || ''),
        sessionId: String(candidate.sessionId || ''),
        replacesSeatId: String(oldSeat.seatId || '')
      });
    });
  });
  return result;
}

function requireSeatHoldPayload_(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
      typeof payload.eventId !== 'string' || !payload.eventId.trim() ||
      typeof payload.seatId !== 'string' || !payload.seatId.trim() ||
      typeof payload.holdOwner !== 'string' ||
      !/^[A-Za-z0-9._~-]{16,128}$/.test(payload.holdOwner)) {
    registrationError_('INVALID_REQUEST');
  }
  return {
    eventId: payload.eventId.trim(),
    seatId: payload.seatId.trim(),
    holdOwner: payload.holdOwner
  };
}

function registrationSheetNameByHeader_(header) {
  var names = Object.keys(SHEET_DEFINITIONS || {}).filter(function(name) {
    return Array.isArray(SHEET_DEFINITIONS[name]) &&
      SHEET_DEFINITIONS[name].indexOf(header) !== -1;
  });
  if (names.length !== 1) registrationError_('INTERNAL');
  return names[0];
}

function writeSeatHoldState_(spreadsheet, sheetName, seat, status, holder, updatedAt) {
  var sheet = getRequiredSheet_(spreadsheet, sheetName);
  var row = {
    seatId: seat.seatId,
    eventId: seat.eventId,
    sessionId: seat.sessionId,
    label: seat.label,
    zone: seat.zone,
    status: status,
    holderRegistrationId: holder,
    createdAt: seat.createdAt,
    updatedAt: updatedAt
  };
  var values = normalizeRow_(sheetName, row);
  sheet.getRange(seat.rowNumber, 1, 1, values.length).setValues([values]);
}
