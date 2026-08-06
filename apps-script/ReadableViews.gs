var READABLE_REGISTRATION_SHEET_ = '\u62a5\u540d\u603b\u89c8';
var READABLE_ATTENDANCE_SHEET_ = '\u7b7e\u5230\u603b\u89c8';

function readableArray_(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  try {
    var parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : [];
  } catch (_ignored) {
    return [];
  }
}

function readableStoredAnswers_(value) {
  try {
    var parsed = typeof value === 'string' ? JSON.parse(value || '{}') : value;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed.values && typeof parsed.values === 'object' && !Array.isArray(parsed.values)
      ? parsed.values : parsed;
  } catch (_ignored) {
    return {};
  }
}

function readableText_(value, emptyValue) {
  if (Array.isArray(value)) {
    var items = value.filter(function(item) {
      return item !== undefined && item !== null && String(item).trim();
    }).map(function(item) { return String(item).trim(); });
    return items.length ? items.join('\u3001') : (emptyValue || '');
  }
  if (value === true) return '\u662f';
  if (value === false) return '\u5426';
  if (value === undefined || value === null || String(value).trim() === '') {
    return emptyValue || '';
  }
  return String(value).trim();
}

function readableStatus_(status) {
  var normalized = String(status || '').toLowerCase();
  if (normalized === 'active' || normalized === 'confirmed') return '\u6709\u6548';
  if (normalized === 'cancelled' || normalized === 'canceled') return '\u5df2\u53d6\u6d88';
  if (normalized === 'pending') return '\u5904\u7406\u4e2d';
  return normalized || '\u672a\u77e5';
}

function readableUniqueHeader_(used, preferred) {
  var base = String(preferred || '').trim() || '\u672a\u547d\u540d';
  var candidate = base;
  var suffix = 2;
  while (used[candidate]) {
    candidate = base + ' (' + suffix + ')';
    suffix += 1;
  }
  used[candidate] = true;
  return candidate;
}

function readableGroupedRegistrations_(source) {
  var participantById = {};
  (source.participants || []).forEach(function(participant) {
    participantById[String(participant.participantId || '')] = participant;
  });
  var grouped = {};
  var order = [];
  (source.registrations || []).forEach(function(record) {
    if (source.eventId && String(record.eventId || '') !== String(source.eventId)) return;
    var id = String(record.registrationId || '').trim();
    if (!id) return;
    if (!grouped[id]) {
      grouped[id] = {
        registrationId: id,
        eventId: String(record.eventId || ''),
        participantId: String(record.participantId || ''),
        ticketNumber: String(record.ticketNumber || ''),
        status: String(record.status || ''),
        createdAt: String(record.createdAt || ''),
        updatedAt: String(record.updatedAt || ''),
        sessionIds: [],
        seatIds: [],
        answers: {}
      };
      order.push(id);
    }
    var target = grouped[id];
    readableArray_(record.sessionIds).forEach(function(sessionId) {
      sessionId = String(sessionId || '');
      if (sessionId && target.sessionIds.indexOf(sessionId) === -1) target.sessionIds.push(sessionId);
    });
    readableArray_(record.seatChoices).forEach(function(seatId) {
      seatId = String(seatId || '');
      if (seatId && target.seatIds.indexOf(seatId) === -1) target.seatIds.push(seatId);
    });
    var answers = readableStoredAnswers_(record.answers);
    Object.keys(answers).forEach(function(key) {
      if (target.answers[key] === undefined || target.answers[key] === null || target.answers[key] === '') {
        target.answers[key] = answers[key];
      }
    });
    if (String(record.updatedAt || '') > target.updatedAt) target.updatedAt = String(record.updatedAt || '');
    if (String(record.status || '').toLowerCase() === 'cancelled') target.status = 'cancelled';
  });
  return order.map(function(id) {
    var item = grouped[id];
    item.participant = participantById[item.participantId] || {};
    return item;
  });
}

function readableSessionPolicy_(source, sessionId) {
  var sessions = source.policy && source.policy.sessions;
  return sessions && typeof sessions === 'object' && sessions[sessionId] || {};
}

function readableIdentity_(source, registration, role) {
  var roles = source.policy && source.policy.fieldRoles || {};
  var questionId = roles[role];
  var answer = questionId ? registration.answers[questionId] : '';
  if (readableText_(answer, '')) return readableText_(answer, '');
  return readableText_(registration.participant && registration.participant[role], '');
}

