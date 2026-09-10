var PUBLIC_ERROR_MESSAGES = {
  CANCELLATION_DISABLED: 'Cancellation is not enabled for this event.',
  SEAT_HOLD_DISABLED: 'Seat holds are not enabled for this event.',
  SEAT_HOLD_OWNERSHIP: 'This seat hold belongs to another browser session.',
  LEGACY_MIGRATION_REQUIRED: 'Existing legacy activity data must be migrated before activation.',
  EVENT_NOT_FOUND: '未找到该活动。',
  INVALID_REQUEST: '提交信息无效，请检查后重试。',
  REGISTRATION_CLOSED: '报名已截止。',
  REGISTRATION_FULL: '报名名额已满。',
  REGISTRATION_NOT_OPEN: '报名尚未开放。',
  DUPLICATE_REGISTRATION: '相同身份信息已报名。',
  SEAT_UNAVAILABLE: '所选座位不可用。',
  SEAT_EXCHANGE_DISABLED: '该活动不允许更换座位。',
  INTEGRITY_ERROR: '数据一致性检查失败，请联系管理员。',
  EXCHANGE_PENDING_CLEANUP: '座位更换正在清理旧座位，请稍后重试。',
  TICKET_ALREADY_VERIFIED: '该凭证已完成验票。',
  TICKET_NOT_FOUND: '未找到对应凭证。',
  TICKET_VERIFICATION_FAILED: '验证信息不匹配。',
  TOKEN_INVALID: '凭证无效或已过期。',
  INTERNAL_REQUEST_DENIED: '受保护操作不可用。',
  ADMIN_ACTION_DENIED: '管理员功能不可用。',
  STAFF_ACTION_DENIED: '员工签到不可用。',
  NOT_FOUND: '未找到对应记录。',
  CONFLICT: '当前数据状态不允许此操作。',
  CONFIRMATION_REQUIRED: '此操作需要明确确认。',
  SHEET_CONNECTION_FAILED: '无法连接到指定的数据表。',
  TICKET_INACTIVE: '该凭证当前不可签到。',
  SESSION_NOT_REGISTERED: '该凭证未报名此场讲座。',
  CHECK_IN_CLOSED: '当前不在此场讲座的签到时间内。',
  CHECK_IN_DISABLED: '此活动不需要签到，二维码仍可用于验票。',
  ALREADY_CHECKED_IN: '此场讲座已完成签到。',
  MAINTENANCE: '系统正在切换数据连接，请稍后重试。',
  NOT_IMPLEMENTED: '请求暂不可用。',
  INTERNAL: '请求未能完成，请稍后重试。'
};

var PUBLIC_ROUTES = {
  'listEvents': function(payload) { return listEvents(payload); },
  'getEvent': function(payload) { return getEvent(payload); },
  'getBundlePlan': function(payload) { return getBundlePlan(payload); },
  'createBundleRegistration': function(payload) { return createBundleRegistration(payload); },
  'verifyBundleTicket': function(payload) { return verifyBundleTicket(payload); },
  'createSeatHold': function(payload) { return createSeatHold(payload); },
  'releaseSeatHold': function(payload) { return releaseSeatHold(payload); },
  'createRegistration': function(payload) { return createRegistration(payload); },
  'recoverTicket': function(payload) { return recoverTicket(payload); },
  'lookupTicket': function(payload) { return lookupTicket(payload); },
  'verifyTicket': function(payload) { return verifyTicket(payload); },
  'cancelRegistration': function(payload) { return cancelRegistration(payload); },
  'exchangeSeat': function(payload) { return exchangeSeat(payload); },
  'updateRegistrationSessions': function(payload) { return updateRegistrationSessions(payload); },
  'probeSheetSwitch': function(payload) { return probeSheetSwitch(payload); },
  'staffScannerCheckIn': function(payload) { return staffScannerCheckIn(payload); },
  'internalRequest': function(payload) { return handleInternalRequest_(payload); }
};

