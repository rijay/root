# myRoot 0.8.1 Loading Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make assessment transitions, the Activities hero, and Profile avatar/member summary render from local state immediately while network synchronization continues safely in the background.

**Architecture:** Keep the current request and page Interfaces, but move repeatable reads and ordinary draft writes off the interaction-critical path. Add small focused Modules for draft coalescing, activity-feed prewarming, session image prefetch, and member-summary stale-while-revalidate; preserve server authority for health safety and commerce data.

**Tech Stack:** WeChat Mini Program CommonJS, Node.js backend, CloudBase container transport, Youzan Open API, Node test runner and existing source-contract scripts.

**Status:** Local implementation complete. Repository verification is 6/6 PASS; real-device and release gates remain explicitly blocked and were not executed.

---

### Task 1: Establish the isolated 0.8.1 baseline

**Files:**
- Modify: `miniprogram/config/version.js`
- Modify: `miniprogram/package.json`
- Test: `miniprogram/scripts/version-contract.test.js`

- [ ] **Step 1: Verify the linked worktree and clean baseline**

Run `git status --short`, `git branch --show-current`, and `npm run verify` from the linked worktree. Expected: clean status before plan creation and all baseline gates pass.

- [ ] **Step 2: Add a failing version contract**

Assert both the runtime version and mini-program package version are `0.8.1`:

```js
assert.equal(require("../config/version").appVersion, "0.8.1");
assert.equal(require("../package.json").version, "0.8.1");
```

- [ ] **Step 3: Update the two version sources**

Change only the two values covered by the contract, then run the contract test.

### Task 2: Remove assessment network waits from ordinary question transitions

**Files:**
- Create: `miniprogram/utils/draft-sync-queue.js`
- Modify: `miniprogram/utils/health-consent.js`
- Modify: `miniprogram/subpkg/health/pages/assessment/index.js`
- Modify: `backend/src/healthAssessment.js`
- Test: `miniprogram/scripts/draft-sync-queue.test.js`
- Test: `miniprogram/scripts/health-consent.test.js`
- Test: `miniprogram/scripts/assessment-performance.test.js`
- Test: `backend/tests/health_assessment.test.js`

- [ ] **Step 1: Specify a coalescing single-writer queue**

The queue must keep at most one active save and one latest pending snapshot, replace older pending revisions, expose `enqueue`, `flush`, `retry`, `getState`, and never create an unhandled rejection for background saves.

```js
const queue = createDraftSyncQueue({ save: async (job) => saved.push(job) });
queue.enqueue({ answers: { Q1: "A" }, revision: 1 });
queue.enqueue({ answers: { Q1: "B" }, revision: 2 });
await queue.flush();
assert.deepEqual(saved.at(-1), { answers: { Q1: "B" }, revision: 2 });
```

- [ ] **Step 2: Add session-scoped health-consent caching**

Cache a successful consent status against `currentLoginSession().sessionId`; allow `{ force: true }`, and export `updateHealthConsentCache` plus `clearHealthConsentCache`. Agreement and withdrawal must update or invalidate the cache.

- [ ] **Step 3: Mark safety-check questions in the server payload**

Derive `saveBarrier: true` only for question fields referenced by server safety rules. Do not expose rule values or make the client authoritative.

- [ ] **Step 4: Optimize assessment initialization**

When `startAssessment()` returns an in-progress assessment with questions, hydrate it directly. Call `getAssessment()` only for an existing assessment id or an incomplete start payload.

- [ ] **Step 5: Make ordinary Next actions local-first**

For non-final questions without `saveBarrier`, enqueue the current answer snapshot and switch questions immediately. A barrier question calls `flush()` and handles `safetyTriggered`; the final question waits for earlier background work and calls `completeAssessment()` once with the complete answers.

- [ ] **Step 6: Verify safety, retry, hide, and completion behavior**

Run the new queue/page contract tests plus `backend/tests/health_assessment.test.js`. Expected: ordinary transitions contain no awaited draft call, safety barriers remain synchronous, and final completion does not issue a redundant draft.

### Task 3: Prewarm the Activities feed and first hero image

