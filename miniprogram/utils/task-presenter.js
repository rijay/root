function todayChina() {
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}

function statusLabel(status) {
  return {
    DONE: "已完成",
    IN_PROGRESS: "进行中",
    NOT_STARTED: "待完成",
  }[status] || "待确认";
}

function statusClass(status) {
  return {
    DONE: "done",
    IN_PROGRESS: "active",
    NOT_STARTED: "pending",
  }[status] || "pending";
}

function taskActionLabel(task) {
  if (!task) return "查看";
  if (task.status === "DONE") return "已完成";
  if (task.taskType === "CHECKIN") return "去打卡";
  if (task.taskType === "QUESTIONNAIRE") return "填问卷";
  if (task.taskType === "SHARE") return "去分享";
  if (task.taskType === "CONSULTATION") return "去咨询";
  if (task.taskType === "PURCHASE") return "看商品";
  return "继续";
}

function taskTypeLabel(taskType) {
  return {
    CHECKIN: "打卡",
    QUESTIONNAIRE: "问卷",
    SHARE: "分享",
    CONSULTATION: "咨询",
    PURCHASE: "购买",
  }[taskType] || "任务";
}

function enrichTask(task) {
  return {
    ...task,
    statusLabel: statusLabel(task.status),
    statusClass: statusClass(task.status),
    actionLabel: taskActionLabel(task),
    actionDisabled: task.status === "DONE",
    typeLabel: taskTypeLabel(task.taskType),
    progressText: `${task.completedCount || 0}/${task.targetCount || 1}`,
  };
}

function enrichProgress(progress) {
  const tasks = (progress && progress.tasks ? progress.tasks : []).map(enrichTask);
  const summary = progress && progress.summary ? progress.summary : {};
  return {
    ...progress,
    tasks,
    summary: {
      ...summary,
      progressPercent: summary.progressPercent || 0,
    },
  };
}

module.exports = {
  enrichProgress,
  enrichTask,
  statusClass,
  statusLabel,
  taskActionLabel,
  taskTypeLabel,
  todayChina,
};
