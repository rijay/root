const assert = require("node:assert/strict");
const test = require("node:test");

const domain = require("../src/domain");

const CAMPAIGN_ID = "ROOT_7D_RESET";
const TEMPLATE_ID = "tmpl_protected_checkin";
const TEMPLATE_VERSION = "v1-test";
const RELEASE_ID = "rel_test_1";
const DECIDED_AT = "2026-07-18T01:00:00.000Z";
const DUE_AT = "2026-07-19T01:00:00.000Z";

function protectedEnv(overrides = {}) {
  return {
    NODE_ENV: "production",
    MYROOT_NOTIFICATION_DELIVERY_FOUNDATION_ENABLED: "true",
    ROOT_CHECKIN_REMINDER_TEMPLATE_ID: TEMPLATE_ID,
    ROOT_CHECKIN_REMINDER_TEMPLATE_VERSION: TEMPLATE_VERSION,
    ROOT_CHECKIN_REMINDER_HOUR: "9",
    ROOT_RELEASE_ID: RELEASE_ID,
    ROOT_NOTIFICATION_PROVIDER_RECEIPT_HMAC_KEY:
      "protected-checkin-reminder-test-hmac-secret-2026",
    ROOT_NOTIFICATION_PROVIDER_RECEIPT_HMAC_KEY_ID: "test-key-1",
    ROOT_COMMAND_REQUEST_DIGEST_KEY:
      "protected-recipient-binding-test-key-with-strong-entropy-2026",
    ROOT_COMMAND_REQUEST_DIGEST_KEY_ID: "protected-recipient-binding-test-v1",
    ...overrides,
  };
}

function runtimeContext(core, overrides = {}) {
  const env = overrides.env || protectedEnv();
  return {
    transactionCheckpoint: async () => {},
    transactionResume: async () => {},
    ...overrides,
    env,
    notificationDeliveryCore: core || null,
    runtimeMetadata: {
      releaseId: RELEASE_ID,
      releaseIdConfigured: true,
    },
  };
}

function decisionBody(overrides = {}) {
  return {
    campaignId: CAMPAIGN_ID,
    templateKey: "CHECKIN_REMINDER_NEXT_DAY",
    templateId: TEMPLATE_ID,
    templateVersion: TEMPLATE_VERSION,
    grantRequestId: "grant-request-protected-1",
    decidedAt: DECIDED_AT,
    result: "accept",
    subscribed: true,
    trigger: "TASK_PAGE",
    ...overrides,
  };
}

function createCore(overrides = {}) {
  const calls = [];
  let latestAttempt = null;
  let latestRecipientBinding = null;
  const core = {
    assertReady() {
      calls.push({ name: "assertReady" });
      return { enabled: true, ownsTransactions: true, networkEnabled: false };
    },
    async recordDecision(input) {
      calls.push({ name: "recordDecision", input });
      latestRecipientBinding = input.nativeDecision === "ACCEPTED" ? {
        recipientBindingStatus: "VERIFIED",
        recipientWechatIdentityId: input.recipientWechatIdentityId,
        recipientAppCode: input.recipientAppCode,
        recipientBindingCanonicalVersion: input.recipientBindingCanonicalVersion,
        recipientBindingDigest: input.recipientBindingDigest,
        recipientBindingDigestScheme: input.recipientBindingDigestScheme,
        recipientBindingKeyId: input.recipientBindingKeyId,
      } : null;
      if (overrides.recordDecision) return overrides.recordDecision(input, calls);
      return {
        attemptId: "nsa_core_decision_1",
        grantId: "nsg_core_grant_1",
        grantRequestId: input.grantRequestId,
        nativeDecision: input.nativeDecision,
        grantStatus: "AVAILABLE",
        recipientBindingStatus: "VERIFIED",
        recipientWechatIdentityId: input.recipientWechatIdentityId,
        recipientAppCode: input.recipientAppCode,
        recipientBindingCanonicalVersion: input.recipientBindingCanonicalVersion,
        recipientBindingDigest: input.recipientBindingDigest,
        recipientBindingDigestScheme: input.recipientBindingDigestScheme,
        recipientBindingKeyId: input.recipientBindingKeyId,
        replayed: false,
        commitAcknowledgementRecovered: false,
      };
    },
    async schedule(input) {
      calls.push({ name: "schedule", input });
      if (overrides.schedule) return overrides.schedule(input, calls);
      return {
        jobId: "ntj_core_job_1",
        grantId: input.grantId,
        status: "SCHEDULED",
        replayed: false,
        commitAcknowledgementRecovered: false,
      };
    },
    async beginSendAttempt(input) {
      calls.push({ name: "beginSendAttempt", input });
      const result = {
        attemptId: "nsp_core_send_1",
        jobId: input.jobId,
        attemptNumber: 1,
        provider: "WECHAT",
        status: "REQUESTED",
        transitionVersion: 1,
        transitionFenceDigest: input.transitionFenceDigest,
        requestDigest: input.requestDigest,
        providerReceiptDigest: null,
        providerReceiptDigestScheme: null,
        providerReceiptDigestKeyId: null,
        stableErrorCode: null,
        releaseId: input.releaseId,
        providerCallAuthorized: false,
        providerCallCheckpointRequired: true,
        providerCallState: "AVAILABLE",
        providerCallGeneration: 0,
        providerCallLeaseExpiresAt: null,
        providerCallStartedAt: null,
        replayed: false,
        commitAcknowledgementRecovered: false,
        ...(overrides.beginSendAttempt
          ? await overrides.beginSendAttempt(input, calls)
          : {}),
      };
      latestAttempt = { ...latestRecipientBinding, ...result };
      return { ...latestAttempt };
    },
    async claimProviderCall(input) {
      calls.push({ name: "claimProviderCall", input });
      if (overrides.claimProviderCall) {
        return overrides.claimProviderCall(input, calls, latestAttempt);
      }
      latestAttempt = {
        ...latestAttempt,
        providerCallState: "LEASED",
        providerCallGeneration: Number(latestAttempt.providerCallGeneration || 0) + 1,
        providerCallLeaseExpiresAt: "2026-07-19 01:00:30.000",
      };
      return {
        ...latestAttempt,
        leaseAcquired: true,
        leaseOwner: "npc_test_owner_1",
        leaseGeneration: latestAttempt.providerCallGeneration,
      };
    },
    async startProviderCall(input) {
      calls.push({ name: "startProviderCall", input });
      if (overrides.startProviderCall) {
        return overrides.startProviderCall(input, calls, latestAttempt);
      }
      latestAttempt = {
        ...latestAttempt,
        providerCallState: "STARTED",
        providerCallStartedAt: "2026-07-19 01:00:00.000",
      };
      return {
        ...latestAttempt,
        providerCallStarted: true,
        leaseOwner: input.leaseOwner,
        leaseGeneration: input.leaseGeneration,
      };
    },
    async inspectSendAttempt(input) {
      calls.push({ name: "inspectSendAttempt", input });
      if (overrides.inspectSendAttempt) return overrides.inspectSendAttempt(input, calls, latestAttempt);
      if (!latestAttempt || latestAttempt.attemptId !== input.attemptId) {
        const error = new Error("attempt not found");
        error.code = "NOTIFICATION_DELIVERY_CONFLICT_REVIEW_REQUIRED";
        throw error;
      }
      return {
        ...latestAttempt,
        replayed: true,
        inspected: true,
        transactionState: "READ_ONLY_ROLLBACK",
      };
    },
    async completeSendAttempt(input) {
      calls.push({ name: "completeSendAttempt", input });
      const result = overrides.completeSendAttempt
        ? await overrides.completeSendAttempt(input, calls, latestAttempt)
        : {
        attemptId: input.attemptId,
        jobId: "ntj_core_job_1",
        status: input.outcome,
        transitionVersion: input.expectedTransitionVersion + 1,
        replayed: false,
        commitAcknowledgementRecovered: false,
      };
      latestAttempt = {
        ...latestAttempt,
        ...result,
        attemptId: input.attemptId,
        jobId: (latestAttempt && latestAttempt.jobId) || "ntj_core_job_1",
        attemptNumber: 1,
        provider: "WECHAT",
        status: result.status || input.outcome,
        transitionVersion: input.expectedTransitionVersion + 1,
        transitionFenceDigest: input.nextTransitionFenceDigest,
        requestDigest: latestAttempt && latestAttempt.requestDigest,
        providerReceiptDigest: input.outcome === "ACCEPTED" ? "a".repeat(64) : null,
        providerReceiptDigestScheme: input.outcome === "ACCEPTED" ? "hmac-sha256:v1" : null,
        providerReceiptDigestKeyId: input.outcome === "ACCEPTED" ? "test-key-1" : null,
        stableErrorCode: input.stableErrorCode,
        releaseId: input.releaseId,
        providerCallAuthorized: false,
        providerCallCheckpointRequired: false,
        providerCallState: "COMPLETED",
        providerCallGeneration: input.leaseGeneration,
      };
      return { ...latestAttempt };
    },
    async recoverProviderCall(input) {
      calls.push({ name: "recoverProviderCall", input });
      if (overrides.recoverProviderCall) {
        return overrides.recoverProviderCall(input, calls, latestAttempt);
      }
      return {
        ...latestAttempt,
        providerCallRecoveredUnknown: false,
      };
    },
  };
  return { core, calls };
}

