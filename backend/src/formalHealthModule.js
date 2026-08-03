const { createClientError } = require("./clientError");
const { nowISO, todayISO } = require("./dates");
const { createId } = require("./seed");

const QUESTIONNAIRE_ID = "ROOT4U_INITIAL_PROFILE";
const QUESTIONNAIRE_VERSION = 1;
const CAMPAIGN_ID = "ROOT4U";
const MINIMUM_AGE = 18;

const QUESTIONS = Object.freeze([
  {
    id: "primary_goal",
    type: "single",
    title: "这次使用 Root，最想先改善哪类状态？",
    options: [
      ["bowel", "排便更规律"], ["digestion", "腹胀反酸更少"], ["sleep", "睡眠和作息更稳"],
      ["energy", "压力和精力更好"], ["lifestyle", "饮食运动更规律"], ["observe", "先记录观察"],
    ],
  },
  {
    id: "impact_level",
    type: "single",
    title: "当前最困扰的状态对日常影响程度？",
    options: [["0", "0 无影响"], ["1_3", "1–3 轻微"], ["4_6", "4–6 明显"], ["7_8", "7–8 很影响"], ["9_10", "9–10 严重影响"]],
  },
  {
    id: "safety",
    type: "multi",
    title: "安全与适用性确认",
    options: [
      ["none", "无以上情况", { exclusive: true }],
      ["pregnancy", "怀孕、哺乳或备孕", { femaleOnly: true }],
      ["medical_diet", "医生要求控制饮食或运动"], ["major_treatment", "正在治疗重大或慢性疾病"],
      ["recent_acute", "近期手术、住院或急性病"], ["blood_stool", "血便或黑便"],
      ["acute_digestive", "持续腹痛、发热、严重腹泻或持续呕吐"], ["weight_loss", "近期非主动明显体重下降"],
      ["self_harm", "最近出现伤害自己的想法"],
    ],
  },
  {
    id: "bowel_frequency",
    type: "single",
    title: "过去 7 天排便频率？",
    options: [["daily", "每天 1–2 次"], ["every_2_3_days", "每 2–3 天 1 次"], ["twice_week", "每周 2 次及以下"], ["frequent_loose", "每天 3 次及以上且偏稀"], ["variable", "频率波动大"], ["unsure", "不确定"]],
  },
  {
    id: "stool_form",
    type: "single",
    title: "过去 7 天最常见的便便形态？",
    options: [["hard", "偏硬、颗粒状"], ["formed", "成型顺畅"], ["soft", "偏软、不太成型"], ["watery", "稀便或水样"], ["variable", "多种形态混合波动"], ["unsure", "不确定"]],
  },
  {
    id: "digestive_feelings",
    type: "multi",
    title: "过去 7 天消化感受？",
    options: [["none", "无明显不适", { exclusive: true }], ["bloating", "腹胀或胀气"], ["pain", "腹痛"], ["reflux", "反酸或烧心"], ["post_meal", "餐后不适或早饱"], ["nausea", "恶心或食欲差"], ["straining", "排便费力"], ["urgency", "便急"]],
  },
  {
    id: "sleep_duration",
    type: "single",
    title: "过去 7 天平均每天睡多久？",
    options: [["under_5", "少于 5 小时"], ["5_6", "5–6 小时"], ["6_7", "6–7 小时"], ["7_8", "7–8 小时"], ["8_9", "8–9 小时"], ["over_9", "超过 9 小时"], ["irregular", "昼夜颠倒或很不规律"]],
  },
  {
    id: "sleep_issues",
    type: "multi",
    title: "主要睡眠困扰？",
    options: [["none", "无明显困扰", { exclusive: true }], ["onset", "入睡困难"], ["waking", "夜里容易醒"], ["early", "早醒"], ["unrefreshed", "睡醒不解乏"], ["daytime", "白天困倦"], ["screen_work", "睡前手机、工作或情绪影响"], ["shift_care", "轮班或照护影响"]],
  },
  {
    id: "activity",
    type: "single",
    title: "过去 7 天活动和久坐情况？",
    options: [["sedentary", "几乎不运动且久坐较多"], ["light_1_2", "每周 1–2 次轻活动"], ["regular_3", "每周 3 次及以上、每次约 30 分钟"], ["active_commute", "工作或通勤中经常走动"], ["exercise_sedentary", "有规律运动但久坐时间长"], ["unsure", "不确定"]],
  },
  {
    id: "diet",
    type: "multi",
    title: "过去 7 天饮食结构？",
    options: [["balanced", "每餐基本有蔬菜且每天有水果", { exclusive: true }], ["low_variety", "有蔬菜但水果、全谷物或豆类较少"], ["processed", "外卖、加工食品较多"], ["sugar", "甜食或含糖饮料较多"], ["irregular", "进餐不规律或晚餐较晚"], ["variable", "食量波动较大"]],
  },
  {
    id: "hydration",
    type: "multi",
    title: "过去 7 天饮水和饮品情况？",
    options: [["adequate", "饮水较充足，少喝含糖饮品", { exclusive: true }], ["low_water", "饮水偏少"], ["sugary", "常喝含糖饮料"], ["late_caffeine", "下午或晚上喝咖啡、浓茶或能量饮料"], ["alcohol", "经常饮酒或睡前饮酒"], ["unsure", "不确定"]],
  },
  {
    id: "stress_energy",
    type: "multi",
    title: "过去 7 天压力和精力？",
    options: [["stable", "状态稳定", { exclusive: true }], ["recoverable_stress", "压力较大但能恢复"], ["fatigue", "持续疲惫、精力低"], ["low_mood", "情绪低落或兴趣下降"], ["anxious", "容易焦虑、紧张或难放松"], ["life_event", "最近有明显生活事件"], ["prefer_not", "不愿回答", { exclusive: true }]],
  },
]);

