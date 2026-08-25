const {
  missingAnswer,
  pruneHiddenAnswers,
  visibleQuestions,
} = require("./assessment-flow");
const {
  LOCAL_HEALTH_RETENTION_DAYS,
  STORAGE_KEY,
  STORAGE_VERSION,
  cleanupExpiredLocalHealthData,
} = require("./local-health-retention");

const USER_SCOPE_KEY = "ROOT_LOCAL_USER_SCOPE_V060";
const INSTALLATION_SCOPE_KEY = "ROOT_LOCAL_INSTALLATION_SCOPE_V060";
const COMPLETED_STATUSES = new Set(["COMPLETED", "SAFETY_STOPPED"]);

function option(value, label, config = {}) {
  return { value, label, ...config };
}

const INITIAL_QUESTIONS = Object.freeze([
  {
    field: "primary_goal", type: "single", required: true,
    title: "这次使用 Root，最想先改善哪类状态？",
    options: [
      option("bowel", "排便更规律"), option("digestion", "腹胀反酸更少"),
      option("sleep", "睡眠和作息更稳"), option("energy", "压力和精力更好"),
      option("lifestyle", "饮食运动更规律"), option("observe", "先记录观察"),
    ],
  },
  {
    field: "impact_level", type: "single", required: true,
    title: "当前最困扰的状态对日常影响程度？",
    options: [
      option("0", "0 无影响"), option("1_3", "1–3 轻微"), option("4_6", "4–6 明显"),
      option("7_8", "7–8 很影响"), option("9_10", "9–10 严重影响"),
    ],
  },
  {
    field: "safety", type: "multi", required: true,
    title: "安全与适用性确认",
    options: [
      option("none", "无以上情况", { exclusive: true }),
      option("pregnancy", "怀孕、哺乳或备孕"),
      option("medical_diet", "医生要求控制饮食或运动"),
      option("major_treatment", "正在治疗重大或慢性疾病"),
      option("recent_acute", "近期手术、住院或急性病"),
      option("blood_stool", "血便或黑便"),
      option("acute_digestive", "持续腹痛、发热、严重腹泻或持续呕吐"),
      option("weight_loss", "近期非主动明显体重下降"),
      option("self_harm", "最近出现伤害自己的想法"),
    ],
  },
  {
    field: "bowel_frequency", type: "single", required: true,
    title: "过去 7 天排便频率？",
    options: [
      option("daily", "每天 1–2 次"), option("every_2_3_days", "每 2–3 天 1 次"),
      option("twice_week", "每周 2 次及以下"), option("frequent_loose", "每天 3 次及以上且偏稀"),
      option("variable", "频率波动大"), option("unsure", "不确定"),
    ],
  },
  {
    field: "stool_form", type: "single", required: true,
    title: "过去 7 天最常见的便便形态？",
    options: [
      option("hard", "偏硬、颗粒状"), option("formed", "成型顺畅"), option("soft", "偏软、不太成型"),
      option("watery", "稀便或水样"), option("variable", "多种形态混合波动"), option("unsure", "不确定"),
    ],
  },
  {
    field: "digestive_feelings", type: "multi", required: true,
    title: "过去 7 天消化感受？",
    options: [
      option("none", "无明显不适", { exclusive: true }), option("bloating", "腹胀或胀气"),
      option("pain", "腹痛"), option("reflux", "反酸或烧心"), option("post_meal", "餐后不适或早饱"),
      option("nausea", "恶心或食欲差"), option("straining", "排便费力"), option("urgency", "便急"),
    ],
  },
  {
    field: "sleep_duration", type: "single", required: true,
    title: "过去 7 天平均每天睡多久？",
    options: [
      option("under_5", "少于 5 小时"), option("5_6", "5–6 小时"), option("6_7", "6–7 小时"),
      option("7_8", "7–8 小时"), option("8_9", "8–9 小时"), option("over_9", "超过 9 小时"),
      option("irregular", "昼夜颠倒或很不规律"),
    ],
  },
  {
    field: "sleep_issues", type: "multi", required: true,
    title: "主要睡眠困扰？",
    options: [
      option("none", "无明显困扰", { exclusive: true }), option("onset", "入睡困难"),
      option("waking", "夜里容易醒"), option("early", "早醒"), option("unrefreshed", "睡醒不解乏"),
      option("daytime", "白天困倦"), option("screen_work", "睡前手机、工作或情绪影响"),
      option("shift_care", "轮班或照护影响"),
    ],
  },
  {
    field: "activity", type: "single", required: true,
    title: "过去 7 天活动和久坐情况？",
    options: [
      option("sedentary", "几乎不运动且久坐较多"), option("light_1_2", "每周 1–2 次轻活动"),
      option("regular_3", "每周 3 次及以上、每次约 30 分钟"), option("active_commute", "工作或通勤中经常走动"),
      option("exercise_sedentary", "有规律运动但久坐时间长"), option("unsure", "不确定"),
    ],
  },
  {
    field: "diet", type: "multi", required: true,
    title: "过去 7 天饮食结构？",
    options: [
      option("balanced", "每餐基本有蔬菜且每天有水果", { exclusive: true }),
      option("low_variety", "有蔬菜但水果、全谷物或豆类较少"), option("processed", "外卖、加工食品较多"),
      option("sugar", "甜食或含糖饮料较多"), option("irregular", "进餐不规律或晚餐较晚"),
      option("variable", "食量波动较大"),
    ],
  },
  {
    field: "hydration", type: "multi", required: true,
    title: "过去 7 天饮水和饮品情况？",
    options: [
      option("adequate", "饮水较充足，少喝含糖饮品", { exclusive: true }), option("low_water", "饮水偏少"),
      option("sugary", "常喝含糖饮料"), option("late_caffeine", "下午或晚上喝咖啡、浓茶或能量饮料"),
      option("alcohol", "经常饮酒或睡前饮酒"), option("unsure", "不确定"),
    ],
  },
  {
    field: "stress_energy", type: "multi", required: true,
    title: "过去 7 天压力和精力？",
    options: [
      option("stable", "状态稳定", { exclusive: true }), option("recoverable_stress", "压力较大但能恢复"),
      option("fatigue", "持续疲惫、精力低"), option("low_mood", "情绪低落或兴趣下降"),
      option("anxious", "容易焦虑、紧张或难放松"), option("life_event", "最近有明显生活事件"),
      option("prefer_not", "不愿回答", { exclusive: true }),
    ],
  },
]);

