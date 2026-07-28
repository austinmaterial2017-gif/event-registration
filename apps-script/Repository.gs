var ACTIVE_SPREADSHEET_ID = 'ACTIVE_SPREADSHEET_ID';
var ADMIN_SETTINGS = 'ADMIN_SETTINGS';
var PUBLIC_BASE_URL = 'PUBLIC_BASE_URL';
var INITIAL_ADMIN_SETTINGS = {
  attendance: {},
  registration: { events: {}, identityFields: [] }
};

var SHEET_DEFINITIONS = {
  '系统设置': ['key', 'value', 'updatedAt'],
  '活动目录': ['eventId', 'spreadsheetId', 'sheetName', 'title', 'description', 'status', 'opensAt', 'closesAt', 'location', 'selectionMode', 'minChoices', 'maxChoices', 'seatMode', 'seatZones', 'createdAt', 'updatedAt'],
  '票券索引': ['ticketNumber', 'tokenDigest', 'eventId', 'registrationId', 'status', 'createdAt', 'updatedAt'],
  '活动': ['eventId', 'title', 'description', 'status', 'opensAt', 'closesAt', 'location', 'selectionMode', 'minChoices', 'maxChoices', 'seatMode', 'seatZones', 'createdAt', 'updatedAt'],
  '场次': ['sessionId', 'eventId', 'title', 'speaker', 'startsAt', 'endsAt', 'required', 'capacity', 'status', 'createdAt', 'updatedAt'],
  '座位': ['seatId', 'eventId', 'sessionId', 'label', 'zone', 'status', 'holderRegistrationId', 'createdAt', 'updatedAt'],
  '报名问题': ['questionId', 'eventId', 'label', 'type', 'required', 'options', 'sortOrder', 'status', 'createdAt', 'updatedAt'],
  '参加者': ['participantId', 'name', 'phone', 'email', 'createdAt', 'updatedAt'],
  '报名项目': ['registrationId', 'eventId', 'participantId', 'ticketNumber', 'status', 'sessionIds', 'seatChoices', 'answers', 'createdAt', 'updatedAt'],
  '签到记录': ['checkInId', 'registrationId', 'eventId', 'sessionId', 'checkedInAt', 'checkedInBy', 'status'],
  '操作记录': ['auditId', 'action', 'entityType', 'entityId', 'actor', 'details', 'createdAt']
};

var REGISTRY_SHEET_NAMES_ = ['系统设置', '活动目录', '票券索引', '操作记录'];
var EVENT_SHEET_NAMES_ = [
  '活动', '场次', '座位', '报名问题', '参加者',
  '报名项目', '签到记录', '操作记录'
];
var LEGACY_BUSINESS_SHEET_NAMES_ = [
  '活动', '场次', '座位', '报名问题', '参加者', '报名项目', '签到记录'
];

/** Initializes all private sheets without replacing any populated cells. */
function setupSystem() {
  return withScriptLock(function() {
    var spreadsheet = getRegistrySpreadsheet_();
    requireLegacyMigrationPreflight_(spreadsheet);
    initializeRegistrySpreadsheet_(spreadsheet);
    seedInitialAdminSettings_(spreadsheet);
    return spreadsheet.getId();
  });
}

/** Returns the stable registry Sheet selected for this deployment. */
function getRegistrySpreadsheet_() {
  var spreadsheetId = PropertiesService.getScriptProperties().getProperty(ACTIVE_SPREADSHEET_ID);
  if (!spreadsheetId) throw new Error('Spreadsheet is not configured.');
  return SpreadsheetApp.openById(spreadsheetId);
}

