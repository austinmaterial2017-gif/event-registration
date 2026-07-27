var ADMIN_EMAIL_ALLOWLIST = 'ADMIN_EMAIL_ALLOWLIST';
var PUBLIC_BACKEND_URL = 'PUBLIC_BACKEND_URL';
var SWITCH_PROBE_SHARED_SECRET = 'SWITCH_PROBE_SHARED_SECRET';
var SWITCH_PROBE = 'SWITCH_PROBE';
var SWITCH_PROBE_ACK = 'SWITCH_PROBE_ACK';
var SWITCH_MAINTENANCE = 'SWITCH_MAINTENANCE';
var SWITCH_PROBE_TTL_MS = 120000;

/** Returns the administrator dashboard for the authenticated Google session. */
function getAdminDashboard(payload) {
  return runAdminService_(function() {
    var actor = requireAuthorizedAdminSession_();
    var result = invokeInternalBackend_('admin.getDashboard', payload || {}, actor);
    if (!result.ok) adminError_(result.code);
    return result.data;
  });
}

/** Creates or updates one event without deleting its related history. */
function saveAdminEvent(payload) {
  return runAdminService_(function() {
    var actor = requireAuthorizedAdminSession_();
    var result = invokeInternalBackend_('admin.saveEvent', payload || {}, actor);
    if (!result.ok) adminError_(result.code);
    return result.data;
  });
}

/** Creates or updates one event session. */
function saveAdminSession(payload) {
  return runAdminService_(function() {
    var actor = requireAuthorizedAdminSession_();
    var result = invokeInternalBackend_('admin.saveSession', payload || {}, actor);
    if (!result.ok) adminError_(result.code);
    return result.data;
  });
}

/** Creates seats or changes one seat's operational state. */
function saveAdminSeatPlan(payload) {
  return runAdminService_(function() {
    var actor = requireAuthorizedAdminSession_();
    var result = invokeInternalBackend_('admin.saveSeatPlan', payload || {}, actor);
    if (!result.ok) adminError_(result.code);
    return result.data;
  });
}

/** Creates or updates one registration question. */
function saveAdminQuestion(payload) {
  return runAdminService_(function() {
    var actor = requireAuthorizedAdminSession_();
    var result = invokeInternalBackend_('admin.saveQuestion', payload || {}, actor);
    if (!result.ok) adminError_(result.code);
    return result.data;
  });
}

/** Cancels a registration or adjusts its assigned seat while preserving history. */
function adminRecordAction(payload) {
  return runAdminService_(function() {
    var actor = requireAuthorizedAdminSession_();
    var result = invokeInternalBackend_('admin.recordAction', payload || {}, actor);
    if (!result.ok) adminError_(result.code);
    return result.data;
  });
}

/** Tests a submitted target Sheet without changing the active connection. */
function testAdminSheetConnection(payload) {
  return runAdminService_(function() {
    var actor = requireAuthorizedAdminSession_();
    var result = invokeInternalBackend_('admin.testSheet', payload || {}, actor);
    if (!result.ok) adminError_(result.code);
    return result.data;
  });
}

/** Switches the active Sheet only after an explicit administrator confirmation. */
function switchAdminSheet(payload) {
  return runAdminService_(function() {
    var actor = requireAuthorizedAdminSession_();
    var result = invokeInternalBackend_('admin.switchSheet', payload || {}, actor);
    if (!result.ok) adminError_(result.code);
    return result.data;
  });
}

/** Returns paste-ready, redacted source snapshots to an authenticated administrator. */
function getAdminSourceBundles(payload) {
  return runAdminService_(function() {
    requireAuthorizedAdminSession_();
    return getAdminSourceBundles_(payload);
  });
}

function runAdminService_(callback) {
  try {
    return { ok: true, data: callback() };
  } catch (error) {
    return adminFailure_(error && error.publicCode ? error.publicCode : 'INTERNAL');
  }
}

function adminFailure_(code) {
  var messages = {
    ADMIN_ACTION_DENIED: '管理员功能不可用。',
    INVALID_REQUEST: '提交信息无效，请检查后重试。',
    NOT_FOUND: '未找到对应记录。',
    CONFLICT: '当前数据状态不允许此操作。',
    CONFIRMATION_REQUIRED: '此操作需要明确确认。',
    SHEET_CONNECTION_FAILED: '无法连接到指定的数据表。',
    INTEGRITY_ERROR: '数据一致性检查失败，请联系管理员。',
    MAINTENANCE: '系统正在切换数据连接，请稍后重试。',
    INTERNAL: '请求未能完成，请稍后重试。'
  };
  var safeCode = Object.prototype.hasOwnProperty.call(messages, code) ? code : 'INTERNAL';
  return { ok: false, code: safeCode, message: messages[safeCode] };
}

function adminError_(code) {
  var error = new Error(code);
  error.publicCode = code;
  throw error;
}

function requireAuthorizedAdminSession_() {
  var identity = normalizedAdminSessionIdentity_();
  if (!identity || !isAllowlistedAdminIdentity_(identity)) {
    adminError_('ADMIN_ACTION_DENIED');
  }
  return identity;
}

function normalizedAdminSessionIdentity_() {
  try {
    return String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  } catch (_ignored) {
    return '';
  }
}

