var ACTIVE_SPREADSHEET_ID = 'ACTIVE_SPREADSHEET_ID';
var ADMIN_SETTINGS = 'ADMIN_SETTINGS';

var STAFF_SHEET_DEFINITIONS = {
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
  if (isFinite(expiresAt) && expiresAt <= Date.now()) {
    try {
      setSharedSettingValue_(registrySpreadsheet, 'SWITCH_MAINTENANCE', '');
    } catch (_ignored) {
      // Expiry is authoritative; cleanup failure must not extend maintenance.
    }
    return;
  }
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

function initializeRegistrySpreadsheet_(registry) {
  initializeNamedStaffSheets_(registry, REGISTRY_SHEET_NAMES_);
}

function initializeEventSpreadsheet_(spreadsheet) {
  initializeNamedStaffSheets_(spreadsheet, EVENT_SHEET_NAMES_);
}

function initializeNamedStaffSheets_(spreadsheet, sheetNames) {
  if (typeof spreadsheet.insertSheet !== 'function') return;
  sheetNames.forEach(function(sheetName) {
    var sheet = spreadsheet.getSheetByName(sheetName) || spreadsheet.insertSheet(sheetName);
    ensureStaffHeaders_(sheet, STAFF_SHEET_DEFINITIONS[sheetName]);
  });
}

function ensureStaffHeaders_(sheet, headers) {
  if (hasExactStaffHeaderRow_(sheet, headers)) return;
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    return;
  }
  sheet.insertRowsBefore(1, 1);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
}

function hasExactStaffHeaderRow_(sheet, headers) {
  if (sheet.getLastRow() === 0) return false;
  if (typeof sheet.getLastColumn === 'function' && sheet.getLastColumn() !== headers.length) return false;
  var existing = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  return headers.every(function(header, index) { return existing[index] === header; });
}

function getEventCatalogEntry_(registry, eventId) {
  var normalizedEventId = normalizeStaffRoutingValue_(eventId);
  if (!normalizedEventId) staffRoutingError_('EVENT_NOT_FOUND');
  requireExactStaffRoutingSheet_(registry, '活动目录');
  var matches = readRows_(registry, '活动目录').filter(function(entry) {
    return normalizeStaffRoutingValue_(entry.eventId) === normalizedEventId;
  });
  if (!matches.length) staffRoutingError_('EVENT_NOT_FOUND');
  if (matches.length !== 1) staffRoutingError_('INTEGRITY_ERROR');
  return validateStaffEventCatalogEntry_(registry, matches[0], normalizedEventId);
}

function getEventSpreadsheet_(registry, eventId) {
  var entry = getEventCatalogEntry_(registry, eventId);
  var spreadsheet;
  try {
    spreadsheet = SpreadsheetApp.openById(entry.spreadsheetId);
  } catch (_ignored) {
    staffRoutingError_('INTEGRITY_ERROR');
  }
  EVENT_SHEET_NAMES_.forEach(function(sheetName) {
    var sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet || !hasExactStaffHeaderRow_(sheet, STAFF_SHEET_DEFINITIONS[sheetName])) {
      staffRoutingError_('INTEGRITY_ERROR');
    }
  });
  var events = readRows_(spreadsheet, '活动').filter(function(event) {
    return normalizeStaffRoutingValue_(event.eventId) === entry.eventId;
  });
  if (events.length !== 1) staffRoutingError_('INTEGRITY_ERROR');
  return spreadsheet;
}

function getTicketRouteByNumber_(registry, ticketNumber) {
  var normalizedTicketNumber = normalizeStaffRoutingValue_(ticketNumber);
  if (!normalizedTicketNumber) staffRoutingError_('TICKET_NOT_FOUND');
  requireExactStaffRoutingSheet_(registry, '票券索引');
  var matches = readRows_(registry, '票券索引').filter(function(route) {
    return normalizeStaffRoutingValue_(route.ticketNumber) === normalizedTicketNumber;
  });
  if (!matches.length) staffRoutingError_('TICKET_NOT_FOUND');
  if (matches.length !== 1) staffRoutingError_('INTEGRITY_ERROR');
  return validateStaffTicketRouteForRegistry_(registry, matches[0], normalizedTicketNumber);
}

