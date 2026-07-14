# myRoot v0.5.13 发布说明

日期：2026-07-14

状态：`LOCAL_COMMITS_CREATED / VERIFY_PASS / NOT_PUSHED / NOT_TAGGED / NOT_DEPLOYED`

## 1. 本版目标

生产仍保持 `myroot-api-027 / v0.5.12 / URL_PARAMS / 0%`，默认流量仍由 012 承接。v0.5.13 只把微信 `access_token` 获取收敛到稳定版 POST 契约，并同步固化有赞后台回读与正式上线 Gate；不改变用户流程、数据库结构、线上流量或外部 Adapter 执行状态。

下一生产候选计划为 `myroot-api-028 / v0.5.13 / 0%`。028 尚未创建，不能把 027 的运行证明或体验版证明复用到 v0.5.13。

## 2. Module 与 Interface 变化

1. 新增 `wechatAccessToken` Module，对调用方只提供 `resolveWechatAccessToken(config, options)` 与测试清理 Interface。
2. Implementation 使用 `POST https://api.weixin.qq.com/cgi-bin/stable_token`，凭据放在 JSON 请求体，不再进入 URL 查询参数。
3. 手机号获取与订阅消息发送复用同一 Interface；调用方不再分别学习 token 缓存、并发合并、刷新窗口和密钥轮换规则。
4. 进程内缓存提前 5 分钟刷新；相同凭据的并发请求合并为一次；缓存键由 AppID 与 AppSecret 的哈希生成，AppSecret 轮换后不会复用旧缓存。
5. 缺少凭据或成功响应缺少 `access_token` 时失败关闭，错误信息不回显 AppSecret。
6. 本版不写 Store 中的历史 token 缓存，不新增迁移，也不改变 CloudBase OpenAPI 路径。
7. trial 小程序码发布工具对凭据、路由和输出父目录使用真实路径校验，拒绝 `/private/tmp` 内父目录符号链接逃逸；通用敏感串脱敏阈值从 40 字符收紧到 24 字符。

该 Module 将微信 token 复杂度集中在一个 Seam，手机号与订阅消息两个调用点都获得相同 Leverage；缓存、轮换和错误处理的修改保持 Locality。

## 3. 本地验证

1. `npm run verify`：`16/16 PASS`。
2. JavaScript 语法检查：232 个文件通过。
3. 根项目、后端、Admin、小程序和 Job Dispatcher 版本统一为 `0.5.13`。
4. 后端、生产依赖审计、Admin 检查与构建、小程序发布清单、11 Job 拓扑、5 个迁移校验和及 HTTP Interface smoke 全部通过。
5. stable token 专向测试覆盖：POST 契约、URL 无凭据、并发合并、新鲜 token 复用、AppSecret 轮换隔离、缺凭据与畸形响应失败关闭。
6. trial 小程序码契约测试新增输入和输出父目录逃逸拒绝、JSON secret 脱敏及无键名长敏感串脱敏。
7. `git diff --check` 通过，部署源与测试范围不存在 `0.5.12` 版本残留。

## 4. 当前生产影响

1. 没有创建 028，没有部署后端或 Cloud Function，没有上传体验版。
2. 没有换取真实微信或有赞 token，没有发送提醒，没有执行外部 Adapter。
3. 没有修改 MySQL、对象存储、触发器、环境变量、流量、生产证明或签字。
4. 两个 Cloud Function 仍是线上 v0.5.10 代码包并保持全局 dry-run；必须在后续单独确认后对齐到 v0.5.13。
5. 运行候选已提交为 `c3d14f2`，本发布说明由随后文档提交收录；尚未 push 或 tag，远端工件不可获取，因此 T-015 继续阻塞。

## 5. 后续停止规则

1. 先恢复 CloudBase CLI 和微信开发者工具 CLI 身份，再执行任何平台动作。
2. 创建 028、更新两个 Cloud Function、上传体验版、真实提醒、外部 IMPORT、5% 灰度和正式切流分别确认。
3. 028 必须配置唯一 `ROOT_RELEASE_ID`，并重新完成 T-012；027 的发布级证明不得迁移。
4. 同源 v0.5.13 体验版通过真机核心流程后，才能取得新的独立用户一次性订阅额度。
5. 任一真实提醒结果为 `UNKNOWN` 时立即停止，不重试、不复用额度。
6. 受控 canary 文件的实际 dry-run 为 `networkCalled=false`，但现有文件元数据属于历史 023；028 部署后必须生成新的 0600 路由元数据文件，不能用旧 `versionName` 关闭 T-013。

当前完整结论见 [v0.5.13 正式上线 Gate](./formal_launch_gate_v0.5.13_2026-07-14.md)。
