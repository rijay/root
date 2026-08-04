const { createClientError } = require("./clientError");
const { nowISO } = require("./dates");
const { createId } = require("./seed");
const assessmentModule = require("./assessmentModule");

const TYPES = Object.freeze({
  INITIALIZATION: "INITIALIZATION",
  SCALE: "SCALE",
  RECOMMENDATION_RULE: "RECOMMENDATION_RULE",
  LIFESTYLE_ADVICE: "LIFESTYLE_ADVICE",
});
const PUBLISHED = "PUBLISHED";
const DRAFT = "DRAFT";
const RETIRED = "RETIRED";
const INITIALIZATION_LOGICAL_ID = "ROOT4U_INITIAL_PROFILE";
const FIXED_CONTENT_VERSION_ID = "ROOT4U_FIXED_CONTENT_V1";
const FIXED_SAFETY_VERSION_ID = "ROOT4U_FIXED_SAFETY_V1";
const PRIMARY_CATEGORIES = new Set(["BASELINE", "BOWEL", "DIGESTION", "SLEEP", "ENERGY", "LIFESTYLE", "VARIABLE"]);
const AUXILIARY_TAGS = new Set(["饮水偏少", "睡眠不足或不规律", "久坐偏高", "进餐节律波动", "精力偏低"]);
const MINIMUM_FIELDS = Object.freeze(["PRIMARY_CATEGORY", "AUXILIARY_TAGS", "ASSESSMENT_RESULTS"]);

function healthError(code, message, status = 400, details = undefined) {
  const error = createClientError(code, message, status);
  if (details) error.details = details;
  return error;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function collection(data) {
  if (!Array.isArray(data.healthContentVersions)) data.healthContentVersions = [];
  return data.healthContentVersions;
}

function instant(context = {}) {
  const value = context.now || nowISO();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw healthError("HEALTH_CONTENT_TIME_INVALID", "时间格式无效");
  return date.toISOString();
}

function optionalInstant(value, field) {
  const text = String(value || "").trim();
  if (!text) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) throw healthError("HEALTH_CONTENT_INPUT_INVALID", `${field}格式无效`);
  return date.toISOString();
}

function text(value, field, maximum, { required = true } = {}) {
  const normalized = String(value || "").trim();
  if (required && !normalized) throw healthError("HEALTH_CONTENT_INPUT_INVALID", `${field}不能为空`);
  if (normalized.length > maximum) throw healthError("HEALTH_CONTENT_INPUT_INVALID", `${field}长度超限`);
  return normalized;
}

function integer(value, field, minimum, maximum) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < minimum || normalized > maximum) {
    throw healthError("HEALTH_CONTENT_INPUT_INVALID", `${field}必须在 ${minimum}–${maximum} 之间`);
  }
  return normalized;
}

function stringList(value, field, maximumItems = 20, maximumLength = 80) {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw healthError("HEALTH_CONTENT_INPUT_INVALID", `${field}格式无效`);
  }
  const values = Array.from(new Set(value.map((item) => text(item, field, maximumLength))));
  if (values.length !== value.length) throw healthError("HEALTH_CONTENT_INPUT_INVALID", `${field}不能重复`);
  return values;
}

function pageQuery(query = {}) {
  const page = Number(query.page || 1);
  const pageSize = Number(query.pageSize || query.page_size || 20);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) {
    throw healthError("HEALTH_CONTENT_QUERY_INVALID", "分页参数无效");
  }
  const keyword = String(query.keyword || query.search || "").trim().toLowerCase();
  if (keyword.length > 120) throw healthError("HEALTH_CONTENT_QUERY_INVALID", "搜索内容过长");
  return { page, pageSize, keyword };
}

function paginate(items, query = {}) {
  const { page, pageSize } = pageQuery(query);
  const total = items.length;
  const offset = (page - 1) * pageSize;
  return {
    items: items.slice(offset, offset + pageSize),
    pagination: { page, pageSize, total, totalPages: total ? Math.ceil(total / pageSize) : 0 },
  };
}

function rowsOfType(data, type) {
  return collection(data).filter((row) => row.content_type === type);
}

function rowById(data, versionId) {
  return collection(data).find((row) => row.health_content_version_id === versionId) || null;
}

function currentRow(data, type, logicalId = "") {
  return rowsOfType(data, type)
    .filter((row) => !logicalId || row.logical_id === logicalId)
    .sort((left, right) => {
      if (left.status === DRAFT && right.status !== DRAFT) return -1;
      if (right.status === DRAFT && left.status !== DRAFT) return 1;
      return right.version - left.version;
    })[0] || null;
}

function publishedRow(data, type, logicalId = "") {
  return rowsOfType(data, type)
    .filter((row) => row.status === PUBLISHED && (!logicalId || row.logical_id === logicalId))
    .sort((left, right) => right.version - left.version)[0] || null;
}

