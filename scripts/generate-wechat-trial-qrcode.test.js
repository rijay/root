#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  PRIVATE_TMP_ROOT,
  assertPrivateRegularFile,
  buildQrRequest,
  getStableAccessToken,
  getTrialQrCode,
  isJpeg,
  isPng,
  redact,
  summarizePlan,
  validateCredentials,
  validateOutputBase,
  validateRouteMetadata,
} = require("./generate-wechat-trial-qrcode");

async function main() {
  const routeValue = "synthetic_route_12345";
  const route = validateRouteMetadata({
    key: "myroot_canary",
    value: routeValue,
    query: `myroot_canary=${routeValue}`,
    versionName: "myroot-api-027",
  }, "myroot-api-027");
  const request = buildQrRequest(route);
  assert.equal(request.env_version, "trial");
  assert.equal(request.path, `pages/home/index?myroot_canary=${routeValue}`);
  assert.equal(request.width, 430);

  const plan = summarizePlan(route, request, path.join(PRIVATE_TMP_ROOT, "myroot-v0.5.13-trial"));
  assert.equal(plan.networkCalled, false);
  assert.equal(plan.secretDisclosed, false);
  assert.equal(plan.tokenDisclosed, false);
  assert.equal(JSON.stringify(plan).includes(routeValue), false);

  assert.deepEqual(validateCredentials({
    appid: "wx7727a02565aed1c2",
    secret: "synthetic-secret-value-for-test",
  }), {
    appid: "wx7727a02565aed1c2",
    secret: "synthetic-secret-value-for-test",
  });
  assert.throws(() => validateCredentials({ appid: "wrong", secret: "synthetic-secret-value-for-test" }));
  assert.throws(() => validateRouteMetadata({
    key: "myroot_canary",
    value: routeValue,
    versionName: "myroot-api-026",
  }, "myroot-api-027"));
  assert.equal(redact("access_token=synthetic-secret-token"), "access_token=[REDACTED]");
  assert.equal(redact('{"secret":"synthetic-secret-value-for-test"}'), '{"secret":"[REDACTED]"}');
  assert.equal(redact("provider synthetic-secret-value-for-test"), "provider [REDACTED]");

  const outsideDirectory = fs.mkdtempSync(path.join(process.cwd(), ".myroot-qrcode-outside-"));
  const linkedDirectory = path.join(PRIVATE_TMP_ROOT, `myroot-qrcode-link-${process.pid}-${Date.now()}`);
  const outsideRoute = path.join(outsideDirectory, "route.json");
  fs.writeFileSync(outsideRoute, "{}\n", { mode: 0o600 });
  fs.symlinkSync(outsideDirectory, linkedDirectory, "dir");
  try {
    assert.throws(
      () => assertPrivateRegularFile(path.join(linkedDirectory, "route.json"), "Route file"),
      /must resolve inside the private temporary root/
    );
    assert.throws(
      () => validateOutputBase(path.join(linkedDirectory, "trial-output")),
      /resolves outside the private temporary root/
    );
  } finally {
    fs.unlinkSync(linkedDirectory);
    fs.rmSync(outsideDirectory, { recursive: true, force: true });
  }

  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
  assert.equal(isPng(png), true);
  assert.equal(isJpeg(jpeg), true);

  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("stable_token")) {
      return new Response(JSON.stringify({ access_token: "synthetic-access-token", expires_in: 7200 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(png, { status: 200, headers: { "Content-Type": "image/png" } });
  };
  const token = await getStableAccessToken({
    appid: "wx7727a02565aed1c2",
    secret: "synthetic-secret-value-for-test",
  }, fetchImpl);
  assert.equal(token, "synthetic-access-token");
  const tokenBody = JSON.parse(calls[0].options.body);
  assert.equal(tokenBody.force_refresh, false);
  assert.equal(calls[0].url.includes("secret"), false);

  const qrResult = await getTrialQrCode(token, request, fetchImpl);
  assert.equal(qrResult.extension, "png");
  assert.deepEqual(qrResult.image, png);
  assert.equal(calls[1].url.includes("synthetic-access-token"), true);
  assert.equal(JSON.parse(calls[1].options.body).env_version, "trial");

  process.stdout.write("wechat trial QR release contract: PASS\n");
}

main().catch((error) => {
  process.stderr.write(`wechat trial QR release contract failed: ${error.message}\n`);
  process.exitCode = 1;
});
