# ROOT 打卡小程序品牌化 UI 设计拆单

版本：V0.1
日期：2026-05-24
依据：Ardot `ROOT Brand + WeChat Spec v3`，fileId `685700159144269`，pageId `4:1`
适用范围：小程序端 UI/UX 设计落地，不改变后端业务规则

## 1. 设计目标

这一轮不是把小程序做成“微信原生页”，而是在微信小程序规范护栏内建立 ROOT 自己的品牌界面。

核心判断：

- 微信负责交互稳定性：导航安全区、胶囊菜单、标准页面层级、44px 以上触控、明确反馈、可退路径。
- ROOT 负责品牌感：墨黑 logo、暖白底、苔绿/新芽绿/陶土辅助色、身体秩序与陪伴式文案。
- 打卡流程仍然保持轻量：每个页面只承担一个主任务，不把复购、免单、客服、画像入口混在主打卡动作里抢注意力。

## 2. 设计输入

### Ardot 画板

- `4:2`：`00 ROOT Brand System / WeChat Guardrails`
- `4:3`：`01 Login - ROOT 品牌欢迎`
- `4:4`：`02 Home - 今日身体秩序`
- `4:5`：`03 Today - 温和打卡表单`
- `4:6`：`04 Stool - 便型记录`
- `4:7`：`05 Result - 秩序感反馈`
- `4:8`：`06 Profile - ROOT 我的`

### 品牌资产

- `/Users/rijay/Desktop/Root项目/ROOT LOGO.pdf`
- `/Users/rijay/Desktop/Root项目/Root产品设计文字信息 0420.docx`

已提取的品牌语气：

- “身体，自有其序”
- “让科学成为陪伴，让健康变成习惯”
- “不只是服用 Root，而是重新建立与身体的关系”
- “真正的健康，是安稳与清晰重新出现”

### 现有小程序落点

- 全局样式：[app.wxss](/Users/rijay/Documents/Root/root_seven_day_checkin/miniprogram/app.wxss)
- 全局配置：[app.json](/Users/rijay/Documents/Root/root_seven_day_checkin/miniprogram/app.json)
- 首页主状态：[pages/home/index](/Users/rijay/Documents/Root/root_seven_day_checkin/miniprogram/pages/home/index.wxml)
- 今日打卡：[subpkg/checkin/pages/today/index](/Users/rijay/Documents/Root/root_seven_day_checkin/miniprogram/subpkg/checkin/pages/today/index.wxml)
- 结果页：[subpkg/checkin/pages/result/index](/Users/rijay/Documents/Root/root_seven_day_checkin/miniprogram/subpkg/checkin/pages/result/index.wxml)
- 我的页：[pages/profile/index](/Users/rijay/Documents/Root/root_seven_day_checkin/miniprogram/pages/profile/index.wxml)
- 品牌静态资源：[static/brand](/Users/rijay/Documents/Root/root_seven_day_checkin/miniprogram/static/brand)

## 3. 全局设计 Token 拆单

### UI-0001 ROOT 品牌色替换

优先级：P0

改造目标：

- 将现有蓝色体系替换为 ROOT 品牌体系。
- 保留语义 token，不在页面里散落硬编码颜色。

建议 token：

| 语义 | 色值 | 用途 |
| --- | --- | --- |
| `--color-root-ink` | `#080806` | 主按钮、重点标题、深色品牌卡 |
| `--color-root-bg` | `#F7F4EC` | 页面背景 |
| `--color-root-surface` | `#FFFFFF` | 表单、列表、内容卡 |
| `--color-root-moss` | `#586B3F` | 选中态、辅助强调、tab active |
| `--color-root-sprout` | `#A6B77A` | 深色卡片 CTA、进度徽章 |
| `--color-root-clay` | `#B67855` | 温和提醒、运营提示 |
| `--color-root-line` | `#E8E0D0` | 分割线、卡片描边 |
| `--color-root-muted` | `#8A8172` | 次级文字 |

涉及文件：

- [app.wxss](/Users/rijay/Documents/Root/root_seven_day_checkin/miniprogram/app.wxss)
- [app.json](/Users/rijay/Documents/Root/root_seven_day_checkin/miniprogram/app.json)

验收标准：

- 小程序主色不再显示原蓝色 `#5B8DBF`。
- 全局导航背景为暖白，文字为黑色。
- tabBar active 色使用 `#586B3F`。
- 正文对比度满足正常阅读，不使用浅灰承载主信息。

### UI-0002 品牌资产整理

优先级：P0

改造目标：

- 从 `ROOT LOGO.pdf` 生成小程序可用横版 logo。
- 保留现有 `static/brand/logo.png` 的兼容使用，但新增横版品牌资产，避免方形 logo 在首屏和深色卡片里比例失真。