function readableQuestionColumns_(source) {
  var roles = source.policy && source.policy.fieldRoles || {};
  var hidden = {};
  ['name', 'phone', 'email'].forEach(function(role) {
    if (roles[role]) hidden[String(roles[role])] = true;
  });
  var used = {
    '\u62a5\u540d\u72b6\u6001': true, '\u59d3\u540d': true,
    '\u7535\u8bdd\u53f7\u7801': true, '\u5ea7\u4f4d': true,
    '\u7968\u53f7': true, '\u62a5\u540d\u65f6\u95f4': true,
    '\u767b\u8bb0\u7f16\u53f7': true
  };
  return (source.questions || []).filter(function(question) {
    return String(question.status || '').toLowerCase() !== 'inactive' &&
      !hidden[String(question.questionId || '')];
  }).sort(function(left, right) {
    return Number(left.sortOrder || 0) - Number(right.sortOrder || 0);
  }).map(function(question) {
    return {
      id: String(question.questionId || ''),
      header: readableUniqueHeader_(used, question.label)
    };
  });
}

function readableSessionGroups_(source) {
  var used = {};
  var groups = [];
  (source.sessions || []).filter(function(session) {
    return !source.eventId || String(session.eventId || '') === String(source.eventId);
  }).forEach(function(session) {
    var policy = readableSessionPolicy_(source, String(session.sessionId || ''));
    var key = String(policy.groupRule || session.title || '\u573a\u6b21').trim();
    var group = groups.filter(function(item) { return item.key === key; })[0];
    if (!group) {
      group = { key: key, header: readableUniqueHeader_(used, key), sessions: [] };
      groups.push(group);
    }
    group.sessions.push(session);
  });
  return groups;
}

function buildReadableRegistrationOverview_(source) {
  var questionColumns = readableQuestionColumns_(source);
  var sessionGroups = readableSessionGroups_(source);
  var sessionById = {};
  (source.sessions || []).forEach(function(session) {
    sessionById[String(session.sessionId || '')] = session;
  });
  var seatById = {};
  (source.seats || []).forEach(function(seat) { seatById[String(seat.seatId || '')] = seat; });
  var headers = ['\u62a5\u540d\u72b6\u6001', '\u59d3\u540d', '\u7535\u8bdd\u53f7\u7801']
    .concat(questionColumns.map(function(column) { return column.header; }))
    .concat(sessionGroups.map(function(group) { return group.header; }))
    .concat(['\u5ea7\u4f4d', '\u7968\u53f7', '\u62a5\u540d\u65f6\u95f4', '\u767b\u8bb0\u7f16\u53f7']);
  var rows = readableGroupedRegistrations_(source).map(function(registration) {
    var row = [
      readableStatus_(registration.status),
      readableIdentity_(source, registration, 'name'),
      readableIdentity_(source, registration, 'phone')
    ];
    questionColumns.forEach(function(column) {
      row.push(readableText_(registration.answers[column.id], '\u672a\u586b\u5199'));
    });
    sessionGroups.forEach(function(group) {
      var selected = group.sessions.filter(function(session) {
        return registration.sessionIds.indexOf(String(session.sessionId || '')) !== -1;
      }).map(function(session) {
        return readableText_(session.speaker, '') || readableText_(session.title, '');
      });
      row.push(selected.length ? selected.join('\u3001') : '\u672a\u9009');
    });
    var seatLabels = registration.seatIds.map(function(seatId) {
      var seat = seatById[seatId];
      if (!seat) return seatId;
      return [readableText_(seat.zone, ''), readableText_(seat.label, seatId)]
        .filter(Boolean).join(' ');
    });
    row.push(seatLabels.length ? seatLabels.join('\u3001') : '\u81ea\u7531\u5165\u5ea7');
    row.push(registration.ticketNumber, registration.createdAt, registration.registrationId);
    return row;
  });
  return { headers: headers, rows: rows };
}

function readableCheckpointColumns_(source) {
  var columns = [];
  (source.sessions || []).filter(function(session) {
    return !source.eventId || String(session.eventId || '') === String(source.eventId);
  }).forEach(function(session) {
    var sessionId = String(session.sessionId || '');
    var policy = readableSessionPolicy_(source, sessionId);
    var mode = String(policy.checkInMode || 'single').toLowerCase();
    if (mode === 'none') return;
    var count = mode === 'single' ? 1 : Number(policy.checkInCount || 1);
    if (!Number.isInteger(count) || count < 1) count = 1;
    var labels = Array.isArray(policy.checkInLabels) ? policy.checkInLabels : [];
    for (var index = 0; index < count; index += 1) {
      var checkpointId = 'checkpoint-' + (index + 1);
      var label = readableText_(labels[index], '') ||
        (count === 1 ? '\u7b7e\u5230' : ('\u7b2c ' + (index + 1) + ' \u6b21\u7b7e\u5230'));
      var group = String(policy.groupRule || session.title || '\u573a\u6b21').trim();
      var speaker = readableText_(session.speaker, '') || readableText_(session.title, '');
      columns.push({
        sessionId: sessionId,
        checkpointId: checkpointId,
        header: group + ' \u00b7 ' + speaker + ' \u00b7 ' + label
      });
    }
  });
  return columns;
}

