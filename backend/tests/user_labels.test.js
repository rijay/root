const test = require("node:test");
const assert = require("node:assert/strict");
const labels = require("../src/userLabels");
const sync = require("../src/feishuUserLabels");
const { normalizeStoreData, validateSnapshot } = require("../src/store");
const { PROJECTIONS, projectionValue } = require("../src/mysqlProjection");
const { fixture, remoteFixture, fakeAdapter } = require("./fixtures/userLabelsFixture");
const ids = ["usr_labels_demo"];
const persistence = { async checkpoint() {}, async resume() {} };

test("one row per root user; basic view contains no health, contact or login identity", () => {
  const data = fixture(); data.users.push({ ...data.users[0], user_id: "legacy_alias" });
  const result = labels.query(data);
  assert.equal(result.total, 1);
  assert.equal(result.rows[0].source.activity, "演示活动");
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_NAME|13800138000|private-union|SENSITIVE|Q3|has_demo/);
  assert.equal(result.rows[0].trialOrder, "待核验");
  assert.equal(result.rows[0].wecomAdded, "待核验");
});
test("multi-select answers and original result are retained; retests do not change the provisional first baseline", () => {
  const data = fixture(); data.healthAssessmentAttempts.push({ ...data.healthAssessmentAttempts[0], assessment_id: "has_retest", completed_at: new Date().toISOString() });
  const row = labels.query(data, {}, { includeHealth: true }).rows[0];
  assert.match(row.health.baseline.answerText, /Q3=B,D/);
  assert.equal(row.health.baseline.resultCode, "SENSITIVE");
  assert.equal(row.health.baseline.assessmentId, "has_demo");
});
test("initial assessment, expired data, withdrawal and safety stop are not normal five-question completions", () => {
  for (const scenario of ["initial", "expired", "withdrawn", "safety"]) {
    const data = fixture();
    if (scenario === "initial") data.healthAssessmentAttempts[0].questionnaire_id = "ROOT4U_INITIAL_PROFILE";
    if (scenario === "expired") data.healthAssessmentAttempts[0].completed_at = "2020-01-01T00:00:00Z";
    if (scenario === "withdrawn") data.privacyConsentRecords.push({ root_user_id: ids[0], consent_type: "HEALTH_SENSITIVE_INFO", decision: "WITHDRAWN", occurred_at: new Date().toISOString() });
    if (scenario === "safety") data.healthAssessmentAttempts[0].status = "SAFETY_STOPPED";
    const row = labels.query(data, {}, { includeHealth: true }).rows[0];
    assert.equal(row.health.baseline, null);
    assert.notEqual(row.health.status, "已完成");
  }
});
test("registration time is not presented as first visit; test-channel traffic does not classify the person", () => {
  const data = fixture(); data.channelFunnelVisits = [];
  assert.equal(labels.query(data).rows[0].firstVisitAt, "");
  data.userLabelMappings[0].attributes_json.channelType = "内部测试";
  assert.equal(labels.query(data).rows[0].userType, "待确认");
});
test("latest safety stop remains visible alongside an earlier historical baseline", () => {
  const data = fixture();
  data.healthAssessmentAttempts.push({ ...data.healthAssessmentAttempts[0], assessment_id: "has_safety",
    status: "SAFETY_STOPPED", started_at: new Date().toISOString(), completed_at: null });
  const health = labels.query(data, {}, { includeHealth: true }).rows[0].health;
  assert.equal(health.status, "安全终止");
  assert.equal(health.baseline.assessmentId, "has_demo");
});
test("persisted first-touch attribution selects its own visit instead of an unrelated earlier visit", () => {
  const data = fixture();
  data.channelAttributions = [{ root_user_id: ids[0], channel_id: "VENUE_DEMO", campaign_id: "EVENT_DEMO" }];
  data.channelFunnelVisits.unshift({ ...data.channelFunnelVisits[0], channel_id: "OTHER", campaign_id: "OTHER", opened_at: "2020-01-01T00:00:00Z" });
  const row = labels.query(data).rows[0];
  assert.equal(row.source.evidence.qr.channelId, "VENUE_DEMO");
  assert.equal(row.firstVisitAt, "2020-01-01T00:00:00.000Z");
});
test("conflicting QR and self-report evidence remains visible and unresolved", () => {
  const data = fixture(), attempt = data.healthAssessmentAttempts[0];
  Object.assign(attempt, { discovery_channel_option_id: "OTHER", discovery_channel_option_label: "其他", discovery_channel_config_version: 1, discovery_channel_confirmed_at: attempt.completed_at });
  data.userLabelMappings.push({ ...data.userLabelMappings[0], source_type: "SELF_REPORTED", source_id: "OTHER", source_version: 1,
    attributes_json: { ...data.userLabelMappings[0].attributes_json, activity: "另一活动" } });
  const source = labels.query(data).rows[0].source;
  assert.equal(source.status, "来源冲突待核验"); assert.equal(source.activity, "待确认"); assert.equal(source.evidence.selfReported.label, "其他");
});
test("mapping updates are versioned, stale saves fail and old visits retain old mappings", () => {
  const data = fixture();
  const input = { sourceType: "QR_CODE", sourceId: "qr_demo", expectedVersion: 1, effectiveFrom: new Date(Date.now() + 60000).toISOString(),
    activity: "新活动", city: "上海", partner: "演示场馆", channelType: "场馆陪伴计划", reason: "后续活动", operatorId: "operator" };
  labels.saveMapping(data, input);
  assert.equal(labels.query(data).rows[0].source.activity, "演示活动");
  assert.throws(() => labels.saveMapping(data, input), /已更新/);
  assert.throws(() => labels.saveMapping(fixture(), { ...input, effectiveFrom: new Date(Date.now() - 86400000).toISOString() }), /不能改写/);
});
test("historical self-reported source versions remain configurable after the survey changes", () => {
  const data = fixture();
  Object.assign(data.healthAssessmentAttempts[0], { discovery_channel_option_id: "OLD", discovery_channel_option_label: "历史活动",
    discovery_channel_config_version: 1, discovery_channel_confirmed_at: data.healthAssessmentAttempts[0].completed_at });
  data.assessmentSourceSurveyConfigs = [{ config_version: 2, options_json: [{ optionId: "NEW", label: "新活动" }] }];
  assert.equal(labels.configuration(data).selfReportedSources.length, 2);
  labels.saveMapping(data, { sourceType: "SELF_REPORTED", sourceId: "OLD", sourceVersion: 1, expectedVersion: 0,
    effectiveFrom: "2020-01-01T00:00:00Z", activity: "演示活动", city: "上海", partner: "演示场馆", channelType: "场馆陪伴计划", reason: "核对历史活动", operatorId: "test" });
  assert.ok(labels.query(data).rows[0].source.evidence.selfReported.mappingId);
});
test("new mapping and sync collections survive store normalization and have MySQL projection coverage", () => {
  const data = fixture(); data.userLabelSyncStates.push({ user_label_sync_state_id: "state1", target_key: "target", root_user_id: ids[0], pending_json: { 用户ID: ids[0] } });
  const normalized = normalizeStoreData(data);
  assert.equal(normalized.userLabelMappings.length, 1); assert.equal(normalized.userLabelSyncStates.length, 1);
  assert.equal(validateSnapshot(normalized).errors.filter((s) => s.includes("userLabel")).length, 0);
  for (const source of ["userLabelMappings", "userLabelSyncStates"]) assert.ok(PROJECTIONS.some((p) => p.source === source));
  assert.equal(projectionValue({ pending_json: { a: 1 } }, "pending_json"), '{"a":1}');
});
test("preview requires exact schema, contains no health, and rejects duplicates or unsupported select options", async () => {
  const data = fixture(), adapter = fakeAdapter();
  const preview = await sync.preview(data, { userIds: ids }, adapter);
  assert.equal(preview.blockers.length, 0); assert.equal(preview.summary.create, 1);
  assert.doesNotMatch(JSON.stringify(preview), /SENSITIVE|Q3|has_demo|自测答案/);
  adapter.remote.records = [1, 2].map((i) => ({ recordId: `rec${i}`, fields: { 用户ID: ids[0] } }));
  assert.match((await sync.preview(data, { userIds: ids }, adapter)).blockers.join(), /重复用户/);
  adapter.remote.records = []; adapter.remote.fields.find((f) => f.field_name === "用户类型").type = 7;
  assert.match((await sync.preview(data, { userIds: ids }, adapter)).blockers.join(), /字段类型不符/);
});
test("successful sync verifies readback; retry is a no-op and preserves manual labels and corrected source", async () => {
  const data = fixture(), adapter = fakeAdapter();
  const first = await sync.preview(data, { userIds: ids }, adapter);
  await sync.execute(data, first, adapter, persistence);
  assert.equal(adapter.writes, 1); assert.equal(data.userLabelSyncStates[0].status, "SYNCED");
  assert.equal((await sync.preview(data, { userIds: ids }, adapter)).actions.length, 0);
  Object.assign(adapter.remote.records[0].fields, { 用户类型: "内部测试", 标签备注: "人工备注", 是否复购正装: "是", 来源活动: "人工活动" });
  const next = await sync.preview(data, { userIds: ids }, adapter);
  assert.deepEqual(next.actions[0].preservedManualFields, ["来源活动"]);
  for (const key of ["用户类型", "标签备注", "是否复购正装", "来源活动"]) assert.equal(next.actions[0].fields[key], undefined);
});
test("ambiguous create stays blocked until readback confirms the saved intent, never creates twice", async () => {
  const data = fixture(), adapter = fakeAdapter(), write = adapter.write.bind(adapter);
  adapter.write = async (action) => { await write(action); throw new Error("lost response"); };
  const first = await sync.preview(data, { userIds: ids }, adapter);
  await sync.execute(data, first, adapter, persistence);
  assert.equal(data.userLabelSyncStates[0].status, "UNKNOWN");
  assert.match((await sync.preview(data, { userIds: ids }, adapter)).blockers.join(), /待核验/);
  assert.equal((await sync.reconcile(data, { userIds: ids }, adapter)).results[0].status, "SYNCED");
  assert.equal((await sync.preview(data, { userIds: ids }, adapter)).actions.length, 0);
  assert.equal(adapter.writes, 1);
});
test("changed previews and disabled writes cannot execute", async () => {
  const data = fixture(), adapter = fakeAdapter();
  let preview = await sync.preview(data, { userIds: ids }, adapter);
  await assert.rejects(sync.execute(data, { ...preview, planHash: "wrong" }, adapter, persistence), /已变化/);
  adapter.writesEnabled = false;
  await assert.rejects(sync.execute(data, preview, adapter, persistence), /尚未启用/);
  assert.equal(adapter.writes, 0);
});
test("unconfirmed writes stop before the second selected user", async () => {
  const data = fixture(), adapter = fakeAdapter();
  data.users.push({ ...data.users[0], user_id: "usr_second", root_user_id: "usr_second" });
  adapter.write = async () => { adapter.writes += 1; throw new Error("unconfirmed"); };
  const preview = await sync.preview(data, { userIds: [...ids, "usr_second"] }, adapter);
  const result = await sync.execute(data, preview, adapter, persistence);
  assert.equal(result.status, "NEEDS_RECONCILIATION");
  assert.equal(result.results.length, 1); assert.equal(adapter.writes, 1);
});
test("manual edits discovered immediately before an update stop the batch without overwriting", async () => {
  const data = fixture(), adapter = fakeAdapter();
  await sync.execute(data, await sync.preview(data, { userIds: ids }, adapter), adapter, persistence);
  data.userLabelMappings[0].attributes_json.activity = "其他";
  const preview = await sync.preview(data, { userIds: ids }, adapter);
  const result = await sync.execute(data, preview, adapter, {
    async checkpoint() { adapter.remote.records[0].fields["来源活动"] = "人工活动"; }, async resume() {},
  });
  assert.equal(result.status, "PLAN_CHANGED");
  assert.equal(adapter.writes, 1);
  assert.equal(adapter.remote.records[0].fields["来源活动"], "人工活动");
});
test("adapter follows all pages and fails on repeated cursors; never leaks provider messages or credentials", async () => {
  const requests = [];
  const env = { ROOT_LABEL_FEISHU_APP_TOKEN: "appDEMO", ROOT_LABEL_FEISHU_TABLE_ID: "tblDEMO", ROOT_LABEL_FEISHU_ACCESS_TOKEN: "secret-demo" };
  const adapter = sync.createFeishuLabelAdapter(env, { fetchImpl: async (url, init) => {
    requests.push(url); assert.equal(init.redirect, "error");
    const fields = url.includes("/fields?"); const second = url.includes("page_token=next");
    if (fields) assert.equal(init.method, "GET");
    else {
      assert.equal(init.method, "POST"); assert.ok(url.includes("/records/search?"));
      assert.deepEqual(JSON.parse(init.body), { field_names: sync.FIELD_SPEC.map(([name]) => name), automatic_fields: false });
    }
    return { ok: true, json: async () => ({ code: 0, data: { items: fields ? remoteFixture().fields : [{ record_id: second ? "recSecond" : "recFirst", fields: { 用户ID: second ? "usr2" : "usr1", 自测答案: "PRIVATE_HEALTH" } }], has_more: !fields && !second, page_token: "next" } }) };
  } });
  const result = await adapter.read(); assert.equal(result.records.length, 2); assert.equal(requests.length, 3); assert.doesNotMatch(JSON.stringify(result.records), /PRIVATE_HEALTH/);
  const bad = sync.createFeishuLabelAdapter(env, { fetchImpl: async () => ({ ok: true, json: async () => ({ code: 0, data: { items: [], has_more: true, page_token: "repeat" } }) }) });
  await assert.rejects(bad.read(), /分页不完整/);
  const failure = sync.createFeishuLabelAdapter(env, { fetchImpl: async () => { throw new Error("secret-demo"); } });
  await assert.rejects(failure.read(), (e) => !e.message.includes("secret-demo") && e.code === "LABEL_FEISHU_REQUEST_FAILED");
});

