#!/usr/bin/env node
"use strict";

// Uses the production Adapter with runtime-injected credentials. Never writes
// records, emits credential values, or treats a synthetic user as a live sync.
const sync = require("../src/feishuUserLabels");
const { createEmptyData } = require("../src/store");

async function verify(env = process.env, fetchImpl = globalThis.fetch) {
  const report = {
    checkedAt: new Date().toISOString(),
    mode: "READ_ONLY_SERVER_ADAPTER",
    recordWrites: 0,
    liveUserSyncTested: false,
  };
  const required = ["ROOT_LABEL_FEISHU_APP_TOKEN", "ROOT_LABEL_FEISHU_TABLE_ID", "ROOT_LABEL_FEISHU_ACCESS_TOKEN"];
  const missing = required.filter((key) => !String(env[key] || "").trim());
  if (missing.length) return { ...report, status: "BLOCKED", code: "LABEL_FEISHU_NOT_CONFIGURED", missing };
  const adapter = sync.createFeishuLabelAdapter({ ...env, ROOT_LABEL_FEISHU_WRITE_ENABLED: "false" }, {
    fetchImpl: (url, init = {}) => {
      const method = init.method || "GET";
      const endpoint = new URL(url).pathname;
      // Feishu's current search and batch_get APIs use POST for read operations.
      if (!(method === "GET" && endpoint.endsWith("/fields"))
        && !(method === "POST" && /\/records\/(search|batch_get)$/.test(endpoint))) throw new Error("READ_ONLY_REQUEST_REQUIRED");
      return fetchImpl(url, init);
    },
  });
  if (!adapter.configured) return { ...report, status: "BLOCKED", code: "LABEL_FEISHU_CONFIG_INVALID" };
  try {
    const remote = await adapter.read();
    const data = createEmptyData();
    const syntheticId = "usr_local_schema_check";
    data.users = [{ root_user_id: syntheticId, app_code: "MYROOT" }];
    // Only validate schema/default options. No real or synthetic record is sent.
    const preview = sync.plan(data, [syntheticId], { fields: remote.fields, records: [] }, adapter);
    return {
      ...report,
      status: preview.blockers.length ? "BLOCKED" : "PASS",
      fieldCount: remote.fields.length,
      recordCount: remote.records.length,
      requiredFieldCount: sync.FIELD_SPEC.length,
      schemaBlockers: preview.blockers,
      writesEnabled: adapter.writesEnabled,
      healthFieldsExcluded: preview.healthFieldsExcluded,
    };
  } catch (error) {
    // Provider response text can contain credentials or personal information.
    const code = /^LABEL_[A-Z_]+$/.test(error.code || "") ? error.code : "READ_ONLY_PROBE_FAILED";
    return { ...report, status: "BLOCKED", code };
  }
}

if (require.main === module) {
  verify().then((report) => {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.status === "PASS" ? 0 : 2;
  }).catch(() => {
    process.stderr.write("READ_ONLY_PROBE_FAILED\n");
    process.exitCode = 2;
  });
}

module.exports = { verify };