function buildReadableAttendanceOverview_(source) {
  var checkpointColumns = readableCheckpointColumns_(source);
  var attendanceByKey = {};
  (source.attendance || []).forEach(function(record) {
    if (source.eventId && String(record.eventId || '') !== String(source.eventId)) return;
    if (String(record.status || '').toLowerCase() !== 'checked_in') return;
    var checkpointId = String(record.checkpointId || 'checkpoint-1');
    attendanceByKey[
      String(record.registrationId || '') + '|' +
      String(record.sessionId || '') + '|' + checkpointId
    ] = record;
  });
  var headers = ['\u62a5\u540d\u72b6\u6001', '\u59d3\u540d', '\u7535\u8bdd\u53f7\u7801']
    .concat(checkpointColumns.map(function(column) { return column.header; }))
    .concat(['\u7968\u53f7', '\u767b\u8bb0\u7f16\u53f7']);
  var rows = readableGroupedRegistrations_(source).map(function(registration) {
    var cancelled = readableStatus_(registration.status) === '\u5df2\u53d6\u6d88';
    var row = [
      readableStatus_(registration.status),
      readableIdentity_(source, registration, 'name'),
      readableIdentity_(source, registration, 'phone')
    ];
    checkpointColumns.forEach(function(column) {
      if (cancelled) { row.push('\u5df2\u53d6\u6d88'); return; }
      if (registration.sessionIds.indexOf(column.sessionId) === -1) {
        row.push('\u672a\u62a5\u540d');
        return;
      }
      var record = attendanceByKey[
        registration.registrationId + '|' + column.sessionId + '|' + column.checkpointId
      ];
      row.push(record
        ? ('\u5df2\u7b7e\u5230 ' + readableText_(record.checkedInAt, ''))
        : '\u672a\u7b7e\u5230');
    });
    row.push(registration.ticketNumber, registration.registrationId);
    return row;
  });
  return { headers: headers, rows: rows };
}

function readableViewSource_(spreadsheet, eventId, settings) {
  var eventPolicy = settings && settings.registration && settings.registration.events &&
    settings.registration.events[eventId] || {};
  return {
    eventId: eventId,
    policy: eventPolicy,
    participants: readRows(spreadsheet, '\u53c2\u52a0\u8005'),
    questions: readRows(spreadsheet, '\u62a5\u540d\u95ee\u9898'),
    sessions: readRows(spreadsheet, '\u573a\u6b21'),
    seats: readRows(spreadsheet, '\u5ea7\u4f4d'),
    registrations: readRows(spreadsheet, '\u62a5\u540d\u9879\u76ee'),
    attendance: readRows(spreadsheet, '\u7b7e\u5230\u8bb0\u5f55')
  };
}

function readableSafeCell_(value) {
  var text = value === undefined || value === null ? '' : String(value);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function writeReadableView_(spreadsheet, sheetName, view) {
  var sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) sheet = spreadsheet.insertSheet(sheetName);
  sheet.clearContents();
  var values = [view.headers].concat(view.rows).map(function(row) {
    return row.map(readableSafeCell_);
  });
  sheet.getRange(1, 1, values.length, view.headers.length).setValues(values);
  if (typeof sheet.setFrozenRows === 'function') sheet.setFrozenRows(1);
  var header = sheet.getRange(1, 1, 1, view.headers.length);
  if (typeof header.setFontWeight === 'function') header.setFontWeight('bold');
  if (typeof header.setBackground === 'function') header.setBackground('#f3f4f6');
  if (typeof sheet.autoResizeColumns === 'function') {
    sheet.autoResizeColumns(1, view.headers.length);
  }
  if (values.length > 1) {
    var body = sheet.getRange(2, 1, values.length - 1, view.headers.length);
    if (typeof body.setWrap === 'function') body.setWrap(true);
    if (typeof body.setVerticalAlignment === 'function') body.setVerticalAlignment('middle');
  }
  return { sheetName: sheetName, rowCount: view.rows.length };
}