function isAllowlistedAdminIdentity_(identity) {
  var serialized = PropertiesService.getScriptProperties().getProperty(ADMIN_EMAIL_ALLOWLIST);
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

var ADMIN_EVENT_STATUSES_ = {
  draft: true, upcoming: true, open: true, closed: true,
  live: true, ended: true, cancelled: true, archived: true
};
var ADMIN_SELECTION_MODES_ = {
  none: true, single: true, all: true, free: true, mixed: true, multiple: true
};
var ADMIN_SEAT_MODES_ = { none: true, self: true, auto: true, zone: true };
var ADMIN_QUESTION_TYPES_ = {
  text: true, textarea: true, number: true, tel: true, email: true,
  date: true, radio: true, checkbox: true, select: true, boolean: true
};

function getAdminDashboard_(payload) {
  var request = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  var search = typeof request.search === 'string' ? request.search.trim().toLowerCase() : '';
  if (Object.prototype.hasOwnProperty.call(request, 'eventId') &&
      (typeof request.eventId !== 'string' || !request.eventId.trim())) {
    adminError_('INVALID_REQUEST');
  }
  return withScriptLock_(function() {
    var registry = getRootConfiguredSpreadsheet_();
    var settings = getAdminSettings_(registry);
    var catalogEntries = readAdminRows_(registry, '活动目录');
    var events = catalogEntries.map(function(entry) {
      var validated = getEventCatalogEntry_(registry, entry.eventId);
      var projection = adminEventProjection_(validated, settings);
      projection.sheetUrl = activitySheetUrl_(validated.spreadsheetId);
      return projection;
    });
    var selectedEventId = typeof request.eventId === 'string'
      ? request.eventId.trim() : '';
    var spreadsheet = selectedEventId
      ? getAdminEventSpreadsheet_(registry, selectedEventId) : null;
    var sessions = spreadsheet ? readAdminRows_(spreadsheet, '场次').filter(function(session) {
      return String(session.eventId || '') === selectedEventId;
    }) : [];
    var seats = spreadsheet ? readAdminRows_(spreadsheet, '座位').filter(function(seat) {
      return String(seat.eventId || '') === selectedEventId;
    }) : [];
    var questions = spreadsheet ? readAdminRows_(spreadsheet, '报名问题').filter(function(question) {
      return String(question.eventId || '') === selectedEventId;
    }) : [];
    var participants = spreadsheet ? readAdminRows_(spreadsheet, '参加者') : [];
    var registrations = spreadsheet
      ? readAdminRows_(spreadsheet, '报名项目').filter(function(registration) {
        return String(registration.eventId || '') === selectedEventId;
      }) : [];
    var attendance = spreadsheet
      ? readAdminRows_(spreadsheet, '签到记录').filter(function(record) {
        return String(record.eventId || '') === selectedEventId;
      }) : [];
    var participantById = {};
    participants.forEach(function(participant) {
      participantById[participant.participantId] = participant;
    });
    var registrationGroupsById = {};
    var registrationGroups = [];
    registrations.forEach(function(registration) {
      var registrationId = String(registration.registrationId || '');
      var groupKey = registrationId || 'row:' + registration.rowNumber;
      var group = registrationGroupsById[groupKey];
      if (!group) {
        group = {
          registration: registration,
          sessionIds: [],
          seatChoices: [],
          answers: {}
        };
        registrationGroupsById[groupKey] = group;
        registrationGroups.push(group);
      }
      parseAdminStringArray_(registration.sessionIds).forEach(function(sessionId) {
        if (group.sessionIds.indexOf(sessionId) === -1) group.sessionIds.push(sessionId);
      });
      parseAdminStringArray_(registration.seatChoices).forEach(function(seatId) {
        if (group.seatChoices.indexOf(seatId) === -1) group.seatChoices.push(seatId);
      });
      var rowAnswers = parseAdminAnswers_(registration.answers).values;
      Object.keys(rowAnswers).forEach(function(key) { group.answers[key] = rowAnswers[key]; });
      if (String(registration.updatedAt || '') >
          String(group.registration.updatedAt || '')) {
        group.registration.updatedAt = registration.updatedAt;
      }
    });
    var records = [];
    registrationGroups.forEach(function(group) {
      var registration = group.registration;
      var participant = participantById[registration.participantId] || {};
      var haystack = [
        registration.registrationId, registration.ticketNumber, registration.eventId,
        participant.name, participant.phone, participant.email,
        group.sessionIds.join(' '), group.seatChoices.join(' '), JSON.stringify(group.answers)
      ].join(' ').toLowerCase();
      if (search && haystack.indexOf(search) === -1) return;
      records.push({
        registrationId: String(registration.registrationId || ''),
        eventId: String(registration.eventId || ''),
        ticketNumber: String(registration.ticketNumber || ''),
        status: String(registration.status || ''),
        participantName: maskAdminName_(participant.name),
        phone: maskAdminValue_(participant.phone),
        email: maskAdminValue_(participant.email),
        answers: maskAdminAnswers_(group.answers),
        sessionIds: group.sessionIds,
        seatChoices: group.seatChoices,
        createdAt: String(registration.createdAt || ''),
        updatedAt: String(registration.updatedAt || '')
      });
    });
    return {
      connection: {
        connected: true,
        sheetName: String(
          spreadsheet && spreadsheet.getName ? spreadsheet.getName() :
          registry.getName ? registry.getName() : 'Connected'
        )
      },
      events: events,
      sessions: sessions.map(function(session) { return adminSessionProjection_(session, settings); }),
      seats: seats.map(adminSeatProjection_),
      questions: questions.map(function(question) { return adminQuestionProjection_(question, settings); }),
      records: records,
      attendance: attendance.map(function(record) {
        return {
          checkInId: String(record.checkInId || ''),
          registrationId: String(record.registrationId || ''),
          eventId: String(record.eventId || ''),
          sessionId: String(record.sessionId || ''),
          checkedInAt: String(record.checkedInAt || ''),
          checkedInBy: maskAdminValue_(record.checkedInBy),
          status: String(record.status || '')
        };
      })
    };
  });
}

function getAdminEventSpreadsheet_(registry, eventId) {
  try {
    return getEventSpreadsheet_(registry, eventId);
  } catch (error) {
    if (error && error.publicCode === 'EVENT_NOT_FOUND') adminError_('NOT_FOUND');
    throw error;
  }
}

function saveAdminEvent_(payload, actor) {
  var request = requireAdminObject_(payload);
  var isNewEvent = !Object.prototype.hasOwnProperty.call(request, 'eventId');
  if (!isNewEvent &&
      (typeof request.eventId !== 'string' || !request.eventId.trim())) {
    adminError_('INVALID_REQUEST');
  }
  if (isNewEvent && Object.prototype.hasOwnProperty.call(request, 'spreadsheetId')) {
    adminError_('INVALID_REQUEST');
  }
  var normalizedActor = typeof actor === 'string' ? actor.trim().toLowerCase() : '';
  if (!normalizedActor) adminError_('ADMIN_ACTION_DENIED');
  return withScriptLock_(function() {
    var registry = getRootConfiguredSpreadsheet_();
    requireNoSwitchMaintenance_(registry);
    var spreadsheet = isNewEvent
      ? null : getAdminEventSpreadsheet_(registry, request.eventId.trim());
    var existing = isNewEvent
      ? null : findAdminRow_(spreadsheet, '活动', 'eventId', request.eventId.trim());
    if (!isNewEvent && !existing) adminError_('NOT_FOUND');
    if (request.action === 'reopen' && request.confirm !== true) {
      adminError_('CONFIRMATION_REQUIRED');
    }
    var now = new Date().toISOString();
    var eventId = existing ? existing.eventId : Utilities.getUuid();
    var status = adminField_(request, 'status', existing && existing.status, 'draft');
    if (request.action === 'archive') status = 'archived';
    if (request.action === 'close') status = request.closeStatus || 'ended';
    if (request.action === 'reopen') status = request.reopenStatus || 'open';
    status = String(status || '').toLowerCase();
    if (!ADMIN_EVENT_STATUSES_[status]) adminError_('INVALID_REQUEST');

    var title = adminTextField_(request, 'title', existing && existing.title, '');
    if (!title) adminError_('INVALID_REQUEST');
    var selectionMode = String(adminField_(
      request, 'selectionMode', existing && existing.selectionMode, 'free'
    )).toLowerCase();
    var seatMode = String(adminField_(
      request, 'seatMode', existing && existing.seatMode, 'none'
    )).toLowerCase();
    if (!ADMIN_SELECTION_MODES_[selectionMode] || !ADMIN_SEAT_MODES_[seatMode]) {
      adminError_('INVALID_REQUEST');
    }
    var minChoices = adminNonNegativeInteger_(
      adminField_(request, 'minChoices', existing && existing.minChoices, 0)
    );
    var maxChoices = adminNonNegativeInteger_(
      adminField_(request, 'maxChoices', existing && existing.maxChoices, 0)
    );
    if (maxChoices < minChoices) adminError_('INVALID_REQUEST');
    var opensAt = adminDateField_(adminField_(request, 'opensAt', existing && existing.opensAt, ''));
    var closesAt = adminDateField_(adminField_(request, 'closesAt', existing && existing.closesAt, ''));
    if (opensAt && closesAt && Date.parse(closesAt) <= Date.parse(opensAt)) {
      adminError_('INVALID_REQUEST');
    }
    var seatZonesValue = adminField_(request, 'seatZones', existing && existing.seatZones, []);
    var seatZones = parseAdminStringArray_(seatZonesValue);
    if (Array.isArray(seatZonesValue)) {
      seatZones = seatZonesValue.filter(function(zone) {
        return typeof zone === 'string' && zone.trim();
      }).map(function(zone) { return zone.trim(); });
    }
    var row = {
      eventId: eventId,
      title: title,
      description: adminTextField_(request, 'description', existing && existing.description, ''),
      status: status,
      opensAt: opensAt,
      closesAt: closesAt,
      location: adminTextField_(request, 'location', existing && existing.location, ''),
      selectionMode: selectionMode,
      minChoices: minChoices,
      maxChoices: maxChoices,
      seatMode: seatMode,
      seatZones: JSON.stringify(seatZones),
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now
    };
    var settings = getAdminSettings_(registry);
    var policy = ensureAdminEventPolicy_(settings, eventId);
    copyAdminBooleanField_(request, policy, 'showOpeningCountdown');
    copyAdminBooleanField_(request, policy, 'showClosingCountdown');
    copyAdminBooleanField_(request, policy, 'cancellationEnabled');
    copyAdminBooleanField_(request, policy, 'seatExchangeEnabled');
    copyAdminBooleanField_(request, policy, 'seatHoldsEnabled');
    if (Object.prototype.hasOwnProperty.call(request, 'seatHoldMinutes')) {
      policy.seatHoldMinutes = adminPositiveInteger_(request.seatHoldMinutes);
    }
    var result = adminEventProjection_(row, settings);
    if (isNewEvent) {
      spreadsheet = createActivitySpreadsheet_(
        eventId,
        title,
        normalizedActor
      );
    }
    result.sheetUrl = activitySheetUrl_(spreadsheet);
    if (request.action === 'reopen') {
      var registrationIds = {};
      readAdminRows_(spreadsheet, '报名项目').forEach(function(registration) {
        if (registration.eventId === eventId &&
            String(registration.status || '').toLowerCase() !== 'pending') {
          registrationIds[registration.registrationId] = true;
        }
      });
      result.registrationCount = Object.keys(registrationIds).length;
    }
    writeAdminRow_(spreadsheet, '活动', existing && existing.rowNumber, row);
    setAdminSettings_(registry, settings);
    appendAdminAudit_(
      spreadsheet,
      request.action ? String(request.action).toUpperCase() + '_EVENT' : (existing ? 'UPDATE_EVENT' : 'CREATE_EVENT'),
      'event',
      eventId,
      normalizedActor,
      { status: status }
    );
    upsertActivityCatalogEntry_(registry, row, spreadsheet);
    return result;
  });
}

function saveAdminSession_(payload, actor) {
  var request = requireAdminObject_(payload);
  if (typeof request.eventId !== 'string' || !request.eventId.trim()) {
    adminError_('INVALID_REQUEST');
  }
  return withScriptLock_(function() {
    var registry = getRootConfiguredSpreadsheet_();
    requireNoSwitchMaintenance_(registry);
    var spreadsheet = getAdminEventSpreadsheet_(registry, request.eventId.trim());
    if (!findAdminRow_(spreadsheet, '活动', 'eventId', request.eventId.trim())) {
      adminError_('NOT_FOUND');
    }
    var existing = request.sessionId
      ? findAdminRow_(spreadsheet, '场次', 'sessionId', request.sessionId)
      : null;
    if (request.sessionId && !existing) adminError_('NOT_FOUND');
    var now = new Date().toISOString();
    var sessionId = existing ? existing.sessionId : Utilities.getUuid();
    var title = adminTextField_(request, 'title', existing && existing.title, '');
    var status = String(adminField_(request, 'status', existing && existing.status, 'draft')).toLowerCase();
    if (!title || (!ADMIN_EVENT_STATUSES_[status] && status !== 'inactive')) {
      adminError_('INVALID_REQUEST');
    }
    var startsAt = adminDateField_(adminField_(request, 'startsAt', existing && existing.startsAt, ''));
    var endsAt = adminDateField_(adminField_(request, 'endsAt', existing && existing.endsAt, ''));
    if ((startsAt || endsAt) && (!startsAt || !endsAt || Date.parse(endsAt) <= Date.parse(startsAt))) {
      adminError_('INVALID_REQUEST');
    }
    var row = {
      sessionId: sessionId,
      eventId: request.eventId.trim(),
      title: title,
      speaker: adminTextField_(request, 'speaker', existing && existing.speaker, ''),
      startsAt: startsAt,
      endsAt: endsAt,
      required: adminBooleanField_(request, 'required', existing && adminTruthy_(existing.required), false),
      capacity: adminNonNegativeInteger_(adminField_(request, 'capacity', existing && existing.capacity, 0)),
      status: status,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now
    };
    writeAdminRow_(spreadsheet, '场次', existing && existing.rowNumber, row);
    var settings = getAdminSettings_(registry);
    var sessionPolicy = ensureAdminSessionPolicy_(settings, row.eventId, sessionId);
    sessionPolicy.location = adminTextField_(
      request, 'location', sessionPolicy.location, ''
    );
    sessionPolicy.groupRule = adminTextField_(
      request, 'groupRule', sessionPolicy.groupRule, ''
    );
    setAdminSettings_(registry, settings);
    appendAdminAudit_(
      spreadsheet, existing ? 'UPDATE_SESSION' : 'CREATE_SESSION',
      'session', sessionId, actor, { eventId: row.eventId }
    );
    return adminSessionProjection_(row, settings);
  });
}

function saveAdminQuestion_(payload, actor) {
  var request = requireAdminObject_(payload);
  if (typeof request.eventId !== 'string' || !request.eventId.trim()) {
    adminError_('INVALID_REQUEST');
  }
  return withScriptLock_(function() {
    var registry = getRootConfiguredSpreadsheet_();
    requireNoSwitchMaintenance_(registry);
    var spreadsheet = getAdminEventSpreadsheet_(registry, request.eventId.trim());
    if (!findAdminRow_(spreadsheet, '活动', 'eventId', request.eventId.trim())) {
      adminError_('NOT_FOUND');
    }
    var existing = request.questionId
      ? findAdminRow_(spreadsheet, '报名问题', 'questionId', request.questionId)
      : null;
    if (request.questionId && !existing) adminError_('NOT_FOUND');
    if (existing && existing.eventId !== request.eventId.trim()) adminError_('CONFLICT');
    var now = new Date().toISOString();
    var questionId = existing ? existing.questionId : Utilities.getUuid();
    var type = String(adminField_(request, 'type', existing && existing.type, 'text')).toLowerCase();
    var label = adminTextField_(request, 'label', existing && existing.label, '');
    if (!label || !ADMIN_QUESTION_TYPES_[type]) adminError_('INVALID_REQUEST');
    var status = String(adminField_(request, 'status', existing && existing.status, 'active')).toLowerCase();
    if (request.action === 'hide') status = 'inactive';
    if (request.action === 'show') status = 'active';
    if (status !== 'active' && status !== 'inactive') adminError_('INVALID_REQUEST');
    var choices = Array.isArray(request.options)
      ? request.options.filter(function(option) {
        return typeof option === 'string' && option.trim();
      }).map(function(option) { return option.trim(); })
      : parseAdminQuestionOptions_(existing && existing.options).choices;
    if ((type === 'select' || type === 'radio' || type === 'checkbox') && !choices.length) {
      adminError_('INVALID_REQUEST');
    }
    var validation = request.validation && typeof request.validation === 'object' &&
      !Array.isArray(request.validation) ? request.validation :
      parseAdminQuestionOptions_(existing && existing.options).validation;
    validation = normalizeAdminQuestionValidation_(type, validation, choices);
    var row = {
      questionId: questionId,
      eventId: request.eventId.trim(),
      label: label,
      type: type,
      required: adminBooleanField_(request, 'required', existing && adminTruthy_(existing.required), false),
      options: JSON.stringify(adminQuestionStorage_(choices, validation)),
      sortOrder: adminNonNegativeInteger_(adminField_(request, 'sortOrder', existing && existing.sortOrder, 0)),
      status: status,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now
    };
    var settings = getAdminSettings_(registry);
    var policy = ensureAdminEventPolicy_(settings, row.eventId);
    var inheritedIdentityFields = settings.registration &&
      Array.isArray(settings.registration.identityFields) ? settings.registration.identityFields : [];
    var eventQuestions = readAdminRows_(spreadsheet, '报名问题');
    var configuredIdentityFields = (Array.isArray(policy.identityFields)
      ? policy.identityFields : inheritedIdentityFields).slice();
    var hadIdentityFields = configuredIdentityFields.length > 0;
    var identityFields = updateAdminFlagList_(
      configuredIdentityFields, questionId,
      adminBooleanField_(
        request, 'duplicateIdentity', adminListHas_(configuredIdentityFields, questionId), false
      )
    );
    if (hadIdentityFields || identityFields.length) {
      validateAdminIdentityFields_(
        identityFields,
        eventQuestions,
        row
      );
    }
    policy.identityFields = identityFields;
    policy.showOnTicketFields = updateAdminFlagList_(
      policy.showOnTicketFields, questionId,
      adminBooleanField_(request, 'showOnTicket', adminListHas_(policy.showOnTicketFields, questionId), false)
    );
    var semanticRole = adminQuestionSemanticRole_(
      request, policy, questionId, type, status
    );
    var removesIdentity = adminListHas_(configuredIdentityFields, questionId) &&
      !adminListHas_(identityFields, questionId);
    if (removesIdentity) {
      setAdminSettings_(registry, settings);
      writeAdminRow_(spreadsheet, '报名问题', existing && existing.rowNumber, row);
    } else {
      writeAdminRow_(spreadsheet, '报名问题', existing && existing.rowNumber, row);
      setAdminSettings_(registry, settings);
    }
    appendAdminAudit_(
      spreadsheet, existing ? 'UPDATE_QUESTION' : 'CREATE_QUESTION',
      'question', questionId, actor, { eventId: row.eventId, status: status }
    );
    var projection = adminQuestionProjection_(row, settings);
    projection.semanticRole = semanticRole;
    return projection;
  });
}

function saveAdminSeatPlan_(payload, actor) {
  var request = requireAdminObject_(payload);
  var action = String(request.action || 'generate').toLowerCase();
  if (typeof request.eventId !== 'string' || !request.eventId.trim()) {
    adminError_('INVALID_REQUEST');
  }
  return withScriptLock_(function() {
    var registry = getRootConfiguredSpreadsheet_();
    requireNoSwitchMaintenance_(registry);
    var eventId = request.eventId.trim();
    var spreadsheet = getAdminEventSpreadsheet_(registry, eventId);
    if (action === 'reserve' || action === 'close' || action === 'reopen') {
      var seat = findAdminRow_(spreadsheet, '座位', 'seatId', request.seatId);
      if (!seat) adminError_('NOT_FOUND');
      if (String(seat.eventId || '') !== eventId) adminError_('CONFLICT');
      if (seat.holderRegistrationId && seat.status === 'registered') adminError_('CONFLICT');
      seat.status = action === 'reserve' ? 'reserved' : action === 'close' ? 'closed' : 'available';
      seat.updatedAt = new Date().toISOString();
      writeAdminRow_(spreadsheet, '座位', seat.rowNumber, seat);
      appendAdminAudit_(
        spreadsheet, action.toUpperCase() + '_SEAT', 'seat', seat.seatId, actor,
        { status: seat.status }
      );
      return adminSeatProjection_(seat);
    }
    if (action !== 'generate') {
      adminError_('INVALID_REQUEST');
    }
    var event = findAdminRow_(spreadsheet, '活动', 'eventId', eventId);
    if (!event) adminError_('NOT_FOUND');
    var mode = String(request.mode || '').toLowerCase();
    if (!ADMIN_SEAT_MODES_[mode]) adminError_('INVALID_REQUEST');
    var zones = Array.isArray(request.zones) ? request.zones : [];
    if (mode !== 'none' && !zones.length) adminError_('INVALID_REQUEST');
    var now = new Date().toISOString();
    var existingSeats = readAdminRows_(spreadsheet, '座位');
    var knownLabels = {};
    existingSeats.forEach(function(seat) {
      knownLabels[[seat.eventId, seat.sessionId, seat.label].join('|')] = true;
    });
    var created = [];
    var zoneNames = [];
    if (mode !== 'none') {
      zones.forEach(function(zone) {
        if (!zone || typeof zone !== 'object' || Array.isArray(zone)) adminError_('INVALID_REQUEST');
        var name = typeof zone.name === 'string' ? zone.name.trim() : '';
        var rowCount = adminPositiveInteger_(zone.rows);
        var seatCount = adminPositiveInteger_(zone.seatsPerRow);
        if (mode === 'zone' && !name) adminError_('INVALID_REQUEST');
        if (name && zoneNames.indexOf(name) === -1) zoneNames.push(name);
        for (var rowIndex = 1; rowIndex <= rowCount; rowIndex += 1) {
          for (var seatIndex = 1; seatIndex <= seatCount; seatIndex += 1) {
            var label = (name ? name + '-' : '') + rowIndex + '-' + seatIndex;
            var key = [event.eventId, request.sessionId || '', label].join('|');
            if (knownLabels[key]) continue;
            var createdSeat = {
              seatId: Utilities.getUuid(),
              eventId: event.eventId,
              sessionId: typeof request.sessionId === 'string' ? request.sessionId : '',
              label: label,
              zone: name,
              status: 'available',
              holderRegistrationId: '',
              createdAt: now,
              updatedAt: now
            };
            writeAdminRow_(spreadsheet, '座位', null, createdSeat);
            knownLabels[key] = true;
            created.push(createdSeat);
          }
        }
      });
    }
    event.seatMode = mode;
    event.seatZones = JSON.stringify(zoneNames);
    event.updatedAt = now;
    writeAdminRow_(spreadsheet, '活动', event.rowNumber, event);
    appendAdminAudit_(
      spreadsheet, 'SAVE_SEAT_PLAN', 'event', event.eventId, actor,
      { mode: mode, created: created.length }
    );
    return { eventId: event.eventId, mode: mode, createdCount: created.length };
  });
}

function adminRecordAction_(payload, actor) {
  var request = requireAdminObject_(payload);
  if (request.confirm !== true) adminError_('CONFIRMATION_REQUIRED');
  var action = String(request.action || '').toLowerCase();
  if (typeof request.eventId !== 'string' || !request.eventId.trim() ||
      typeof request.registrationId !== 'string' || !request.registrationId.trim()) {
    adminError_('INVALID_REQUEST');
  }
  return withScriptLock_(function() {
    var registry = getRootConfiguredSpreadsheet_();
    requireNoSwitchMaintenance_(registry);
    var eventId = request.eventId.trim();
    var spreadsheet = getAdminEventSpreadsheet_(registry, eventId);
    var registrations = readAdminRows_(spreadsheet, '报名项目').filter(function(record) {
      return record.registrationId === request.registrationId.trim() &&
        String(record.eventId || '') === eventId;
    });
    if (!registrations.length) adminError_('NOT_FOUND');
    var seats = readAdminRows_(spreadsheet, '座位');
    var now = new Date().toISOString();
    if (action === 'cancel_registration') {
      registrations.forEach(function(record) {
        record.status = 'cancelled';
        record.updatedAt = now;
        writeAdminRow_(spreadsheet, '报名项目', record.rowNumber, record);
      });
      seats.filter(function(seat) {
        return seat.holderRegistrationId === request.registrationId.trim() ||
          seat.holderRegistrationId === 'PENDING|' + request.registrationId.trim();
      }).forEach(function(seat) {
        seat.status = 'available';
        seat.holderRegistrationId = '';
        seat.updatedAt = now;
        writeAdminRow_(spreadsheet, '座位', seat.rowNumber, seat);
      });
    } else if (action === 'adjust_seat') {
      var target = seats.filter(function(seat) { return seat.seatId === request.seatId; })[0];
      if (!target) adminError_('NOT_FOUND');
      var targetStatus = String(target.status || '').toLowerCase();
      if (target.holderRegistrationId ||
          (targetStatus !== 'available' && targetStatus !== 'open' && targetStatus !== 'reserved')) {
        adminError_('CONFLICT');
      }
      var registrationEventId = String(registrations[0].eventId || '');
      var selectedSessionIds = {};
      registrations.forEach(function(record) {
        if (String(record.eventId || '') !== registrationEventId) adminError_('CONFLICT');
        parseAdminStringArray_(record.sessionIds).forEach(function(sessionId) {
          selectedSessionIds[sessionId] = true;
        });
      });
      if (!registrationEventId || String(target.eventId || '') !== registrationEventId ||
          (target.sessionId && !selectedSessionIds[target.sessionId])) {
        adminError_('CONFLICT');
      }
      var oldSeats = seats.filter(function(seat) {
        return seat.holderRegistrationId === request.registrationId.trim() &&
          (target.sessionId ? seat.sessionId === target.sessionId : !seat.sessionId);
      });
      if (oldSeats.length > 1) adminError_('CONFLICT');
      var affectedRegistrations = registrations.filter(function(record) {
        var recordSessionIds = parseAdminStringArray_(record.sessionIds);
        return !target.sessionId || recordSessionIds.indexOf(target.sessionId) !== -1;
      });
      var snapshots = snapshotAdminRows_(
        spreadsheet, '座位', [target]
      ).concat(snapshotAdminRows_(
        spreadsheet, '报名项目', affectedRegistrations
      ));
      try {
        target.status = 'registered';
        target.holderRegistrationId = request.registrationId.trim();
        target.updatedAt = now;
        writeAdminRow_(spreadsheet, '座位', target.rowNumber, target);
        affectedRegistrations.forEach(function(record) {
          var choices = parseAdminStringArray_(record.seatChoices).filter(function(seatId) {
            var oldSeat = seats.filter(function(seat) { return seat.seatId === seatId; })[0];
            return !oldSeat ||
              (target.sessionId ? oldSeat.sessionId !== target.sessionId : !!oldSeat.sessionId);
          });
          if (choices.indexOf(target.seatId) === -1) choices.push(target.seatId);
          record.seatChoices = JSON.stringify(choices);
          record.updatedAt = now;
          writeAdminRow_(spreadsheet, '报名项目', record.rowNumber, record);
        });
      } catch (error) {
        var precommitRestoreFailures = restoreAdminSnapshots_(snapshots);
        if (precommitRestoreFailures.length) {
          appendAdminAuditSafely_(
            spreadsheet, 'ADMIN_SEAT_ADJUSTMENT_RECOVERY', 'registration',
            request.registrationId.trim(), actor,
            { seatId: String(request.seatId || ''), stage: 'precommit' }
          );
          adminError_('INTEGRITY_ERROR');
        }
        throw error;
      }
      try {
        oldSeats.forEach(function(seat) {
          seat.status = 'available';
          seat.holderRegistrationId = '';
          seat.updatedAt = now;
          writeAdminRow_(spreadsheet, '座位', seat.rowNumber, seat);
        });
      } catch (releaseError) {
        var releaseRestoreFailures = restoreAdminSnapshots_(snapshots);
        if (releaseRestoreFailures.length) {
          appendAdminAuditSafely_(
            spreadsheet, 'ADMIN_SEAT_ADJUSTMENT_RECOVERY', 'registration',
            request.registrationId.trim(), actor,
            { seatId: String(request.seatId || ''), stage: 'release' }
          );
          adminError_('INTEGRITY_ERROR');
        }
        throw releaseError;
      }
      appendAdminAuditSafely_(
        spreadsheet, action.toUpperCase(), 'registration', request.registrationId.trim(),
        actor, { seatId: String(request.seatId || '') }
      );
      return {
        registrationId: request.registrationId.trim(),
        action: action,
        status: 'completed'
      };
    } else {
      adminError_('INVALID_REQUEST');
    }
    appendAdminAudit_(
      spreadsheet, action.toUpperCase(), 'registration', request.registrationId.trim(),
      actor, { seatId: action === 'adjust_seat' ? String(request.seatId || '') : '' }
    );
    return { registrationId: request.registrationId.trim(), action: action, status: 'completed' };
  });
}

function testAdminSheetConnection_(payload) {
  var request = requireAdminObject_(payload);
  if (typeof request.spreadsheetId !== 'string' || !request.spreadsheetId.trim()) {
    adminError_('INVALID_REQUEST');
  }
  try {
    var spreadsheet = openSpreadsheetById_(request.spreadsheetId);
    validateAdminSpreadsheet_(spreadsheet);
    return {
      connected: true,
      sheetName: String(spreadsheet.getName ? spreadsheet.getName() : 'Connected')
    };
  } catch (error) {
    if (error && error.publicCode) throw error;
    adminError_('SHEET_CONNECTION_FAILED');
  }
}

function switchAdminSheet_(payload) {
  var request = requireAdminObject_(payload);
  if (request.confirm !== true) adminError_('CONFIRMATION_REQUIRED');
  return withScriptLock_(function() {
    var registry = getRootConfiguredSpreadsheet_();
    if (typeof request.spreadsheetId === 'string' && request.spreadsheetId.trim() &&
        (request.nonce === undefined || request.nonce === null || request.nonce === '')) {
      return stageAdminSheetSwitch_(registry, request.spreadsheetId.trim());
    }
    if (typeof request.nonce === 'string' && request.nonce &&
        (request.spreadsheetId === undefined || request.spreadsheetId === null ||
         request.spreadsheetId === '')) {
      return finalizeAdminSheetSwitch_(registry, request.nonce);
    }
    adminError_('INVALID_REQUEST');
  });
}

function stageAdminSheetSwitch_(registry, candidateSpreadsheetId) {
  var configuration = requireSwitchProbeConfiguration_();
  var existingMaintenance = getSharedSettingValue_(registry, SWITCH_MAINTENANCE);
  if (typeof existingMaintenance === 'string' && existingMaintenance.trim()) {
    var existing = parseAdminSwitchObject_(existingMaintenance);
    if (existing && isFutureSwitchTime_(existing.expiresAt)) adminError_('CONFLICT');
    clearAdminSwitchState_(registry);
  }

  var candidate;
  try {
    candidate = openSpreadsheetById_(candidateSpreadsheetId);
    validateAdminSpreadsheet_(candidate);
  } catch (error) {
    if (error && error.publicCode) throw error;
    adminError_('SHEET_CONNECTION_FAILED');
  }

  var expiresAt = new Date(Date.now() + SWITCH_PROBE_TTL_MS).toISOString();
  var nonce = createAdminSwitchNonce_(configuration.secret);
  try {
    setSharedSettingValue_(
      registry,
      SWITCH_MAINTENANCE,
      JSON.stringify({ nonce: nonce, expiresAt: expiresAt })
    );
    setSharedSettingValue_(
      registry,
      SWITCH_PROBE,
      JSON.stringify({
        nonce: nonce,
        candidateSpreadsheetId: candidateSpreadsheetId,
        expiresAt: expiresAt,
        createdAt: new Date().toISOString()
      })
    );
    setSharedSettingValue_(registry, SWITCH_PROBE_ACK, '');
  } catch (error) {
    try {
      clearAdminSwitchState_(registry);
    } catch (_ignored) {
      // A partially staged switch remains fail-closed until an administrator retries.
    }
    throw error;
  }
  return {
    state: 'probe_required',
    nonce: nonce,
    expiresAt: expiresAt,
    probeUrl: configuration.publicBackendUrl
  };
}

function finalizeAdminSheetSwitch_(registry, nonce) {
  var probe = parseAdminSwitchObject_(getSharedSettingValue_(registry, SWITCH_PROBE));
  var maintenance = parseAdminSwitchObject_(
    getSharedSettingValue_(registry, SWITCH_MAINTENANCE)
  );
  if (!probe || !maintenance || probe.nonce !== nonce || maintenance.nonce !== nonce) {
    adminError_('CONFLICT');
  }
  if (!isFutureSwitchTime_(probe.expiresAt) ||
      maintenance.expiresAt !== probe.expiresAt ||
      typeof probe.candidateSpreadsheetId !== 'string' ||
      !probe.candidateSpreadsheetId.trim()) {
    clearAdminSwitchState_(registry);
    adminError_('SHEET_CONNECTION_FAILED');
  }

  var ack = parseAdminSwitchObject_(getSharedSettingValue_(registry, SWITCH_PROBE_ACK));
  var configuration = requireSwitchProbeConfiguration_();
  if (!isValidAdminSwitchAck_(ack, probe, configuration.secret)) {
    clearAdminSwitchState_(registry);
    adminError_('SHEET_CONNECTION_FAILED');
  }

  var candidate;
  try {
    candidate = openSpreadsheetById_(probe.candidateSpreadsheetId);
    validateAdminSpreadsheet_(candidate);
  } catch (error) {
    clearAdminSwitchState_(registry);
    if (error && error.publicCode) throw error;
    adminError_('SHEET_CONNECTION_FAILED');
  }

  var pointer = String(registry.getId()) === probe.candidateSpreadsheetId
    ? ''
    : probe.candidateSpreadsheetId;
  setSharedSettingValue_(registry, ACTIVE_SPREADSHEET_ID, pointer);
  setSharedSettingValue_(registry, SWITCH_MAINTENANCE, '');
  try {
    setSharedSettingValue_(registry, SWITCH_PROBE, '');
    setSharedSettingValue_(registry, SWITCH_PROBE_ACK, '');
  } catch (_ignored) {
    // Maintenance is already cleared after publication; stale probe rows are inert.
  }
  return {
    connected: true,
    sheetName: String(candidate.getName ? candidate.getName() : 'Connected'),
    warning: '旧数据仍保留在原数据表中；系统不会自动迁移任何数据。'
  };
}

function requireSwitchProbeConfiguration_() {
  var properties = PropertiesService.getScriptProperties();
  var secret = properties.getProperty(SWITCH_PROBE_SHARED_SECRET);
  var publicBackendUrl = properties.getProperty(PUBLIC_BACKEND_URL);
  if (typeof secret !== 'string' || secret.length < 32 ||
      typeof publicBackendUrl !== 'string' ||
      !/^https:\/\/script\.google\.com\/macros\/s\/[^/?#]+\/exec$/.test(publicBackendUrl)) {
    adminError_('SHEET_CONNECTION_FAILED');
  }
  return { secret: secret, publicBackendUrl: publicBackendUrl };
}

function createAdminSwitchNonce_(secret) {
  var randomInput = Utilities.getUuid() + '\n' + Utilities.getUuid();
  return Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(randomInput, secret)
  );
}

function isValidAdminSwitchAck_(ack, probe, secret) {
  if (!ack || ack.nonce !== probe.nonce || ack.expiresAt !== probe.expiresAt ||
      typeof ack.verifiedAt !== 'string' || typeof ack.signature !== 'string') {
    return false;
  }
  var verifiedAt = new Date(ack.verifiedAt).getTime();
  var expiresAt = new Date(probe.expiresAt).getTime();
  if (!isFinite(verifiedAt) || !isFinite(expiresAt) || verifiedAt > expiresAt) return false;
  return ack.signature === signAdminSwitchAck_(
    probe.nonce,
    probe.candidateSpreadsheetId,
    probe.expiresAt,
    secret
  );
}

function signAdminSwitchAck_(nonce, candidateSpreadsheetId, expiresAt, secret) {
  return Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(
      nonce + '\n' + candidateSpreadsheetId + '\n' + expiresAt,
      secret
    )
  );
}

