#!/usr/bin/env node

const { buildProductionEnvMatrix } = require("../src/productionEnvMatrix");

function parseArgs(argv) {
  const args = {
    target: "production",
    json: false,
    allowBlocked: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--target") args.target = argv[index += 1] === "gray" ? "gray" : "production";
    else if (item === "--json") args.json = true;
    else if (item === "--allow-blocked") args.allowBlocked = true;
  }
  return args;
}

function formatEnvRows(rows) {
  if (!rows || !rows.length) return ["  - 无"];
  return rows.map((item) => {
    const status = !item.present ? "MISSING" : item.valid === false ? "INVALID" : "OK";
    const expected = item.valid === false && item.expectedValues && item.expectedValues.length
      ? `（需为 ${item.expectedValues.join(" / ")}）`
      : item.valid === false && item.expectedDescription
        ? `（需为${item.expectedDescription}）`
      : "";
    return `  - ${status} ${item.name}${expected}`;
  });
}

function formatAnyOfRows(rows) {
  if (!rows || !rows.length) return ["  - 无"];
  return rows.map((item) => {
    const selected = item.presentNames && item.presentNames.length ? `：${item.presentNames.join(", ")}` : "";
    return `  - ${item.present ? "OK" : "MISSING"} ${item.names.join(" / ")}${selected}`;
  });
}

function buildProductionEnvMatrixReport(matrix) {
  const lines = [
    `# ${matrix.title}`,
    "",
    `目标：${matrix.target}`,
    `状态：${matrix.status}`,
    `摘要：阻塞 ${matrix.summary.blockers}，提醒 ${matrix.summary.warnings}，通过 ${matrix.summary.passed}，可选 ${matrix.summary.optional}`,
    `生成时间：${matrix.generatedAt}`,
    "",
  ];
  for (const group of matrix.groups) {
    lines.push(
      `## ${group.label}`,
      `- 状态：${group.status}`,
      `- 负责人：${group.ownerRole || "-"}`,
      `- 处理：${group.message}`,
      "- 必需变量：",
      ...formatEnvRows(group.required),
      "- 任选变量：",
      ...formatAnyOfRows(group.anyOf),
      "- 可选变量：",
      ...formatEnvRows(group.optional),
      "",
    );
  }
  lines.push(
    "## 缺失汇总",
    ...(matrix.missingEnv.length
      ? matrix.missingEnv.map((item) => `- ${item.groupLabel}: ${item.name}`)
      : ["- 暂无缺失项"]),
  );
  return `${lines.join("\n")}\n`;
}

function determineExitCode(matrix, args = {}) {
  if (args.allowBlocked) return 0;
  if (matrix.status === "BLOCKED") return 2;
  if (matrix.status === "NEEDS_REVIEW") return 3;
  return 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const matrix = buildProductionEnvMatrix(process.env, { target: args.target });
  if (args.json) {
    process.stdout.write(`${JSON.stringify(matrix, null, 2)}\n`);
  } else {
    process.stdout.write(buildProductionEnvMatrixReport(matrix));
  }
  process.exitCode = determineExitCode(matrix, args);
}

if (require.main === module) {
  main();
}

module.exports = {
  buildProductionEnvMatrixReport,
  determineExitCode,
  parseArgs,
};