/** Returns only participant-safe plan and rule information for one open combination plan. */
function getBundlePlan(payload) {
  return runPublicEventRead_(function() {
    if (!payload || typeof payload.planId !== 'string' || !payload.planId.trim()) {
      publicEventReadError_('INVALID_REQUEST');
    }
    return withScriptLock(function() {
      var registry = getRegistrySpreadsheet_();
      var planSheet = registry.getSheetByName('\u7ec4\u5408\u8ba1\u5212');
      var ruleSheet = registry.getSheetByName('\u7ec4\u5408\u6d3b\u52a8\u89c4\u5219');
      var itemSheet = registry.getSheetByName('\u7ec4\u5408\u9879\u76ee');
      var entitlementSheet = registry.getSheetByName('\u7ec4\u5408\u8d44\u683c');
      if (!planSheet || !ruleSheet || !entitlementSheet) publicEventReadError_('EVENT_NOT_FOUND');
      var planId = payload.planId.trim();
      var plans = bundleSheetRows_(planSheet, BUNDLE_SHEET_HEADERS_['\u7ec4\u5408\u8ba1\u5212']).filter(function(plan) {
        return plan.planId === planId && String(plan.status || '').toLowerCase() === 'open';
      });
      if (plans.length !== 1) publicEventReadError_('EVENT_NOT_FOUND');
      var now = new Date();
      if (Date.parse(plans[0].opensAt) > now.getTime()) publicEventReadError_('REGISTRATION_NOT_OPEN');
      if (Date.parse(plans[0].closesAt) <= now.getTime()) publicEventReadError_('REGISTRATION_CLOSED');
      var entitlements = bundleSheetRows_(entitlementSheet, BUNDLE_SHEET_HEADERS_['\u7ec4\u5408\u8d44\u683c']);
      var catalogById = {};
      readRows(registry, '\u6d3b\u52a8\u76ee\u5f55').forEach(function(event) {
        catalogById[String(event.eventId || '')] = String(event.title || '');
      });
      var rules = bundleSheetRows_(ruleSheet, BUNDLE_SHEET_HEADERS_['\u7ec4\u5408\u6d3b\u52a8\u89c4\u5219']).filter(function(rule) {
        return rule.planId === planId;
      }).map(function(rule) {
        var eventId = String(rule.eventId);
        var used = entitlements.filter(function(row) {
          return row.planId === planId && row.eventId === eventId &&
            String(row.status || '').toLowerCase() === 'active';
        }).length;
        var availability = bundleRulePublicAvailability_(rule, used, now);
        return {
          eventId: eventId, title: catalogById[eventId] || eventId,
          fixedTicketCount: Number(rule.fixedTicketCount), capacity: Number(rule.capacity || 0),
          used: used, opensAt: String(rule.opensAt || ''), closesAt: String(rule.closesAt || ''),
          status: availability.status, available: availability.available
        };
      });
      var items = itemSheet ? bundleSheetRows_(itemSheet, BUNDLE_SHEET_HEADERS_['\u7ec4\u5408\u9879\u76ee']).filter(function(item) {
        return item.planId === planId;
      }).map(function(item) {
        var used = entitlements.filter(function(row) { return row.planId === planId && row.eventId === item.bundleItemId && String(row.status || '').toLowerCase() === 'active'; }).length;
        var availability = bundleRulePublicAvailability_({ status: item.status, opensAt: item.startsAt, closesAt: item.endsAt, capacity: item.capacity }, used, now);
        return { itemId: String(item.bundleItemId), title: String(item.title), fixedTicketCount: Number(item.fixedTicketCount), capacity: Number(item.capacity || 0), used: used, startsAt: String(item.startsAt), endsAt: String(item.endsAt), status: availability.status, available: availability.available };
      }) : [];
      return {
        plan: { planId: planId, title: String(plans[0].title), description: String(plans[0].description || ''), totalTicketLimit: Number(plans[0].totalTicketLimit), opensAt: String(plans[0].opensAt), closesAt: String(plans[0].closesAt) },
        rules: rules, items: items,
        fields: bundleRegistrationFields_().map(function(field) { return publicQuestionProjection_(field, {}); }),
        serverNow: now.toISOString()
      };
    });
  });
}

