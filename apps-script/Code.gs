var PUBLIC_ERROR_MESSAGES = {
  EVENT_NOT_FOUND: '未找到该活动。',
  INVALID_REQUEST: '提交信息无效，请检查后重试。',
  REGISTRATION_CLOSED: '报名已截止。',
  REGISTRATION_FULL: '报名名额已满。',
  REGISTRATION_NOT_OPEN: '报名尚未开放。',
  DUPLICATE_REGISTRATION: '相同身份信息已报名。',
  SEAT_UNAVAILABLE: '所选座位不可用。',
  SEAT_EXCHANGE_DISABLED: '该活动不允许更换座位。',
  INTEGRITY_ERROR: '数据一致性检查失败，请联系管理员。',
  EXCHANGE_PENDING_CLEANUP: '座位更换正在清理旧座位，请稍后重试。',
  TICKET_ALREADY_VERIFIED: '该凭证已完成验票。',
  TICKET_NOT_FOUND: '未找到对应凭证。',
  TICKET_VERIFICATION_FAILED: '验证信息不匹配。',
  TOKEN_INVALID: '凭证无效或已过期。',
  NOT_IMPLEMENTED: '请求暂不可用。',
  INTERNAL: '请求未能完成，请稍后重试。'
};

var PUBLIC_ROUTES = {
  'listEvents': function(payload) { return listEvents(payload); },
  'getEvent': function(payload) { return getEvent(payload); },
  'createRegistration': function(payload) { return createRegistration(payload); },
  'lookupTicket': function(payload) { return lookupTicket(payload); },
  'verifyTicket': function(payload) { return verifyTicket(payload); },
  'cancelRegistration': function(payload) { return cancelRegistration(payload); },
  'exchangeSeat': function(payload) { return exchangeSeat(payload); }
};

/** Public health page, plus an authenticated entry to the separate staff deployment. */
function doGet(event) {
  if (event && event.parameter && event.parameter.view === 'staff') {
    try {
      return getStaffCheckInPage();
    } catch (_ignored) {
      return HtmlService
        .createHtmlOutput('<!doctype html><html><body><main><h1>Staff access unavailable.</h1></main></body></html>')
        .setTitle('Staff access unavailable');
    }
  }
  return HtmlService.createHtmlOutput('Event registration service is running.');
}

/** Routes only fixed public actions and always emits a safe JSON envelope. */
function doPost(event) {
  var result;
  try {
    if (!event || !event.postData || typeof event.postData.contents !== 'string') {
      result = publicFailure_('INVALID_REQUEST');
    } else {
      var envelope = JSON.parse(event.postData.contents);
      if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) ||
          typeof envelope.action !== 'string' ||
          !Object.prototype.hasOwnProperty.call(PUBLIC_ROUTES, envelope.action) ||
          !envelope.payload || typeof envelope.payload !== 'object' || Array.isArray(envelope.payload)) {
        result = publicFailure_(
          envelope && typeof envelope.action === 'string' &&
          !Object.prototype.hasOwnProperty.call(PUBLIC_ROUTES, envelope.action)
            ? 'NOT_IMPLEMENTED' : 'INVALID_REQUEST'
        );
      } else {
        result = normalizePublicResult_(PUBLIC_ROUTES[envelope.action](envelope.payload));
      }
    }
  } catch (_ignored) {
    result = publicFailure_('INTERNAL');
  }
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function normalizePublicResult_(result) {
  if (!result || typeof result !== 'object' || typeof result.ok !== 'boolean') {
    return publicFailure_('INTERNAL');
  }
  if (result.ok === true) return { ok: true, data: result.data };
  return publicFailure_(result.code);
}

function publicFailure_(code) {
  var safeCode = typeof code === 'string' &&
    Object.prototype.hasOwnProperty.call(PUBLIC_ERROR_MESSAGES, code) ? code : 'INTERNAL';
  return { ok: false, code: safeCode, message: PUBLIC_ERROR_MESSAGES[safeCode] };
}
