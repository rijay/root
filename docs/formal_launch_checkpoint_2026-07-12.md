# myRoot 正式上线检查点

> 历史快照：本文保存截至 2026-07-13 的 023 至 026 行动证据，不再作为当前候选入口。当前权威状态以 [v0.5.12 正式上线 Gate](./formal_launch_gate_v0.5.12_2026-07-13.md) 和 [候选 027 证据](./production_gray_release_027_2026-07-13.md) 为准。

检查时间：2026-07-12 19:39 +08:00
最近更新：2026-07-13 20:29 +08:00
当前生产候选：`v0.5.11 / myroot-api-026 / URL_PARAMS / 0%`；本地下一候选为 `v0.5.12 / NOT_DEPLOYED`；本文前半部分保留 `v0.5.6 / 023`、`v0.5.7 / 024` 与 `v0.5.10 / 025` 历史证据
状态：`BLOCKED`

截至 2026-07-13，本轮已完成本地代码、构建、生产审计和已授权的上线准备动作：创建 schema-scoped 候选数据库账号，应用迁移 005，保留 025 的对象存储与提醒失败证据，并部署 `myroot-api-026 / v0.5.11` 0% 定向候选。026 的运行、MySQL、最小权限、隐私、Admin 和默认流量保护 Gate 已通过；两个 Cloud Function 仍锁定 dry-run 并匹配 026 路由，本轮没有更新或调用。无参数流量仍默认进入稳定版 `myroot-api-012`；公众平台当前体验版仍为既有 `v0.5.10`。025 的新授权单用户真实提醒仅执行一次，返回 `FAILED / 1006 / external HTTP 412 / UNKNOWN` 且未重试；026 未上传体验版、未执行微信业务 POST 或提醒发送，也没有执行其他外部 Adapter、正式签字、5% 灰度或全量切流。

## 1. 实际读取来源

1. 当前工作树、发布文档、CloudBase Manifest、Production Env Matrix、测试和最终验收脚本。
2. `npm run verify`、`git diff --check`、本地 Docker 构建与隔离容器探针。
3. CloudBase CLI `3.5.7` 的环境、CloudRun 服务详情、发布顺序和 Cloud Function 详情只读结果。
4. 生产 `/health`、`/ready`、`SHOW GRANTS FOR 'myroot_app'@'%'` 与后台发布记录、样本评审、客户镜像的脱敏聚合只读结果。
5. 小程序隐私代码、法律页、人工协助入口与微信平台能力调用点。
6. Root 项目本地营业执照 PNG 原件；只记录法定名称，不摘录统一社会信用代码、地址或其他非必要字段。

## 2. 当前证据矩阵