function createBundleRegistration(payload) {
  return runRegistrationService_(function() {
    return withScriptLock(function() {
      if (!payload || typeof payload.planId !== 'string' || !Array.isArray(payload.itemIds || payload.eventIds)) registrationError_('INVALID_REQUEST');
      if (payload.answers && (typeof payload.answers !== 'object' || Array.isArray(payload.answers)) ||
          payload.uploads && (typeof payload.uploads !== 'object' || Array.isArray(payload.uploads))) {
        registrationError_('INVALID_REQUEST');
      }
      var registry = getRegistrySpreadsheet_();
      var planSheet = registry.getSheetByName('\u7ec4\u5408\u8ba1\u5212');
      var ruleSheet = registry.getSheetByName('\u7ec4\u5408\u6d3b\u52a8\u89c4\u5219');
      var itemSheet = registry.getSheetByName('\u7ec4\u5408\u9879\u76ee');
      var registrationSheet = registry.getSheetByName('\u7ec4\u5408\u62a5\u540d');
      var entitlementSheet = registry.getSheetByName('\u7ec4\u5408\u8d44\u683c');
      if (!planSheet || !ruleSheet || !registrationSheet || !entitlementSheet) registrationError_('EVENT_NOT_FOUND');
      var now = new Date(); var planId = payload.planId.trim();
      var plans = bundleSheetRows_(planSheet, BUNDLE_SHEET_HEADERS_['\u7ec4\u5408\u8ba1\u5212']).filter(function(plan) { return plan.planId === planId; });
      if (plans.length !== 1 || String(plans[0].status || '').toLowerCase() !== 'open') registrationError_('REGISTRATION_CLOSED');
      if (Date.parse(plans[0].opensAt) > now.getTime()) registrationError_('REGISTRATION_NOT_OPEN');
      if (Date.parse(plans[0].closesAt) <= now.getTime()) registrationError_('REGISTRATION_CLOSED');
      var requested = {}; (payload.itemIds || payload.eventIds).forEach(function(id) { if (typeof id === 'string' && id.trim()) requested[id.trim()] = true; });
      if (!Object.keys(requested).length) registrationError_('INVALID_REQUEST');
      var nativeItems = itemSheet ? bundleSheetRows_(itemSheet, BUNDLE_SHEET_HEADERS_['\u7ec4\u5408\u9879\u76ee']).filter(function(item) { return item.planId === planId && requested[item.bundleItemId]; }) : [];
      var rules = nativeItems.length ? nativeItems.map(function(item) { return { eventId: String(item.bundleItemId), fixedTicketCount: Number(item.fixedTicketCount), capacity: Number(item.capacity), opensAt: item.startsAt, closesAt: item.endsAt, status: item.status }; }) : bundleSheetRows_(ruleSheet, BUNDLE_SHEET_HEADERS_['\u7ec4\u5408\u6d3b\u52a8\u89c4\u5219']).filter(function(rule) { return rule.planId === planId && requested[rule.eventId]; });
      if (rules.length !== Object.keys(requested).length) registrationError_('INVALID_REQUEST');
      var entitlements = bundleSheetRows_(entitlementSheet, BUNDLE_SHEET_HEADERS_['\u7ec4\u5408\u8d44\u683c']);
      var total = 0;
      rules.forEach(function(rule) {
        total += Number(rule.fixedTicketCount);
        var used = entitlements.filter(function(row) { return row.planId === planId && row.eventId === rule.eventId && row.status === 'active'; }).length;
        var availability = bundleRulePublicAvailability_(rule, used, now);
        if (availability.status === 'not_open') registrationError_('REGISTRATION_NOT_OPEN');
        if (availability.status === 'closed') registrationError_('REGISTRATION_CLOSED');
        if (availability.status === 'full') registrationError_('REGISTRATION_FULL');
      });
      if (total > Number(plans[0].totalTicketLimit)) registrationError_('INVALID_REQUEST');
      var registrationId = Utilities.getUuid(); var participantId = Utilities.getUuid();
      var ticketNumber = 'BND-' + Utilities.getUuid().replace(/-/g, '').slice(0, 10).toUpperCase();
      var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''); var timestamp = now.toISOString();
      var questions = bundleRegistrationFields_();
      var normalizedUploads = validateRegistrationUploads_(questions, payload.uploads);
      var submittedAnswers = {};
      Object.keys(payload.answers || {}).forEach(function(questionId) { submittedAnswers[questionId] = payload.answers[questionId]; });
      Object.keys(normalizedUploads).forEach(function(questionId) {
        submittedAnswers[questionId] = normalizedUploads[questionId].map(function(file) {
          return { originalName: file.originalName, mimeType: file.mimeType, size: file.size };
        });
      });
      var answers = validateDynamicAnswers_(questions, submittedAnswers);
      var uploadReceipt = null;
      var registrationRowNumber = 0;
      try {
        var savedUploads = saveRegistrationUploads_('bundle-' + planId, registrationId, normalizedUploads);
        uploadReceipt = savedUploads.receipt;
        Object.keys(savedUploads.answersByQuestion).forEach(function(questionId) {
          answers[questionId] = savedUploads.answersByQuestion[questionId];
        });
        registrationRowNumber = registrationSheet.getLastRow() + 1;
        registrationSheet.getRange(registrationRowNumber, 1, 1, BUNDLE_SHEET_HEADERS_['\u7ec4\u5408\u62a5\u540d'].length).setValues([bundleValues_(BUNDLE_SHEET_HEADERS_['\u7ec4\u5408\u62a5\u540d'], { bundleRegistrationId: registrationId, planId: planId, participantId: participantId, ticketNumber: ticketNumber, tokenDigest: digestTicketToken_(token), answers: JSON.stringify(answers), status: 'active', createdAt: timestamp })]);
        var entitlementRows = rules.map(function(rule) {
          return bundleValues_(BUNDLE_SHEET_HEADERS_['\u7ec4\u5408\u8d44\u683c'], {
            entitlementId: Utilities.getUuid(), planId: planId, bundleRegistrationId: registrationId,
            eventId: rule.eventId, fixedTicketCount: Number(rule.fixedTicketCount), status: 'active',
            createdAt: timestamp, updatedAt: timestamp
          });
        });
        entitlementSheet.getRange(
          entitlementSheet.getLastRow() + 1, 1, rules.length,
          BUNDLE_SHEET_HEADERS_['\u7ec4\u5408\u8d44\u683c'].length
        ).setValues(entitlementRows);
      } catch (error) {
        if (registrationRowNumber) registrationSheet.deleteRows(registrationRowNumber, 1);
        if (uploadReceipt) rollbackRegistrationUploads_(uploadReceipt);
        throw error;
      }
      return { ticketNumber: ticketNumber, token: token, selectedEvents: rules.map(function(rule) { return { eventId: rule.eventId, fixedTicketCount: Number(rule.fixedTicketCount) }; }), createdAt: timestamp };
    });
  });
}