function parseAdminSwitchObject_(serialized) {
  if (typeof serialized !== 'string' || !serialized.trim()) return null;
  try {
    var value = JSON.parse(serialized);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch (_ignored) {
    return null;
  }
}

function isFutureSwitchTime_(serialized) {
  if (typeof serialized !== 'string') return false;
  var time = new Date(serialized).getTime();
  return isFinite(time) && time > Date.now();
}

function clearAdminSwitchState_(registry) {
  setSharedSettingValue_(registry, SWITCH_MAINTENANCE, '');
  setSharedSettingValue_(registry, SWITCH_PROBE, '');
  setSharedSettingValue_(registry, SWITCH_PROBE_ACK, '');
}

function getAdminSourceBundles_(payload) {
  if (payload !== undefined && payload !== null &&
      (typeof payload !== 'object' || Array.isArray(payload))) {
    adminError_('INVALID_REQUEST');
  }
  return {
    publicBackend: PUBLIC_BACKEND_SOURCE_BUNDLE_,
    staffAdmin: STAFF_ADMIN_SOURCE_BUNDLE_
  };
}

function validateAdminSpreadsheet_(spreadsheet) {
  Object.keys(STAFF_SHEET_DEFINITIONS).forEach(function(sheetName) {
    var sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet || sheet.getLastRow() < 1) adminError_('SHEET_CONNECTION_FAILED');
    var expected = STAFF_SHEET_DEFINITIONS[sheetName];
    var actual = sheet.getRange(1, 1, 1, expected.length).getValues()[0];
    if (!expected.every(function(header, index) { return actual[index] === header; })) {
      adminError_('SHEET_CONNECTION_FAILED');
    }
  });
  return true;
}