function requestedCoreAttempt(input, overrides = {}) {
  return {
    attemptId: "nsp_core_send_revalidation_1",
    jobId: input.jobId,
    attemptNumber: 1,
    provider: "WECHAT",
    status: "REQUESTED",
    transitionVersion: 1,
    transitionFenceDigest: input.transitionFenceDigest,
    requestDigest: input.requestDigest,
    providerReceiptDigest: null,
    providerReceiptDigestScheme: null,
    providerReceiptDigestKeyId: null,
    stableErrorCode: null,
    releaseId: input.releaseId,
    providerCallAuthorized: false,
    providerCallCheckpointRequired: true,
    providerCallState: "AVAILABLE",
    providerCallGeneration: 0,
    providerCallLeaseExpiresAt: null,
    providerCallStartedAt: null,
    replayed: false,
    commitAcknowledgementRecovered: false,
    ...overrides,
  };
}

async function loginAndJoin(store, env = protectedEnv()) {
  const login = await domain.loginWithWechat(store, {
    openid: `protected_reminder_${Math.random().toString(16).slice(2)}_openid`,
    appCode: "MYROOT",
  }, {
    ROOT_ALLOW_OPENID_LOGIN: "true",
  });
  domain.joinCampaign(store, login.data.token, { campaignId: CAMPAIGN_ID }, {
    env,
    date: "2026-07-18",
  });
  return login.data.token;
}

async function prepareScheduledJob(coreRecord, env = protectedEnv()) {
  const store = domain.createStore();
  const token = await loginAndJoin(store, env);
  const recorded = await domain.recordCheckinReminderSubscription(
    store,
    token,
    decisionBody(),
    runtimeContext(coreRecord.core, { env })
  );
  assert.equal(recorded.data.notificationCore.authority, "MYSQL_NOTIFICATION_DELIVERY_CORE_V1");
  assert.equal(store.notificationJobs.length, 1);
  assert.equal(store.notificationJobs[0].notification_core_authoritative, true);
  assert.equal(store.notificationJobs[0].authority, "MYSQL_NOTIFICATION_DELIVERY_CORE_V1");
  assert.equal(store.notificationJobs[0].scheduled_at, DUE_AT);
  return { store, token };
}

test("protected subscription fails closed without the relational Notification Delivery Core", async () => {
  const store = domain.createStore();
  const env = protectedEnv();
  const token = await loginAndJoin(store, env);

  await assert.rejects(
    () => domain.recordCheckinReminderSubscription(
      store,
      token,
      decisionBody(),
      runtimeContext(null, { env })
    ),
    (error) => error.code === "CHECKIN_REMINDER_NOTIFICATION_CORE_REQUIRED"
  );
  assert.equal(store.notificationSubscriptions.length, 0);
  assert.equal(store.notificationSubscriptionGrants.length, 0);
  assert.equal(store.notificationJobs.length, 0);

  await assert.rejects(
    () => domain.runDueCheckinReminders(store, { now: DUE_AT }, runtimeContext(null, { env })),
    (error) => error.code === "CHECKIN_REMINDER_NOTIFICATION_CORE_REQUIRED"
  );
});