const GUT_QUESTIONS_V1 = Object.freeze([
  {
    field: "Q5", type: "single", required: true,
    title: "为了您的安全，请确认您最近有过下面这些情况吗？",
    options: [
      option("A", "都没有"), option("B", "便便带血、发黑，或者带有黏液"),
      option("C", "没刻意减肥，但体重突然掉得厉害（3个月瘦了5%以上）"),
      option("D", "大半夜被肚子痛或者拉肚子憋醒过"),
    ],
  },
  {
    field: "Q1", type: "single", required: true,
    title: "过去一周，您的排便频率大概是怎样的？",
    visibleIf: { field: "Q5", operator: "EQ", value: "A" },
    options: [
      option("A", "每1~2天都会有一次排便"), option("B", "经常2天以上才能排便一次"),
      option("C", "每天都要上厕所2次及以上"), option("D", "完全没有规律，有时好几天不拉，有时又频繁拉"),
    ],
  },
  {
    field: "Q2", type: "single", required: true,
    title: "针对频率偏低的情况，您的大便形态通常是怎样的？",
    visibleIf: { field: "Q1", operator: "EQ", value: "B" },
    options: [
      option("A", "干硬成球，或者表面凹凸不平像羊粪（第一、第二型）"),
      option("B", "表面有裂纹，像香肠（第三型）"), option("C", "虽然频率低，但是便型软硬度适中（第四、第五型）"),
      option("D", "虽然拉得少，但大便依然是偏稀、糊状或不成形的（第六、第七型）"),
    ],
  },
  {
    field: "Q3", type: "single", required: true,
    title: "针对频率偏高/不规律的情况，您的大便形态通常是怎样的？",
    visibleIf: { field: "Q1", operator: "IN", values: ["C", "D"] },
    options: [
      option("A", "经常是稀水样，或者糊状，没有固定形状"),
      option("B", "大部分时候是正常的香蕉便，只是偶尔拉肚子"),
      option("C", "时干时稀，有时像羊粪球，有时又是稀水样"),
    ],
  },
  {
    field: "Q4", type: "single", required: true,
    title: "过去一个月，您是否有以下情况？",
    visibleIf: { field: "Q1", operator: "EQ", value: "A" },
    options: [
      option("A", "大便成形（像香蕉/香肠），且肚子没有不舒服"), option("B", "大便偏稀、呈糊状，或不成形"),
      option("C", "肚子痛或不适，排便后能明显缓解"), option("D", "经常腹胀、放屁多，或伴有烧心/反酸"),
      option("E", "有轻微不适，但不属于以上情况"),
    ],
  },
]);

