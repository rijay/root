# myRoot 正式上线检查点

检查时间：2026-07-12 12:57 +08:00
候选版本：`v0.5.6`
状态：`BLOCKED`

本轮完成本地代码、构建、生产审计和已授权的上线准备动作：创建 schema-scoped 候选数据库账号、部署 10+1 个全局 dry-run Cloud Function 触发器，并回滚占用灰度通道的旧候选任务。CloudRun 稳定版仍为 `myroot-api-012 / 100%`；`v0.5.6` 0% 候选尚未提交，小程序尚未上传，没有执行真实外部 Adapter，也没有写入生产证明或签字。

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
| 本地候选 | 根项目、后端、小程序、Admin、Cloud Function 均为 `0.5.6`；`npm run verify` 为 `13/13 PASS` | `READY_LOCAL` |
| 自动验收范围 | 213 个 JavaScript 文件、228 个后端测试、版本一致性、11 个 Job、双函数触发器容量拓扑、依赖审计、Admin、小程序发布源清单和 HTTP Interface smoke；`14/14 PASS` | `PASS` |
| MySQL 权限隔离实测 | schema-scoped 账号应用 4 个迁移、创建 25 张表并通过健康检查；全局六项权限账号被启动 Gate 拒绝 | `PASS_LOCAL` |
| 本地镜像 | `sha256:b43e557303b5fec313fe30564ffc89e90e983d66424e1ad8087b529185184c6a`；70,073,407 bytes；Admin manifest `0.5.6 / 6 Modules` | `READY_LOCAL` |
| CloudRun 候选 ZIP | 181 个条目、1,051,456 bytes；SHA-256 `640f1352817c70224953d748d84d8cd0ab6639e08a3969e40548bfab594aeca8`；无 `node_modules`、`.git`、日志或 SQLite 文件 | `READY_LOCAL` |
| Cloud Function 工件 | 2 文件、2,963 bytes、11 Jobs；SHA-256 `bf016c169cb0f3b0dd1e56c8e19ff895f5457b4d234abb3296aabc8f6ee2d3ec` | `READY_LOCAL` |
| 小程序源清单 | 155 文件、496,769 bytes；显式排除开发诊断页、验证文件和私有配置，按开发者工具默认规则排除 `.git`、`.svn`、`node_modules` 和 `.DS_Store`；清单 SHA-256 `3da8acc98202d0fa9ac8d4effee5be8af1e0f118589c5d9908032136dd29fbfb` | `READY_LOCAL` |
| 隔离容器 | `/health.version=0.5.6`、`/ready.version=0.5.6`、`/admin=200`；镜像包含迁移 `004`；容器已停止 | `PASS_LOCAL` |
| CloudBase 环境 | `myroot-prod-d5gl3gzg7115f149a` 为 `NORMAL` | `READY` |
| 法定主体名称 | 营业执照原件确认名称为 `杭州连生健康科技有限公司`；负责人确认微信公众平台主体一致 | `PASS_CONFIRMED` |
| 生产稳定版 | `myroot-api-012 / 100%`；服务 `normal`；1 到 2 副本 | `READY_STABLE` |
| 旧候选 | `myroot-api-019 / v0.5.4` 已执行灰度回滚，稳定版 `012` 未变 | `ROLLED_BACK` |
| 生产 Store | 08:37 只读 `/ready` 为 MySQL connected、`003_privacy_consent.sql`、revision `545` | `READY_STABLE` |
| 数据库自动备份 | 自动增量快照 `9704265`，快照时间 02:45，状态 `success / usable` | `READY_ROLLBACK_BASE` |
| 约 20 并发容量 | MySQL `running / resume`、0.25 至 1 CCU、2 GB、`max_connections=1000`；只读水位为连接 4、运行 1、历史峰值 17。应用每实例连接池 8、最多 2 实例；既有双实例 20 人 40 次业务写 40/40 成功，647ms 完成。2026-07-11 00:00 至 2026-07-12 10:34 未检出超过 1 秒的慢查询 | `PASS_EXPECTED_LOAD` |
| MySQL 运行账号 | `myroot_app@'%'` 已有 `DELETE`，但六项权限仍作用于 `*.*`；未重复执行 `GRANT` | `BLOCKED_LEAST_PRIVILEGE` |
| MySQL 候选账号 | 已创建 `myroot_app_v2@'%'`；回读仅有目标 schema 的 `SELECT / INSERT / UPDATE / DELETE / CREATE / ALTER`，全局仅为 `USAGE`，无额外 schema 与 `GRANT OPTION` | `READY_CANDIDATE` |
| 下一迁移 | `004_external_evidence_minimization.sql` 尚未部署 | `READY_TO_DEPLOY` |
| CloudBase Job | `myroot-job-dispatcher` 10 个、`myroot-health-retention` 1 个，合计 11 个；两函数均 `Active`、5 个环境变量且全局 dry-run | `DEPLOYED_DRY_RUN_PENDING_ROUTE` |
| Production Env Matrix | 20 组中 6 组通过、6 组可选、8 组阻塞；Root 会员中心通过，次日打卡提醒缺生产变量 | `BLOCKED` |
| 发布记录 | 40 项 must-fix、17 项灰度确认、14 项最终检查 | `BLOCKED` |
| 生产切换证明 | 4/10 就绪 | `BLOCKED` |
| Root 会员中心跳转 | appId、路径、商品就绪；生产真机证明 0 条 | `BLOCKED` |
| 三方签字 | 产品、运营、研发 0/3 | `BLOCKED` |
| 发布追溯 | `main` 相对 `origin/main` 有 79 个修改项、167 个未跟踪项，共 246 个状态项 | `BLOCKED` |
| 候选凭据扫描 | 展开目录后扫描 311 个变更文件；309 个文本文件和 2 个二进制工件均无私钥或云密钥命中，唯一运行凭据模式命中是已确认的有赞 `must-not-leak` 测试哨兵 | `PASS_LOCAL` |