function requireAdminObject_(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    adminError_('INVALID_REQUEST');
  }
  return payload;
}

function readAdminRows_(spreadsheet, sheetName) {
  var sheet = getRequiredSheet_(spreadsheet, sheetName);
  if (sheet.getLastRow() <= 1) return [];
  var headers = STAFF_SHEET_DEFINITIONS[sheetName];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues().map(function(values, index) {
    var row = { rowNumber: index + 2 };
    headers.forEach(function(header, column) { row[header] = values[column]; });
    return row;
  });
}

function findAdminRow_(spreadsheet, sheetName, key, value) {
  return readAdminRows_(spreadsheet, sheetName).filter(function(row) {
    return row[key] === value;
  })[0] || null;
}

function writeAdminRow_(spreadsheet, sheetName, rowNumber, row) {
  var sheet = getRequiredSheet_(spreadsheet, sheetName);
  var values = normalizeRow_(sheetName, row);
  var targetRow = rowNumber || sheet.getLastRow() + 1;
  if (typeof journalAdminWrite_ === 'function') {
    journalAdminWrite_(
      sheet,
      targetRow,
      values.length,
      !rowNumber && targetRow > sheet.getLastRow()
    );
  }
  sheet.getRange(targetRow, 1, 1, values.length).setValues([values]);
  return targetRow;
}

