# 正式上线 UED R0 证据

本目录把已批准的 20 个 Ardot Section Node 映射到当前小程序和运营后台实现文件，并保存 2026-08-04 本地受控截图。

- `screen-index.json` 记录 20 个批准 Section、实际主画板 Node、实现文件与受控截图；
- `screenshots/implementation/miniprogram/` 来自微信开发者工具 iPhone 12/13 Pro 模拟器，系统视口 390×844，原始截图 602×1300；
- `screenshots/implementation/admin/` 来自本地 Element Plus Admin，固定页面视口 1240×820；
- `screenshots/reference/` 已保存 20 个批准 Section 的直接参考图，并保留后台编辑抽屉等补充状态参考；
- `visual-review.json` 已完成 20/20 逐屏直接对照；候选数据态和真机/微信平台态尚未完成，因此正式上线总状态仍保持 `BLOCK`；
- `LOCAL_MOCKED_STATE` 仅用于复现已实现的布局分支，不证明真实用户、候选环境数据或生产链路。

本轮已直接确认批准页 `368:1` 下存在 20 个顶层 Section，因此 `screenCount=20`、`archivedPagesExcluded=true`；本地视觉状态已覆盖，候选与真机状态仍以外部门禁单列，不借本地截图关闭。

生成或校验本地证据：

```sh
npm run evidence:local:write
npm run evidence:local:check
```
