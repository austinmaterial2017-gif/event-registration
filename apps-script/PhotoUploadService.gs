var QUESTION_IMAGE_ROOT_FOLDER_ID = 'QUESTION_IMAGE_ROOT_FOLDER_ID';
var REGISTRATION_UPLOAD_ROOT_FOLDER_ID = 'REGISTRATION_UPLOAD_' + 'ROOT_FOLDER_ID';
var PHOTO_MAX_BYTES_ = 5 * 1024 * 1024;
var PHOTO_ANSWER_TYPES_ = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/heif': 'heif'
};
var PHOTO_PROMPT_TYPES_ = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
};

function photoUploadError_(code) {
  var error = new Error(code || 'INVALID_REQUEST');
  error.publicCode = code || 'INVALID_REQUEST';
  throw error;
}

function photoRootFolder_(propertyName) {
  var id = PropertiesService.getScriptProperties().getProperty(propertyName);
  if (!id) photoUploadError_('INTEGRITY_ERROR');
  try {
    var folder = DriveApp.getFolderById(id);
    if (!folder) photoUploadError_('INTEGRITY_ERROR');
    return folder;
  } catch (_error) {
    photoUploadError_('INTEGRITY_ERROR');
  }
}

function photoOptionsObject_(serialized) {
  if (!serialized) return { choices: [] };
  try {
    var parsed = typeof serialized === 'string' ? JSON.parse(serialized) : serialized;
    if (Array.isArray(parsed)) return { choices: parsed.slice() };
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : { choices: [] };
  } catch (_error) {
    return { choices: [] };
  }
}

function photoBaseName_(value) {
  var name = String(value || 'image').replace(/\\/g, '/').split('/').pop();
  name = name.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  name = name.replace(/[^A-Za-z0-9._() -]+/g, '_').replace(/^\.+/, '');
  return name.slice(0, 120) || 'image';
}