function nextVersion(data, type, logicalId, baseVersion = 0) {
  return rowsOfType(data, type)
    .filter((row) => row.logical_id === logicalId)
    .reduce((maximum, row) => Math.max(maximum, row.version), baseVersion) + 1;
}

function versionView(row, status = row.status) {
  return {
    id: row.health_content_version_id,
    versionId: row.health_content_version_id,
    sourceVersionId: row.source_version_id || "",
    logicalId: row.logical_id,
    version: row.version,
    versionLabel: `v${row.version}.0`,
    revision: row.revision,
    status,
    effectiveAt: row.effective_at || "",
    effectiveAtLabel: row.effective_at || "待配置",
    publishedAt: row.published_at || "",
    updatedAt: row.updated_at,
  };
}

function createDraft(data, type, logicalId, content, context = {}, sourceVersionId = "", baseVersion = 0) {
  const timestamp = instant(context);
  const row = {
    health_content_version_id: createId("hcv"),
    content_type: type,
    logical_id: logicalId,
    version: nextVersion(data, type, logicalId, baseVersion),
    revision: 1,
    status: DRAFT,
    source_version_id: sourceVersionId || null,
    content_json: clone(content),
    effective_at: content.effectiveAt || null,
    published_at: null,
    created_at: timestamp,
    updated_at: timestamp,
    operator_id: context.operatorId || "",
  };
  collection(data).push(row);
  return row;
}

function draftForUpdate(data, input, type, context, create) {
  const versionId = String(input.versionId || input.id || "").trim();
  if (!versionId) return create();
  const row = rowById(data, versionId);
  if (!row || row.content_type !== type) throw healthError("HEALTH_CONTENT_VERSION_NOT_FOUND", "内容版本不存在", 404);
  if (row.status !== DRAFT) throw healthError("HEALTH_CONTENT_PUBLISHED_IMMUTABLE", "已发布版本不可原地修改", 409);
  const expectedRevision = Number(input.expectedRevision);
  if (!Number.isInteger(expectedRevision) || expectedRevision !== row.revision) {
    throw healthError("HEALTH_CONTENT_REVISION_CONFLICT", "内容已被其他运营更新，请刷新后重试", 409, {
      expectedRevision,
      actualRevision: row.revision,
    });
  }
  return row;
}

function updateDraft(row, content, context = {}) {
  row.content_json = clone(content);
  row.effective_at = content.effectiveAt || null;
  row.revision += 1;
  row.updated_at = instant(context);
  row.operator_id = context.operatorId || row.operator_id || "";
  return row;
}

function candidateInitializationContent() {
  const definition = assessmentModule.getPublishedDefinition();
  return {
    definition,
    questionSettings: Object.fromEntries(definition.questions.map((question) => [question.id, {
      routing: question.id === "safety"
        ? { risk: "RISK", special: "SPECIAL", standard: "STANDARD" }
        : { standard: "STANDARD" },
      hitAction: question.id === "safety"
        ? "停止普通建议，展示固定安全指引"
        : "进入普通分类与生活方式建议流程",
      guidanceVersionId: question.id === "safety" ? FIXED_SAFETY_VERSION_ID : "",
    }])),
  };
}

function initializationSource(data, sourceVersionId = "") {
  if (sourceVersionId) {
    const source = rowById(data, sourceVersionId);
    if (source && source.content_type === TYPES.INITIALIZATION) return source;
  }
  return currentRow(data, TYPES.INITIALIZATION, INITIALIZATION_LOGICAL_ID);
}

function editedInitializationContent(sourceContent, input = {}) {
  const content = clone(sourceContent);
  const questionId = text(input.questionId, "questionId", 64);
  const question = content.definition.questions.find((item) => item.id === questionId);
  if (!question) throw healthError("HEALTH_CONTENT_INPUT_INVALID", "初始化题目不存在");
  const optionLabels = stringList(input.options, "options", 20, 160);
  if (optionLabels.length !== question.options.length) {
    throw healthError("HEALTH_CONTENT_INPUT_INVALID", "当前版本只允许修改选项文案，不能改变选项数量");
  }
  question.title = text(input.title, "title", 120);
  question.options = question.options.map((option, index) => ({ ...option, label: optionLabels[index] }));
  const currentSetting = content.questionSettings[questionId];
  content.questionSettings[questionId] = {
    routing: input.routing && typeof input.routing === "object" ? clone(input.routing) : currentSetting.routing,
    hitAction: text(input.hitAction, "hitAction", 300),
    guidanceVersionId: questionId === "safety"
      ? text(input.guidanceVersionId, "guidanceVersionId", 64)
      : String(input.guidanceVersionId || "").trim(),
  };
  return content;
}

