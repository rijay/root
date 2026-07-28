const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createMysqlActivityTaskTransportInspector,
} = require("../src/mysqlActivityTaskTransportInspector");

const ZERO_ROW = Object.freeze({
  outbox_active_count: 0,
  outbox_retry_pending_count: 0,
  outbox_dead_letter_count: 0,
  inbox_active_count: 0,
  inbox_retry_pending_count: 0,
  inbox_terminal_attention_count: 0,
  open_dead_letter_count: 0,
  blocked_checkpoint_count: 0,
  registration_mismatch_count: 0,
});

function poolFor(row) {
  const calls = [];
  const connection = {
    async execute(sql) {
      calls.push(sql);
      if (/^SET SESSION/.test(sql)) return [[], []];
      return [[row], []];
    },
    release() { calls.push("RELEASE"); },
    destroy() { calls.push("DESTROY"); },
  };
  return {
    calls,
    pool: { async getConnection() { return connection; } },
  };
}

test("Activity task transport inspector reports healthy persisted queues", async () => {
  const harness = poolFor(ZERO_ROW);
  const result = await createMysqlActivityTaskTransportInspector({ pool: harness.pool }).inspect();
  assert.equal(result.status, "HEALTHY");
  assert.deepEqual(result.counts, ZERO_ROW);
  assert.match(harness.calls[1], /FROM outbox_event/);
  assert.match(harness.calls[1], /FROM inbox_receipt/);
  assert.match(harness.calls[1], /FROM event_dead_letter/);
  assert.match(harness.calls[1], /FROM consumer_checkpoint/);
  assert.equal(harness.calls.at(-1), "RELEASE");
});

test("retry, dead-letter, checkpoint and registration drift remain observable", async () => {
  const harness = poolFor({
    ...ZERO_ROW,
    outbox_retry_pending_count: 2,
    inbox_terminal_attention_count: 1,
    open_dead_letter_count: 1,
    blocked_checkpoint_count: 1,
    registration_mismatch_count: 1,
  });
  const result = await createMysqlActivityTaskTransportInspector({ pool: harness.pool }).inspect();
  assert.equal(result.status, "ATTENTION_REQUIRED");
  assert.equal(result.counts.outbox_retry_pending_count, 2);
  assert.equal(result.counts.open_dead_letter_count, 1);
});

test("invalid persisted counts fail closed and destroy the connection", async () => {
  const harness = poolFor({ ...ZERO_ROW, open_dead_letter_count: -1 });
  await assert.rejects(
    () => createMysqlActivityTaskTransportInspector({ pool: harness.pool }).inspect(),
    { code: "ACTIVITY_TASK_TRANSPORT_PERSISTENCE_FAILED" }
  );
  assert.equal(harness.calls.at(-1), "DESTROY");
});
