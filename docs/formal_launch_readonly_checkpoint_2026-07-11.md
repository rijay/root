# myRoot 正式上线只读检查点

首次检查：2026-07-11 23:44 +08:00
本地候选更新：v0.5.6

状态：`BLOCKED`

本检查点只读取本地工作树、微信开发者工具登录状态、CloudBase 线上配置名称与聚合发布状态，并补充本地构建证据。未上传小程序、未部署 CloudRun 或 Cloud Function、未新增线上触发器、未修改线上环境变量、未改流量、未执行真实外部 Adapter，也未写入生产证明或签字。

## 1. 实际读取来源

1. 当前 `v0.5.6` 工作树、`docs/release_readiness.md`、CloudBase Manifest、Production Env Matrix 与最终验收脚本。
2. `npm run verify`：`11/11 PASS`，覆盖 205 个 JavaScript 文件。
3. 微信开发者工具 CLI：`login=true`；工程 AppID 为 `wx7727a02565aed1c2`，基础库 `3.15.2`。
4. CloudBase CLI `3.5.7` 对环境、CloudRun 详情、发布顺序和 Cloud Function 详情的只读回读。
5. 线上 `/health`、`/ready` 与稳定版发布记录的脱敏聚合结果。
6. 本地生产镜像 `myroot-api:0.5.6-local` 的构建与隔离容器探针。
7. `中国公司营业执照.png`，只用于核对法定名称，不复制证照编号、地址或其他字段。

## 2. 当前证据矩阵

| Gate | 当前证据 | 结论 |
|---|---|---|
| 本地代码与构建 | `v0.5.6`；全仓 `11/11 PASS`；镜像构建成功；容器 `/health.version=0.5.6`；Admin dist 已打包 | `READY_LOCAL` |
| 微信开发者工具 | CLI 已登录；AppID 与 myRoot 一致；本地候选为 `0.5.6` | `READY_TO_UPLOAD`，尚未上传 |
| CloudBase 环境 | `myroot-prod-d5gl3gzg7115f149a` 状态 `NORMAL` | `READY` |
| CloudRun 稳定版 | `myroot-api-012 / 100%`，服务状态 `normal`，最小 1、最大 2 副本 | `READY_STABLE` |
| CloudRun 候选 | 发布顺序仍保留 `myroot-api-019 / v0.5.4`，未承接线上流量 | `STALE_CANDIDATE` |
| Store | `/ready` 为 HTTP 200；MySQL connected；`003_privacy_consent.sql`；最后只读 revision 292 | `READY` |
| 运行版本归因 | 稳定版 `/health` 未返回版本字段；本地镜像可返回 `0.5.6` | 候选部署后必须复测 |
| 隐私与保存期限 | 当前代码要求 5 个变量；线上 5 个均缺失 | `BLOCKED` |
| CloudBase Job | 线上函数 Active、9 个触发器启用、`ROOT_JOB_DRY_RUN=true`；仓库 Manifest 为 11 个 | 第 10、11 个尚未部署 |
| 有赞身份补链 | 本地契约、冲突保护、脱敏和 dry-run 已通过；线上缺 User Query URL、执行开关与真实小批量证据 | `BLOCKED` |
| Root 会员中心跳转 | AppID 与短链已配置；发布记录显示 1 个活跃商品、0 条 `VERIFIED` 真机证明 | `BLOCKED` |
| 外部拉取 Adapter | 有赞订单、客户、物流、企微线索均缺真实生产校准 | `BLOCKED` |
| 外部动作 Adapter | 有赞发券、券状态、企微标签、企微联系回写均缺真实生产校准 | `BLOCKED` |
| 生产切换证明 | 4/10 就绪，6 项阻塞 | `BLOCKED` |
| 三方签字 | 产品、运营、研发 0/3 | `BLOCKED` |

## 3. 当前代码计算的生产变量矩阵

当前 `v0.5.6` 代码按最后一次线上变量名称回读，仍为 20 组中 5 组通过、8 组可选、7 组阻塞：

1. `privacy_compliance`
2. `youzan_order`
3. `youzan_customer`
4. `youzan_coupon`
5. `fulfillment`
6. `wework_contact`
7. `wework_tag`

`youzan_order` 现在同时要求应用 client id、店铺 `grant_id`、`STATIC_ROTATION`、轮换负责人和至少剩余 24 小时的 token 到期时间；`client_secret` 只保留在密码管理器或受控轮换终端，不进入 CloudRun。`youzan_customer` 要求 `YOUZAN_USER_QUERY_URL` 与 `ROOT_YOUZAN_IDENTITY_RECONCILE_ENABLED=true`。稳定版 `012` 自己生成的旧发布记录仍是旧矩阵，正式判断以当前代码矩阵和线上运行证据为准。

## 4. 隐私配置结论

- 营业执照支持法定名称候选：`杭州连生健康科技有限公司`。
- 仍需确认该名称与微信公众平台中的小程序主体完全一致。
- 本地材料没有找到可作为隐私联系渠道的有效邮箱或电话。
- 健康数据保存天数仍需业务负责人确认；代码和测试使用 `180` 天作为候选值，但未把它当作业务决策。
- 未得到联系方式与保存天数前，不配置生产隐私变量，也不启用清理 execute。

