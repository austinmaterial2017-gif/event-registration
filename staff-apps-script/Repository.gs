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

function getConfiguredSpreadsheet_() {
  var spreadsheetId = PropertiesService.getScriptProperties().getProperty(ACTIVE_SPREADSHEET_ID);
  if (!spreadsheetId) throw new Error('Staff spreadsheet is not configured.');
  return SpreadsheetApp.openById(spreadsheetId);
}

function getAdminSettings_() {
  var serialized = PropertiesService.getScriptProperties().getProperty(ADMIN_SETTINGS);
  if (!serialized) return {};
  try {
    return JSON.parse(serialized);
  } catch (_ignored) {
    return {};
  }
}

function setAdminSettings_(settings) {
  PropertiesService.getScriptProperties().setProperty(ADMIN_SETTINGS, JSON.stringify(settings || {}));
}

function openSpreadsheetById_(spreadsheetId) {
  if (typeof spreadsheetId !== 'string' || !spreadsheetId.trim() || spreadsheetId.length > 256) {
    throw new Error('Invalid spreadsheet selection.');
  }
  return SpreadsheetApp.openById(spreadsheetId.trim());
}

function setActiveSpreadsheetId_(spreadsheetId) {
  PropertiesService.getScriptProperties().setProperty(ACTIVE_SPREADSHEET_ID, spreadsheetId);
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

function readRows_(sheetName) {
  var sheet = getRequiredSheet_(getConfiguredSpreadsheet_(), sheetName);
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
