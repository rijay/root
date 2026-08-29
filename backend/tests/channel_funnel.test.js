const assert = require("node:assert/strict");
const test = require("node:test");

const channelFunnel = require("../src/channelFunnel");
const v060Api = require("../src/v060Api");
const { createStore } = require("../src/domain");

function command(overrides = {}) {
  return {
    operatorId: "channel-operator",
    requestId: `req-${Math.random().toString(36).slice(2)}`,
    ...overrides,
  };
}

function createChannelAndCode(data, channelId, campaignId) {
  channelFunnel.upsertChannel(data, command({ channelId, campaignId, status: "ACTIVE" }));
  return channelFunnel.createCode(data, command({
    channelId,
    label: `${channelId} 桌卡`,
    status: "ACTIVE",
    envVersion: "release",
  })).code;
}

test("short-code visits preserve first touch while each assessment keeps its scan source", () => {
  const data = createStore();
  const codeA = createChannelAndCode(data, "CHANNEL_A", "CAMPAIGN_A");
  const codeB = createChannelAndCode(data, "CHANNEL_B", "CAMPAIGN_B");
  const rootUserId = "root_user_channel_test";

  const visitA = channelFunnel.resolveCode(data, {
    shortCode: codeA.shortCode,
    clientVisitId: "client_visit_A_001",
  });
  channelFunnel.recordStage(data, "", { visitId: visitA.visitId, stage: "INTRO_VIEW" });
  channelFunnel.recordStage(data, "", { visitId: visitA.visitId, stage: "START_CLICK" });
  channelFunnel.bindFirstTouch(data, rootUserId, { visitId: visitA.visitId });
  const sourceA = channelFunnel.assessmentSource(data, rootUserId, { channelVisitId: visitA.visitId });
  const assessmentA = { assessment_id: "assessment_A", source_visit_id: sourceA.sourceVisitId };
  channelFunnel.assessmentStage(data, rootUserId, assessmentA, "ASSESSMENT_CREATED");
  channelFunnel.assessmentStage(data, rootUserId, assessmentA, "ASSESSMENT_COMPLETED");
  channelFunnel.assessmentStage(data, rootUserId, assessmentA, "RESULT_VIEWED");

  const visitB = channelFunnel.resolveCode(data, {
    shortCode: codeB.shortCode,
    clientVisitId: "client_visit_B_001",
  });
  channelFunnel.recordStage(data, "", { visitId: visitB.visitId, stage: "INTRO_VIEW" });
  channelFunnel.recordStage(data, "", { visitId: visitB.visitId, stage: "START_CLICK" });
  const kept = channelFunnel.bindFirstTouch(data, rootUserId, { visitId: visitB.visitId });
  const sourceB = channelFunnel.assessmentSource(data, rootUserId, { channelVisitId: visitB.visitId });
  const assessmentB = { assessment_id: "assessment_B", source_visit_id: sourceB.sourceVisitId };
  channelFunnel.assessmentStage(data, rootUserId, assessmentB, "ASSESSMENT_CREATED");
  channelFunnel.assessmentStage(data, rootUserId, assessmentB, "ASSESSMENT_COMPLETED");
  channelFunnel.assessmentStage(data, rootUserId, assessmentB, "RESULT_VIEWED");

  assert.equal(kept.result, "EXISTING_KEPT");
  assert.equal(data.channelAttributions.length, 1);
  assert.equal(data.channelAttributions[0].channel_id, "CHANNEL_A");
  assert.equal(sourceA.sourceChannel, "CHANNEL_A");
  assert.equal(sourceB.sourceChannel, "CHANNEL_B");
  assert.notEqual(sourceA.sourceVisitId, sourceB.sourceVisitId);

  const report = channelFunnel.report(data);
  assert.equal(report.totals.SCAN_OPEN, 2);
  assert.equal(report.totals.ASSESSMENT_COMPLETED, 2);
  assert.equal(report.rows.find((row) => row.channelId === "CHANNEL_A").counts.RESULT_VIEWED, 1);
  assert.equal(report.rows.find((row) => row.channelId === "CHANNEL_B").counts.RESULT_VIEWED, 1);
});

test("channel stages are idempotent and archived codes stop resolving", () => {
  const data = createStore();
  const code = createChannelAndCode(data, "CHANNEL_PAUSE", "CAMPAIGN_PAUSE");
  const visit = channelFunnel.resolveCode(data, {
    shortCode: code.shortCode,
    clientVisitId: "client_visit_pause_001",
  });
  assert.equal(channelFunnel.recordStage(data, "", { visitId: visit.visitId, stage: "INTRO_VIEW" }).recorded, true);
  assert.equal(channelFunnel.recordStage(data, "", { visitId: visit.visitId, stage: "INTRO_VIEW" }).recorded, false);
  channelFunnel.updateCodeStatus(data, code.channelQrCodeId, command({ status: "PAUSED" }));
  assert.throws(
    () => channelFunnel.resolveCode(data, { shortCode: code.shortCode, clientVisitId: "client_visit_pause_002" }),
    (error) => error.code === "CHANNEL_CODE_UNAVAILABLE",
  );
});

test("an owned assessment result cannot be attached to a different scan visit", () => {
  const data = createStore();
  const codeA = createChannelAndCode(data, "CHANNEL_SOURCE_A", "CAMPAIGN_SOURCE_A");
  const codeB = createChannelAndCode(data, "CHANNEL_SOURCE_B", "CAMPAIGN_SOURCE_B");
  const visitA = channelFunnel.resolveCode(data, { shortCode: codeA.shortCode, clientVisitId: "client_source_A_001" });
  const visitB = channelFunnel.resolveCode(data, { shortCode: codeB.shortCode, clientVisitId: "client_source_B_001" });
  data.users.push({ user_id: "user_channel_source", root_user_id: "root_channel_source" });
  data.sessions.push({
    session_id: "session_channel_source",
    user_id: "user_channel_source",
    token: "channel-source-token",
    expires_at: "2099-01-01T00:00:00.000Z",
  });
  data.healthAssessmentAttempts.push({
    assessment_id: "assessment_channel_source",
    root_user_id: "root_channel_source",
    source_visit_id: visitA.visitId,
  });

  assert.throws(
    () => v060Api.recordChannelFunnelStage(data, "channel-source-token", {
      visitId: visitB.visitId,
      assessmentId: "assessment_channel_source",
      stage: "RESULT_VIEWED",
    }),
    (error) => error.code === 6102,
  );
});