## 3. 本轮安全收口

1. 有赞 `client_secret` 只用于受控终端换取 token，不再要求进入 CloudRun 运行容器。
2. 运行容器仍强制校验 client id、grant id、access token、到期时间、`STATIC_ROTATION` 和唯一轮换负责人。
3. 外部 Adapter 原始样本只在当前授权预览响应中可见；持久化评审行会脱敏手机号、UnionID、地址、昵称、订单号、运单号和企微标识。
4. 有赞客户镜像的 `raw_payload` 只保存字段路径，不保存完整响应值。
5. 新迁移会在候选启动时清理旧格式评审。线上当前有 3 条旧格式评审、3 行原始样本、0 条有赞客户镜像；只读扫描命中手机号模式，尚未执行清理。
6. 灰度验证脚本默认要求 Store 为 MySQL 且迁移版本命中仓库最新迁移；仍为 `003` 时会退出码 `3` 阻止灰度。
7. 生产 MySQL 启动新增最小权限检查；只有目标 schema 上的六项必要权限可以通过，`*.*`、额外 schema 权限和 `GRANT OPTION` 均失败关闭。
8. 隔离 MySQL 8 已用真实授权语句验证该检查：库级账号成功迁移到 `004`，全局账号在迁移前被拒绝；测试数据库与容器已删除。
9. 新增公开隐私说明 Interface，并让本地法律页回读同一处理者、联系方式和保存期限；登录前、微信平台协议失败和敏感信息单独同意三条路径不再使用不同口径。
10. 当前变更文件已做私钥和 secret 文字模式扫描；唯一命中为测试夹具 `do-not-print`，运行代码、配置与文档未发现真实凭据形态。正式提交前仍需对最终 staged diff 再扫一次。
11. MySQL `/ready` 现在只公开安全的最小权限证明字段；隔离实测返回 `leastPrivilegeReady=true`、`privilegeScope=SCHEMA`、`privilegePolicyEnforced=true`。生产灰度验证会把缺失、全局作用域或未强制执行视为 Store Gate 失败。
12. 公开隐私说明携带候选版本元数据并进入灰度必过项；缺处理者、无效联系方式、非正整数保存天数、缺政策版本或未命中候选版本时，验证脚本返回独立退出码 `5`。
13. 五套可部署工件版本统一为 `0.5.6`，最终验收新增版本一致性 Gate；Cloud Function 运行结果和 Admin 构建 manifest 均携带发布版本，云函数目录也纳入 JavaScript 语法检查。
14. 后端镜像、Cloud Function 包和小程序源清单均已生成本地 SHA-256 对照；这些摘要只用于候选归属，不代表已经部署或上传。
15. 小程序上传配置新增 6 条显式排除规则，并由最终验收检查运行入口存在、开发文件缺席、未使用文件过滤开启、源码映射关闭。开发身份诊断页已从 `app.json` 和发布源清单移除，避免登录响应进入页面、控制台或剪贴板；旧源清单误计内嵌 `.git` 对象，已用可复现脚本更正并作废旧摘要。
16. 小程序运行日志只保留脱敏错误摘要，JSON 字段、查询参数和无标签微信标识均已覆盖；传输失败向用户返回稳定安全提示。订阅授权不再把微信原始结果传给后端，生产表当前为 0 行。打卡结果和海报载荷改为进程内一次性健康状态，消费后销毁，并在启动时清除旧版本持久化缓存。
17. 开发者工具已在本地重新编译候选文件；首页于 10:13:46 完成 `onRouteDone`，未发现用户代码编译错误。发布校验同时验证 Root 会员中心短链使用 `navigateToMiniProgram(shortLink)`，不会混传 `appId/path`。本轮没有执行预览或上传。

