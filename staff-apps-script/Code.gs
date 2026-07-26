/** The dedicated staff Web App has no anonymous API surface. */
function doGet() {
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
