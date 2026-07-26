var ACTIVE_SPREADSHEET_ID = 'ACTIVE_SPREADSHEET_ID';
var ADMIN_SETTINGS = 'ADMIN_SETTINGS';
var INITIAL_ADMIN_SETTINGS = {
  attendance: {},
  registration: { events: {}, identityFields: [] }
};

var SHEET_DEFINITIONS = {
  '系统设置': ['key', 'value', 'updatedAt'],
  '活动': ['eventId', 'title', 'description', 'status', 'opensAt', 'closesAt', 'location', 'selectionMode', 'minChoices', 'maxChoices', 'seatMode', 'seatZones', 'createdAt', 'updatedAt'],
  '场次': ['sessionId', 'eventId', 'title', 'speaker', 'startsAt', 'endsAt', 'required', 'capacity', 'status', 'createdAt', 'updatedAt'],
  '座位': ['seatId', 'eventId', 'sessionId', 'label', 'zone', 'status', 'holderRegistrationId', 'createdAt', 'updatedAt'],
  '报名问题': ['questionId', 'eventId', 'label', 'type', 'required', 'options', 'sortOrder', 'status', 'createdAt', 'updatedAt'],
  '参加者': ['participantId', 'name', 'phone', 'email', 'createdAt', 'updatedAt'],
  '报名项目': ['registrationId', 'eventId', 'participantId', 'ticketNumber', 'status', 'sessionIds', 'seatChoices', 'answers', 'createdAt', 'updatedAt'],
  '签到记录': ['checkInId', 'registrationId', 'eventId', 'sessionId', 'checkedInAt', 'checkedInBy', 'status'],
  '操作记录': ['auditId', 'action', 'entityType', 'entityId', 'actor', 'details', 'createdAt']
};

/** Initializes all private sheets without replacing any populated cells. */
function setupSystem() {
  return withScriptLock(function() {
    var spreadsheet = getRegistrySpreadsheet_();
    initializeSpreadsheet_(spreadsheet, true);
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
    sheet.getRange(rowNumber, 1, 1, row.length).setValues([row]);
  } else {
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
    initializeSpreadsheet_(spreadsheet, true);
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

function initializeSpreadsheet_(spreadsheet, seedDraftEvent) {
  Object.keys(SHEET_DEFINITIONS).forEach(function(sheetName) {
    var sheet = spreadsheet.getSheetByName(sheetName) || spreadsheet.insertSheet(sheetName);
    ensureHeaders_(sheet, SHEET_DEFINITIONS[sheetName]);
  });
  if (seedDraftEvent) addSampleDraftEventIfEmpty_(spreadsheet.getSheetByName('活动'));
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
  var existing = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  return headers.every(function(header, index) { return existing[index] === header; });
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