const GUT_QUESTIONS = Object.freeze([
  {
    field: "Q1", type: "single", required: true,
    title: "过去 7 天，你的排便频率大概是？",
    description: "选一个最接近的情况",
    options: [
      option("A", "每天 1–2 次"), option("B", "每 2–3 天 1 次"),
      option("C", "每周 2 次及以下"), option("D", "每天 3 次及以上且偏稀"),
      option("E", "频率波动大（有时偏少、有时偏多）"),
    ],
  },
  {
    field: "Q2", type: "single", required: true,
    title: "过去 7 天，最常见的便便形态是？",
    description: "参考下图，选择最常见的形态",
    options: [
      option("A", "第 1–2 型：小硬球，或表面凹凸的香肠状"),
      option("B", "第 3–4 型：像香肠或蛇，表面有裂痕或顺滑柔软"),
      option("C", "第 5 型：断边平滑的柔软块状，容易通过"),
      option("D", "第 6–7 型：蓬松糊状，或水样、没有固体块"),
      option("E", "多种形态混合波动"),
    ],
  },
  {
    field: "Q3", type: "multi", required: true,
    title: "过去 7 天，你有哪些肠胃方面的感受？",
    description: "可多选，有过就算",
    options: [
      option("A", "无明显不适", { exclusive: true }),
      option("B", "偶尔腹胀或胀气"), option("C", "有时腹痛或痉挛痛"),
      option("D", "偶尔反酸或烧心"), option("E", "有时餐后不适或吃一点就饱"),
      option("F", "偶尔恶心或食欲差"), option("G", "偶尔排便费力"),
      option("H", "有时便急、憋不住"), option("I", "偶尔有口臭或舌苔厚腻"),
    ],
  },
  {
    field: "Q4", type: "multi", required: true,
    title: "在什么情况下，你的肠胃容易闹情绪？",
    description: "可多选",
    options: [
      option("A", "很少，肠胃基本不受外界影响", { exclusive: true }),
      option("B", "压力大、情绪紧张或焦虑时"),
      option("C", "饮食不规律、出差或换环境时"),
      option("D", "吃了辛辣、油腻、生冷或特定食物后"),
      option("E", "季节变化或受凉时"),
      option("F", "不太确定，没特别注意过", { exclusive: true }),
    ],
  },
  {
    field: "Q5", type: "multi", required: true,
    title: "过去一周，你的饮食和饮水习惯接近哪种情况？",
    description: "可多选",
    options: [
      option("A", "饮食较均衡，蔬菜水果和饮水量都还不错", { exclusive: true }),
      option("B", "蔬菜水果吃得比较少"),
      option("C", "主食以精白米面为主，全谷物和豆类较少"),
      option("D", "经常吃外卖或加工食品"),
      option("E", "每天饮水量偏少，经常忘记喝水"),
      option("F", "经常喝含糖饮料"),
      option("G", "进餐时间不规律"),
    ],
  },
]);

const GUT_DEFINITION_V1 = Object.freeze({
  assessmentDefinitionId: "local-gut-regularity-v1",
  assessmentType: "GUT_REGULARITY",
  questionnaireId: "ROOT_GUT_REGULARITY",
  questionnaireVersion: 1,
  title: "肠道规律自测",
  description: "通过排便频率和便便形态，记录近期肠道规律状态。",
  estimatedMinutes: 2,
  resultCopyVersion: 1,
  available: true,
  questions: GUT_QUESTIONS_V1,
});

const DEFINITIONS = Object.freeze({
  INITIAL: Object.freeze({
    assessmentDefinitionId: "local-initial-v1",
    assessmentType: "INITIAL",
    questionnaireId: "ROOT4U_INITIAL_PROFILE",
    questionnaireVersion: 1,
    title: "健康起点评测",
    description: "用 12 个问题建立你的生活方式观察起点。",
    estimatedMinutes: 5,
    resultCopyVersion: 1,
    available: true,
    questions: INITIAL_QUESTIONS,
  }),
  GUT_REGULARITY: Object.freeze({
    assessmentDefinitionId: "local-gut-5q-v2",
    assessmentType: "GUT_REGULARITY",
    questionnaireId: "ROOT_GUT_5Q",
    questionnaireVersion: 2,
    title: "肠道健康 5 道题自测",
    description: "用 5 个问题记录近期排便、肠胃感受与生活习惯。",
    estimatedMinutes: 2,
    resultCopyVersion: 5,
    available: true,
    questions: GUT_QUESTIONS,
  }),
});

const CATEGORY_CONTENT = Object.freeze({
  BASELINE: ["基础状态维护型", ["保持相对固定的起床和进餐时间。", "每天选择一个容易坚持的身体记录。", "连续观察一周，再判断是否需要调整。"]],
  BOWEL: ["肠道规律关注型", ["先固定每天观察排便的时间和形态。", "逐步增加饮水，避免一次性大量补水。", "每餐为蔬菜、全谷物或豆类留出位置。"]],
  DIGESTION: ["腹胀反酸关注型", ["用餐放慢一些，并留意最容易出现不适的时段。", "避免临睡前的大量进食和饮酒。", "先记录食物与感受的关系，不急于自行删掉多类食物。"]],
  SLEEP: ["睡眠节律关注型", ["先固定起床时间，再逐步调整入睡时间。", "睡前一小时减少工作和高刺激屏幕内容。", "白天安排轻活动，并记录醒来后的精神状态。"]],
  ENERGY: ["压力活力关注型", ["把一天中最耗能的时段记录下来。", "在连续工作之间安排短暂走动或呼吸停顿。", "优先保证规律进餐和基本睡眠，不同时增加太多目标。"]],
  LIFESTYLE: ["活动饮食调整型", ["从每天增加一次十分钟走动开始。", "先让一餐更接近蔬菜、蛋白质和主食的组合。", "用可重复的小变化替代一次性的严格计划。"]],
  VARIABLE: ["生活方式波动型", ["先记录一周作息、饮食和感受的波动。", "每次只调整一个最容易执行的习惯。", "用稳定的观察替代对单日状态的判断。"]],
});