function snapshotAdminRows_(spreadsheet, sheetName, rows) {
  var sheet = getRequiredSheet_(spreadsheet, sheetName);
  return rows.map(function(row) {
    return {
      sheet: sheet,
      rowNumber: row.rowNumber,
      values: normalizeRow_(sheetName, row)
    };
  });
}

function restoreAdminSnapshots_(snapshots) {
  var failures = [];
  snapshots.forEach(function(snapshot) {
    try {
      snapshot.sheet.getRange(
        snapshot.rowNumber, 1, 1, snapshot.values.length
      ).setValues([snapshot.values]);
    } catch (error) {
      failures.push(error);
    }
  });
  return failures;
}

function appendAdminAudit_(spreadsheet, action, entityType, entityId, actor, details) {
  writeAdminRow_(spreadsheet, '操作记录', null, {
    auditId: Utilities.getUuid(),
    action: action,
    entityType: entityType,
    entityId: entityId,
    actor: actor,
    details: JSON.stringify(details || {}),
    createdAt: new Date().toISOString()
  });
}

function appendAdminAuditSafely_(spreadsheet, action, entityType, entityId, actor, details) {
  try {
    appendAdminAudit_(spreadsheet, action, entityType, entityId, actor, details);
    return null;
  } catch (error) {
    return error;
  }
}

