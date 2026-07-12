# ROOT 7日身体重启计划

基于 ROOT 试饮流程更新 PRD 的小程序与后台项目，已收敛为「线下获客 / 企业微信承接 / 有赞订单 / 物流送达 / 小程序打卡 / 运营待办 / 退款 / 复购转化」的演示闭环。

## 项目结构

- `miniprogram/`：原生微信小程序，覆盖智能首页、注册问卷、活动介绍、订单匹配、7天打卡、Day4/Day8 问卷、Day6 复购礼、日常打卡、历史记录、免单申请、个人中心。
- `backend/`：Node.js HTTP Interface 与本地运营后台，路径统一走 `/api/v1/`，内置内存 Adapter、JSON 文件 Adapter、SQLite Adapter、MySQL Adapter 和测试。
- `backend/db/schema.sql`：按当前流程整理的核心建表脚本。
- `docs/release_readiness.md`：上线前验收、真实 Adapter 对接和发布阻塞项。
- `docs/internal_test_release_gate_tracker_2026-06-29.md`：内测期间正式发布 Gate、反馈分流和新需求台账。
- `docs/external_adapter_samples.md`：有赞订单、物流状态、企业微信线索的真实样本字段规格。
- `docs/adapter_calibration_playbook.md`：真实账号接入前的校准顺序、配置表和回滚判断。
- `docs/release_record_template.md`：发布记录、签字位、证据检查和回滚动作模板。

## 运行后台

```bash
cd /Users/rijay/Documents/Root/root_seven_day_checkin/backend
npm run dev
```

后台 API 默认运行在 `http://127.0.0.1:8787`。`http://127.0.0.1:8787/admin` 会在 `admin/dist` 存在时加载 Element Plus Admin；`http://127.0.0.1:8787/admin-legacy` 保留旧静态后台回退。

需要生成 Element Plus Admin 产物时：

```bash
cd /Users/rijay/Documents/Root/root_seven_day_checkin
npm run admin:build
npm run deploy:prepare-admin
```

需要重启后保留本地灰度数据时：

```bash
ROOT_STORE_FILE=/Users/rijay/Documents/Root/root_seven_day_checkin/backend/data/dev-store.json npm run dev
```

需要用 SQLite 文件做单实例上线前验证时：

```bash
ROOT_SQLITE_FILE=/Users/rijay/Documents/Root/root_seven_day_checkin/backend/data/root-checkin.sqlite npm run dev
```

云托管正式环境需要使用 MySQL Adapter：

```bash
ROOT_STORE_ADAPTER=mysql \
MYSQL_ADDRESS=10.11.103.164:3306 \
MYSQL_USERNAME=myroot_app \
MYSQL_PASSWORD=****** \
MYSQL_DATABASE=myroot-prod-d5gl3gzg7115f149a \
MYSQL_CONNECTION_LIMIT=8 \
MYSQL_CONNECT_TIMEOUT_MS=10000 \
ROOT_ADMIN_TOKEN=****** \
npm run dev
```

MySQL Adapter 启动时会先取得数据库级迁移锁，再执行 `backend/db/migrations`；每个业务请求用 `root_store_snapshot.revision` 行锁保护跨实例写入，并在同一事务内同步核心关系表。应用账号不需要创建数据库，但必须拥有目标库的建表、索引、变更表结构和数据读写权限。`GET /ready` 用于验证连接、迁移版本和当前修订号。

如需区分多名后台操作人，可用 `ROOT_ADMIN_TOKENS` 替代单口令，操作记录会写入对应 `operatorId`：

```json
{
  "ops-a": { "token": "******", "role": "operator" },
  "ops-b": { "token": "******", "role": "operator" },
  "admin": { "token": "******", "role": "admin" }
}
```

Element Plus Admin 会通过 `GET /api/v1/admin/me` 读取当前 operator、role 和 capabilities，并按能力隐藏左侧菜单；正式环境建议至少核对 viewer、finance、operator、admin 四类 token，并确认 `/admin/assets/*.js` 返回 200。backend-only 云托管部署会读取 `backend/public/admin-dist`，如需自定义路径可设置 `ROOT_ADMIN_DIST_DIR`。

后台启动后可生成发布校准报告：

```bash
npm run calibrate -- --base-url http://127.0.0.1:8787 --target production --strict
```

需要核对生产环境变量矩阵时：

```bash
npm run production-env -- --target production
```

需要核对 CloudBase 定时 Job 发布配置时：

```bash
npm run jobs:manifest -- --base-url https://myroot-api-273748-8-1437260454.sh.run.tcloudbase.com --campaign ROOT_7D_RESET --strict
```

