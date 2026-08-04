const { createClientError } = require("./clientError");

const QUESTIONNAIRE_ID = "ROOT4U_INITIAL_PROFILE";
const QUESTIONNAIRE_VERSION = 1;
const SCORING_VERSION = 1;

const QUESTIONS = Object.freeze([
  {
    id: "primary_goal", type: "single", required: true,
    title: "这次使用 Root，最想先改善哪类状态？",
    options: [["bowel", "排便更规律"], ["digestion", "腹胀反酸更少"], ["sleep", "睡眠和作息更稳"], ["energy", "压力和精力更好"], ["lifestyle", "饮食运动更规律"], ["observe", "先记录观察"]],
  },
  {
    id: "impact_level", type: "single", required: true,
    title: "当前最困扰的状态对日常影响程度？",
    options: [["0", "0 无影响"], ["1_3", "1–3 轻微"], ["4_6", "4–6 明显"], ["7_8", "7–8 很影响"], ["9_10", "9–10 严重影响"]],
  },
  {
    id: "safety", type: "multi", required: true,
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
    id: "bowel_frequency", type: "single", required: true,
    title: "过去 7 天排便频率？",
    options: [["daily", "每天 1–2 次"], ["every_2_3_days", "每 2–3 天 1 次"], ["twice_week", "每周 2 次及以下"], ["frequent_loose", "每天 3 次及以上且偏稀"], ["variable", "频率波动大"], ["unsure", "不确定"]],
  },
  {
    id: "stool_form", type: "single", required: true,
    title: "过去 7 天最常见的便便形态？",
    options: [["hard", "偏硬、颗粒状"], ["formed", "成型顺畅"], ["soft", "偏软、不太成型"], ["watery", "稀便或水样"], ["variable", "多种形态混合波动"], ["unsure", "不确定"]],
  },
  {
    id: "digestive_feelings", type: "multi", required: true,
    title: "过去 7 天消化感受？",
    options: [["none", "无明显不适", { exclusive: true }], ["bloating", "腹胀或胀气"], ["pain", "腹痛"], ["reflux", "反酸或烧心"], ["post_meal", "餐后不适或早饱"], ["nausea", "恶心或食欲差"], ["straining", "排便费力"], ["urgency", "便急"]],
  },
  {
    id: "sleep_duration", type: "single", required: true,
    title: "过去 7 天平均每天睡多久？",
    options: [["under_5", "少于 5 小时"], ["5_6", "5–6 小时"], ["6_7", "6–7 小时"], ["7_8", "7–8 小时"], ["8_9", "8–9 小时"], ["over_9", "超过 9 小时"], ["irregular", "昼夜颠倒或很不规律"]],
  },
  {
    id: "sleep_issues", type: "multi", required: true,
    title: "主要睡眠困扰？",
    options: [["none", "无明显困扰", { exclusive: true }], ["onset", "入睡困难"], ["waking", "夜里容易醒"], ["early", "早醒"], ["unrefreshed", "睡醒不解乏"], ["daytime", "白天困倦"], ["screen_work", "睡前手机、工作或情绪影响"], ["shift_care", "轮班或照护影响"]],
  },
  {
    id: "activity", type: "single", required: true,
    title: "过去 7 天活动和久坐情况？",
    options: [["sedentary", "几乎不运动且久坐较多"], ["light_1_2", "每周 1–2 次轻活动"], ["regular_3", "每周 3 次及以上、每次约 30 分钟"], ["active_commute", "工作或通勤中经常走动"], ["exercise_sedentary", "有规律运动但久坐时间长"], ["unsure", "不确定"]],
  },
  {
    id: "diet", type: "multi", required: true,
    title: "过去 7 天饮食结构？",
    options: [["balanced", "每餐基本有蔬菜且每天有水果", { exclusive: true }], ["low_variety", "有蔬菜但水果、全谷物或豆类较少"], ["processed", "外卖、加工食品较多"], ["sugar", "甜食或含糖饮料较多"], ["irregular", "进餐不规律或晚餐较晚"], ["variable", "食量波动较大"]],
  },
  {
    id: "hydration", type: "multi", required: true,
    title: "过去 7 天饮水和饮品情况？",
    options: [["adequate", "饮水较充足，少喝含糖饮品", { exclusive: true }], ["low_water", "饮水偏少"], ["sugary", "常喝含糖饮料"], ["late_caffeine", "下午或晚上喝咖啡、浓茶或能量饮料"], ["alcohol", "经常饮酒或睡前饮酒"], ["unsure", "不确定"]],
  },
  {
    id: "stress_energy", type: "multi", required: true,
    title: "过去 7 天压力和精力？",
    options: [["stable", "状态稳定", { exclusive: true }], ["recoverable_stress", "压力较大但能恢复"], ["fatigue", "持续疲惫、精力低"], ["low_mood", "情绪低落或兴趣下降"], ["anxious", "容易焦虑、紧张或难放松"], ["life_event", "最近有明显生活事件"], ["prefer_not", "不愿回答", { exclusive: true }]],
  },
]);

function optionList(question, gender) {
  return question.options
    .filter(([, , config]) => !(config && config.femaleOnly) || !gender || gender === "FEMALE")
    .map(([value, label, config]) => ({
      value,
      label,
      exclusive: Boolean(config && config.exclusive),
      applicability: config && config.femaleOnly ? "FEMALE" : "ALL",
    }));
}