function refreshReadableViews_(spreadsheet, eventId, settings) {
  var source = readableViewSource_(spreadsheet, eventId, settings || {});
  return {
    registration: writeReadableView_(
      spreadsheet, READABLE_REGISTRATION_SHEET_,
      buildReadableRegistrationOverview_(source)
    ),
    attendance: writeReadableView_(
      spreadsheet, READABLE_ATTENDANCE_SHEET_,
      buildReadableAttendanceOverview_(source)
    )
  };
}

function readableRowObject_(sheetName, values) {
  var headers = SHEET_DEFINITIONS[sheetName] || [];
  var row = {};
  headers.forEach(function(header, index) { row[header] = values[index]; });
  return row;
}

function readableHeadersMatch_(sheet, headers) {
  if (!sheet || sheet.getLastColumn() !== headers.length || sheet.getLastRow() < 1) return false;
  var current = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  return headers.every(function(header, index) { return String(current[index] || '') === header; });
}

function upsertReadableViewRow_(sheet, view) {
  if (!view.rows.length) return;
  var idColumn = view.headers.indexOf('\u767b\u8bb0\u7f16\u53f7') + 1;
  if (!idColumn) return;
  var registrationId = String(view.rows[0][idColumn - 1] || '');
  var rowNumber = 0;
  if (registrationId && sheet.getLastRow() > 1) {
    sheet.getRange(2, idColumn, sheet.getLastRow() - 1, 1).getValues()
      .some(function(row, index) {
        if (String(row[0] || '') !== registrationId) return false;
        rowNumber = index + 2;
        return true;
      });
  }
  if (!rowNumber) rowNumber = sheet.getLastRow() + 1;
  sheet.getRange(rowNumber, 1, 1, view.headers.length)
    .setValues([view.rows[0].map(readableSafeCell_)]);
}

function upsertReadableViewsFromSource_(spreadsheet, source, settings) {
  var registrationSheet = spreadsheet.getSheetByName(READABLE_REGISTRATION_SHEET_);
  var attendanceSheet = spreadsheet.getSheetByName(READABLE_ATTENDANCE_SHEET_);
  var registrationView = buildReadableRegistrationOverview_(source);
  var attendanceView = buildReadableAttendanceOverview_(source);
  if (!registrationSheet || !attendanceSheet ||
      !readableHeadersMatch_(registrationSheet, registrationView.headers) ||
      !readableHeadersMatch_(attendanceSheet, attendanceView.headers)) {
    return refreshReadableViews_(spreadsheet, source.eventId, settings || {});
  }
  upsertReadableViewRow_(registrationSheet, registrationView);
  upsertReadableViewRow_(attendanceSheet, attendanceView);
  return {
    registration: { sheetName: READABLE_REGISTRATION_SHEET_, rowCount: 1 },
    attendance: { sheetName: READABLE_ATTENDANCE_SHEET_, rowCount: 1 }
  };
}

function upsertReadableViewsSafely_(spreadsheet, source, settings) {
  try {
    return upsertReadableViewsFromSource_(spreadsheet, source, settings || {});
  } catch (error) {
    if (typeof console !== 'undefined' && console.error) {
      console.error('Readable view upsert failed', source && source.eventId, error);
    }
    return null;
  }
}

function syncReadableRegistration_(spreadsheet, eventId, registrationId, settings) {
  try {
    var source = readableViewSource_(spreadsheet, eventId, settings || {});
    source.registrations = source.registrations.filter(function(record) {
      return String(record.registrationId || '') === String(registrationId || '');
    });
    var participantIds = {};
    source.registrations.forEach(function(record) {
      participantIds[String(record.participantId || '')] = true;
    });
    source.participants = source.participants.filter(function(participant) {
      return participantIds[String(participant.participantId || '')] === true;
    });
    source.attendance = source.attendance.filter(function(record) {
      return String(record.registrationId || '') === String(registrationId || '');
    });
    return upsertReadableViewsFromSource_(spreadsheet, source, settings || {});
  } catch (error) {
    if (typeof console !== 'undefined' && console.error) {
      console.error('Readable registration sync failed', eventId, registrationId, error);
    }
    return null;
  }
}

function refreshReadableViewsSafely_(spreadsheet, eventId, settings) {
  try {
    return refreshReadableViews_(spreadsheet, eventId, settings);
  } catch (error) {
    if (typeof console !== 'undefined' && console.error) {
      console.error('Readable view refresh failed', eventId, error);
    }
    return null;
  }
}

function refreshExistingReadableViewsSafely_(spreadsheet, eventId, settings) {
  if (!spreadsheet.getSheetByName(READABLE_REGISTRATION_SHEET_) &&
      !spreadsheet.getSheetByName(READABLE_ATTENDANCE_SHEET_)) return null;
  return refreshReadableViewsSafely_(spreadsheet, eventId, settings);
}