| Gate | 当前证据 | 结论 |
| --- | --- | --- |
| 本地候选 | 根项目、后端、小程序、Admin、Cloud Function 均为 `0.5.6`；本地候选提交未 push | `READY_LOCAL` |
| 自动验收范围 | 213 个 JavaScript 文件、228 个后端测试、不可变迁移校验和、版本一致性、11 个 Job、双函数触发器容量拓扑、依赖审计、Admin、小程序发布源清单和 HTTP Interface smoke；`15/15 PASS` | `PASS` |
| MySQL 权限隔离实测 | schema-scoped 账号应用 4 个迁移、创建 25 张表并通过健康检查；全局六项权限账号被启动 Gate 拒绝 | `PASS_LOCAL` |
| 本地镜像 | `sha256:b43e557303b5fec313fe30564ffc89e90e983d66424e1ad8087b529185184c6a`；70,073,407 bytes；Admin manifest `0.5.6 / 6 Modules` | `READY_LOCAL` |
| CloudRun 候选 ZIP | 180 个条目、1,048,175 bytes；SHA-256 `055e904bff74288589bbdafbfc6c98dbccc5bf309d25f3cf6a5905a318d2a156`；无 `node_modules`、`.git`、日志、SQLite 或数据文件 | `DEPLOYED_023` |
| Cloud Function 工件 | 2 文件、2,963 bytes、11 Jobs；SHA-256 `bf016c169cb0f3b0dd1e56c8e19ff895f5457b4d234abb3296aabc8f6ee2d3ec` | `READY_LOCAL` |
| 小程序源清单 | 155 文件、496,769 bytes；显式排除开发诊断页、验证文件和私有配置，按开发者工具默认规则排除 `.git`、`.svn`、`node_modules` 和 `.DS_Store`；清单 SHA-256 `3da8acc98202d0fa9ac8d4effee5be8af1e0f118589c5d9908032136dd29fbfb` | `READY_LOCAL` |
| 隔离容器 | `/health.version=0.5.6`、`/ready.version=0.5.6`、`/admin=200`；镜像包含迁移 `004`；容器已停止 | `PASS_LOCAL` |
| CloudBase 环境 | `myroot-prod-d5gl3gzg7115f149a` 为 `NORMAL` | `READY` |
| 法定主体名称 | 营业执照原件确认名称为 `杭州连生健康科技有限公司`；负责人确认微信公众平台主体一致 | `PASS_CONFIRMED` |
| 生产稳定版 | `myroot-api-012` 仍是无参数默认版本并保持 100%；023 仅为 0% 条件路由；023 流程中 15 次无参数探针未命中候选 | `READY_STABLE` |
| 生产 0% 候选 | `myroot-api-023 / v0.5.6` 状态 `normal`；URL 参数定向；VPC 已继承；`/health`、`/ready`、隐私说明均通过 | `PASS_CANDIDATE` |
| 旧候选 | `myroot-api-019 / v0.5.4` 已执行灰度回滚，稳定版 `012` 未变 | `ROLLED_BACK` |
| 生产 Store | 023 候选 `/ready` 为 MySQL connected、`004_external_evidence_minimization.sql`；稳定 `/ready` 同样可读迁移 004 | `PASS_CANDIDATE` |
| 数据库自动备份 | 自动增量快照 `9704265`，快照时间 02:45，状态 `success / usable` | `READY_ROLLBACK_BASE` |
| 约 20 并发容量 | MySQL `running / resume`、0.25 至 1 CCU、2 GB、`max_connections=1000`；只读水位为连接 4、运行 1、历史峰值 17。应用每实例连接池 8、最多 2 实例；既有双实例 20 人 40 次业务写 40/40 成功，647ms 完成。2026-07-11 00:00 至 2026-07-12 10:34 未检出超过 1 秒的慢查询 | `PASS_EXPECTED_LOAD` |
| MySQL 稳定账号 | `myroot_app@'%'` 仍具全局六项权限，只保留给 012 回滚；未修改或删除 | `ROLLBACK_ONLY` |
| MySQL 候选账号 | `myroot_app_v2@'%'` 已由 022/023 实际使用；目标 schema 六项必要权限、全局 `USAGE`、无额外 schema 与 `GRANT OPTION`；运行 Gate 通过 | `PASS_CANDIDATE` |
| 数据迁移 | `004_external_evidence_minimization.sql` 已由候选成功应用并登记 | `PASS` |
| CloudBase 对象存储 | 023 完成单对象上传、按精确 `cloudObjectId` 删除与审计验证；探针目录随后回读 `total=0` | `PASS_CANDIDATE` |
| CloudBase Job | `myroot-job-dispatcher` 10 个、`myroot-health-retention` 1 个；均 `Active / Available`、6 个变量、全局 dry-run，11/11 候选调用通过 | `PASS_DRY_RUN` |
| Production Env Matrix | 隐私、次日提醒与 CloudBase HTTP 对象存储候选变量已补齐；有赞、物流、企微等真实外部 Adapter 组仍阻塞 | `PARTIAL_BLOCKED` |
| 发布记录 | 40 项 must-fix、17 项灰度确认、14 项最终检查 | `BLOCKED` |
| 生产切换证明 | 4/10 就绪 | `BLOCKED` |
| Root 会员中心跳转 | appId、路径、商品就绪；生产真机证明 0 条 | `BLOCKED` |
| 三方签字 | 产品、运营、研发 0/3 | `BLOCKED` |
| 发布追溯 | 023 候选来源为本地提交 `44b4d3a`，分支未 push；文档证据提交完成后需重新回读 ahead 数和工作树 | `LOCAL_CANDIDATE_NO_PUSH` |
| 候选凭据扫描 | 展开目录后扫描 311 个变更文件；309 个文本文件和 2 个二进制工件均无私钥或云密钥命中，唯一运行凭据模式命中是已确认的有赞 `must-not-leak` 测试哨兵 | `PASS_LOCAL` |

## 3. 本轮安全收口