function saveInitializationDraft(data, input = {}, context = {}) {
  if (input.action === "COPY_VERSION") {
    const existing = currentRow(data, TYPES.INITIALIZATION, INITIALIZATION_LOGICAL_ID);
    if (existing && existing.status === DRAFT) return { version: versionView(existing) };
    const source = initializationSource(data, input.sourceVersionId);
    const row = createDraft(
      data,
      TYPES.INITIALIZATION,
      INITIALIZATION_LOGICAL_ID,
      source ? source.content_json : candidateInitializationContent(),
      context,
      source ? source.health_content_version_id : "ROOT4U_INITIAL_PROFILE_V1",
      1,
    );
    return { version: versionView(row) };
  }

  const versionId = String(input.versionId || input.id || "").trim();
  if (!versionId) {
    const source = initializationSource(data, input.sourceVersionId);
    if (source?.status === DRAFT) {
      throw healthError("HEALTH_CONTENT_REVISION_CONFLICT", "已有初始化草稿，请刷新后继续编辑", 409);
    }
    const content = editedInitializationContent(source ? source.content_json : candidateInitializationContent(), input);
    const row = createDraft(
      data,
      TYPES.INITIALIZATION,
      INITIALIZATION_LOGICAL_ID,
      content,
      context,
      source ? source.health_content_version_id : "ROOT4U_INITIAL_PROFILE_V1",
      1,
    );
    return { version: versionView(row) };
  }
  const row = draftForUpdate(data, input, TYPES.INITIALIZATION, context, () => null);
  const content = editedInitializationContent(row.content_json, input);
  updateDraft(row, content, context);
  return { version: versionView(row) };
}

function initializationValidation(row) {
  const definition = row.content_json && row.content_json.definition;
  const errors = [];
  if (!definition || !Array.isArray(definition.questions) || definition.questions.length !== 12) errors.push("初始化建档必须包含 12 个问题");
  if (definition && Array.isArray(definition.questions)) {
    if (!definition.questions.every((question) => question.required && question.options.length > 0)) errors.push("12 个问题必须全部必填并包含选项");
    const safety = definition.questions.find((question) => question.id === "safety");
    if (!safety || safety.options.length !== 9) errors.push("安全与适用性题必须保留完整 9 个选项");
  }
  if (row.content_json?.questionSettings?.safety?.guidanceVersionId !== FIXED_SAFETY_VERSION_ID) errors.push("安全题必须关联已批准固定指引版本");
  return errors;
}

function listInitialization(data, query = {}) {
  const row = currentRow(data, TYPES.INITIALIZATION, INITIALIZATION_LOGICAL_ID);
  const content = row ? row.content_json : candidateInitializationContent();
  const definition = content.definition;
  const { keyword } = pageQuery(query);
  const type = String(query.type || "").trim().toLowerCase();
  const versionFilter = String(query.version || "").trim();
  let items = definition.questions.map((question, index) => ({
    id: question.id,
    number: String(index + 1).padStart(2, "0"),
    title: question.title,
    type: question.type,
    typeLabel: question.type === "multi" ? "多选" : "单选",
    required: question.required,
    optionCount: question.options.length,
    options: question.options,
    routing: question.id === "safety" ? "SAFETY" : "STANDARD",
    routingLabel: question.id === "safety" ? "安全分流" : "普通分类",
    routingSettings: content.questionSettings?.[question.id]?.routing || { standard: "STANDARD" },
    hitAction: content.questionSettings?.[question.id]?.hitAction || "进入普通分类与生活方式建议流程",
    guidanceVersionId: content.questionSettings?.[question.id]?.guidanceVersionId || "",
    status: row ? row.status : "CANDIDATE",
    version: row ? row.version : 1,
    versionLabel: row ? `v${row.version}.0` : "v1.0",
    revision: row ? row.revision : 0,
  }));
  items = items
    .filter((item) => !keyword || [item.number, item.id, item.title, item.versionLabel].some((value) => String(value).toLowerCase().includes(keyword)))
    .filter((item) => !type || item.type === type)
    .filter((item) => !versionFilter || item.versionLabel === versionFilter || String(item.version) === versionFilter);
  return {
    ...paginate(items, query),
    currentVersion: row ? `v${row.version}.0` : "v1.0",
    currentVersionId: row ? row.health_content_version_id : "",
    currentRevision: row ? row.revision : 0,
    currentStatus: row ? row.status : "CANDIDATE",
    guidanceOptions: [{ versionId: FIXED_SAFETY_VERSION_ID, label: "Root4U 固定安全指引 · v1.0" }],
    previewPath: "/pages/health/index",
    releaseStage: "CANDIDATE",
  };
}