function adminField_(source, key, existing, fallback) {
  if (Object.prototype.hasOwnProperty.call(source, key)) return source[key];
  if (existing !== undefined && existing !== null && existing !== '') return existing;
  return fallback;
}

function adminTextField_(source, key, existing, fallback) {
  var value = adminField_(source, key, existing, fallback);
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > 5000) adminError_('INVALID_REQUEST');
  return value.trim();
}

function adminBooleanField_(source, key, existing, fallback) {
  if (!Object.prototype.hasOwnProperty.call(source, key)) {
    return existing === undefined || existing === null ? fallback : existing === true;
  }
  if (typeof source[key] !== 'boolean') adminError_('INVALID_REQUEST');
  return source[key];
}

function copyAdminBooleanField_(source, target, key) {
  if (!Object.prototype.hasOwnProperty.call(source, key)) return;
  if (typeof source[key] !== 'boolean') adminError_('INVALID_REQUEST');
  target[key] = source[key];
}

function adminDateField_(value) {
  if (value === '' || value === undefined || value === null) return '';
  var text = String(value).trim();
  if (!text || !isFinite(Date.parse(text))) adminError_('INVALID_REQUEST');
  return text;
}

function adminNonNegativeInteger_(value) {
  var number = Number(value);
  if (!isFinite(number) || number < 0 || Math.floor(number) !== number) {
    adminError_('INVALID_REQUEST');
  }
  return number;
}

