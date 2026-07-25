# myRoot v1.0.0 远端 CI 只读回读

时间：2026-07-19 20:14:41 +08:00。范围：只读；未提交、推送、创建 PR、触发 workflow、修改保护规则或生成 attestation。

## 当前远端事实

- 仓库：`rijay/root`，默认分支 `main`，public。
- 本地 HEAD 与远端 `main` 都是 `d761ae26fd328df703d2f2d3233124b07065e453`。
- 远端 `main` 获取 `.github/workflows/ci.yml` 返回 404。
- 该 SHA 的 combined statuses 为空。
- 该 SHA 的 Pull Request workflow runs 为空。
- 当前 Connector Interface 不提供 branch protection/ruleset 只读回读，因此它们的当前状态标记为 `UNVERIFIED`，不得沿用历史快照冒充当前事实。

## 当前本地待交付实现

本地 workflow SHA-256 为 `1691c969f5b85b419a9173147578ec6b826089ffd17f855318632628cc1a4a29`，尚不属于 HEAD。预期三个 check name：

1. `Source provenance only`
2. `Full verification`
3. `Cloud Functions Node.js 18 compatibility`

`Full verification` 已改为显式执行冻结的 001～065 真实引擎组，包含 readiness parser regression 与 Runtime Principal Bootstrap，共要求 `13/13 PASS / 0 SKIP`。机器可读 Required Check Contract 位于 `contracts/required-checks/v1.0.0.json`，但其中名称在首次真实运行回读前只能视为本地预期值。

## Gate 裁决

远端 CI required check 与 artifact provenance Gate 均保持 OPEN。正式关闭仍需独立授权并按顺序完成 commit、push、PR、首次真实 CI、actual check context 回读、artifact 下载复算及 active protection/ruleset 回读；当前证据不授权其中任何写动作。