function bundleRegistrationFields_() {
  return [
    { questionId: 'name', label: '姓名', type: 'text', required: true, options: '{}', status: 'active', sortOrder: 1 },
    { questionId: 'phone', label: '电话号码', type: 'tel', required: true, options: '{}', status: 'active', sortOrder: 2 },
    {
      questionId: 'photo', label: '付款证明／相关照片（如需要）', type: 'photo', required: false,
      options: JSON.stringify({ upload: { maxFiles: 3, maxBytes: 5242880, accept: ['image/jpeg', 'image/png', 'image/heic', 'image/heif'] } }),
      status: 'active', sortOrder: 3
    }
  ];
}

function bundleRulePublicAvailability_(rule, used, now) {
  var status = String(rule && rule.status || '').toLowerCase();
  var timestamp = (now instanceof Date ? now : new Date()).getTime();
  var opensAt = Date.parse(String(rule && rule.opensAt || ''));
  var closesAt = Date.parse(String(rule && rule.closesAt || ''));
  if (status !== 'open') return { available: false, status: 'closed' };
  if (isFinite(opensAt) && opensAt > timestamp) return { available: false, status: 'not_open' };
  if (isFinite(closesAt) && closesAt <= timestamp) return { available: false, status: 'closed' };
  var capacity = Number(rule && rule.capacity || 0);
  if (isFinite(capacity) && capacity > 0 && Number(used || 0) >= capacity) {
    return { available: false, status: 'full' };
  }
  return { available: true, status: 'open' };
}

