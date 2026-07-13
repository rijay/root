# myRoot v0.5.7 发布说明

状态：已部署为 `myroot-api-024 / URL_PARAMS / 0%` 条件候选；尚未上传小程序、进入百分比灰度或正式切流

## 1. 本版目标

关闭 `v0.5.6 / myroot-api-023` 正式 Gate 审计中新发现的有赞奖励 Adapter 契约与外部响应持久化风险，并以 `v0.5.7 / myroot-api-024` 条件候选替换 023。

## 2. 代码变更

1. 新增有赞官方 URL 识别 Module；自定义 Adapter URL 的既有请求行为保持不变。
2. `youzan.ump.voucheractivity.send` 固定使用 `POST`，只发送奖励快照中的 `activity_id` 和当前奖励用户唯一补链的 `yz_open_id`，核销码由有赞生成；不再把 myRoot 内部奖励、用户、活动、任务或请求 ID 传给有赞，也不允许批量请求体覆盖活动。
3. 接收人不读取活动级奖励 `payload` 或批量请求体中的手机号/`yz_open_id`；必须按奖励 `root_user_id` 在有赞客户镜像中唯一命中。未补链或命中多个身份时在外部请求前失败关闭。
4. `youzan.ump.voucher.query.detail` 固定使用 `POST`，只发送 `coupon_id` 和 `coupon_type`；优惠券默认 `coupon_type=0`，优惠码必须显式配置为 `1`。
5. 官方发券结果只接受正整数 `voucher_identity.coupon_id` 或 `coupon_id` 作为后续状态查询主键；优惠码、`verify_code`、`code_value` 和自定义字段映射不能替代券 ID。
6. 有赞已返回业务成功但缺少有效 `coupon_id` 时，发放任务按完成处理以阻止自动重复发券，同时生成 `YOUZAN_COUPON_DELIVERY_REVIEW_REQUIRED` 高优先级运营待办；官方券状态响应的 `coupon_id` 与请求不一致时失败关闭。
7. 奖励发放与状态查询的外部响应在写入任务、奖励记录和审计前统一脱敏；供应商自由文本消息改为内部稳定文案与外部错误码。手机号、`yz_open_id`、OpenID、UnionID、token 和完整外部原文不进入 Store。

## 3. 验证

1. 有赞生产契约测试覆盖官方发券字段白名单、活动 ID 和券 ID 正整数约束、缺接收人失败关闭、缺券 ID 单次副作用与人工复核、券状态 `POST` 请求、响应 ID 一致性和数字状态映射。
2. 隐私回归覆盖发券及状态响应中的手机号和 `yz_open_id` 不进入任务记录、奖励状态或审计。
3. 版本统一提升为 `0.5.7`；完整 `npm run verify` 为 `15/15 PASS`，覆盖 216 个 JavaScript 文件、版本对齐、全量后端测试、生产依赖审计、Admin 构建、小程序清单和 HTTP Interface smoke。
4. 小程序发布源为 155 文件、496,769 bytes，清单 SHA-256 `38a2553de2f784f3f984fd759186277022e549d7a45238ae2c2e9aa595f01eeb`。
5. 后端本地候选 ZIP 为 181 个条目、1,048,548 bytes，SHA-256 `abde4fd1d30a7543a2c10e9c6fbdf41b7b582cf29e69e3ae7c9ab69d5cf2bb62`；不含 `node_modules`、数据文件、SQLite 或日志。候选准备脚本确认解压后为 172 个文件，源码内容清单 SHA-256 `f436464ab91485f0ddb6bcadd488e95191fda4b5509b88c2724d1d9fcfe69b61`。
6. 本地镜像 `myroot-api:0.5.7-local` 为 70,076,395 bytes，digest `sha256:718b96a88a375786d667e4afc80705730414c3348bd82040f5d289338f8682b7`。隔离容器 `/health`、`/ready`、`/admin` 和公开隐私说明均为 HTTP 200，版本均为 `0.5.7`；隐私说明回读处理者名称、公开邮箱和 180 天保存期限，容器已停止。
7. 候选 ZIP 全部 181 个条目完成凭据模式扫描，唯一 Bearer 形态命中是对象存储测试里的合成哨兵；未发现私钥、腾讯云 AKID、数据库连接串或 JWT 字面量。
8. 生产 024 定向 `/health`、`/ready`、公开隐私说明和对象存储精确写删均通过；路由配置前后各 15 次无参数请求均未命中 0.5.7。

## 4. 未执行

1. 未配置有赞凭据、活动 ID、店铺 ID 或 token。
2. 未执行真实发券、券状态查询、企微写入、体验版上传、5% 灰度或正式发布。
3. `myroot-api-012` 继续承接默认流量，`myroot-api-024 / v0.5.7` 仅保持 0% URL 参数条件候选。
4. 两个 Cloud Function 仍为 0.5.6 部署包；11/11 dry-run 已命中 024 后端并通过，但函数包版本对齐尚未执行。