建议新增：

- `miniprogram/static/brand/root-logo-horizontal.png`
- `miniprogram/static/brand/root-logo-horizontal-dark.png` 如深色底需要反白版本，则单独生成

涉及文件：

- [static/brand](/Users/rijay/Documents/Root/root_seven_day_checkin/miniprogram/static/brand)
- 使用该资产的页面 WXML

验收标准：

- 登录页、结果页、我的页品牌露出使用横版 ROOT logo。
- logo 不被拉伸、裁切、改色。
- 深色背景上 logo 可读，不低对比。

### UI-0003 全局基础样式 Module

优先级：P0

改造目标：

- 在 `app.wxss` 中沉淀可复用 UI Module，避免每个页面重复定义近似样式。

建议新增或重写：

- `.root-page`
- `.root-nav-safe-space`
- `.root-card`
- `.root-card--dark`
- `.root-button`
- `.root-button--secondary`
- `.root-cell-group`
- `.root-cell`
- `.root-section-title`
- `.root-helper-text`
- `.root-brand-logo`

验收标准：

- 主按钮视觉统一：高度不低于 `88rpx`，圆角约 `24rpx`，主色墨黑。
- 卡片描边统一使用 `--color-root-line`。
- 表单行高度不低于 `96rpx`。
- 页面底部内容不被 tabBar 或安全区遮挡。

## 4. 页面拆单

### UI-1001 登录/欢迎态品牌化

优先级：P0

对应 Ardot：`4:3`

现有落点：

- 首页内登录态：[pages/home/index.wxml](/Users/rijay/Documents/Root/root_seven_day_checkin/miniprogram/pages/home/index.wxml)
- 独立登录页：[pages/login/index.wxml](/Users/rijay/Documents/Root/root_seven_day_checkin/miniprogram/pages/login/index.wxml)

改造内容：

- 用横版 ROOT logo 替换大面积 splash 图主导的视觉。
- 首屏标题改为“身体，自有其序”。
- 说明文案改为“Root 希望你不只是服用补剂，而是在 7 天里重新建立与身体的关系。”
- 权益说明改成三行品牌承诺：
  - 记录服用、排便和真实感受
  - 不追求完美答案，只关注身体反馈
  - 异常状态可进入人工协助
- 主按钮文案改为“微信授权并开始”。

微信规范护栏：

- 授权前必须有清晰说明，不用夸大功效。
- 授权按钮必须是页面唯一主 CTA。
- 协议与隐私入口保持可见。

验收标准：

- 首屏一眼能识别 ROOT 品牌。
- 没有“神奇功效”“立竿见影”等承诺型表达。
- 登录态不出现多个同权重 CTA。

### UI-1002 首页打卡状态重构

优先级：P0

对应 Ardot：`4:4`

现有落点：

- [pages/home/index.wxml](/Users/rijay/Documents/Root/root_seven_day_checkin/miniprogram/pages/home/index.wxml)
- [pages/home/index.wxss](/Users/rijay/Documents/Root/root_seven_day_checkin/miniprogram/pages/home/index.wxss)

改造内容：

- 当前 `checkin` 视图的圆形打卡入口改为深色 ROOT 状态卡。
- 状态卡展示：
  - `Day {{session.currentDayIndex}} / 7`
  - “身体秩序恢复中”
  - “今天记录服用、排便与身体反馈，约 1 分钟。”
  - `{{completedDays}}/7` 或可由 progress 计算得到的进度徽章
  - “开始今日打卡”主 CTA
- 今日观察卡展示三条轻信息：
  - 服用状态
  - 排便/便型状态
  - 人工协助入口提示
- Day6 复购礼保留，但不进入首屏主任务区，可置于下一屏或完成后提示。

微信规范护栏：

- 首页主任务只能是“开始/查看今日打卡”。
- 复购礼、免单、人工协助不能抢主按钮层级。
- 加载、人工确认、问卷提示等状态继续保持明确分支。

验收标准：

- `viewType === 'checkin'` 首屏主 CTA 明确。
- `manualReview` 和 `questionnairePrompt` 状态不被品牌卡样式破坏。
- Day6 coupon 仍可访问，但不压过打卡 CTA。

### UI-1003 今日打卡表单改造

优先级：P0

对应 Ardot：`4:5`

现有落点：

- [subpkg/checkin/pages/today/index.wxml](/Users/rijay/Documents/Root/root_seven_day_checkin/miniprogram/subpkg/checkin/pages/today/index.wxml)
- [subpkg/checkin/pages/today/index.wxss](/Users/rijay/Documents/Root/root_seven_day_checkin/miniprogram/subpkg/checkin/pages/today/index.wxss)

改造内容：

