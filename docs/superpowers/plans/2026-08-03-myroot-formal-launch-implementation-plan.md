# myRoot 正式上线重整开发实施计划

> 日期：2026-08-03
>
> 状态：待执行
>
> 产品与 UED 依据：`docs/superpowers/specs/2026-08-03-myroot-formal-launch-design.md`
>
> 小程序性能依据：`docs/superpowers/specs/2026-08-03-myroot-miniprogram-performance-design.md`
>
> 运营后台性能依据：`docs/superpowers/specs/2026-08-03-myroot-admin-performance-design.md`
>
> Git 基线：`origin/main@aecbb1b718ab0aae1072fc8919571e80cab38bab`
>
> 计划起点：`codex/rebuild-main-20260802@339651e56c2cce37d7d05873522620b947c8de33`

## 1. 目标

从已批准的产品规格和 Ardot 高保真图出发，把当前包含任务、打卡、奖励、内部商品、订单和结算逻辑的旧小程序，重建为可准备正式上线的四 Tab 产品：

- 首页：品牌、商品与活动内容；
- 健康：Root4U 建档、评测、结果与生活方式建议；
- 活动：线下活动浏览、报名和权威状态；
- 我的：资料、会员中心固定跳转、隐私与支持。

实施不为未正式投入真实环境的旧功能建设兼容层。旧功能按完整产品切片删除，身份可信、隐私同意、幂等、事务、审计、结果未知恢复、健康检查、就绪检查和发布 Gate 继续保留。小程序的包体、素材、请求、渲染、内存和核心旅程必须满足已批准的性能预算；性能验收不得等到功能完成后才开始。Element Plus Admin 按两名核心运营、最多五个同时会话的近期规模实施，并在开发阶段同步满足构建、查询、浏览器三层性能 Gate；本阶段不设置运营 Gate。

## 2. 当前可复核基线

2026-08-03 在计划起点执行 `npm run verify`：

- 总验证 `18/18 PASS`；
- JavaScript 语法检查 `473` 个文件通过；
- `66` 个历史 migration 校验和通过；
- Backend、Element Plus Admin、Mini Program、Route Registry 与 HTTP Interface smoke 均通过；
- Admin 继续使用 Vue `3.5.x`、Vite `6.3.x` 与当前 lockfile 实际解析的 Element Plus `2.14.2`，本轮不升级前端框架；
- 正式开发主运行时固定为 Node `22.23.2`；现有 CloudBase 函数继续在独立 Node 18 兼容任务中验证，直到对应旧函数切片删除或运行时另行升级；
- 当前旧 Admin 的 `main.js` 全量注册 Element Plus，`App.vue` 同步导入全部旧页面；现有产物原始体积 `1,635,246 bytes`、gzip 文件合计 `443,222 bytes`；
- 当前通过证明旧版本在本地自洽，不证明新产品已经实现，也不证明部署、审核、发布或线上流量状态。
- 当前验证没有形成新产品的包体、P75/P95、弱网、内存或真机性能基线；旧小程序与旧 Admin 数据只能帮助识别工具问题，不作为正式上线目标，也不投入时间优化。

当前代码与目标之间的主要差异：

- `miniprogram/app.json` 仍为五 Tab，包含“任务”；
- `pages/tasks`、`pages/rewards`、`subpkg/checkin`、`subpkg/task`、`subpkg/refund`、内部商品与订单匹配页面仍存在；
- 首页和“我的”仍编排任务、打卡、奖励、订单等旧状态；
- `admin/src/App.vue` 仍展示运营配置、用户生命周期、Adapter 运行、运营数据等旧菜单；
- `backend/src/app.js` 与 `backend/src/domain.js` 仍注册任务、奖励、结算、内部商品、退款和旧 Job；
- CloudBase 清单仍包含打卡提醒、结算、旧 Adapter、生命周期导出等 Job。

## 3. 高保真图是开发验收依据

### 3.1 唯一设计来源

- Ardot 文件：`myRoot`，`cocraft://localhost/file/684679021092544`；
- 正式页：`368:1`，`myRoot 正式上线 UED · R0 · 2026-08-03`；
- 只使用该页已批准 Node；旧 CURRENT、ARCHIVE 页面不得混入实现；
- Root Logo 只使用官方字标的文字字形部分，不使用左侧器皿，也不得用系统字体重构。

### 3.2 每个视觉任务的固定步骤

1. 开始任务前，用 Ardot 回读该任务对应的具体手机或后台画板，不只读取外层 Section；
2. 提取画板中的准确文案、层级、尺寸、间距、字体、颜色、圆角、图标、状态和滚动方式；
3. 优先复用当前小程序原生能力、WXML/WXSS 和现有 Vue 3 + Element Plus，不引入新的前端框架；
4. 实现后先通过行为测试，再在与画板一致的视口生成截图；
5. 小程序以 `390 × 844` 为主对照，并补充 375px 小屏、常见 iOS 与 Android 真机；同一轮验收同时记录页面性能、网络档位和设备信息。后台以画板中的 `1240 × 820` 内容区为主对照，并检查常见桌面宽度；
6. 对照检查文字、Logo、安全区、对齐、间距、颜色、圆角、图标、遮挡、溢出、空态、错误态和加载态；
7. 未达到高保真图时不得把该任务标为完成；如果画板与正式规格冲突，停止该任务并请求产品决定，不自行创造第三种方案。

### 3.3 画板到实施任务的绑定

| 实施范围 | Ardot Node |
| --- | --- |
| 欢迎体验 | `368:3`，具体手机画板 `368:8`、`368:12` |
| 首页与共用详情 | `368:50`，具体手机画板 `368:55`、`368:59` |
| 登录、隐私和注册 | `369:40`，具体手机画板 `369:45`、`369:47`、`369:50` |
| Root4U 入口、答题、结果与安全 | `372:2`、`372:14`，具体手机画板 `372:7`、`372:9`、`372:19`、`372:21` |
| 活动列表、详情和报名确认 | `372:143`，具体手机画板 `372:148`、`372:150`、`372:154` |
| 我的访客、登录和跳转失败 | `372:240`，具体手机画板 `372:245`、`372:247`、`372:249` |
| 关于、隐私与注销 | `372:254`，具体手机画板 `372:259`、`372:261`、`372:263` |
| 后台框架与发布工作台 | `372:502` |
| 内容运营 | `372:593` |
| 共用详情编辑 | `372:747` |
| 活动管理 | `372:945` |
| 活动报名记录 | `372:1096` |
| 初始化建档 | `372:1248` |
| 量表管理 | `372:1399` |
| 推荐规则 | `372:1550` |
| 生活方式建议 | `372:1701` |
| 用户查询 | `372:1853` |
| 操作审计 | `372:2004` |
| 发布确认 | `372:2155` |

## 4. 实施原则