function adminPositiveInteger_(value) {
  var number = adminNonNegativeInteger_(value);
  if (number < 1) adminError_('INVALID_REQUEST');
  return number;
}

function adminTruthy_(value) {
  return value === true || value === 1 || String(value).toLowerCase() === 'true' || String(value) === '1';
}

function ensureAdminEventPolicy_(settings, eventId) {
  if (!settings.registration || typeof settings.registration !== 'object' ||
      Array.isArray(settings.registration)) settings.registration = {};
  if (!settings.registration.events || typeof settings.registration.events !== 'object' ||
      Array.isArray(settings.registration.events)) settings.registration.events = {};
  if (!settings.registration.events[eventId] ||
      typeof settings.registration.events[eventId] !== 'object' ||
      Array.isArray(settings.registration.events[eventId])) {
    settings.registration.events[eventId] = {};
  }
  return settings.registration.events[eventId];
}

function ensureAdminSessionPolicy_(settings, eventId, sessionId) {
  var eventPolicy = ensureAdminEventPolicy_(settings, eventId);
  if (!eventPolicy.sessions || typeof eventPolicy.sessions !== 'object' ||
      Array.isArray(eventPolicy.sessions)) eventPolicy.sessions = {};
  if (!eventPolicy.sessions[sessionId] || typeof eventPolicy.sessions[sessionId] !== 'object' ||
      Array.isArray(eventPolicy.sessions[sessionId])) eventPolicy.sessions[sessionId] = {};
  return eventPolicy.sessions[sessionId];
}

function adminEventProjection_(event, settings) {
  var policy = ensureAdminEventPolicy_(settings || {}, event.eventId);
  return {
    eventId: String(event.eventId || ''),
    title: String(event.title || ''),
    description: String(event.description || ''),
    status: String(event.status || ''),
    opensAt: String(event.opensAt || ''),
    closesAt: String(event.closesAt || ''),
    location: String(event.location || ''),
    selectionMode: String(event.selectionMode || ''),
    minChoices: Number(event.minChoices || 0),
    maxChoices: Number(event.maxChoices || 0),
    seatMode: String(event.seatMode || 'none'),
    seatZones: parseAdminStringArray_(event.seatZones),
    showOpeningCountdown: policy.showOpeningCountdown === true,
    showClosingCountdown: policy.showClosingCountdown === true,
    cancellationEnabled: policy.cancellationEnabled === true,
    seatExchangeEnabled: policy.seatExchangeEnabled === true,
    seatHoldsEnabled: policy.seatHoldsEnabled === true,
    seatHoldMinutes: adminPositiveInteger_(policy.seatHoldMinutes || 5),
    createdAt: String(event.createdAt || ''),
    updatedAt: String(event.updatedAt || '')
  };
}

function adminSessionProjection_(session, settings) {
  var eventPolicy = ensureAdminEventPolicy_(settings || {}, session.eventId);
  var policy = eventPolicy.sessions && eventPolicy.sessions[session.sessionId] || {};
  return {
    sessionId: String(session.sessionId || ''),
    eventId: String(session.eventId || ''),
    title: String(session.title || ''),
    speaker: String(session.speaker || ''),
    startsAt: String(session.startsAt || ''),
    endsAt: String(session.endsAt || ''),
    location: String(policy.location || ''),
    capacity: Number(session.capacity || 0),
    required: adminTruthy_(session.required),
    groupRule: String(policy.groupRule || ''),
    status: String(session.status || ''),
    createdAt: String(session.createdAt || ''),
    updatedAt: String(session.updatedAt || '')
  };
}

function adminSeatProjection_(seat) {
  return {
    seatId: String(seat.seatId || ''),
    eventId: String(seat.eventId || ''),
    sessionId: String(seat.sessionId || ''),
    label: String(seat.label || ''),
    zone: String(seat.zone || ''),
    status: String(seat.status || ''),
    holderRegistrationId: seat.holderRegistrationId ? 'assigned' : '',
    createdAt: String(seat.createdAt || ''),
    updatedAt: String(seat.updatedAt || '')
  };
}

