const assert = require("node:assert/strict");

const storage = new Map();
global.wx = {
  getStorageSync(key) { return storage.get(key); },
  setStorageSync(key, value) { storage.set(key, value); },
  removeStorageSync(key) { storage.delete(key); },
};

const { startLoginSession, clearLoginSession } = require("../utils/login-session");
const {
  PROFILE_CACHE_KEY,
  clearProfileCache,
  readProfileCache,
  writeProfileCache,
} = require("../utils/profile-cache");

startLoginSession({ sessionId: "session-a" });
assert.equal(readProfileCache(), null);
assert.equal(writeProfileCache({ nickname: "小树", avatarUrl: "https://cdn.example.com/avatar.jpg", phone: "13800000000" }, 1000), true);
assert.deepEqual(readProfileCache(1001).profile, {
  nickname: "小树",
  avatarUrl: "https://cdn.example.com/avatar.jpg",
});
assert.equal(Object.prototype.hasOwnProperty.call(storage.get(PROFILE_CACHE_KEY).profile, "phone"), false);

clearLoginSession();
startLoginSession({ sessionId: "session-b" });
assert.equal(readProfileCache(1002), null, "不同登录会话不得复用上一位用户资料");

writeProfileCache({ nickname: "新用户", avatarUrl: "javascript:alert(1)" }, 2000);
assert.equal(readProfileCache(2001).profile.avatarUrl, "");
clearProfileCache();
assert.equal(readProfileCache(2001), null);

delete global.wx;
console.log("profile cache tests passed");
