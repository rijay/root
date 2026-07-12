# myRoot v0.5.6 发布说明

发布日期：待正式发布确认

## 本版范围

- 根项目、后端、小程序、Element Plus Admin 与 Cloud Function 版本统一为 `0.5.6`。
- 校正有赞订单和客户响应契约、分页参数与 HTTP 200 内业务错误识别。
- 新增 UnionID 到一个或多个有赞 `yz_open_id` 的小批量身份对账 Module。
- 未归属订单允许自动补链；重复 Root 归属、Root 用户桥接缺失、`yz_open_id` 或订单已有不同归属时只创建人工复核待办，不自动覆盖。
- 成功身份默认每 168 小时复核一次，支持同一 UnionID 后续新增有赞身份。
- 对账记录只保存 UnionID 指纹和聚合结果，Job 输出与审计不保存原始身份或凭证。
- 新增受 Job 专用权限保护的 HTTP Interface、命令行 Runner、生产环境 Gate 和第 11 个 CloudBase 定时触发器。
- 新增生产 Youzan Token Policy，集中校验 `grant_id`、静态轮换负责人和到期时间；六个有赞调用点在策略缺失或 token 过期时失败关闭。
- 有赞 `client_secret` 改为轮换终端专用，不再要求进入 CloudRun 运行容器。
- 外部 Adapter 样本评审改为落库前脱敏；有赞客户镜像只保存原响应字段路径，不保存完整原始响应值。
- 新增 `004_external_evidence_minimization.sql`，候选启动时对旧格式样本评审和客户原响应执行同一最小化规则。
- 新增 MySQL 运行账号最小权限 Gate；生产启动要求目标 schema 上的 `SELECT / INSERT / UPDATE / DELETE / CREATE / ALTER`，拒绝全局数据权限、额外 schema 权限和 `GRANT OPTION`。
- 新增无需登录的 `GET /api/v1/privacy/notice`；微信平台隐私协议无法打开时，本地隐私页仍会展示后端已批准的处理者、联系方式和保存期限。

## 验证状态

- 有赞专项测试覆盖官方分页、多 `yz_open_id`、网关限流、默认 dry-run、补链、冲突保护和审计脱敏。
- 完整 `npm run verify` 已通过 `14/14`：213 个 JavaScript 文件、228 个后端测试、五套工件版本一致性、CloudBase 配置敏感键扫描、11 个 Job、双函数触发器容量拓扑、Production Env Matrix、生产依赖审计、Element Plus Admin、小程序发布源清单和 HTTP Interface smoke 全部通过。
- 隔离 MySQL 8 实测：schema-scoped 账号成功执行 4 个迁移并创建 25 张表，健康状态为 `leastPrivilegeReady=true / privilegeScope=SCHEMA`；同样六项权限授予到 `*.*` 时，启动按预期以 `MYSQL_PRIVILEGE_POLICY_BLOCKED` 失败关闭。
- 本地生产镜像 `myroot-api:0.5.6-local` 重新构建成功；镜像 ID 为 `sha256:b43e557303b5fec313fe30564ffc89e90e983d66424e1ad8087b529185184c6a`，大小 70,073,407 bytes，约 70.1 MB；镜像内 Admin manifest 为 `releaseVersion=0.5.6`、6 个 Module。
- 待部署 CloudRun ZIP 已从最终验收后的 Admin 工件重新封装：181 个条目、1,051,456 bytes，SHA-256 为 `640f1352817c70224953d748d84d8cd0ab6639e08a3969e40548bfab594aeca8`，且未包含 `node_modules`、`.git`、日志或 SQLite 文件。
- 隔离容器 `/health.version=0.5.6`、`/ready.version=0.5.6`、`/admin=200`，镜像内最新迁移为 `004_external_evidence_minimization.sql`；容器已停止。
- 真实隔离 MySQL `/ready` 还明确返回 `leastPrivilegeReady=true`、`privilegeScope=SCHEMA`、`privilegePolicyEnforced=true`；灰度验证脚本会直接拒绝缺失、全局作用域或未强制执行的候选。
- 公开隐私说明携带候选 `version/releaseId`；灰度脚本要求说明已配置、处理者存在、联系方式格式有效、保存天数为正且政策版本存在，失败时退出码为 `5`。
- Cloud Function 候选包为 2 个文件、2,963 bytes，`releaseVersion=0.5.6`、11 个 Job，SHA-256 为 `bf016c169cb0f3b0dd1e56c8e19ff895f5457b4d234abb3296aabc8f6ee2d3ec`。
- 小程序 `packOptions.ignore` 显式排除验证脚本、开发身份诊断页、README、package 元数据、`.gitignore` 和 `project.private.config.json`，同时保持未使用文件过滤、压缩和关闭源码映射。诊断页不再注册到 `app.json`，避免正式用户深链后把登录响应写到页面、控制台或剪贴板。
- 云托管失败日志只保留错误码、脱敏短消息和无查询参数路径；JSON 字段、查询参数和无标签微信标识均会脱敏，用户端传输失败只显示安全提示。订阅授权只持久化标准化结果，不再保存微信原始响应。生产只读回读确认 `notification_subscription` 当前为 0 行，无历史原始结果需要清理。
- 打卡结果和分享海报载荷改为进程内一次性健康状态，读取后立即销毁；启动时清除旧版本的两个持久化缓存键。
- 小程序发布校验覆盖 Root 会员中心短链归一化和 `navigateToMiniProgram(shortLink)` 调用，防止回归为无效的 `appId/path` 混传。
- Production Env Matrix 将次日打卡提醒和 Root 会员中心购买跳转提升为生产必过组；当前真实生产矩阵为 6 组通过、6 组可选、8 组阻塞，Root 会员中心通过，提醒模板变量缺失。
- 可复现的小程序候选源清单为 155 个文件、496,769 bytes，另按开发者工具默认规则排除 `.git`、`.svn`、`node_modules` 和 `.DS_Store`；文件清单 SHA-256 为 `3da8acc98202d0fa9ac8d4effee5be8af1e0f118589c5d9908032136dd29fbfb`。旧 366 文件清单误纳入内嵌 `.git` 对象，已作废。