**Files:**
- Create: `miniprogram/utils/session-image-cache.js`
- Create: `miniprogram/utils/activity-feed-cache.js`
- Modify: `miniprogram/app.js`
- Modify: `miniprogram/pages/activities/index.js`
- Modify: `miniprogram/pages/activities/index.wxml`
- Test: `miniprogram/scripts/session-image-cache.test.js`
- Test: `miniprogram/scripts/activity-feed-cache.test.js`
- Test: `miniprogram/scripts/activity-loading.test.js`

- [ ] **Step 1: Specify the session image cache Interface**

Support trusted `https://` through `wx.downloadFile` and `cloud://` through `wx.cloud.downloadFile`, single-flight identical URLs, and return the remote URL unchanged on failure.

- [ ] **Step 2: Add a login-session-scoped raw activity-feed cache**

Store raw payload in memory with a two-minute fresh window. `loadActivityFeed()` must single-flight the API call and prefetch only the first hero image.

- [ ] **Step 3: Schedule non-blocking prewarm after application launch**

Start the activity prewarm on a short timer after core startup. Failure must be swallowed and must not delay launch, login, or the first page.

- [ ] **Step 4: Render cached data and cached hero path first**

The Activities page reads the shared cache during `onLoad`, refreshes stale data in the background, and uses `displayHeroUrl` when the prefetch completed.

- [ ] **Step 5: Record actual hero load duration**

Add `bindload`, retain `binderror`, and submit `durationMs` without recording the URL, activity id, or enrollment data.

### Task 4: Make Profile stale-while-revalidate and remove Youzan head-of-line blocking

**Files:**
- Create: `miniprogram/utils/member-commerce-cache.js`
- Modify: `miniprogram/utils/member-commerce.js`
- Modify: `miniprogram/utils/request.js`
- Modify: `miniprogram/app.js`
- Modify: `miniprogram/pages/profile/index.js`
- Modify: `miniprogram/pages/profile/index.wxml`
- Modify: `backend/src/youzanCommerceAdapter.js`
- Test: `miniprogram/scripts/member-commerce-cache.test.js`
- Test: `miniprogram/scripts/profile-loading.test.js`
- Test: `backend/tests/youzan_commerce_adapter.test.js`

- [ ] **Step 1: Specify a persistent session-bound member-summary cache**

Store only presented order/coupon counts and sync time, keyed by login session. Treat entries as fresh for five minutes and usable stale for 24 hours; clear them on logout.

- [ ] **Step 2: Refresh Profile only when the summary is stale**

Render cached content immediately. Keep stale content on refresh failure instead of replacing it with generic copy.

- [ ] **Step 3: Prewarm cached avatars during app launch**

Use the shared session image cache for the cached or freshly fetched avatar. The Profile page prefers a completed local path and records real image duration.

- [ ] **Step 4: Replace global Youzan serialization with bounded concurrency**

Introduce a limiter with default concurrency two, cache the UnionID-to-Youzan-id mapping separately, set summary cache freshness to five minutes, and allow orders and coupons to execute concurrently after identity resolution.

```js
assert.ok(maxObservedConcurrency >= 2);
assert.ok(maxObservedConcurrency <= 2);
```

- [ ] **Step 5: Verify cache isolation, logout clearing, fallback, and rate limits**

Run the mini-program cache/profile tests and Youzan adapter tests. Expected: no cross-session reuse, stale data survives transient failure, and adapter concurrency never exceeds its configured bound.

### Task 5: Complete local verification and handoff

**Files:**
- Modify: `docs/superpowers/plans/2026-08-31-myroot-v081-loading-performance.md`
- Verify: `docs/evidence/performance-r0/real-device-results.json`

- [ ] **Step 1: Run focused tests after each task**

Use the exact scripts and Node test files listed above; fix regressions before moving to the next task.

- [ ] **Step 2: Run the full local gate**

Run `npm run verify`. Expected: all local gates pass and `git diff --check` reports no whitespace errors.

- [ ] **Step 3: Inspect scope and repository status**

Review `git diff --stat`, `git diff`, version sources, and `git status --short`. Confirm no upload, CloudBase deployment, review submission, publication, or traffic change occurred.

- [ ] **Step 4: Keep real-device evidence blocked**

Do not edit missing device evidence into a pass. Report that iOS/Android office and weak-network 30-sample P75/P95 acceptance remains a separate gate.