function getPublishedDefinition(profile = {}) {
  return {
    questionnaireId: QUESTIONNAIRE_ID,
    version: QUESTIONNAIRE_VERSION,
    scoringVersion: SCORING_VERSION,
    title: "健康起点评测",
    description: "用 12 个问题建立你的生活方式观察起点。",
    disclaimer: "结果用于日常生活方式观察，不构成医疗诊断或治疗建议。",
    questions: QUESTIONS.map((question) => ({
      id: question.id,
      type: question.type,
      required: question.required,
      title: question.title,
      options: optionList(question, profile.gender),
    })),
  };
}

function normalizeAnswers(input, definition) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const normalized = {};
  for (const question of definition.questions) {
    const allowed = new Map(question.options.map((option) => [option.value, option]));
    const raw = source[question.id];
    if (question.type === "single") {
      const value = String(raw || "").trim();
      if (!allowed.has(value)) {
        throw createClientError("FORMAL_HEALTH_ANSWER_REQUIRED", `请完成：${question.title}`, 422);
      }
      normalized[question.id] = value;
      continue;
    }
    const values = Array.isArray(raw)
      ? Array.from(new Set(raw.map((value) => String(value || "").trim())))
      : [];
    if (!values.length || values.some((value) => !allowed.has(value))) {
      throw createClientError("FORMAL_HEALTH_ANSWER_REQUIRED", `请完成：${question.title}`, 422);
    }
    if (values.some((value) => allowed.get(value).exclusive) && values.length > 1) {
      throw createClientError("FORMAL_HEALTH_ANSWER_CONFLICT", `请重新选择：${question.title}`, 422);
    }
    normalized[question.id] = values;
  }
  return normalized;
}

function selected(answers, key, value) {
  const actual = answers[key];
  return Array.isArray(actual) ? actual.includes(value) : actual === value;
}

function selectedCount(answers, key, excluded = []) {
  const actual = Array.isArray(answers[key]) ? answers[key] : [];
  return actual.filter((value) => !excluded.includes(value)).length;
}

function tagsFor(answers) {
  const tags = [];
  if (selected(answers, "hydration", "low_water")) tags.push("饮水偏少");
  if (["under_5", "5_6", "irregular"].includes(answers.sleep_duration)) tags.push("睡眠不足或不规律");
  if (["sedentary", "exercise_sedentary"].includes(answers.activity)) tags.push("久坐偏高");
  if (selected(answers, "diet", "irregular")) tags.push("进餐节律波动");
  if (selected(answers, "stress_energy", "fatigue")) tags.push("精力偏低");
  return tags.slice(0, 3);
}

function scoreAssessment(answers) {
  if (!answers || !Array.isArray(answers.safety)
    || answers.safety.length !== 1 || answers.safety[0] !== "none") {
    throw createClientError(
      "FORMAL_HEALTH_SCORING_BLOCKED_BY_SAFETY",
      "当前安全状态不能进入普通评分",
      409,
    );
  }
  const scores = {
    BASELINE: 0,
    BOWEL: 0,
    DIGESTION: 0,
    SLEEP: 0,
    ENERGY: 0,
    LIFESTYLE: 0,
    VARIABLE: 0,
  };
  const primaryCategory = {
    bowel: "BOWEL",
    digestion: "DIGESTION",
    sleep: "SLEEP",
    energy: "ENERGY",
    lifestyle: "LIFESTYLE",
    observe: "BASELINE",
  }[answers.primary_goal] || "BASELINE";
  scores[primaryCategory] += 6;

  if (["every_2_3_days", "twice_week", "frequent_loose", "variable"].includes(answers.bowel_frequency)) scores.BOWEL += 2;
  if (["hard", "watery", "variable"].includes(answers.stool_form)) scores.BOWEL += 2;
  if (selected(answers, "digestive_feelings", "straining") || selected(answers, "digestive_feelings", "urgency")) scores.BOWEL += 1;
  scores.DIGESTION += Math.min(3, selectedCount(answers, "digestive_feelings", ["none", "straining", "urgency"]));

  if (["under_5", "5_6", "irregular"].includes(answers.sleep_duration)) scores.SLEEP += 3;
  scores.SLEEP += Math.min(3, selectedCount(answers, "sleep_issues", ["none"]));
  if (["7_8", "9_10"].includes(answers.impact_level) && ["under_5", "5_6", "irregular"].includes(answers.sleep_duration)) scores.SLEEP += 8;

  scores.ENERGY += Math.min(4, selectedCount(answers, "stress_energy", ["stable", "prefer_not"]));
  if (["sedentary", "exercise_sedentary"].includes(answers.activity)) scores.LIFESTYLE += 2;
  scores.LIFESTYLE += Math.min(2, selectedCount(answers, "diet", ["balanced", "variable"]));
  scores.LIFESTYLE += Math.min(2, selectedCount(answers, "hydration", ["adequate", "unsure"]));

  if (answers.bowel_frequency === "variable") scores.VARIABLE += 3;
  if (answers.stool_form === "variable") scores.VARIABLE += 3;
  if (selected(answers, "diet", "variable")) scores.VARIABLE += 3;
  if (answers.primary_goal !== "observe") scores.VARIABLE = Math.min(scores.VARIABLE, 3);

  const categoryOrder = [primaryCategory, "BOWEL", "DIGESTION", "SLEEP", "ENERGY", "LIFESTYLE", "VARIABLE", "BASELINE"];
  const categoryCode = categoryOrder.reduce((best, candidate) => (
    scores[candidate] > scores[best] ? candidate : best
  ), categoryOrder[0]);
  return {
    categoryCode,
    scores,
    tags: tagsFor(answers),
    scoringVersion: SCORING_VERSION,
  };
}

module.exports = {
  QUESTIONNAIRE_ID,
  QUESTIONNAIRE_VERSION,
  SCORING_VERSION,
  getPublishedDefinition,
  normalizeAnswers,
  scoreAssessment,
  tagsFor,
};
