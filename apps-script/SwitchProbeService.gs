var SWITCH_PROBE = 'SWITCH_PROBE';
var SWITCH_PROBE_ACK = 'SWITCH_PROBE_ACK';
var SWITCH_MAINTENANCE = 'SWITCH_MAINTENANCE';
var SWITCH_PROBE_SHARED_SECRET = 'SWITCH_PROBE_SHARED_SECRET';

/**
 * Performs the public deployer's half of a Sheet switch handshake.
 *
 * The response is deliberately generic. The caller supplies only the staged
 * nonce; the candidate Sheet ID is read exclusively from the stable registry.
 */
function probeSheetSwitch(payload) {
  try {
    withScriptLock(function() {
      if (!isNonceOnlyProbePayload_(payload)) return;
      var registry = getRegistrySpreadsheet_();
      var probe = parseSwitchRegistryObject_(
        getSharedSettingValue_(registry, SWITCH_PROBE)
      );
      var maintenance = parseSwitchRegistryObject_(
        getSharedSettingValue_(registry, SWITCH_MAINTENANCE)
      );
      if (!isUsablePublicSwitchProbe_(payload.nonce, probe, maintenance)) return;

      var candidate = SpreadsheetApp.openById(probe.candidateSpreadsheetId);
      validatePublicSwitchCandidate_(candidate);
      var signature = signPublicSwitchAck_(
        probe.nonce,
        probe.candidateSpreadsheetId,
        probe.expiresAt
      );
      setPublicRegistryValue_(
        registry,
        SWITCH_PROBE_ACK,
        JSON.stringify({
          nonce: probe.nonce,
          expiresAt: probe.expiresAt,
          verifiedAt: new Date().toISOString(),
          signature: signature
        })
      );
    });
  } catch (_ignored) {
    // This endpoint never reveals whether a nonce, Sheet, schema, or secret was valid.
  }
  return { ok: true, data: { status: 'processed' } };
}

function isNonceOnlyProbePayload_(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  var keys = Object.keys(payload);
  return keys.length === 1 &&
    keys[0] === 'nonce' &&
    typeof payload.nonce === 'string' &&
    payload.nonce.length >= 16 &&
    payload.nonce.length <= 256;
}

function isUsablePublicSwitchProbe_(nonce, probe, maintenance) {
  if (!probe || !maintenance ||
      probe.nonce !== nonce ||
      maintenance.nonce !== nonce ||
      typeof probe.candidateSpreadsheetId !== 'string' ||
      !probe.candidateSpreadsheetId.trim() ||
      probe.candidateSpreadsheetId.length > 256 ||
      typeof probe.expiresAt !== 'string' ||
      maintenance.expiresAt !== probe.expiresAt) {
    return false;
  }
  var expiresAt = new Date(probe.expiresAt).getTime();
  return isFinite(expiresAt) && expiresAt > Date.now();
}

function validatePublicSwitchCandidate_(spreadsheet) {
  Object.keys(SHEET_DEFINITIONS).forEach(function(sheetName) {
    var sheet = spreadsheet.getSheetByName(sheetName);
    var expected = SHEET_DEFINITIONS[sheetName];
    if (!sheet || sheet.getLastRow() < 1) throw new Error('Invalid switch candidate.');
    var actual = sheet.getRange(1, 1, 1, expected.length).getValues()[0];
    if (!expected.every(function(header, index) { return actual[index] === header; })) {
      throw new Error('Invalid switch candidate.');
    }
  });
}

function signPublicSwitchAck_(nonce, candidateSpreadsheetId, expiresAt) {
  var secret = PropertiesService.getScriptProperties()
    .getProperty(SWITCH_PROBE_SHARED_SECRET);
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('Switch probe secret is not configured.');
  }
  return Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(
      nonce + '\n' + candidateSpreadsheetId + '\n' + expiresAt,
      secret
    )
  );
}

function parseSwitchRegistryObject_(serialized) {
  if (typeof serialized !== 'string' || !serialized.trim()) return null;
  try {
    var value = JSON.parse(serialized);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch (_ignored) {
    return null;
  }
}

function setPublicRegistryValue_(registry, key, value) {
  var sheet = getRequiredSheet_(registry, '系统设置');
  var rows = sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues()
    : [];
  var rowNumber = 0;
  rows.some(function(row, index) {
    if (row[0] !== key) return false;
    rowNumber = index + 2;
    return true;
  });
  var values = [key, value, new Date().toISOString()];
  if (rowNumber) {
    sheet.getRange(rowNumber, 1, 1, values.length).setValues([values]);
  } else {
    sheet.appendRow(values);
  }
}
