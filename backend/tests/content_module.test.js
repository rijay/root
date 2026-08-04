const assert = require("node:assert/strict");
const test = require("node:test");

const contentModule = require("../src/contentModule");
const { createSeedData } = require("../src/seed");

const NOW = "2026-08-04T08:00:00.000Z";
const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function context(operatorId = "content-operator") {
  return {
    now: NOW,
    operatorId,
    env: {
      ROOT_CONTENT_WEBVIEW_HOSTS: JSON.stringify(["www.root.com"]),
      ROOT_MEMBER_CENTER_APPID: "wx-root-member-center",
    },
  };
}

function upload(data, scope, name) {
  return contentModule.uploadAsset(data, {
    scope,
    name,
    mimeType: "image/png",
    dataBase64: PNG_1X1,
  }, context()).asset;
}

function saveCompleteCandidate(data) {
  const welcome1 = upload(data, "welcome-1", "welcome-1.png");
  const welcome2 = upload(data, "welcome-2", "welcome-2.png");
  const detailAsset = upload(data, "shared-detail", "detail.png");
  const homeAsset = upload(data, "home-carousel", "home.png");

  contentModule.saveWelcomeDraft(data, { slot: 1, copy: "欢迎加入 Root Member Club", assetId: welcome1.assetId }, context());
  contentModule.saveWelcomeDraft(data, { slot: 2, copy: "平衡不是控制，而是理解。", assetId: welcome2.assetId }, context());
  const detail = contentModule.saveSharedDetailDraft(data, {
    title: "Root Foundation",
    previewCopy: "从肠道开始，理解身体的节奏",
    assets: [{
      assetId: detailAsset.assetId,
      order: 1,
      hotspots: [{
        id: "hotspot-1",
        x: 10,
        y: 20,
        width: 40,
        height: 20,
        targetType: "MINIPROGRAM_PAGE",
        target: "/pages/activities/index",
      }],
    }],
  }, context()).version;
  contentModule.saveHomeCarouselDraft(data, {
    order: 1,
    internalName: "首屏品牌内容",
    copy: "把每天的选择，\n还给身体自己的节奏",
    assetId: homeAsset.assetId,
    lineCount: 2,
    fontSize: "LARGE",
    alignment: "CENTER",
    sharedDetailVersionId: detail.versionId,
    scheduleRange: ["2026-08-01T00:00:00.000Z", "2099-01-01T00:00:00.000Z"],
  }, context());
  return { detail };
}

test("content drafts remain private until one immutable candidate is previewed and published", () => {
  const data = createSeedData();
  data.contentAssets = [];
  data.contentVersions = [];
  data.contentPublicationRecords = [];
  const { detail } = saveCompleteCandidate(data);

  assert.equal(contentModule.listWelcome(data, context()).publicationState, "NOT_PUBLISHED");
  assert.equal(contentModule.listHome(data, context()).items.length, 0);

  const candidate = contentModule.buildReleaseSummary(data, context());
  assert.equal(candidate.draftCount, 4);
  assert.equal(candidate.blockerCount, 0);
  assert.match(candidate.candidateVersion, /^CONTENT-CANDIDATE-/);

  assert.throws(
    () => contentModule.publishCandidate(data, {
      version: candidate.candidateVersion,
      confirmed: true,
      confirmationText: "确认发布内容",
    }, context("publisher")),
    { code: "CONTENT_PREVIEW_REQUIRED" },
  );

  contentModule.markPreviewCompleted(data, { version: candidate.candidateVersion }, context("publisher"));
  const published = contentModule.publishCandidate(data, {
    version: candidate.candidateVersion,
    confirmed: true,
    confirmationText: "确认发布内容",
  }, context("publisher"));
  assert.equal(published.publishedCount, 4);
  assert.equal(data.contentVersions.every((version) => version.status === "PUBLISHED"), true);
  assert.equal(data.contentPublicationRecords.length, 1);

  const welcome = contentModule.listWelcome(data, context());
  assert.deepEqual(welcome.screens.map((screen) => screen.slot), [1, 2]);
  const home = contentModule.listHome(data, context());
  assert.equal(home.items.length, 1);
  assert.equal(home.items[0].lines.length, 2);
  const shared = contentModule.getDetail(data, detail.logicalId, context());
  assert.equal(shared.item.assets[0].hotspots[0].action.type, "MINIPROGRAM_PAGE");
});

