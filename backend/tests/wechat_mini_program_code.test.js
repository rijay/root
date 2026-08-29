const assert = require("node:assert/strict");
const test = require("node:test");

const { generateChannelCodeImage } = require("../src/wechatMiniProgramCode");

test("channel code image uses the injected WeChat adapter without exposing credentials", async () => {
  let received = null;
  const result = await generateChannelCodeImage({
    scene: "q=ABC12345",
    targetPage: "/subpkg/campaign/pages/root-with-you/index",
    envVersion: "trial",
  }, {
    wechatCodeGenerator: {
      async generate(code) {
        received = code;
        return { body: Buffer.from("png-binary"), contentType: "image/png" };
      },
    },
  });
  assert.equal(received.scene, "q=ABC12345");
  assert.equal(received.envVersion, "trial");
  assert.equal(result.contentType, "image/png");
  assert.equal(result.body.toString(), "png-binary");
});
