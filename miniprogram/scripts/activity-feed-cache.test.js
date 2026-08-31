const assert = require("node:assert/strict");

let sessionId = "session-a";
let requestCount = 0;
const prewarmed = [];
const payload = { activities: [{ heroAssetUrl: "https://assets.example.com/activity.jpg" }] };

require.cache[require.resolve("../utils/request")] = {
  exports: {
    async requestWithDeadline() {
      requestCount += 1;
      return payload;
    },
  },
};
require.cache[require.resolve("../utils/login-session")] = {
  exports: {
    currentLoginSession() {
      return { sessionId };
    },
  },
};
require.cache[require.resolve("../utils/session-image-cache")] = {
  exports: {
    prewarmSessionImage(url) {
      prewarmed.push(url);
      return Promise.resolve("/tmp/activity.jpg");
    },
  },
};

const {
  loadActivityFeed,
  prewarmActivityFeed,
  readActivityFeedCache,
  resetActivityFeedCacheForTests,
} = require("../utils/activity-feed-cache");

async function main() {
  resetActivityFeedCacheForTests();
  const [first, second] = await Promise.all([loadActivityFeed(), loadActivityFeed()]);
  assert.equal(first, payload);
  assert.equal(second, payload);
  assert.equal(requestCount, 1);
  assert.equal(readActivityFeedCache().value, payload);
  assert.equal(readActivityFeedCache().fresh, true);
  await prewarmActivityFeed();
  assert.equal(requestCount, 1);
  assert.deepEqual(prewarmed, ["https://assets.example.com/activity.jpg"]);

  sessionId = "session-b";
  assert.equal(readActivityFeedCache(), null);
  await loadActivityFeed();
  assert.equal(requestCount, 2);
  console.log("activity feed cache tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
