# myRoot v0.6.0 UED 与本地实现证据

本目录记录 2026-08-17 对 v0.6.0 健康评测新增页面的受控视觉复核。

- `screen-index.json`：Ardot 设计节点、微信开发者工具截图与实现文件的映射。
- `visual-review.json`：底部导航、安全区、裁切、换行和主操作可达性的复核结果。
- `screenshots/reference/`：从 Ardot `myRoot` 文件 `527:1` 页面直接导出的参考图。
- `screenshots/implementation/miniprogram/`：微信开发者工具模拟器中的本地实现截图。

边界：实现截图使用只存在于当前模拟器会话的合成数据；Mock 已在截图后恢复并刷新模拟器。该证据只证明本地页面结构与视觉状态，不证明候选环境 API、真实用户数据、真机兼容性或健康内容已获专业/合规授权。