function verifyBundleTicket(payload) {
  return runPublicEventRead_(function() {
    if (!payload || typeof payload.token !== 'string' || !payload.token.trim()) publicEventReadError_('TOKEN_INVALID');
    return withScriptLock(function() {
      var registry = getRegistrySpreadsheet_();
      var registrationSheet = registry.getSheetByName('\u7ec4\u5408\u62a5\u540d');
      var entitlementSheet = registry.getSheetByName('\u7ec4\u5408\u8d44\u683c');
      if (!registrationSheet || !entitlementSheet) publicEventReadError_('TOKEN_INVALID');
      var digest = digestTicketToken_(payload.token.trim());
      var registrations = bundleSheetRows_(registrationSheet, BUNDLE_SHEET_HEADERS_['\u7ec4\u5408\u62a5\u540d']).filter(function(row) { return row.tokenDigest === digest && row.status === 'active'; });
      if (registrations.length !== 1) publicEventReadError_('TOKEN_INVALID');
      var registration = registrations[0];
      var entitlements = bundleSheetRows_(entitlementSheet, BUNDLE_SHEET_HEADERS_['\u7ec4\u5408\u8d44\u683c']).filter(function(row) { return row.bundleRegistrationId === registration.bundleRegistrationId && row.status === 'active'; }).map(function(row) { return { eventId: String(row.eventId), fixedTicketCount: Number(row.fixedTicketCount) }; });
      return { ticketNumber: String(registration.ticketNumber), planId: String(registration.planId), selectedEvents: entitlements, status: 'active' };
    });
  });
}

var PUBLIC_EVENT_STATUSES_ = {
  upcoming: true,
  open: true,
  closed: true,
  live: true,
  ended: true,
  cancelled: true
};

var PUBLIC_SESSION_STATUSES_ = { active: true, open: true, upcoming: true };

/** Returns safe summaries for every participant-visible event. */
function listEvents(_payload) {
  return runPublicEventRead_(function() {
    return withScriptLock(function() {
      var registry = getRegistrySpreadsheet_();
      var settings = getAdminSettings(registry);
      var now = new Date();
      var events = getPublicEventCatalogEntries_(registry)
        .map(function(event) {
          return publicEventSummary_(event, publicEventPolicy_(settings, event.eventId), now);
        });
      return { events: events, serverNow: now.toISOString() };
    });
  });
}

/** Returns one safe participant registration definition. */
function getEvent(payload) {
  return runPublicEventRead_(function() {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
        typeof payload.eventId !== 'string' || !payload.eventId.trim()) {
      publicEventReadError_('INVALID_REQUEST');
    }
    return withScriptLock(function() {
      var registry = getRegistrySpreadsheet_();
      var eventId = payload.eventId.trim();
      var catalog = getPublicEventCatalogEntry_(registry, eventId);
      var publicSource = getPublicEventSource_(catalog, eventId);
      var spreadsheet = publicSource.spreadsheet;
      var event = publicSource.event;
      if (!event || PUBLIC_EVENT_STATUSES_[String(event.status || '').toLowerCase()] !== true) {
        publicEventReadError_('EVENT_NOT_FOUND');
      }
      var settings = getAdminSettings(registry);
      var policy = publicEventPolicy_(settings, eventId);
      var now = new Date();
      if (!publicCatalogMatchesEvent_(catalog, event, policy, now)) {
        publicEventReadError_('INTEGRITY_ERROR');
      }
      var sessions = readRows(spreadsheet, '场次')
        .filter(function(session) {
          return session.eventId === eventId &&
            PUBLIC_SESSION_STATUSES_[String(session.status || '').toLowerCase()] === true;
        })
        .map(function(session) {
          var sessionPolicy = policy.sessions && policy.sessions[session.sessionId] &&
            typeof policy.sessions[session.sessionId] === 'object'
            ? policy.sessions[session.sessionId] : {};
          return {
            id: String(session.sessionId || ''),
            title: String(session.title || ''),
            speaker: String(session.speaker || ''),
            startsAt: publicText_(session.startsAt),
            endsAt: publicText_(session.endsAt),
            location: String(sessionPolicy.location || event.location || ''),
            required: publicTruthy_(session.required),
            capacity: publicNonNegativeNumber_(session.capacity, 0),
            groupRule: publicGroupRule_(sessionPolicy.groupRule)
          };
        });
      var fields = readRows(spreadsheet, '报名问题')
        .filter(function(question) {
          return question.eventId === eventId &&
            String(question.status || '').toLowerCase() === 'active';
        })
        .sort(function(left, right) {
          return publicNonNegativeNumber_(left.sortOrder, 0) -
            publicNonNegativeNumber_(right.sortOrder, 0);
        })
        .map(function(question) {
          return publicQuestionProjection_(question, policy);
        });
      var nowMs = Date.now();
      var seats = readRows(spreadsheet, '座位')
        .filter(function(seat) {
          return seat.eventId === eventId;
        })
        .map(function(seat) {
          var status = String(seat.status || '').toLowerCase();
          var holder = String(seat.holderRegistrationId || '');
          var hold = /^HOLD\|[^|]+\|(\d+)$/.exec(holder);
          var expiredHold = status === 'held' && !!hold && Number(hold[1]) <= nowMs;
          var available = ((status === 'available' || status === 'open') && !holder) ||
            expiredHold;
          return {
            id: String(seat.seatId || ''),
            label: String(seat.label || ''),
            zone: String(seat.zone || ''),
            sessionId: String(seat.sessionId || ''),
            available: available
          };
        });
      var detail = publicEventSummary_(event, policy, now);
      detail.sessions = sessions;
      detail.seats = seats;
      detail.fields = fields;
      return { event: detail, serverNow: now.toISOString() };
    });
  });
}

