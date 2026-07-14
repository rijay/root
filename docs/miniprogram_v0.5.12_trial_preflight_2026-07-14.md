# myRoot 小程序 v0.5.12 体验版预检

日期：2026-07-14

状态：`PREFLIGHT_PASS / ROUTE_LIFECYCLE_FIXED / ORDINARY_ACCOUNT_QR_ROUTE_CONFIRMED / QR_TOOL_DRY_RUN_READY / LOCAL_COMMIT_REQUIRED / DEVTOOLS_LOGIN_REQUIRED / NOT_UPLOADED`

## 1. 实际读取来源

1. `miniprogram/app.js`、`config/env.js`、`utils/cloud-route.js`、`utils/request.js`、`project.config.json`、本地私有配置、发布清单脚本和小程序专向测试。
2. 微信开发者工具 `2.01.2510290` 的本机 CLI 帮助、上传参数和登录状态；行动时 `islogin=false`。
3. Cloud Function `myroot-job-dispatcher` 的脱敏只读配置：候选路由变量存在、生产域名一致、全局 dry-run 开启；未输出路由值或凭据。
4. 微信官方 [App.onLaunch](https://developers.weixin.qq.com/miniprogram/dev/reference/api/App.html#onLaunch-Object-object)、[wx.getLaunchOptionsSync](https://developers.weixin.qq.com/miniprogram/dev/api/base/app/life-cycle/wx.getLaunchOptionsSync.html)、[获取小程序码 getQRCode](https://developers.weixin.qq.com/miniprogram/dev/server/API/qrcode-link/qr-code/api_getqrcode.html) 与 [第三方平台获取体验版二维码 getTrialQRCode](https://developers.weixin.qq.com/doc/oplatform/openApi/miniprogram-management/code-management/api_gettrialqrcode.html) 文档。`getQRCode` 可由普通小程序账号使用，`path` 最大 1024 字符且可携带 query，`env_version="trial"` 指向体验版；`getTrialQRCode` 属于第三方平台代商家接口，本项目没有第三方平台身份与 `authorizer_access_token`，不适用。
5. 2026-07-14 12:01 再次只读执行开发者工具 CLI `islogin`，返回 `login=false`；随后只查看 `login --help` 参数，没有启动登录、生成二维码或上传。
6. 2026-07-14 12:40 再次只读执行开发者工具 CLI `islogin`，仍为 `login=false`；CloudBase CLI `tcb env list --json` 同时返回 `No valid identity information`。两者均未触发登录或云端写入。
7. 微信官方 [获取稳定版接口调用凭据](https://developers.weixin.qq.com/miniprogram/dev/server/API/mp-access-token/api_getstableaccesstoken.html) 文档：`POST /cgi-bin/stable_token` 与经典 token 相互隔离，普通模式 `force_refresh=false` 在有效期内不会刷新；错误码 `40164` 表示调用 IP 不在白名单。
8. 本地 `scripts/generate-wechat-trial-qrcode.js` 与无网络契约测试。工具默认 dry-run，只接受 `/private/tmp` 下权限为 `0600` 的路由/凭据 JSON，强制 AppID、027 版本、route key、trial 运行态和单码输出，不打印 AppSecret、token 或完整路由值。
9. 2026-07-14 15:03 以 synthetic 027 路由元数据执行真实 CLI dry-run：只输出长度、指纹和输出模式，`networkCalled=false`，没有生成图片。随后完整 `npm run verify` 为 `16/16 PASS`，覆盖 230 个 JavaScript 文件。

## 2. 缺失材料与工作假设

1. 微信开发者工具 CLI 于 2026-07-14 07:42、12:01 和 12:40 三次回读均为 `login=false`；上传前需要管理员扫码登录。这是上传的硬前置，不影响本地预检。
2. v0.5.12 尚未上传，因此还没有开发版本记录、体验版小程序码、上传时间和平台包摘要。
3. 候选路由值只保存在云端受控变量中；本地文档、Git、上传源文件和命令输出均不保存明文。
4. T-013 必须从 `getQRCode` 生成的带候选参数体验版小程序码进入。普通体验版入口不携带参数时无法建立 027 归因；全新会话会落到稳定版 012，已有候选会话则可能继续保持当前进程路由，因此无论哪种情况都不能作为 027 的同版本真机证明。
5. 生成小程序码需要普通小程序 `access_token`。本轮没有调用微信接口，也没有读取 AppSecret；行动时固定使用 `stable_token` 普通模式 `force_refresh=false`，凭据、token、完整候选值和二维码不得进入 Git、命令历史或聊天记录。若返回 `40164`，立即停止并单独处理微信接口 IP 白名单，不得回退经典 token 或自动重试。
6. 体验账号需已加入体验成员；该成员状态在本轮未重新读取，扫码时按平台实际结果验证。
7. `miniprogram/` 内存在 2026-06-23 的独立旧 Git 元数据，仅有一个本地初始提交且无远端；根仓库才是当前小程序发布源的权威版本库。旧元数据未删除，已在微信上传配置中显式排除。
8. Route Module 修复、上传保护和 trial 小程序码工具仍在根仓库未提交工作树中。直接上传会失去“体验版包 -> 唯一 commit”的映射，因此本地候选提交是上传硬前置；commit、push 和 tag 仍需分别确认。

## 3. Module 决策

`cloud-route` Module 保持一个外部 Seam，并提供三项 Interface：

1. `initializeCloudRoute`：首次启动读取候选参数。
2. `refreshCloudRoute`：小程序已在后台时，从二维码回前台可更新候选参数；普通回前台保持当前会话路由；显式非法值会清空。
3. `appendCloudRoute`：所有 `wx.cloud.callContainer` 请求统一追加当前会话路由。

正式版始终清空并忽略候选参数。这样候选逻辑集中在一个 Module，调用方不需要了解路由键、格式或持久化规则；路由只存在于当前进程内，不写微信 Storage。

## 4. 本地验证

| 项目 | 结果 |
| --- | --- |
| 小程序专向检查 | `PASS` |
| Route Module 场景 | `20/20 PASS` |
| 健康同意恢复 | `3/3 PASS` |
| 参加活动 | `2/2 PASS` |
| 订阅提醒 | `7/7 PASS` |
| 上传源文件 | 157 个，510,231 bytes |
| 发布清单 SHA-256 | `abbff642386d53525ae8d5338d656bbea03f1eacbb2e259b309f912869f44097` |
| 上传保护 | 未使用 sourcemap；`.git`、开发脚本、探针页、私有配置和包元数据已显式排除 |
| 路由值扫描 | 上传集合 0 个候选值字面量 |
| Trial 小程序码工具 | 无网络契约测试 `PASS`；stable token、trial path、PNG/JPEG、脱敏和错误关闭已覆盖 |
| 完整开发验收 | `16/16 PASS`；230 个 JavaScript 文件 |

清单位于 `/private/tmp/myroot-miniprogram-v0512-nested-git-check.sha256`，属于可重建临时工件，不提交 Git。

## 5. 取得确认后的上传批次

1. 按 [v0.5.12 提交与远端追溯计划](./v0.5.12_commit_and_traceability_plan_2026-07-14.md)创建并回读本地候选提交；记录根仓库 commit，确认 `backend` 子树仍与 027 部署来源一致。未取得单独确认时停止。
2. 在该 commit 上重新运行小程序检查、发布清单和完整 `16/16` 验收；确认 Git 工作树没有未提交的 tracked/untracked 文件，忽略目录中的本地发布工件除外。
3. 微信开发者工具扫码登录。设置当前 shell `umask 077` 后，仅上传 `v0.5.12` 开发版本，不提审、不发布：

   ```bash
   /Applications/wechatwebdevtools.app/Contents/MacOS/cli upload --project /Users/rijay/Documents/Root/root_seven_day_checkin/miniprogram --version 0.5.12 --desc "myRoot v0.5.12 - 027 0% candidate trial verification" --info-output /private/tmp/myroot-v0.5.12-upload-info.json
   ```

4. 回读 CLI 退出码与脱敏后的 info-output，并在微信公众平台确认版本、上传时间与描述；随后手工将该开发版本设为体验版。上传成功不等于已设置体验版。
5. 从当前 027 发布单回读生成 `/private/tmp/myroot-api-027-route.json`，并与受控凭据 JSON 一起设为 `0600`；禁止复用历史 023/024/025/026 路由文件。先运行默认 dry-run：

   ```bash
   npm run release:qrcode:trial -- --route-file /private/tmp/myroot-api-027-route.json --expected-version myroot-api-027 --output-base /private/tmp/myroot-v0.5.12-trial
   ```

6. dry-run 只允许输出长度、路由指纹和计划路径，不得出现完整候选值。经单独确认后，在同一命令追加 `--credentials-file /private/tmp/myroot-wechat-credentials.json --confirm-generate`；工具使用 `stable_token(force_refresh=false)` 调用 `POST /wxa/getwxacode`，请求体固定为 `{"path":"pages/home/index?myroot_canary=<云端运行值>","env_version":"trial","width":430}`，只生成 1 个码。成功响应按真实 PNG/JPEG 类型写入 `0600` 临时文件，失败 JSON 不落盘。
7. 使用上述带参小程序码扫码；不能使用平台默认无参二维码替代。
8. 真机关闭调试，完成登录、隐私、健康同意、身体画像、参加活动、当日打卡、提醒授权、任务进度、商品列表和 Root 会员中心跳转。
9. 以二维码路径摘要、027 运行归因、真机截图/录屏和测试记录收口 T-013；证据脱敏后再单独确认写入 Evidence Intake。

## 6. 回滚

1. 上传失败：不覆盖当前体验版，不重试平台写入；先保留错误码并回到本地检查。
2. v0.5.12 已设为体验版但真机失败：保留开发版本，恢复此前体验版或停止分发新小程序码；027 仍为 0%，稳定版 012 不受影响。
3. 路由异常：停止分发带参小程序码；必要时撤销 027 条件路由或更换体验版，使已生成小程序码不再命中候选。小程序码本身永久有效，不能把“停止分发”误写成已失效。
4. 代码回滚：撤销 `refreshCloudRoute` 及其 `App.onShow` 接入和测试；不涉及生产数据库或 Cloud Function。

## 7. 对抗式审查

1. **后台唤起丢路由**：原 Implementation 只处理 `onLaunch`；已新增 `onShow` 刷新并通过专向测试。
2. **普通体验二维码无法归因**：已把 `getQRCode + env_version=trial + 带参 path` 设为 T-013 硬前置，并禁止默认二维码充当证据。
3. **误用第三方平台 Interface**：`getTrialQRCode` 只适用于第三方平台代商家调用；已从执行路径移除，普通小程序改用 `getQRCode` 与自身 `access_token`。
4. **路由值泄漏到包、Git 或日志**：发布清单扫描为 0；候选值只在受控终端拼装请求，正式证据仅保存长度、指纹和路由归因，不保存完整值。候选值不承担鉴权职责。
5. **正式版误入候选**：正式运行态会清空路由，专向测试覆盖该行为。
6. **把上传当成通过**：上传只产生开发版本；只有 027 归因和完整真机流程完成后，T-013 才能写为 `VERIFIED`。
7. **嵌套 Git 污染上传或追溯**：微信上传配置和本地清单均显式排除 `.git`；T-015 只认可根仓库的已推送 commit/tag，不认可无远端的旧嵌套提交。
8. **额外取 token 干扰提醒链路**：生成工具只使用与经典 token 隔离的 `stable_token`，固定 `force_refresh=false`；`40164`、凭据错误或非图片响应均首次失败关闭。
9. **从脏工作树上传**：上传前必须形成并回读本地候选 commit；平台版本、上传摘要和发布清单都绑定该 commit，不能用上传后的补提交追认。

## 8. 结论

本地体验版工件与候选路由生命周期已具备上传条件，普通小程序账号生成带参体验版小程序码的官方路径和默认 dry-run 工具也已确认。上传前仍需微信开发者工具重新扫码登录；生成小程序码还需从受控位置读取 AppSecret，并通过 `stable_token(force_refresh=false)` 在内存中取得临时凭据。CloudBase CLI 同时未登录，故 Function 对齐仍不能执行。尚未读取真实凭据、上传、生成小程序码、写 T-013、发送提醒或调整流量。
