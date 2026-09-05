const FILTERS = [
  { key: "ALL", label: "全部" },
  { key: "INITIAL", label: "初始评测" },
  { key: "GUT_REGULARITY", label: "肠道自测" },
];

function timestamp(value) {
  const parsed = new Date(value || "").getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortNewestFirst(rows = []) {
  return rows
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const timeDelta = timestamp(right.item.completedAt) - timestamp(left.item.completedAt);
      return timeDelta || left.index - right.index;
    })
    .map(({ item }) => item);
}

function sortOldestFirst(rows = []) {
  return sortNewestFirst(rows).reverse();
}

function questionnaireKey(row = {}) {
  if (!row.questionnaireId || !Number(row.questionnaireVersion)) return "";
  return `${row.questionnaireId}::${Number(row.questionnaireVersion)}`;
}

function sharedDimensionKeys(left = {}, right = {}) {
  const leftKeys = new Set((left.dimensions || []).map((item) => item.key).filter(Boolean));
  return (right.dimensions || []).map((item) => item.key).filter((key) => leftKeys.has(key));
}

function pairComparable(left = {}, right = {}) {
  return Boolean(
    left.assessmentId
    && right.assessmentId
    && left.assessmentId !== right.assessmentId
    && left.status === "COMPLETED"
    && right.status === "COMPLETED"
    && questionnaireKey(left)
    && questionnaireKey(left) === questionnaireKey(right)
    && sharedDimensionKeys(left, right).length,
  );
}

function recentComparablePair(rows = []) {
  const sorted = sortNewestFirst(rows);
  for (let recentIndex = 0; recentIndex < sorted.length; recentIndex += 1) {
    for (let earlierIndex = recentIndex + 1; earlierIndex < sorted.length; earlierIndex += 1) {
      if (pairComparable(sorted[earlierIndex], sorted[recentIndex])) {
        return [sorted[earlierIndex], sorted[recentIndex]];
      }
    }
  }
  return [];
}

function retainSelection(rows = [], selectedIds = []) {
  const available = new Set(rows.map((item) => item.assessmentId));
  return [...new Set(selectedIds)].filter((id) => available.has(id)).slice(0, 2);
}

function toggleSelection(selectedIds = [], assessmentId = "") {
  if (!assessmentId) return { selectedIds: [...selectedIds], rejected: false };
  const next = [...selectedIds];
  const index = next.indexOf(assessmentId);
  if (index >= 0) {
    next.splice(index, 1);
    return { selectedIds: next, rejected: false };
  }
  if (next.length >= 2) return { selectedIds: next, rejected: true };
  next.push(assessmentId);
  return { selectedIds: next, rejected: false };
}

function selectedRows(rows = [], selectedIds = []) {
  const selected = new Set(selectedIds);
  return sortOldestFirst(rows.filter((item) => selected.has(item.assessmentId)));
}

function buildHistoryView(rows = [], activeFilter = "ALL", selectedIds = []) {
  const sorted = sortNewestFirst(rows);
  const retained = retainSelection(sorted, selectedIds);
  const visible = sorted
    .filter((item) => activeFilter === "ALL" || item.assessmentType === activeFilter)
    .map((item) => ({ ...item, selected: retained.includes(item.assessmentId) }));
  const recentPair = recentComparablePair(sorted);
  return {
    assessments: sorted.map((item) => ({ ...item, selected: retained.includes(item.assessmentId) })),
    visibleAssessments: visible,
    selectedIds: retained,
    recentPairIds: recentPair.map((item) => item.assessmentId),
    recentPairText: recentPair.length === 2
      ? `${recentPair[0].typeLabel} · ${recentPair[0].versionText}`
      : "暂无可进行数值对比的同版记录",
  };
}

module.exports = {
  FILTERS,
  buildHistoryView,
  pairComparable,
  questionnaireKey,
  recentComparablePair,
  retainSelection,
  selectedRows,
  sortNewestFirst,
  toggleSelection,
};
