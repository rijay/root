# myRoot 代码工作树

- 本目录才是应用 Git 根；开始时核对分支、提交、`git status --short` 和小程序版本。目录名与远端 main 可能滞后；保留其他任务未提交改动。
- 使用 Node 22（`.nvmrc` 与 CI 对齐）和 npm 锁文件。新树运行 `npm run setup`、`npm run admin:build`、`npm run doctor`。
- 小程序：`miniprogram/`；服务端：`backend/src/`；后台：`admin/src/`。实际路由以 `miniprogram/app.json` 和 `backend/src/app.js` 为准。历史文档不能证明当前运行能力。
- 默认本地调试用 `npm run dev:local`，后台热更新用 `npm run dev:admin`。数据、构建和验证日志留在当前树；不要复制生产数据、凭据或其他任务的可写数据库。
- 先跑修改涉及的阶段：`npm run verify -- --only=backend,miniprogram,admin` 等；跨层联调用 `npm run qa:local`。交付前跑所需完整门禁并保留 `.local-state/verification/` 日志及跳过项。
- 删除代码前核对路由、静态/动态引用、操作脚本和保留用途。权限、身份、隐私、安全、幂等、审计和离线发布验证仍可能有独立用途，不因包装层浅或未被 HTTP 调用就删除。
- 验证失败先读取完整阶段日志。证据过期需确认差异后再刷新；不能把缺失真机/MySQL证据改成通过。用户取消验证时停止后续阶段。
- 工作树与 QA 细节见 `docs/development.md`。本地验证、推送、远端 CI、上传、真机验收与发布分别记录；按用户已授权范围操作。
