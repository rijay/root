const assert = require("node:assert/strict");

const storage = new Map();
let persistentWrites = 0;
global.wx = {
  getStorageSync(key) { return storage.get(key); },
  setStorageSync(key, value) { persistentWrites += 1; storage.set(key, value); },
  removeStorageSync(key) { storage.delete(key); },
};

const {
  clearSessionPageCache,
  readPublicPageCache,
  readSessionPageCache,
  resetPageCacheForTests,
  writePublicPageCache,
  writeSessionPageCache,
} = require("../utils/page-cache");

const originalNow = Date.now;
let now = 1_000_000;
Date.now = () => now;
try {
  assert.equal(writePublicPageCache("home", { items: [{ contentId: "home-1" }] }), true);
  assert.equal(readPublicPageCache("home", { freshForMs: 1000, maxStaleMs: 5000 }).fresh, true);
  now += 2000;
  const stale = readPublicPageCache("home", { freshForMs: 1000, maxStaleMs: 5000 });
  assert.equal(stale.fresh, false);
  assert.equal(stale.value.items[0].contentId, "home-1");
  now += 4000;
  assert.equal(readPublicPageCache("home", { freshForMs: 1000, maxStaleMs: 5000 }), null);

  const writesBeforeSensitiveCache = persistentWrites;
  assert.equal(writeSessionPageCache("root4u:session-token", { result: { tips: ["早点休息"] } }), true);
  assert.equal(readSessionPageCache("root4u:session-token", { maxStaleMs: 1000 }).value.result.tips[0], "早点休息");
  assert.equal(persistentWrites, writesBeforeSensitiveCache);
  clearSessionPageCache("root4u:session-token");
  assert.equal(readSessionPageCache("root4u:session-token", { maxStaleMs: 1000 }), null);

  assert.equal(writePublicPageCache("too-large", { body: "x".repeat(300 * 1024) }), false);
} finally {
  Date.now = originalNow;
  resetPageCacheForTests();
  delete global.wx;
}

console.log("page cache tests ok");