test("protected subscription writes decision and schedule before creating the snapshot mirror", async () => {
  const coreRecord = createCore();
  const { store } = await prepareScheduledJob(coreRecord);
  const writes = coreRecord.calls.filter((call) => ["recordDecision", "schedule"].includes(call.name));

  assert.deepEqual(writes.map((call) => call.name), ["recordDecision", "schedule"]);
  assert.equal(writes[0].input.taskId, "td_root_7d_checkin");
  assert.equal(writes[0].input.taskOccurrenceDate, "2026-07-19");
  assert.equal(writes[0].input.releaseId, RELEASE_ID);
  assert.equal(writes[1].input.dueAt, DUE_AT);
  assert.equal(store.notificationSubscriptionGrants[0].notification_subscription_grant_id, "nsg_core_grant_1");
  assert.equal(store.notificationJobs[0].notification_job_id, "ntj_core_job_1");
});

test("protected runner keeps real sending disabled by default and never begins an attempt", async () => {
  const coreRecord = createCore();
  const { store } = await prepareScheduledJob(coreRecord);
  coreRecord.calls.length = 0;
  let sendCount = 0;

  await assert.rejects(
    () => domain.runDueCheckinReminders(store, { now: DUE_AT }, runtimeContext(coreRecord.core, {
      sendSubscribeMessage: async () => {
        sendCount += 1;
        return { errcode: 0 };
      },
    })),
    (error) => error.code === "CHECKIN_REMINDER_REAL_SEND_DISABLED"
  );
  assert.equal(sendCount, 0);
  assert.equal(coreRecord.calls.some((call) => call.name === "beginSendAttempt"), false);
  assert.equal(store.notificationJobs[0].status, "SCHEDULED");
});

test("protected runner refuses a legacy or non-MYROOT openid recipient", async () => {
  const coreRecord = createCore();
  const { store } = await prepareScheduledJob(coreRecord);
  const rootUserId = store.notificationJobs[0].root_user_id;
  store.wechatIdentities = [{
    wechat_identity_id: "wxi_member_center_only",
    root_user_id: rootUserId,
    app_code: "ROOT_MEMBER_CENTER",
    openid: "member_center_recipient_must_not_send",
    unionid: "",
    unionid_status: "PENDING",
    created_at: DECIDED_AT,
    updated_at: DECIDED_AT,
    last_seen_at: DECIDED_AT,
  }];
  const legacyUser = store.users.find((item) => (item.root_user_id || item.user_id) === rootUserId);
  legacyUser.app_code = "ROOT_MEMBER_CENTER";
  legacyUser.openid = "legacy_recipient_must_not_send";
  coreRecord.calls.length = 0;

  const result = await domain.runDueCheckinReminders(
    store,
    { now: DUE_AT, dryRun: true },
    runtimeContext(coreRecord.core)
  );

  assert.equal(result.data.results[0].status, "CORE_REVIEW_TRANSITION_REQUIRED");
  assert.equal(result.data.results[0].errorCode, "CHECKIN_REMINDER_RECIPIENT_IDENTITY_REQUIRED");
  assert.equal(coreRecord.calls.some((call) => call.name === "beginSendAttempt"), false);
  assert.doesNotMatch(JSON.stringify(result), /member_center_recipient_must_not_send|legacy_recipient_must_not_send/);
});

test("begin persistence failure prevents the external send Adapter", async () => {
  const coreRecord = createCore({
    beginSendAttempt() {
      const error = new Error("begin did not persist");
      error.code = "NOTIFICATION_DELIVERY_PERSISTENCE_FAILED";
      throw error;
    },
  });
  const env = protectedEnv({ ROOT_CHECKIN_REMINDER_SEND_ENABLED: "true" });
  const { store } = await prepareScheduledJob(coreRecord, env);
  let sendCount = 0;
  const result = await domain.runDueCheckinReminders(store, { now: DUE_AT }, runtimeContext(coreRecord.core, {
    env,
    sendSubscribeMessage: async () => {
      sendCount += 1;
      return { errcode: 0 };
    },
  }));

  assert.equal(sendCount, 0);
  assert.equal(result.data.results[0].status, "CORE_BEGIN_UNCONFIRMED");
  assert.equal(result.data.results[0].errorCode, "NOTIFICATION_DELIVERY_PERSISTENCE_FAILED");
  assert.equal(store.notificationJobs[0].status, "SCHEDULED");
  assert.equal(store.notificationSubscriptionGrants[0].status, "AVAILABLE");
});

test("identity change during durable begin is blocked by the final provider-seam revalidation", async () => {
  let sendCount = 0;
  let store;
  const coreRecord = createCore({
    async beginSendAttempt(input) {
      const identity = store.wechatIdentities.find((item) => item.app_code === "MYROOT");
      identity.openid = `${identity.openid}_changed_during_begin`;
      return requestedCoreAttempt(input);
    },
  });
  const env = protectedEnv({ ROOT_CHECKIN_REMINDER_SEND_ENABLED: "true" });
  ({ store } = await prepareScheduledJob(coreRecord, env));
  const result = await domain.runDueCheckinReminders(store, { now: DUE_AT }, runtimeContext(
    coreRecord.core,
    {
      env,
      sendSubscribeMessage: async () => {
        sendCount += 1;
        return { errcode: 0, errmsg: "ok" };
      },
    }
  ));

  assert.equal(result.data.results[0].status, "REVIEW_REQUIRED");
  assert.equal(result.data.results[0].errorCode, "CHECKIN_REMINDER_RECIPIENT_BINDING_INVALID");
  assert.equal(sendCount, 0);
});

test("Core recipient digest drift after durable begin is blocked before provider send", async () => {
  let sendCount = 0;
  const coreRecord = createCore({
    async beginSendAttempt(input) {
      return requestedCoreAttempt(input, { recipientBindingDigest: "e".repeat(64) });
    },
  });
  const env = protectedEnv({ ROOT_CHECKIN_REMINDER_SEND_ENABLED: "true" });
  const { store } = await prepareScheduledJob(coreRecord, env);
  const result = await domain.runDueCheckinReminders(store, { now: DUE_AT }, runtimeContext(
    coreRecord.core,
    {
      env,
      sendSubscribeMessage: async () => {
        sendCount += 1;
        return { errcode: 0, errmsg: "ok" };
      },
    }
  ));

  assert.equal(result.data.results[0].status, "REVIEW_REQUIRED");
  assert.equal(result.data.results[0].errorCode, "CHECKIN_REMINDER_CORE_RECIPIENT_BINDING_MISMATCH");
  assert.equal(sendCount, 0);
});

