#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

const TARGET = Object.freeze({
  environmentId: "myroot-prod-d5gl3gzg7115f149a",
  serviceName: "myroot-api",
  stableVersion: "myroot-api-041",
  previousCandidate: "myroot-api-044",
  candidateVersion: "myroot-api-045",
  previousReleaseId: "v1.0.0+f8e12966-formal-review-candidate-20260804",
  releaseId: "v1.0.0+f8e12966-formal-health-write-candidate-20260805",
  baseUrl: "https://myroot-api-273748-8-1437260454.sh.run.tcloudbase.com",
  artifactPath: "/tmp/myroot-api-candidate-f8e12966.zip",
  artifactSha256: "aaed975da6daa0c688c5f5e3b7e331b8112a51ed5f6c20ba4c8d3b987dc0b43c",
});

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function jsonOutput(stdout, code) {
  const source = String(stdout || "");
  const start = source.indexOf("{");
  if (start < 0) throw fail(code);
  try { return JSON.parse(source.slice(start)); } catch { throw fail(code); }
}

function api(service, action, body, version) {
  const result = spawnSync("tcb", [
    "api", service, action,
    "--api-version", version,
    "--body", JSON.stringify(body),
    "--json",
  ], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 24 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw fail(`API_${action.toUpperCase()}_FAILED`);
  const payload = jsonOutput(result.stdout, `API_${action.toUpperCase()}_JSON_INVALID`);
  return payload.data || payload.Response || payload;
}

function tcbr(action, body) {
  return api("tcbr", action, body, "2022-02-17");
}

function tcb(action, body) {
  return api("tcb", action, body, "2018-06-08");
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function artifactDigest() {
  if (!fs.existsSync(TARGET.artifactPath)) throw fail("CANDIDATE_ARTIFACT_MISSING");
  const digest = crypto.createHash("sha256").update(fs.readFileSync(TARGET.artifactPath)).digest("hex");
  if (digest !== TARGET.artifactSha256) throw fail("CANDIDATE_ARTIFACT_DIGEST_MISMATCH");
  return digest;
}

function releaseOrder() {
  return tcbr("DescribeReleaseOrder", {
    EnvId: TARGET.environmentId,
    ServerName: TARGET.serviceName,
  }).ReleaseOrderInfo;
}

function task() {
  return tcbr("DescribeServerManageTask", {
    EnvId: TARGET.environmentId,
    ServerName: TARGET.serviceName,
    TaskId: 0,
  }).Task;
}

function versionDetail(versionName) {
  return tcbr("DescribeVersionDetail", {
    EnvId: TARGET.environmentId,
    ServerName: TARGET.serviceName,
    VersionName: versionName,
  });
}

function serverDetail() {
  return tcbr("DescribeCloudRunServerDetail", {
    EnvId: TARGET.environmentId,
    ServerName: TARGET.serviceName,
  });
}

function initialGuard() {
  const info = releaseOrder();
  const currentTask = task();
  if (!info
    || info.CurrentVersion.VersionName !== TARGET.stableVersion
    || info.ReleaseVersion.VersionName !== TARGET.previousCandidate
    || info.TrafficType !== "URL_PARAMS"
    || Number(info.FlowRatio) !== 0
    || info.GrayStatus !== "success"
    || info.ReleaseStatus !== "gray"
    || info.IsReleasing !== true
    || !Array.isArray(info.TrafficTypeValues)
    || info.TrafficTypeValues.length !== 1
    || !info.TrafficTypeValues[0].Key
    || !info.TrafficTypeValues[0].Value
    || !currentTask
    || currentTask.Status !== "running"
    || currentTask.ReleaseType !== "GRAY"
    || currentTask.VersionName !== TARGET.previousCandidate) {
    throw fail("INITIAL_RELEASE_GUARD_FAILED");
  }
  return Object.freeze({
    taskId: currentTask.Id,
    route: Object.freeze({
      Key: info.TrafficTypeValues[0].Key,
      Value: info.TrafficTypeValues[0].Value,
    }),
  });
}

function candidateConfig() {
  const detail = versionDetail(TARGET.previousCandidate);
  const service = serverDetail();
  let envParams;
  try { envParams = JSON.parse(detail.EnvParams); } catch { throw fail("CANDIDATE_ENV_INVALID"); }
  if (!envParams || typeof envParams !== "object" || Array.isArray(envParams)
    || Object.keys(envParams).length !== 81
    || envParams.ROOT_RELEASE_ID !== TARGET.previousReleaseId
    || String(envParams.ROOT_FORMAL_HEALTH_WRITES_ENABLED || "").toLowerCase() === "true"
    || detail.Status !== "normal"
    || detail.Name !== TARGET.previousCandidate
    || !detail.VpcConf || !detail.VpcConf.VpcId || !detail.VpcConf.SubnetId) {
    throw fail("CANDIDATE_CONFIG_GUARD_FAILED");
  }
  const nextEnv = {
    ...envParams,
    ROOT_RELEASE_ID: TARGET.releaseId,
    ROOT_FORMAL_HEALTH_WRITES_ENABLED: "true",
  };
  const config = service.ServerConfig || {};
  const items = [
    { Key: "CpuSpecs", FloatValue: detail.Cpu },
    { Key: "MemSpecs", FloatValue: detail.Mem },
    { Key: "MinNum", IntValue: detail.MinNum },
    { Key: "MaxNum", IntValue: detail.MaxNum },
    { Key: "PolicyDetails", PolicyDetails: detail.PolicyDetails || [] },
    { Key: "AccessTypes", ArrayValue: config.OpenAccessTypes || service.BaseInfo && service.BaseInfo.AccessTypes || [] },
    { Key: "EnvParam", Value: JSON.stringify(nextEnv) },
    { Key: "Port", IntValue: detail.Port },
    { Key: "HasDockerfile", BoolValue: true },
    { Key: "VpcConf", VpcConf: detail.VpcConf },
    { Key: "VolumesConf", VolumesConf: detail.VolumesConf || [] },
    { Key: "PublicNetConf", PublicNetConf: detail.PublicNetConf || config.PublicNetConf || {} },
  ];
  const stringFields = [
    ["LogPath", detail.LogPath],
    ["Dockerfile", detail.Dockerfile],
    ["BuildDir", detail.BuildDir],
    ["InternalAccess", config.InternalAccess],
    ["OperationMode", config.OperationMode],
    ["SessionAffinity", config.SessionAffinity],
    ["LogType", config.LogType],
    ["LogSetId", config.LogSetId],
    ["LogTopicId", config.LogTopicId],
    ["LogParseType", config.LogParseType],
  ];
  stringFields.forEach(([Key, Value]) => {
    if (Value !== undefined && Value !== null && String(Value) !== "") items.push({ Key, Value: String(Value) });
  });
  if (Array.isArray(detail.EntryPoint) && detail.EntryPoint.length) items.push({ Key: "EntryPoint", ArrayValue: detail.EntryPoint });
  if (Array.isArray(detail.Cmd) && detail.Cmd.length) items.push({ Key: "Cmd", ArrayValue: detail.Cmd });
  if (Array.isArray(config.TimerScale) && config.TimerScale.length) items.push({ Key: "TimerScale", TimerScale: config.TimerScale });
  if (Number.isInteger(config.InitialDelaySeconds)) items.push({ Key: "InitialDelaySeconds", IntValue: config.InitialDelaySeconds });
  return Object.freeze({
    items,
    nextEnv,
    sourceEnv: envParams,
    vpcId: detail.VpcConf.VpcId,
    subnetId: detail.VpcConf.SubnetId,
    cpu: detail.Cpu,
    mem: detail.Mem,
    minNum: detail.MinNum,
    maxNum: detail.MaxNum,
    port: detail.Port,
  });
}

function configDiffGuard(config) {
  const source = config.sourceEnv;
  const next = config.nextEnv;
  const changed = [...new Set([...Object.keys(source), ...Object.keys(next)])]
    .filter((key) => source[key] !== next[key])
    .sort();
  if (changed.join(",") !== "ROOT_FORMAL_HEALTH_WRITES_ENABLED,ROOT_RELEASE_ID") {
    throw fail("ENV_DIFF_GUARD_FAILED");
  }
  return changed;
}

function waitForRollback() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const info = releaseOrder();
    if (!info.IsReleasing) return;
    sleep(2000);
  }
  throw fail("PREVIOUS_GRAY_ROLLBACK_TIMEOUT");
}

