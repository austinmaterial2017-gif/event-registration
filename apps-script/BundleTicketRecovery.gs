/* Combination-ticket recovery is deliberately isolated from ordinary tickets.
 * A successful recovery rotates the secret token: the old QR becomes invalid.
 */

function listBundleRecoveryPlans_() {
  return runPublicEventRead_(function() {
    var registry = getRegistrySpreadsheet_();
    initializeBundleSpreadsheet_(registry);
    var plans = bundleSheetRows_(registry.getSheetByName('组合计划'), BUNDLE_SHEET_HEADERS_['组合计划']);
    return { plans: plans.filter(function(plan) {
      return ['open', 'closed', 'ended'].indexOf(String(plan.status || '').toLowerCase()) !== -1;
    }).map(function(plan) {
      return { planId: String(plan.planId), title: String(plan.title || '组合活动') };
    }) };
  });
}

function recoverBundleTicket_(payload) {
  return runPublicEventRead_(function() {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
        typeof payload.planId !== 'string' || !payload.planId.trim() ||
        typeof payload.name !== 'string' || !payload.name.trim() ||
        typeof payload.phone !== 'string' || !payload.phone.trim()) {
      publicEventReadError_('INVALID_REQUEST');
    }
    return withScriptLock(function() {
      var registry = getRegistrySpreadsheet_();
      initializeBundleSpreadsheet_(registry);
      var planId = payload.planId.trim();
      var registrations = bundleSheetRows_(registry.getSheetByName('组合报名'), BUNDLE_SHEET_HEADERS_['组合报名']).filter(function(row) {
        return String(row.planId) === planId && String(row.status || '').toLowerCase() === 'active';
      });
      var fields = bundleRegistrationFields_(registry, planId);
      var nameField = fields.filter(function(field) {
        return /姓名|name/i.test(String(field.label || ''));
      })[0];
      var phoneField = fields.filter(function(field) {
        return String(field.type || '').toLowerCase() === 'tel' || /电话|phone|tel/i.test(String(field.label || ''));
      })[0];
      if (!nameField || !phoneField) publicEventReadError_('TICKET_NOT_FOUND');
      var matches = registrations.filter(function(registration) {
        var answers; try { answers = JSON.parse(String(registration.answers || '{}')); } catch (_ignored) { answers = {}; }
        return bundleRecoveryText_(answers[nameField.id]) === bundleRecoveryText_(payload.name) &&
          bundleRecoveryPhone_(answers[phoneField.id]) === bundleRecoveryPhone_(payload.phone);
      });
      if (matches.length !== 1) publicEventReadError_('TICKET_NOT_FOUND');
      var registration = matches[0];
      var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
      var headers = BUNDLE_SHEET_HEADERS_['组合报名'];
      var tokenColumn = headers.indexOf('tokenDigest') + 1;
      registry.getSheetByName('组合报名').getRange(registration.rowNumber, tokenColumn).setValue(digestTicketToken_(token));
      return { ticketNumber: String(registration.ticketNumber || ''), token: token, planId: planId };
    });
  });
}

function bundleRecoveryText_(value) {
  return String(value === undefined || value === null ? '' : value).replace(/\s+/g, '').toLowerCase();
}

function bundleRecoveryPhone_(value) {
  return String(value === undefined || value === null ? '' : value).replace(/[^0-9]/g, '');
}