1. 有赞 `client_secret` 只用于受控终端换取 token，不再要求进入 CloudRun 运行容器。
2. 运行容器仍强制校验 client id、grant id、access token、到期时间、`STATIC_ROTATION` 和唯一轮换负责人。
3. 外部 Adapter 原始样本只在当前授权预览响应中可见；持久化评审行会脱敏手机号、UnionID、地址、昵称、订单号、运单号和企微标识。
4. 有赞客户镜像的 `raw_payload` 只保存字段路径，不保存完整响应值。
5. 新迁移已由 022 启动成功应用；迁移登记版本为 `004_external_evidence_minimization.sql`。发布证据只记录聚合与迁移版本，不复制旧样本原文。
6. 灰度验证脚本默认要求 Store 为 MySQL 且迁移版本命中仓库最新迁移；仍为 `003` 时会退出码 `3` 阻止灰度。
7. 生产 MySQL 启动新增最小权限检查；只有目标 schema 上的六项必要权限可以通过，`*.*`、额外 schema 权限和 `GRANT OPTION` 均失败关闭。
8. 隔离 MySQL 8 已用真实授权语句验证该检查：库级账号成功迁移到 `004`，全局账号在迁移前被拒绝；测试数据库与容器已删除。
9. 新增公开隐私说明 Interface，并让本地法律页回读同一处理者、联系方式和保存期限；登录前、微信平台协议失败和敏感信息单独同意三条路径不再使用不同口径。
10. 当前变更文件已做私钥和 secret 文字模式扫描；唯一命中为测试夹具 `do-not-print`，运行代码、配置与文档未发现真实凭据形态。正式提交前仍需对最终 staged diff 再扫一次。
11. MySQL `/ready` 现在只公开安全的最小权限证明字段；隔离实测返回 `leastPrivilegeReady=true`、`privilegeScope=SCHEMA`、`privilegePolicyEnforced=true`。生产灰度验证会把缺失、全局作用域或未强制执行视为 Store Gate 失败。
12. 公开隐私说明携带候选版本元数据并进入灰度必过项；缺处理者、无效联系方式、非正整数保存天数、缺政策版本或未命中候选版本时，验证脚本返回独立退出码 `5`。
13. 五套可部署工件版本统一为 `0.5.6`，最终验收新增版本一致性 Gate；Cloud Function 运行结果和 Admin 构建 manifest 均携带发布版本，云函数目录也纳入 JavaScript 语法检查。
14. 后端候选包已按 SHA-256 对照部署为 023；Cloud Function 代码已部署，小程序源清单仍只代表待上传工件。
15. 小程序上传配置新增 6 条显式排除规则，并由最终验收检查运行入口存在、开发文件缺席、未使用文件过滤开启、源码映射关闭。开发身份诊断页已从 `app.json` 和发布源清单移除，避免登录响应进入页面、控制台或剪贴板；旧源清单误计内嵌 `.git` 对象，已用可复现脚本更正并作废旧摘要。
16. 小程序运行日志只保留脱敏错误摘要，JSON 字段、查询参数和无标签微信标识均已覆盖；传输失败向用户返回稳定安全提示。订阅授权不再把微信原始结果传给后端，生产表当前为 0 行。打卡结果和海报载荷改为进程内一次性健康状态，消费后销毁，并在启动时清除旧版本持久化缓存。
17. 开发者工具已在本地重新编译候选文件；首页于 10:13:46 完成 `onRouteDone`，未发现用户代码编译错误。发布校验同时验证 Root 会员中心短链使用 `navigateToMiniProgram(shortLink)`，不会混传 `appId/path`。本轮没有执行预览或上传。

## 4. 当前 6 个外部集成阻塞组

隐私、次日打卡提醒与 CloudBase 对象存储已在 023 候选关闭配置阻断；以下真实外部集成仍未完成小批量校准：

1. `youzan_order`：缺 client id、grant id、token、到期时间、轮换负责人和订单 Interface URL。
2. `youzan_customer`：缺客户列表 URL、User Query URL、token 和身份对账开关。
3. `youzan_coupon`：缺发券与券状态 Interface URL、token 和真实回执。
4. `fulfillment`：缺物流来源 URL、凭据和真实字段。
5. `wework_contact`：缺企业 ID、客户联系 Interface、凭据和真实外部联系人样本。
6. `wework_tag`：缺标签 Interface、凭据、标签 ID 和真实回执。

## 5. 必须由负责人确认的非秘密输入

1. 有赞 ROOT 店铺 grant id、User Query 权限是否已开通、token 轮换负责人及到期时间。
2. 产品、运营、研发签字人；外部告警、退款、奖励和回滚值班负责人。

已确认：微信公众平台主体与营业执照名称一致；个人信息处理者为 `杭州连生健康科技有限公司`；公开联系方式为 `hydennis@foxmail.com`；原始健康敏感信息保存期限为 180 天。

秘密值不得粘贴到聊天、仓库或发布文档；应在受控控制台或密码管理器中配置。

## 6. 需要单独确认的生产变更

1. 已创建并由 022/023 使用 schema-scoped `myroot_app_v2`；旧 `myroot_app@'%'` 保持不变作为 012 回滚账号。
2. 已补齐候选变量并部署 023 为 `v0.5.6` 0% 定向候选；迁移 004、VPC 和 MySQL 最小权限均已回读。
3. `/health`、`/ready`、隐私配置、CloudBase 对象存储上传/精确删除和 11 个 Job dry-run 已通过；对象探针目录回读无残留。
4. 两个 Cloud Function 已按 10+1 拆分并保持全局 `ROOT_JOB_DRY_RUN=true`；真实 Adapter 校准前不得开启 execute。
5. 上传 `v0.5.6` 体验版，完成真机隐私、登录、媒体上传删除、任务、结算和 Root 会员中心跳转。
6. 用脱敏小批量完成有赞、物流和企微校准，再逐项授权 execute。
7. 完成 5% 灰度、回滚演练、证据包留档、三方签字和 100% 切流。

## 7. 当前结论

`myroot-api-023 / v0.5.6` 已达到可继续验证的 0% 候选状态：VPC、MySQL 最小权限、迁移 004、隐私说明、CloudBase 对象存储写删和 11/11 Job dry-run 均通过，无参数业务流量仍默认进入 012。下一步是上传体验版完成真机流程；在真实 Adapter 回执、5% 灰度、完整回滚、发布追溯和三方签字全部关闭前，正式发布状态保持 `BLOCKED`。

## 8. 最新生产只读复核