1. **完整切片删除**：页面、路由、状态、后端运行注册、后台菜单、Job、测试、fixture 和配置一起退出。
2. **不解耦待删除旧逻辑**：先切断调用，再删除死代码；不为旧任务、打卡、奖励、内部订单建设新 Seam。
3. **保留深 Module**：身份、内容、活动、健康评测、生活方式建议、资料和会员中心跳转分别提供稳定 Interface；页面不直接理解外部系统或存储细节。
4. **真实 Seam 才有 Adapter**：新能力只实现生产 MySQL Adapter 与内存测试 Adapter；不为 JSON/SQLite 补齐完整新业务能力，除非验证证明其仍是正式运行依赖。
5. **历史 migration 不改写**：新增 forward migration；表归档或删除必须晚于运行入口停止、只读盘点、快照和单独批准。
6. **发布状态分离**：内容发布、代码构建、后端候选版本、数据迁移、微信上传、审核、正式发布和线上流量分别留证。
7. **默认不触碰生产**：本计划只授权本地代码、测试、构建、截图和本地提交；不授权部署、生产迁移、微信送审、发布或切流。
8. **性能属于 Interface**：启动、响应、错误模式和资源特征都是 Module Interface 的一部分；每个正式上线切片必须同时交付功能、异常恢复和性能预算证据。
9. **后台保持轻量**：只为两名核心运营、最多五个同时会话建设必要 Depth；不引入 Redis、WebSocket、第三方 APM、虚拟滚动、海量异步导出或新的全局状态框架，也不设置运营 Gate。

## 5. 分阶段实施任务

### R0. 建立小程序性能预算与测量基础

**目标：** 在正式页面开发前建立机器可读预算、隐私安全的性能监测 Module 和证据格式；只测量旧版本，不优化即将删除的旧链路。

**性能规格：** `docs/superpowers/specs/2026-08-03-myroot-miniprogram-performance-design.md` 全文。

**修改：**

- `miniprogram/project.config.json`
- `miniprogram/package.json`
- `miniprogram/utils/request.js`
- `miniprogram/scripts/request.test.js`
- `backend/src/app.js`
- `scripts/final-verification.js`

**新增：**

- `miniprogram/config/performance-budgets.json`
- `miniprogram/utils/performance-monitor.js`
- `miniprogram/scripts/performance-budget.test.js`
- `miniprogram/scripts/performance-monitor.test.js`
- `backend/src/performanceMetricsModule.js`
- `backend/tests/performance_metrics_module.test.js`
- `scripts/miniprogram-performance-report.js`
- `docs/evidence/performance-r0/README.md`

**步骤：**

1. 根据正式上线依赖的微信能力锁定最低基础库版本，并记录最低版本与验收时稳定版本；
2. 把主包、单分包、总包、图片、响应体、`setData`、节点、请求、内存和页面旅程阈值写入一个机器可读配置，`1KB = 1,024 bytes`；
3. 建立静态 Gate：检查代码包、素材、分包结构、全局低频依赖和单次体积增长；
4. 建立 `Performance Monitoring Module`，其 Interface 统一记录启动、页面、请求、图片、分包、关键写入、卡顿与内存告警；Implementation 汇总微信性能能力和业务计时，不让页面理解采样与上报细节；
5. 收窄共享请求 Interface：并行请求通常不超过 4 个；合并相同读取；页面离开时取消失效请求；`onShow` 去重；读取 8 秒明确失败，写入 12 秒进入结果未知恢复；
6. 后端性能接收只接受允许字段并限制体积与频率；拒绝手机号、昵称、头像、微信身份原值、健康答案、健康结论和会员资产；
7. 接收后的事件通过现有结构化技术日志路径进入候选报告，不新增性能业务表；日志保留遵循批准的技术日志规则，若当前路径无法支持 72 小时观察，则正式环境性能 Gate 保持阻断；
8. 候选版本 100% 采集；正式环境普通性能事件默认 10%，崩溃、内存告警和关键动作失败 100%；正式环境上报开关默认关闭，启用必须随发布另行批准；
9. 对旧版本只生成“非正式基线”测量记录，用于证明脚本可工作，不为旧页面、旧请求或旧 Job 做性能重构；
10. 固定证据字段：版本、平台、系统、微信版本、基础库、设备档位、网络、入口、代码包状态、样本数、P75、P95 和差异结论。

**验证：**

- `node miniprogram/scripts/performance-budget.test.js`
- `node miniprogram/scripts/performance-monitor.test.js`
- `node miniprogram/scripts/request.test.js`
- `node --test backend/tests/performance_metrics_module.test.js`
- 伪造敏感字段、超大事件、重复事件和高频事件均被拒绝；
- 关闭监测、监测上报失败或正式环境未授权时不影响核心用户旅程；
- 非正式基线明确标记为旧产品数据，不得成为新产品上线 Gate 的通过证据。

### R1. 锁定正式上线范围并删除旧前端入口

**目标：** 先把用户可达产品改成四 Tab，避免后续继续围绕旧入口开发。

**Ardot：** `368:3`、`368:50`、`372:2`、`372:143`、`372:240`。

**修改：**

- `miniprogram/app.json`
- `miniprogram/app.js`
- `miniprogram/app.wxss`
- `miniprogram/utils/router.js`
- `miniprogram/scripts/validate.js`
- `scripts/final-verification.js`

**新增：**

- `miniprogram/pages/welcome/index.{js,json,wxml,wxss}`
- `miniprogram/custom-tab-bar/index.{js,json,wxml,wxss}`
- `miniprogram/config/formal-launch-routes.js`
- `miniprogram/scripts/formal-launch-scope.test.js`

**删除：**

- `miniprogram/pages/tasks/`
- `miniprogram/pages/rewards/`
- `miniprogram/pages/products/`
- `miniprogram/pages/product-detail/`
- `miniprogram/pages/order/`
- `miniprogram/subpkg/checkin/`
- `miniprogram/subpkg/task/`
- `miniprogram/subpkg/refund/`
- `miniprogram/subpkg/profile/pages/tags/`
- `miniprogram/subpkg/profile/pages/orders/`
- `miniprogram/subpkg/profile/pages/review/`
- 只为上述旧路径存在的测试、fixture、图标和工具文件。

**步骤：**

1. 先写失败测试：要求 Tab 精确为首页、健康、活动、我的，并拒绝旧页面与分包路径；
2. 将欢迎页设为首次启动入口，本机记录只控制欢迎页，不触发登录或健康读取；
3. 建立四 Tab 自定义导航，确保图标、文字、激活态和安全区与高保真图一致；
4. 四个 Tab 入口页保留在主包；初始化建档/评测/结果、活动详情/报名确认、关于/隐私/注销按批准结构进入分包；
5. 启用 `lazyCodeLoading: requiredComponents` 和下一旅程分包预下载，禁止把低频 UI 声明为全局依赖；
6. 删除旧前端完整切片，不保留隐藏路由或分享入口；
7. 更新小程序校验脚本，使旧路径再次出现或包体超预算时直接失败。

**验证：**