function getPublicEventCatalogEntries_(registry) {
  requireExactRoutingSheet_(registry, '活动目录');
  var entries = readRows(registry, '活动目录');
  var eventIdCounts = {};
  entries.forEach(function(entry) {
    var eventId = normalizeRoutingValue_(entry.eventId);
    if (eventId) eventIdCounts[eventId] = (eventIdCounts[eventId] || 0) + 1;
  });
  return entries.filter(function(entry) {
    return PUBLIC_EVENT_STATUSES_[String(entry.status || '').toLowerCase()] === true;
  }).map(function(entry) {
    var eventId = normalizeRoutingValue_(entry.eventId);
    var validated = validateEventCatalogEntry_(registry, entry, eventId);
    if (eventIdCounts[validated.eventId] !== 1) routingError_('INTEGRITY_ERROR');
    return validated;
  });
}

function getPublicEventCatalogEntry_(registry, eventId) {
  var normalizedEventId = normalizeRoutingValue_(eventId);
  if (!normalizedEventId) publicEventReadError_('EVENT_NOT_FOUND');
  requireExactRoutingSheet_(registry, '活动目录');
  var matches = readRows(registry, '活动目录').filter(function(entry) {
    return normalizeRoutingValue_(entry.eventId) === normalizedEventId;
  });
  if (!matches.length) publicEventReadError_('EVENT_NOT_FOUND');
  var visibleMatches = matches.filter(function(entry) {
    return PUBLIC_EVENT_STATUSES_[String(entry.status || '').toLowerCase()] === true;
  });
  if (!visibleMatches.length) publicEventReadError_('EVENT_NOT_FOUND');
  if (matches.length !== 1) routingError_('INTEGRITY_ERROR');
  return validateEventCatalogEntry_(registry, visibleMatches[0], normalizedEventId);
}

function runPublicEventRead_(callback) {
  try {
    return { ok: true, data: callback() };
  } catch (error) {
    var code = error && error.publicCode ? error.publicCode : 'INTERNAL';
    return publicFailure_(code);
  }
}

function publicEventReadError_(code) {
  var error = new Error(code);
  error.publicCode = code;
  throw error;
}

