const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const app = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8"));
const project = JSON.parse(fs.readFileSync(path.join(root, "project.config.json"), "utf8"));
const privatePath = path.join(root, "project.private.config.json");
const privateProject = fs.existsSync(privatePath) ? JSON.parse(fs.readFileSync(privatePath, "utf8")) : {};
const env = require("../config/env");
const { appVersion } = require("../config/version");
const packageVersion = require("../package.json").version;
const router = require("../utils/router");
const requestModule = require("../utils/request");
const { initializePrivacyAuthorization } = require("../utils/privacy-authorization");

const problems = [];
const pageRoutes = [
  ...app.pages,
  ...(app.subPackages || []).flatMap((pkg) => pkg.pages.map((page) => `${pkg.root}/${page}`)),
];

pageRoutes.forEach((route) => {
  ["js", "json", "wxml", "wxss"].forEach((extension) => {
    const file = path.join(root, `${route}.${extension}`);
    if (!fs.existsSync(file)) problems.push(`页面文件缺失：${route}.${extension}`);
  });
});

if (appVersion !== packageVersion) problems.push(`版本不一致：config=${appVersion}, package=${packageVersion}`);
if (env.requestAdapter !== "cloudContainer") problems.push("默认请求 Adapter 必须为 cloudContainer");
if (!env.cloudEnvId || !env.cloudServiceName) problems.push("CloudBase 环境和云托管名称必须配置");
if (env.apiBaseUrl && /\.sh\.run\.tcloudbase\.com/i.test(env.apiBaseUrl)) {
  problems.push("正式包不得包含 CloudBase 默认公网域名");
}

const requiredSettings = {
  ignoreUploadUnusedFiles: true,
  minified: true,
  minifyJS: true,
  minifyWXML: true,
  minifyWXSS: true,
  uploadWithSourceMap: false,
  urlCheck: true,
};
Object.entries(requiredSettings).forEach(([key, expected]) => {
  if (!project.setting || project.setting[key] !== expected) {
    problems.push(`project.config.json setting.${key} 必须为 ${expected}`);
  }
  if (privateProject.setting && privateProject.setting[key] !== undefined && privateProject.setting[key] !== expected) {
    problems.push(`project.private.config.json 不得覆盖 setting.${key}`);
  }
});

if (typeof router.assertRegistered !== "function" || typeof router.routeGuard !== "function") {
  problems.push("正式路由 Module Interface 不完整");
}
if (typeof requestModule.request !== "function" || typeof requestModule.cancelRequestScope !== "function") {
  problems.push("请求 Module Interface 不完整");
}
if (typeof initializePrivacyAuthorization !== "function") {
  problems.push("隐私授权 Module Interface 不完整");
}

const forbiddenCopy = ["治好", "立刻改善", "自动发布朋友圈", "一键发布小红书"];
pageRoutes.forEach((route) => {
  const wxml = fs.readFileSync(path.join(root, `${route}.wxml`), "utf8");
  forbiddenCopy.forEach((copy) => {
    if (wxml.includes(copy)) problems.push(`${route}.wxml 包含禁止文案：${copy}`);
  });
});

if (problems.length) {
  console.error(`Mini-program validation failed:\n${problems.join("\n")}`);
  process.exit(1);
}

console.log("miniprogram validation ok");