2026-07-12 08:37 再次回读确认：CloudRun `myroot-api` 状态为 `normal`，稳定版 `myroot-api-012` 保持 100% 流量、旧候选 `myroot-api-019` 保持 0%，两版均为 31 个变量名且未读取或输出变量值。公网 `/health` 与 `/ready` 均为 HTTP 200；稳定版仍未返回版本字段，迁移仍为 `003_privacy_consent.sql`，revision 已随生产记录推进到 `545`，公开隐私说明 Interface 仍为 HTTP 404。每日自动增量快照 `9704265` 已成功且可用。`myroot_app@'%'` 仍是六项权限作用于 `*.*`，`myroot_app_v2@'%'` 尚不存在。Cloud Function `myroot-job-dispatcher` 为 `Active`，9/9 触发器启用，尚未包含健康数据清理和有赞身份对账两个仓库目标触发器。按产品必需流程校正 Gate 后，Production Env Matrix 为 6 组通过、6 组可选、8 组阻塞；Root 会员中心配置通过，次日打卡提醒因 3 个生产变量缺失而阻塞。本次复核未修改环境变量、账号、函数、流量或业务数据。

2026-07-12 09:09 用户明确授权为 `myroot_app` 增加 `DELETE`。随后通过 CloudBase CLI 对生产环境执行只读 `SHOW GRANTS FOR 'myroot_app'@'%'`，回读结果仍为 `SELECT / INSERT / UPDATE / DELETE / CREATE / ALTER ON *.*`。由于 `DELETE` 已存在，本次没有重复执行 `GRANT`，未产生数据库权限写入；后续最小权限收敛仍按新建 schema-scoped 候选账号、验证、切换、再停用旧账号的独立变更流程处理。

2026-07-12 10:34 补充只读证据：本地营业执照 PNG 原件确认法定名称为 `杭州连生健康科技有限公司`，未摘录统一社会信用代码、地址等非必要字段；微信公众平台主体一致性仍待页面证明。CloudBase MySQL 配置与实时 SQL 均确认实例为 `running / resume`，0.25 至 1 CCU、2 GB、`max_connections=1000`，连接 4、运行 1、历史峰值 17；2026-07-11 00:00 至 2026-07-12 10:34 未检出超过 1 秒的慢查询。远端 `main`、本地 `HEAD` 与 `origin/main` 仍同为 `25be202`，没有远端漂移。本次没有创建账号、修改变量、部署候选、上传小程序、执行 Adapter 或改变流量。

2026-07-12 12:28 经负责人行动时确认后，已在 CloudBase 控制台创建 `myroot_app_v2@'%'`，凭据只保存到 macOS 钥匙串并输入控制台专用密码框，未写入命令参数、仓库或证据。控制台初始账号只能选择全局权限，因此先以临时 `SELECT ON *.*` 创建，随后立即撤销；最终只读 `SHOW GRANTS` 为全局 `USAGE`，以及 `myroot-prod-d5gl3gzg7115f149a` schema 上的 `SELECT / INSERT / UPDATE / DELETE / CREATE / ALTER`。没有 `GRANT OPTION`、额外 schema 或全局数据权限；旧 `myroot_app` 未修改，CloudRun 流量仍未改变。

2026-07-12 12:42 发现 CloudBase 单个云函数最多 10 个触发器，原单函数 11 触发器清单无法直接部署。已恢复主函数原 9 个触发器并新增 `youzan_identity_reconcile`，另复制同一 `0.5.6` 代码与 5 项环境变量创建 `myroot-health-retention`，只承载 `health_data_retention_cleanup`；云端最终为 10+1，两个函数均 `Active` 且 `ROOT_JOB_DRY_RUN=true`。仓库配置同步拆分，并新增触发器容量 Gate，完整验收为 `14/14 PASS`。两个新 Job 手工调用均进入新函数代码，但稳定版 `012` 尚无对应 HTTP Interface，返回 404；该结果记录为候选路由阻断，不记作 dry-run 通过。

2026-07-12 12:57 已执行旧灰度任务回滚，`myroot-api-019` 不再占用候选发布通道；稳定版 `myroot-api-012` 和线上流量未改变。一次被平台拒绝的候选请求曾把 CloudRun 基础配置暂存为 46 项变量，其中候选密码为空；发现后已立即从稳定版 `012` 的版本快照恢复为 31 项，回读确认 MySQL Store、非空稳定密码、`OA/PUBLIC/MINIAPP` 开放方式、1 至 2 实例均保持原值，公网 `/health`、`/ready` 均为 HTTP 200。最终 `v0.5.6` 候选 ZIP 已从通过 `14/14` 的最新 Admin 工件重新封装为 181 个条目、1,051,456 bytes，SHA-256 为 `640f1352817c70224953d748d84d8cd0ab6639e08a3969e40548bfab594aeca8`。候选账号密码已轮换并写入 macOS 钥匙串，但当前锁屏阻止安全回读；在负责人手动解锁前不提交 0% 候选。

2026-07-12 17:37 生产执行复核：macOS 钥匙串安全回读通过且未输出口令。`020/021` 均完成镜像构建但因候选版本缺失 VPC，在监听 80 端口前无法访问生产 MySQL，探针返回 `connection refused`；两版均为 `deploy_failed / 0%`。修复部署请求、显式继承稳定版 `VpcConf` 后，`myroot-api-022` 部署为 `normal`，46 个变量齐全并实际使用 `myroot_app_v2`。022 定向 `/health`、`/ready`、公开隐私说明一次通过，MySQL 迁移为 004、最小权限为 schema 级、保存期限为 180 天；无参数 `/health` 连续 20 次均未命中 0.5.6。Cloud Function 增加候选路由变量后保持 10+1 拓扑与全局 dry-run，11/11 Job 全部返回 `releaseVersion=0.5.6`、HTTP 200、业务码 0。完整证据见 [候选 022 证据](./production_gray_release_022_2026-07-12.md)。