function publicEventSummary_(event, policy, now) {
  return {
    id: String(event.eventId || ''),
    title: String(event.title || ''),
    description: String(event.description || ''),
    status: effectiveRegistrationEventStatus_(event, now || new Date()),
    opensAt: publicText_(event.opensAt),
    closesAt: publicText_(event.closesAt),
    location: String(event.location || ''),
    selectionMode: String(event.selectionMode || 'free').toLowerCase(),
    minChoices: publicNonNegativeNumber_(event.minChoices, 0),
    maxChoices: publicNonNegativeNumber_(event.maxChoices, 0),
    seatMode: String(event.seatMode || 'none').toLowerCase(),
    seatMapLabel: String(policy.seatMapLabel || '舞台 / 白板'),
    seatZones: publicStringArray_(event.seatZones),
    showOpeningCountdown: policy.showOpeningCountdown === true,
    showClosingCountdown: policy.showClosingCountdown === true,
    cancellationEnabled: policy.cancellationEnabled === true,
    exchangeEnabled: policy.seatExchangeEnabled === true,
    seatHoldsEnabled: policy.seatHoldsEnabled === true,
    registrationTimeLimitMinutes: publicNonNegativeNumber_(
      policy.registrationTimeLimitMinutes, 5
    ),
    totalCapacity: publicNonNegativeNumber_(policy.totalCapacity, 0),
    checkInMode: ['session', 'event', 'none'].indexOf(
      String(policy.checkInMode || 'session').toLowerCase()
    ) === -1 ? 'session' : String(policy.checkInMode || 'session').toLowerCase(),
    eventStartsAt: publicText_(policy.eventStartsAt),
    eventEndsAt: publicText_(policy.eventEndsAt)
  };
}

function publicCatalogMatchesEvent_(catalog, event, policy, now) {
  return JSON.stringify(publicEventSummary_(catalog, policy, now)) ===
    JSON.stringify(publicEventSummary_(event, policy, now));
}

function publicEventPolicy_(settings, eventId) {
  var registration = settings && settings.registration &&
    typeof settings.registration === 'object' && !Array.isArray(settings.registration)
    ? settings.registration : {};
  var eventPolicy = registration.events && registration.events[eventId] &&
    typeof registration.events[eventId] === 'object' && !Array.isArray(registration.events[eventId])
    ? registration.events[eventId] : {};
  return eventPolicy;
}

function publicQuestionProjection_(question, policy) {
  var parsed = publicQuestionConfiguration_(question.options);
  var semanticRole = '';
  var roles = policy.fieldRoles && typeof policy.fieldRoles === 'object' &&
    !Array.isArray(policy.fieldRoles) ? policy.fieldRoles : {};
  Object.keys(roles).some(function(role) {
    if (roles[role] !== question.questionId) return false;
    semanticRole = role;
    return true;
  });
  var projection = {
    id: String(question.questionId || ''),
    label: String(question.label || ''),
    type: String(question.type || '').toLowerCase(),
    required: publicTruthy_(question.required),
    options: parsed.choices,
    constraints: parsed.constraints,
    sortOrder: publicNonNegativeNumber_(question.sortOrder, 0),
    semanticRole: semanticRole
  };
  if (parsed.promptImage) projection.promptImage = parsed.promptImage;
  if (projection.type === 'photo') projection.upload = parsed.upload;
  return projection;
}

function publicQuestionConfiguration_(serialized) {
  var parsed = {};
  try {
    parsed = typeof serialized === 'string' && serialized
      ? JSON.parse(serialized) : (serialized || {});
  } catch (_ignored) {
    parsed = {};
  }
  if (Array.isArray(parsed)) parsed = { choices: parsed };
  if (!parsed || typeof parsed !== 'object') parsed = {};
  var legacy = parsed.validation && typeof parsed.validation === 'object' &&
    !Array.isArray(parsed.validation) ? parsed.validation : {};
  var constraints = {};
  ['minLength', 'maxLength', 'min', 'max', 'pattern', 'minSelections', 'maxSelections']
    .forEach(function(key) {
      if (parsed[key] !== undefined) constraints[key] = parsed[key];
      else if (legacy[key] !== undefined) constraints[key] = legacy[key];
    });
  var promptImage = publicPromptImage_(parsed.promptImage);
  return {
    choices: Array.isArray(parsed.choices) ? parsed.choices.filter(function(value) {
      return typeof value === 'string';
    }) : [],
    constraints: constraints,
    promptImage: promptImage,
    upload: publicPhotoUploadConfiguration_(parsed.upload)
  };
}

