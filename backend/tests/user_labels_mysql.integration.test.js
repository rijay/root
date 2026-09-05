const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const mysql = require("mysql2/promise");
const { createMysqlStore, createEmptyData } = require("../src/store");
const sync = require("../src/feishuUserLabels");
const { fixture, fakeAdapter } = require("./fixtures/userLabelsFixture");
const { configFromEnv } = require("../scripts/mysql-schema-snapshot");
const { assertDisposableSnapshotServer } = require("../src/mysqlSchemaSnapshot");

test("MySQL persists label mappings and sync intent before external I/O; restart reconciles an interrupted write", {
  skip: process.env.USER_LABELS_MYSQL_INTEGRATION !== "true",
}, async () => {
  // Local and CI instances share the same loopback and empty-marker guards.
  const config = configFromEnv();
  assert.ok(["127.0.0.1", "localhost", "::1"].includes(String(config.host).toLowerCase()), "MySQL integration requires a loopback host");
  assert.ok(Number.isSafeInteger(config.port) && config.port > 0 && config.port <= 65535);
  const server = await mysql.createConnection(config);
  const database = `myroot_labels_test_${crypto.randomBytes(6).toString("hex")}`;
  const testUser = `labels_${crypto.randomBytes(6).toString("hex")}`;
  const testPassword = crypto.randomBytes(32).toString("hex");
  let store;
  let created = false;
  let userCreated = false;
  const options = { seedSampleData: false, env: { NODE_ENV: "test",
    ROOT_COMMAND_REQUEST_DIGEST_KEY: crypto.randomBytes(32).toString("hex"), ROOT_COMMAND_REQUEST_DIGEST_KEY_ID: "labels-test",
    ROOT_COMMAND_RESULT_ENCRYPTION_KEY: crypto.randomBytes(32).toString("hex"), ROOT_COMMAND_RESULT_KEY_ID: "labels-test",
  } };
  try {
    await assertDisposableSnapshotServer(server);
    await server.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    created = true;
    await server.query("CREATE USER ?@'%' IDENTIFIED BY ?", [testUser, testPassword]);
    userCreated = true;
    await server.query(`GRANT ALL PRIVILEGES ON \`${database}\`.* TO ?@'%'`, [testUser]);
    const open = () => createMysqlStore({ ...config, database, user: testUser, password: testPassword }, options);
    store = await open();
    const data = createEmptyData();
    const sample = fixture();
    data.users = [sample.users[0], { ...sample.users[0], user_id: "usr_interrupted", root_user_id: "usr_interrupted" }];
    data.rootUsers = sample.rootUsers;
    data.userLabelMappings = sample.userLabelMappings;
    await store.importSnapshot(data);
    const adapter = fakeAdapter();
    const write = adapter.write.bind(adapter);
    adapter.write = async (action) => {
      const [rows] = await server.execute(`SELECT status, pending_json, record_id FROM \`${database}\`.user_label_sync_state WHERE root_user_id = ?`, [action.rootUserId]);
      assert.equal(rows[0].status, "PENDING");
      assert.equal(rows[0].pending_json["用户ID"], action.rootUserId);
      assert.equal(rows[0].record_id, null);
      return write(action);
    };
    await store.runRequest({ write: true }, async (current, control) => {
      const preview = await sync.preview(current, { userIds: ["usr_labels_demo"] }, adapter);
      assert.equal((await sync.execute(current, preview, adapter, control)).status, "SYNCED");
    });
    await assert.rejects(store.runRequest({ write: true }, async (current, control) => {
      const preview = await sync.preview(current, { userIds: ["usr_interrupted"] }, adapter);
      await sync.execute(current, preview, adapter, { checkpoint: control.checkpoint, resume: async () => { throw new Error("simulated restart"); } });
    }), /simulated restart/);
    await store.close(); store = await open();
    await store.runRequest({ write: true }, async (current) => {
      assert.equal(current.userLabelMappings[0].attributes_json.city, "上海");
      assert.equal(current.userLabelSyncStates.find((r) => r.root_user_id === "usr_labels_demo").status, "SYNCED");
      assert.equal(current.userLabelSyncStates.find((r) => r.root_user_id === "usr_interrupted").status, "PENDING");
      assert.match((await sync.preview(current, { userIds: ["usr_interrupted"] }, adapter)).blockers.join(), /待核验/);
      assert.equal((await sync.reconcile(current, { userIds: ["usr_interrupted"] }, adapter)).results[0].status, "SYNCED");
      assert.equal((await sync.preview(current, { userIds: ["usr_labels_demo", "usr_interrupted"] }, adapter)).actions.length, 0);
    });
    const [states] = await server.query(`SELECT status, pending_json, last_error_code FROM \`${database}\`.user_label_sync_state`);
    assert.equal(states.length, 2);
    assert.ok(states.every((s) => s.status === "SYNCED" && Object.keys(s.pending_json).length === 0 && s.last_error_code === null));
    assert.equal(adapter.writes, 2);
  } finally {
    if (store) await store.close();
    if (created) await server.query(`DROP DATABASE \`${database}\``);
    if (userCreated) await server.query("DROP USER ?@'%'", [testUser]);
    await server.end();
  }
});