## 9. 19:39 对象存储与候选 023 收口

1. 022 对象存储探针返回 HTTP 502，未取得上传确认；直接列举探针目录为 0 个对象。控制台随后执行“取消灰度”，明确保留 012 为 100%，接口回读 022 为 `0% / HasTraffic=false`。
2. 后端对象存储改为 CloudBase 服务端 HTTP Interface，新增上传授权、精确 PUT、按返回对象 ID 删除、对象不存在幂等清理与含糊上传补偿删除；目标测试 8/8、完整验收 15/15 通过。
3. 服务端 API Key 以 180 天有效期创建并保存到 macOS 钥匙串，未输出或写入仓库。023 候选包为 180 个条目、1,048,175 bytes，SHA-256 `055e904bff74288589bbdafbfc6c98dbccc5bf309d25f3cf6a5905a318d2a156`。
4. `myroot-api-023` 部署为 `normal`，显式继承 VPC，使用 48 个候选变量和 `myroot_app_v2`；发布模式为 `URL_PARAMS / 0%`。定向 `/health`、`/ready` 返回 `0.5.6`、MySQL connected、迁移 004。
5. 023 对象探针返回 HTTP 200、业务码 0、`VERIFIED`，上传与精确删除均确认，残留可能性为 false，审计匹配；随后再次列举探针目录仍为 0 个对象。
6. 配置 023 前、配置后和对象探针后三组各 5 次无参数 `/health` 均未观察到 0.5.6。两个 Cloud Function 的路由已更新为 023，仍为 10+1 触发器、全局 dry-run，11/11 Job 再次通过。
7. 当前未上传体验版，未执行真实外部 Adapter、真实订阅发送、健康数据 execute、5% 灰度或 100% 切流。完整证据见 [候选 023 证据](./production_gray_release_023_2026-07-12.md)。

## 10. 2026-07-13 正式发布 Gate 实时复核

### 10.1 实际读取来源与修改范围

1. 只读回读 CloudBase 环境列表、CloudRun 发布顺序、部署记录和 `myroot-api-023` 版本详情；未读取或输出任何环境变量值。
2. 定向调用 023 的 `/health`、`/ready`、后台发布记录、严格证据包、生产切换证明、Root 会员中心跳转证明、旧数据处置记录和旧 Admin 下线记录 Interface。
3. 重新调用 10+1 Cloud Function 的 11 个 Job，全部保持 `dryRun=true`。
4. 本地重新执行完整 `npm run verify`，结果为 `15/15 PASS`；小程序上传前清单仍为 155 文件、496,769 bytes，SHA-256 `3da8acc98202d0fa9ac8d4effee5be8af1e0f118589c5d9908032136dd29fbfb`。
5. 本节只更新发布检查点文档；没有创建第二把 API Key，没有修改 CloudBase 变量、函数、数据库、业务数据、候选版本或流量，也没有上传小程序。

### 10.2 缺失材料与工作假设

1. 尚缺有赞 ROOT 店铺的运行凭据、grant id、token 到期时间与轮换负责人；在受控配置完成前不执行真实有赞 Adapter。
2. 尚缺物流来源 Interface 与凭据；若首发不承接物流同步，需由产品明确降级范围并同步调整正式发布 Gate，不能仅通过填充占位变量放行。
3. 尚缺企业微信企业 ID、客户联系凭据、标签 ID 与真实外部联系人小样本；在最小权限凭据和脱敏样本齐全前不执行写标签或联系回写。
4. 尚缺体验版真机结果、Root 会员中心跳转证明、运营告警负责人和产品/运营/研发签字；这些均不能用自动化结果替代。
5. 工作假设：稳定版 012 继续承接默认流量，023 只用于定向验证；在 5% 灰度行动时确认前不改变该状态。

### 10.3 实时结果