async function uploadArtifact() {
  const build = tcb("DescribeCloudBaseBuildService", {
    EnvId: TARGET.environmentId,
    ServiceName: TARGET.serviceName,
  });
  if (!build.UploadUrl || !build.PackageName || !build.PackageVersion) {
    throw fail("BUILD_UPLOAD_TARGET_INVALID");
  }
  const headers = Object.fromEntries((build.UploadHeaders || []).map((item) => [item.Key, item.Value]));
  const response = await fetch(build.UploadUrl, {
    method: "PUT",
    headers,
    body: fs.readFileSync(TARGET.artifactPath),
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw fail("CANDIDATE_ARTIFACT_UPLOAD_FAILED");
  return Object.freeze({ packageName: build.PackageName, packageVersion: build.PackageVersion });
}

function deploy(upload, config) {
  return tcbr("UpdateCloudRunServer", {
    EnvId: TARGET.environmentId,
    ServerName: TARGET.serviceName,
    DeployInfo: {
      DeployType: "package",
      PackageName: upload.packageName,
      PackageVersion: upload.packageVersion,
      ReleaseType: "GRAY",
      DeployRemark: "045 exact 044 artifact with formal health writes enabled for controlled test",
    },
    Items: config.items,
  });
}

function waitForCandidate() {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const currentTask = task();
    const versionName = currentTask && currentTask.VersionName;
    if (versionName && versionName !== TARGET.previousCandidate && versionName !== TARGET.candidateVersion) {
      throw fail("UNEXPECTED_CANDIDATE_VERSION");
    }
    if (versionName === TARGET.candidateVersion) {
      try {
        const detail = versionDetail(TARGET.candidateVersion);
        if (detail.Status === "normal") return detail;
        if (["build_failed", "deploy_failed"].includes(detail.Status)) throw fail("CANDIDATE_DEPLOY_FAILED");
      } catch (error) {
        if (error.code === "CANDIDATE_DEPLOY_FAILED") throw error;
      }
    }
    sleep(5000);
  }
  throw fail("CANDIDATE_DEPLOY_TIMEOUT");
}

function releaseCandidate(route) {
  tcbr("ReleaseGray", {
    EnvId: TARGET.environmentId,
    ServerName: TARGET.serviceName,
    GrayType: "gray",
    TrafficType: "URL_PARAMS",
    GrayFlowRatio: 0,
    OperatorRemark: "045 controlled formal health write verification at zero percent",
    VersionFlowItems: [
      {
        VersionName: TARGET.candidateVersion,
        FlowRatio: 0,
        UrlParam: route,
        Priority: 1,
        IsDefaultPriority: false,
      },
      {
        VersionName: TARGET.stableVersion,
        FlowRatio: 0,
        IsDefaultPriority: true,
      },
    ],
  });
  for (let attempt = 0; attempt < 45; attempt += 1) {
    const info = releaseOrder();
    if (info.CurrentVersion.VersionName === TARGET.stableVersion
      && info.ReleaseVersion.VersionName === TARGET.candidateVersion
      && info.TrafficType === "URL_PARAMS"
      && Number(info.FlowRatio) === 0
      && info.GrayStatus === "success"
      && info.ReleaseStatus === "gray"
      && info.IsReleasing === true
      && Array.isArray(info.TrafficTypeValues)
      && info.TrafficTypeValues.length === 1
      && info.TrafficTypeValues[0].Key === route.Key
      && info.TrafficTypeValues[0].Value === route.Value) return;
    sleep(2000);
  }
  throw fail("CANDIDATE_RELEASE_GUARD_TIMEOUT");
}

async function jsonRequest(pathname, route = null) {
  const url = new URL(TARGET.baseUrl);
  url.pathname = pathname;
  if (route) url.searchParams.set(route.Key, route.Value);
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  let body = {};
  try { body = await response.json(); } catch {}
  return { status: response.status, body };
}

async function runtimeGuard(route) {
  let directedHealth;
  let directedReady;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    directedHealth = await jsonRequest("/health", route);
    directedReady = await jsonRequest("/ready", route);
    if (directedHealth.status === 200
      && directedHealth.body.code === 0
      && directedHealth.body.data.releaseId === TARGET.releaseId
      && directedReady.status === 200
      && directedReady.body.code === 0
      && directedReady.body.data.releaseId === TARGET.releaseId
      && !(directedReady.body.data.mysql && directedReady.body.data.mysql.connected === false)) break;
    sleep(1500);
  }
  if (directedHealth.status !== 200
    || directedHealth.body.code !== 0
    || directedHealth.body.data.releaseId !== TARGET.releaseId
    || directedReady.status !== 200
    || directedReady.body.code !== 0
    || directedReady.body.data.releaseId !== TARGET.releaseId
    || directedReady.body.data.mysql && directedReady.body.data.mysql.connected === false) {
    throw fail("DIRECTED_RUNTIME_GUARD_FAILED");
  }
  for (let index = 0; index < 15; index += 1) {
    const stable = await jsonRequest("/health");
    if (stable.status !== 200
      || stable.body.code !== 0
      || stable.body.data.releaseId === TARGET.releaseId) {
      throw fail("DEFAULT_TRAFFIC_GUARD_FAILED");
    }
  }
}