## 4. 当前 8 个环境阻塞组

1. `privacy_compliance`：负责人已确认平台主体一致、公开联系邮箱 `hydennis@foxmail.com` 和保存期限 180 天；五个生产变量尚待写入 0% 候选。
2. `checkin_reminder_subscription`：缺提醒启用开关、已申请模板 ID 和模板版本；微信凭据已由运行组满足。
3. `youzan_order`：缺 client id、grant id、token、到期时间、轮换负责人和订单 Interface URL。
4. `youzan_customer`：缺客户列表 URL、User Query URL、token 和身份对账开关。
5. `youzan_coupon`：缺发券与券状态 Interface URL、token 和真实回执。
6. `fulfillment`：缺物流来源 URL、凭据和真实字段。
7. `wework_contact`：缺企业 ID、客户联系 Interface、凭据和真实外部联系人样本。
8. `wework_tag`：缺标签 Interface、凭据、标签 ID 和真实回执。

## 5. 必须由负责人确认的非秘密输入

1. 有赞 ROOT 店铺 grant id、User Query 权限是否已开通、token 轮换负责人及到期时间。
2. 产品、运营、研发签字人；外部告警、退款、奖励和回滚值班负责人。

已确认：微信公众平台主体与营业执照名称一致；个人信息处理者为 `杭州连生健康科技有限公司`；公开联系方式为 `hydennis@foxmail.com`；原始健康敏感信息保存期限为 180 天。

秘密值不得粘贴到聊天、仓库或发布文档；应在受控控制台或密码管理器中配置。

## 6. 需要单独确认的生产变更

1. 已创建 schema-scoped `myroot_app_v2` 并通过 `SHOW GRANTS` 回读；旧 `myroot_app@'%'` 保持不变作为回滚账号，候选尚未引用新凭据。
2. 保留现有 31 个 CloudRun 变量，补齐已确认变量，部署 `v0.5.6` 0% 候选。候选启动会应用 `004` 并脱敏 3 条旧评审，预计 snapshot revision 增加一次。
3. 运行 `/health`、`/ready`、隐私配置、身份 dry-run、健康清理 dry-run 和对象存储探针；任何失败不进入 5%。
4. 已按平台单函数 10 触发器上限拆成两个 Cloud Function 并部署合计 11 个触发器；保持全局 `ROOT_JOB_DRY_RUN=true`，待候选路由就绪后复测两个新 Job。
5. 上传 `v0.5.6` 体验版，完成真机隐私、登录、媒体上传删除、任务、结算和 Root 会员中心跳转。
6. 用脱敏小批量完成有赞、物流和企微校准，再逐项授权 execute。
7. 完成 5% 灰度、回滚演练、证据包留档、三方签字和 100% 切流。

## 7. 当前结论

本地候选已达到可部署 0% 候选的代码质量，并已取得本轮数据库账号、候选部署、提醒变量、双函数 dry-run 和本地候选提交授权，但不等于正式可上线。下一步是在 macOS 钥匙串解锁后完成候选数据库密码安全回读并提交 0% 候选；在环境阻塞组、真机证明、真实 Adapter 回执、发布追溯和三方签字全部关闭前，正式发布状态保持 `BLOCKED`。

## 8. 最新生产只读复核