const GUT_RESULTS = Object.freeze({
  CONSTIPATION: {
    title: "肠道的节奏慢了些",
    summary: "你的近期记录中出现了排便间隔较长、便便偏干硬或排便费力中的一种或多种情况。可以从饮食、饮水和日常活动三个容易执行的方向开始观察。",
    priorityAction: "逐步增加蔬菜、全谷物和豆类，不要一次加太多。\n白天少量多次饮水，留意自己的实际耐受。\n饭后安排 5–10 分钟轻松走动。",
  },
  LOOSE: {
    title: "肠道的节奏快了些",
    summary: "你的近期记录中出现了便便偏稀、排便次数偏多或便急中的一种或多种情况。先减少刺激、保持规律并观察变化。",
    priorityAction: "近期减少辛辣、油腻和生冷食物。\n注意补充水分；如有明显不适，请及时咨询专业人士。\n尽量保持固定的进餐和休息时间。",
  },
  ALTERNATING: {
    title: "肠道的节奏有点乱",
    summary: "你的近期记录显示排便频率或便便形态不太稳定，可能在不同日期出现偏少、偏多、偏硬或偏稀等变化。先找出变化规律，再从一个小习惯开始调整。",
    priorityAction: "记录几天排便时间、形态和饮食，寻找变化规律。\n尽量固定起床和进餐时间。\n每次只调整一个习惯，连续观察后再判断。",
  },
  SENSITIVE: {
    title: "肠道有些敏感",
    summary: "你的近期记录中出现了腹胀、腹痛、反酸、餐后不适等感受，或你观察到压力、饮食和环境变化与肠胃不适同时出现。温和观察，比一次改变很多更重要。",
    priorityAction: "吃饭时放慢速度，留意餐后感受。\n记录可能引起不适的食物或情境。\n减少刺激性饮食，并保持规律作息。",
  },
  HEALTHY: {
    title: "肠道节奏挺稳，值得继续保持",
    summary: "你的近期记录显示排便频率和便便形态较为稳定，也没有记录到明显的肠胃不适。日常养护的重点，是让容易坚持的好习惯继续发生。",
    priorityAction: "继续保持规律饮食和充足饮水。\n保持相对固定的起床和进餐时间。\n每周记录一次排便形态与身体感受。",
  },
});

const REQUIRED_GUT_PRIORITY_ACTIONS = Object.freeze({
  CONSTIPATION: "补充益生元纤维，帮助软化便便促蠕动",
  LOOSE: "补充可溶性纤维，帮助吸水让便便成形",
  ALTERNATING: "补充益生元纤维，双向调节排便节奏",
  SENSITIVE: "补充低FODMAP益生元，温和滋养不胀气",
  HEALTHY: "日常补充益生元，持续滋养肠道有益菌",
});

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function nowISO() {
  return new Date().toISOString();
}

