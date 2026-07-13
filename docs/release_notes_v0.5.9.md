# myRoot v0.5.9 发布说明

状态：定向真机预览验证中；`v0.5.8` 已上传体验版，`v0.5.9` 尚未上传；本轮未部署后端或修改 CloudBase 流量

## 1. 本版目标

为 `myroot-api-024 / 0% URL_PARAMS` 条件候选提供不落盘的真机定向测试入口，避免默认流量仍由旧 `012` 承接时误判新后端 Interface 不存在。

## 2. 代码变更

1. 新增 Cloud Route Module，只在 `develop` 或 `trial` 环境读取启动参数中的固定 `myroot_canary` 键。
2. 路由值只保存在当前小程序进程内，不进入仓库、本地存储、请求日志或错误提示。
3. Cloud Container 请求在符合白名单格式时附加条件路由；`release` 环境强制忽略该参数。
4. 新增 8 个回归场景，覆盖无参数、已有查询参数、重复键、非法值和正式环境隔离。
5. 小程序版本提升为 `0.5.9`；本版不要求后端重新部署。

## 3. 回滚

删除定向测试入口并恢复 `v0.5.8` 小程序包即可；CloudBase `012/024` 发布单和数据库不受影响。

## 4. 2026-07-13 真机证据

1. 微信开发者工具编译条件为 `024 定向真机验证`，入口为 `pages/home/index`；定向参数仅存在于被 Git 忽略的私有项目配置，Git 跟踪文件泄漏数为 0。
2. 首轮定向预览构建成功，总包体约 465.8 KB；预览码 SHA-256 `f5d2f027f93cb405ee00ad3db4500e28a4c5d57eaca055ef0ad0edc2afd2b5ca`，现已被包含加入活动提醒修复的第二轮预览替代。
3. 真机由用户确认：登录、微信隐私授权、健康信息单独同意均完成，点击确认后不再出现“接口不存在”；身体画像 4/4 提交成功，进入标题为“Root7日身体重启计划”的活动首页，页面状态正常。
4. 第二轮定向预览中，用户成功加入计划且参与状态正常，但微信订阅授权未出现。首轮修正删除了应用侧按模板版本永久缓存授权决定的短路，让微信原生设置成为持久授权的唯一判断；本机微信开发者工具随附 `lib.wx.api.d.ts` 表明，该 Interface 属于一次性订阅，只有勾选“总是保持以上选择”时才进入 `SubscriptionsSetting.itemSettings`。
5. 第三轮定向预览码 SHA-256 为 `1f4f8d339051a739c1987d400bce8ae75c7416087dbb71f79aae5c7a290e2061`。真机完成首次打卡提交后未出现订阅弹层，未看清提醒 Toast，但正常进入任务进度页。
6. CloudBase CLI `--read-only` 回读确认：最新 `notification_subscription` 为 `UNKNOWN / subscribed=0 / trigger=CHECKIN_SUBMIT`，更新时间 `2026-07-13 13:19:58`；对应次日任务为 `SCHEDULED / reminder_date=2026-07-14 / attempts=0`。因此“提交成功并跳转”不能作为订阅通过证据，当前任务也不会在未授权状态下发送。
7. 最终根因是原流程先等待加入或打卡提交、再请求模板，最后才调用 `wx.requestSubscribeMessage`，原生调用已经脱离用户点击手势；提醒 Toast 又立即被“已记录”和页面跳转覆盖。
8. Campaign Join Module 现只负责幂等加入；Check-in Reminder Module 在页面展示阶段预载模板，并在独立“开启明日提醒”按钮的点击处理里先调用微信原生 Interface，再异步记录标准化结果。任务页和进度页都提供可重复操作及常驻状态，打卡成功也改为在进度页常驻展示。
9. Campaign Join 行为回归 2/2、订阅行为回归 5/5，完整小程序检查通过。第四轮定向预览构建成功，总包体约 473.4 KB，预览码 SHA-256 `923d03306c82e1ebdc43b1e7a604f67116acbd36129fa8d78240a16f63905497`。
10. 第四轮真机点击独立按钮后，页面常驻状态显示“已开启”。CloudBase CLI `--read-only` 回读为 `ACCEPTED / subscribed=1 / trigger=CAMPAIGN_JOIN`，更新时间 `2026-07-13 13:52:05`；对应提醒任务仍为 `SCHEDULED`，计划 `2026-07-14 09:00` 执行，`attempts=0` 且无错误。订阅授权 Gate 通过，实际消息送达仍待执行后验证。
11. 对抗式回读发现该任务为 `miniprogram_state=formal / lang=zh_CN`。这符合正式发布目标，但不能作为本次定向预览的 `trial` 跳转证明；在另建 `trial` 验证任务或明确调整配置前，不关闭实际送达与跳转 Gate。
12. 使用 `2026-07-14 09:01 +08:00` 作为模拟当前时间调用 024 候选提醒 Job Interface，得到 `HTTP 200 / code=0 / dryRun=true / scannedCount=1 / DRY_RUN_READY=1`。脱敏请求形状确认 myRoot openid 和模板均存在，页面为 `pages/tasks/index`，字段为 `thing1/thing2/thing3`，未输出任何标识值；未来时刻 dry-run Gate 通过。
13. 本次证据不代表体验版或正式版已切换到 `024`；`012` 继续承接默认流量。
14. 经行动时确认，使用稳定请求 ID `checkin-reminders-formal-proof-20260713-r1` 对 024 候选执行一次正式目标发送。Job Interface 返回 `HTTP 200 / code=0 / dryRun=false / scannedCount=1`，但任务结果为 `FAILED / errorCode=1006`；未重试。
15. SQL 只读回读为任务 `FAILED / attempts=1 / sent_at=null`，送达记录 `FAILED / delivered_at=null`。订阅仍为 `ACCEPTED / subscribed=1`，本次没有实际送达证据，原请求 ID 已停用，不得复用。
16. 后续只读探针确认候选 AppID 正确、AppSecret 非空且可成功获取 7200 秒微信 access token；微信模板清单中仅有目标“活动提醒”，模板 ID 和 `thing3/thing2/thing1` 均精确匹配，生产请求 3 个字段分别为 13/7/14 字，未超过 20 字限制。云托管日志服务未启用，现有 Implementation 又把微信原始 `errmsg` 覆盖为统一 `1006`，因此本次具体微信错误无法回溯。
17. 本地已修复失败证据记录，改为同时保留稳定错误码和脱敏微信说明；针对性测试 4/4、后端全量 244/244、小程序检查全部通过。该修复尚未版本化、提交或部署，任何 `r2` 重试必须先部署新候选并再次取得行动时确认。
18. 根仓库完整验收为 14/15；唯一失败是版本对齐 Gate：小程序为 `0.5.9`，其余可部署包仍为 `0.5.7`。该偏差是当前定向预览状态的真实反映，下一候选必须统一升版后重新取得 15/15，不以临时改版本掩盖。