/** Returns the spreadsheet selected for this deployment. */
function getConfiguredSpreadsheet(registrySpreadsheet) {
  if (!registrySpreadsheet) throw new Error('Registry spreadsheet is required.');
  var spreadsheetId = getSharedSettingValue_(registrySpreadsheet, ACTIVE_SPREADSHEET_ID);
  if (spreadsheetId === null || spreadsheetId === '') return registrySpreadsheet;
  if (typeof spreadsheetId !== 'string' || !spreadsheetId.trim()) {
    throw new Error('Spreadsheet pointer is invalid.');
  }
  return SpreadsheetApp.openById(spreadsheetId.trim());
}

/** Returns administrator-controlled options kept outside public files. */
function getAdminSettings(registrySpreadsheet) {
  if (!registrySpreadsheet) throw new Error('Registry spreadsheet is required.');
  var parsed = parseAdminSettings_(
    getSharedSettingValue_(registrySpreadsheet, ADMIN_SETTINGS)
  );
  if (!parsed) throw new Error('Administrator settings are invalid.');
  return parsed;
}

function parseAdminSettings_(serialized) {
  if (typeof serialized !== 'string' || !serialized.trim()) return null;
  try {
    var parsed = JSON.parse(serialized);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (_ignored) {
    return null;
  }
}

function getSharedSettingValue_(spreadsheet, key) {
  var sheet = spreadsheet.getSheetByName('系统设置');
  if (!sheet) return null;
  if (sheet.getLastRow() <= 1) return null;
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  for (var index = 0; index < values.length; index += 1) {
    if (values[index][0] === key) return values[index][1];
  }
  return null;
}

/** Seeds the first-run policy only when the authoritative row is absent. */
function seedInitialAdminSettings_(registrySpreadsheet) {
  if (getSharedSettingValue_(registrySpreadsheet, ADMIN_SETTINGS) !== null) return;
  setSharedSettingValue_(
    registrySpreadsheet,
    ADMIN_SETTINGS,
    JSON.stringify(INITIAL_ADMIN_SETTINGS)
  );
}

function setSharedSettingValue_(spreadsheet, key, value) {
  var sheet = getRequiredSheet_(spreadsheet, '系统设置');
  var values = sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues()
    : [];
  var rowNumber = 0;
  values.some(function(row, index) {
    if (row[0] !== key) return false;
    rowNumber = index + 2;
    return true;
  });
  var row = [key, value, new Date().toISOString()];
  if (rowNumber) {
    if (typeof journalAdminWrite_ === 'function') {
      journalAdminWrite_(sheet, rowNumber, row.length, false);
    }
    sheet.getRange(rowNumber, 1, 1, row.length).setValues([row]);
  } else {
    if (typeof journalAdminWrite_ === 'function') {
      journalAdminWrite_(sheet, sheet.getLastRow() + 1, row.length, true);
    }
    sheet.appendRow(row);
  }
}

function requireNoSwitchMaintenance_(registrySpreadsheet) {
  var serialized = getSharedSettingValue_(registrySpreadsheet, 'SWITCH_MAINTENANCE');
  if (serialized === null || serialized === '') return;
  var maintenance = null;
  try {
    maintenance = typeof serialized === 'string' ? JSON.parse(serialized) : null;
  } catch (_ignored) {
    maintenance = null;
  }
  var expiresAt = NaN;
  if (maintenance && typeof maintenance === 'object' &&
      !Array.isArray(maintenance) && typeof maintenance.expiresAt === 'string') {
    var parsedExpiry = new Date(maintenance.expiresAt).getTime();
    if (isFinite(parsedExpiry) &&
        new Date(parsedExpiry).toISOString() === maintenance.expiresAt) {
      expiresAt = parsedExpiry;
    }
  }
  if (isFinite(expiresAt) && expiresAt <= Date.now()) return;
  var error = new Error('Switch maintenance is active.');
  error.publicCode = 'MAINTENANCE';
  throw error;
}

/** Selects and non-destructively initializes a spreadsheet for this deployment. */
function setActiveSpreadsheet(spreadsheetId) {
  if (typeof spreadsheetId !== 'string' || !spreadsheetId.trim()) {
    throw new Error('A spreadsheet must be selected.');
  }

  return withScriptLock(function() {
    var spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    initializeRegistrySpreadsheet_(spreadsheet);
    PropertiesService.getScriptProperties().setProperty(ACTIVE_SPREADSHEET_ID, spreadsheet.getId());
    appendAuditRow_(spreadsheet, 'SET_ACTIVE_SPREADSHEET', 'spreadsheet', 'active', 'Configured active spreadsheet.');
    return spreadsheet.getId();
  });
}

/** Executes a mutation while holding the script-wide lock. */
function withScriptLock(callback) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

/** Reads data rows as objects, including their one-based row number. */
function readRows(spreadsheet, sheetName) {
  var sheet = getRequiredSheet_(spreadsheet, sheetName);
  if (sheet.getLastRow() <= 1) return [];

  var headers = SHEET_DEFINITIONS[sheetName];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues().map(function(values, index) {
    var row = { rowNumber: index + 2 };
    headers.forEach(function(header, column) { row[header] = values[column]; });
    return row;
  });
}

/** Appends an array or header-keyed object to a private sheet. */
function appendRow(sheetName, row) {
  return withScriptLock(function() {
    var registry = getRegistrySpreadsheet_();
    var spreadsheet = getConfiguredSpreadsheet(registry);
    var sheet = getRequiredSheet_(spreadsheet, sheetName);
    var values = normalizeRow_(sheetName, row);
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, values.length).setValues([values]);
    return sheet.getLastRow();
  });
}