test("record readback requires the exact accessible record and excludes unrelated fields", async () => {
  const env = { ROOT_LABEL_FEISHU_APP_TOKEN: "appDEMO", ROOT_LABEL_FEISHU_TABLE_ID: "tblDEMO", ROOT_LABEL_FEISHU_ACCESS_TOKEN: "secret-demo" };
  let payload = { records: [{ record_id: "recExpected", fields: { 用户ID: "usr_demo", 自测答案: "PRIVATE_HEALTH" } }], forbidden_record_ids: [], absent_record_ids: [] };
  const adapter = sync.createFeishuLabelAdapter(env, { fetchImpl: async (url, init) => {
    assert.ok(url.endsWith("/records/batch_get")); assert.equal(init.method, "POST");
    assert.deepEqual(JSON.parse(init.body), { record_ids: ["recExpected"], with_shared_url: false, automatic_fields: false });
    return { ok: true, json: async () => ({ code: 0, data: payload }) };
  } });
  const result = await adapter.get("recExpected");
  assert.equal(result.fields.用户ID, "usr_demo"); assert.doesNotMatch(JSON.stringify(result), /PRIVATE_HEALTH/);
  for (const invalid of [
    { records: [], forbidden_record_ids: ["recExpected"] },
    { records: [], absent_record_ids: ["recExpected"] },
    { records: [{ record_id: "recOther", fields: {} }] },
    { records: [payload.records[0], payload.records[0]] },
  ]) {
    payload = invalid;
    await assert.rejects(adapter.get("recExpected"), (error) => error.code === "LABEL_FEISHU_RECEIPT_INVALID");
  }
});

test("record search stops on incomplete paging and never requests all columns for an invalid target", async () => {
  const env = { ROOT_LABEL_FEISHU_APP_TOKEN: "appDEMO", ROOT_LABEL_FEISHU_TABLE_ID: "tblDEMO", ROOT_LABEL_FEISHU_ACCESS_TOKEN: "secret-demo" };
  let calls = 0;
  const missingUid = sync.createFeishuLabelAdapter(env, { fetchImpl: async () => {
    calls += 1;
    return { ok: true, json: async () => ({ code: 0, data: { items: [], has_more: false } }) };
  } });
  await assert.rejects(missingUid.read(), (error) => error.code === "LABEL_FEISHU_RESPONSE_INVALID");
  assert.equal(calls, 1);
  const incomplete = sync.createFeishuLabelAdapter(env, { fetchImpl: async (url) => ({ ok: true,
    json: async () => ({ code: 0, data: url.includes("/fields?") ? { items: remoteFixture().fields, has_more: false } : { items: [] } }),
  }) });
  await assert.rejects(incomplete.read(), (error) => error.code === "LABEL_FEISHU_RESPONSE_INVALID");
});