function hashText(value) {
  let hash = 2166136261;
  const source = String(value || "");
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function installationScope() {
  const existing = String(wx.getStorageSync(INSTALLATION_SCOPE_KEY) || "").trim();
  if (existing) return existing;
  const value = `install-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  wx.setStorageSync(INSTALLATION_SCOPE_KEY, value);
  return value;
}

function userScope() {
  const explicit = String(wx.getStorageSync(USER_SCOPE_KEY) || "").trim();
  if (explicit) return explicit.startsWith("user:") ? explicit : `user:${explicit}`;
  return `guest:${installationScope()}`;
}

function readState() {
  try {
    return cleanupExpiredLocalHealthData(wx).state;
  } catch (error) {
    const wrapped = new Error("本机评测记录读取或清理失败，请检查小程序存储空间");
    wrapped.code = "LOCAL_ASSESSMENT_STORAGE_FAILED";
    throw wrapped;
  }
}

function writeState(state) {
  try {
    wx.setStorageSync(STORAGE_KEY, state);
  } catch (error) {
    const wrapped = new Error("本机评测记录保存失败，请检查小程序存储空间");
    wrapped.code = "LOCAL_ASSESSMENT_STORAGE_FAILED";
    throw wrapped;
  }
}

function mergeAttempts(left = [], right = []) {
  const merged = new Map();
  [...left, ...right].forEach((attempt) => {
    const key = String(attempt && attempt.assessmentId || "");
    if (!key) return;
    const existing = merged.get(key);
    if (!existing || String(attempt.updatedAt || "") >= String(existing.updatedAt || "")) {
      merged.set(key, attempt);
    }
  });
  return [...merged.values()];
}

function adoptLegacyScope(state, scope) {
  if (state.users[scope]) return false;
  const token = String(wx.getStorageSync("ROOT_TOKEN") || "");
  const legacyScopes = token ? [`token:${hashText(token)}`, "guest"] : ["guest"];
  const legacyScope = legacyScopes.find((candidate) => state.users[candidate]);
  if (!legacyScope) return false;
  state.users[scope] = state.users[legacyScope];
  delete state.users[legacyScope];
  return true;
}

function bindUserScope(userId) {
  const normalized = String(userId || "").trim().slice(0, 128);
  if (!normalized) return { bound: false, reason: "USER_ID_MISSING" };
  const previousScope = userScope();
  const targetScope = `user:${normalized}`;
  if (previousScope === targetScope) return { bound: true, migrated: false };
  const original = readState();
  const next = clone(original);
  adoptLegacyScope(next, previousScope);
  const previous = next.users[previousScope] || { attempts: [] };
  const target = next.users[targetScope] || { attempts: [] };
  next.users[targetScope] = {
    ...target,
    attempts: mergeAttempts(target.attempts, previous.attempts),
  };
  delete next.users[previousScope];
  writeState(next);
  try {
    wx.setStorageSync(USER_SCOPE_KEY, targetScope);
  } catch (error) {
    writeState(original);
    throw error;
  }
  return { bound: true, migrated: (previous.attempts || []).length > 0 };
}

function unbindUserScope() {
  wx.removeStorageSync(USER_SCOPE_KEY);
}

function mutateUser(callback) {
  const state = readState();
  const scope = userScope();
  adoptLegacyScope(state, scope);
  if (!state.users[scope]) state.users[scope] = { attempts: [] };
  const result = callback(state.users[scope]);
  writeState(state);
  return result;
}

function readUser() {
  const state = readState();
  const scope = userScope();
  if (adoptLegacyScope(state, scope)) writeState(state);
  return clone(state.users[scope] || { attempts: [] });
}

function definitionForType(type) {
  return DEFINITIONS[String(type || "").toUpperCase()] || null;
}

function definitionForAttempt(attempt) {
  if (attempt && attempt.assessmentType === "GUT_REGULARITY" && Number(attempt.questionnaireVersion) === 1) {
    return GUT_DEFINITION_V1;
  }
  return definitionForType(attempt && attempt.assessmentType);
}

function publicAttempt(attempt, includeDraft = false) {
  if (!attempt) return null;
  const payload = clone(attempt);
  if (!includeDraft || payload.status !== "IN_PROGRESS") {
    delete payload.answers;
    delete payload.definition;
  } else {
    payload.definition = clone(definitionForAttempt(attempt));
  }
  return payload;
}

function completedAttempts(user, type = "") {
  return (user.attempts || [])
    .filter((item) => COMPLETED_STATUSES.has(item.status) && (!type || item.assessmentType === type))
    .sort((left, right) => String(right.completedAt || right.updatedAt).localeCompare(String(left.completedAt || left.updatedAt)));
}

function catalog() {
  const user = readUser();
  return {
    assessments: Object.values(DEFINITIONS).map((definition) => {
      const history = completedAttempts(user, definition.assessmentType);
      const inProgress = (user.attempts || []).find((item) => (
        item.assessmentType === definition.assessmentType
        && item.questionnaireId === definition.questionnaireId
        && Number(item.questionnaireVersion) === Number(definition.questionnaireVersion)
        && item.status === "IN_PROGRESS"
      ));
      return {
        assessmentType: definition.assessmentType,
        definition: clone(definition),
        available: true,
        unavailableReason: "",
        historyCount: history.length,
        latest: history[0] ? publicAttempt(history[0]) : null,
        inProgress: inProgress ? publicAttempt(inProgress) : null,
        canResume: Boolean(inProgress),
        canRetest: history.length > 0,
      };
    }),
    storageMode: "LOCAL_DEVICE",
  };
}

function createAssessmentId() {
  return `local-has-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function start(assessmentType) {
  const definition = definitionForType(assessmentType);
  if (!definition) throw new Error("评测类型不存在");
  return mutateUser((user) => {
    const existing = (user.attempts || []).find((item) => (
      item.assessmentType === definition.assessmentType
      && item.questionnaireId === definition.questionnaireId
      && Number(item.questionnaireVersion) === Number(definition.questionnaireVersion)
      && item.status === "IN_PROGRESS"
    ));
    if (existing) return { assessment: publicAttempt(existing, true), created: false };
    const now = nowISO();
    const attempt = {
      assessmentId: createAssessmentId(),
      assessmentType: definition.assessmentType,
      questionnaireId: definition.questionnaireId,
      questionnaireVersion: definition.questionnaireVersion,
      status: "IN_PROGRESS",
      safetyState: "NONE",
      isRetest: completedAttempts(user, definition.assessmentType).length > 0,
      answers: {},
      dimensions: [],
      result: null,
      resultCopyVersion: definition.resultCopyVersion,
      startedAt: now,
      completedAt: "",
      updatedAt: now,
    };
    if (!Array.isArray(user.attempts)) user.attempts = [];
    user.attempts.push(attempt);
    return { assessment: publicAttempt(attempt, true), created: true };
  });
}

function ownedAttempt(user, assessmentId) {
  const attempt = (user.attempts || []).find((item) => item.assessmentId === String(assessmentId || ""));
  if (!attempt) {
    const error = new Error("评测记录不存在");
    error.code = "LOCAL_ASSESSMENT_NOT_FOUND";
    throw error;
  }
  return attempt;
}

function get(assessmentId) {
  const user = readUser();
  const attempt = ownedAttempt(user, assessmentId);
  return { assessment: publicAttempt(attempt, true), storageMode: "LOCAL_DEVICE" };
}

function validateAnswers(definition, source, complete = false) {
  const answers = pruneHiddenAnswers(definition.questions, source || {});
  const visible = visibleQuestions(definition.questions, answers);
  visible.forEach((question) => {
    const value = answers[question.field];
    if (complete && question.required !== false && missingAnswer(value)) {
      throw new Error(`请完成：${question.title}`);
    }
    if (missingAnswer(value)) return;
    const allowed = new Map((question.options || []).map((item) => [item.value, item]));
    if (question.type === "multi") {
      if (!Array.isArray(value) || value.some((item) => !allowed.has(item))) throw new Error(`请重新选择：${question.title}`);
      if (value.some((item) => allowed.get(item).exclusive) && value.length > 1) throw new Error(`请重新选择：${question.title}`);
      return;
    }
    if (!allowed.has(value)) throw new Error(`请重新选择：${question.title}`);
  });
  return answers;
}

function safetyTriggered(type, answers) {
  if (type === "GUT_REGULARITY") return false;
  const safety = Array.isArray(answers.safety) ? answers.safety : [];
  return safety.length > 0 && !(safety.length === 1 && safety[0] === "none");
}

function saveDraft(assessmentId, answers) {
  return mutateUser((user) => {
    const attempt = ownedAttempt(user, assessmentId);
    if (attempt.status !== "IN_PROGRESS") throw new Error("已完成的评测不能修改");
    const definition = definitionForAttempt(attempt);
    attempt.answers = validateAnswers(definition, answers, false);
    attempt.updatedAt = nowISO();
    return {
      assessment: publicAttempt(attempt, true),
      safetyTriggered: safetyTriggered(attempt.assessmentType, attempt.answers),
      storageMode: "LOCAL_DEVICE",
    };
  });
}

function selected(answers, field, value) {
  const actual = answers[field];
  return Array.isArray(actual) ? actual.includes(value) : actual === value;
}

function selectedCount(answers, field, excluded = []) {
  const actual = Array.isArray(answers[field]) ? answers[field] : [];
  return actual.filter((value) => !excluded.includes(value)).length;
}

function initialSafetyResult(answers) {
  const selectedSignals = Array.isArray(answers.safety) ? answers.safety : [];
  const urgent = selectedSignals.includes("self_harm");
  const prompt = ["recent_acute", "blood_stool", "acute_digestive", "weight_loss"]
    .some((signal) => selectedSignals.includes(signal));
  const tips = urgent
    ? ["如存在立即危险，请联系当地紧急支持或尽快前往医疗机构。", "请尽快告诉一位你信任的人，并尽量不要独自面对。", "不要因为本次问卷延迟寻求专业帮助。"]
    : prompt
      ? ["如相关情况正在持续、加重或令你担心，请尽快咨询专业人士。", "在获得专业建议前，避免自行进行幅度较大的饮食或运动调整。", "不要因为本次问卷延迟寻求专业帮助。"]
      : ["建议先向了解你当前情况的专业人士确认适合的生活方式调整。", "在获得明确建议前，先保持日常记录，不急于增加新的严格计划。", "本次结果仅作状态提示，不替代专业判断。"];
  return {
    result: {
      resultCode: "SAFETY_GUIDANCE",
      title: "这次不继续生成普通生活方式建议",
      summary: "你的回答提示应优先获得专业支持，再决定是否调整饮食、运动或补充计划。",
      priorityAction: tips.join("\n"),
      riskNotice: "本次结果仅作状态提示，不替代专业判断。",
      retestAdvice: "如情况已由专业人士确认并允许继续，可在之后重新评测。",
      copyVersion: 1,
    },
    dimensions: [],
    status: "SAFETY_STOPPED",
    safetyState: urgent ? "URGENT" : (prompt ? "PROMPT" : "PROFESSIONAL_REVIEW"),
  };
}

function initialResult(answers) {
  if (safetyTriggered("INITIAL", answers)) return initialSafetyResult(answers);
  const scores = { BASELINE: 0, BOWEL: 0, DIGESTION: 0, SLEEP: 0, ENERGY: 0, LIFESTYLE: 0, VARIABLE: 0 };
  const primary = { bowel: "BOWEL", digestion: "DIGESTION", sleep: "SLEEP", energy: "ENERGY", lifestyle: "LIFESTYLE", observe: "BASELINE" }[answers.primary_goal] || "BASELINE";
  scores[primary] += 6;
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
  const order = [primary, "BOWEL", "DIGESTION", "SLEEP", "ENERGY", "LIFESTYLE", "VARIABLE", "BASELINE"];
  const category = order.reduce((best, candidate) => scores[candidate] > scores[best] ? candidate : best, order[0]);
  const tags = [];
  if (selected(answers, "hydration", "low_water")) tags.push("饮水偏少");
  if (["under_5", "5_6", "irregular"].includes(answers.sleep_duration)) tags.push("睡眠不足或不规律");
  if (["sedentary", "exercise_sedentary"].includes(answers.activity)) tags.push("久坐偏高");
  if (selected(answers, "diet", "irregular")) tags.push("进餐节律波动");
  if (selected(answers, "stress_energy", "fatigue")) tags.push("精力偏低");
  const content = CATEGORY_CONTENT[category] || CATEGORY_CONTENT.BASELINE;
  const labels = { BOWEL: "肠道规律", DIGESTION: "消化感受", SLEEP: "睡眠节律", ENERGY: "压力活力", LIFESTYLE: "活动饮食", VARIABLE: "生活波动", BASELINE: "基础状态" };
  return {
    result: {
      resultCode: category,
      title: content[0],
      summary: tags.length ? `本次主要关注方向为${content[0]}；同时记录到：${tags.slice(0, 3).join("、")}。` : `本次主要关注方向为${content[0]}。`,
      priorityAction: content[1].join("\n"),
      riskNotice: "结果用于日常生活方式观察，不构成医疗诊断或治疗建议。",
      retestAdvice: "建议连续观察一段时间后使用同一版本重新评测，查看两次记录的差异。",
      copyVersion: 1,
    },
    dimensions: Object.entries(scores)
      .filter(([key]) => key !== "BASELINE")
      .map(([key, score]) => ({ key, label: labels[key] || key, score, unit: "分", direction: "NEUTRAL" })),
    status: "COMPLETED",
    safetyState: "NONE",
  };
}

function gutResultCode(answers) {
  const q3 = Array.isArray(answers.Q3) ? answers.Q3 : [];
  const q4 = Array.isArray(answers.Q4) ? answers.Q4 : [];
  const constipation = ["B", "C"].includes(answers.Q1) || answers.Q2 === "A" || q3.includes("G");
  const loose = answers.Q1 === "D" || answers.Q2 === "D" || q3.includes("H");
  const alternating = answers.Q1 === "E" || answers.Q2 === "E" || (constipation && loose);
  const sensitive = q3.some((value) => ["B", "C", "D", "E", "F", "I"].includes(value))
    || q4.some((value) => ["B", "C", "D", "E"].includes(value));
  if (alternating) return "ALTERNATING";
  if (constipation && !loose) return "CONSTIPATION";
  if (loose && !constipation) return "LOOSE";
  if (sensitive) return "SENSITIVE";
  return "HEALTHY";
}

function gutPersonalizedAdvice(answers) {
  const q3 = Array.isArray(answers.Q3) ? answers.Q3 : [];
  const q4 = Array.isArray(answers.Q4) ? answers.Q4 : [];
  const q5 = Array.isArray(answers.Q5) ? answers.Q5 : [];
  const advice = [];
  if (q4.includes("B")) advice.push("压力明显时，给自己留几分钟散步或放松呼吸。 ");
  if (q4.includes("C") || q5.includes("G")) advice.push("进餐时间波动较大时，先固定一天中的一餐。 ");
  if (q4.includes("E")) advice.push("季节变化或受凉时，注意腹部保暖。 ");
  if (q5.includes("E")) advice.push("可以把饮水拆成多次完成，避免一次喝很多。 ");
  if (q5.includes("D") || q5.includes("F")) advice.push("减少加工食品或含糖饮料，并观察身体感受。 ");
  if (q3.includes("C")) advice.push("如腹痛持续、加重或伴随异常信号，请及时咨询专业人士。 ");
  return advice.slice(0, 2).map((item) => item.trim());
}

function gutResult(answers) {
  const code = gutResultCode(answers);
  const copy = GUT_RESULTS[code];
  const requiredPriorityAction = REQUIRED_GUT_PRIORITY_ACTIONS[code];
  const personalized = gutPersonalizedAdvice(answers);
  return {
    result: {
      resultCode: code,
      ...copy,
      priorityAction: [requiredPriorityAction, copy.priorityAction, ...personalized].filter(Boolean).join("\n"),
      retestAdvice: "如近期排便状态或生活习惯发生变化，可重新自测并保留本机历史。",
      riskNotice: "以上建议仅供日常健康管理参考，不能作为临床诊断依据。膳食纤维请结合自身耐受和产品说明使用；如正在服药或有持续腹泻、便血或黑便、非刻意体重明显下降、夜间腹痛腹泻痛醒等情况，建议优先咨询专业人士。",
      copyVersion: 5,
    },
    dimensions: [],
    status: "COMPLETED",
    safetyState: "NONE",
  };
}

function complete(assessmentId, answers) {
  return mutateUser((user) => {
    const attempt = ownedAttempt(user, assessmentId);
    if (COMPLETED_STATUSES.has(attempt.status)) return { assessment: publicAttempt(attempt), created: false };
    const definition = definitionForAttempt(attempt);
    const normalized = validateAnswers(definition, answers, !safetyTriggered(attempt.assessmentType, answers));
    const outcome = attempt.assessmentType === "GUT_REGULARITY" ? gutResult(normalized) : initialResult(normalized);
    const now = nowISO();
    attempt.answers = normalized;
    attempt.status = outcome.status;
    attempt.safetyState = outcome.safetyState;
    attempt.result = outcome.result;
    attempt.dimensions = outcome.dimensions;
    attempt.completedAt = now;
    attempt.updatedAt = now;
    return { assessment: publicAttempt(attempt), created: true, storageMode: "LOCAL_DEVICE" };
  });
}

function history(assessmentType = "") {
  const type = String(assessmentType || "").toUpperCase();
  const rows = completedAttempts(readUser(), type).map((item) => publicAttempt(item));
  return { assessments: rows, total: rows.length, storageMode: "LOCAL_DEVICE" };
}

function compare(leftAssessmentId, rightAssessmentId) {
  const user = readUser();
  const requested = [ownedAttempt(user, leftAssessmentId), ownedAttempt(user, rightAssessmentId)];
  const ordered = requested.sort((left, right) => String(left.completedAt || left.updatedAt).localeCompare(String(right.completedAt || right.updatedAt)));
  const [left, right] = ordered;
  const base = { left: publicAttempt(left), right: publicAttempt(right), dimensions: [] };
  if (left.assessmentId === right.assessmentId) return { ...base, comparable: false, reason: "SAME_ASSESSMENT" };
  if (!COMPLETED_STATUSES.has(left.status) || !COMPLETED_STATUSES.has(right.status)) return { ...base, comparable: false, reason: "ASSESSMENT_NOT_COMPLETED" };
  if (left.questionnaireId !== right.questionnaireId || left.questionnaireVersion !== right.questionnaireVersion) return { ...base, comparable: false, reason: "QUESTIONNAIRE_VERSION_MISMATCH" };
  if (left.status === "SAFETY_STOPPED" || right.status === "SAFETY_STOPPED") return { ...base, comparable: false, reason: "SAFETY_RESULT_NOT_COMPARABLE" };
  const leftMap = new Map((left.dimensions || []).map((item) => [item.key, item]));
  const rightMap = new Map((right.dimensions || []).map((item) => [item.key, item]));
  const keys = [...leftMap.keys()].filter((key) => rightMap.has(key));
  if (!keys.length) return { ...base, comparable: false, reason: "NO_SHARED_DIMENSIONS" };
  return {
    ...base,
    comparable: true,
    reason: "",
    dimensions: keys.map((key) => ({
      key,
      label: rightMap.get(key).label || leftMap.get(key).label,
      beforeScore: leftMap.get(key).score,
      afterScore: rightMap.get(key).score,
      delta: rightMap.get(key).score - leftMap.get(key).score,
      unit: rightMap.get(key).unit || leftMap.get(key).unit,
      direction: "NEUTRAL",
    })),
    notice: "差异仅用于同版问卷的近期状态观察，不代表疾病变化或干预疗效。",
  };
}

module.exports = Object.freeze({
  DEFINITIONS,
  INSTALLATION_SCOPE_KEY,
  LOCAL_HEALTH_RETENTION_DAYS,
  STORAGE_KEY,
  USER_SCOPE_KEY,
  bindUserScope,
  catalog,
  compare,
  complete,
  get,
  history,
  saveDraft,
  start,
  unbindUserScope,
  validateAnswers,
});