/** Updates only the supplied row, preserving all other rows. */
function updateRow(sheetName, rowNumber, values) {
  if (!Number.isInteger(rowNumber) || rowNumber < 2) throw new Error('Invalid row number.');
  return withScriptLock(function() {
    var registry = getRegistrySpreadsheet_();
    var spreadsheet = getConfiguredSpreadsheet(registry);
    var sheet = getRequiredSheet_(spreadsheet, sheetName);
    if (rowNumber > sheet.getLastRow()) throw new Error('Row does not exist.');
    var rowValues = normalizeRow_(sheetName, values);
    sheet.getRange(rowNumber, 1, 1, rowValues.length).setValues([rowValues]);
    return rowNumber;
  });
}

function initializeRegistrySpreadsheet_(registry) {
  initializeNamedSheets_(registry, REGISTRY_SHEET_NAMES_);
}

function initializeEventSpreadsheet_(spreadsheet) {
  reuseDefaultBlankSheet_(spreadsheet, EVENT_SHEET_NAMES_);
  initializeNamedSheets_(spreadsheet, EVENT_SHEET_NAMES_);
}

function requireLegacyMigrationPreflight_(registry) {
  if (hasCompletedLegacyCatalogMapping_(registry)) return;
  var containsLegacyBusinessData = LEGACY_BUSINESS_SHEET_NAMES_.some(function(sheetName) {
    var sheet = registry && registry.getSheetByName(sheetName);
    return !!sheet && sheet.getLastRow() > 1;
  });
  if (!containsLegacyBusinessData) return;
  var error = new Error('Legacy activity data requires a reviewed migration before activation.');
  error.publicCode = 'LEGACY_MIGRATION_REQUIRED';
  throw error;
}

function hasCompletedLegacyCatalogMapping_(registry) {
  var sheet = registry && registry.getSheetByName('活动目录');
  if (!sheet || !hasExactHeaderRow_(sheet, SHEET_DEFINITIONS['活动目录']) ||
      sheet.getLastRow() <= 1) {
    return false;
  }
  var headers = SHEET_DEFINITIONS['活动目录'];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues()
    .some(function(values) {
      var eventId = typeof values[0] === 'string' ? values[0].trim() : '';
      var spreadsheetId = typeof values[1] === 'string' ? values[1].trim() : '';
      var sheetName = typeof values[2] === 'string' ? values[2].trim() : '';
      return !!eventId && !!spreadsheetId && sheetName === '活动';
    });
}