function adminQuestionProjection_(question, settings) {
  var policy = ensureAdminEventPolicy_(settings || {}, question.eventId);
  var identityFields = Array.isArray(policy.identityFields) ? policy.identityFields :
    (settings && settings.registration && Array.isArray(settings.registration.identityFields)
      ? settings.registration.identityFields : []);
  var parsed = parseAdminQuestionOptions_(question.options);
  var semanticRole = '';
  var fieldRoles = policy.fieldRoles && typeof policy.fieldRoles === 'object' &&
    !Array.isArray(policy.fieldRoles) ? policy.fieldRoles : {};
  Object.keys(fieldRoles).some(function(role) {
    if (fieldRoles[role] !== question.questionId) return false;
    semanticRole = role;
    return true;
  });
  return {
    questionId: String(question.questionId || ''),
    eventId: String(question.eventId || ''),
    label: String(question.label || ''),
    type: String(question.type || ''),
    required: adminTruthy_(question.required),
    options: parsed.choices,
    validation: parsed.validation,
    sortOrder: Number(question.sortOrder || 0),
    status: String(question.status || ''),
    showOnTicket: adminListHas_(policy.showOnTicketFields, question.questionId),
    duplicateIdentity: adminListHas_(identityFields, question.questionId),
    semanticRole: semanticRole,
    createdAt: String(question.createdAt || ''),
    updatedAt: String(question.updatedAt || '')
  };
}

function normalizeAdminQuestionValidation_(type, source, choices) {
  var validation = source && typeof source === 'object' && !Array.isArray(source)
    ? source : {};
  var allowed = {
    minLength: true, maxLength: true, min: true, max: true,
    pattern: true, minSelections: true, maxSelections: true
  };
  var normalized = {};
  Object.keys(validation).forEach(function(key) {
    if (!allowed[key]) adminError_('INVALID_REQUEST');
    var value = validation[key];
    if (key === 'pattern') {
      if (typeof value !== 'string' || value.length > 500) adminError_('INVALID_REQUEST');
      try { new RegExp(value); } catch (_invalidPattern) { adminError_('INVALID_REQUEST'); }
      normalized[key] = value;
      return;
    }
    var number = Number(value);
    if (!isFinite(number)) adminError_('INVALID_REQUEST');
    if (key === 'minLength' || key === 'maxLength' ||
        key === 'minSelections' || key === 'maxSelections') {
      if (number < 0 || Math.floor(number) !== number) adminError_('INVALID_REQUEST');
    }
    normalized[key] = number;
  });
  if (normalized.minLength !== undefined && normalized.maxLength !== undefined &&
      normalized.minLength > normalized.maxLength) adminError_('INVALID_REQUEST');
  if (normalized.min !== undefined && normalized.max !== undefined &&
      normalized.min > normalized.max) adminError_('INVALID_REQUEST');
  if (normalized.minSelections !== undefined && normalized.maxSelections !== undefined &&
      normalized.minSelections > normalized.maxSelections) adminError_('INVALID_REQUEST');
  if ((normalized.minSelections !== undefined || normalized.maxSelections !== undefined) &&
      type !== 'checkbox') adminError_('INVALID_REQUEST');
  if (normalized.maxSelections !== undefined && normalized.maxSelections > choices.length) {
    adminError_('INVALID_REQUEST');
  }
  return normalized;
}

function adminQuestionStorage_(choices, validation) {
  var result = { choices: choices.slice() };
  Object.keys(validation || {}).forEach(function(key) { result[key] = validation[key]; });
  return result;
}

function adminQuestionSemanticRole_(request, policy, questionId, type, status) {
  if (!policy.fieldRoles || typeof policy.fieldRoles !== 'object' ||
      Array.isArray(policy.fieldRoles)) policy.fieldRoles = {};
  var existingRole = '';
  Object.keys(policy.fieldRoles).some(function(role) {
    if (policy.fieldRoles[role] !== questionId) return false;
    existingRole = role;
    return true;
  });
  var requested = Object.prototype.hasOwnProperty.call(request, 'semanticRole')
    ? String(request.semanticRole || '').trim().toLowerCase() : existingRole;
  if (status !== 'active') requested = '';
  var roleTypes = {
    name: { text: true, textarea: true },
    email: { email: true },
    phone: { tel: true }
  };
  if (requested && (!roleTypes[requested] || !roleTypes[requested][type])) {
    adminError_('INVALID_REQUEST');
  }
  Object.keys(policy.fieldRoles).forEach(function(role) {
    if (policy.fieldRoles[role] === questionId) delete policy.fieldRoles[role];
  });
  if (requested) policy.fieldRoles[requested] = questionId;
  return requested;
}

function parseAdminQuestionOptions_(serialized) {
  if (!serialized) return { choices: [], validation: {} };
  try {
    var parsed = typeof serialized === 'string' ? JSON.parse(serialized) : serialized;
    if (Array.isArray(parsed)) return { choices: parsed, validation: {} };
    if (!parsed || typeof parsed !== 'object') return { choices: [], validation: {} };
    var validation = parsed.validation && typeof parsed.validation === 'object' &&
      !Array.isArray(parsed.validation) ? parsed.validation : {};
    ['minLength', 'maxLength', 'min', 'max', 'pattern', 'minSelections', 'maxSelections']
      .forEach(function(key) {
        if (parsed[key] !== undefined) validation[key] = parsed[key];
      });
    return {
      choices: Array.isArray(parsed.choices) ? parsed.choices :
        (Array.isArray(parsed.options) ? parsed.options : []),
      validation: validation
    };
  } catch (_ignored) {
    return { choices: [], validation: {} };
  }
}

function parseAdminStringArray_(serialized) {
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

function parseAdminAnswers_(serialized) {
  try {
    var parsed = typeof serialized === 'string' ? JSON.parse(serialized) : serialized;
    if (parsed && typeof parsed === 'object' && parsed.values &&
        typeof parsed.values === 'object' && !Array.isArray(parsed.values)) return parsed;
    return { values: parsed && typeof parsed === 'object' ? parsed : {} };
  } catch (_ignored) {
    return { values: {} };
  }
}

function maskAdminName_(value) {
  var text = String(value || '').trim();
  if (!text) return '';
  return text.slice(0, 1) + new Array(Math.max(2, text.length)).join('*');
}

function maskAdminValue_(value) {
  if (typeof value === 'boolean') return '****';
  var text = String(value === undefined || value === null ? '' : value).trim();
  if (!text) return '';
  if (text.indexOf('@') !== -1) {
    var parts = text.split('@');
    return parts[0].slice(0, 1) + '***@' + parts.slice(1).join('@');
  }
  return text.length <= 4 ? '****' : text.slice(0, 2) + '****' + text.slice(-2);
}

function maskAdminAnswers_(answers) {
  var masked = {};
  Object.keys(answers || {}).forEach(function(key) {
    var value = answers[key];
    if (Array.isArray(value)) {
      masked[key] = value.map(maskAdminValue_);
    } else {
      masked[key] = maskAdminValue_(value);
    }
  });
  return masked;
}

function adminListHas_(values, value) {
  return Array.isArray(values) && values.indexOf(value) !== -1;
}

function updateAdminFlagList_(values, value, enabled) {
  var list = Array.isArray(values) ? values.filter(function(item) {
    return typeof item === 'string' && item !== value;
  }) : [];
  if (enabled) list.push(value);
  return list;
}

function validateAdminIdentityFields_(identityFields, questions, candidate) {
  if (!Array.isArray(identityFields)) adminError_('CONFLICT');
  if (!identityFields.length) return;
  var questionsById = {};
  questions.forEach(function(question) {
    if (question.eventId === candidate.eventId) questionsById[question.questionId] = question;
  });
  questionsById[candidate.questionId] = candidate;
  var seen = {};
  identityFields.forEach(function(questionId) {
    if (typeof questionId !== 'string' || !questionId || seen[questionId]) {
      adminError_('CONFLICT');
    }
    seen[questionId] = true;
    var question = questionsById[questionId];
    if (!question || String(question.status || '').toLowerCase() !== 'active' ||
        !adminTruthy_(question.required)) {
      adminError_('CONFLICT');
    }
  });
}
