const crypto = require("node:crypto");
const userLabels = require("./userLabels");
const { createClientError } = require("./clientError");

// Health answers, classification and completion status are deliberately absent.
// The current user-facing consent explicitly excludes external health-data transfer.
const FIELD_SPEC = Object.freeze([
  ["用户ID", 1], ["首次可识别访问日期", 5],
  ["来源活动", 3], ["来源城市", 3], ["合作方/渠道", 3], ["渠道类型", 3],
  ["用户类型", 3], ["是否下单1元体验装", 3], ["是否添加企业微信", 3], ["是否复购正装", 3],
  ["标签备注", 1], ["来源依据", 1], ["来源核验状态", 1], ["系统来源建议", 1], ["数据更新时间", 5],
]);
const SOURCE_FIELDS = ["来源活动", "来源城市", "合作方/渠道", "渠道类型"];
const MANUAL_DEFAULTS = Object.freeze({ 用户类型: "待确认", 是否下单1元体验装: "待核验", 是否添加企业微信: "待核验", 是否复购正装: "待观察" });
const digest = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const list = (data, key) => Array.isArray(data[key]) ? data[key] : [];
const fail = (code, message, status = 409) => { throw createClientError(code, message, status); };
function cell(value) {
  if (value == null) return null;
  if (Array.isArray(value)) return value.map((r) => typeof r === "object" ? r.text || "" : r).join("");
  return value;
}

function createFeishuLabelAdapter(env = {}, options = {}) {
  const appToken = String(env.ROOT_LABEL_FEISHU_APP_TOKEN || "").trim();
  const tableId = String(env.ROOT_LABEL_FEISHU_TABLE_ID || "").trim();
  const token = String(env.ROOT_LABEL_FEISHU_ACCESS_TOKEN || "").trim();
  const configured = /^[A-Za-z0-9]{5,100}$/.test(appToken) && /^tbl[A-Za-z0-9]{3,80}$/.test(tableId) && Boolean(token);
  const targetKey = digest([appToken, tableId]).slice(0, 32);
  const base = `https://open.feishu.cn/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}`;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  async function request(path, method = "GET", body) {
    if (!configured) fail("LABEL_FEISHU_NOT_CONFIGURED", "尚未配置飞书目标表和应用凭据");
    let response;
    try {
      response = await fetchImpl(`${base}${path}`, { method, redirect: "error", signal: AbortSignal.timeout(10000),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}) });
      const payload = await response.json();
      if (!response.ok || payload.code !== 0 || !payload.data) throw new Error("FAILED");
      return payload.data;
    } catch { fail("LABEL_FEISHU_REQUEST_FAILED", "飞书请求未确认成功，请检查目标表权限及凭据；写入结果需回读核验", 502); }
  }
  async function pages(resource, fieldNames = []) {
    const rows = [], seen = new Set();
    let pageToken = "";
    for (let page = 0; page < 1000; page += 1) {
      const search = resource === "records";
      const data = await request(`/${search ? "records/search" : resource}?page_size=100${pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ""}`,
        search ? "POST" : "GET", search ? { field_names: fieldNames, automatic_fields: false } : undefined);
      if (!Array.isArray(data.items) || typeof data.has_more !== "boolean") fail("LABEL_FEISHU_RESPONSE_INVALID", "飞书分页结果不完整", 502);
      rows.push(...data.items);
      if (!data.has_more) return rows;
      if (!data.page_token || seen.has(data.page_token)) fail("LABEL_FEISHU_PAGINATION_INVALID", "飞书分页不完整，已停止同步", 502);
      seen.add(data.page_token); pageToken = data.page_token;
    }
    fail("LABEL_FEISHU_PAGE_LIMIT", "目标表超过本次同步读取范围", 502);
  }
  return {
    configured, targetKey, writesEnabled: env.ROOT_LABEL_FEISHU_WRITE_ENABLED === "true",
    async read() {
      const fields = await pages("fields");
      const availableNames = new Set(fields.map((field) => field.field_name));
      const fieldNames = FIELD_SPEC.map(([name]) => name).filter((name) => availableNames.has(name));
      // An empty field_names list may return every field. Do not read records
      // until the target exposes a recognized UID column.
      if (!availableNames.has("用户ID")) fail("LABEL_FEISHU_RESPONSE_INVALID", "目标表缺少用户ID字段，已停止读取记录", 502);
      const records = (await pages("records", fieldNames)).map((r) => ({ recordId: r.record_id,
        fields: Object.fromEntries(FIELD_SPEC.map(([name]) => [name, cell(r.fields?.[name])])) }));
      return { fields, records };
    },
    async write(action) {
      if (action.recordId) {
        await request(`/records/${encodeURIComponent(action.recordId)}`, "PUT", { fields: action.fields });
        return action.recordId;
      }
      const data = await request("/records", "POST", { fields: action.fields });
      if (!data.record?.record_id) fail("LABEL_FEISHU_RECEIPT_INVALID", "飞书未返回记录编号，需要回读核验", 502);
      return data.record.record_id;
    },
    async get(recordId) {
      const data = await request("/records/batch_get", "POST", { record_ids: [recordId], with_shared_url: false, automatic_fields: false });
      const invalidIds = [data.forbidden_record_ids, data.absent_record_ids].some((ids) => ids != null && (!Array.isArray(ids) || ids.length));
      if (invalidIds || !Array.isArray(data.records) || data.records.length !== 1
        || data.records[0].record_id !== recordId || !data.records[0].fields) fail("LABEL_FEISHU_RECEIPT_INVALID", "飞书记录回读不完整", 502);
      return { recordId, fields: Object.fromEntries(FIELD_SPEC.map(([name]) => [name, cell(data.records[0].fields[name])])) };
    },
  };
}