function scaleQuestion(input, index) {
  const question = input && typeof input === "object" ? input : {};
  const id = text(question.id || `question_${index + 1}`, `questions[${index}].id`, 64);
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw healthError("HEALTH_CONTENT_INPUT_INVALID", `第 ${index + 1} 题标识格式无效`);
  const type = String(question.type || "SINGLE").trim().toUpperCase();
  if (type !== "SINGLE") throw healthError("HEALTH_CONTENT_INPUT_INVALID", "首发量表仅支持单选题");
  const options = Array.isArray(question.options) ? question.options.map((item, optionIndex) => {
    const option = item && typeof item === "object" ? item : {};
    const value = text(option.value || `option_${optionIndex + 1}`, `questions[${index}].options[${optionIndex}].value`, 64);
    if (!/^[a-zA-Z0-9_-]+$/.test(value)) throw healthError("HEALTH_CONTENT_INPUT_INVALID", `第 ${index + 1} 题选项标识格式无效`);
    return {
      value,
      label: text(option.label, `questions[${index}].options[${optionIndex}].label`, 160),
      score: integer(option.score, `questions[${index}].options[${optionIndex}].score`, 0, 20),
    };
  }) : [];
  if (new Set(options.map((item) => item.value)).size !== options.length) {
    throw healthError("HEALTH_CONTENT_INPUT_INVALID", `第 ${index + 1} 题选项标识不能重复`);
  }
  return {
    id,
    title: text(question.title, `questions[${index}].title`, 200),
    type,
    required: question.required !== false,
    options,
  };
}

function scaleResultLevel(input, index) {
  const level = input && typeof input === "object" ? input : {};
  const id = text(level.id || `level_${index + 1}`, `resultLevels[${index}].id`, 64);
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw healthError("HEALTH_CONTENT_INPUT_INVALID", `第 ${index + 1} 个结果等级标识格式无效`);
  return {
    id,
    minScore: integer(level.minScore, `resultLevels[${index}].minScore`, 0, 2000),
    maxScore: integer(level.maxScore, `resultLevels[${index}].maxScore`, 0, 2000),
    title: text(level.title, `resultLevels[${index}].title`, 80),
    summary: text(level.summary, `resultLevels[${index}].summary`, 500),
    tips: stringList(level.tips || [], `resultLevels[${index}].tips`, 3, 120),
  };
}

function scaleContent(input, fallback = {}) {
  const source = { ...fallback, ...input };
  const questionsSource = input.questions === undefined ? fallback.questions : input.questions;
  const levelsSource = input.resultLevels === undefined ? fallback.resultLevels : input.resultLevels;
  if (questionsSource !== undefined && !Array.isArray(questionsSource)) throw healthError("HEALTH_CONTENT_INPUT_INVALID", "questions格式无效");
  if (levelsSource !== undefined && !Array.isArray(levelsSource)) throw healthError("HEALTH_CONTENT_INPUT_INVALID", "resultLevels格式无效");
  const questions = (questionsSource || []).map(scaleQuestion);
  const resultLevels = (levelsSource || []).map(scaleResultLevel);
  if (questions.length > 100) throw healthError("HEALTH_CONTENT_INPUT_INVALID", "量表题目不能超过 100 题");
  if (resultLevels.length > 10) throw healthError("HEALTH_CONTENT_INPUT_INVALID", "结果等级不能超过 10 个");
  if (new Set(questions.map((item) => item.id)).size !== questions.length) throw healthError("HEALTH_CONTENT_INPUT_INVALID", "题目标识不能重复");
  if (new Set(resultLevels.map((item) => item.id)).size !== resultLevels.length) throw healthError("HEALTH_CONTENT_INPUT_INVALID", "结果等级标识不能重复");
  return {
    name: text(source.name, "name", 80),
    questionSummary: text(source.questionSummary, "questionSummary", 2000),
    scoringSummary: text(source.scoringSummary, "scoringSummary", 2000),
    audience: ["ADULT_18_PLUS", "SPECIFIC"].includes(source.audience) ? source.audience : "ADULT_18_PLUS",
    questions,
    resultLevels,
    questionCount: questions.length,
    resultLevelCount: resultLevels.length,
    adviceVersionId: text(source.adviceVersionId, "adviceVersionId", 64),
    approver: text(source.approver, "approver", 80, { required: false }),
    effectiveAt: optionalInstant(source.effectiveAt, "effectiveAt"),
  };
}

function saveScaleDraft(data, input = {}, context = {}) {
  const row = draftForUpdate(data, input, TYPES.SCALE, context, () => {
    const sourceId = String(input.sourceVersionId || "").trim();
    const source = sourceId ? rowById(data, sourceId) : null;
    if (sourceId && (!source || source.content_type !== TYPES.SCALE || source.status !== PUBLISHED)) {
      throw healthError("HEALTH_CONTENT_SOURCE_INVALID", "只能从已发布量表复制草稿", 409);
    }
    const logicalId = source ? source.logical_id : createId("hscale");
    return createDraft(data, TYPES.SCALE, logicalId, source ? source.content_json : scaleContent(input), context, sourceId);
  });
  updateDraft(row, scaleContent(input, row.content_json), context);
  return { version: scaleView(row) };
}