| Gate | 2026-07-13 回读 | 结论 |
| --- | --- | --- |
| CloudBase 环境 | `myroot-prod-d5gl3gzg7115f149a / NORMAL` | `READY` |
| 发布路由 | 012 为默认稳定版；023 为 `URL_PARAMS / 0%`，仅 `myroot_canary` 定向命中 | `SAFE_CANDIDATE` |
| 023 版本 | `normal`、48 个变量名、VPC 已配置、1 至 2 实例 | `READY_CANDIDATE` |
| 023 健康 | `/health=200 / version=0.5.6`；`/ready=200 / mysql / migration 004` | `PASS` |
| Cloud Function | 11/11 返回 HTTP 200、业务码 0、`releaseVersion=0.5.6`、`dryRun=true` | `PASS_DRY_RUN` |
| Production Env Matrix | 21 组中 9 组通过、6 组阻塞、6 组可选；缺失项 22 个 | `BLOCKED` |
| 发布记录 | `40 must-fix / 17 gray confirmations` | `BLOCKED` |
| 严格证据包 | `67 blockers / 17 warnings` | `BLOCKED` |
| 生产切换证明 | 微信开放平台、CloudBase UnionID、Root 会员中心 AppID、CloudBase Job 共 4/10 就绪 | `BLOCKED_6` |
| Root 会员中心跳转 | AppID、短链和商品配置存在，体验版实测证明 0 条 | `BLOCKED` |
| CloudBase Store | MySQL、环境、备份与回滚信息 5/5 | `READY` |
| 旧 7 日数据 | 生产数据仓库中旧会话与旧事实均为 0，不要求处置执行 | `READY` |
| Admin 迁移 | 6/6 Module 就绪，`/admin-legacy` 回退可用；旧后台未批准下线 | `NEEDS_REVIEW_SAFE` |
| 三方签字 | 产品、运营、研发 0/3 | `BLOCKED` |

### 10.4 API Key 决策

1. CloudBase HTTP Interface 的服务端 API Key 已于 2026-07-12 以 180 天有效期创建，值只保存在 macOS 钥匙串和 023 受控运行变量中。
2. 该 Key 已通过对象上传、精确 `cloudObjectId` 删除、审计匹配与目录 `total=0` 回读，`CLOUDBASE_APIKEY` 也在 023 变量名清单中。
3. 2026-07-13 收到再次创建确认后，按最小凭据面原则未创建重复 Key。后续只在轮换、吊销或权限收窄时创建替代 Key，并采用先验证新 Key、再撤销旧 Key 的顺序。

### 10.5 后续执行顺序

1. 当前 023 发布单为 `IsReleasing=true`，CLI 无法保证在保留该活动灰度的同时创建 024。经行动时确认创建 `v0.5.7` 本地候选提交、留存 023 最终证据并结束 023 的 0% 条件灰度；立即回读 012 仍承接默认流量。
2. 从已校验候选 ZIP 解压出的干净目录部署 024，发布类型固定为 `GRAY`；024 正常后复用原 `myroot_canary` 路由键和值设置 `URL_PARAMS / 0%`，再定向回读 `/health`、MySQL 迁移、隐私说明和对象存储探针。失败时放弃 024 并恢复 023 条件路由，012 始终承接默认流量。
3. 024 定向验证通过后，再经行动时确认上传同一 `v0.5.7` 提交的小程序体验版，完成登录、隐私、订阅授权、任务、媒体上传/删除、结算、字体与 Root 会员中心跳转真机测试。
4. 将真机跳转结果写入 Root 会员中心 `VERIFIED` 证明；失败则修复并重新上传，不伪造后台记录。
5. 在受控控制台补齐有赞、企微和物流变量，先做脱敏样本评审，再做 `PREVIEW`，最后逐个确认最小批量真实执行。
6. 补齐 6 项生产切换证明：有赞订单/客户/商品、有赞奖励、企微字段、外部通道、导出存储、回滚演练。
7. 重新生成并留档严格证据包，完成产品、运营、研发签字。
8. 经发布负责人行动时确认执行 5% 灰度；观察错误率、MySQL、提醒与外部 Adapter 后，再单独决定是否全量切流。

候选替换的当前只读状态、工件、平台约束、影响和回滚步骤见 [024 上线前预检](./production_candidate_024_preflight_2026-07-13.md)。

## 11. 2026-07-13 v0.5.7 本地候选

1. 复核有赞官方文档目录、历史方法说明、仓库 Adapter Implementation 和生产契约测试后，确认 `v0.5.6` 的通用发券请求会夹带内部字段，券状态默认方法和主键字段也不符合官方 Interface。
2. 新候选只向官方发券 Interface 发送 `activity_id + yz_open_id`，只向券详情 Interface 发送 `coupon_id + coupon_type`；接收人必须由奖励 `root_user_id` 唯一匹配有赞客户镜像。
3. 活动级奖励配置和批量执行请求不能覆盖接收人；零个或多个 `yz_open_id` 均失败关闭。该约束防止批量奖励误发给同一有赞账号。
4. 外部发券和状态响应写入任务、奖励记录和审计前统一脱敏；外部券 ID 通过独立引用保留，个人身份和完整响应不保留。
5. 官方发券已成功但缺少有效 `coupon_id` 时，任务按完成处理以阻止重复发券，并生成高优先级运营复核待办；券状态响应 ID 不一致时失败关闭。版本统一提升为 `0.5.7`，完整验收 `15/15 PASS`、覆盖 216 个 JavaScript 文件；小程序清单 SHA-256 为 `38a2553de2f784f3f984fd759186277022e549d7a45238ae2c2e9aa595f01eeb`，后端候选 ZIP 为 181 个条目、1,048,548 bytes，SHA-256 `abde4fd1d30a7543a2c10e9c6fbdf41b7b582cf29e69e3ae7c9ab69d5cf2bb62`，172 个源文件的内容清单 SHA-256 为 `f436464ab91485f0ddb6bcadd488e95191fda4b5509b88c2724d1d9fcfe69b61`。
6. 本地镜像 digest 为 `sha256:718b96a88a375786d667e4afc80705730414c3348bd82040f5d289338f8682b7`，大小 70,076,395 bytes；隔离容器四个运行入口均为 HTTP 200 和 `0.5.7`，隐私说明回读处理者名称、公开邮箱和 180 天保存期限，容器已停止。
7. 本版已提交为本地提交 `af70ff9`（未 push），并部署为 `myroot-api-024 / URL_PARAMS / 0%` 条件候选；012 默认流量未改变，小程序尚未上传。完整执行证据见 [024 生产证据](./production_gray_release_024_2026-07-13.md)。

