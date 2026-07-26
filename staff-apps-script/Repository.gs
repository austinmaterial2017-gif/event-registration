var ACTIVE_SPREADSHEET_ID = 'ACTIVE_SPREADSHEET_ID';
var ADMIN_SETTINGS = 'ADMIN_SETTINGS';

var STAFF_SHEET_DEFINITIONS = {
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

function getConfiguredSpreadsheet_(registrySpreadsheet) {
  if (!registrySpreadsheet) throw new Error('Staff registry spreadsheet is required.');
  var spreadsheetId = getSharedSettingValue_(registrySpreadsheet, ACTIVE_SPREADSHEET_ID);
  if (spreadsheetId === null || spreadsheetId === '') return registrySpreadsheet;
  if (typeof spreadsheetId !== 'string' || !spreadsheetId.trim()) {
    throw new Error('Staff spreadsheet pointer is invalid.');
  }
  return SpreadsheetApp.openById(spreadsheetId.trim());
}

function getRootConfiguredSpreadsheet_() {
  var spreadsheetId = PropertiesService.getScriptProperties().getProperty(ACTIVE_SPREADSHEET_ID);
  if (!spreadsheetId) throw new Error('Staff spreadsheet is not configured.');
  return SpreadsheetApp.openById(spreadsheetId);
}

function getAdminSettings_(registrySpreadsheet) {
  if (!registrySpreadsheet) throw new Error('Staff registry spreadsheet is required.');
  var parsed = parseAdminSettings_(
    getSharedSettingValue_(registrySpreadsheet, ADMIN_SETTINGS)
  );
  if (!parsed) throw new Error('Administrator settings are invalid.');
  return parsed;
}

function setAdminSettings_(registrySpreadsheet, settings) {
  if (!registrySpreadsheet) throw new Error('Staff registry spreadsheet is required.');
  setSharedSettingValue_(
    registrySpreadsheet,
    ADMIN_SETTINGS,
    JSON.stringify(settings || {})
  );
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

function getSharedSettingValue_(spreadsheet, key) {
  var sheet = getRequiredSheet_(spreadsheet, '系统设置');
  if (sheet.getLastRow() <= 1) return null;
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  for (var index = 0; index < values.length; index += 1) {
    if (values[index][0] === key) return values[index][1];
  }
  return null;
}

function requireNoSwitchMaintenance_(registrySpreadsheet) {
  var maintenance = getSharedSettingValue_(registrySpreadsheet, 'SWITCH_MAINTENANCE');
  if (maintenance === null || maintenance === '') return;
  var error = new Error('Switch maintenance is active.');
  error.publicCode = 'MAINTENANCE';
  throw error;
}

function openSpreadsheetById_(spreadsheetId) {
  if (typeof spreadsheetId !== 'string' || !spreadsheetId.trim() || spreadsheetId.length > 256) {
    throw new Error('Invalid spreadsheet selection.');
  }
  return SpreadsheetApp.openById(spreadsheetId.trim());
}

function withScriptLock_(callback) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

function getRequiredSheet_(spreadsheet, sheetName) {
  if (!Object.prototype.hasOwnProperty.call(STAFF_SHEET_DEFINITIONS, sheetName)) {
    throw new Error('Unknown staff sheet.');
  }
  var sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) throw new Error('Staff spreadsheet is not initialized.');
  return sheet;
}

function readRows_(spreadsheet, sheetName) {
  var sheet = getRequiredSheet_(spreadsheet, sheetName);
  if (sheet.getLastRow() <= 1) return [];
  var headers = STAFF_SHEET_DEFINITIONS[sheetName];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues().map(function(values, index) {
    var row = { rowNumber: index + 2 };
    headers.forEach(function(header, column) { row[header] = values[column]; });
    return row;
  });
}

function normalizeRow_(sheetName, row) {
  var headers = STAFF_SHEET_DEFINITIONS[sheetName];
  if (!headers || !row || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error('Invalid staff row.');
  }
  return headers.map(function(header) { return row[header] === undefined ? '' : row[header]; });
}