const CATEGORY_CONTENT = Object.freeze({
  BASELINE: {
    title: "基础状态维护型",
    tips: ["保持相对固定的起床和进餐时间。", "每天选择一个容易坚持的身体记录。", "连续观察一周，再判断是否需要调整。"],
    recommendations: ["生活节律评测", "压力活力评测"],
  },
  BOWEL: {
    title: "肠道规律关注型",
    tips: ["先固定每天观察排便的时间和形态。", "逐步增加饮水，避免一次性大量补水。", "每餐为蔬菜、全谷物或豆类留出位置。"],
    recommendations: ["肠道规律评测", "饮食结构评测"],
  },
  DIGESTION: {
    title: "腹胀反酸关注型",
    tips: ["用餐放慢一些，并留意最容易出现不适的时段。", "避免临睡前的大量进食和饮酒。", "先记录食物与感受的关系，不急于自行删掉多类食物。"],
    recommendations: ["消化感受评测", "饮食结构评测"],
  },
  SLEEP: {
    title: "睡眠节律关注型",
    tips: ["先固定起床时间，再逐步调整入睡时间。", "睡前一小时减少工作和高刺激屏幕内容。", "白天安排轻活动，并记录醒来后的精神状态。"],
    recommendations: ["睡眠状态评测", "压力活力评测"],
  },
  ENERGY: {
    title: "压力活力关注型",
    tips: ["把一天中最耗能的时段记录下来。", "在连续工作之间安排短暂走动或呼吸停顿。", "优先保证规律进餐和基本睡眠，不同时增加太多目标。"],
    recommendations: ["压力活力评测", "睡眠状态评测"],
  },
  LIFESTYLE: {
    title: "活动饮食调整型",
    tips: ["从每天增加一次十分钟走动开始。", "先让一餐更接近蔬菜、蛋白质和主食的组合。", "用可重复的小变化替代一次性的严格计划。"],
    recommendations: ["活动状态评测", "饮食结构评测"],
  },
  VARIABLE: {
    title: "生活方式波动型",
    tips: ["先记录一周作息、饮食和感受的波动。", "每次只调整一个最容易执行的习惯。", "用稳定的观察替代对单日状态的判断。"],
    recommendations: ["生活节律评测", "压力活力评测"],
  },
});

