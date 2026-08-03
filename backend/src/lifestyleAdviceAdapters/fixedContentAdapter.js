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

const SAFETY_CONTENT = Object.freeze({
  URGENT_SUPPORT: [
    "如存在立即危险，请联系当地紧急支持或尽快前往医疗机构。",
    "请尽快告诉一位你信任的人，并尽量不要独自面对。",
    "不要因为本次问卷延迟寻求专业帮助。",
  ],
  PROMPT_SUPPORT: [
    "如相关情况正在持续、加重或令你担心，请尽快咨询专业人士。",
    "在获得专业建议前，避免自行进行幅度较大的饮食或运动调整。",
    "不要因为本次问卷延迟寻求专业帮助。",
  ],
  PROFESSIONAL_REVIEW: [
    "建议先向了解你当前情况的专业人士确认适合的生活方式调整。",
    "在获得明确建议前，先保持日常记录，不急于增加新的严格计划。",
    "本次结果仅作状态提示，不替代专业判断。",
  ],
});

function createFixedContentAdapter() {
  return Object.freeze({
    adapterId: "ROOT4U_FIXED_CONTENT_V1",
    generateStandardAdvice({ categoryCode, tags = [] }) {
      const content = CATEGORY_CONTENT[categoryCode] || CATEGORY_CONTENT.BASELINE;
      return {
        safetyStatus: "STANDARD_GUIDANCE",
        categoryCode: CATEGORY_CONTENT[categoryCode] ? categoryCode : "BASELINE",
        categoryTitle: content.title,
        tags: tags.slice(0, 3),
        tips: content.tips.slice(0, 3),
        recommendations: content.recommendations.map((title) => ({ title, availability: "COMING_SOON" })),
        adviceSource: "FIXED_CONTENT",
        adviceVersion: 1,
      };
    },
    getSafetyGuidance(safety) {
      const tips = SAFETY_CONTENT[safety.guidanceKey] || SAFETY_CONTENT.PROFESSIONAL_REVIEW;
      return {
        safetyStatus: "PROFESSIONAL_SUPPORT_RECOMMENDED",
        categoryCode: "SAFETY_GUIDANCE",
        categoryTitle: "这次不继续生成普通生活方式建议",
        tags: [],
        tips: tips.slice(0, 3),
        recommendations: [],
        adviceSource: "FIXED_SAFETY_CONTENT",
        adviceVersion: 1,
      };
    },
  });
}

module.exports = {
  createFixedContentAdapter,
};
