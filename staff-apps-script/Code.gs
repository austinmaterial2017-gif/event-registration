/** The dedicated signed-in Web App has no anonymous API surface. */
function doGet(event) {
  var view = event && event.parameter && event.parameter.view;
  if (view === 'admin') {
    try {
      requireAuthorizedAdminSession_();
      var adminTemplate = HtmlService.createTemplateFromFile('Admin');
      var staffBaseUrl = ScriptApp.getService().getUrl();
      // Camera access must be requested by the top-level HTTPS Pages origin.
      // The Apps Script iframe is unreliable for iPhone camera permission.
      adminTemplate.staffScannerUrl =
        'https://austinmaterial2017-gif.github.io/event-registration/staff-checkin.html';
      return adminTemplate
        .evaluate()
        .setTitle('活动管理后台');
    } catch (_ignored) {
      return HtmlService
        .createHtmlOutput('<!doctype html><html><body><main><h1>Administrator access unavailable.</h1></main></body></html>')
        .setTitle('Administrator access unavailable');
    }
  }
  try {
    requireAuthorizedStaffSession_();
    var template = HtmlService.createTemplateFromFile('StaffCheckIn');
    template.staffReturnUrl = ScriptApp.getService().getUrl() + '?view=staff';
    var requestedScan = event && event.parameter &&
      (event.parameter.t || event.parameter.token || event.parameter.scan);
    template.initialScan = parseInitialStaffScan_(requestedScan);
    template.fixedEventId = parseStaffSelectionId_(event && event.parameter && event.parameter.fixedEventId);
    template.fixedSessionId = parseStaffSelectionId_(event && event.parameter && event.parameter.fixedSessionId);
    template.fixedCheckpointId = parseStaffSelectionId_(event && event.parameter && event.parameter.fixedCheckpointId);
    return template.evaluate()
      .setTitle('工作人员验票／参与者签到');
  } catch (_ignored) {
    return HtmlService
      .createHtmlOutput('<!doctype html><html><body><main><h1>Staff access unavailable.</h1></main></body></html>')
      .setTitle('Staff access unavailable');
  }
}

function parseStaffSelectionId_(value) {
  var text = typeof value === 'string' ? value.trim() : '';
  return /^[A-Za-z0-9_-]{1,128}$/.test(text) ? text : '';
}

function parseInitialStaffScan_(value) {
  var text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > 2048) return '';
  if (/^[a-f0-9]{64}$/i.test(text)) return text;
  var match = text.match(/[?&](?:t|token)=([a-f0-9]{64})(?:[&#]|$)/i);
  return match ? match[1] : '';
}
