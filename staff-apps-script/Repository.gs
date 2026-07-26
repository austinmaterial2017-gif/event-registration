var ACTIVE_SPREADSHEET_ID = 'ACTIVE_SPREADSHEET_ID';
var ADMIN_SETTINGS = 'ADMIN_SETTINGS';

var STAFF_SHEET_DEFINITIONS = {
  '活动': ['eventId', 'title', 'description', 'status', 'opensAt', 'closesAt', 'location', 'selectionMode', 'minChoices', 'maxChoices', 'seatMode', 'seatZones', 'createdAt', 'updatedAt'],
  '场次': ['sessionId', 'eventId', 'title', 'speaker', 'startsAt', 'endsAt', 'required', 'capacity', 'status', 'createdAt', 'updatedAt'],
  '座位': ['seatId', 'eventId', 'sessionId', 'label', 'zone', 'status', 'holderRegistrationId', 'createdAt', 'updatedAt'],
  '参加者': ['participantId', 'name', 'phone', 'email', 'createdAt', 'updatedAt'],
  '报名项目': ['registrationId', 'eventId', 'participantId', 'ticketNumber', 'status', 'sessionIds', 'seatChoices', 'answers', 'createdAt', 'updatedAt'],
  '签到记录': ['checkInId', 'registrationId', 'eventId', 'sessionId', 'checkedInAt', 'checkedInBy', 'status']
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
