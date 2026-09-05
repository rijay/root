const assert = require("node:assert/strict");

let downloadCalls = 0;
let releaseDownload;
global.wx = {
  downloadFile(options) {
    downloadCalls += 1;
    releaseDownload = () => options.success({ statusCode: 200, tempFilePath: "/tmp/activity-hero.jpg" });
    return { abort() {} };
  },
  cloud: {
    downloadFile(options) {
      options.success({ tempFilePath: "/tmp/cloud-avatar.jpg" });
    },
  },
};

const {
  cachedImageUrl,
  prewarmSessionImage,
  resetSessionImageCacheForTests,
} = require("../utils/session-image-cache");

async function main() {
  resetSessionImageCacheForTests();
  const first = prewarmSessionImage("https://assets.example.com/activity.jpg");
  const second = prewarmSessionImage("https://assets.example.com/activity.jpg");
  assert.equal(downloadCalls, 1);
  releaseDownload();
  assert.equal(await first, "/tmp/activity-hero.jpg");
  assert.equal(await second, "/tmp/activity-hero.jpg");
  assert.equal(cachedImageUrl("https://assets.example.com/activity.jpg"), "/tmp/activity-hero.jpg");
  assert.equal(await prewarmSessionImage("cloud://root/avatar.jpg"), "/tmp/cloud-avatar.jpg");
  assert.equal(await prewarmSessionImage("/static/local.jpg"), "/static/local.jpg");
  delete global.wx;
  console.log("session image cache tests passed");
}

main().catch((error) => {
  delete global.wx;
  console.error(error);
  process.exit(1);
});