function reuseDefaultBlankSheet_(spreadsheet, sheetNames) {
  if (typeof spreadsheet.getSheets !== 'function') return;
  var missingName = sheetNames.filter(function(sheetName) {
    return !spreadsheet.getSheetByName(sheetName);
  })[0];
  if (!missingName) return;
  var defaultSheet = spreadsheet.getSheets().filter(function(sheet) {
    return sheet.getName() === 'Sheet1' &&
      sheet.getLastRow() === 0 &&
      (typeof sheet.getLastColumn !== 'function' || sheet.getLastColumn() === 0);
  })[0];
  if (defaultSheet && typeof defaultSheet.setName === 'function') {
    defaultSheet.setName(missingName);
  }
}

function initializeNamedSheets_(spreadsheet, sheetNames) {
  if (typeof spreadsheet.insertSheet !== 'function') return;
  sheetNames.forEach(function(sheetName) {
    var sheet = spreadsheet.getSheetByName(sheetName) || spreadsheet.insertSheet(sheetName);
    ensureHeaders_(sheet, SHEET_DEFINITIONS[sheetName]);
  });
}

function ensureHeaders_(sheet, headers) {
  if (hasExactHeaderRow_(sheet, headers)) return;
  if (migrateLegacyAttendanceHeader_(sheet, headers)) return;
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    return;
  }

  sheet.insertRowsBefore(1, 1);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
}

function migrateLegacyAttendanceHeader_(sheet, headers) {
  var legacy = ['checkInId', 'registrationId', 'eventId', 'checkedInAt', 'checkedInBy', 'status'];
  if (sheet.getName() !== '签到记录' ||
      headers.length !== legacy.length + 1 ||
      sheet.getLastRow() === 0) return false;
  var existing = sheet.getRange(1, 1, 1, legacy.length).getValues()[0];
  if (!legacy.every(function(header, index) { return existing[index] === header; })) return false;
  sheet.insertColumnAfter(3);
  sheet.getRange(1, 4, 1, 1).setValues([['sessionId']]);
  return true;
}

function hasExactHeaderRow_(sheet, headers) {
  if (sheet.getLastRow() === 0) return false;
  if (typeof sheet.getLastColumn === 'function' && sheet.getLastColumn() !== headers.length) return false;
  var existing = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  return headers.every(function(header, index) { return existing[index] === header; });
}

function getEventCatalogEntry_(registry, eventId) {
  var normalizedEventId = normalizeRoutingValue_(eventId);
  if (!normalizedEventId) routingError_('EVENT_NOT_FOUND');
  requireExactRoutingSheet_(registry, '活动目录');
  var matches = readRows(registry, '活动目录').filter(function(entry) {
    return normalizeRoutingValue_(entry.eventId) === normalizedEventId;
  });
  if (!matches.length) routingError_('EVENT_NOT_FOUND');
  if (matches.length !== 1) routingError_('INTEGRITY_ERROR');
  return validateEventCatalogEntry_(registry, matches[0], normalizedEventId);
}

function getEventSpreadsheet_(registry, eventId) {
  var entry = getEventCatalogEntry_(registry, eventId);
  var spreadsheet;
  try {
    spreadsheet = SpreadsheetApp.openById(entry.spreadsheetId);
  } catch (_ignored) {
    routingError_('INTEGRITY_ERROR');
  }
  EVENT_SHEET_NAMES_.forEach(function(sheetName) {
    var sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet || !hasExactHeaderRow_(sheet, SHEET_DEFINITIONS[sheetName])) {
      routingError_('INTEGRITY_ERROR');
    }
  });
  var events = readRows(spreadsheet, '活动').filter(function(event) {
    return normalizeRoutingValue_(event.eventId) === entry.eventId;
  });
  if (events.length !== 1) routingError_('INTEGRITY_ERROR');
  return spreadsheet;
}

