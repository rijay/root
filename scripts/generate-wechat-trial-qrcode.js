#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const EXPECTED_APPID = "wx7727a02565aed1c2";
const ROUTE_KEY = "myroot_canary";
const ROUTE_VALUE_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const DEFAULT_PAGE = "pages/home/index";
const STABLE_TOKEN_URL = "https://api.weixin.qq.com/cgi-bin/stable_token";
const QR_CODE_URL = "https://api.weixin.qq.com/wxa/getwxacode";
const MAX_QR_PATH_LENGTH = 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const PRIVATE_TMP_ROOT = fs.realpathSync("/private/tmp");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function redact(value) {
  return String(value || "")
    .replace(/("(?:access_token|secret|token|password)"\s*:\s*)"[^"]*"/gi, "$1\"[REDACTED]\"")
    .replace(/\b(access_token|secret|token|password)\s*[=:]\s*([^&\s,;}]+)/gi, "$1=[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [REDACTED]")
    .replace(/[A-Za-z0-9._~-]{24,}/g, "[REDACTED]")
    .slice(0, 240);
}

function isInsidePrivateTmp(targetPath) {
  const relative = path.relative(PRIVATE_TMP_ROOT, targetPath);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function parseArgs(argv) {
  const options = {
    confirmGenerate: false,
    page: DEFAULT_PAGE,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--route-file") options.routeFile = argv[++index];
    else if (argument === "--credentials-file") options.credentialsFile = argv[++index];
    else if (argument === "--expected-version") options.expectedVersion = argv[++index];
    else if (argument === "--output-base") options.outputBase = argv[++index];
    else if (argument === "--page") options.page = argv[++index];
    else if (argument === "--confirm-generate") options.confirmGenerate = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  for (const required of ["routeFile", "expectedVersion", "outputBase"]) {
    if (!options[required]) throw new Error(`Missing --${required.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`);
  }
  if (options.confirmGenerate && !options.credentialsFile) throw new Error("Missing --credentials-file");
  return options;
}

function assertPrivateRegularFile(filePath, label) {
  const resolved = path.resolve(filePath);
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular file`);
  const realPath = fs.realpathSync(resolved);
  if (!isInsidePrivateTmp(realPath)) throw new Error(`${label} must resolve inside /private/tmp`);
  if ((stat.mode & 0o077) !== 0) throw new Error(`${label} permissions must be 0600 or stricter`);
  return realPath;
}

function readPrivateJson(filePath, label) {
  const resolved = assertPrivateRegularFile(filePath, label);
  try {
    return JSON.parse(fs.readFileSync(resolved, "utf8"));
  } catch (_error) {
    throw new Error(`${label} must contain valid JSON`);
  }
}

function validateRouteMetadata(payload, expectedVersion) {
  const key = String(payload && payload.key || "");
  const value = String(payload && payload.value || "");
  const versionName = String(payload && payload.versionName || "");
  if (key !== ROUTE_KEY) throw new Error(`Route key must be ${ROUTE_KEY}`);
  if (!ROUTE_VALUE_PATTERN.test(value)) throw new Error("Route value format is invalid");
  if (versionName !== expectedVersion) throw new Error(`Route version must be ${expectedVersion}`);
  const query = `${key}=${value}`;
  if (payload.query && payload.query !== query) throw new Error("Route query does not match key and value");
  return { key, value, versionName, query };
}

function validateCredentials(payload) {
  const appid = String(payload && payload.appid || "");
  const secret = String(payload && payload.secret || "");
  if (appid !== EXPECTED_APPID) throw new Error(`Credentials AppID must be ${EXPECTED_APPID}`);
  if (secret.length < 16 || secret.length > 128) throw new Error("Credentials AppSecret format is invalid");
  return { appid, secret };
}

function validateOutputBase(outputBase) {
  const resolved = path.resolve(outputBase);
  if (/\.(?:png|jpe?g)$/i.test(resolved)) throw new Error("Output base must not include an image extension");
  for (const extension of ["png", "jpg"]) {
    if (fs.existsSync(`${resolved}.${extension}`)) throw new Error("Output image already exists; refusing to overwrite");
  }
  const parent = fs.realpathSync(path.dirname(resolved));
  if (!isInsidePrivateTmp(parent)) throw new Error("Output parent resolves outside /private/tmp");
  fs.accessSync(parent, fs.constants.W_OK);
  return resolved;
}

function buildQrRequest(route, page = DEFAULT_PAGE) {
  const cleanPage = String(page || "");
  if (!/^pages\/[A-Za-z0-9_/-]+$/.test(cleanPage)) throw new Error("Mini-program page path is invalid");
  const qrPath = `${cleanPage}?${route.key}=${encodeURIComponent(route.value)}`;
  if (qrPath.length > MAX_QR_PATH_LENGTH) throw new Error("Mini-program QR path exceeds 1024 characters");
  return {
    path: qrPath,
    env_version: "trial",
    width: 430,
  };
}

function summarizePlan(route, request, outputBase) {
  return {
    mode: "DRY_RUN",
    appid: EXPECTED_APPID,
    targetVersion: route.versionName,
    envVersion: request.env_version,
    page: request.path.split("?")[0],
    pathLength: request.path.length,
    routeValueLength: route.value.length,
    routeFingerprint: sha256(route.query).slice(0, 12),
    outputPattern: `${outputBase}.{png|jpg}`,
    secretDisclosed: false,
    tokenDisclosed: false,
    networkCalled: false,
  };
}

async function parseJsonResponse(response, label) {
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (_error) {
    throw new Error(`${label} returned non-JSON data`);
  }
  const errcode = Number(payload.errcode || 0);
  if (!response.ok || errcode !== 0) {
    throw new Error(`${label} failed: HTTP ${response.status}, errcode ${errcode}, errmsg ${redact(payload.errmsg)}`);
  }
  return payload;
}

async function getStableAccessToken(credentials, fetchImpl = fetch) {
  const response = await fetchImpl(STABLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credential",
      appid: credentials.appid,
      secret: credentials.secret,
      force_refresh: false,
    }),
    redirect: "error",
    signal: AbortSignal.timeout(20000),
  });
  const payload = await parseJsonResponse(response, "stable_token");
  const accessToken = String(payload.access_token || "");
  if (!accessToken || Number(payload.expires_in || 0) <= 0) throw new Error("stable_token response is incomplete");
  return accessToken;
}

function isPng(buffer) {
  return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
}

function isJpeg(buffer) {
  return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

async function getTrialQrCode(accessToken, request, fetchImpl = fetch) {
  const url = new URL(QR_CODE_URL);
  url.searchParams.set("access_token", accessToken);
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    redirect: "error",
    signal: AbortSignal.timeout(20000),
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  if (response.ok && buffer.length <= MAX_IMAGE_BYTES && isPng(buffer)) return { image: buffer, extension: "png" };
  if (response.ok && buffer.length <= MAX_IMAGE_BYTES && isJpeg(buffer)) return { image: buffer, extension: "jpg" };
  let payload = {};
  try {
    payload = JSON.parse(buffer.toString("utf8"));
  } catch (_error) {
    throw new Error(`getQRCode failed: HTTP ${response.status}, invalid image response`);
  }
  throw new Error(`getQRCode failed: HTTP ${response.status}, errcode ${Number(payload.errcode || 0)}, errmsg ${redact(payload.errmsg)}`);
}

async function generateTrialQrCode(options, dependencies = {}) {
  const route = validateRouteMetadata(readPrivateJson(options.routeFile, "Route file"), options.expectedVersion);
  const outputBase = validateOutputBase(options.outputBase);
  const request = buildQrRequest(route, options.page);
  const plan = summarizePlan(route, request, outputBase);
  if (!options.confirmGenerate) return plan;

  const credentials = validateCredentials(readPrivateJson(options.credentialsFile, "Credentials file"));
  const fetchImpl = dependencies.fetchImpl || fetch;
  const accessToken = await getStableAccessToken(credentials, fetchImpl);
  const result = await getTrialQrCode(accessToken, request, fetchImpl);
  const output = `${outputBase}.${result.extension}`;
  fs.writeFileSync(output, result.image, { flag: "wx", mode: 0o600 });
  return {
    ...plan,
    mode: "GENERATED",
    output,
    imageBytes: result.image.length,
    imageSha256: sha256(result.image),
    networkCalled: true,
  };
}

async function main() {
  try {
    const result = await generateTrialQrCode(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`Trial QR generation failed: ${redact(error.message)}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  assertPrivateRegularFile,
  buildQrRequest,
  generateTrialQrCode,
  getStableAccessToken,
  getTrialQrCode,
  isJpeg,
  isPng,
  isInsidePrivateTmp,
  parseArgs,
  redact,
  summarizePlan,
  validateCredentials,
  validateOutputBase,
  validateRouteMetadata,
};
