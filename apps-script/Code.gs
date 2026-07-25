/**
 * Public Apps Script entry points. Domain services are added in later stages.
 */
function doGet() {
  return HtmlService.createHtmlOutput('Event registration service is running.');
}

function doPost() {
  return ContentService
    .createTextOutput(JSON.stringify({
      ok: false,
      code: 'NOT_IMPLEMENTED',
      message: '请求暂不可用。'
    }))
    .setMimeType(ContentService.MimeType.JSON);
}