- 将当前多张问题卡改成微信 Cell 式纵向表单。
- 顶部提示卡：
  - 标题：“今天，和身体对一次话”
  - 描述：“无需完美，真实记录即可。”
- 表单行：
  - 今日是否服用 ROOT
  - 昨日是否排便
  - 昨日便型
  - 身体感受
  - 图片反馈
- 主按钮：“保存今日记录”。
- 底部 helper：“如出现不适，提交后可直接联系人工协助。”

数据与交互说明：

- 第一阶段可以只改视觉结构，不改变 `tookProduct`、`hadStool`、`stoolType`、`feedback`、`imageUrls` 的数据逻辑。
- 若便型选择仍需单独页，当前页行点击进入便型页；若保持内嵌选择，则需要视觉上贴近 `4:6` 的列表样式。

微信规范护栏：

- 表单字段有明确 label，不能只靠 placeholder。
- 主按钮 disabled 态要清楚。
- 图片上传是次级动作，不能比提交按钮更强。

验收标准：

- 表单一屏可读，不需要用户先理解复杂卡片网格。
- 未填写必填项时，按钮 disabled 或错误提示明确。
- 触控区域不低于 `88rpx`。

### UI-1004 便型记录页品牌化

优先级：P1

对应 Ardot：`4:6`

现有落点：

- 可能继续在 [subpkg/checkin/pages/today/index.wxml](/Users/rijay/Documents/Root/root_seven_day_checkin/miniprogram/subpkg/checkin/pages/today/index.wxml) 内实现
- 或新增/复用便型选择子页

改造内容：

- 将便型从 2 列图片卡改成 7 行列表。
- 保留布里斯托分类文字，图片作为可选辅助，不作为主视觉。
- 选中态使用苔绿文字或左侧细标记，不使用强烈大色块。
- 页面标题：“记录身体给出的信号”。

微信规范护栏：

- 选择项要可快速扫读。
- 选中态不能只依赖颜色，建议补充“已选择”文字。
- 列表项点击区域不低于 `88rpx`。

验收标准：

- 七个便型在手机宽度下无横向滚动。
- 当前选中项可被文字识别。
- 返回今日表单后便型值正确带回。

### UI-1005 打卡结果页改造

优先级：P1

对应 Ardot：`4:7`

现有落点：

- [subpkg/checkin/pages/result/index.wxml](/Users/rijay/Documents/Root/root_seven_day_checkin/miniprogram/subpkg/checkin/pages/result/index.wxml)
- [subpkg/checkin/pages/result/index.wxss](/Users/rijay/Documents/Root/root_seven_day_checkin/miniprogram/subpkg/checkin/pages/result/index.wxss)

改造内容：

- 用 ROOT logo 和“秩序已记录”替代当前 medal 大图主视觉。
- 文案：
  - “今日记录已保存。明天继续与身体合作。”
- 总结卡改成三行：
  - 已完成天数
  - 连续状态
  - 免单资格
- 主按钮：“查看 7 天进度”。
- 次级动作：“返回首页”。

微信规范护栏：

- 成功结果不打断用户太久，但要给清楚下一步。
- 申请免单不应在每日提交后过早成为主 CTA；只在 Day8 资格完成后进入主路径。

验收标准：

- Day1-Day6 每日结果页不误导用户立即申请免单。
- Day7/Day8 完成态仍能进入问卷/免单路径。
- failed 状态保留人工协助表达。

### UI-1006 我的页品牌化

优先级：P1

对应 Ardot：`4:8`

现有落点：

- [pages/profile/index.wxml](/Users/rijay/Documents/Root/root_seven_day_checkin/miniprogram/pages/profile/index.wxml)
- [pages/profile/index.wxss](/Users/rijay/Documents/Root/root_seven_day_checkin/miniprogram/pages/profile/index.wxss)

改造内容：

- 顶部用户卡改为深色 ROOT 品牌卡。
- 展示横版 logo、用户昵称、当前 Day 状态、`3/7` 进度徽章。
- 中部品牌文案：“真正的健康，是安稳与清晰重新出现。”
- 菜单项调整：
  - 我的打卡记录
  - 身体反馈画像
  - 订单与物流
  - 人工协助
  - 关于 ROOT

微信规范护栏：

- 客服仍使用 `open-type="contact"`。
- 退出登录不能与普通菜单混在同一个高频菜单组里。
- 菜单行使用清晰箭头和足够点击高度。

验收标准：

- 我的页不再像后台状态页，而像 ROOT 用户中心。
- 运营/客服入口清楚但不恐吓用户。
- 登录缺失状态仍可读。

## 5. 次级页面一致性拆单

### UI-2001 历史记录页一致性

优先级：P2

落点：