test("terminal Core readback rejects cleared or valid-looking replaced recipient bindings", async (t) => {
  for (const scenario of [
    {
      name: "cleared",
      mutation: {
        recipientBindingStatus: "UNVERIFIED",
        recipientWechatIdentityId: null,
        recipientAppCode: null,
        recipientBindingCanonicalVersion: null,
        recipientBindingDigest: null,
        recipientBindingDigestScheme: null,
        recipientBindingKeyId: null,
      },
      errorCode: "CHECKIN_REMINDER_CORE_INSPECTION_INVALID",
    },
    {
      name: "valid-looking replacement",
      mutation: { recipientBindingDigest: "e".repeat(64) },
      errorCode: "CHECKIN_REMINDER_CORE_RECIPIENT_BINDING_MISMATCH",
    },
  ]) {
    await t.test(scenario.name, async () => {
      let sendCount = 0;
      const coreRecord = createCore({
        completeSendAttempt(input) {
          return {
            attemptId: input.attemptId,
            status: input.outcome,
            ...scenario.mutation,
          };
        },
      });
      const env = protectedEnv({ ROOT_CHECKIN_REMINDER_SEND_ENABLED: "true" });
      const { store } = await prepareScheduledJob(coreRecord, env);
      const result = await domain.runDueCheckinReminders(store, { now: DUE_AT }, runtimeContext(
        coreRecord.core,
        {
          env,
          sendSubscribeMessage: async () => {
            sendCount += 1;
            return { errcode: 0, errmsg: "ok", msgid: "provider-msg-1" };
          },
        }
      ));

      assert.equal(result.data.results[0].status, "REVIEW_REQUIRED");
      assert.equal(result.data.results[0].errorCode, scenario.errorCode);
      assert.equal(sendCount, 1);
      assert.equal(store.notificationSubscriptionGrants[0].status, "REVIEW_REQUIRED");
    });
  }
});

test("begin COMMIT acknowledgement recovery claims the durable attempt and sends only once", async () => {
  const coreRecord = createCore({
    beginSendAttempt(input) {
      return {
        attemptId: "nsp_core_send_1",
        jobId: input.jobId,
        attemptNumber: 1,
        provider: "WECHAT",
        status: "REQUESTED",
        transitionVersion: 1,
        transitionFenceDigest: input.transitionFenceDigest,
        requestDigest: input.requestDigest,
        releaseId: input.releaseId,
        providerCallAuthorized: false,
        providerCallCheckpointRequired: true,
        replayed: true,
        commitAcknowledgementRecovered: true,
      };
    },
  });
  const env = protectedEnv({ ROOT_CHECKIN_REMINDER_SEND_ENABLED: "true" });
  const { store } = await prepareScheduledJob(coreRecord, env);
  let sendCount = 0;
  const context = runtimeContext(coreRecord.core, {
    env,
    sendSubscribeMessage: async () => {
      sendCount += 1;
      return { errcode: 0 };
    },
  });

  const first = await domain.runDueCheckinReminders(store, { now: DUE_AT }, context);
  const second = await domain.runDueCheckinReminders(store, { now: DUE_AT }, context);
  assert.equal(first.data.results[0].status, "PROVIDER_ACCEPTED");
  assert.equal(second.data.scannedCount, 0);
  assert.equal(sendCount, 1);
  assert.deepEqual(
    coreRecord.calls
      .filter((call) => ["claimProviderCall", "startProviderCall", "completeSendAttempt"].includes(call.name))
      .map((call) => call.name),
    ["claimProviderCall", "startProviderCall", "completeSendAttempt"]
  );
  assert.equal(store.notificationJobs[0].status, "PROVIDER_ACCEPTED");
  assert.equal(store.notificationSubscriptionGrants[0].status, "CONSUMED");
});

test("a SCHEDULED mirror with durable STARTED recovers UNKNOWN and never sends", async () => {
  const beginInputs = [];
  const coreRecord = createCore({
    beginSendAttempt(input) {
      beginInputs.push(input);
      return {
        attemptId: "nsp_core_send_1",
        jobId: input.jobId,
        attemptNumber: 1,
        provider: "WECHAT",
        status: "REQUESTED",
        transitionVersion: 1,
        transitionFenceDigest: input.transitionFenceDigest,
        requestDigest: input.requestDigest,
        releaseId: input.releaseId,
        providerCallState: "STARTED",
        providerCallGeneration: 1,
        providerCallLeaseExpiresAt: "2026-07-19 01:00:30.000",
        providerCallStartedAt: "2026-07-19 01:00:00.000",
        replayed: true,
        commitAcknowledgementRecovered: false,
      };
    },
    recoverProviderCall(input, calls, latestAttempt) {
      return {
        ...latestAttempt,
        status: "UNKNOWN",
        transitionVersion: 2,
        transitionFenceDigest: "f".repeat(64),
        stableErrorCode: "PROVIDER_RESULT_UNKNOWN",
        providerCallCheckpointRequired: false,
        providerCallState: "COMPLETED",
        providerCallGeneration: 1,
        providerCallLeaseExpiresAt: null,
        providerCallStartedAt: "2026-07-19 01:00:00.000",
        providerCallRecoveredUnknown: true,
      };
    },
  });
  const env = protectedEnv({ ROOT_CHECKIN_REMINDER_SEND_ENABLED: "true" });
  const { store } = await prepareScheduledJob(coreRecord, env);
  let sendCount = 0;
  const context = runtimeContext(coreRecord.core, {
    env,
    sendSubscribeMessage: async () => {
      sendCount += 1;
      return { errcode: 0 };
    },
  });

  const first = await domain.runDueCheckinReminders(store, { now: DUE_AT }, context);
  const second = await domain.runDueCheckinReminders(store, { now: DUE_AT }, context);

  assert.deepEqual(beginInputs.map((input) => input.startedAt), [DUE_AT]);
  assert.equal(first.data.results[0].status, "OUTCOME_UNKNOWN");
  assert.equal(first.data.results[0].errorCode, "PROVIDER_RESULT_UNKNOWN");
  assert.equal(second.data.scannedCount, 0);
  assert.equal(sendCount, 0);
  assert.equal(store.notificationJobs[0].status, "OUTCOME_UNKNOWN");
  assert.equal(store.notificationSubscriptionGrants[0].status, "REVIEW_REQUIRED");
  assert.equal(coreRecord.calls.filter((call) => call.name === "recoverProviderCall").length, 1);
});

