var STAFF_SCANNER_PASS_PREFIX_ = 'STAFF_SCANNER_PASS_';
var STAFF_SCANNER_PASS_TTL_MS_ = 7200000;
var STAFF_CHECKIN_PIN_DIGEST_PROPERTY_ = 'STAFF_CHECKIN_PIN_DIGEST';

/** Starts a phone scanner without relying on a Google account in the browser. */
function staffScannerBootstrap(payload) {
  return withInternalActionScriptLock_(function() {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
        !staffPinMatches_(payload.staffPin)) {
      return internalMutationFailure_('STAFF_ACTION_DENIED');
    }
    var hasEvent = typeof payload.eventId === 'string' && payload.eventId.trim();
    var hasSession = typeof payload.sessionId === 'string' && payload.sessionId.trim();
    if (!hasEvent && !hasSession) {
      return { ok: true, data: { targets: internalStaffCheckInTargets_() } };
    }
    if (!hasEvent || !hasSession) return internalMutationFailure_('INVALID_REQUEST');
    try {
      return { ok: true, data: createInternalStaffScannerPass_(payload, 'phone-staff') };
    } catch (error) {
      return internalMutationFailure_(error && error.publicCode ? error.publicCode : 'INTERNAL');
    }
  });
}

function staffPinMatches_(staffPin) {
  if (typeof staffPin !== 'string' || !staffPin.trim()) return false;
  var expected = PropertiesService.getScriptProperties()
    .getProperty(STAFF_CHECKIN_PIN_DIGEST_PROPERTY_);
  if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/i.test(expected)) return false;
  return constantTimeInternalEquals_(digestTicketToken_(staffPin), expected.toLowerCase());
}

/** Returns only the activity/session metadata needed to start a staff scanner. */
function internalStaffCheckInTargets_() {
  var registry = getRegistrySpreadsheet_();
  var settings = getAdminSettings(registry);
  var policies = settings && settings.registration && settings.registration.events || {};
  return readRows(registry, '活动目录').filter(function(event) {
    return ['upcoming', 'open', 'live'].indexOf(String(event.status || '').toLowerCase()) !== -1;
  }).map(function(event) {
    var eventId = String(event.eventId || '');
    var eventPolicy = policies[eventId] || {};
    var spreadsheet = getEventSpreadsheet_(registry, eventId);
    var sessions = readRows(spreadsheet, '场次').filter(function(session) {
      return String(session.eventId || '') === eventId &&
        ['upcoming', 'open', 'live'].indexOf(String(session.status || '').toLowerCase()) !== -1;
    }).map(function(session) {
      var policy = adminCheckpointPolicy_(eventPolicy.sessions && eventPolicy.sessions[session.sessionId] || {});
      var checkpoints = [];
      for (var index = 0; index < policy.checkInCount; index += 1) {
        checkpoints.push({ checkpointId: 'checkpoint-' + (index + 1), label: internalCheckpointLabel_(policy, index) });
      }
      return {
        sessionId: String(session.sessionId || ''), title: String(session.title || ''),
        speaker: String(session.speaker || ''), startsAt: String(session.startsAt || ''),
        checkInMode: policy.checkInMode, checkpoints: checkpoints
      };
    });
    return { eventId: eventId, title: String(event.title || ''), sessions: sessions };
  }).filter(function(event) { return event.sessions.length > 0; });
}

/** Executes one scan using a short-lived pass created by an authenticated staff account. */
function staffScannerCheckIn(payload) {
  return withInternalActionScriptLock_(function() {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return internalMutationFailure_('INVALID_REQUEST');
    }
    var pass = readStaffScannerPass_(payload.scannerPass);
    if (!pass) return internalMutationFailure_('STAFF_ACTION_DENIED');
    try {
      var data = internalStaffCheckInLocked_({
        token: payload.token,
        sessionId: pass.sessionId,
        checkpointId: pass.mode === 'manual' ? pass.checkpointId : undefined,
        staffCheckpointMode: pass.mode
      }, pass.actor);
      return { ok: true, data: data };
    } catch (error) {
      return internalMutationFailure_(error && error.publicCode ? error.publicCode : 'INTERNAL');
    }
  });
}

function createInternalStaffScannerPass_(payload, actor) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    adminError_('INVALID_REQUEST');
  }
  var eventId = scannerPassId_(payload.eventId);
  var sessionId = scannerPassId_(payload.sessionId);
  var checkpointId = payload.checkpointId ? scannerPassId_(payload.checkpointId) : '';
  if (!eventId || !sessionId) adminError_('INVALID_REQUEST');
  var target = internalStaffCheckInTargets_().filter(function(event) {
    return event.eventId === eventId;
  })[0];
  var session = target && target.sessions.filter(function(candidate) {
    return candidate.sessionId === sessionId;
  })[0];
  if (!session) adminError_('INVALID_REQUEST');
  var mode = scannerPassMode_(payload.mode, session.checkInMode);
  if (mode === 'manual' && !checkpointId) adminError_('INVALID_REQUEST');
  if (mode === 'next') checkpointId = '';
  if (checkpointId && !session.checkpoints.some(function(checkpoint) {
    return checkpoint.checkpointId === checkpointId;
  })) adminError_('INVALID_REQUEST');
  var rawPass = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  var expiresAt = Date.now() + STAFF_SCANNER_PASS_TTL_MS_;
  PropertiesService.getScriptProperties().setProperty(
    STAFF_SCANNER_PASS_PREFIX_ + digestTicketToken_(rawPass),
    JSON.stringify({
      actor: String(actor || '').trim().toLowerCase(), eventId: eventId,
      sessionId: sessionId, checkpointId: checkpointId, mode: mode, expiresAt: expiresAt
    })
  );
  return { scannerPass: rawPass, expiresAt: new Date(expiresAt).toISOString() };
}

function readStaffScannerPass_(rawPass) {
  if (typeof rawPass !== 'string' || !/^[a-f0-9]{64}$/i.test(rawPass)) return null;
  var key = STAFF_SCANNER_PASS_PREFIX_ + digestTicketToken_(rawPass);
  var serialized = PropertiesService.getScriptProperties().getProperty(key);
  var pass;
  try { pass = JSON.parse(serialized || ''); } catch (_ignored) { pass = null; }
  if (!pass || typeof pass !== 'object' || Number(pass.expiresAt) <= Date.now() ||
      !scannerPassId_(pass.eventId) || !scannerPassId_(pass.sessionId) ||
      typeof pass.actor !== 'string' || !pass.actor) {
    if (serialized) PropertiesService.getScriptProperties().deleteProperty(key);
    return null;
  }
  pass.mode = scannerPassMode_(pass.mode, pass.checkpointId ? 'manual' : 'automatic');
  if (pass.mode === 'manual' && !scannerPassId_(pass.checkpointId)) return null;
  return pass;
}

function scannerPassMode_(value, fallback) {
  var requested = String(value || '').trim().toLowerCase();
  if (requested === 'manual' || requested === 'next') return requested;
  return String(fallback || '').toLowerCase() === 'manual' ? 'manual' : 'next';
}

function scannerPassId_(value) {
  var text = typeof value === 'string' ? value.trim() : '';
  return /^[A-Za-z0-9_-]{1,128}$/.test(text) ? text : '';
}