function options(question, gender) {
  return question.options
    .filter(([, , config]) => !(config && config.femaleOnly) || gender === "FEMALE")
    .map(([value, label, config]) => ({ value, label, exclusive: Boolean(config && config.exclusive) }));
}

function definitionFor(profile) {
  return {
    questionnaireId: QUESTIONNAIRE_ID,
    version: QUESTIONNAIRE_VERSION,
    title: "健康起点评测",
    description: "用 12 个问题建立你的生活方式观察起点。",
    disclaimer: "结果用于日常生活方式观察，不构成医疗诊断或治疗建议。",
    questions: QUESTIONS.map((question) => ({ ...question, options: options(question, profile.gender) })),
  };
}

function ageOn(birthDate, asOf = todayISO()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(birthDate || ""))) return -1;
  const [year, month, day] = birthDate.split("-").map(Number);
  const [currentYear, currentMonth, currentDay] = asOf.split("-").map(Number);
  let age = currentYear - year;
  if (currentMonth < month || (currentMonth === month && currentDay < day)) age -= 1;
  return age;
}

function assertEligible(profile, context = {}) {
  if (!profile || !profile.complete) throw createClientError("FORMAL_HEALTH_PROFILE_REQUIRED", "请先完善会员资料", 409);
  const age = ageOn(profile.birthDate, context.today || todayISO());
  if (age < MINIMUM_AGE) throw createClientError("FORMAL_HEALTH_AGE_RESTRICTED", "首发仅面向 18 岁及以上用户", 403);
  return age;
}

function answerRows(data) {
  if (!Array.isArray(data.questionnaireAnswers)) data.questionnaireAnswers = [];
  return data.questionnaireAnswers;
}

function latest(data, rootUserId) {
  return answerRows(data)
    .filter((item) => item.root_user_id === rootUserId && item.questionnaire_id === QUESTIONNAIRE_ID)
    .sort((left, right) => String(right.submitted_at).localeCompare(String(left.submitted_at)))[0] || null;
}

function normalizeAnswers(input, definition) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const normalized = {};
  for (const question of definition.questions) {
    const allowed = new Map(question.options.map((option) => [option.value, option]));
    const raw = source[question.id];
    if (question.type === "single") {
      const value = String(raw || "").trim();
      if (!allowed.has(value)) throw createClientError("FORMAL_HEALTH_ANSWER_REQUIRED", `请完成：${question.title}`, 422);
      normalized[question.id] = value;
      continue;
    }
    const values = Array.isArray(raw) ? Array.from(new Set(raw.map((value) => String(value || "").trim()))) : [];
    if (!values.length || values.some((value) => !allowed.has(value))) {
      throw createClientError("FORMAL_HEALTH_ANSWER_REQUIRED", `请完成：${question.title}`, 422);
    }
    const exclusive = values.filter((value) => allowed.get(value).exclusive);
    if (exclusive.length && values.length > 1) throw createClientError("FORMAL_HEALTH_ANSWER_CONFLICT", `请重新选择：${question.title}`, 422);
    normalized[question.id] = values;
  }
  return normalized;
}

function includes(answers, key, value) {
  const selected = answers[key];
  return Array.isArray(selected) ? selected.includes(value) : selected === value;
}

function tagsFor(answers) {
  const tags = [];
  if (includes(answers, "hydration", "low_water")) tags.push("饮水偏少");
  if (["under_5", "5_6", "irregular"].includes(answers.sleep_duration)) tags.push("睡眠不足或不规律");
  if (["sedentary", "exercise_sedentary"].includes(answers.activity)) tags.push("久坐偏高");
  if (includes(answers, "diet", "irregular")) tags.push("进餐节律波动");
  if (includes(answers, "stress_energy", "fatigue")) tags.push("精力偏低");
  return tags.slice(0, 3);
}