test("completion acknowledgement recovery retries only completion, never provider send", async () => {
  let completionCount = 0;
  const order = [];
  const coreRecord = createCore({
    beginSendAttempt(input) {
      order.push("begin");
      return {
        attemptId: "nsp_core_send_1",
        jobId: input.jobId,
        attemptNumber: 1,
        provider: "WECHAT",
        status: "REQUESTED",
        transitionVersion: 1,
        transitionFenceDigest: input.transitionFenceDigest,
        requestDigest: input.requestDigest,
        releaseId: input.releaseId,
        providerCallAuthorized: false,
        providerCallCheckpointRequired: true,
        replayed: false,
        commitAcknowledgementRecovered: false,
      };
    },
    completeSendAttempt(input) {
      completionCount += 1;
      order.push("complete");
      if (completionCount === 1) {
        const error = new Error("commit acknowledgement unknown");
        error.code = "NOTIFICATION_DELIVERY_COMMIT_OUTCOME_UNKNOWN";
        throw error;
      }
      return { attemptId: input.attemptId, status: input.outcome };
    },
  });
  const env = protectedEnv({ ROOT_CHECKIN_REMINDER_SEND_ENABLED: "true" });
  const { store } = await prepareScheduledJob(coreRecord, env);
  let sendCount = 0;
  const context = runtimeContext(coreRecord.core, {
    env,
    sendSubscribeMessage: async () => {
      order.push("send");
      sendCount += 1;
      return { errcode: 0, errmsg: "ok", msgid: "transient-provider-id" };
    },
  });

  const first = await domain.runDueCheckinReminders(store, { now: DUE_AT }, context);
  const second = await domain.runDueCheckinReminders(store, { now: DUE_AT }, context);
  assert.deepEqual(order, ["begin", "send", "complete", "complete"]);
  assert.equal(sendCount, 1);
  assert.equal(completionCount, 2);
  assert.equal(first.data.results[0].status, "PROVIDER_ACCEPTED");
  assert.equal(second.data.scannedCount, 0);
  assert.doesNotMatch(JSON.stringify(store.notificationDeliveries), /transient-provider-id/);
});

test("unknown provider outcome becomes relational OUTCOME_UNKNOWN and is never resent", async () => {
  let completionInput = null;
  const coreRecord = createCore({
    completeSendAttempt(input) {
      completionInput = input;
      return { attemptId: input.attemptId, status: input.outcome };
    },
  });
  const env = protectedEnv({ ROOT_CHECKIN_REMINDER_SEND_ENABLED: "true" });
  const { store } = await prepareScheduledJob(coreRecord, env);
  let sendCount = 0;
  const context = runtimeContext(coreRecord.core, {
    env,
    sendSubscribeMessage: async () => {
      sendCount += 1;
      const error = new Error("transport ended without a provider acknowledgement");
      error.deliveryOutcome = "UNKNOWN";
      throw error;
    },
  });

  const first = await domain.runDueCheckinReminders(store, { now: DUE_AT }, context);
  const second = await domain.runDueCheckinReminders(store, { now: DUE_AT }, context);
  assert.equal(completionInput.outcome, "UNKNOWN");
  assert.equal(completionInput.stableErrorCode, "NETWORK_OUTCOME_UNKNOWN");
  assert.equal(completionInput.providerReceipt, null);
  assert.equal(first.data.results[0].status, "OUTCOME_UNKNOWN");
  assert.equal(second.data.scannedCount, 0);
  assert.equal(sendCount, 1);
  assert.equal(store.notificationSubscriptionGrants[0].status, "REVIEW_REQUIRED");
});

test("completion ACK loss reads back Core UNKNOWN and converges the mirror without resending", async () => {
  let terminalAttempt = null;
  let completionCount = 0;
  const coreRecord = createCore({
    completeSendAttempt(input, calls, latestAttempt) {
      completionCount += 1;
      terminalAttempt = {
        ...latestAttempt,
        status: "UNKNOWN",
        transitionVersion: input.expectedTransitionVersion + 1,
        transitionFenceDigest: input.nextTransitionFenceDigest,
        providerReceiptDigest: null,
        providerReceiptDigestScheme: null,
        providerReceiptDigestKeyId: null,
        stableErrorCode: input.stableErrorCode,
        providerCallAuthorized: false,
        providerCallCheckpointRequired: false,
      };
      const error = new Error("terminal commit persisted but acknowledgement was lost");
      error.code = "NOTIFICATION_DELIVERY_COMMIT_OUTCOME_UNKNOWN";
      throw error;
    },
    inspectSendAttempt() {
      return {
        ...terminalAttempt,
        replayed: true,
        inspected: true,
        transactionState: "READ_ONLY_ROLLBACK",
      };
    },
  });
  const env = protectedEnv({ ROOT_CHECKIN_REMINDER_SEND_ENABLED: "true" });
  const { store } = await prepareScheduledJob(coreRecord, env);
  let sendCount = 0;
  const context = runtimeContext(coreRecord.core, {
    env,
    sendSubscribeMessage: async () => {
      sendCount += 1;
      const error = new Error("transport ended without a provider acknowledgement");
      error.deliveryOutcome = "UNKNOWN";
      throw error;
    },
  });

  const first = await domain.runDueCheckinReminders(store, { now: DUE_AT }, context);
  const second = await domain.runDueCheckinReminders(store, { now: DUE_AT }, context);

  assert.equal(first.data.results[0].status, "OUTCOME_UNKNOWN");
  assert.equal(first.data.results[0].errorCode, "NETWORK_OUTCOME_UNKNOWN");
  assert.equal(second.data.scannedCount, 0);
  assert.equal(sendCount, 1);
  assert.equal(completionCount, 2);
  assert.equal(store.notificationJobs[0].status, "OUTCOME_UNKNOWN");
  assert.equal(store.notificationSubscriptionGrants[0].status, "REVIEW_REQUIRED");
  assert.equal("providerReceipt" in terminalAttempt, false);
});

