/**
 * Combination-plan workbook projections.  Kept separate from the large
 * mutation service so it stays safely below the Apps Script editor file limit.
 */

/** Rebuilds the two human-readable sheets from the source-of-truth registry. */
function refreshBundlePlanOverview_(payload, _actor) {
  if (!payload || !bundleText_(payload.planId)) adminError_('INVALID_REQUEST');
  return refreshBundlePlanOverviewFromRegistry_(bundleRegistrySheet_(getRegistrySpreadsheet_()), bundleText_(payload.planId));
}

function refreshBundlePlanOverviewFromRegistry_(registry, planId) {
  var plans = bundleSheetRows_(registry.getSheetByName('组合计划'), BUNDLE_SHEET_HEADERS_['组合计划']).filter(function(row) {
    return String(row.planId) === String(planId);
  });
  if (plans.length !== 1) adminError_('NOT_FOUND');
  var plan = plans[0];
  var book = ensureBundlePlanWorkbook_(plan);
  var spreadsheet = SpreadsheetApp.openById(book.id);
  var registrations = bundleSheetRows_(registry.getSheetByName('组合报名'), BUNDLE_SHEET_HEADERS_['组合报名']).filter(function(row) {
    return String(row.planId) === String(planId);
  }).sort(function(left, right) { return String(left.createdAt).localeCompare(String(right.createdAt)); });
  var entitlements = bundleSheetRows_(registry.getSheetByName('组合资格'), BUNDLE_SHEET_HEADERS_['组合资格']).filter(function(row) {
    return String(row.planId) === String(planId);
  });
  var attendance = bundleSheetRows_(registry.getSheetByName('组合签到'), BUNDLE_SHEET_HEADERS_['组合签到']);
  var questions = bundlePlanOverviewQuestions_(registry, planId);
  var itemsById = bundlePlanOverviewItems_(registry, planId, entitlements);
  var usedHeaders = {};
  var questionHeaders = questions.map(function(question) {
    var base = String(question.label || question.questionId || '资料');
    var label = base; var suffix = 2;
    while (usedHeaders[label]) { label = base + ' (' + suffix + ')'; suffix += 1; }
    usedHeaders[label] = true;
    return label;
  });
  var registrationHeaders = ['报名编号', '电子票', '报名时间'].concat(questionHeaders).concat(['所选项目', '总票数', '状态']);
  var registrationRows = registrations.map(function(registration) {
    var answers = bundlePlanOverviewJson_(registration.answers, {});
    var answerCells = questions.map(function(question) { return bundlePlanOverviewValue_(answers[question.questionId]); });
    var selected = entitlements.filter(function(entitlement) {
      return String(entitlement.bundleRegistrationId) === String(registration.bundleRegistrationId) &&
        String(entitlement.status || '').toLowerCase() === 'active';
    });
    var total = selected.reduce(function(sum, entitlement) { return sum + Number(entitlement.fixedTicketCount || 0); }, 0);
    var selection = selected.map(function(entitlement) {
      var itemId = String(entitlement.eventId || '');
      var item = itemsById[itemId] || {};
      return String(item.title || itemId || '项目') + '（' + Number(entitlement.fixedTicketCount || 0) + '张）';
    }).join('\n');
    return [registration.bundleRegistrationId, registration.ticketNumber, registration.createdAt].concat(answerCells).concat([
      selection, total, bundlePlanOverviewStatus_(registration.status)
    ]);
  });
  var attendanceView = buildBundlePlanAttendanceOverview_(registrations, entitlements, attendance, itemsById, questions);
  var registrationView = writeReadableView_(spreadsheet, '报名总览', { headers: registrationHeaders, rows: registrationRows });
  attendanceView = writeReadableView_(spreadsheet, '签到总览', attendanceView);
  return { planId: String(planId), sheetUrl: book.url, registration: registrationView, attendance: attendanceView };
}

function bundlePlanOverviewQuestions_(registry, planId) {
  return bundleSheetRows_(registry.getSheetByName('组合问题'), BUNDLE_SHEET_HEADERS_['组合问题']).filter(function(row) {
    return String(row.planId) === String(planId);
  }).map(function(row) { return bundlePlanOverviewJson_(row.snapshot, null); }).filter(Boolean).sort(function(left, right) {
    return Number(left.sortOrder || 100) - Number(right.sortOrder || 100);
  });
}

