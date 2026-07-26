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
    return HtmlService.createHtmlOutputFromFile('StaffCheckIn')
      .setTitle('员工讲座签到');
  } catch (_ignored) {
    return HtmlService
      .createHtmlOutput('<!doctype html><html><body><main><h1>Staff access unavailable.</h1></main></body></html>')
      .setTitle('Staff access unavailable');
  }
}