## 12. 2026-07-13 候选 024 执行结果

1. 023 最终证据归档后通过 CLI `traffic rollback` 结束，012 保持正常；无参数 `/health` 连续 15 次未命中 0.5.6 或 0.5.7。
2. 从已校验干净源码目录部署预期版本 024，BuildId `2601317457`；VPC、48 个变量名、1–2 副本、端口和开放方式均未漂移。
3. 官方 `ReleaseGray` Interface 已复用原 `myroot_canary` 路由，发布单回读 `URL_PARAMS / 0% / grayStatus=success`；配置后 15 次默认请求均未命中 0.5.7。
4. 024 定向健康、MySQL 迁移 004、schema 最小权限、隐私 180 天和对象存储精确写删均通过；探针目录回读 `total=0`。
5. 两个 Cloud Function 已使用只更新代码的 CLI Interface 对齐到 0.5.7；每个函数各 6 个变量、两函数合计 10+1 个启用触发器、候选路由和 `ROOT_JOB_DRY_RUN=true` 均未漂移，11/11 作业返回 `releaseVersion=0.5.7 / dryRun=true / HTTP 200 / code 0` 并命中 024 后端。
6. 本次未上传小程序、未执行真实外部 Adapter、未开启 Cloud Function execute、未进入百分比灰度或正式切流。

## 13. 2026-07-13 v0.5.10 本地提醒可靠性候选

1. 024 首次正式目标提醒失败后没有重试；旧版统一 `1006` 且丢失微信说明，因此该次结果不能作为送达证明，也不能安全推断一次性额度是否仍可用。
2. 本地候选新增 `notificationSubscriptionGrants`，把每次用户原生接受转成一个幂等、只消费一次的任务级额度；历史订阅状态不迁移成额度。
3. Store Module 在微信发送前提交 `SENDING/RESERVED` 检查点并释放 MySQL 快照锁，受控并发调用后重新进入 Store、按 ID 绑定记录并提交结果。最终提交失败时不会自动重复发送。
4. 未知发送结果和超时 `SENDING` 会进入人工核验；送达证据不保存 OpenID、token、原始 `msgid` 或完整响应。
5. 新增迁移 `005_notification_subscription_grants.sql`，根项目、后端、Admin、小程序与 Cloud Function 版本统一为 `0.5.10`。本节只记录本地实现，未读取或修改生产环境。
6. 完整验收已为 `15/15 PASS`；隔离 MySQL 8 的迁移 005、授权投影、检查点释放锁、并发写入、恢复与重启持久化均通过；候选 ZIP、展开源码和小程序清单已生成并校验。生产部署结果见下一节与 [025 生产证据](./production_gray_release_025_2026-07-13.md)。

## 14. 2026-07-13 候选 025 执行结果