2026-07-12 08:37 再次回读确认：CloudRun `myroot-api` 状态为 `normal`，稳定版 `myroot-api-012` 保持 100% 流量、旧候选 `myroot-api-019` 保持 0%，两版均为 31 个变量名且未读取或输出变量值。公网 `/health` 与 `/ready` 均为 HTTP 200；稳定版仍未返回版本字段，迁移仍为 `003_privacy_consent.sql`，revision 已随生产记录推进到 `545`，公开隐私说明 Interface 仍为 HTTP 404。每日自动增量快照 `9704265` 已成功且可用。`myroot_app@'%'` 仍是六项权限作用于 `*.*`，`myroot_app_v2@'%'` 尚不存在。Cloud Function `myroot-job-dispatcher` 为 `Active`，9/9 触发器启用，尚未包含健康数据清理和有赞身份对账两个仓库目标触发器。按产品必需流程校正 Gate 后，Production Env Matrix 为 6 组通过、6 组可选、8 组阻塞；Root 会员中心配置通过，次日打卡提醒因 3 个生产变量缺失而阻塞。本次复核未修改环境变量、账号、函数、流量或业务数据。

2026-07-12 09:09 用户明确授权为 `myroot_app` 增加 `DELETE`。随后通过 CloudBase CLI 对生产环境执行只读 `SHOW GRANTS FOR 'myroot_app'@'%'`，回读结果仍为 `SELECT / INSERT / UPDATE / DELETE / CREATE / ALTER ON *.*`。由于 `DELETE` 已存在，本次没有重复执行 `GRANT`，未产生数据库权限写入；后续最小权限收敛仍按新建 schema-scoped 候选账号、验证、切换、再停用旧账号的独立变更流程处理。

2026-07-12 10:34 补充只读证据：本地营业执照 PNG 原件确认法定名称为 `杭州连生健康科技有限公司`，未摘录统一社会信用代码、地址等非必要字段；微信公众平台主体一致性仍待页面证明。CloudBase MySQL 配置与实时 SQL 均确认实例为 `running / resume`，0.25 至 1 CCU、2 GB、`max_connections=1000`，连接 4、运行 1、历史峰值 17；2026-07-11 00:00 至 2026-07-12 10:34 未检出超过 1 秒的慢查询。远端 `main`、本地 `HEAD` 与 `origin/main` 仍同为 `25be202`，没有远端漂移。本次没有创建账号、修改变量、部署候选、上传小程序、执行 Adapter 或改变流量。

2026-07-12 12:28 经负责人行动时确认后，已在 CloudBase 控制台创建 `myroot_app_v2@'%'`，凭据只保存到 macOS 钥匙串并输入控制台专用密码框，未写入命令参数、仓库或证据。控制台初始账号只能选择全局权限，因此先以临时 `SELECT ON *.*` 创建，随后立即撤销；最终只读 `SHOW GRANTS` 为全局 `USAGE`，以及 `myroot-prod-d5gl3gzg7115f149a` schema 上的 `SELECT / INSERT / UPDATE / DELETE / CREATE / ALTER`。没有 `GRANT OPTION`、额外 schema 或全局数据权限；旧 `myroot_app` 未修改，CloudRun 流量仍未改变。

2026-07-12 12:42 发现 CloudBase 单个云函数最多 10 个触发器，原单函数 11 触发器清单无法直接部署。已恢复主函数原 9 个触发器并新增 `youzan_identity_reconcile`，另复制同一 `0.5.6` 代码与 5 项环境变量创建 `myroot-health-retention`，只承载 `health_data_retention_cleanup`；云端最终为 10+1，两个函数均 `Active` 且 `ROOT_JOB_DRY_RUN=true`。仓库配置同步拆分，并新增触发器容量 Gate，完整验收为 `14/14 PASS`。两个新 Job 手工调用均进入新函数代码，但稳定版 `012` 尚无对应 HTTP Interface，返回 404；该结果记录为候选路由阻断，不记作 dry-run 通过。

2026-07-12 12:57 已执行旧灰度任务回滚，`myroot-api-019` 不再占用候选发布通道；稳定版 `myroot-api-012` 和线上流量未改变。一次被平台拒绝的候选请求曾把 CloudRun 基础配置暂存为 46 项变量，其中候选密码为空；发现后已立即从稳定版 `012` 的版本快照恢复为 31 项，回读确认 MySQL Store、非空稳定密码、`OA/PUBLIC/MINIAPP` 开放方式、1 至 2 实例均保持原值，公网 `/health`、`/ready` 均为 HTTP 200。最终 `v0.5.6` 候选 ZIP 已从通过 `14/14` 的最新 Admin 工件重新封装为 181 个条目、1,051,456 bytes，SHA-256 为 `640f1352817c70224953d748d84d8cd0ab6639e08a3969e40548bfab594aeca8`。候选账号密码已轮换并写入 macOS 钥匙串，但当前锁屏阻止安全回读；在负责人手动解锁前不提交 0% 候选。
