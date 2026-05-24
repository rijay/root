function isDailyNarrative(state) {
  return state === "DAILY_USER";
}

function getTodayPageCopy(mode, session) {
  if (mode === "daily") {
    return {
      eyebrow: "今日记录",
      title: "今天，和身体对一次话",
      description: "继续记录身体反馈，让变化慢慢被看见。",
    };
  }
  return {
    eyebrow: `第 ${session && session.currentDayIndex ? session.currentDayIndex : 1} 天`,
    title: "今天，和身体对一次话",
    description: "无需完美，真实记录即可。每一条真实反馈，都会帮助 ROOT 更好地理解你的身体节奏。",
  };
}

function getHomeStageCopy(state, flowView, session, dailyStats) {
  if (state === "DAILY_USER") {
    return {
      eyebrow: "今日身体记录",
      title: "今天，也记录身体反馈",
      description: "继续记录服用、排便与真实感受。身体的变化，值得被慢慢看见。",
      primaryText: dailyStats && dailyStats.todayChecked ? "查看今日记录" : "记录今天",
    };
  }
  if (state === "CHECKIN_COMPLETED" && flowView !== "DAY8_PENDING") {
    return {
      eyebrow: "试饮记录已完成",
      title: "完成试饮记录",
      description: "收尾反馈和免单状态会继续保留，你也可以进入日常记录。",
      primaryText: "继续日常记录",
    };
  }
  return {
    eyebrow: `第 ${session && session.currentDayIndex ? session.currentDayIndex : 1} 天 / 7`,
    title: "身体秩序恢复中",
    description: "今天记录服用、排便与身体反馈，约 1 分钟。",
    primaryText: session && session.todayChecked ? "查看今日记录" : "开始今日打卡",
  };
}

function getResultPageCopy(mode, context = {}) {
  if (context.failed) {
    return {
      kicker: "人工协助",
      title: "需要人工协助",
      description: "当前记录需要 ROOT 顾问协助确认，先不要继续生成分享图。",
    };
  }
  if (mode === "daily") {
    return {
      kicker: "今日记录",
      title: "今天已记录",
      description: "真实反馈已保存。你可以生成一张今日分享图，也可以回到首页。",
    };
  }
  return {
    kicker: "试饮记录",
    title: "秩序已记录",
    description: `你已经完成 ${context.completedDays || 0}/7 天记录。真实反馈会成为下一步建议的依据。`,
  };
}

module.exports = {
  getHomeStageCopy,
  getResultPageCopy,
  getTodayPageCopy,
  isDailyNarrative,
};