function resultFor(answers) {
  const safety = answers.safety || [];
  if (!safety.includes("none")) {
    return {
      safetyStatus: "PROFESSIONAL_SUPPORT_RECOMMENDED",
      categoryCode: "SAFETY_GUIDANCE",
      categoryTitle: "这次不继续生成普通生活方式建议",
      tags: [],
      tips: ["如症状严重或正在加重，请尽快就医。", "如存在立即危险，请联系当地紧急支持。", "不要因为本次问卷延迟寻求专业帮助。"],
      recommendations: [],
    };
  }

  let category = { bowel: "BOWEL", digestion: "DIGESTION", sleep: "SLEEP", energy: "ENERGY", lifestyle: "LIFESTYLE", observe: "BASELINE" }[answers.primary_goal] || "BASELINE";
  if (["7_8", "9_10"].includes(answers.impact_level) && ["under_5", "5_6", "irregular"].includes(answers.sleep_duration)) category = "SLEEP";
  if (answers.primary_goal === "observe" && (answers.bowel_frequency === "variable" || answers.stool_form === "variable" || includes(answers, "diet", "variable"))) category = "VARIABLE";
  const content = CATEGORY_CONTENT[category];
  return {
    safetyStatus: "STANDARD_GUIDANCE",
    categoryCode: category,
    categoryTitle: content.title,
    tags: tagsFor(answers),
    tips: content.tips.slice(0, 3),
    recommendations: content.recommendations.map((title) => ({ title, availability: "COMING_SOON" })),
  };
}

function publicResult(row) {
  const result = row && row.answers_json && row.answers_json.result;
  if (!result || typeof result !== "object") return null;
  return { ...result, completedAt: row.submitted_at, questionnaireVersion: row.version };
}

function bootstrap(data, user, profile, consentStatus, context = {}) {
  let age = -1;
  let eligibility = "PROFILE_REQUIRED";
  if (profile && profile.complete) {
    age = ageOn(profile.birthDate, context.today || todayISO());
    eligibility = age >= MINIMUM_AGE ? "ELIGIBLE" : "AGE_RESTRICTED";
  }
  const row = latest(data, user.root_user_id || user.user_id);
  const result = consentStatus.active ? publicResult(row) : null;
  return {
    eligibility,
    minimumAge: MINIMUM_AGE,
    consentRequired: Boolean(consentStatus.required && !consentStatus.active),
    consentConfigured: Boolean(consentStatus.configured),
    assessmentState: result ? "COMPLETED" : "NOT_STARTED",
    result,
  };
}

function getDefinition(profile, context = {}) {
  assertEligible(profile, context);
  return { definition: definitionFor(profile) };
}

function submit(data, user, profile, input = {}, context = {}) {
  assertEligible(profile, context);
  const rootUserId = user.root_user_id || user.user_id;
  const previous = latest(data, rootUserId);
  if (previous && publicResult(previous)) {
    throw createClientError("FORMAL_HEALTH_ALREADY_COMPLETED", "健康起点评测已完成", 409);
  }
  const definition = definitionFor(profile);
  const answers = normalizeAnswers(input.answers, definition);
  const result = resultFor(answers);
  const submittedAt = context.now || nowISO();
  const row = {
    questionnaire_answer_id: createId("qan"),
    root_user_id: rootUserId,
    campaign_id: CAMPAIGN_ID,
    questionnaire_id: QUESTIONNAIRE_ID,
    questionnaire_type: QUESTIONNAIRE_ID,
    version: QUESTIONNAIRE_VERSION,
    answers_json: { answers, result },
    submitted_at: submittedAt,
    idempotency_key: String(input.idempotencyKey || input.idempotency_key || "").trim() || null,
  };
  answerRows(data).push(row);
  return { success: true, answerId: row.questionnaire_answer_id, result: publicResult(row) };
}

module.exports = {
  MINIMUM_AGE,
  QUESTIONNAIRE_ID,
  QUESTIONNAIRE_VERSION,
  ageOn,
  bootstrap,
  getDefinition,
  resultFor,
  submit,
};