function publicPromptImage_(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  var url = String(value.url || '').trim();
  if (!/^https:\/\//i.test(url)) return null;
  return {
    url: url,
    alt: String(value.alt || '').trim().slice(0, 200)
  };
}

function publicPhotoUploadConfiguration_(value) {
  var source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  var allowed = {
    'image/jpeg': true,
    'image/png': true,
    'image/heic': true,
    'image/heif': true
  };
  var accept = Array.isArray(source.accept) ? source.accept.filter(function(type, index, list) {
    return allowed[type] === true && list.indexOf(type) === index;
  }) : Object.keys(allowed);
  if (!accept.length) accept = Object.keys(allowed);
  var maxFiles = Math.floor(Number(source.maxFiles));
  if (!isFinite(maxFiles)) maxFiles = 3;
  maxFiles = Math.max(1, Math.min(5, maxFiles));
  var maxBytes = Math.floor(Number(source.maxBytes));
  if (!isFinite(maxBytes)) maxBytes = 5 * 1024 * 1024;
  maxBytes = Math.max(1024, Math.min(5 * 1024 * 1024, maxBytes));
  return { maxFiles: maxFiles, maxBytes: maxBytes, accept: accept };
}

function publicGroupRule_(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return {
      id: String(value.id || value.groupId || ''),
      min: publicNonNegativeNumber_(value.min, 0),
      max: publicNonNegativeNumber_(value.max, 1)
    };
  }
  var text = String(value || '').trim();
  return text ? { id: text, min: 0, max: 1 } : null;
}

function publicText_(value) {
  if (value instanceof Date) return isFinite(value.getTime()) ? value.toISOString() : '';
  return value === undefined || value === null ? '' : String(value);
}

function publicStringArray_(value) {
  if (Array.isArray(value)) return value.filter(function(item) { return typeof item === 'string'; });
  try {
    var parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.filter(function(item) {
      return typeof item === 'string';
    }) : [];
  } catch (_ignored) {
    return [];
  }
}

function publicTruthy_(value) {
  return value === true || value === 1 ||
    String(value).toLowerCase() === 'true' || String(value) === '1';
}

function publicNonNegativeNumber_(value, fallback) {
  var parsed = Number(value);
  return isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** Public health page. */
function doGet() {
  return HtmlService.createHtmlOutput('Event registration service is running.');
}

/** Routes only fixed public actions and always emits a safe JSON envelope. */
function doPost(event) {
  var result;
  try {
    if (!event || !event.postData || typeof event.postData.contents !== 'string') {
      result = publicFailure_('INVALID_REQUEST');
    } else {
      var envelope = JSON.parse(event.postData.contents);
      if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) ||
          typeof envelope.action !== 'string' ||
          !Object.prototype.hasOwnProperty.call(PUBLIC_ROUTES, envelope.action) ||
          !envelope.payload || typeof envelope.payload !== 'object' || Array.isArray(envelope.payload)) {
        result = publicFailure_(
          envelope && typeof envelope.action === 'string' &&
          !Object.prototype.hasOwnProperty.call(PUBLIC_ROUTES, envelope.action)
            ? 'NOT_IMPLEMENTED' : 'INVALID_REQUEST'
        );
      } else {
        result = normalizePublicResult_(PUBLIC_ROUTES[envelope.action](envelope.payload));
      }
    }
  } catch (_ignored) {
    result = publicFailure_('INTERNAL');
  }
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function normalizePublicResult_(result) {
  if (!result || typeof result !== 'object' || typeof result.ok !== 'boolean') {
    return publicFailure_('INTERNAL');
  }
  if (result.ok === true) return { ok: true, data: result.data };
  return publicFailure_(result.code);
}

function publicFailure_(code) {
  var safeCode = typeof code === 'string' &&
    Object.prototype.hasOwnProperty.call(PUBLIC_ERROR_MESSAGES, code) ? code : 'INTERNAL';
  return { ok: false, code: safeCode, message: PUBLIC_ERROR_MESSAGES[safeCode] };
}