test("two runners sharing one durable lease authorize only one provider call", async () => {
  let sendCount = 0;
  let claimCount = 0;
  let signalFirstClaim;
  let releaseFirstClaim;
  const firstClaimReached = new Promise((resolve) => { signalFirstClaim = resolve; });
  const firstClaimRelease = new Promise((resolve) => { releaseFirstClaim = resolve; });
  const coreRecord = createCore({
    async claimProviderCall(input, calls, latestAttempt) {
      claimCount += 1;
      if (claimCount === 1) {
        signalFirstClaim();
        await firstClaimRelease;
        return {
          ...latestAttempt,
          providerCallState: "LEASED",
          providerCallGeneration: 1,
          providerCallLeaseExpiresAt: "2026-07-19 01:00:30.000",
          leaseAcquired: true,
          leaseOwner: "npc_runner_a",
          leaseGeneration: 1,
        };
      }
      return {
        ...latestAttempt,
        providerCallState: "LEASED",
        providerCallGeneration: 1,
        providerCallLeaseExpiresAt: "2026-07-19 01:00:30.000",
        leaseAcquired: false,
        leaseOwner: null,
        leaseGeneration: 1,
      };
    },
  });
  const env = protectedEnv({ ROOT_CHECKIN_REMINDER_SEND_ENABLED: "true" });
  const { store } = await prepareScheduledJob(coreRecord, env);
  const storeA = store;
  const storeB = structuredClone(store);
  const context = runtimeContext(coreRecord.core, {
    env,
    sendSubscribeMessage: async () => {
      sendCount += 1;
      return { errcode: 0, errmsg: "ok" };
    },
  });

  const runnerA = domain.runDueCheckinReminders(storeA, { now: DUE_AT }, context);
  await firstClaimReached;
  const runnerBResult = await domain.runDueCheckinReminders(storeB, { now: DUE_AT }, context);
  assert.equal(runnerBResult.data.results[0].status, "SENDING_PROVIDER_CALL_LEASE_HELD");
  assert.equal(sendCount, 0);

  releaseFirstClaim();
  const runnerAResult = await runnerA;
  assert.equal(runnerAResult.data.results[0].status, "PROVIDER_ACCEPTED");
  assert.equal(claimCount, 2);
  assert.equal(sendCount, 1);
  assert.equal(storeA.notificationJobs[0].status, "PROVIDER_ACCEPTED");
  assert.equal(storeA.notificationSubscriptionGrants[0].status, "CONSUMED");
  assert.equal(storeB.notificationJobs[0].status, "SENDING");
  assert.equal(storeB.notificationSubscriptionGrants[0].status, "RESERVED");
});

test("ordinary STARTED replay is fenced before the Provider Seam", async () => {
  let sendCount = 0;
  let completionCount = 0;
  const coreRecord = createCore({
    startProviderCall(input, calls, latestAttempt) {
      return {
        ...latestAttempt,
        providerCallState: "STARTED",
        providerCallGeneration: input.leaseGeneration,
        providerCallLeaseExpiresAt: "2026-07-19 01:00:30.000",
        providerCallStartedAt: "2026-07-19 01:00:00.000",
        providerCallStarted: true,
        leaseOwner: input.leaseOwner,
        leaseGeneration: input.leaseGeneration,
        replayed: true,
        commitAcknowledgementRecovered: false,
      };
    },
    completeSendAttempt() {
      completionCount += 1;
      return {};
    },
  });
  const env = protectedEnv({ ROOT_CHECKIN_REMINDER_SEND_ENABLED: "true" });
  const { store } = await prepareScheduledJob(coreRecord, env);

  const result = await domain.runDueCheckinReminders(store, { now: DUE_AT }, runtimeContext(
    coreRecord.core,
    {
      env,
      sendSubscribeMessage: async () => {
        sendCount += 1;
        return { errcode: 0, errmsg: "ok" };
      },
    }
  ));

  assert.equal(result.data.results[0].status, "SENDING_PROVIDER_CALL_FENCED");
  assert.equal(result.data.results[0].errorCode, "PROVIDER_CALL_FENCED");
  assert.equal(sendCount, 0);
  assert.equal(completionCount, 0);
  assert.equal(store.notificationJobs[0].status, "SENDING");
  assert.equal(store.notificationSubscriptionGrants[0].status, "RESERVED");
});

test("same-call START COMMIT acknowledgement recovery may cross the Provider Seam once", async () => {
  let sendCount = 0;
  const coreRecord = createCore({
    startProviderCall(input, calls, latestAttempt) {
      return {
        ...latestAttempt,
        providerCallState: "STARTED",
        providerCallGeneration: input.leaseGeneration,
        providerCallLeaseExpiresAt: "2026-07-19 01:00:30.000",
        providerCallStartedAt: "2026-07-19 01:00:00.000",
        providerCallStarted: true,
        leaseOwner: input.leaseOwner,
        leaseGeneration: input.leaseGeneration,
        replayed: true,
        commitAcknowledgementRecovered: true,
      };
    },
  });
  const env = protectedEnv({ ROOT_CHECKIN_REMINDER_SEND_ENABLED: "true" });
  const { store } = await prepareScheduledJob(coreRecord, env);

  const result = await domain.runDueCheckinReminders(store, { now: DUE_AT }, runtimeContext(
    coreRecord.core,
    {
      env,
      sendSubscribeMessage: async () => {
        sendCount += 1;
        return { errcode: 0, errmsg: "ok" };
      },
    }
  ));

  assert.equal(result.data.results[0].status, "PROVIDER_ACCEPTED");
  assert.equal(sendCount, 1);
  assert.equal(store.notificationJobs[0].status, "PROVIDER_ACCEPTED");
  assert.equal(store.notificationSubscriptionGrants[0].status, "CONSUMED");
});

test("2xx JSON without errcode is UNKNOWN rather than a proved provider rejection", async () => {
  let completionInput = null;
  const coreRecord = createCore({
    completeSendAttempt(input) {
      completionInput = input;
      return { attemptId: input.attemptId, status: input.outcome };
    },
  });
  const env = protectedEnv({ ROOT_CHECKIN_REMINDER_SEND_ENABLED: "true" });
  const { store } = await prepareScheduledJob(coreRecord, env);
  const result = await domain.runDueCheckinReminders(store, { now: DUE_AT }, runtimeContext(coreRecord.core, {
    env,
    sendSubscribeMessage: async () => ({}),
  }));

  assert.equal(completionInput.outcome, "UNKNOWN");
  assert.equal(completionInput.stableErrorCode, "PROVIDER_RESULT_UNKNOWN");
  assert.equal(completionInput.providerReceipt, null);
  assert.equal(result.data.results[0].status, "OUTCOME_UNKNOWN");
  assert.equal(store.notificationSubscriptionGrants[0].status, "REVIEW_REQUIRED");
});