function scaleView(row) {
  const content = row.content_json;
  return {
    ...versionView(row),
    ...content,
    estimatedMinutes: Math.max(1, Math.ceil(content.questionCount / 5)),
    kindLabel: "标准量表",
    audienceLabel: content.audience === "ADULT_18_PLUS" ? "18 岁及以上" : "指定人群",
    adviceVersionLabel: content.adviceVersionId === FIXED_CONTENT_VERSION_ID ? "固定建议 v1.0" : content.adviceVersionId,
  };
}

function scaleValidation(row) {
  const content = row.content_json || {};
  const errors = [];
  if (!content.approver) errors.push("健康内容负责人不能为空");
  if (!content.effectiveAt) errors.push("生效时间不能为空");
  if (content.adviceVersionId !== FIXED_CONTENT_VERSION_ID) errors.push("建议内容版本未获批准");
  if (!Array.isArray(content.questions) || content.questions.length < 1) errors.push("量表至少包含 1 道真实题目");
  if (!Array.isArray(content.resultLevels) || content.resultLevels.length < 1) errors.push("量表至少包含 1 个结果等级");
  if (Array.isArray(content.questions) && content.questions.some((question) => (
    question.type !== "SINGLE" || question.required !== true || !Array.isArray(question.options)
      || question.options.length < 2 || question.options.length > 10
  ))) errors.push("每道题必须是包含 2–10 个选项的必答单选题");
  if (Array.isArray(content.questions) && content.questions.length && Array.isArray(content.resultLevels) && content.resultLevels.length) {
    const attainableMinimum = content.questions.reduce((sum, question) => sum + Math.min(...question.options.map((option) => option.score)), 0);
    const attainableMaximum = content.questions.reduce((sum, question) => sum + Math.max(...question.options.map((option) => option.score)), 0);
    const levels = [...content.resultLevels].sort((left, right) => left.minScore - right.minScore);
    const continuous = levels[0].minScore === attainableMinimum
      && levels[levels.length - 1].maxScore === attainableMaximum
      && levels.every((level, index) => level.minScore <= level.maxScore
        && (index === 0 || level.minScore === levels[index - 1].maxScore + 1));
    if (!continuous) errors.push("结果等级必须覆盖全部可得分数，并保持连续且不重叠");
  }
  return errors;
}

function listScales(data, query = {}) {
  const { keyword } = pageQuery(query);
  const status = String(query.status || "").trim().toUpperCase();
  const audience = String(query.audience || "").trim().toUpperCase();
  let items = rowsOfType(data, TYPES.SCALE).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))).map(scaleView);
  items = items
    .filter((item) => !keyword || [item.name, item.versionLabel, item.questionSummary].some((value) => String(value).toLowerCase().includes(keyword)))
    .filter((item) => !status || item.status === status)
    .filter((item) => !audience || item.audience === audience);
  return {
    ...paginate(items, query),
    adviceOptions: [{ versionId: FIXED_CONTENT_VERSION_ID, label: "Root4U 固定建议内容 · v1.0" }],
    previewPath: "/pages/health/index",
    releaseStage: "CANDIDATE",
  };
}

function recommendationContent(input) {
  const category = String(input.primaryCategory || "").trim().toUpperCase();
  if (!PRIMARY_CATEGORIES.has(category)) throw healthError("HEALTH_CONTENT_INPUT_INVALID", "主分类无效");
  const tags = stringList(input.auxiliaryTags || [], "auxiliaryTags", 5, 40);
  return {
    primaryCategory: category,
    auxiliaryTags: tags,
    matchSummary: text(input.matchSummary, "matchSummary", 500),
    priority: integer(input.priority, "priority", 1, 999),
    matchMode: ["ANY", "ALL"].includes(input.matchMode) ? input.matchMode : "ANY",
    maxRecommendations: integer(input.maxRecommendations, "maxRecommendations", 1, 3),
    scaleVersionId: text(input.scaleVersionId, "scaleVersionId", 64),
    effectiveAt: optionalInstant(input.effectiveAt, "effectiveAt"),
  };
}

function saveRecommendationRuleDraft(data, input = {}, context = {}) {
  const row = draftForUpdate(data, input, TYPES.RECOMMENDATION_RULE, context, () => {
    const sourceId = String(input.sourceVersionId || "").trim();
    const source = sourceId ? rowById(data, sourceId) : null;
    if (sourceId && (!source || source.content_type !== TYPES.RECOMMENDATION_RULE || source.status !== PUBLISHED)) {
      throw healthError("HEALTH_CONTENT_SOURCE_INVALID", "只能从已发布规则复制草稿", 409);
    }
    return createDraft(data, TYPES.RECOMMENDATION_RULE, source ? source.logical_id : createId("hrule"), source ? source.content_json : recommendationContent(input), context, sourceId);
  });
  updateDraft(row, recommendationContent(input), context);
  return { version: recommendationView(data, row) };
}

const CATEGORY_LABELS = Object.freeze({
  BASELINE: "基础状态维护型", BOWEL: "肠道规律关注型", DIGESTION: "腹胀反酸关注型",
  SLEEP: "睡眠节律关注型", ENERGY: "压力活力关注型", LIFESTYLE: "活动饮食调整型", VARIABLE: "生活方式波动型",
});

