const test = require("node:test");
const assert = require("node:assert/strict");

const { createApp } = require("../src/app");
const domain = require("../src/domain");
const { createMemoryStore } = require("../src/store");

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  });
}

async function request(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  return { status: response.status, body: await response.json() };
}

async function login(baseUrl, suffix) {
  const result = await request(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ openid: `task_outbox_${suffix}`, appCode: "MYROOT" }),
  });
  assert.equal(result.body.code, 0);
  return { Authorization: `Bearer ${result.body.data.token}` };
}

function taskBody(taskDate) {
  return {
    taskType: "CHECKIN",
    taskDate,
    idempotencyKey: `task-outbox-${taskDate}`,
    payload: {
      taskDate,
      stoolType: "type4",
      phone: "13800138000",
      openid: "oSensitiveOpenId",
      unionid: "uSensitiveUnionId",
      token: "sensitive-token",
      authorization: "Bearer sensitive-authorization",
      answers: { digestiveCondition: "sensitive-health-answer" },
    },
  };
}

function assertMinimizedEnvelope(envelope) {
  assert.equal(envelope.topic, "task.events");
  assert.equal(envelope.aggregate_type, "TASK_EVENT");
  assert.equal(envelope.aggregate_version, 1);
  assert.equal(envelope.partition_position, 1);
  assert.equal(envelope.payload_json.taskEventId, envelope.aggregate_id);
  assert.match(envelope.correlation_id, /^request_[a-f0-9]{32}$/);
  const persisted = JSON.stringify(envelope);
  [
    "13800138000",
    "oSensitiveOpenId",
    "uSensitiveUnionId",
    "sensitive-token",
    "sensitive-authorization",
    "sensitive-health-answer",
    "stoolType",
    "root_user_id",
  ].forEach((value) => assert.equal(persisted.includes(value), false, value));
}

test("task HTTP write stages one complete snapshot outbox envelope after command success", async (t) => {
  const server = createApp({ env: { ROOT_ALLOW_OPENID_LOGIN: "true" } });
  const baseUrl = await listen(server);
  t.after(() => server.close());
  const auth = await login(baseUrl, "snapshot");
  const headers = { ...auth, "X-Request-Id": "task-outbox-http-snapshot-1" };

  const first = await request(baseUrl, "/api/v1/tasks/events", {
    method: "POST",
    headers,
    body: JSON.stringify(taskBody("2026-07-16")),
  });
  // Simulate a fact created before this producer bridge existed.
  server.store.eventOutbox.length = 0;
  const replay = await request(baseUrl, "/api/v1/tasks/events", {
    method: "POST",
    headers,
    body: JSON.stringify(taskBody("2026-07-16")),
  });

  assert.equal(first.body.code, 0);
  assert.equal(replay.body.code, 0);
  assert.equal(server.store.taskEvents.length, 1);
  assert.equal(server.store.eventOutbox.length, 1);
  assertMinimizedEnvelope(server.store.eventOutbox[0]);
  assert.equal(server.store.eventOutbox[0].correlation_id.includes("task-outbox-http-snapshot-1"), false);

  const domainDuplicate = await request(baseUrl, "/api/v1/tasks/events", {
    method: "POST",
    headers: { ...auth, "X-Request-Id": "task-outbox-http-snapshot-2" },
    body: JSON.stringify(taskBody("2026-07-16")),
  });
  assert.equal(domainDuplicate.body.code, 0);
  assert.equal(domainDuplicate.body.data.created, false);
  assert.equal(server.store.taskEvents.length, 1);
  assert.equal(server.store.eventOutbox.length, 1);
});