- `node miniprogram/scripts/formal-launch-scope.test.js`
- `node miniprogram/scripts/performance-budget.test.js`
- `npm run check --prefix miniprogram`
- 全仓 `rg` 不得出现已删除的页面路径；
- 主包目标 ≤ 1.3MB、硬上限 1.5MB；单分包目标 ≤ 800KB、硬上限 1.2MB；总包目标 ≤ 6MB、硬上限 8MB；主包本地媒体目标 ≤ 200KB、硬上限 300KB；
- 相比最近批准基线增长超过 50KB 预警，超过 100KB 必须说明并重新批准；
- 微信开发者工具中四 Tab、冷启动、热启动和欢迎页跳过路径通过。

### R2. 建立共享视觉基础并完成欢迎页

**目标：** 用一套受控视觉变量承接高保真图，避免各页重复猜测样式。

**Ardot：** `368:3`、`368:8`、`368:12`。

**修改：**

- `miniprogram/app.wxss`
- `admin/src/styles/theme.css`
- `miniprogram/pages/welcome/index.{wxml,wxss,js}`

**新增：**

- `miniprogram/styles/tokens.wxss`
- `miniprogram/components/root-wordmark/`
- `miniprogram/components/immersive-header/`
- 经确认的 `miniprogram/static/brand/root-wordmark-dark.*` 与 `root-wordmark-light.*`

**步骤：**

1. 从具体画板提取颜色、字体层级、间距、圆角和安全区变量；
2. 从官方 Logo master 裁切文字字形，禁止使用左侧器皿或系统字体；
3. 实现两屏全屏 swiper、导航点、长文渐变保护和右下角“跳过”；
4. 处理小屏文字滚动、横向滑动冲突、胶囊安全区和底部安全区；
5. 首屏使用不超过主包媒体预算的轻量回退视觉，高清欢迎图由 CDN 按设备尺寸输出，第二屏延迟加载；
6. 单张欢迎图目标 300–450KB、硬上限 600KB，首屏同时图片下载总量不超过 800KB；
7. Logo 与 Tab 图标单个目标 ≤ 20KB、硬上限 40KB；主要过渡使用 `transform`/`opacity`，时长 200–350ms；
8. 只在正式商业素材未提供时使用明确标记的开发占位图，发布 Gate 必须拒绝占位图。

**验证：**

- 欢迎页文案逐字比对规格；
- `390 × 844`、375px 小屏、iOS 与 Android 截图对照；
- 首次进入、跳过、看完、清除本地数据后重现四条路径通过；
- 首个可理解内容真机 P75：iOS ≤ 0.9 秒、Android ≤ 1.4 秒；无业务数据请求，高清资源失败不白屏；
- Logo 资产检查确认无器皿图形和系统字体替代。

### R3. 重写 Session 与 Profile Module

**目标：** 完成微信手机号登录、新老用户分流、资料完善与原目标恢复。

**Ardot：** `369:40`、`369:45`、`369:47`、`369:50`。

**保留并收窄：**

- `backend/src/trustedWechatIdentity.js`
- `backend/src/wechatIdentityAuthority.js`
- `backend/src/wechatUnionIdAuthority.js`
- `backend/src/privacyConsent.js`
- `miniprogram/utils/wechat-login-flow.js`
- `miniprogram/utils/privacy-authorization.js`
- `miniprogram/utils/request.js`

**修改：**

- `backend/src/app.js`
- `backend/src/domain.js`
- `backend/src/store.js`
- `miniprogram/pages/login/index.{js,json,wxml,wxss}`
- `miniprogram/pages/register/index.{js,json,wxml,wxss}`
- `miniprogram/utils/router.js`

**新增：**

- `backend/src/sessionModule.js`
- `backend/src/profileModule.js`
- `backend/db/migrations/067_formal_launch_profile.sql`
- `backend/tests/session_module.test.js`
- `backend/tests/profile_module.test.js`
- `miniprogram/utils/auth-intent.js`
- `miniprogram/scripts/formal-launch-login.test.js`

**步骤：**

1. 先冻结 Session Module Interface：登录结果只返回已注册、需完善资料、新用户或身份冲突；
2. 后端只信任微信临时凭证与已验证手机号，不接受前端自报手机号；
3. 新 migration 增加生日、性别、头像、昵称、资料完整状态与注销状态，不改历史 migration；
4. 既有 Root 会员按可信 UnionID 与已验证手机号关联；两者指向不同账号时进入“资料核验中”，禁止自动覆盖；
5. 实现头像、昵称、生日、性别表单，手机号只读；必填缺失提示“必填项未填写”；
6. 未授权头像昵称时使用“Root用户”和文字字标头像；
7. 建立通用原目标记录，覆盖健康、活动、我的订单、优惠券和资料入口，不再只处理活动回跳；
8. 重复点击、超时和结果未知不得重复创建用户；
9. 登录和注册点击 100ms 内反馈、200ms 内进入明确状态；微信流程 3 秒显示等待说明、15 秒提供重试，按钮不得永久锁死；
10. 用户资料压缩响应 ≤ 30KB，头像目标 ≤ 80KB、硬上限 150KB；
11. 登录后读取 P75 ≤ 800ms、P95 ≤ 1.5 秒；注册写入 P75 ≤ 1 秒、P95 ≤ 2 秒，12 秒后进入结果未知恢复。

**验证：**

- 新用户、已注册 myRoot、既有 Root 会员、资料不完整、身份冲突五类测试；
- 隐私拒绝、手机号拒绝、超时、重试、重复提交与原目标恢复测试；
- 标准 4G、弱网和离线恢复下验证输入内容保留、重复注册防护与原目标恢复；
- `node --test backend/tests/session_module.test.js backend/tests/profile_module.test.js`
- `node miniprogram/scripts/formal-launch-login.test.js`
- 登录、隐私弹层和注册页逐屏截图对照。

### R4. 建立 Content Module，完成首页和共用详情

**目标：** 运营可维护欢迎页、首页轮播和共用图片详情，小程序只读取不可变已发布版本。

**Ardot：** `368:50`、`368:55`、`368:59`、`372:593`、`372:747`。

**新增：**

- `backend/src/contentModule.js`
- `backend/db/migrations/068_formal_launch_content.sql`
- `backend/tests/content_module.test.js`
- `backend/tests/content_http.test.js`
- `miniprogram/pages/content-detail/index.{js,json,wxml,wxss}`
- `miniprogram/utils/content-presenter.js`
- `miniprogram/scripts/content-presenter.test.js`
- `admin/src/modules/content/WelcomeContentPage.vue`
- `admin/src/modules/content/HomeCarouselPage.vue`
- `admin/src/modules/content/SharedDetailPage.vue`
- `admin/src/modules/content/adminContentApi.js`

**修改：**

- `backend/src/app.js`
- `backend/src/store.js`
- `miniprogram/pages/home/index.{js,json,wxml,wxss}`
- `miniprogram/app.json`
- `admin/src/App.vue`

**步骤：**

