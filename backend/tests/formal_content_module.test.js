const test = require("node:test");
const assert = require("node:assert/strict");

const contentModule = require("../src/contentModule");

function item(overrides = {}) {
  return {
    contentId: "cnt_home_01",
    version: 1,
    placement: "HOME",
    status: "PUBLISHED",
    assetState: "AUTHORIZED",
    kicker: "ROOT FOUNDATION",
    lines: ["把每天的选择，", "还给身体自己的节奏"],
    coverAssetUrl: "https://assets.example.com/root/home-01.jpg",
    detailImages: ["https://assets.example.com/root/detail-01.jpg"],
    sortOrder: 10,
    startsAt: "2026-08-01T00:00:00.000Z",
    endsAt: "2026-09-01T00:00:00.000Z",
    action: { type: "MINIPROGRAM_PAGE", path: "/pages/activities/index" },
    ...overrides,
  };
}

test("home content exposes only active published items in operator order", () => {
  const data = {
    formalContentItems: [
      item({ contentId: "cnt_later", sortOrder: 20 }),
      item({ contentId: "cnt_first", sortOrder: 5 }),
      item({ contentId: "cnt_draft", status: "DRAFT", sortOrder: 1 }),
      item({ contentId: "cnt_expired", endsAt: "2026-08-02T00:00:00.000Z", sortOrder: 2 }),
    ],
  };
  const result = contentModule.listHome(data, {
    now: "2026-08-03T05:00:00.000Z",
    env: { NODE_ENV: "test" },
  });

  assert.deepEqual(result.items.map((entry) => entry.contentId), ["cnt_first", "cnt_later"]);
  assert.equal(result.publicationState, "PUBLISHED");
  assert.equal(result.items[0].detailPath, "/subpkg/content/pages/detail/index?contentId=cnt_first");
});

test("production excludes development placeholders from the public Interface", () => {
  const data = {
    formalContentItems: [item({ assetState: "DEVELOPMENT_PLACEHOLDER" })],
  };
  const result = contentModule.listHome(data, {
    now: "2026-08-03T05:00:00.000Z",
    env: { NODE_ENV: "production" },
  });

  assert.deepEqual(result.items, []);
  assert.equal(result.publicationState, "NOT_PUBLISHED");
});

test("unsafe media and jump targets are rejected instead of repaired", () => {
  const data = {
    formalContentItems: [
      item({ contentId: "cnt_http", coverAssetUrl: "http://unsafe.example.com/home.jpg" }),
      item({ contentId: "cnt_scheme", action: { type: "MINIPROGRAM_PAGE", path: "javascript:alert(1)" } }),
      item({
        contentId: "cnt_member",
        action: { type: "ROOT_MEMBER_CENTER", appId: "wxfb75c0b432670215", path: "pages/home/index" },
      }),
    ],
  };
  const result = contentModule.listHome(data, {
    now: "2026-08-03T05:00:00.000Z",
    env: { NODE_ENV: "test", ROOT_MEMBER_CENTER_APPID: "wxfb75c0b432670215" },
  });

  assert.deepEqual(result.items.map((entry) => entry.contentId), ["cnt_member"]);
  assert.equal(result.items[0].action.type, "ROOT_MEMBER_CENTER");
});

test("verified Root member-center short links remain intact on the public Interface", () => {
  const shortLink = "#小程序://ROOT会员中心/BTsqrmF8skMJwlv";
  const data = {
    formalContentItems: [item({
      contentId: "cnt_member_short_link",
      action: { type: "ROOT_MEMBER_CENTER", shortLink },
    })],
  };
  const result = contentModule.listHome(data, {
    now: "2026-08-03T05:00:00.000Z",
    env: { NODE_ENV: "test", ROOT_MEMBER_CENTER_APPID: "wxfb75c0b432670215" },
  });

  assert.deepEqual(result.items[0].action, { type: "ROOT_MEMBER_CENTER", shortLink });
});

test("shared detail returns ordered images and no arbitrary styling surface", () => {
  const data = {
    formalContentItems: [item({
      detailImages: [
        "https://assets.example.com/root/detail-02.jpg",
        "https://assets.example.com/root/detail-01.jpg",
      ],
      action: null,
      arbitraryCss: "position:fixed",
    })],
  };
  const result = contentModule.getDetail(data, "cnt_home_01", {
    now: "2026-08-03T05:00:00.000Z",
    env: { NODE_ENV: "test" },
  });

  assert.deepEqual(result.item.detailImages, [
    "https://assets.example.com/root/detail-02.jpg",
    "https://assets.example.com/root/detail-01.jpg",
  ]);
  assert.equal(Object.prototype.hasOwnProperty.call(result.item, "arbitraryCss"), false);
});