function bundlePlanOverviewItems_(registry, planId, entitlements) {
  var items = {};
  bundleSheetRows_(registry.getSheetByName('组合项目'), BUNDLE_SHEET_HEADERS_['组合项目']).filter(function(item) {
    return String(item.planId) === String(planId);
  }).forEach(function(item) {
    var labels = bundlePlanOverviewJson_(item.checkInLabels, []);
    var count = Math.max(1, Number(item.checkInCount || 1));
    var mode = String(item.checkInMode || 'none').toLowerCase();
    var checkpoints = [];
    if (mode === 'none') checkpoints = ['无需签到'];
    else if (mode === 'multiple') {
      for (var index = 0; index < count; index += 1) checkpoints.push(String(labels[index] || ('第 ' + (index + 1) + ' 次签到')));
    } else checkpoints = [String(labels[0] || '签到')];
    items[String(item.bundleItemId)] = { title: String(item.title || item.bundleItemId), checkpoints: checkpoints };
  });
  readAdminRows_(registry, '活动目录').forEach(function(event) {
    if (!items[String(event.eventId)]) items[String(event.eventId)] = { title: String(event.title || event.eventId), checkpoints: ['签到'] };
  });
  (entitlements || []).forEach(function(entitlement) {
    var itemId = String(entitlement.eventId || '');
    if (itemId && !items[itemId]) items[itemId] = { title: itemId, checkpoints: ['签到'] };
  });
  return items;
}

/** Builds the wide, participant-first check-in overview for one combination plan. */
function buildBundlePlanAttendanceOverview_(registrations, entitlements, attendance, itemsById, questions) {
  // Object insertion order follows the plan's project-sheet order, so a later
  // project simply becomes the right-most column instead of reordering history.
  var itemIds = Object.keys(itemsById || {});
  var checkInColumns = [];
  itemIds.forEach(function(itemId) {
    var item = itemsById[itemId] || {};
    (item.checkpoints || ['签到']).forEach(function(label, index) {
      checkInColumns.push({ itemId: itemId, checkpointId: String(label) === '无需签到' ? '' : 'checkpoint-' + (index + 1), label: String(item.title || itemId) + ' · ' + String(label || '签到'), notRequired: String(label) === '无需签到' });
    });
  });
  var fields = (questions || []).slice().sort(function(left, right) { return Number(left.sortOrder || 100) - Number(right.sortOrder || 100); });
  var headers = ['电子票'].concat(fields.map(function(field) { return String(field.label || field.questionId || '资料'); })).concat(checkInColumns.map(function(column) { return column.label; }));
  var entitlementByRegistrationAndItem = {};
  (entitlements || []).forEach(function(entitlement) {
    if (String(entitlement.status || '').toLowerCase() !== 'active') return;
    entitlementByRegistrationAndItem[String(entitlement.bundleRegistrationId) + '|' + String(entitlement.eventId)] = entitlement;
  });
  var checkIns = {};
  (attendance || []).forEach(function(record) {
    if (String(record.status || '').toLowerCase() !== 'checked_in') return;
    checkIns[String(record.entitlementId) + '|' + String(record.checkpointId || 'checkpoint-1')] = String(record.checkedInAt || '已签到');
  });
  var rows = (registrations || []).map(function(registration) {
    var answers = bundlePlanOverviewJson_(registration.answers, {});
    var info = fields.map(function(field) { return bundlePlanOverviewValue_(answers[field.questionId]); });
    var states = checkInColumns.map(function(column) {
      var entitlement = entitlementByRegistrationAndItem[String(registration.bundleRegistrationId) + '|' + column.itemId];
      if (!entitlement) return '未报名';
      if (column.notRequired) return '无需签到';
      return checkIns[String(entitlement.entitlementId) + '|' + column.checkpointId] || '未签到';
    });
    return [String(registration.ticketNumber || '')].concat(info).concat(states);
  });
  return { headers: headers, rows: rows };
}

function bundlePlanOverviewJson_(value, fallback) {
  try { return JSON.parse(String(value || '')); } catch (_ignored) { return fallback; }
}

function bundlePlanOverviewValue_(value) {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.map(bundlePlanOverviewValue_).filter(Boolean).join('、');
  if (typeof value === 'object') return String(value.originalName || value.name || value.fileName || value.url || '已上传档案');
  return String(value);
}

function bundlePlanOverviewStatus_(value) {
  return String(value || '').toLowerCase() === 'active' ? '有效' : String(value || '');
}