test("unrecoverable completion is inspected read-only and keeps REQUESTED as SENDING without auto-resend", async () => {
  let completionCount = 0;
  const completionInputs = [];
  const coreRecord = createCore({
    completeSendAttempt(input) {
      completionCount += 1;
      completionInputs.push(input);
      const error = new Error("complete persistence unavailable");
      error.code = "NOTIFICATION_DELIVERY_COMMIT_OUTCOME_UNKNOWN";
      throw error;
    },
  });
  const env = protectedEnv({ ROOT_CHECKIN_REMINDER_SEND_ENABLED: "true" });
  const { store } = await prepareScheduledJob(coreRecord, env);
  let sendCount = 0;
  const context = runtimeContext(coreRecord.core, {
    env,
    sendSubscribeMessage: async () => {
      sendCount += 1;
      return { errcode: 0, errmsg: "ok" };
    },
  });

  const first = await domain.runDueCheckinReminders(store, { now: DUE_AT }, context);
  const second = await domain.runDueCheckinReminders(store, { now: DUE_AT }, context);
  assert.equal(first.data.results[0].status, "SENDING_REVIEW_REQUIRED");
  assert.equal(second.data.scannedCount, 0);
  assert.equal(sendCount, 1);
  assert.equal(completionCount, 2);
  assert.equal(new Set(completionInputs.map((input) => JSON.stringify(input))).size, 1);
  assert.equal(coreRecord.calls.filter((call) => call.name === "inspectSendAttempt").length, 2);
  assert.equal(store.notificationJobs[0].status, "SENDING");
  assert.equal(store.notificationSubscriptionGrants[0].status, "RESERVED");
});

test("deterministic completion failure never fabricates UNKNOWN and leaves REQUESTED for manual review", async () => {
  let completionCount = 0;
  const completionOutcomes = [];
  const coreRecord = createCore({
    completeSendAttempt(input) {
      completionCount += 1;
      completionOutcomes.push(input.outcome);
      const error = new Error("completion input rejected");
      error.code = "NOTIFICATION_DELIVERY_INPUT_INVALID";
      throw error;
    },
  });
  const env = protectedEnv({ ROOT_CHECKIN_REMINDER_SEND_ENABLED: "true" });
  const { store } = await prepareScheduledJob(coreRecord, env);
  let sendCount = 0;
  const result = await domain.runDueCheckinReminders(store, { now: DUE_AT }, runtimeContext(coreRecord.core, {
    env,
    sendSubscribeMessage: async () => {
      sendCount += 1;
      return { errcode: 0, errmsg: "ok" };
    },
  }));

  assert.equal(completionCount, 1);
  assert.deepEqual(completionOutcomes, ["ACCEPTED"]);
  assert.equal(sendCount, 1);
  assert.equal(result.data.results[0].status, "SENDING_REVIEW_REQUIRED");
  assert.equal(store.notificationJobs[0].status, "SENDING");
  assert.equal(store.notificationSubscriptionGrants[0].status, "RESERVED");
});

test("protected real sending requires the checkpoint/resume Interface before beginning", async () => {
  const coreRecord = createCore();
  const env = protectedEnv({ ROOT_CHECKIN_REMINDER_SEND_ENABLED: "true" });
  const { store } = await prepareScheduledJob(coreRecord, env);
  let sendCount = 0;

  await assert.rejects(
    () => domain.runDueCheckinReminders(store, { now: DUE_AT }, runtimeContext(coreRecord.core, {
      env,
      transactionCheckpoint: undefined,
      transactionResume: undefined,
      sendSubscribeMessage: async () => {
        sendCount += 1;
        return { errcode: 0 };
      },
    })),
    (error) => error && error.code === "CHECKIN_REMINDER_TRANSACTION_CHECKPOINT_REQUIRED"
  );

  assert.equal(sendCount, 0);
  assert.equal(coreRecord.calls.some((call) => call.name === "beginSendAttempt"), false);
});

test("checkpoint failure authorizes neither a lease nor a provider call", async () => {
  const coreRecord = createCore();
  const env = protectedEnv({ ROOT_CHECKIN_REMINDER_SEND_ENABLED: "true" });
  const { store } = await prepareScheduledJob(coreRecord, env);
  let resumeCount = 0;
  let sendCount = 0;

  await assert.rejects(
    () => domain.runDueCheckinReminders(store, { now: DUE_AT }, runtimeContext(coreRecord.core, {
      env,
      transactionCheckpoint: async () => {
        const error = new Error("snapshot checkpoint unavailable");
        error.code = "SNAPSHOT_CHECKPOINT_FAILED";
        throw error;
      },
      transactionResume: async () => { resumeCount += 1; },
      sendSubscribeMessage: async () => {
        sendCount += 1;
        return { errcode: 0 };
      },
    })),
    (error) => error && error.code === "SNAPSHOT_CHECKPOINT_FAILED"
  );

  assert.equal(resumeCount, 0);
  assert.equal(sendCount, 0);
  assert.equal(coreRecord.calls.some((call) => call.name === "claimProviderCall"), false);
  assert.equal(coreRecord.calls.some((call) => call.name === "startProviderCall"), false);
});