test("transaction Event Transport Interface owns MySQL-style staging and rejected commands stage nothing", async (t) => {
  const base = createMemoryStore(domain.createStore(), { seedSampleData: false });
  const staged = new Map();
  let stageCalls = 0;
  const transactionTransport = {
    stageOutbox(envelope) {
      stageCalls += 1;
      const key = `${envelope.topic}:${envelope.dedupe_key}`;
      const existing = staged.get(key);
      if (existing) {
        assert.deepEqual(envelope, existing);
        return { created: false, event: existing };
      }
      staged.set(key, envelope);
      return { created: true, event: envelope };
    },
  };
  const storeAdapter = {
    ...base,
    async runRequest(_options, work) {
      return work(base.data, { eventTransport: transactionTransport });
    },
  };
  const server = createApp({ storeAdapter, env: { ROOT_ALLOW_OPENID_LOGIN: "true" } });
  const baseUrl = await listen(server);
  t.after(() => server.close());
  const auth = await login(baseUrl, "transaction");
  const headers = { ...auth, "X-Request-Id": "task-outbox-http-transaction-1" };

  const first = await request(baseUrl, "/api/v1/tasks/events", {
    method: "POST",
    headers,
    body: JSON.stringify(taskBody("2026-07-17")),
  });
  const replay = await request(baseUrl, "/api/v1/tasks/events", {
    method: "POST",
    headers,
    body: JSON.stringify(taskBody("2026-07-17")),
  });
  const conflict = await request(baseUrl, "/api/v1/tasks/events", {
    method: "POST",
    headers,
    body: JSON.stringify(taskBody("2026-07-18")),
  });

  assert.equal(first.body.code, 0);
  assert.equal(replay.body.code, 0);
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, 40901);
  assert.equal(base.data.taskEvents.length, 1);
  assert.equal(base.data.eventOutbox.length, 0);
  assert.equal(staged.size, 1);
  assert.equal(stageCalls, 2);
  assertMinimizedEnvelope(Array.from(staged.values())[0]);
});

test("transaction staging failure escapes the route handler and rolls back task plus command facts", async (t) => {
  const base = createMemoryStore(domain.createStore(), { seedSampleData: false });
  const storeAdapter = {
    ...base,
    async runRequest(_options, work) {
      const before = base.exportSnapshot();
      try {
        return await work(base.data, {
          eventTransport: {
            stageOutbox() {
              const error = new Error("simulated persistence failure with bearer-secret");
              error.code = "OUTBOX_PERSISTENCE_FAILED";
              throw error;
            },
          },
        });
      } catch (error) {
        base.importSnapshot(before);
        throw error;
      }
    },
  };
  const server = createApp({ storeAdapter, env: { ROOT_ALLOW_OPENID_LOGIN: "true" } });
  const baseUrl = await listen(server);
  t.after(() => server.close());
  const auth = await login(baseUrl, "stage_failure");
  const taskCountBefore = base.data.taskEvents.length;
  const commandCountBefore = base.data.commandIdempotencyRecords.length;

  const result = await request(baseUrl, "/api/v1/tasks/events", {
    method: "POST",
    headers: { ...auth, "X-Request-Id": "task-outbox-stage-failure-1" },
    body: JSON.stringify(taskBody("2026-07-19")),
  });

  assert.equal(result.status, 503);
  assert.equal(result.body.code, 50301);
  assert.equal(JSON.stringify(result.body).includes("bearer-secret"), false);
  assert.equal(base.data.taskEvents.length, taskCountBefore);
  assert.equal(base.data.commandIdempotencyRecords.length, commandCountBefore);
  assert.equal(base.data.eventOutbox.length, 0);
});

test("client-controlled event type is rejected before task or outbox persistence", async (t) => {
  const server = createApp({ env: { ROOT_ALLOW_OPENID_LOGIN: "true" } });
  const baseUrl = await listen(server);
  t.after(() => server.close());
  const auth = await login(baseUrl, "invalid_envelope");

  const result = await request(baseUrl, "/api/v1/tasks/events", {
    method: "POST",
    headers: { ...auth, "X-Request-Id": "task-outbox-invalid-envelope-1" },
    body: JSON.stringify({
      ...taskBody("2026-07-20"),
      eventType: "13800138000-Bearer-sensitive-token",
    }),
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.code, 7003);
  assert.equal(JSON.stringify(result.body).includes("13800138000"), false);
  assert.equal(server.store.taskEvents.length, 0);
  assert.equal(server.store.commandIdempotencyRecords.length, 1);
  assert.equal(server.store.commandIdempotencyRecords[0].status, "FAILED");
  assert.equal(server.store.eventOutbox.length, 0);
});