function getTicketRouteByNumber_(registry, ticketNumber) {
  var normalizedTicketNumber = normalizeRoutingValue_(ticketNumber);
  if (!normalizedTicketNumber) routingError_('TICKET_NOT_FOUND');
  requireExactRoutingSheet_(registry, '票券索引');
  var matches = readRows(registry, '票券索引').filter(function(route) {
    return normalizeRoutingValue_(route.ticketNumber) === normalizedTicketNumber;
  });
  if (!matches.length) routingError_('TICKET_NOT_FOUND');
  if (matches.length !== 1) routingError_('INTEGRITY_ERROR');
  return validateTicketRouteForRegistry_(registry, matches[0], normalizedTicketNumber);
}

function getTicketRouteByToken_(registry, token) {
  var normalizedToken = normalizeRoutingValue_(token);
  if (!normalizedToken) routingError_('TICKET_NOT_FOUND');
  requireExactRoutingSheet_(registry, '票券索引');
  var digest = digestTicketToken_(normalizedToken);
  var matches = readRows(registry, '票券索引').filter(function(route) {
    return normalizeRoutingValue_(route.tokenDigest).toLowerCase() === digest;
  });
  if (!matches.length) routingError_('TICKET_NOT_FOUND');
  if (matches.length !== 1) routingError_('INTEGRITY_ERROR');
  return validateTicketRouteForRegistry_(registry, matches[0]);
}

function upsertTicketRoute_(registry, route) {
  var normalized = validateTicketRouteForRegistry_(registry, route);
  var indexSheet = requireExactRoutingSheet_(registry, '票券索引');
  var routes = readRows(registry, '票券索引');
  var matchingTickets = routes.filter(function(candidate) {
    return normalizeRoutingValue_(candidate.ticketNumber) === normalized.ticketNumber;
  });
  if (matchingTickets.length > 1) routingError_('INTEGRITY_ERROR');
  var matchingDigests = routes.filter(function(candidate) {
    return normalizeRoutingValue_(candidate.tokenDigest).toLowerCase() === normalized.tokenDigest &&
      normalizeRoutingValue_(candidate.ticketNumber) !== normalized.ticketNumber;
  });
  if (matchingDigests.length) routingError_('INTEGRITY_ERROR');
  if (matchingTickets.length === 1) {
    var existing = validateTicketRoute_(matchingTickets[0], normalized.ticketNumber);
    if (existing.eventId !== normalized.eventId ||
        existing.registrationId !== normalized.registrationId ||
        existing.tokenDigest !== normalized.tokenDigest) {
      routingError_('INTEGRITY_ERROR');
    }
  }
  var values = normalizeRow_('票券索引', normalized);
  if (matchingTickets.length === 1) {
    indexSheet.getRange(matchingTickets[0].rowNumber, 1, 1, values.length).setValues([values]);
  } else {
    indexSheet.getRange(indexSheet.getLastRow() + 1, 1, 1, values.length).setValues([values]);
  }
  return normalized;
}

function digestTicketToken_(token) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(token || '').trim(),
    Utilities.Charset.UTF_8
  );
  return bytes.map(function(value) {
    var unsigned = value < 0 ? value + 256 : value;
    return ('0' + unsigned.toString(16)).slice(-2);
  }).join('');
}

function validateEventCatalogEntry_(registry, entry, expectedEventId) {
  var eventId = normalizeRoutingValue_(entry && entry.eventId);
  var spreadsheetId = normalizeRoutingValue_(entry && entry.spreadsheetId);
  var sheetName = normalizeRoutingValue_(entry && entry.sheetName);
  if (!eventId || eventId !== expectedEventId || !spreadsheetId ||
      spreadsheetId.length > 256 || sheetName !== '活动' ||
      (registry && typeof registry.getId === 'function' && spreadsheetId === registry.getId())) {
    routingError_('INTEGRITY_ERROR');
  }
  entry.eventId = eventId;
  entry.spreadsheetId = spreadsheetId;
  entry.sheetName = sheetName;
  return entry;
}