test("provider call crosses the snapshot seam only after two durable checkpoints", async () => {
  const order = [];
  let snapshotOpen = true;
  const coreRecord = createCore({
    beginSendAttempt() {
      assert.equal(snapshotOpen, true);
      order.push("begin");
      return {};
    },
    claimProviderCall(input, calls, latestAttempt) {
      assert.equal(snapshotOpen, false);
      order.push("claim");
      return {
        ...latestAttempt,
        providerCallState: "LEASED",
        providerCallGeneration: 1,
        providerCallLeaseExpiresAt: "2026-07-19 01:00:30.000",
        leaseAcquired: true,
        leaseOwner: "npc_ordered_runner",
        leaseGeneration: 1,
      };
    },
    startProviderCall(input, calls, latestAttempt) {
      assert.equal(snapshotOpen, false);
      order.push("start");
      return {
        ...latestAttempt,
        providerCallState: "STARTED",
        providerCallGeneration: input.leaseGeneration,
        providerCallLeaseExpiresAt: "2026-07-19 01:00:30.000",
        providerCallStartedAt: "2026-07-19 01:00:00.000",
        providerCallStarted: true,
        leaseOwner: input.leaseOwner,
        leaseGeneration: input.leaseGeneration,
      };
    },
    completeSendAttempt(input) {
      assert.equal(snapshotOpen, false);
      order.push("complete");
      return { attemptId: input.attemptId, status: input.outcome };
    },
  });
  const env = protectedEnv({ ROOT_CHECKIN_REMINDER_SEND_ENABLED: "true" });
  const { store } = await prepareScheduledJob(coreRecord, env);

  const result = await domain.runDueCheckinReminders(store, { now: DUE_AT }, runtimeContext(
    coreRecord.core,
    {
      env,
      transactionCheckpoint: async () => {
        assert.equal(snapshotOpen, true);
        order.push("checkpoint");
        snapshotOpen = false;
      },
      transactionResume: async () => {
        assert.equal(snapshotOpen, false);
        order.push("resume");
        snapshotOpen = true;
      },
      sendSubscribeMessage: async () => {
        assert.equal(snapshotOpen, false);
        order.push("send");
        return { errcode: 0, errmsg: "ok" };
      },
    }
  ));

  assert.equal(result.data.results[0].status, "PROVIDER_ACCEPTED");
  assert.deepEqual(order, [
    "begin",
    "checkpoint",
    "claim",
    "resume",
    "checkpoint",
    "start",
    "send",
    "complete",
    "resume",
  ]);
  assert.equal(snapshotOpen, true);
});

test("second-checkpoint identity drift is fenced with the pre-checkpoint current facts", async (t) => {
  for (const scenario of [
    { name: "openid", field: "openid", value: "openid_changed_after_checkpoint" },
    { name: "root", field: "root_user_id", value: "root_user_changed" },
    { name: "app", field: "app_code", value: "ROOT_MEMBER_CENTER" },
  ]) {
    await t.test(scenario.name, async () => {
      let expectedFacts;
      let startInput;
      const coreRecord = createCore({
        startProviderCall(input) {
          startInput = input;
          return {
            attemptId: input.attemptId,
            providerCallStarted: false,
            fenced: true,
          };
        },
      });
      const env = protectedEnv({ ROOT_CHECKIN_REMINDER_SEND_ENABLED: "true" });
      const { store } = await prepareScheduledJob(coreRecord, env);
      const identity = store.wechatIdentities.find((item) => item.app_code === "MYROOT");
      expectedFacts = {
        recipientWechatIdentityId: identity.wechat_identity_id,
        recipientRootUserId: identity.root_user_id,
        recipientAppCode: identity.app_code,
        recipientOpenid: identity.openid,
      };
      let checkpointCount = 0;
      let sendCount = 0;

      const result = await domain.runDueCheckinReminders(store, { now: DUE_AT }, runtimeContext(
        coreRecord.core,
        {
          env,
          transactionCheckpoint: async () => {
            checkpointCount += 1;
            if (checkpointCount === 2) identity[scenario.field] = scenario.value;
          },
          transactionResume: async () => {},
          sendSubscribeMessage: async () => {
            sendCount += 1;
            return { errcode: 0, errmsg: "ok" };
          },
        }
      ));

      assert.equal(checkpointCount, 2);
      assert.deepEqual({
        recipientWechatIdentityId: startInput.recipientWechatIdentityId,
        recipientRootUserId: startInput.recipientRootUserId,
        recipientAppCode: startInput.recipientAppCode,
        recipientOpenid: startInput.recipientOpenid,
      }, expectedFacts);
      assert.equal(identity.wechat_identity_id, expectedFacts.recipientWechatIdentityId);
      assert.equal(identity[scenario.field], scenario.value);
      assert.equal(result.data.results[0].status, "SENDING_PROVIDER_CALL_FENCED");
      assert.equal(sendCount, 0);
    });
  }
});

test("resume object replacement and lost mirror reservation produce FAILED with zero provider calls", async () => {
  let resumeCount = 0;
  let sendCount = 0;
  let completionInput = null;
  const coreRecord = createCore({
    completeSendAttempt(input) {
      completionInput = input;
      return { attemptId: input.attemptId, status: input.outcome };
    },
  });
  const env = protectedEnv({ ROOT_CHECKIN_REMINDER_SEND_ENABLED: "true" });
  const { store } = await prepareScheduledJob(coreRecord, env);

  const result = await domain.runDueCheckinReminders(store, { now: DUE_AT }, runtimeContext(
    coreRecord.core,
    {
      env,
      transactionCheckpoint: async () => {},
      transactionResume: async () => {
        resumeCount += 1;
        store.notificationJobs = store.notificationJobs.map((job) => ({ ...job }));
        store.notificationSubscriptionGrants = store.notificationSubscriptionGrants
          .map((grant) => ({ ...grant }));
        if (resumeCount === 1) {
          store.notificationJobs[0].status = "CANCELLED";
          store.notificationSubscriptionGrants[0].status = "AVAILABLE";
        }
      },
      sendSubscribeMessage: async () => {
        sendCount += 1;
        return { errcode: 0 };
      },
    }
  ));

  assert.equal(resumeCount, 2);
  assert.equal(sendCount, 0);
  assert.equal(completionInput.outcome, "FAILED");
  assert.equal(completionInput.stableErrorCode, "PROVIDER_REQUEST_INVALID");
  assert.equal(result.data.results[0].status, "FAILED");
  assert.equal(store.notificationJobs[0].status, "FAILED");
  assert.equal(store.notificationSubscriptionGrants[0].status, "REVIEW_REQUIRED");
});

test("local runtime keeps the legacy snapshot implementation for compatibility", async () => {
  const store = domain.createStore();
  const env = {
    ROOT_ALLOW_OPENID_LOGIN: "true",
    ROOT_CHECKIN_REMINDER_TEMPLATE_ID: TEMPLATE_ID,
    ROOT_CHECKIN_REMINDER_TEMPLATE_VERSION: TEMPLATE_VERSION,
  };
  const login = await domain.loginWithWechat(store, {
    openid: "local_legacy_reminder_openid",
    appCode: "MYROOT",
  }, env);
  domain.joinCampaign(store, login.data.token, { campaignId: CAMPAIGN_ID }, { env, date: "2026-07-18" });
  const result = domain.recordCheckinReminderSubscription(store, login.data.token, decisionBody(), { env });

  assert.equal(result.data.subscription.status, "ACCEPTED");
  assert.equal(store.notificationJobs.length, 1);
  assert.notEqual(store.notificationJobs[0].notification_core_authoritative, true);
});