function selection(input) {
  if (!Array.isArray(input.userIds) || !input.userIds.length || input.userIds.length > 100
    || input.userIds.some((v) => typeof v !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(v))) fail("LABEL_SYNC_SELECTION_INVALID", "请选择 1–100 个明确的用户 ID", 400);
  return [...new Set(input.userIds)].sort();
}

function sourceEvidence(evidence) {
  const { firstTouch, qr, selfReported } = evidence;
  return [
    firstTouch ? `首次归因：${firstTouch.channelId} / ${firstTouch.campaignId}（${firstTouch.attributedAt || "时间未记录"}）` : "首次归因：未记录",
    qr ? `扫码来源：${qr.channelId} / ${qr.qrCodeId}（${qr.openedAt}）；映射：${qr.mappingId || "待确认"}` : "扫码来源：未记录",
    selfReported ? `自报来源：${selfReported.label}（${selfReported.optionId}，配置 v${selfReported.version}，${selfReported.confirmedAt}）；映射：${selfReported.mappingId || "待确认"}` : "自报来源：未记录",
  ].join("\n");
}

function plan(data, userIds, remote, adapter) {
  const fields = new Map(remote.fields.map((f) => [f.field_name, f]));
  const blockers = [];
  for (const [name, type] of FIELD_SPEC) {
    if (!fields.has(name)) blockers.push(`缺少字段：${name}`);
    else if (fields.get(name).type !== type) blockers.push(`字段类型不符：${name}`);
  }
  const byUser = new Map();
  for (const record of remote.records) {
    const uid = record.fields["用户ID"];
    if (!uid) continue;
    if (!record.recordId || !/^rec[A-Za-z0-9]+$/.test(record.recordId)) fail("LABEL_FEISHU_RESPONSE_INVALID", "飞书记录编号无效", 502);
    if (!byUser.has(uid)) byUser.set(uid, []);
    byUser.get(uid).push(record);
  }
  const rows = userLabels.rows(data, { userIds });
  for (const uid of userIds) if (!rows.some((r) => r.rootUserId === uid)) blockers.push(`用户不存在：${uid}`);
  const actions = [];
  for (const row of rows) {
    const matches = byUser.get(row.rootUserId) || [];
    if (row.accountStatus !== "有效") { blockers.push(`账号已注销或注销中：${row.rootUserId}`); continue; }
    if (matches.length > 1) { blockers.push(`重复用户记录：${row.rootUserId}`); continue; }
    const current = matches[0];
    const state = list(data, "userLabelSyncStates").find((r) => r.target_key === adapter.targetKey && r.root_user_id === row.rootUserId);
    if (state && ["PENDING", "UNKNOWN"].includes(state.status)) {
      blockers.push(`上次写入结果待核验，请先执行回读：${row.rootUserId}`); continue;
    }
    const suggestions = Object.fromEntries(SOURCE_FIELDS.map((f, i) => [f, [row.source.activity, row.source.city, row.source.partner, row.source.channelType][i]]));
    const desired = { 用户ID: row.rootUserId, 首次可识别访问日期: row.firstVisitAt ? Date.parse(row.firstVisitAt) : null,
      ...suggestions, 来源依据: sourceEvidence(row.source.evidence), 来源核验状态: row.source.status,
      系统来源建议: Object.entries(suggestions).map(([name, value]) => `${name}：${value}`).join("\n"), ...(!current ? MANUAL_DEFAULTS : {}) };
    const preserved = [];
    for (const name of SOURCE_FIELDS) {
      if (current?.fields[name] && current.fields[name] !== desired[name]
        && current.fields[name] !== state?.after_json?.[name]) { delete desired[name]; preserved.push(name); }
    }
    if (preserved.length) desired["来源核验状态"] = "人工来源保留，系统建议供核对";
    for (const [name, value] of Object.entries(desired)) {
      if (fields.get(name)?.type === 3 && value != null
        && !(fields.get(name).property?.options || []).some((o) => o.name === value)) blockers.push(`单选项未配置：${name} / ${value}`);
    }
    const patch = Object.fromEntries(Object.entries(desired).filter(([name, value]) => !current || (current.fields[name] ?? null) !== value));
    if (!Object.keys(patch).length) continue;
    actions.push({ rootUserId: row.rootUserId, recordId: current?.recordId || "", kind: current ? "UPDATE" : "CREATE",
      fields: patch, before: Object.fromEntries(Object.keys(patch).map((k) => [k, current?.fields[k] ?? null])), preservedManualFields: preserved });
  }
  const result = { targetKey: adapter.targetKey, userIds, actions, blockers: [...new Set(blockers)],
    summary: { selected: userIds.length, create: actions.filter((a) => a.kind === "CREATE").length,
      update: actions.filter((a) => a.kind === "UPDATE").length, unchanged: rows.length - actions.length },
    healthFieldsExcluded: true };
  return { ...result, planHash: digest(result), writesEnabled: adapter.writesEnabled === true };
}

