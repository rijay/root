#!/usr/bin/env node

const {
  buildCloudbaseJobManifest,
  validateCloudbaseJobManifest,
} = require("./cloudbase-job-manifest");
const {
  buildCalibrationReport,
} = require("./release-calibration");
const { buildProductionEnvMatrix } = require("../src/productionEnvMatrix");
const {
  buildReleaseEvidencePack,
  buildReleaseEvidencePackReport,
  validateReleaseEvidencePack,
} = require("../src/releaseEvidencePack");

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function resolveBaseUrl(env = process.env) {
  return normalizeBaseUrl(
    env.ROOT_RELEASE_EVIDENCE_BASE_URL ||
      env.ROOT_CALIBRATION_BASE_URL ||
      env.ROOT_JOB_BASE_URL ||
      env.ROOT_PUBLIC_BASE_URL ||
      `http://127.0.0.1:${env.PORT || 8787}`,
  );
}

function parseArgs(argv, env = process.env) {
  const args = {
    baseUrl: resolveBaseUrl(env),
    target: "production",
    adminToken: env.ROOT_RELEASE_EVIDENCE_ADMIN_TOKEN || env.ROOT_ADMIN_JOB_TOKEN || env.ROOT_ADMIN_TOKEN || "",
    json: false,
    strict: false,
    allowBlocked: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--base-url") args.baseUrl = normalizeBaseUrl(argv[index += 1] || args.baseUrl);
    else if (item === "--target") args.target = argv[index += 1] === "gray" ? "gray" : "production";
    else if (item === "--admin-token") args.adminToken = String(argv[index += 1] || "").trim();
    else if (item === "--json") args.json = true;
    else if (item === "--strict") args.strict = true;
    else if (item === "--allow-blocked") args.allowBlocked = true;
  }
  return args;
}

async function fetchJson(baseUrl, path, adminToken = "") {
  const headers = adminToken ? { "X-Admin-Token": adminToken } : {};
  const response = await fetch(`${baseUrl}${path}`, { headers });
  const payload = await response.json();
  if (!response.ok || payload.code !== 0) {
    throw new Error(payload.message || `请求失败：${response.status}`);
  }
  return payload.data;
}

async function collectReleaseEvidencePack(args, env = process.env) {
  const target = encodeURIComponent(args.target);
  const [releaseRecord, adapterCalibration, actionAdapterCalibration, launchReadiness, externalAdapters] = await Promise.all([
    fetchJson(args.baseUrl, `/api/v1/admin/release-record?target=${target}`, args.adminToken),
    fetchJson(args.baseUrl, "/api/v1/admin/adapter-calibration", args.adminToken),
    fetchJson(args.baseUrl, `/api/v1/admin/action-adapter-calibration?target=${target}`, args.adminToken),
    fetchJson(args.baseUrl, `/api/v1/admin/launch-readiness?target=${target}`, args.adminToken),
    fetchJson(args.baseUrl, "/api/v1/admin/external-adapters", args.adminToken),
  ]);
  const productionEnvMatrix = buildProductionEnvMatrix(env, { target: args.target });
  const cloudbaseJobManifest = buildCloudbaseJobManifest({ baseUrl: args.baseUrl, env });
  const cloudbaseJobValidation = validateCloudbaseJobManifest(cloudbaseJobManifest, { strict: args.strict });
  const calibrationReport = buildCalibrationReport({
    releaseRecord,
    adapterCalibration,
    actionAdapterCalibration,
    launchReadiness,
    externalAdapters,
  });
  const pack = buildReleaseEvidencePack({
    target: args.target,
    baseUrl: args.baseUrl,
    releaseRecord,
    adapterCalibration,
    actionAdapterCalibration,
    productionEnvMatrix,
    cloudbaseJobManifest,
    cloudbaseJobValidation,
    calibrationReport,
  });
  return {
    pack,
    validation: validateReleaseEvidencePack(pack),
  };
}

function determineExitCode(pack, args = {}, validation = { status: "PASS" }) {
  if (validation.status !== "PASS") return 1;
  if (args.allowBlocked) return 0;
  if (pack.status === "BLOCKED") return 2;
  if (args.strict && pack.status === "NEEDS_REVIEW") return 3;
  return 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  try {
    const bundle = await collectReleaseEvidencePack(args);
    if (args.json) {
      process.stdout.write(`${JSON.stringify(bundle, null, 2)}\n`);
    } else {
      process.stdout.write(buildReleaseEvidencePackReport(bundle.pack, bundle.validation));
    }
    process.exitCode = determineExitCode(bundle.pack, args, bundle.validation);
  } catch (error) {
    process.stderr.write(`发布证据包生成失败：${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  collectReleaseEvidencePack,
  determineExitCode,
  parseArgs,
  resolveBaseUrl,
};
