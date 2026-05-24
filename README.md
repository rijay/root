# ROOT 7日身体重启计划

基于 ROOT 试饮流程更新 PRD 的小程序与后台项目，已收敛为「线下获客 / 企业微信承接 / 有赞订单 / 物流送达 / 小程序打卡 / 运营待办 / 退款 / 复购转化」的演示闭环。

## 项目结构

- `miniprogram/`：原生微信小程序，覆盖智能首页、注册问卷、活动介绍、订单匹配、7天打卡、Day4/Day8 问卷、Day6 复购礼、日常打卡、历史记录、免单申请、个人中心。
- `backend/`：Node.js HTTP Interface 与本地运营后台，路径统一走 `/api/v1/`，内置内存 Adapter、JSON 文件 Adapter、SQLite Adapter 和测试。
- `backend/db/schema.sql`：按当前流程整理的核心建表脚本。
- `docs/release_readiness.md`：上线前验收、真实 Adapter 对接和发布阻塞项。
- `docs/external_adapter_samples.md`：有赞订单、物流状态、企业微信线索的真实样本字段规格。
- `docs/adapter_calibration_playbook.md`：真实账号接入前的校准顺序、配置表和回滚判断。
- `docs/release_record_template.md`：发布记录、签字位、证据检查和回滚动作模板。

## 运行后台

```bash
cd /Users/rijay/Documents/Root/root_seven_day_checkin/backend
npm run dev
```

后台 API 默认运行在 `http://127.0.0.1:8787`，管理台在 `http://127.0.0.1:8787/admin`。

需要重启后保留本地灰度数据时：

```bash
ROOT_STORE_FILE=/Users/rijay/Documents/Root/root_seven_day_checkin/backend/data/dev-store.json npm run dev
```

需要用 SQLite 文件做单实例上线前验证时：

```bash
ROOT_SQLITE_FILE=/Users/rijay/Documents/Root/root_seven_day_checkin/backend/data/root-checkin.sqlite npm run dev
```

后台启动后可生成发布校准报告：

```bash
npm run calibrate -- --base-url http://127.0.0.1:8787 --target production --strict
```

拿到真实导出文件后可先跑样本准入：

```bash
npm run samples -- --base-url http://127.0.0.1:8787 --mode preview --youzan-file ./samples/youzan.csv
npm run adapters -- --base-url http://127.0.0.1:8787 --source youzan --mode preview --limit 1
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
- 上线校准：上线闸口、Adapter 校准、发布记录和命令行校准报告会把真实发布阻塞项集中展示。

## 验证

```bash
npm run verify --prefix /Users/rijay/Documents/Root/root_seven_day_checkin
npm test --prefix /Users/rijay/Documents/Root/root_seven_day_checkin/backend
npm run check --prefix /Users/rijay/Documents/Root/root_seven_day_checkin/miniprogram
```

`npm run verify` 会执行 JavaScript 语法检查、后端测试、小程序校验，并启动临时 SQLite 后台做 HTTP Interface 冒烟。

当前版本默认使用内存 Adapter，适合演示。内部灰度可以设置 `ROOT_STORE_FILE` 使用 JSON 文件 Adapter；单实例小范围上线前验证可以设置 `ROOT_SQLITE_FILE` 使用 SQLite Adapter。正式上线前先阅读 `docs/release_readiness.md`，再执行 `npm run calibrate`，确认数据仓库、真实有赞/物流/企业微信 Adapter、正式微信登录密钥和 HTTPS 域名。