test("publication validates complete welcome content, immutable references and controlled targets", () => {
  const data = createSeedData();
  data.contentAssets = [];
  data.contentVersions = [];
  data.contentPublicationRecords = [];
  const asset = upload(data, "welcome-1", "welcome.png");
  contentModule.saveWelcomeDraft(data, { slot: 1, copy: "欢迎加入 Root Member Club", assetId: asset.assetId }, context());
  const summary = contentModule.buildReleaseSummary(data, context());
  assert.equal(summary.blockerCount > 0, true);
  assert.equal(summary.blockers.some((blocker) => /第二屏/.test(blocker.issue)), true);

  assert.deepEqual(
    contentModule.validateTarget({ targetType: "MINIPROGRAM_PAGE", target: "/pages/activities/index" }, context()),
    { status: "PASS", message: "小程序路径检查通过", action: { type: "MINIPROGRAM_PAGE", path: "/pages/activities/index" } },
  );
  assert.deepEqual(
    contentModule.validateTarget({ targetType: "WEBVIEW_ALLOWLIST", target: "https://www.root.com/article" }, context()),
    { status: "PASS", message: "白名单网页检查通过", action: { type: "BUSINESS_WEBVIEW", url: "https://www.root.com/article" } },
  );
  assert.throws(
    () => contentModule.validateTarget({ targetType: "WEBVIEW_ALLOWLIST", target: "https://evil.example.com/promo" }, context()),
    { code: "CONTENT_TARGET_INVALID" },
  );
});

test("published versions are never edited in place and copying creates a new draft", () => {
  const data = createSeedData();
  data.contentAssets = [];
  data.contentVersions = [];
  data.contentPublicationRecords = [];
  saveCompleteCandidate(data);
  const candidate = contentModule.buildReleaseSummary(data, context());
  contentModule.markPreviewCompleted(data, { version: candidate.candidateVersion }, context());
  contentModule.publishCandidate(data, {
    version: candidate.candidateVersion,
    confirmed: true,
    confirmationText: "确认发布内容",
  }, context());

  const published = data.contentVersions.find((version) => version.type === "WELCOME" && version.content.slot === 1);
  const copied = contentModule.saveWelcomeDraft(data, {
    slot: 1,
    copy: "欢迎再次加入 Root Member Club",
    assetId: published.content.assetId,
  }, context()).version;
  assert.equal(published.status, "PUBLISHED");
  assert.equal(copied.status, "DRAFT");
  assert.notEqual(copied.versionId, published.versionId);
  assert.equal(copied.sourceVersionId, published.versionId);
});

test("candidate blocks a detail replacement until every published home reference is updated", () => {
  const data = createSeedData();
  data.contentAssets = [];
  data.contentVersions = [];
  data.contentPublicationRecords = [];
  saveCompleteCandidate(data);
  const firstCandidate = contentModule.buildReleaseSummary(data, context());
  contentModule.markPreviewCompleted(data, { version: firstCandidate.candidateVersion }, context());
  contentModule.publishCandidate(data, {
    version: firstCandidate.candidateVersion,
    confirmed: true,
    confirmationText: "确认发布内容",
  }, context());

  const publishedDetail = data.contentVersions.find((row) => row.type === "SHARED_DETAIL" && row.status === "PUBLISHED");
  const publishedHome = data.contentVersions.find((row) => row.type === "HOME_CAROUSEL" && row.status === "PUBLISHED");
  const replacement = contentModule.saveSharedDetailDraft(data, {
    sourceVersionId: publishedDetail.versionId,
    title: "Root Foundation · 新版",
    previewCopy: "新版共用详情",
    assets: publishedDetail.content.assets.map((asset) => ({ ...asset })),
  }, context()).version;

  const blocked = contentModule.buildReleaseSummary(data, context());
  assert.equal(blocked.blockers.some((row) => /发布后关联详情将失效/.test(row.issue)), true);

  contentModule.saveHomeCarouselDraft(data, {
    sourceVersionId: publishedHome.versionId,
    order: publishedHome.content.order,
    internalName: publishedHome.content.internalName,
    copy: publishedHome.content.copy,
    assetId: publishedHome.content.assetId,
    lineCount: publishedHome.content.lineCount,
    fontSize: publishedHome.content.fontSize,
    alignment: publishedHome.content.alignment,
    sharedDetailVersionId: replacement.versionId,
    scheduleRange: [publishedHome.content.startsAt, publishedHome.content.endsAt],
  }, context());
  assert.equal(contentModule.buildReleaseSummary(data, context()).blockerCount, 0);
});

test("published shared details cannot be retired while a live home item references them", () => {
  const data = createSeedData();
  data.contentAssets = [];
  data.contentVersions = [];
  data.contentPublicationRecords = [];
  saveCompleteCandidate(data);
  const candidate = contentModule.buildReleaseSummary(data, context());
  contentModule.markPreviewCompleted(data, { version: candidate.candidateVersion }, context());
  contentModule.publishCandidate(data, {
    version: candidate.candidateVersion,
    confirmed: true,
    confirmationText: "确认发布内容",
  }, context());

  const home = data.contentVersions.find((row) => row.type === "HOME_CAROUSEL" && row.status === "PUBLISHED");
  const detail = data.contentVersions.find((row) => row.type === "SHARED_DETAIL" && row.status === "PUBLISHED");
  assert.throws(() => contentModule.unpublishVersion(data, { versionId: detail.versionId }, context()), { code: "CONTENT_VERSION_IN_USE" });
  assert.equal(contentModule.unpublishVersion(data, { versionId: home.versionId }, context()).version.status, "OFFLINE");
  assert.equal(contentModule.unpublishVersion(data, { versionId: detail.versionId }, context()).version.status, "RETIRED");
});