## 当前部署状态

- CloudBase 环境：`myroot-prod-d5gl3gzg7115f149a`。
- 稳定版仍为 `myroot-api-012 / 100%`。
- 旧候选 `myroot-api-019 / v0.5.4` 已执行灰度回滚，不再占用候选发布通道。
- `v0.5.6` CloudRun 候选尚未部署，小程序尚未上传，线上流量仍未修改。
- CloudBase 单函数最多 10 个触发器；已将生产拓扑拆为主调度函数 10 个和健康保留期函数 1 个，合计 11 个。两函数均 `Active`、复用 `0.5.6` 代码和 5 项环境变量，并保持 `ROOT_JOB_DRY_RUN=true`。
- 两个新 Job 的手工调用已命中新函数代码，但稳定版后端还没有对应路由，均返回 HTTP 404；须在 `v0.5.6` 后端候选验证后复测，当前不算 dry-run 通过。
- 只读实库 `SHOW GRANTS` 确认旧 `myroot_app@'%'` 已包含 `DELETE`，因此未重复执行 `GRANT`；但其权限仍作用于 `*.*`，不能通过本版生产最小权限 Gate。
- 已创建候选账号 `myroot_app_v2@'%'`；最终回读仅有目标 schema 的六项必要权限，全局仅为 `USAGE`，无额外 schema 或 `GRANT OPTION`。旧账号保留用于回滚，候选尚未引用新凭据。
- CloudRun 基础配置已从一次被拒绝的灰度请求产生的 46 项暂存值恢复为稳定版 `012` 的 31 项；回读确认稳定密码非空、MySQL Store、开放方式和 1 至 2 实例未变，公网 `/health` 与 `/ready` 均为 HTTP 200。

## 发布前仍需完成

1. 已确认微信平台主体与营业执照一致，隐私处理者为 `杭州连生健康科技有限公司`、公开联系方式为 `hydennis@foxmail.com`、健康数据保存期限为 180 天；仍需把五个隐私变量写入 0% 候选并回读。
2. 完成有赞 User Query 权限、token 托管或刷新、订单/客户/优惠券真实小批量校准。
3. 完成企微线索/标签、物流和奖励履约真实小批量校准。
4. 两个新增 CloudBase 触发器已按 10+1 双函数拓扑部署；继续部署 `v0.5.6` 0% CloudRun 候选，并在候选路由上复测，保持 Job dry-run。
5. 上传 `v0.5.6` 体验版，完成隐私、登录、图片、打卡、结算和 Root 会员中心真机跳转。
6. 完成灰度回滚证明、生产切换证明和产品/运营/研发三方签字。