function validateTicketRoute_(route, expectedTicketNumber) {
  var ticketNumber = normalizeRoutingValue_(route && route.ticketNumber);
  var tokenDigest = normalizeRoutingValue_(route && route.tokenDigest).toLowerCase();
  var eventId = normalizeRoutingValue_(route && route.eventId);
  var registrationId = normalizeRoutingValue_(route && route.registrationId);
  var status = normalizeRoutingValue_(route && route.status);
  var createdAt = normalizeRoutingValue_(route && route.createdAt);
  var updatedAt = normalizeRoutingValue_(route && route.updatedAt);
  if (!ticketNumber || (expectedTicketNumber && ticketNumber !== expectedTicketNumber) ||
      !/^[a-f0-9]{64}$/.test(tokenDigest) || !eventId || !registrationId ||
      !status || !createdAt || !updatedAt) {
    routingError_('INTEGRITY_ERROR');
  }
  return {
    ticketNumber: ticketNumber,
    tokenDigest: tokenDigest,
    eventId: eventId,
    registrationId: registrationId,
    status: status,
    createdAt: createdAt,
    updatedAt: updatedAt
  };
}

function validateTicketRouteForRegistry_(registry, route, expectedTicketNumber) {
  var normalized = validateTicketRoute_(route, expectedTicketNumber);
  getEventSpreadsheet_(registry, normalized.eventId);
  return normalized;
}

function normalizeRoutingValue_(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function requireExactRoutingSheet_(spreadsheet, sheetName) {
  var sheet = spreadsheet && spreadsheet.getSheetByName(sheetName);
  if (!sheet) routingError_('INTEGRITY_ERROR');
  if (!hasExactHeaderRow_(sheet, SHEET_DEFINITIONS[sheetName])) routingError_('INTEGRITY_ERROR');
  return sheet;
}

function routingError_(code) {
  var error = new Error('Private routing lookup failed.');
  error.publicCode = code;
  throw error;
}

function addSampleDraftEventIfEmpty_(eventSheet) {
  if (eventSheet.getLastRow() <= 1) {
    eventSheet.appendRow([
      'sample-draft-event', '示例草稿活动', '初始化后可安全编辑或删除的示例。', 'draft',
      '', '', '', 'free', 0, 1, 'none', '[]', new Date(), new Date()
    ]);
  }
}

function getRequiredSheet_(spreadsheet, sheetName) {
  if (!Object.prototype.hasOwnProperty.call(SHEET_DEFINITIONS, sheetName)) {
    throw new Error('Unknown sheet.');
  }
  var sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) throw new Error('System has not been initialized.');
  return sheet;
}

function normalizeRow_(sheetName, row) {
  var headers = SHEET_DEFINITIONS[sheetName];
  if (Array.isArray(row)) {
    if (row.length !== headers.length) throw new Error('Row has an invalid column count.');
    return row;
  }
  if (!row || typeof row !== 'object') throw new Error('Row must be an array or object.');
  return headers.map(function(header) { return row[header] === undefined ? '' : row[header]; });
}

function appendAuditRow_(spreadsheet, action, entityType, entityId, details) {
  var sheet = getRequiredSheet_(spreadsheet, '操作记录');
  sheet.appendRow([Utilities.getUuid(), action, entityType, entityId, 'system', details, new Date()]);
}

function buildPublicVerificationUrl_(token) {
  if (typeof token !== 'string' || !token) return '';
  if (typeof PropertiesService === 'undefined') return '';
  var configured = PropertiesService.getScriptProperties().getProperty(PUBLIC_BASE_URL);
  if (typeof configured !== 'string') return '';
  var base = configured.trim().replace(/\/+$/, '');
  if (!/^https:\/\/[^?#\s]+$/i.test(base)) return '';
  return base + '/verify.html?token=' + encodeURIComponent(token);
}