1. 建立内容、内容版本、图片、热点区域、投放位和发布记录；
2. Content Module Interface 只暴露草稿、校验、预览、复制草稿、发布、下线和读取当前版本；
3. 校验图片格式/尺寸/安全区、两至三行文字预设、热点坐标、跳转类型与白名单；
4. 后台上传前执行素材硬限制：首张轮播目标 300–450KB、硬上限 600KB；后续轮播目标 ≤ 350KB、硬上限 500KB；详情单图目标 ≤ 400KB、硬上限 600KB；
5. 发布一次只生成一个不可变版本；失败保留上一已发布版本；已撤下、到期或失效内容从缓存移除；
6. 首页实现全屏轮播、指示器、文字切换动画和点击详情；首屏最多一个内容请求，不等待会员或健康请求；
7. 首页响应压缩后 ≤ 100KB，公共读取 P75 ≤ 600ms、P95 ≤ 1.2 秒；本地缓存 ≤ 300ms；
8. 首页和活动共用同一个图片详情页；图片热点只做跳转，不承担报名事实；
9. 管理后台实现欢迎页、首页轮播、共用详情三个入口和小程序预览；列表查询 P75 ≤ 800ms，详情查询 P75 ≤ 600ms；
10. 后台上传前校验格式与体积，使用缩略图并只挂载当前预览；上传及确认目标 ≤ 3 秒，预览目标 ≤ 1.5 秒；对应页面异步资源压缩后硬上限 180KB。

**验证：**

- 非法素材、任意 CSS、任意脚本、非白名单域名和无效小程序路径均无法发布；
- 已发布版本不可原地修改，复制草稿后可再次发布；
- 首页空态、上一版本降级、轮播切换和共用详情测试；
- 首页首张主视觉真机 P75：iOS ≤ 1.8 秒、Android ≤ 2.5 秒；详情框架 ≤ 300ms；
- `node --test backend/tests/content_module.test.js backend/tests/content_http.test.js`
- `node miniprogram/scripts/content-presenter.test.js`
- `npm run check --prefix admin && npm run build --prefix admin`
- 后台内容列表、详情、上传、预览与页面异步资源满足对应预算；
- 首页、共用详情与三个后台页面截图对照。

### R5. 收窄 Activity Module 并完成活动体验

**目标：** 保留已验证的活动容量、报名、取消、幂等和结果未知恢复，删除任务预绑定与第二套详情逻辑。

**Ardot：** `372:143`、`372:148`、`372:150`、`372:154`、`372:945`、`372:1096`。

**保留并收窄：**

- `backend/src/activityModule.js`
- migration `034`–`040`、`043`–`045` 的历史文件；
- `miniprogram/utils/activity-actions.js`
- `miniprogram/utils/activity-command-recovery.js`
- `miniprogram/utils/activity-presenter.js`

**修改：**

- `backend/src/app.js`
- `backend/src/domain.js`
- `miniprogram/pages/activities/index.{js,json,wxml,wxss}`
- `miniprogram/subpkg/activity/pages/detail/index.{js,json,wxml,wxss}`
- `admin/src/modules/activities/ActivityWorkbench.vue`
- `admin/src/modules/activities/adminActivityApi.js`

**新增：**

- `admin/src/modules/activities/ActivityManagementPage.vue`
- `admin/src/modules/activities/ActivityRegistrationsPage.vue`
- 只有结构确需变化时才新增 `069_activity_task_decoupling.sql`；若运行引用删除即可完成，则不新增 migration；
- 活动内容版本与 Content Module 引用测试。

**步骤：**

1. 删除活动到任务、奖励或结算的运行依赖；历史 migration 不改写；
2. 活动定义只保存时间、地点、名额、报名规则和共用详情版本引用；
3. 列表改为 Today 风格卡片，显示权威报名状态；
4. 详情使用共用图片详情，底部固定报名状态栏；
5. 报名确认弹层、重复点击、弱网和结果未知恢复沿用现有幂等事实；
6. 活动列表每页 10–20 条、压缩响应 ≤ 100KB；游客只返回公共内容，登录用户报名状态由同一响应批量返回；
7. 活动列表封面目标 ≤ 120KB、硬上限 180KB，屏外图片懒加载并固定比例；
8. 后台拆成活动管理和报名记录；列表 P75 ≤ 800ms、详情 P75 ≤ 600ms、保存 P75 ≤ 1 秒；默认每页 20 条、最大 50 条并使用后端分页；
9. 报名记录手机号脱敏，导出留审计；单次最多 5,000 条且目标 ≤ 10 秒，导出期间不得使另一名运营的普通查询超过 P95 预算；
10. Root 会员中心和公众号跳转不得创建第二套报名记录。

**验证：**

- 并发名额、重复报名、重复取消、截止时间、已满、已结束和结果未知恢复；
- 首页活动详情与活动 Tab 详情确实共用 Content Module；
- 活动列表与加载更多 P75 ≤ 800ms；详情首图标准 4G ≤ 1.2 秒、弱网 ≤ 2 秒；
- 报名点击 100ms 内反馈；写入 P75 ≤ 1 秒、P95 ≤ 2 秒，超时后通过权威查询恢复；
- 后台活动列表、详情、保存、报名分页与导出预算全部通过；
- `npm run v1:activity:check`
- 现有活动恢复测试与新增内容引用测试通过；
- 三个小程序状态画板和两个后台页面截图对照。

### R6. 建立 Assessment 与 Lifestyle Advice Module

**目标：** 形成版本化、可追溯且安全优先的 Root4U 数据与运行逻辑。

**Ardot：** `372:2`、`372:14`、`372:1248`、`372:1399`、`372:1550`、`372:1701`。

**保留并收窄：**

- `backend/src/questionnaire.js` 中可支持通用版本化题目、选项和答案的 Implementation；
- `backend/src/privacyConsent.js`
- `backend/src/healthDataRetention.js`
- 健康数据保留清理 Job。

**新增：**

- `backend/src/assessmentModule.js`
- `backend/src/healthSafetyPolicy.js`
- `backend/src/lifestyleAdviceModule.js`
- `backend/src/lifestyleAdviceAdapters/fixedContentAdapter.js`
- `backend/src/lifestyleAdviceAdapters/modelAdapter.js`
- `backend/db/migrations/070_formal_launch_assessment.sql`
- `backend/tests/assessment_module.test.js`
- `backend/tests/health_safety_policy.test.js`
- `backend/tests/lifestyle_advice_module.test.js`
- `admin/src/modules/health/InitializationPage.vue`
- `admin/src/modules/health/ScaleManagementPage.vue`
- `admin/src/modules/health/RecommendationRulesPage.vue`
- `admin/src/modules/health/LifestyleAdvicePage.vue`
- `admin/src/modules/health/adminHealthApi.js`

**步骤：**

