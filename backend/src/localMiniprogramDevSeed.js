const path = require("node:path");

const LOCAL_SEED_SCOPE = "MYROOT_V070_LOCAL_DEVTOOLS";
const LOCAL_SQLITE_BASENAME = "myroot-v070-devtools.sqlite";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function enabled(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function seedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertLocalSeedBoundary(env, storeAdapter) {
  if (String(env.NODE_ENV || "").trim().toLowerCase() !== "development") {
    throw seedError("LOCAL_DEV_SEED_ENV_INVALID", "Local mini program seed requires NODE_ENV=development");
  }
  if (String(env.ROOT_LISTEN_HOST || "").trim() !== "127.0.0.1") {
    throw seedError("LOCAL_DEV_SEED_HOST_INVALID", "Local mini program seed requires loopback listening");
  }
  if (String(env.ROOT_STORE_ADAPTER || "").trim().toLowerCase() !== "sqlite" || storeAdapter.kind !== "sqlite") {
    throw seedError("LOCAL_DEV_SEED_STORE_INVALID", "Local mini program seed requires SQLite");
  }
  if (path.basename(String(env.ROOT_SQLITE_FILE || "")) !== LOCAL_SQLITE_BASENAME
    || path.basename(String(storeAdapter.filePath || "")) !== LOCAL_SQLITE_BASENAME) {
    throw seedError("LOCAL_DEV_SEED_FILE_INVALID", "Local mini program seed requires its dedicated SQLite file");
  }
  if (!enabled(env.ROOT_ALLOW_OPENID_LOGIN)) {
    throw seedError("LOCAL_DEV_SEED_LOGIN_INVALID", "Local mini program seed requires explicit local OpenID login");
  }
}

function resultCopy(code, title, summary, priorityAction) {
  return {
    code,
    title,
    summary,
    priority_action: priorityAction,
    risk_notice: "结果用于日常生活方式观察，不构成医疗诊断、治疗或用药建议。",
    retest_advice: "如近期状态或生活习惯发生变化，可重新评测并查看历史记录。",
  };
}

function commonDefinition(source, id) {
  return {
    assessment_definition_id: id,
    assessment_type: source.assessmentType,
    questionnaire_id: source.questionnaireId,
    questionnaire_version: source.questionnaireVersion,
    title: source.title,
    description: source.description,
    estimated_minutes: source.estimatedMinutes,
    status: "ACTIVE",
    content_review_status: "APPROVED",
    professional_review_status: "APPROVED",
    compliance_review_status: "APPROVED",
    result_copy_version: source.resultCopyVersion,
    questions: clone(source.questions),
    development_fixture_scope: LOCAL_SEED_SCOPE,
    created_at: "2026-08-25T00:00:00.000Z",
    updated_at: "2026-08-25T00:00:00.000Z",
  };
}

function initialDefinition(source) {
  const definition = commonDefinition(source, "had_devtools_initial_v1");
  return {
    ...definition,
    dimensions: [],
    safety_rules: [
      {
        field: "safety",
        operator: "CONTAINS",
        value: "self_harm",
        safety_state: "URGENT",
        result_code: "SAFETY_GUIDANCE",
      },
      {
        field: "safety",
        operator: "CONTAINS_ANY",
        values: ["recent_acute", "blood_stool", "acute_digestive", "weight_loss"],
        safety_state: "PROMPT",
        result_code: "SAFETY_GUIDANCE",
      },
      {
        field: "safety",
        operator: "CONTAINS_ANY",
        values: ["pregnancy", "medical_diet", "major_treatment"],
        safety_state: "PROFESSIONAL_REVIEW",
        result_code: "SAFETY_GUIDANCE",
      },
    ],
    result_rules: [
      ["bowel", "BOWEL"],
      ["digestion", "DIGESTION"],
      ["sleep", "SLEEP"],
      ["energy", "ENERGY"],
      ["lifestyle", "LIFESTYLE"],
    ].map(([value, resultCode]) => ({
      result_code: resultCode,
      answer_condition: { field: "primary_goal", operator: "EQ", value },
    })),
    default_result_code: "BASELINE",
    result_copies: [
      resultCopy("BASELINE", "基础状态维护型", "当前更适合先建立稳定、可重复的日常观察。", "保持相对固定的起床和进餐时间。\n每天选择一个容易坚持的身体记录。\n连续观察一周，再判断是否需要调整。"),
      resultCopy("BOWEL", "肠道规律关注型", "本次更关注近期排便规律与相关生活节奏。", "固定每天观察排便的时间和形态。\n逐步增加饮水，避免一次性大量补水。\n每餐为蔬菜、全谷物或豆类留出位置。"),
      resultCopy("DIGESTION", "腹胀反酸关注型", "本次更关注近期消化感受与进餐节奏。", "用餐放慢一些，并留意容易出现不适的时段。\n避免临睡前大量进食和饮酒。\n先记录食物与感受的关系。"),
      resultCopy("SLEEP", "睡眠节律关注型", "本次更关注近期睡眠与作息节律。", "先固定起床时间，再逐步调整入睡时间。\n睡前一小时减少高刺激屏幕内容。\n白天安排轻活动并记录醒来后的精神状态。"),
      resultCopy("ENERGY", "压力活力关注型", "本次更关注近期压力、恢复与精力状态。", "记录一天中最耗能的时段。\n在连续工作之间安排短暂走动。\n优先保证规律进餐和基本睡眠。"),
      resultCopy("LIFESTYLE", "活动饮食调整型", "本次更关注活动、饮食与日常可执行的小变化。", "从每天增加一次十分钟走动开始。\n先让一餐更接近均衡组合。\n每次只调整一个容易坚持的习惯。"),
      resultCopy("SAFETY_GUIDANCE", "建议优先获得专业支持", "你的回答提示应先获得专业意见，再决定是否调整饮食、运动或补充计划。", "如相关情况正在持续、加重或令你担心，请尽快咨询专业人士。\n不要因为本次问卷延迟寻求专业帮助。"),
    ],
  };
}

function gutDefinition(source) {
  const definition = commonDefinition(source, "had_devtools_gut_5q_v2");
  const constipation = {
    any: [
      { field: "Q1", operator: "IN", values: ["B", "C"] },
      { field: "Q2", operator: "EQ", value: "A" },
      { field: "Q3", operator: "CONTAINS", value: "G" },
    ],
  };
  const loose = {
    any: [
      { field: "Q1", operator: "EQ", value: "D" },
      { field: "Q2", operator: "EQ", value: "D" },
      { field: "Q3", operator: "CONTAINS", value: "H" },
    ],
  };
  return {
    ...definition,
    dimensions: [],
    safety_rules: [],
    result_rules: [
      {
        result_code: "ALTERNATING",
        answer_condition: {
          any: [
            { field: "Q1", operator: "EQ", value: "E" },
            { field: "Q2", operator: "EQ", value: "E" },
            { all: [constipation, loose] },
          ],
        },
      },
      { result_code: "CONSTIPATION", answer_condition: constipation },
      { result_code: "LOOSE", answer_condition: loose },
      {
        result_code: "SENSITIVE",
        answer_condition: {
          any: [
            { field: "Q3", operator: "CONTAINS_ANY", values: ["B", "C", "D", "E", "F", "I"] },
            { field: "Q4", operator: "CONTAINS_ANY", values: ["B", "C", "D", "E"] },
          ],
        },
      },
    ],
    default_result_code: "HEALTHY",
    result_copies: [
      resultCopy("CONSTIPATION", "肠道的节奏慢了些", "近期记录中出现了排便间隔较长、便便偏干硬或排便费力中的一种或多种情况。", "逐步增加蔬菜、全谷物和豆类。\n白天少量多次饮水。\n饭后安排 5–10 分钟轻松走动。"),
      resultCopy("LOOSE", "肠道的节奏快了些", "近期记录中出现了便便偏稀、排便次数偏多或便急中的一种或多种情况。", "近期减少辛辣、油腻和生冷食物。\n注意补充水分。\n尽量保持固定的进餐和休息时间。"),
      resultCopy("ALTERNATING", "肠道的节奏有点乱", "近期排便频率或形态不太稳定，可能出现偏少、偏多、偏硬或偏稀等变化。", "记录几天排便时间、形态和饮食。\n尽量固定起床和进餐时间。\n每次只调整一个习惯。"),
      resultCopy("SENSITIVE", "肠道有些敏感", "近期记录中出现了腹胀、腹痛、反酸、餐后不适等感受或相关诱因。", "吃饭时放慢速度并留意餐后感受。\n记录可能引起不适的食物或情境。\n保持相对规律的作息。"),
      resultCopy("HEALTHY", "肠道节奏挺稳，值得继续保持", "近期排便频率和形态较为稳定，也没有记录到明显的肠胃不适。", "继续保持规律饮食和充足饮水。\n保持相对固定的起床和进餐时间。\n每周记录一次排便形态与身体感受。"),
    ],
  };
}

function localDefinitions() {
  // Development fixtures live server-side so the mini-program has one assessment implementation.
  const { DEFINITIONS } = require("./healthAssessmentDevelopmentFixtures");
  return [initialDefinition(DEFINITIONS.INITIAL), gutDefinition(DEFINITIONS.GUT_REGULARITY)];
}

function seedLocalMiniprogramDevData(data, options = {}) {
  const env = options.env || process.env;
  if (!enabled(env.ROOT_LOCAL_MINIPROGRAM_DEV_SEED)) {
    return { enabled: false, changed: false, definitionCount: 0 };
  }
  const storeAdapter = options.storeAdapter || {};
  assertLocalSeedBoundary(env, storeAdapter);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw seedError("LOCAL_DEV_SEED_DATA_INVALID", "Local mini program seed requires store data");
  }
  const fixtures = options.definitions || localDefinitions();
  const current = Array.isArray(data.healthAssessmentDefinitions) ? data.healthAssessmentDefinitions : [];
  const retained = current.filter((item) => item.development_fixture_scope !== LOCAL_SEED_SCOPE);
  data.healthAssessmentDefinitions = retained.concat(clone(fixtures));
  return {
    enabled: true,
    changed: true,
    definitionCount: fixtures.length,
    scope: LOCAL_SEED_SCOPE,
  };
}

module.exports = {
  LOCAL_SEED_SCOPE,
  LOCAL_SQLITE_BASENAME,
  assertLocalSeedBoundary,
  localDefinitions,
  seedLocalMiniprogramDevData,
};