1. 行动时回读确认 012 为默认稳定版本、024 为 `URL_PARAMS / 0%` 条件候选；在内存中保留原条件路由后安全结束 024，再提交 025。
2. `myroot-api-025 / v0.5.10` 已构建为 `normal`，BuildId `2601318859`；VPC、1 至 2 副本、端口 80、48 个环境变量名和开放方式均未漂移。
3. 发布单为 `012 -> 025 / URL_PARAMS / flowRatio=0 / grayStatus=success`。定向 `/health` 返回 `0.5.10`，`/ready` 返回 MySQL connected、迁移 005 与 schema 级最小权限；隐私和 Admin Gate 通过。
4. 路由配置后额外 15 次无参数 `/health` 全部为稳定响应，025 命中 0 次。两个 Cloud Function 均为 `Active / Available / ROOT_JOB_DRY_RUN=true`，并精确匹配 025 路由。
5. 经后续单独确认，只更新两个 Cloud Function 代码包到 `v0.5.10`；更新前 `v0.5.7` 回滚包已下载，更新后两个云端包与本地哈希精确一致，6 个变量、10+1 个启用触发器、025 路由和 dry-run 均未漂移。
6. 10+1 个 Job 共 11/11 同步调用返回 `releaseVersion=0.5.10 / dryRun=true / HTTP 200 / code=0 / InvokeResult=0`，没有执行真实外部动作或健康数据清理。
7. 微信开发者工具 CLI 已上传小程序 `v0.5.10`，实际上传 485,534 bytes；公众平台版本管理页确认该版本已指定为体验版，未提交审核。首个预览沿用旧 024 编译条件而提示“接口不存在”；改用仅存在于 `/tmp`、release 禁用的 025 定向预览后，真机原生授权成功，路由值未写入仓库或证据。
8. 首次重新授权在 17:39:02 生成第 1 条 `AVAILABLE`。第二个微信账号因相同手机号被合并到同一 Root 用户，只增加额度；独立账号随后形成第 2 个独立参与用户、第 3 条 `AVAILABLE` 额度和 1 条新 `SCHEDULED / attempts=0` 任务。
9. 模拟次日 09:01 的未来时刻 dry-run 返回 `HTTP 200 / code=0 / scannedCount=1 / DRY_RUN_READY=1`；接收方、模板、页面和 `thing1/thing2/thing3` 形状均就绪。事后回读证明任务仍为 `SCHEDULED / attempts=0`，额度仍全部 `AVAILABLE`，没有新增送达记录。
10. 经单独授权，025 对象存储探针在 19:40:13 返回 `VERIFIED`：上传确认与精确删除确认均为 `true`，残留可能性为 `false`；探针目录回读 `total=0`，审计记录恰好 1 条并匹配 `0.5.10`。发布单随后仍为 `012 -> 025 / URL_PARAMS / 0% / gray success`。
11. 旧 `FAILED / attempts=1 / 1006` 的结果证据为空，无法安全判断是否受理，因此没有恢复或重试。
12. 经新的单独授权，19:48:57 只提交一次单用户真实提醒。Job Interface 返回 `HTTP 200 / code=0`，唯一任务返回 `FAILED / 1006 / external HTTP 412 / externalErrorCode=null / deliveryOutcome=UNKNOWN`；请求 ID 唯一且没有第二次请求。按 v0.5.10 未知结果语义，匹配额度进入 `REVIEW_REQUIRED`，不得释放、复用或重发。
13. 发送后 dry-run 为 `scannedCount=0 / staleSendingCount=0 / resultCount=0`，发布单、012/025、0% 条件路由、两个函数、10+1 个触发器和全局 dry-run 均无漂移。微信 AppID、AppSecret 存在性、令牌和目标模板只读探针通过；官方文档未定义 `HTTP 412`，chunked 传输只作为下一版待验证假设。本次没有改变默认流量、生产凭据或历史版本，也没有执行 commit、push、其他外部 Adapter、5% 灰度或正式切流；正式发布继续为 `BLOCKED`。

## 15. 2026-07-13 v0.5.11 传输修复候选与 026 部署

1. 新 `wechatHttp` Module 为微信 JSON POST 显式写入 UTF-8 `Content-Length`，避免现有 Node.js Implementation 默认使用 chunked。
2. 非 2xx 或非 JSON 响应现在保留脱敏的 HTTP 状态、内容类型、安全追踪号和限长摘要；64 KiB 响应上限防止异常外部响应扩大内存与证据面。
3. 未返回微信业务 `errcode` 的失败继续分类为 `UNKNOWN`，授权进入 `REVIEW_REQUIRED`；没有改变 v0.5.10 的额度账本和禁止自动重发规则。
4. 新传输测试 `4/4`、提醒与 HTTP Interface `171/171`、后端 `257/257`、完整验收 `15/15` 通过；225 个 JavaScript 文件、5 个迁移和版本一致性均通过。
5. 最终候选 ZIP 为 185 个条目、1,072,804 bytes，SHA-256 `bf2ad367df73161d870eff2c467aaa54f264fbbd13542d10247c2f74e6787b48`；176 个展开源文件内容清单 SHA-256 为 `6e3bdcd940ea3826cb89c1f5cb065870ddf67af60def1d16168803429dd625bc`。
6. 经单独确认，已结束 025 活动灰度并部署 `myroot-api-026 / URL_PARAMS / 0%`；026 为 `normal`、BuildId `2601310799`，VPC、48 个环境变量值和实例规格均无漂移。
7. 026 定向 `/health`、`/ready`、MySQL 迁移 005、schema 最小权限、隐私和 Admin 通过；15 次无参数 `/health` 没有命中 026，012 继续承接默认流量。
8. 两个 Cloud Function 保持上一轮代码包、10+1 个启用触发器、026 路由与全局 dry-run；本轮未更新、未调用 Job。未上传体验版、未发送提醒、未执行微信业务 POST、未 commit 或 push；chunked 与 412 的因果关系和提醒送达仍未验证。完整证据见 [026 生产证据](./production_gray_release_026_2026-07-13.md)。

## 16. 2026-07-13 v0.5.12 正式 Gate 加固

1. 旧正式切换 Gate 只能跟踪 10 项生产证明，遗漏候选运行、同版本体验版、真实提醒送达、5% 灰度和工件追溯。
2. 本地 v0.5.12 将 Gate 扩展到 15 项，并把证据收口从 `T-001..T-010` 扩展到 `T-001..T-015`。
3. 定向测试 `174/174`、完整验收 `15/15` 通过；没有新增数据库迁移或用户流程变化。
4. 本版尚未部署、上传、更新函数、发送提醒、调整流量、commit 或 push；生产 026 与两个函数 dry-run 状态不变。
5. 当前最长提前期是创建有赞云自用型无容器应用并绑定 ROOT 店铺。完整缺口、执行顺序、确认点与回滚约束见 [v0.5.12 正式上线 Gate](./formal_launch_gate_v0.5.12_2026-07-13.md)。