1. 以一个版本发布初始化 12 问、选项、必填规则、分类规则和安全分流；
2. 量表题目、选项、计分、结果分层与建议内容共同版本化，历史答案永远引用原版本；
3. 安全判断先于分类、推荐和模型调用；风险答案只返回批准的固定指引；
4. 推荐规则只允许“主分类/辅助标签 → 明确已发布量表版本”；
5. 生活方式建议只发送最少健康字段，不发送手机号、昵称、UnionID 或 OpenID；
6. 模型输出经过结构、禁用表达和安全检查后进入建议池；资料或评测变化才重新生成；
7. 模型生成不得阻塞健康首页或结果页首次展示；状态与建议压缩响应 ≤ 80KB；
8. 模型失败、超时或不合格时使用固定内容 Adapter；后台只选择已批准配置，不显示或输入密钥；
9. 后台初始化建档完整验证 12 问；量表按 100 题验收，每组 20 题，未展开控件不挂载且编辑时只更新当前题；
10. 后台健康列表 P75 ≤ 800ms、详情 P75 ≤ 600ms、保存 P75 ≤ 1 秒；生活方式建议页不实时调用模型；
11. 后台真实数据启用前要求内容、隐私、技术三方签署。

**验证：**

- 12 问必填、18+、健康同意拒绝/撤回、分类、推荐和版本追溯；
- 每一个风险选项都证明不会调用普通建议路径；
- 模型超时、不合格输出和固定 tips 降级；
- 日志、审计和普通分析事件不出现直接身份或健康原始答案；
- 后台 100 题长表单、分组切换、保存与恢复满足交互、查询和写入预算；
- `node --test backend/tests/assessment_module.test.js backend/tests/health_safety_policy.test.js backend/tests/lifestyle_advice_module.test.js`
- `npm run check --prefix admin && npm run build --prefix admin`。

### R7. 完成 Root4U 小程序界面

**目标：** 把 R6 的深 Module 转化为访客可理解、用户可完成的健康旅程。

**Ardot：** `372:7`、`372:9`、`372:19`、`372:21`。

**修改：**

- `miniprogram/pages/health/index.{js,json,wxml,wxss}`
- `miniprogram/pages/health-consent/index.{js,json,wxml,wxss}`
- `miniprogram/app.json`

**新增：**

- `miniprogram/subpkg/health/pages/assessment/index.{js,json,wxml,wxss}`
- `miniprogram/subpkg/health/pages/result/index.{js,json,wxml,wxss}`
- `miniprogram/utils/assessment-presenter.js`
- `miniprogram/scripts/assessment-presenter.test.js`

**删除：**

- 旧 `DAY8_SUMMARY`、第 3/7 天复测、任务提醒和奖励相关前端语义与测试。

**步骤：**

1. 健康 Tab 对访客展示 Root4U 定位和三步说明；“开始评测”才触发登录；
2. 登录后检查 18+ 与独立健康同意；
3. 实现单题答题、进度、返回、必填、恢复和提交状态；
4. 结果页展示主分类、辅助标签、三个 tips 和推荐量表；
5. 风险页只展示批准的求助/就医或谨慎指引，不显示普通 tips；
6. 每次进入轮换三条建议，不在页面打开时实时调用模型；
7. 问卷答案保留在非渲染状态，只把当前题和必要进度送入 `setData`；下一题切换 ≤ 100ms；
8. 当前进度本地暂存，恢复网络后统一提交；提交超时进入“结果确认中”，不得重复生成记录；
9. 单次普通 `setData` 目标 ≤ 20KB、硬上限 64KB；首次渲染目标 ≤ 3 批、硬上限 5 批；单页节点 ≤ 1,200、深度 ≤ 20。

**验证：**

- 访客、未成年、拒绝同意、普通完成、风险完成、断网恢复六条旅程；
- 评测分包首次进入标准网络 ≤ 1.5 秒；提交 P75 ≤ 1 秒、P95 ≤ 2 秒；
- 中端 Android 完整健康旅程无超过 200ms 持续冻结、无内存告警；
- `node miniprogram/scripts/assessment-presenter.test.js`
- `npm run check --prefix miniprogram`
- 四个手机画板逐屏截图对照并完成真机滚动、键盘和安全区检查。

### R8. 重写“我的”与 Member Center Link Module

**目标：** 删除旧订单、退款、打卡和奖励信息，只保留资料、支持、隐私及两个固定会员中心入口。

**Ardot：** `372:240`、`372:245`、`372:247`、`372:249`、`372:254`、`372:259`、`372:261`、`372:263`。

**修改：**

- `miniprogram/pages/profile/index.{js,json,wxml,wxss}`
- `miniprogram/pages/legal/index.{js,json,wxml,wxss}`
- `miniprogram/subpkg/profile/pages/about/index.{js,json,wxml,wxss}`
- `miniprogram/subpkg/profile/pages/support/index.{js,json,wxml,wxss}`
- `miniprogram/utils/youzan-jump.js`，重命名并收窄为会员中心固定跳转；
- `backend/src/app.js`

**新增：**

- `backend/src/memberCenterLinkModule.js`
- `backend/tests/member_center_link_module.test.js`
- `miniprogram/subpkg/profile/pages/privacy-account/index.{js,json,wxml,wxss}`
- `miniprogram/utils/member-center-link.js`
- `miniprogram/scripts/member-center-link.test.js`

**步骤：**

1. 未登录“我的”只展示访客头部、我的订单、优惠券、FAQ、客服、反馈、关于和版本号；
2. 登录后展示头像昵称，不展示等级、积分、余额、优惠券数量或订单摘要；
3. “我的订单”“优惠券”位于头像下方单列，跳转标识弱化并统一右对齐；
4. 两个入口只能使用代码中批准的白名单路径；后台不开放任意路径配置；
5. 跳转失败停留当前页，显示重试，不制造成功；
6. 退出只清会话和受保护缓存，不清欢迎页状态；
7. 注销位于“关于 Root → 隐私与账号”，完成范围说明、二次确认、会话失效、状态查询和客服入口；
8. 游客页面不发私密请求且 ≤ 500ms；登录资料 P75 ≤ 800ms；会员中心入口点击 100ms 内反馈，外部跳转失败后当前页面可恢复。

**验证：**

- 访客、登录、跳转失败、退出和注销处理中状态；
- 页面、请求、缓存、日志和后台用户查询均不出现会员资产；
- `node --test backend/tests/member_center_link_module.test.js`
- `node miniprogram/scripts/member-center-link.test.js`
- 六个手机画板截图对照。

### R8A. 建立运营后台性能预算与测量基础

**目标：** 在后台正式信息架构落地前建立机器可读预算、统一请求 Module 和三层证据格式；只记录旧 Admin 的非正式基线，不优化即将删除的页面。

**性能规格：** `docs/superpowers/specs/2026-08-03-myroot-admin-performance-design.md` 全文。

**修改：**

- `admin/vite.config.js`
- `admin/package.json`
- `admin/src/api/client.js`
- `admin/scripts/validate.js`
- `backend/src/app.js`
- `scripts/final-verification.js`

**新增：**