async function preview(data, input, adapter) {
  const userIds = selection(input);
  return plan(data, userIds, await adapter.read(), adapter);
}

function stateFor(data, targetKey, uid) {
  if (!Array.isArray(data.userLabelSyncStates)) data.userLabelSyncStates = [];
  let state = data.userLabelSyncStates.find((r) => r.target_key === targetKey && r.root_user_id === uid);
  if (!state) {
    state = { user_label_sync_state_id: digest([targetKey, uid]).slice(0, 32), target_key: targetKey, root_user_id: uid,
      record_id: "", status: "NEW", before_json: {}, after_json: {}, last_error_code: "", created_at: new Date().toISOString() };
    data.userLabelSyncStates.push(state);
  }
  return state;
}

// checkpoint/resume persist the intent before network I/O and reload after it.
// Pending or ambiguous creates are never automatically retried.
async function execute(data, input, adapter, persistence) {
  if (!adapter.writesEnabled) fail("LABEL_SYNC_WRITE_DISABLED", "飞书实际写入尚未启用，请先完成目标表核验");
  if (!persistence?.checkpoint || !persistence?.resume) fail("LABEL_SYNC_PERSISTENCE_REQUIRED", "实际同步需要支持持久化检查点的存储");
  const current = await preview(data, input, adapter);
  if (current.blockers.length) fail("LABEL_SYNC_BLOCKED", "预览存在待处理项，请先处理后重试");
  if (!input.planHash || input.planHash !== current.planHash) fail("LABEL_SYNC_PLAN_CHANGED", "数据或目标表已变化，请重新预览并确认");
  const results = [];
  for (const action of current.actions) {
    const fields = { ...action.fields, 数据更新时间: Date.now() };
    Object.assign(stateFor(data, adapter.targetKey, action.rootUserId), { status: "PENDING", record_id: action.recordId,
      before_json: action.before, pending_json: fields, updated_at: new Date().toISOString(), last_error_code: "" });
    await persistence.checkpoint();
    let recordId = action.recordId, confirmed = false, conflict = false;
    try {
      if (recordId) {
        const fresh = await adapter.get(recordId);
        conflict = fresh.fields["用户ID"] !== action.rootUserId
          || Object.entries(action.before).some(([key, value]) => (fresh.fields[key] ?? null) !== value);
      }
      if (!conflict) {
        recordId = await adapter.write({ ...action, fields });
        const back = await adapter.get(recordId);
        confirmed = back.fields["用户ID"] === action.rootUserId
          && Object.entries(fields).every(([key, value]) => (back.fields[key] ?? null) === value);
      }
    } catch { /* Preserve uncertain outcomes for explicit reconciliation. */ }
    await persistence.resume();
    const state = stateFor(data, adapter.targetKey, action.rootUserId);
    Object.assign(state, { record_id: recordId, status: conflict ? "CONFLICT" : confirmed ? "SYNCED" : "UNKNOWN",
      ...(conflict ? { pending_json: {} } : {}),
      ...(confirmed ? { after_json: { ...state.after_json, ...fields }, pending_json: {}, synced_at: new Date().toISOString() } : {}),
      last_error_code: conflict ? "PREWRITE_CHANGED" : confirmed ? "" : "READBACK_REQUIRED", updated_at: new Date().toISOString() });
    results.push({ rootUserId: action.rootUserId, status: state.status });
    if (!confirmed) break;
  }
  return { results, status: results.some((r) => r.status === "CONFLICT") ? "PLAN_CHANGED" : results.some((r) => r.status === "UNKNOWN") ? "NEEDS_RECONCILIATION" : "SYNCED" };
}

async function reconcile(data, input, adapter) {
  const ids = selection(input), remote = await adapter.read(), results = [];
  for (const uid of ids) {
    const state = list(data, "userLabelSyncStates").find((r) => r.target_key === adapter.targetKey && r.root_user_id === uid);
    if (!state || !["PENDING", "UNKNOWN"].includes(state.status)) continue;
    const matches = remote.records.filter((r) => r.fields["用户ID"] === uid);
    const confirmed = Object.keys(state.pending_json || {}).length > 0 && matches.length === 1 && (!state.record_id || state.record_id === matches[0].recordId)
      && Object.entries(state.pending_json || {}).every(([key, value]) => (matches[0].fields[key] ?? null) === value);
    if (confirmed) Object.assign(state, { status: "SYNCED", record_id: matches[0].recordId,
      after_json: { ...state.after_json, ...state.pending_json }, pending_json: {}, last_error_code: "", synced_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    results.push({ rootUserId: uid, status: confirmed ? "SYNCED" : "UNKNOWN" });
  }
  return { results };
}

module.exports = { FIELD_SPEC, createFeishuLabelAdapter, plan, preview, execute, reconcile };
