const assert = require("node:assert/strict");
const test = require("node:test");

const { createApp } = require("../src/app");
const {
  createMysqlActivityTaskReadAdapter,
  normalizeFacts,
} = require("../src/activityTaskReadAdapter");
const taskProgress = require("../src/taskProgress");

const ROOT_USER_ID = "root-user-activity-task-read";
const ASSIGNMENT_ID = "activity-task-assignment-read-001";
const TASK_DEFINITION_ID = "td_activity_read";
const TASK_DEFINITION_VERSION = "activity-read-v3";

function row(overrides = {}) {
  return {
    task_activity_assignment_id: ASSIGNMENT_ID,
    root_user_id: ROOT_USER_ID,
    task_definition_id: TASK_DEFINITION_ID,
    task_definition_version: TASK_DEFINITION_VERSION,
    activity_enrollment_id: "activity-enrollment-read-001",
    activity_session_id: "activity-session-read-001",
    initial_status: "AVAILABLE",
    source_confirmed_event_id: "activity-confirmed-event-read-001",
    source_confirmed_at: "2026-08-01 10:00:00.000",
    task_source_invalidation_event_id: null,
    source_invalidation_reason_code: null,
    source_invalidated_at: null,
    ...overrides,
  };
}

function data() {
  return {
    campaignDefinitions: [{
      campaign_id: "ROOT_7D_RESET",
      title: "ROOT 7D",
      status: "ACTIVE",
      config_json: {},
      created_at: "2026-07-01T00:00:00.000Z",
      updated_at: "2026-07-01T00:00:00.000Z",
    }],
    campaignParticipants: [],
    taskDefinitions: [{
      task_definition_id: TASK_DEFINITION_ID,
      campaign_id: "ROOT_7D_RESET",
      task_type: "SHARE",
      title: "活动后分享感受",
      description: "完成一次活动来源任务。",
      required: true,
      display_order: 5,
      status: "ACTIVE",
      config_json: { targetCount: 1 },
    }],
    activityDefinitionVersions: [{
      activity_version_id: "activity-version-read-001",
      prebound_task_definition_id: TASK_DEFINITION_ID,
      prebound_task_definition_version: TASK_DEFINITION_VERSION,
    }],
    taskEvents: [],
    taskProgressSnapshots: [],
  };
}

function facts(overrides = {}) {
  return normalizeFacts([row(overrides)], ROOT_USER_ID);
}

test("MySQL Activity Task read Adapter returns frozen versions and fails closed on malformed rows", async () => {
  const calls = [];
  const adapter = createMysqlActivityTaskReadAdapter({
    async execute(sql, parameters) {
      calls.push({ sql, parameters });
      if (/^SET SESSION/.test(sql)) return [[], []];
      return [[row()], []];
    },
  });
  const result = await adapter.listByRootUser(ROOT_USER_ID);
  assert.equal(result[0].taskDefinitionVersion, TASK_DEFINITION_VERSION);
  assert.deepEqual(calls[1].parameters, [ROOT_USER_ID]);
  assert.match(calls[1].sql, /FROM task_activity_assignment/);
  assert.match(calls[1].sql, /LEFT JOIN task_source_invalidation_event/);
  assert.throws(
    () => normalizeFacts([row({ task_definition_version: "" })], ROOT_USER_ID),
    { code: "ACTIVITY_TASK_READ_MODEL_INVALID" }
  );
});

test("Task Progress hides unconsumed bindings, cancels unfinished assignments and preserves completed facts", () => {
  const store = data();
  const withoutAssignment = taskProgress.computeTaskProgress(store, ROOT_USER_ID, "ROOT_7D_RESET", {
    activityTaskSourceFacts: [],
    activityTaskSourceFactsLoaded: true,
  });
  assert.equal(withoutAssignment.tasks.some((task) => task.taskDefinitionId === TASK_DEFINITION_ID), false);

  const available = taskProgress.computeTaskProgress(store, ROOT_USER_ID, "ROOT_7D_RESET", {
    activityTaskSourceFacts: facts(),
    activityTaskSourceFactsLoaded: true,
  }).tasks.find((task) => task.taskActivityAssignmentId === ASSIGNMENT_ID);
  assert.equal(available.status, "NOT_STARTED");
  assert.equal(available.taskDefinitionVersion, TASK_DEFINITION_VERSION);
  assert.equal(Object.hasOwn(available, "activityEnrollmentStatus"), false);

  const invalidatedFacts = facts({
    task_source_invalidation_event_id: "task-invalidation-read-001",
    source_invalidation_reason_code: "USER_CANCELED",
    source_invalidated_at: "2026-08-02 10:00:00.000",
  });
  const canceled = taskProgress.computeTaskProgress(store, ROOT_USER_ID, "ROOT_7D_RESET", {
    activityTaskSourceFacts: invalidatedFacts,
    activityTaskSourceFactsLoaded: true,
  }).tasks.find((task) => task.taskActivityAssignmentId === ASSIGNMENT_ID);
  assert.equal(canceled.status, "CANCELED");
  assert.equal(canceled.sourceInvalidationReason, "SOURCE_CANCELED");

  store.taskEvents.push({
    task_event_id: "task-event-activity-read-001",
    root_user_id: ROOT_USER_ID,
    campaign_id: "ROOT_7D_RESET",
    task_definition_id: TASK_DEFINITION_ID,
    task_type: "SHARE",
    event_type: "SHARE_COMPLETED",
    status: "RECORDED",
    occurred_at: "2026-08-01T12:00:00.000Z",
    payload_json: {
      taskActivityAssignmentId: ASSIGNMENT_ID,
      taskDefinitionVersion: TASK_DEFINITION_VERSION,
    },
  });
  const retained = taskProgress.computeTaskProgress(store, ROOT_USER_ID, "ROOT_7D_RESET", {
    activityTaskSourceFacts: invalidatedFacts,
    activityTaskSourceFactsLoaded: true,
  }).tasks.find((task) => task.taskActivityAssignmentId === ASSIGNMENT_ID);
  assert.equal(retained.status, "DONE");
  assert.equal(retained.sourceInvalidated, true);
});

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => (
    resolve(`http://127.0.0.1:${server.address().port}`)
  )));
}

async function request(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  return { status: response.status, body: await response.json() };
}

test("Task Progress HTTP Interface exposes consumed Activity assignments without enrollment status", async (t) => {
  let rootUserId = "";
  const server = createApp({
    env: { ROOT_ALLOW_OPENID_LOGIN: "true" },
    activityTaskReadAdapter: {
      async listByRootUser(inputRootUserId) {
        rootUserId = inputRootUserId;
        return normalizeFacts([row({ root_user_id: inputRootUserId })], inputRootUserId);
      },
    },
  });
  const baseUrl = await listen(server);
  t.after(() => server.close());
  const login = await request(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ openid: "activity-task-read-http", appCode: "MYROOT" }),
  });
  const token = login.body.data.token;
  server.store.taskDefinitions.push({
    ...data().taskDefinitions[0],
  });
  server.store.activityDefinitionVersions.push({
    ...data().activityDefinitionVersions[0],
  });
  const progress = await request(baseUrl, "/api/v1/tasks/progress", {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(progress.status, 200);
  assert.equal(progress.body.code, 0);
  assert.equal(rootUserId, login.body.data.user.rootUserId);
  const task = progress.body.data.progress.tasks.find((item) => item.taskActivityAssignmentId === ASSIGNMENT_ID);
  assert.equal(task.taskDefinitionVersion, TASK_DEFINITION_VERSION);
  assert.equal(Object.hasOwn(task, "activityEnrollmentStatus"), false);
});
