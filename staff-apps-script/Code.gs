/** The dedicated signed-in Web App has no anonymous API surface. */
function doGet(event) {
  var view = event && event.parameter && event.parameter.view;
  if (view === 'admin') {
    try {
      requireAuthorizedAdminSession_();
      return HtmlService.createTemplateFromFile('Admin')
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
    var requestedScan = event && event.parameter &&
      (event.parameter.t || event.parameter.token || event.parameter.scan);
    template.initialScan = typeof requestedScan === 'string' &&
      /^[a-f0-9]{64}$/i.test(requestedScan.trim()) ? requestedScan.trim() : '';
    return template.evaluate()
      .setTitle('工作人员验票／参与者签到');
  } catch (_ignored) {
    return HtmlService
      .createHtmlOutput('<!doctype html><html><body><main><h1>Staff access unavailable.</h1></main></body></html>')
      .setTitle('Staff access unavailable');
  }
}