function recommendationView(data, row) {
  const content = row.content_json;
  const scale = rowById(data, content.scaleVersionId);
  return {
    ...versionView(row),
    ...content,
    primaryCategoryLabel: CATEGORY_LABELS[content.primaryCategory],
    scaleName: scale?.content_json?.name || "未关联量表",
    scaleVersionLabel: scale ? `v${scale.version}.0` : "量表版本不可用",
  };
}

function recommendationValidation(data, row) {
  const content = row.content_json || {};
  const errors = [];
  const scale = rowById(data, content.scaleVersionId);
  if (!scale || scale.content_type !== TYPES.SCALE || scale.status !== PUBLISHED) errors.push("推荐规则只能引用已发布量表版本");
  if (!content.effectiveAt) errors.push("生效时间不能为空");
  if ((content.auxiliaryTags || []).some((tag) => !AUXILIARY_TAGS.has(tag))) errors.push("辅助标签不属于建档输出标签");
  return errors;
}

function listRecommendationRules(data, query = {}) {
  const { keyword } = pageQuery(query);
  const status = String(query.status || "").trim().toUpperCase();
  const category = String(query.category || "").trim().toUpperCase();
  let items = rowsOfType(data, TYPES.RECOMMENDATION_RULE).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))).map((row) => recommendationView(data, row));
  items = items
    .filter((item) => !keyword || [item.primaryCategoryLabel, item.scaleName, item.matchSummary, ...(item.auxiliaryTags || [])].some((value) => String(value).toLowerCase().includes(keyword)))
    .filter((item) => !status || item.status === status)
    .filter((item) => !category || item.primaryCategory === category);
  return { ...paginate(items, query), previewPath: "/pages/health/index", releaseStage: "CANDIDATE" };
}

function effectiveAtOrBefore(row, asOf) {
  const effectiveAt = Date.parse(row?.effective_at || row?.content_json?.effectiveAt || "");
  return Number.isFinite(effectiveAt) && effectiveAt <= asOf;
}

function ruleMatchesAssessment(content, assessment) {
  if (!content || content.primaryCategory !== assessment.categoryCode) return false;
  const expectedTags = Array.isArray(content.auxiliaryTags) ? content.auxiliaryTags : [];
  if (!expectedTags.length) return true;
  const actualTags = new Set(Array.isArray(assessment.tags) ? assessment.tags : []);
  return content.matchMode === "ALL"
    ? expectedTags.every((tag) => actualTags.has(tag))
    : expectedTags.some((tag) => actualTags.has(tag));
}

function resolvePublishedRecommendations(data, assessment = {}, context = {}) {
  const asOf = Date.parse(context.now || nowISO());
  if (!Number.isFinite(asOf) || !assessment || !assessment.categoryCode) return [];
  const matchingRules = rowsOfType(data, TYPES.RECOMMENDATION_RULE)
    .filter((row) => row.status === PUBLISHED && effectiveAtOrBefore(row, asOf))
    .filter((row) => ruleMatchesAssessment(row.content_json, assessment))
    .sort((left, right) => {
      const priorityDifference = Number(left.content_json.priority) - Number(right.content_json.priority);
      if (priorityDifference) return priorityDifference;
      const publishedDifference = String(left.published_at).localeCompare(String(right.published_at));
      return publishedDifference || left.health_content_version_id.localeCompare(right.health_content_version_id);
    });
  if (!matchingRules.length) return [];
  const resultLimit = Math.min(3, Number(matchingRules[0].content_json.maxRecommendations) || 1);
  const seenScaleVersions = new Set();
  const recommendations = [];
  for (const rule of matchingRules) {
    const scale = rowById(data, rule.content_json.scaleVersionId);
    if (!scale || scale.content_type !== TYPES.SCALE || scale.status !== PUBLISHED
      || !effectiveAtOrBefore(scale, asOf) || seenScaleVersions.has(scale.health_content_version_id)) continue;
    seenScaleVersions.add(scale.health_content_version_id);
    const scaleContent = scale.content_json;
    recommendations.push({
      title: scaleContent.name,
      availability: "PUBLISHED",
      scaleVersionId: scale.health_content_version_id,
      scaleVersionLabel: `v${scale.version}.0`,
      recommendationRuleVersionId: rule.health_content_version_id,
      recommendationRuleVersionLabel: `v${rule.version}.0`,
      questionCount: scaleContent.questionCount,
      estimatedMinutes: Math.max(1, Math.ceil(scaleContent.questionCount / 5)),
      audienceLabel: scaleContent.audience === "ADULT_18_PLUS" ? "18 岁及以上" : "指定人群",
    });
    if (recommendations.length >= resultLimit) break;
  }
  return recommendations;
}