async function execute(apply) {
  const digest = artifactDigest();
  const initial = initialGuard();
  const config = candidateConfig();
  const changedKeys = configDiffGuard(config);
  if (!apply) {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      mode: "plan",
      artifactSha256: digest,
      stableVersion: TARGET.stableVersion,
      previousCandidate: TARGET.previousCandidate,
      nextCandidate: TARGET.candidateVersion,
      trafficType: "URL_PARAMS",
      candidateTrafficPercent: 0,
      routeCount: 1,
      sourceEnvVarCount: Object.keys(config.sourceEnv).length,
      nextEnvVarCount: Object.keys(config.nextEnv).length,
      changedEnvKeys: changedKeys,
      vpcConfigured: Boolean(config.vpcId && config.subnetId),
      cpu: config.cpu,
      mem: config.mem,
      minNum: config.minNum,
      maxNum: config.maxNum,
      port: config.port,
    }, null, 2)}\n`);
    return;
  }

  tcbr("OperateServerManage", {
    EnvId: TARGET.environmentId,
    ServerName: TARGET.serviceName,
    TaskId: initial.taskId,
    OperateType: "go_back",
  });
  process.stdout.write("previous-zero-percent-gray-ended\n");
  waitForRollback();

  const upload = await uploadArtifact();
  process.stdout.write("exact-artifact-uploaded\n");
  deploy(upload, config);
  process.stdout.write("candidate-deploy-submitted\n");
  const detail = waitForCandidate();
  process.stdout.write("candidate-runtime-normal\n");

  let deployedEnv;
  try { deployedEnv = JSON.parse(detail.EnvParams); } catch { throw fail("DEPLOYED_ENV_INVALID"); }
  if (detail.Name !== TARGET.candidateVersion
    || deployedEnv.ROOT_RELEASE_ID !== TARGET.releaseId
    || deployedEnv.ROOT_FORMAL_HEALTH_WRITES_ENABLED !== "true"
    || Object.keys(deployedEnv).length !== 82
    || detail.VpcConf.VpcId !== config.vpcId
    || detail.VpcConf.SubnetId !== config.subnetId
    || detail.Cpu !== config.cpu
    || detail.Mem !== config.mem
    || detail.MinNum !== config.minNum
    || detail.MaxNum !== config.maxNum
    || detail.Port !== config.port) {
    throw fail("DEPLOYED_CONFIG_GUARD_FAILED");
  }

  releaseCandidate(initial.route);
  process.stdout.write("candidate-zero-percent-route-ready\n");
  await runtimeGuard(initial.route);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    mode: "apply",
    artifactSha256: digest,
    stableVersion: TARGET.stableVersion,
    candidateVersion: TARGET.candidateVersion,
    releaseId: TARGET.releaseId,
    trafficType: "URL_PARAMS",
    candidateTrafficPercent: 0,
    formalHealthWritesEnabled: true,
    directedRuntimeReady: true,
    defaultTrafficProbeCount: 15,
    defaultCandidateHits: 0,
  }, null, 2)}\n`);
}

if (require.main === module) {
  execute(process.argv.includes("--apply")).catch((error) => {
    process.stderr.write(`${JSON.stringify({ ok: false, code: error.code || "CANDIDATE_045_EXECUTION_FAILED" })}\n`);
    process.exitCode = 1;
  });
}

module.exports = { TARGET, artifactDigest, candidateConfig, configDiffGuard, execute, initialGuard };