function getTicketRouteByToken_(registry, token) {
  var normalizedToken = normalizeStaffRoutingValue_(token);
  if (!normalizedToken) staffRoutingError_('TICKET_NOT_FOUND');
  requireExactStaffRoutingSheet_(registry, '票券索引');
  var digest = digestTicketToken_(normalizedToken);
  var matches = readRows_(registry, '票券索引').filter(function(route) {
    return normalizeStaffRoutingValue_(route.tokenDigest).toLowerCase() === digest;
  });
  if (!matches.length) staffRoutingError_('TICKET_NOT_FOUND');
  if (matches.length !== 1) staffRoutingError_('INTEGRITY_ERROR');
  return validateStaffTicketRouteForRegistry_(registry, matches[0]);
}

function upsertTicketRoute_(registry, route) {
  var normalized = validateStaffTicketRouteForRegistry_(registry, route);
  var indexSheet = requireExactStaffRoutingSheet_(registry, '票券索引');
  var routes = readRows_(registry, '票券索引');
  var matchingTickets = routes.filter(function(candidate) {
    return normalizeStaffRoutingValue_(candidate.ticketNumber) === normalized.ticketNumber;
  });
  if (matchingTickets.length > 1) staffRoutingError_('INTEGRITY_ERROR');
  var matchingDigests = routes.filter(function(candidate) {
    return normalizeStaffRoutingValue_(candidate.tokenDigest).toLowerCase() === normalized.tokenDigest &&
      normalizeStaffRoutingValue_(candidate.ticketNumber) !== normalized.ticketNumber;
  });
  if (matchingDigests.length) staffRoutingError_('INTEGRITY_ERROR');
  if (matchingTickets.length === 1) {
    var existing = validateStaffTicketRoute_(matchingTickets[0], normalized.ticketNumber);
    if (existing.eventId !== normalized.eventId ||
        existing.registrationId !== normalized.registrationId ||
        existing.tokenDigest !== normalized.tokenDigest) {
      staffRoutingError_('INTEGRITY_ERROR');
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

function validateStaffEventCatalogEntry_(registry, entry, expectedEventId) {
  var eventId = normalizeStaffRoutingValue_(entry && entry.eventId);
  var spreadsheetId = normalizeStaffRoutingValue_(entry && entry.spreadsheetId);
  var sheetName = normalizeStaffRoutingValue_(entry && entry.sheetName);
  if (!eventId || eventId !== expectedEventId || !spreadsheetId ||
      spreadsheetId.length > 256 || sheetName !== '活动' ||
      (registry && typeof registry.getId === 'function' && spreadsheetId === registry.getId())) {
    staffRoutingError_('INTEGRITY_ERROR');
  }
  entry.eventId = eventId;
  entry.spreadsheetId = spreadsheetId;
  entry.sheetName = sheetName;
  return entry;
}

function validateStaffTicketRoute_(route, expectedTicketNumber) {
  var ticketNumber = normalizeStaffRoutingValue_(route && route.ticketNumber);
  var tokenDigest = normalizeStaffRoutingValue_(route && route.tokenDigest).toLowerCase();
  var eventId = normalizeStaffRoutingValue_(route && route.eventId);
  var registrationId = normalizeStaffRoutingValue_(route && route.registrationId);
  var status = normalizeStaffRoutingValue_(route && route.status);
  var createdAt = normalizeStaffRoutingValue_(route && route.createdAt);
  var updatedAt = normalizeStaffRoutingValue_(route && route.updatedAt);
  if (!ticketNumber || (expectedTicketNumber && ticketNumber !== expectedTicketNumber) ||
      !/^[a-f0-9]{64}$/.test(tokenDigest) || !eventId || !registrationId ||
      !status || !createdAt || !updatedAt) {
    staffRoutingError_('INTEGRITY_ERROR');
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

function validateStaffTicketRouteForRegistry_(registry, route, expectedTicketNumber) {
  var normalized = validateStaffTicketRoute_(route, expectedTicketNumber);
  getEventSpreadsheet_(registry, normalized.eventId);
  return normalized;
}

function normalizeStaffRoutingValue_(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function requireExactStaffRoutingSheet_(spreadsheet, sheetName) {
  var sheet = spreadsheet && spreadsheet.getSheetByName(sheetName);
  if (!sheet) staffRoutingError_('INTEGRITY_ERROR');
  if (!hasExactStaffHeaderRow_(sheet, STAFF_SHEET_DEFINITIONS[sheetName])) {
    staffRoutingError_('INTEGRITY_ERROR');
  }
  return sheet;
}

function staffRoutingError_(code) {
  var error = new Error('Private routing lookup failed.');
  error.publicCode = code;
  throw error;
}
