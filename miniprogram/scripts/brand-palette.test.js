const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const FORBIDDEN_WARM_PALETTE = /#(?:080806|586b3f|8a8172|433e34|fdfbf6|f7f4ec|e8e0d0|e8e0d1|a6b77a|b67855|f1f5e6|eef1e8|6c6457|6f685d|6f675c|eee4cd|eee7dc|e6e2d8|d8d2c6|c8c0b2|a39a8b|f8f7f1|f4f3ec|f1eee6)\b|rgba\(\s*(?:253\s*,\s*251\s*,\s*246|248\s*,\s*247\s*,\s*241|232\s*,\s*224\s*,\s*208|182\s*,\s*120\s*,\s*85|146\s*,\s*96\s*,\s*66|88\s*,\s*107\s*,\s*63|8\s*,\s*8\s*,\s*6)\s*,/i;

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    return /\.(?:wxml|wxss)$/.test(entry.name) ? [fullPath] : [];
  });
}

function walkUiConfigAndAssets(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkUiConfigAndAssets(fullPath);
    return /\.(?:json|svg)$/.test(entry.name) ? [fullPath] : [];
  });
}

const offenders = [...walk(root), ...walkUiConfigAndAssets(root)].flatMap((file) => {
  const source = fs.readFileSync(file, "utf8");
  return FORBIDDEN_WARM_PALETTE.test(source) ? [path.relative(root, file)] : [];
});

assert.deepEqual(offenders, [], `0.7.0 禁止旧米色调色板：${offenders.join(", ")}`);

const rawColorOffenders = walk(root).flatMap((file) => {
  const relative = path.relative(root, file);
  if (relative === "styles/tokens.wxss") return [];
  const source = fs.readFileSync(file, "utf8");
  const withoutNativeCheckboxColor = source.replace(/color="#242a0b"/gi, "");
  return /#[0-9a-f]{3,8}\b/i.test(withoutNativeCheckboxColor) ? [relative] : [];
});
assert.deepEqual(rawColorOffenders, [], `界面颜色必须来自语义 token：${rawColorOffenders.join(", ")}`);

const tokens = fs.readFileSync(path.join(root, "styles/tokens.wxss"), "utf8").toLowerCase();
[
  "--root-ink: #000000",
  "--root-bg: #f5f5f7",
  "--root-nav: #ffffff",
  "--root-moss: #242a0b",
  "--root-sprout: #a1b371",
  "--root-copy: #3a3a3c",
  "--root-muted: #7b7a7e",
  "--root-media-matte-brand-foundation-02: #9a6848",
].forEach((token) => assert.match(tokens, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))));

console.log(`brand palette checks passed across ${walk(root).length} WXML/WXSS files`);