待确认的 5 个变量：

```text
ROOT_REQUIRE_HEALTH_CONSENT=true
ROOT_PRIVACY_CONTROLLER_NAME=<确认后的法定名称>
ROOT_PRIVACY_CONTACT=<有效邮箱或电话>
ROOT_HEALTH_DATA_RETENTION_DAYS=<确认后的正整数>
ROOT_HEALTH_DATA_RETENTION_CLEANUP_ENABLED=true
```

## 5. 有赞身份对账结论

- 订单 Adapter 已按 `full_order_info_list`、`paginator` 和 `page_no` 校正；客户 Adapter 已按 `record_list` 与 `yz_open_id` 校正。
- User Query 允许同一 UnionID 返回多个 `yz_open_id`，不会将多身份误判为歧义。
- 未归属订单可以按 `AUTO_YOUZAN_UNIONID` 补链；重复 Root 归属、Root 用户桥接缺失、`yz_open_id` 已有其他归属或订单已有不同归属均不会覆盖，只创建复核待办。
- 对账默认 dry-run，每轮默认 5 人并顺序执行；失败退避，成功身份默认 168 小时复核一次，避免放大平台限流并能捕获后续新增身份。
- Store 只保存 UnionID 指纹、状态和聚合计数；审计与 Job 输出不保存原始 UnionID、手机号、OpenID、token 或完整响应。
- 自用型无容器 token 约 7 天有效；当前版本采用 `STATIC_ROTATION`，要求唯一负责人集中换取并记录到期时间。生产策略缺失或 token 已过期时，六个有赞调用点会在网络请求前失败关闭。
- 外部 Adapter 的原始样本只在当前预览响应中可见；持久化评审行会脱敏个人值，有赞客户镜像仅保存原响应字段路径。
- 仍需在有赞后台确认 `grant_id`、User Query 权限、轮换负责人和真实小批量结果后，才能把身份执行开关设为 `true`。

## 6. 运行态不一致说明

稳定版发布记录中的 Store migration version 仍显示 `002_core_relational.sql`，同一运行环境的 `/ready` 动态健康检查已回读 `003_privacy_consent.sql`。这是旧稳定进程启动时缓存状态与数据库当前状态不一致，不代表数据库回退。下一候选必须同时检查 `/health.version=0.5.6`、`/ready.migrationVersion=003_privacy_consent.sql` 和发布记录 Store migration version。

## 7. 下一执行队列

| 顺序 | 动作 | 前置条件 | 当前状态 |
|---|---|---|---|
| 1 | 确认隐私主体、联系方式、保存天数 | 业务负责人答复 | `WAITING_CONFIRMATION` |
| 2 | 确认有赞 User Query 权限、token 生命周期与真实字段 | 有赞后台权限与负责人 | `BLOCKED_EXTERNAL_CONFIG` |
| 3 | 将隐私与有赞身份变量纳入 CloudRun，部署 `v0.5.6` 0% 候选 | 明确部署授权；保留现有变量与副本策略 | `NOT_STARTED` |
| 4 | 候选验证 `/health`、`/ready`、身份 dry-run、健康同意与对象清理 dry-run | 候选部署完成 | `NOT_STARTED` |
| 5 | 部署 Cloud Function 第 10、11 个触发器 | 明确函数变更授权；保持 `ROOT_JOB_DRY_RUN=true` | `NOT_STARTED` |
| 6 | 上传小程序 `v0.5.6` 开发版并设体验版 | 明确上传授权 | `READY_TO_UPLOAD` |
| 7 | 真机完成隐私授权、健康同意/撤回、图片上传删除与 Root 会员中心跳转 | 体验版与测试人员 | `NOT_STARTED` |
| 8 | 完成有赞、企微、物流、奖励真实小批量校准 | 平台凭据、Interface URL 与负责人 | `BLOCKED_EXTERNAL_CONFIG` |
| 9 | 完成灰度回滚证据、生产切换证明和三方签字 | 前述 Gate 全部通过 | `NOT_STARTED` |

## 8. 本地镜像证据

- 正确构建命令：`docker build -t myroot-api:0.5.6-local backend`。
- 镜像：`myroot-api:0.5.6-local`。
- 镜像 ID：`sha256:9e9595e676d36b469011a66726f49c67bdadbfb36ce99e2d2a368ad2ad8613e9`。
- 大小：70,068,868 bytes，约 70.1 MB。
- `/health`：HTTP 200，version 与 release ID 均为 `0.5.6`。
- `/ready`：HTTP 200，使用内存 Store，仅证明镜像启动；生产 MySQL 继续以上线候选 `/ready` 为准。
- `/admin`：HTTP 200，镜像包含 Element Plus Admin 资源。
- 身份 Job：无 token 返回 401；带一次性本地 Job token 时 dry-run 返回 200，并只列配置缺口和聚合计数。
- 验证后容器已停止；镜像只保留在本机 Docker 缓存。