- `admin/config/performance-budgets.json`
- `admin/scripts/performance-budget.test.js`
- `admin/scripts/admin-request-performance.test.js`
- `backend/tests/admin_performance_contract.test.js`
- `scripts/admin-performance-report.js`
- `docs/evidence/admin-performance-r0/README.md`

**步骤：**

1. 将冷启动、缓存刷新、页面切换、查询、写入、DOM、帧率、长任务、内存、资源体积与相对退化阈值写入一个机器可读配置；首次可操作外壳 P75 ≤ 2.5 秒、硬上限 4 秒，缓存刷新 P75 ≤ 1.2 秒、硬上限 2 秒，已加载菜单切换硬上限 500ms，首次异步页面硬上限 1.5 秒；
2. 建立 Admin Request Module：单浏览器最多 4 个并行读取，五个会话合计以最多 10 个同时读取验收；合并重复读取并取消失效查询；读取 8 秒明确失败，写入 15 秒进入结果未知，不自动重试写入；
3. 所有写入携带幂等标识，结果未知后通过权威读取确认；两名运营同时编辑同一记录时使用版本号，第二次写入被阻止并要求刷新；
4. 建立用户 10,000、活动报名 5,000、审计 20,000、内容版本 1,000 和量表 100 题的固定测试数据；列表默认 20 条、最大 50 条；
5. 建立构建 Gate：首屏 JS+CSS 压缩后目标 ≤ 420KB、硬上限 520KB，首屏总传输硬上限 650KB，单页异步资源硬上限 180KB，后台总压缩体积硬上限 1MB；
6. 建立查询 Gate：列表 P75 ≤ 800ms/P95 ≤ 1.5 秒，详情 P75 ≤ 600ms/P95 ≤ 1.2 秒，写入 P75 ≤ 1 秒/P95 ≤ 2 秒；响应不得出现 N+1 查询或未展示的无用统计；
7. 建立浏览器 Gate：Chrome 稳定版（Edge 不在首发支持范围）、不低于 4 核 CPU/8GB 内存、`1240 × 820` 主视口；首次 DOM 硬上限 1,800、完整页面硬上限 3,500，单同步任务 ≤ 50ms，单标签稳定内存硬上限 300MB；
8. 固定标准办公网络（RTT 80ms、下行 10Mbps、上行 5Mbps）和弱网（RTT 200ms、下行 2Mbps、上行 1Mbps、丢包率 1%），每个关键场景执行 20 次，以 P75 为主结论并记录 P95；三层报告必须记录版本、环境、样本与差异；
   候选查询与浏览器样本必须绑定同一 Git 提交和同一非本机 HTTPS 目标，本地夹具或回环地址不得通过 `--candidate` 参数转成候选证据；
9. 当前旧产物只记录为过期的非正式参考，不得用于宣称新后台达标，也不得触发旧页面性能重构；
10. 本阶段不新增缓存基础设施、实时推送、第三方 APM、性能大盘或运营 Gate。

**验证：**

- `node admin/scripts/performance-budget.test.js`
- `node admin/scripts/admin-request-performance.test.js`
- `node --test backend/tests/admin_performance_contract.test.js`
- 敏感字段不得进入浏览器性能记录或后端结构化日志；
- 旧页面同步导入、全量 Element Plus 注册和旧菜单只作为删除证据，不作为优化对象；
- 三层报告能够独立生成，任一硬上限失败时返回阻断状态。

### R9. 重建 Element Plus Admin 信息架构

**目标：** 后台只保留首发运营所需能力，并与 12 张后台高保真画板一致。

**Ardot：** `372:502`、`372:593`、`372:747`、`372:945`、`372:1096`、`372:1248`、`372:1399`、`372:1550`、`372:1701`、`372:1853`、`372:2004`、`372:2155`。

**修改：**

- `admin/src/App.vue`
- `admin/src/modules/access.js`
- `admin/src/styles/theme.css`
- `admin/src/api/client.js`
- `admin/scripts/validate.js`
- `backend/src/adminAccessControl.js`
- `backend/src/app.js`

**删除或替换：**

- `admin/src/modules/adapters/`
- `admin/src/modules/analytics/`
- 旧 `admin/src/modules/config/`
- 旧 `admin/src/modules/users/` 中的生命周期、结算、导出、咨询与健康原始答卷视图；
- 旧后台静态回退入口 `backend/public/admin.html`、`admin.js`、`admin.css`，但必须在 Element Plus build 与回滚证据通过后删除。

**新增：**

- `admin/src/modules/release/FormalLaunchWorkbench.vue`
- `admin/src/modules/users/UserQueryPage.vue`
- `admin/src/modules/audit/OperationAuditPage.vue`
- `admin/src/modules/publish/PublishConfirmationDialog.vue`
- 对应的 Admin Interface 客户端与后台测试。

**步骤：**

1. 建立 Admin Shell Module，导航固定为发布工作台、内容运营、活动运营、健康运营、用户与审计；业务页面全部动态导入，Element Plus 只引入实际使用项；
2. 首发只设置一个后台角色，不提供角色、权限或会员设置页面；后台身份验证和最小访问控制继续保留；
3. 用户查询只支持手机号精确查询，P75 ≤ 600ms；只展示解决账号问题所需的最少资料，手机号脱敏，不展示会员资产或健康原始答案；
4. 操作审计不可修改，P75 ≤ 1 秒；记录动作、对象、版本、结果、请求编号和结果未知状态，不记录密钥、凭据、微信身份原值或健康原始答案；
5. 发布流程固定为草稿、系统校验、小程序预览、二次确认、发布；点击后 100ms 内反馈，超过 2 秒显示进度，一次操作只改变一个内容状态；
6. 内容发布、代码部署、微信审核、正式发布和线上流量在工作台中分开显示；
7. 表格统一后端分页、默认 20 条且最大 50 条，搜索输入延迟 300ms 并取消旧请求，不自动轮询或提供“显示全部”；
8. 关键长表格和长表单 P75 ≥ 50 FPS，不得持续冻结超过 200ms；单标签稳定内存目标 ≤ 200MB、硬上限 300MB，切换菜单 10 轮与编辑 10 次后增长 ≤ 20%，连续使用 30 分钟保持稳定；
9. 页面加载超过 300ms 显示骨架；查询失败保留筛选和表格，写入超时进入结果未知并权威回读；会话重新验证后保留内存中的未提交表单；
10. 不增加运营 Gate，运营使用反馈不替代构建、查询和浏览器三层技术证据。

**验证：**

- 菜单扫描不存在任务、奖励、结算、订单匹配、售后、Adapter 校准和会员资产；
- 用户查询脱敏与审计敏感字段拒绝测试；
- 发布二次确认、重复点击、失败和结果未知测试；
- `npm run check --prefix admin`
- `npm run build --prefix admin`
- `node scripts/prepare-backend-admin-dist.js --clean`
- `node admin/scripts/performance-budget.test.js`
- `node admin/scripts/admin-request-performance.test.js`
- 用户查询、审计、分页、双人编辑冲突、30 分钟稳定性与三层性能报告通过；
- 12 张后台画板逐页截图对照；表头、筛选区、状态标签、操作列和右对齐逐项检查。