function photoFolderName_(prefix, value) {
  var text = String(value || '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return (prefix + '-' + (text || 'item')).slice(0, 120);
}

function photoBase64Value_(file) {
  var direct = typeof file.base64 === 'string' ? file.base64.trim() : '';
  if (direct) return direct;
  var dataUrl = typeof file.dataUrl === 'string' ? file.dataUrl.trim() : '';
  var match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
  if (!match || String(match[1]).toLowerCase() !== String(file.mimeType || '').toLowerCase()) {
    photoUploadError_('INVALID_REQUEST');
  }
  return match[2].replace(/\s+/g, '');
}

function normalizePhotoFile_(file, allowedTypes, maxBytes) {
  if (!file || typeof file !== 'object' || Array.isArray(file)) photoUploadError_('INVALID_REQUEST');
  var mimeType = String(file.mimeType || '').toLowerCase();
  if (!allowedTypes[mimeType]) photoUploadError_('INVALID_REQUEST');
  var declaredSize = Number(file.size);
  if (!isFinite(declaredSize) || Math.floor(declaredSize) !== declaredSize ||
      declaredSize < 1 || declaredSize > maxBytes) photoUploadError_('INVALID_REQUEST');
  var base64 = photoBase64Value_(file);
  if (!base64 || base64.length > Math.ceil(maxBytes / 3) * 4 + 8) {
    photoUploadError_('INVALID_REQUEST');
  }
  var bytes;
  try { bytes = Utilities.base64Decode(base64); }
  catch (_decodeError) { photoUploadError_('INVALID_REQUEST'); }
  if (!bytes || bytes.length !== declaredSize || bytes.length > maxBytes) {
    photoUploadError_('INVALID_REQUEST');
  }
  var originalName = photoBaseName_(file.originalName || file.name || ('image.' + allowedTypes[mimeType]));
  return {
    originalName: originalName,
    mimeType: mimeType,
    size: bytes.length,
    extension: allowedTypes[mimeType],
    bytes: bytes
  };
}

function validateRegistrationUploads_(questions, uploads) {
  var questionList = Array.isArray(questions) ? questions : [];
  var source = uploads && typeof uploads === 'object' && !Array.isArray(uploads) ? uploads : {};
  var photoQuestions = {};
  questionList.forEach(function(question) {
    if (!question || String(question.status || '').toLowerCase() !== 'active' ||
        String(question.type || '').toLowerCase() !== 'photo') return;
    photoQuestions[String(question.questionId || '')] = question;
  });
  Object.keys(source).forEach(function(questionId) {
    if (!photoQuestions[questionId]) photoUploadError_('INVALID_REQUEST');
  });
  var normalized = {};
  Object.keys(photoQuestions).forEach(function(questionId) {
    var question = photoQuestions[questionId];
    var files = source[questionId] === undefined ? [] : source[questionId];
    if (!Array.isArray(files)) photoUploadError_('INVALID_REQUEST');
    var options = photoOptionsObject_(question.options);
    var upload = options.upload && typeof options.upload === 'object' ? options.upload : {};
    var maxFiles = Number(upload.maxFiles === undefined ? 3 : upload.maxFiles);
    var maxBytes = Number(upload.maxBytes === undefined ? PHOTO_MAX_BYTES_ : upload.maxBytes);
    if (!isFinite(maxFiles) || Math.floor(maxFiles) !== maxFiles || maxFiles < 1 || maxFiles > 5 ||
        !isFinite(maxBytes) || Math.floor(maxBytes) !== maxBytes || maxBytes < 1 ||
        maxBytes > PHOTO_MAX_BYTES_) photoUploadError_('INTEGRITY_ERROR');
    if (files.length > maxFiles || (question.required && !files.length)) {
      photoUploadError_('INVALID_REQUEST');
    }
    if (files.length) {
      normalized[questionId] = files.map(function(file) {
        return normalizePhotoFile_(file, PHOTO_ANSWER_TYPES_, maxBytes);
      });
    }
  });
  return normalized;
}

function saveRegistrationUploads_(eventId, registrationId, normalizedUploads) {
  var source = normalizedUploads && typeof normalizedUploads === 'object' ? normalizedUploads : {};
  if (!Object.keys(source).length) return { answersByQuestion: {}, receipt: { files: [], folders: [] } };
  var root = photoRootFolder_(REGISTRATION_UPLOAD_ROOT_FOLDER_ID);
  var receipt = { files: [], folders: [] };
  var answersByQuestion = {};
  try {
    var eventFolder = root.createFolder(photoFolderName_('event', eventId));
    receipt.folders.push(eventFolder.getId());
    var registrationFolder = eventFolder.createFolder(photoFolderName_('registration', registrationId));
    receipt.folders.unshift(registrationFolder.getId());
    Object.keys(source).forEach(function(questionId) {
      answersByQuestion[questionId] = source[questionId].map(function(file, index) {
        var serverName = photoFolderName_('question', questionId) + '-' + (index + 1) + '.' + file.extension;
        var blob = Utilities.newBlob(file.bytes, file.mimeType, serverName);
        var driveFile = registrationFolder.createFile(blob);
        receipt.files.push(driveFile.getId());
        return {
          originalName: file.originalName,
          mimeType: file.mimeType,
          size: file.size,
          adminUrl: driveFile.getUrl(),
          storageKey: driveFile.getId()
        };
      });
    });
    return { answersByQuestion: answersByQuestion, receipt: receipt };
  } catch (error) {
    rollbackRegistrationUploads_(receipt);
    throw error;
  }
}

function rollbackRegistrationUploads_(receipt) {
  var record = receipt && typeof receipt === 'object' ? receipt : {};
  (Array.isArray(record.files) ? record.files : []).slice().reverse().forEach(function(id) {
    try { DriveApp.getFileById(id).setTrashed(true); } catch (_ignored) {}
  });
  (Array.isArray(record.folders) ? record.folders : []).forEach(function(id) {
    try { DriveApp.getFolderById(id).setTrashed(true); } catch (_ignored) {}
  });
}

function savePromptImageFile_(file, alt) {
  var normalized = normalizePhotoFile_(file, PHOTO_PROMPT_TYPES_, PHOTO_MAX_BYTES_);
  var root = photoRootFolder_(QUESTION_IMAGE_ROOT_FOLDER_ID);
  var driveFile = root.createFile(Utilities.newBlob(
    normalized.bytes,
    normalized.mimeType,
    'question-image-' + new Date().getTime() + '.' + normalized.extension
  ));
  driveFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  var url = 'https://drive.google.com/uc?export=view&id=' + encodeURIComponent(driveFile.getId());
  return {
    storedValue: {
      url: url,
      alt: String(alt || '').trim().slice(0, 160),
      storageKey: driveFile.getId()
    },
    publicValue: {
      url: url,
      alt: String(alt || '').trim().slice(0, 160)
    }
  };
}

function trashPromptImage_(storageKey) {
  if (!storageKey) return;
  try { DriveApp.getFileById(storageKey).setTrashed(true); } catch (_ignored) {}
}

function savePromptQuestionImage_(payload, actor) {
  var request = requireAdminObject_(payload);
  if (typeof request.eventId !== 'string' || !request.eventId.trim() ||
      typeof request.questionId !== 'string' || !request.questionId.trim()) {
    adminError_('INVALID_REQUEST');
  }
  return withScriptLock_(function() {
    var registry = getRootConfiguredSpreadsheet_();
    requireNoSwitchMaintenance_(registry);
    var spreadsheet = getAdminEventSpreadsheet_(registry, request.eventId.trim());
    var question = findAdminEventChildRow_(
      spreadsheet, '报名问题', 'questionId', request.questionId.trim(), request.eventId.trim()
    );
    if (!question) adminError_('NOT_FOUND');
    var previous = photoOptionsObject_(question.options).promptImage;
    var saved = savePromptImageFile_(request.file, request.alt);
    try {
      var options = photoOptionsObject_(question.options);
      options.promptImage = saved.storedValue;
      question.options = JSON.stringify(options);
      question.updatedAt = new Date().toISOString();
      writeAdminRow_(spreadsheet, '报名问题', question.rowNumber, question);
      appendAdminAudit_(spreadsheet, 'UPLOAD_QUESTION_IMAGE', 'question', question.questionId,
        actor, { eventId: question.eventId });
    } catch (error) {
      trashPromptImage_(saved.storedValue.storageKey);
      throw error;
    }
    if (previous && previous.storageKey) trashPromptImage_(previous.storageKey);
    return saved.publicValue;
  });
}

function removePromptQuestionImage_(payload, actor) {
  var request = requireAdminObject_(payload);
  if (request.confirm !== true || typeof request.eventId !== 'string' || !request.eventId.trim() ||
      typeof request.questionId !== 'string' || !request.questionId.trim()) {
    adminError_(request.confirm === true ? 'INVALID_REQUEST' : 'CONFIRMATION_REQUIRED');
  }
  return withScriptLock_(function() {
    var registry = getRootConfiguredSpreadsheet_();
    requireNoSwitchMaintenance_(registry);
    var spreadsheet = getAdminEventSpreadsheet_(registry, request.eventId.trim());
    var question = findAdminEventChildRow_(
      spreadsheet, '报名问题', 'questionId', request.questionId.trim(), request.eventId.trim()
    );
    if (!question) adminError_('NOT_FOUND');
    var options = photoOptionsObject_(question.options);
    var previous = options.promptImage;
    delete options.promptImage;
    question.options = JSON.stringify(options);
    question.updatedAt = new Date().toISOString();
    writeAdminRow_(spreadsheet, '报名问题', question.rowNumber, question);
    if (previous && previous.storageKey) trashPromptImage_(previous.storageKey);
    appendAdminAudit_(spreadsheet, 'REMOVE_QUESTION_IMAGE', 'question', question.questionId,
      actor, { eventId: question.eventId });
    return { removed: true };
  });
}
