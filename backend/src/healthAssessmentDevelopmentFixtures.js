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


module.exports = Object.freeze({ DEFINITIONS });