### R10. 删除旧后端运行切片与 Job

**目标：** 新产品旅程闭合后，彻底停止旧任务、打卡、奖励、内部订单和结算写入，不保留运行影子。

**修改：**

- `backend/src/app.js`
- `backend/src/domain.js`
- `backend/src/store.js`
- `backend/package.json`
- `cloudbaserc.json`
- `backend/cloudbaserc.json`
- CloudBase dispatcher 与 scheduler 的 manifest、入口和测试；
- `contracts/route-registry/` 与 Route Registry 验证脚本；
- `scripts/final-verification.js`

**删除范围：**

- `/api/v1/tasks/*`、打卡、奖励、结算、内部商品、订单匹配与退款路由；
- 对应 admin 路由、命令、Presenter、运行 Module、Adapter、fixture 和测试；
- check-in reminder、旧 Adapter retry、lifecycle settlement/export、旧运营提醒等不再被首发能力使用的 Job；
- `taskEvent*`、`reward*`、`settlement*`、`order*`、`refund*`、旧 campaign/check-in 代码，仅在引用扫描证明不再被保留 Module 使用后删除；
- 旧发布 Gate 中专门要求上述废弃能力的检查项，替换为四 Tab、Content、Activity、Assessment、Profile 和 Admin 的正式上线检查。

**保留范围：**

- 活动仍使用的幂等、Outbox/Inbox、结果未知恢复和审计；
- 健康数据保留清理；
- Session、Profile、Content、Activity、Assessment、Lifestyle Advice、Member Center Link；
- `/health`、`/ready`、生产持久化保护、凭据保护、发布证据和回滚控制。

**步骤：**

1. 先删除路由、Job manifest 和运行注册，证明系统不再产生旧事实；
2. 用 `rg` 与依赖引用检查找出真正死代码；
3. 按完整切片删除，不把旧 `domain.js` 分支迁移成新抽象；
4. 更新 Route Registry、HTTP smoke、Admin 校验与 Mini Program 校验；
5. 更新包体基线，证明旧代码和旧资源从主包、分包及构建产物完整退出；
6. 删除只证明废弃产品行为的测试，保留并迁移通用可靠性测试；
7. 如删除影响身份、隐私、活动权威事实、审计或发布 Gate，停止该项并迁移最小必要事实。

**验证：**

- 全仓禁止路径与关键字扫描；
- CloudBase manifest 只剩首发真实需要的 Job；
- `npm test --prefix backend`
- `npm run v1:routes:check`
- `/health`、`/ready` 和新的 HTTP Interface smoke 通过；
- 删除测试证明旧路由返回明确不存在，而不是隐藏后仍可调用。

### R11. 数据库只读盘点与 forward migration 决策

**目标：** 删除旧运行能力后，再决定旧表归档或删除；不因“没有真实用户”而无记录改库。

**只读盘点：**

- 旧任务、打卡、奖励、结算、订单、退款、通知与生命周期表；
- 每表行数、最近更新时间、外键、触发器、存储过程、Job 与当前代码引用；
- 当前线上版本或候选版本是否仍调用相关路由；
- 快照位置、恢复步骤与负责人。

**可能新增但不在未批准时执行：**

- `backend/db/migrations/071_archive_formal_launch_legacy_slices.sql`
- 对应 checksum、schema snapshot 与恢复演练测试。

**步骤：**

1. 本地先生成只读盘点脚本和 dry-run 输出；
2. 如果发现真实业务数据或线上调用，停止该表删除，只设计最小事实迁移；
3. 没有依赖时生成新的 forward migration，不修改 `001`–`066`；
4. 生产 migration 必须单独取得明确批准，执行前完成快照和恢复验证。

**验证：**

- `npm run db:schema-snapshot:verify`
- migration 结构、顺序和 checksum 测试；
- dry-run、快照引用和恢复命令均可复核；
- 未获批准时不连接生产、不执行 DDL。

### R12. 全量验收与设计一致性证据

**目标：** 用行为、视觉、隐私、数据和发布证据证明首发范围闭合。

**新增证据：**

- `docs/evidence/ued-r0/screen-index.json`：20 个 Section Node、具体画板 Node、实现页面、视口和截图摘要；
- `docs/evidence/ued-r0/visual-review.json`：每个画板的通过/差异/责任人/复核时间；
- `docs/evidence/performance-r0/package-budget.json`：主包、分包、总包、素材与相对基线增长；
- `docs/evidence/performance-r0/real-device-results.json`：设备、网络、入口、代码包状态、30 次样本、P75/P95；
- `docs/evidence/performance-r0/regression-review.md`：绝对阈值、5% 预警、10% 阻断和例外失效版本；
- `docs/evidence/admin-performance-r0/build-budget.json`：首屏、单页与后台总资源体积和相对增长；
- `docs/evidence/admin-performance-r0/query-results.json`：固定测试数据、路由、样本、P75/P95、响应体与查询形态；
- `docs/evidence/admin-performance-r0/browser-results.json`：Chrome、网络、DOM、帧率、长任务、内存和 20 次关键场景；
- `docs/evidence/admin-performance-r0/regression-review.md`：三层 Gate、5% 预警、10% 阻断和例外失效版本；
- 更新 UED handoff 证据，使 `screenCount=20`、`archivedPagesExcluded=true`、`allCanonicalStatesCovered=true` 只有在真实证据齐全时成立。

**自动验证：**

- `npm run check --prefix miniprogram`
- `npm run check --prefix admin`
- `npm run build --prefix admin`
- `npm test --prefix backend`
- `npm run v1:routes:check`
- `node miniprogram/scripts/performance-budget.test.js`
- `node miniprogram/scripts/performance-monitor.test.js`
- `node scripts/miniprogram-performance-report.js --candidate`
- `node admin/scripts/performance-budget.test.js`
- `node admin/scripts/admin-request-performance.test.js`
- `node --test backend/tests/admin_performance_contract.test.js`
- `node scripts/admin-performance-report.js --candidate`
- `npm run verify`
- `git diff --check`
- secret、敏感原值、旧路由、旧菜单和旧 Job 扫描。

**手工与真机验证：**

- 首次欢迎、跳过、四 Tab、登录、注册、原目标恢复；
- 首页轮播、共用详情和受控跳转；
- Root4U 普通与风险旅程；
- 活动列表、详情、报名、取消和结果未知；
- “我的”访客/登录、订单/优惠券跳转失败、退出与注销；
- 20 张 Ardot 画板对应截图；
- 375px 小屏、常见 iOS/Android、弱网、键盘、安全区和长文；
- iOS 基准/主流设备、Android 4GB 基准/8GB 主流设备；最低基础库与验收时稳定版本；本地包、首次下载和版本更新；
- 每个核心旅程至少 30 次，P75 为主要结论并记录 P95；连续切换四 Tab 10 轮、详情开关 10 次、完整旅程 15 分钟；
- 后台 12 张画板对应桌面截图及表格溢出检查；
- 后台在 Chrome、标准办公网络与弱网下各执行关键场景 20 次，记录 P75/P95；最多五个同时会话、两个测试会话编辑冲突和 30 分钟内存稳定性均需验证。