function lifestyleContent(input) {
  const modelConfigurationId = String(input.modelConfigurationId || "FIXED_ONLY").trim();
  if (modelConfigurationId !== "FIXED_ONLY") throw healthError("HEALTH_CONTENT_INPUT_INVALID", "首发仅允许固定内容策略");
  const minimumFields = stringList(input.minimumFields || MINIMUM_FIELDS, "minimumFields", 3, 40);
  if (minimumFields.some((field) => !MINIMUM_FIELDS.includes(field))) throw healthError("HEALTH_CONTENT_INPUT_INVALID", "最少字段配置无效");
  const validation = input.validation && typeof input.validation === "object" ? input.validation : {};
  return {
    name: text(input.name, "name", 80),
    modelConfigurationId,
    minimumFields,
    minimumFieldsSummary: String(input.minimumFieldsSummary || "仅发送分类、辅助标签与量表结果；资料或评测结果变化时才重新生成").trim(),
    regenerationTrigger: input.regenerationTrigger === "PROFILE_OR_ASSESSMENT_CHANGED" ? input.regenerationTrigger : "PROFILE_OR_ASSESSMENT_CHANGED",
    rotationSize: integer(input.rotationSize || 3, "rotationSize", 3, 3),
    validation: {
      structure: validation.structure === "REQUIRED" ? "REQUIRED" : "REQUIRED",
      prohibitedLanguage: validation.prohibitedLanguage === "REQUIRED" ? "REQUIRED" : "REQUIRED",
      healthSafety: validation.healthSafety === "REQUIRED" ? "REQUIRED" : "REQUIRED",
    },
    fallbackContentVersionId: text(input.fallbackContentVersionId, "fallbackContentVersionId", 64),
    approver: text(input.approver, "approver", 80, { required: false }),
    effectiveAt: optionalInstant(input.effectiveAt, "effectiveAt"),
  };
}

function saveLifestyleAdviceDraft(data, input = {}, context = {}) {
  const row = draftForUpdate(data, input, TYPES.LIFESTYLE_ADVICE, context, () => {
    const sourceId = String(input.sourceVersionId || "").trim();
    const source = sourceId ? rowById(data, sourceId) : null;
    if (sourceId && (!source || source.content_type !== TYPES.LIFESTYLE_ADVICE || source.status !== PUBLISHED)) {
      throw healthError("HEALTH_CONTENT_SOURCE_INVALID", "只能从已生效策略复制草稿", 409);
    }
    return createDraft(data, TYPES.LIFESTYLE_ADVICE, source ? source.logical_id : createId("hadvice"), source ? source.content_json : lifestyleContent(input), context, sourceId);
  });
  updateDraft(row, lifestyleContent(input), context);
  return { version: lifestyleView(row) };
}

function lifestyleView(row) {
  const content = row.content_json;
  return {
    ...versionView(row, row.status === PUBLISHED ? "ACTIVE" : row.status),
    ...content,
    deliveryLabel: "规则匹配 · 固定三条",
    validationLabel: "结构、禁用表达与健康安全校验",
    approvalLabel: content.approver || "待审批",
    purposeLabel: "用户生活方式建议",
  };
}

function lifestyleValidation(row) {
  const content = row.content_json || {};
  const errors = [];
  if (content.modelConfigurationId !== "FIXED_ONLY") errors.push("首发只允许固定内容策略");
  if (content.fallbackContentVersionId !== FIXED_CONTENT_VERSION_ID) errors.push("固定降级内容版本未获批准");
  if (!content.approver) errors.push("健康内容负责人不能为空");
  if (!content.effectiveAt) errors.push("生效时间不能为空");
  return errors;
}

function listLifestyleAdvice(data, query = {}) {
  const { keyword } = pageQuery(query);
  const requestedStatus = String(query.status || "").trim().toUpperCase();
  let items = rowsOfType(data, TYPES.LIFESTYLE_ADVICE).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))).map(lifestyleView);
  items = items
    .filter((item) => !keyword || [item.name, item.versionLabel, item.minimumFieldsSummary].some((value) => String(value).toLowerCase().includes(keyword)))
    .filter((item) => !requestedStatus || item.status === requestedStatus || (requestedStatus === "PUBLISHED" && item.status === "ACTIVE"));
  return {
    ...paginate(items, query),
    modelConfigurations: [{ id: "FIXED_ONLY", label: "首发固定内容（不调用模型）" }],
    fallbackOptions: [{ versionId: FIXED_CONTENT_VERSION_ID, label: "Root4U 固定建议内容 · v1.0" }],
    previewPath: "/pages/health/index",
    releaseStage: "CANDIDATE",
  };
}