需要检查 CloudBase 身份 header 透传时，本地可先验证后台探针路由形状；真实 openid/unionid 必须在 CloudBase 请求中确认：

```bash
curl -s "http://127.0.0.1:8787/api/v1/admin/cloudbase-identity-probe" \
  -H "X-WX-OPENID: local-openid-for-route-shape" \
  -H "X-WX-UNIONID: local-unionid-for-route-shape"
```

拿到真实导出文件后可先跑样本准入：

```bash
npm run samples -- --base-url http://127.0.0.1:8787 --mode preview --youzan-file ./samples/youzan.csv
npm run adapters -- --base-url http://127.0.0.1:8787 --source youzan --mode preview --limit 1
```

迁移到 MySQL 前先校验当前快照；正式写入前建议先 dry-run：

```bash
npm run store:verify -- --json ./data/dev-store.json
npm run store:migrate:mysql -- --json ./data/dev-store.json --dry-run
npm run store:migrate:mysql -- --json ./data/dev-store.json
```

## 运行小程序

1. 用微信开发者工具打开 `/Users/rijay/Documents/Root/root_seven_day_checkin/miniprogram`。
2. 使用测试 AppID，或保留 `touristappid`。
3. 本地联调时关闭合法域名校验，项目已在 `project.config.json` 中设置 `urlCheck: false`。
4. 登录链路始终使用微信手机号授权；开发调试入口不进入发布包。

## 已覆盖的 PRD 范围

- 全局状态机：`GUEST / UNREGISTERED / REGISTERED_IDLE / CHECKIN_ACTIVE / CHECKIN_COMPLETED / CHECKIN_FAILED / DAILY_USER`。
- Flow View Presenter Module：首页主动作由 `flowView` 和 `homeView` 提供。
- 身份和订单：收货手机号匹配有赞订单，订单匹配不自动启动打卡。
- 物流前置：只有 `DELIVERED` 后才能启动 Day1。
- 打卡：7天进度、今日提交、补卡时间窗、断卡审核、历史记录。
- 问卷：Day4 中期问卷不阻塞 Day5，Day8 收尾问卷是退款前置条件。
- 免单：完成7天并提交 Day8 后生成人工退款工作项，后台可审核通过。
- 优惠券：Day6 触发复购礼，支持领取、核销和复购点击观察。
- 日常模式：退款完成或点击继续打卡后进入 DAILY_USER，展示累计/连续/最长连续、趋势图和复购入口。
- 后台：Summary、运营待办、用户详情、反馈聚合、退款队列、优惠券转化。
- 真实样本导入：有赞订单、物流状态、企业微信线索可先预览校验，再导入灰度数据仓库；支持 JSON、CSV 和表格复制文本，并沉淀取样评审台账。
- 自动匹配：用户微信授权手机号与有赞收货手机号唯一命中时自动绑定；多订单或多用户命中进入后台人工冲突待办。
- 每日导入：后台订单页支持有赞订单 CSV 与物流状态 CSV 预览、批次锁定、确认写入和冲突处理。
- 数据稳定：MySQL Store Adapter 支持快照导入、导出和校验，后台访问可通过 `ROOT_ADMIN_TOKEN` 或 `ROOT_ADMIN_TOKENS` 做最低保护。
- 上线校准：上线闸口、Adapter 校准、发布记录、Element Plus 开发发布页、菜单级权限、Element Plus Admin 主入口、backend-only Admin build 部署包、CloudBase 身份透传探针和命令行校准报告会把真实发布阻塞项集中展示。

## 验证

```bash
npm run verify --prefix /Users/rijay/Documents/Root/root_seven_day_checkin
npm test --prefix /Users/rijay/Documents/Root/root_seven_day_checkin/backend
npm run check --prefix /Users/rijay/Documents/Root/root_seven_day_checkin/miniprogram
```

`npm run verify` 会执行 JavaScript 语法检查、后端测试、小程序校验，并启动临时 SQLite 后台做 HTTP Interface 冒烟。

当前版本默认使用内存 Adapter，适合本地演示；JSON 文件和 SQLite 只保留为本地排查 Adapter。本轮团队内测的开发版、体验版和正式版统一指向腾讯云 CloudBase `myroot-prod-d5gl3gzg7115f149a / myroot-api`，数据必须写入 CloudBase MySQL。云托管需设置 `ROOT_STORE_ADAPTER=mysql`、连接池变量和后台口令；定时 Job 还需要 `ROOT_JOB_BASE_URL` 与 `ROOT_ADMIN_JOB_TOKEN`。正式上线前先阅读 `docs/release_readiness.md`，再执行生产环境矩阵、校准、Job Manifest、20 并发与重启复测。