**完成条件：**

- 新首发旅程全部通过；
- 高保真差异清单为零，或每一项都有用户明确批准；
- 静态资源、自动化、真机性能和产品体验四层 Gate 全部通过；任何硬上限失败或相对批准基线退化 ≥ 10% 均保持阻断；
- 运营后台构建、查询、浏览器三层 Gate 全部通过；不新增运营 Gate，也不要求运营签字作为技术性能证据；
- 本地包冷启动 `appLaunch` P75：iOS ≤ 1.2 秒、Android ≤ 2.6 秒；下载或更新包：iOS ≤ 1.8 秒、Android ≤ 3.7 秒；
- 已加载 Tab 切换 P75：iOS ≤ 400ms、Android ≤ 600ms；首次分包标准网络 iOS ≤ 1.2 秒、Android ≤ 1.5 秒，弱网 iOS ≤ 2 秒、Android ≤ 2.5 秒；
- 中端 Android 稳定内存建议值 ≤ 120MB、峰值 ≤ 180MB，滚动流畅度 P75 ≥ 50 FPS；
- 旧任务、打卡、奖励、内部订单、退款和结算在页面、路由、后端运行注册、后台菜单、Job、测试与配置中均不可达；
- 会员中心路径、健康内容签署或模型生产配置未齐全时，对应发布 Gate 继续保持阻断；正式素材与商业授权不再作为本阶段事项或独立 Gate；
- 本地完成不自动进入部署、微信上传、审核、发布或切流。

## 6. 推荐提交顺序

每个提交只包含一个可独立验证的产品切片，建议顺序：

1. `chore: add mini-program performance budgets and monitoring`
2. `refactor: remove legacy mini-program entry points`
3. `feat: build approved welcome and navigation shell`
4. `feat: rebuild trusted login and profile flow`
5. `feat: add versioned content publishing`
6. `feat: align activity flow with shared content`
7. `feat: add Root4U assessment and advice modules`
8. `feat: build Root4U approved mini-program screens`
9. `feat: rebuild profile and member center links`
10. `chore: add admin performance budgets and gates`
11. `feat: rebuild formal launch admin workbench`
12. `refactor: remove legacy backend routes and jobs`
13. `chore: add formal launch performance and verification evidence`

每次提交前运行该切片的专用测试与 `git diff --check`。跨切片修改不得混入同一提交；不使用 `git add -A`，避免带入当前工作树中已有的其他文档改动。

## 7. 实施停止条件

出现以下任一情况时，停止对应任务并报告证据：

- Ardot 正式页或 Node 不可访问，或高保真图与正式规格冲突；
- 正式页面素材未达到已批准 UED、尺寸、体积或 Root 文字字标规则，且任务准备关闭视觉验收；
- Root 会员中心正式小程序路径或真实测试账号缺失，且任务准备关闭跨小程序验收；
- 12 问、风险话术、量表或固定 tips 未完成责任人签署，且任务准备处理真实健康数据；
- 生产模型供应方、处理地区、保留规则或合同未确认，且任务准备启用模型 Adapter；
- 最低基础库、基准设备或网络档位无法锁定，且任务准备关闭真机性能 Gate；
- 任一性能硬上限失败，或相对最近批准基线退化 10% 以上；
- 后台目标 Chrome、固定测试数据或网络档位不可用，且任务准备关闭构建、查询或浏览器 Gate；
- 删除目标仍被线上版本、保留 Module 或真实业务数据使用；
- 需要部署、生产 migration、微信上传、审核、发布或切流。

这些停止条件只阻断对应上线动作，不阻止继续完成不依赖该材料的本地开发、自动测试和占位状态处理。

## 8. 对抗式审查清单

交付每个阶段前必须主动攻击以下问题：

1. **只换皮没删旧逻辑**：检查路由、运行 Registry、Job、后台菜单、测试和 fixture，而不只看 Tab。
2. **高保真图只被当作参考**：每个任务必须绑定 Node、截图对照和差异结论，没有视觉证据不算完成。
3. **内容发布被说成产品上线**：内容、代码、后端候选、数据迁移、微信审核、正式发布和流量状态必须分开。
4. **健康风险走入普通建议**：安全判断必须早于分类、推荐和模型 Adapter；风险答案只允许固定指引。
5. **会员中心跳转重新扩成资产同步**：首发只提供“我的订单”“优惠券”两个固定路径，不读取等级、积分、余额、数量或订单摘要。
6. **后台重新长出旧能力**：任何任务、奖励、结算、内部订单、售后、Adapter 校准或会员资产菜单都应使校验失败。
7. **为旧测试保留旧产品**：测试服务于已批准产品；仅保留能证明通用可靠性或首发行为的测试。
8. **为了快速删表而改历史 migration**：历史文件保持不可变，旧表只在运行停止、盘点、快照、批准和恢复验证后由新 migration 处理。
9. **最后才补性能**：每个切片必须带预算、异常恢复和测量；R12 只汇总证据，不替前面补做设计。
10. **用开发者工具代替真机**：最终结论必须包含 iOS、Android、代码包状态、网络档位、30 次样本、P75 和 P95。
11. **通过删除体验伪造达标**：性能优化不得删除批准文案、主要动画、内容层级或健康安全表达。
12. **缓存制造错误成功**：登录、注册、健康结果和报名状态必须来自可信身份与权威查询，弱网只允许进入等待或结果未知恢复。
13. **旧 Admin 被包装成新基线**：同步导入旧页面、全量注册 Element Plus 和旧产物只能用于识别删除范围，不能成为新后台达标证据。
14. **低并发掩盖查询错误**：只有两名运营不代表可以接受 N+1、无分页、“显示全部”、重复请求或写入状态不明确。
15. **性能治理过度设计**：出现 Redis、WebSocket、第三方 APM、实时性能大盘、海量异步导出或新的全局状态框架时，先证明正式需求，否则删除。
16. **擅自增加运营 Gate**：后台只设构建、查询、浏览器三层性能 Gate；运营反馈可以记录，但不形成阻断签署流程。

## 9. 计划完成后的状态定义

执行完 R1–R12，只能声明：

`FORMAL_LAUNCH_IMPLEMENTATION_LOCAL_COMPLETE / EXTERNAL_RELEASE_GATES_PENDING`

该状态表示本地代码、自动验证、四层小程序性能 Gate、运营后台构建/查询/浏览器三层性能 Gate、真机旅程和高保真一致性证据已完成；后台不设置运营 Gate。它不表示 CloudBase 已部署、生产数据库已迁移、微信版本已上传或审核、正式版本已发布，也不表示线上流量已切换。
