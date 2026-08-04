# 正式上线 UED R0 证据

本目录把已批准的 20 个 Ardot Section Node 映射到当前小程序和运营后台实现文件。

- `screen-index.json` 只证明本地实现映射存在，不证明画板已实时回读或页面已经视觉验收；
- `visual-review.json` 在受控截图、逐屏差异复核和责任人确认完成前保持 `BLOCK`；
- `screenCount`、`archivedPagesExcluded` 和 `allCanonicalStatesCovered` 不会因为文件存在而自动成为 UED handoff 的正式事实。

生成或校验本地证据：

```sh
npm run evidence:local:write
npm run evidence:local:check
```