function resolvePublishedLifestylePolicy(data, context = {}) {
  const asOf = Date.parse(context.now || nowISO());
  if (!Number.isFinite(asOf)) return null;
  const row = rowsOfType(data, TYPES.LIFESTYLE_ADVICE)
    .filter((candidate) => candidate.status === PUBLISHED && effectiveAtOrBefore(candidate, asOf))
    .sort((left, right) => right.version - left.version)[0] || null;
  if (!row || row.content_json.modelConfigurationId !== "FIXED_ONLY"
    || row.content_json.fallbackContentVersionId !== FIXED_CONTENT_VERSION_ID) return null;
  return {
    advicePolicyVersionId: row.health_content_version_id,
    advicePolicyVersionLabel: `v${row.version}.0`,
    adviceContentVersionId: row.content_json.fallbackContentVersionId,
    adviceMode: "FIXED_ONLY",
  };
}

function publish(data, input, type, validate, context = {}) {
  if (input.confirmed !== true || String(input.confirmationText || "").trim() !== "确认发布") {
    throw healthError("HEALTH_CONTENT_PUBLISH_CONFIRMATION_REQUIRED", "请完成二次发布确认", 409);
  }
  const row = rowById(data, String(input.versionId || "").trim());
  if (!row || row.content_type !== type) throw healthError("HEALTH_CONTENT_VERSION_NOT_FOUND", "内容版本不存在", 404);
  if (row.status !== DRAFT) throw healthError("HEALTH_CONTENT_PUBLISHED_IMMUTABLE", "只有草稿可以发布", 409);
  const expectedRevision = Number(input.expectedRevision);
  if (!Number.isInteger(expectedRevision) || expectedRevision !== row.revision) {
    throw healthError("HEALTH_CONTENT_REVISION_CONFLICT", "内容已被其他运营更新，请刷新后重试", 409);
  }
  const errors = validate(row);
  if (errors.length) throw healthError("HEALTH_CONTENT_VALIDATION_FAILED", errors.join("；"), 422, { errors });
  const timestamp = instant(context);
  collection(data).forEach((candidate) => {
    const samePublicationSlot = candidate.content_type === type
      && candidate.status === PUBLISHED
      && (type === TYPES.INITIALIZATION || type === TYPES.LIFESTYLE_ADVICE || candidate.logical_id === row.logical_id);
    if (samePublicationSlot) {
      candidate.status = RETIRED;
      candidate.revision += 1;
      candidate.updated_at = timestamp;
    }
  });
  row.status = PUBLISHED;
  row.revision += 1;
  row.published_at = timestamp;
  row.updated_at = timestamp;
  row.operator_id = context.operatorId || row.operator_id || "";
  return row;
}

function publishInitialization(data, input = {}, context = {}) {
  return { version: versionView(publish(data, input, TYPES.INITIALIZATION, initializationValidation, context)) };
}

function publishScale(data, input = {}, context = {}) {
  return { version: scaleView(publish(data, input, TYPES.SCALE, scaleValidation, context)) };
}

function publishRecommendationRule(data, input = {}, context = {}) {
  const row = publish(data, input, TYPES.RECOMMENDATION_RULE, (candidate) => recommendationValidation(data, candidate), context);
  return { version: recommendationView(data, row) };
}

function publishLifestyleAdvice(data, input = {}, context = {}) {
  return { version: lifestyleView(publish(data, input, TYPES.LIFESTYLE_ADVICE, lifestyleValidation, context)) };
}

function resolveInitializationDefinition(data, profile = {}) {
  const row = publishedRow(data, TYPES.INITIALIZATION, INITIALIZATION_LOGICAL_ID);
  const definition = clone(row ? row.content_json.definition : assessmentModule.getPublishedDefinition());
  definition.version = row ? row.version : definition.version;
  definition.questions.forEach((question) => {
    question.options = question.options.filter((option) => option.applicability !== "FEMALE" || !profile.gender || profile.gender === "FEMALE");
  });
  return definition;
}

function resolvePublishedScale(data, versionId, context = {}) {
  const row = rowById(data, String(versionId || "").trim());
  const asOf = Date.parse(context.now || nowISO());
  if (!row || row.content_type !== TYPES.SCALE || row.status !== PUBLISHED
    || !Number.isFinite(asOf) || !effectiveAtOrBefore(row, asOf)) {
    throw healthError("HEALTH_SCALE_NOT_AVAILABLE", "该健康评测暂不可用", 404);
  }
  return {
    versionId: row.health_content_version_id,
    logicalId: row.logical_id,
    version: row.version,
    versionLabel: `v${row.version}.0`,
    content: clone(row.content_json),
  };
}

module.exports = {
  FIXED_CONTENT_VERSION_ID,
  FIXED_SAFETY_VERSION_ID,
  TYPES,
  listInitialization,
  listLifestyleAdvice,
  listRecommendationRules,
  listScales,
  publishInitialization,
  publishLifestyleAdvice,
  publishRecommendationRule,
  publishScale,
  resolvePublishedScale,
  resolvePublishedLifestylePolicy,
  resolvePublishedRecommendations,
  resolveInitializationDefinition,
  saveInitializationDraft,
  saveLifestyleAdviceDraft,
  saveRecommendationRuleDraft,
  saveScaleDraft,
};
