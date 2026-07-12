# myRoot v0.5.5 发布说明

发布日期：待正式发布确认

## 本版范围

- 根项目、后端与小程序版本统一为 `0.5.5`。
- 新增健康敏感数据保存期限清理 Module，按配置天数识别过期的身体画像、问卷答案、打卡反馈、图片引用和本地派生的运营自由文本副本。
- 清理默认 dry-run；execute 必须显式开启 `ROOT_HEALTH_DATA_RETENTION_CLEANUP_ENABLED` 并提供稳定 `request_id`。
- 保留任务完成、活动结算、奖励和同意审计事实，只脱敏原始健康内容。
- CloudBase 图片按“先删对象、后删引用”执行；共享对象不误删，重复 `fileID` 只删除一次，删除失败时仅保留失败引用重试。
- 对象部分失败时立即脱敏同条记录中的健康原文，不保留已删除对象的失效引用。
- 新增聚合审计、命令行 Runner、Job Interface、CloudBase Manifest 和定时触发器配置，审计不记录健康原文或图片 `fileID`。
- Production Env Matrix 将自动清理开关纳入隐私合规 Gate。

## 验证状态

- 健康数据清理新增 6 组专项测试，覆盖配置失败关闭、dry-run 零写入、共享与重复引用、部分失败重试、派生文本脱敏、HTTP 幂等和命令行报告退出码。
- 受影响的隐私、HTTP、Manifest、CloudBase dispatcher、运行版本与灰度验证测试共 76 项通过。
- 完整 `npm run verify` 已通过 `11/11`：199 个 JavaScript 文件语法、CloudBase 配置敏感键扫描、10 个 Job Manifest、Production Env Matrix、全量后端测试、生产依赖审计、Element Plus Admin、小程序与 HTTP Interface smoke 全部通过。
- CloudBase 候选版和第 10 个触发器尚未部署；部署后仍需单独复测运行版本、Store、对象清理 dry-run 和自动触发日志。

## 当前部署状态

- CloudBase 环境：`myroot-prod-d5gl3gzg7115f149a`
- 稳定版仍为：`myroot-api-012 / 100%`
- 现有候选仍为：`myroot-api-019 / 0% / v0.5.4`
- `v0.5.5` 尚未部署，建议部署为下一候选版本，不覆盖 `019`，也不修改当前流量。
- 线上 Cloud Function 当前仍为已验证的 9 个触发器；仓库目标为 10 个，第 10 个清理触发器尚未部署。

## 发布前仍需完成

1. 业务负责人确认个人信息处理者法定名称、有效联系方式和健康数据保存天数。
2. 部署 `v0.5.5` 候选，并在 0% 流量下完成版本归因或经批准的小流量灰度。
3. 配置隐私变量后先执行保留期清理 dry-run，核对候选数量、共享对象和外部 HTTPS 引用均符合预期。
4. 经明确确认后部署 Cloud Function 第 10 个触发器，保持 `ROOT_JOB_DRY_RUN=true` 完成手工及自动触发验证。
5. 完成微信公众平台隐私声明、体验版真机流程、Root 会员中心跳转和真实有赞/企微/履约 Adapter 小批量校准。
