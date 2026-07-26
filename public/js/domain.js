const CAPABILITIES = {
  draft: { visible: false, canRegister: false, canCheckIn: false },
  upcoming: { visible: true, canRegister: false, canCheckIn: false },
  open: { visible: true, canRegister: true, canCheckIn: false },
  closed: { visible: true, canRegister: false, canCheckIn: false },
  live: { visible: true, canRegister: false, canCheckIn: true },
  ended: { visible: true, canRegister: false, canCheckIn: false },
  cancelled: { visible: true, canRegister: false, canCheckIn: false },
  archived: { visible: false, canRegister: false, canCheckIn: false }
};

const ISO_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

function parseIsoDateTime(value) {
  if (typeof value !== "string") return null;

  const match = ISO_DATE_TIME.exec(value);
  if (!match) return null;

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const calendarDate = new Date(0);
  calendarDate.setUTCFullYear(year, month - 1, day);

  if (
    calendarDate.getUTCFullYear() !== year ||
    calendarDate.getUTCMonth() !== month - 1 ||
    calendarDate.getUTCDate() !== day
  ) {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function getChoiceBound(event, property, fallback) {
  const value = event?.[property];
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function hasAnswer(value, type) {
  if (type === "checkbox") {
    if (value === true) return true;
    if (!Array.isArray(value)) return false;
    return value.some((item) => typeof item === "string" ? item.trim() !== "" : item === true);
  }

  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.some((item) => typeof item === "string" ? item.trim() !== "" : item != null);
  return value !== null && value !== undefined && value !== false;
}

function validateSelectionGroups(sessions, selectedIds, errors) {
  const groups = new Map();
  for (const session of sessions) {
    const source = session?.groupRule;
    if (!source) continue;
    const rule = typeof source === "string"
      ? { id: source.trim(), min: 0, max: 1 }
      : {
          id: String(source.id || source.groupId || "").trim(),
          min: Number.isInteger(Number(source.min)) && Number(source.min) >= 0 ? Number(source.min) : 0,
          max: Number.isInteger(Number(source.max)) && Number(source.max) >= 0 ? Number(source.max) : 1
        };
    if (!rule.id || rule.min > rule.max) {
      errors.push("场次分组规则无效。");
      continue;
    }
    const existing = groups.get(rule.id);
    if (existing && (existing.min !== rule.min || existing.max !== rule.max)) {
      errors.push(`场次分组“${rule.id}”的规则不一致。`);
      continue;
    }
    const group = existing || { ...rule, selected: 0 };
    if (selectedIds.has(session.id)) group.selected += 1;
    groups.set(rule.id, group);
  }
  for (const group of groups.values()) {
    if (group.selected < group.min || group.selected > group.max) {
      errors.push(`场次分组“${group.id}”需选择 ${group.min} 至 ${group.max} 个。`);
    }
  }
}

function validateAnswerConstraints(field, value, errors) {
  if (!field || typeof field.id !== "string" || errors[field.id] || !hasAnswer(value, field.type)) {
    return;
  }
  const constraints = field.constraints && typeof field.constraints === "object"
    ? field.constraints : {};
  const choices = Array.isArray(field.options) ? field.options : [];
  const label = typeof field.label === "string" && field.label.trim() ? field.label : field.id;
  const invalid = (message) => { errors[field.id] = `${label}${message}`; };

  if (field.type === "checkbox") {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
      invalid("的选项无效。");
      return;
    }
    if (new Set(value).size !== value.length ||
        (choices.length && value.some((item) => !choices.includes(item)))) {
      invalid("包含无效选项。");
      return;
    }
    const min = constraints.minSelections === undefined ? null : Number(constraints.minSelections);
    const max = constraints.maxSelections === undefined ? null : Number(constraints.maxSelections);
    if ((min !== null && (!Number.isInteger(min) || min < 0 || value.length < min)) ||
        (max !== null && (!Number.isInteger(max) || max < 0 || value.length > max)) ||
        (min !== null && max !== null && min > max)) {
      invalid("的选择数量不符合要求。");
    }
    return;
  }
  if (field.type === "boolean") {
    if (typeof value !== "boolean") invalid("必须是是／否值。");
    return;
  }
  if (field.type === "number") {
    const number = typeof value === "number"
      ? value
      : typeof value === "string" && /^-?(?:\d+|\d*\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())
        ? Number(value) : Number.NaN;
    if (!Number.isFinite(number) ||
        (constraints.min !== undefined && number < Number(constraints.min)) ||
        (constraints.max !== undefined && number > Number(constraints.max))) {
      invalid("的数值不符合要求。");
    }
    return;
  }
  if (typeof value !== "string") {
    invalid("的格式无效。");
    return;
  }
  const text = value.trim();
  if ((constraints.minLength !== undefined && text.length < Number(constraints.minLength)) ||
      (constraints.maxLength !== undefined && text.length > Number(constraints.maxLength))) {
    invalid("的长度不符合要求。");
    return;
  }
  if (constraints.pattern) {
    try {
      if (!(new RegExp(constraints.pattern)).test(text)) invalid("的格式不符合要求。");
    } catch {
      invalid("的验证规则无效。");
    }
  }
  if ((field.type === "radio" || field.type === "select") &&
      choices.length && !choices.includes(text)) {
    invalid("包含无效选项。");
  } else if (field.type === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text)) {
    invalid("的电邮格式无效。");
  } else if (field.type === "tel" && !/^[+()\-\s0-9]{6,30}$/.test(text)) {
    invalid("的电话格式无效。");
  } else if (field.type === "date" && !Number.isFinite(Date.parse(text))) {
    invalid("的日期格式无效。");
  }
}

export function validateSelection(event, sessions, selectedIds) {
  const errors = [];
  const selected = Array.isArray(selectedIds) ? selectedIds : [];
  const availableSessions = Array.isArray(sessions) ? sessions : [];
  const sessionById = new Map(availableSessions.filter((session) => session && typeof session.id === "string").map((session) => [session.id, session]));

  if (!Array.isArray(selectedIds)) {
    errors.push("场次选择必须是数组。");
  }

  const uniqueSelectedIds = new Set();
  for (const sessionId of selected) {
    if (typeof sessionId !== "string" || sessionId.trim() === "") {
      errors.push("场次编号无效。");
      continue;
    }
    if (uniqueSelectedIds.has(sessionId)) {
      errors.push(`场次“${sessionId}”重复选择。`);
      continue;
    }
    uniqueSelectedIds.add(sessionId);
    if (!sessionById.has(sessionId)) {
      errors.push(`场次“${sessionId}”不存在。`);
    }
  }

  const minChoices = getChoiceBound(event, "minChoices", 0);
  const maxChoices = getChoiceBound(event, "maxChoices", Number.POSITIVE_INFINITY);
  if (minChoices > maxChoices) {
    errors.push("场次选择规则无效：最少选择数不能大于最多选择数。");
  }
  if (uniqueSelectedIds.size < minChoices) {
    errors.push(`请至少选择 ${minChoices} 个场次。`);
  }
  if (uniqueSelectedIds.size > maxChoices) {
    errors.push(`最多选择 ${maxChoices} 个场次。`);
  }

  for (const session of availableSessions) {
    if (session?.required === true && !uniqueSelectedIds.has(session.id)) {
      errors.push(`必选场次“${session.id}”尚未选择。`);
    }
  }

  validateSelectionGroups(availableSessions, uniqueSelectedIds, errors);

  const selectedSessions = [...uniqueSelectedIds].map((id) => sessionById.get(id)).filter(Boolean);
  const timedSessions = [];
  for (const session of selectedSessions) {
    const hasStart = session.startsAt !== undefined && session.startsAt !== null && session.startsAt !== "";
    const hasEnd = session.endsAt !== undefined && session.endsAt !== null && session.endsAt !== "";
    if (!hasStart && !hasEnd) continue;

    const startsAt = parseIsoDateTime(session.startsAt);
    const endsAt = parseIsoDateTime(session.endsAt);
    if (startsAt === null || endsAt === null) {
      errors.push(`场次“${session.id}”的时间格式无效，请使用带时区的 ISO 日期时间。`);
      continue;
    }
    if (endsAt <= startsAt) {
      errors.push(`场次“${session.id}”的结束时间必须晚于开始时间。`);
      continue;
    }
    timedSessions.push({ id: session.id, startsAt, endsAt });
  }

  for (let index = 0; index < timedSessions.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < timedSessions.length; otherIndex += 1) {
      const first = timedSessions[index];
      const second = timedSessions[otherIndex];
      if (first.startsAt < second.endsAt && second.startsAt < first.endsAt) {
        errors.push(`场次“${first.id}”与“${second.id}”时间冲突。`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export function validateAnswers(fields, answers) {
  const errors = {};
  const answerValues = answers && typeof answers === "object" ? answers : {};

  if (!Array.isArray(fields)) {
    return { valid: false, errors: { form: "报名字段配置无效。" } };
  }

  for (const field of fields) {
    if (!field || typeof field.id !== "string" || field.id.trim() === "") continue;
    if (field.required === true && !hasAnswer(answerValues[field.id], field.type)) {
      const label = typeof field.label === "string" && field.label.trim() !== "" ? field.label : field.id;
      errors[field.id] = `请填写${label}。`;
    }
  }

  for (const field of fields) {
    validateAnswerConstraints(field, answerValues[field?.id], errors);
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

export function getEventCapability(status) {
  const capability = CAPABILITIES[status];
  return capability ? { ...capability } : { visible: false, canRegister: false, canCheckIn: false };
}
