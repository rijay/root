const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const appScript = read("app.js");
const loginScript = read("pages/login/index.js");
const registerScript = read("pages/register/index.js");
const profileScript = read("pages/profile/index.js");
const profileView = read("pages/profile/index.wxml");

assert.match(appScript, /function prewarmProfileCache\(\)/);
assert.match(appScript, /ensureLoginSession\(\);[\s\S]*readProfileCache\(\)/);
assert.match(appScript, /inspectFormalAccess\("profile-home"\)/);
assert.match(appScript, /readProfileCache\(\)/);
assert.match(appScript, /prewarmProfileCache\(\);/);
assert.match(loginScript, /startLoginSession\(data\.session \|\| \{\}\);[\s\S]*writeProfileCache\(data\.profile\)/);
assert.match(registerScript, /const saved = await request\([\s\S]*writeProfileCache\(saved\.profile\)/);
assert.match(profileScript, /function initialProfileState\(\)/);
assert.match(profileScript, /ensureLoginSession\(\);[\s\S]*const cached = readProfileCache\(\)/);
assert.match(profileScript, /readMemberCommerceSummary\(\)/);
assert.match(profileScript, /clearSessionPageCache\(\)/);
assert.match(profileScript, /expectedSessionId = currentLoginSession\(\)\.sessionId/);
assert.match(profileScript, /currentLoginSession\(\)\.sessionId !== expectedSessionId/);
assert.match(profileScript, /loggedIn: true, sessionChecking: true, profile: DEFAULT_PROFILE/);
assert.equal((profileScript.match(/this\.loadMemberCommerce\(\);/g) || []).length, 1);
assert.doesNotMatch(profileView, /正在核验|正在确认会员身份/);
assert.match(profileView, /lazy-load="\{\{false\}\}"/);

console.log("profile first-frame loading checks passed");