- [subpkg/checkin/pages/history/index.wxml](/Users/rijay/Documents/Root/root_seven_day_checkin/miniprogram/subpkg/checkin/pages/history/index.wxml)

改造目标：

- 使用 ROOT 卡片、暖白背景和苔绿状态。
- 记录详情保留真实反馈，不美化成“成绩单”。

### UI-2002 问卷页一致性

优先级：P2

落点：

- [subpkg/checkin/pages/questionnaire/index.wxml](/Users/rijay/Documents/Root/root_seven_day_checkin/miniprogram/subpkg/checkin/pages/questionnaire/index.wxml)

改造目标：

- Day4/Day8 问卷也使用品牌化表单样式。
- 保留问卷版本、必填校验和提交反馈。

### UI-2003 订单、客服、关于页一致性

优先级：P2

落点：

- [subpkg/profile/pages/orders/index.wxml](/Users/rijay/Documents/Root/root_seven_day_checkin/miniprogram/subpkg/profile/pages/orders/index.wxml)
- [subpkg/profile/pages/support/index.wxml](/Users/rijay/Documents/Root/root_seven_day_checkin/miniprogram/subpkg/profile/pages/support/index.wxml)
- [subpkg/profile/pages/about/index.wxml](/Users/rijay/Documents/Root/root_seven_day_checkin/miniprogram/subpkg/profile/pages/about/index.wxml)

改造目标：

- 把功能页从“工具页”统一到 ROOT 品牌语气。
- 关于页优先承接 DOCX 品牌文案，但保持移动端短段落。

## 6. 资产与配置拆单

### UI-3001 tabBar 资源重绘

优先级：P1

现状：

- `app.json` tabBar active 色仍是原蓝色。
- `static/tabbar/*` 需要与 ROOT 苔绿主色统一。

改造目标：

- `selectedColor` 改为 `#586B3F`。
- tab 图标统一线性或实心风格，不混用。
- 不使用 emoji 或低清 PNG。

### UI-3002 splash/banner 资产降级使用

优先级：P2

现状：

- 首页登录态使用 `static/brand/splash.png` 大图。

改造目标：

- v3 中首屏应以 logo 和文案为主，大图只能作为次级背景或活动页素材。
- 减少首屏加载图像体积和视觉压迫。

## 7. 开发批次建议

### Batch A：品牌底座

包含：

- `UI-0001`
- `UI-0002`
- `UI-0003`
- `UI-3001`

验收：

- 全局主色、按钮、卡片、tabBar 全部切到 ROOT 体系。
- 旧蓝色视觉基本消失。
- 不改变业务数据逻辑。

### Batch B：主流程首屏

包含：

- `UI-1001`
- `UI-1002`

验收：

- 登录态和首页 checkin 态接近 Ardot `4:3`、`4:4`。
- 人工确认、问卷提示、已完成/失败状态仍可访问。
- 首页主任务清晰。

### Batch C：打卡提交链路

包含：

- `UI-1003`
- `UI-1004`
- `UI-1005`

验收：

- 今日打卡、便型选择、提交结果形成一条统一的 ROOT 品牌体验。
- 提交逻辑、校验逻辑、图片选择逻辑不回退。
- Day4/Day8 触发逻辑不被 UI 改造破坏。

### Batch D：我的与次级页

包含：

- `UI-1006`
- `UI-2001`
- `UI-2002`
- `UI-2003`
- `UI-3002`

验收：

- 我的页、历史、问卷、订单、客服、关于形成统一视觉。
- 关于页承接品牌文案。
- 退出、客服、订单路径都保持可用。

## 8. 验收清单

### 视觉验收

- 375px 手机宽度无横向滚动。
- 页面主要文本不溢出，不遮挡胶囊菜单和 tabBar。
- 主按钮高度不低于 `88rpx`，点击区域不小于微信移动端常用触控要求。
- 深色卡片文字对比足够，不使用低对比浅灰。
- ROOT logo 使用正确比例。

### 微信规范验收

- 每个页面只有一个明确主任务。
- 授权、提交、结果、异常都有清晰反馈。
- 表单有 label，错误有恢复路径。
- 重要路径有返回或可退路。
- 客服和人工协助入口存在，但不抢主流程。

### 业务回归验收

- 登录与手机号授权可用。
- 订单匹配状态不变。
- 物流未送达不能启动 Day1。
- Day1-Day7 打卡提交正常。
- Day4/Day8 问卷触发正常。
- Day6 复购礼展示、领取、跳转不回退。
- 断卡失败和人工协助状态可见。
- 免单申请仍只在资格满足后进入。

## 9. 暂不纳入本轮

- 不重写后端 Interface。
- 不改变打卡规则、断卡规则、退款资格规则。
- 不新增运营后台能力。
- 不做复杂动效或高成本插画。
- 不引入新的 UI 库。
