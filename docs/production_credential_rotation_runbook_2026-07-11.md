# myRoot 生产凭据轮换 Runbook

日期：2026-07-11

## 原则

- 所有新凭据只进入 CloudBase 环境变量、Cloud Function 配置或密码管理器，不写入仓库、命令历史和证据包。
- 每类凭据独立切换并完成健康验证后，再处理下一类。
- 除微信 AppSecret 外，全部采用“新旧并行、调用方切换、移除旧值”的顺序。
- 旧凭据在观察窗口结束前保留为回滚路径，但不得继续分发。
- 任何验证失败都停止后续轮换，不同时变更多类凭据。

## 1. Admin Token

当前后端已支持 `ROOT_ADMIN_TOKENS` 多角色配置，并以常量时间方式比较 token。

1. 在安全终端生成新 token，不把输出写入日志。
2. 配置 `ROOT_ADMIN_TOKENS`，同时包含旧 Admin token 与新 Admin token；旧 `ROOT_ADMIN_TOKEN` 暂时保留。
3. 部署 0% 候选版，分别验证新旧 token 均可读取 `/api/v1/admin/me`，错误 token 返回 401。
4. 把 Element Plus Admin 和运营使用方切换到新 token。
5. 观察无旧 token 请求后，移除旧 token，并把 `ROOT_ADMIN_TOKEN` 更新为新值或只保留角色化集合。
6. 重新生成脱敏发布证据包，确认 token 值未出现。

回滚：在观察窗口内恢复旧 token 配置；不得把旧值写回仓库。

## 2. CloudBase Job Token

候选版 `myroot-api-017` 已支持 `ROOT_ADMIN_JOB_TOKENS` JSON 集合，同时兼容单个 `ROOT_ADMIN_JOB_TOKEN`。Cloud Function 仍使用一个主动 token。

1. 在云托管中配置 `ROOT_ADMIN_JOB_TOKENS=[旧值,新值]`，单值仍保持旧 token。
2. 灰度验证 `017` 后，分别用旧、新 token dry-run 一个 Job；两个 token 访问 `/api/v1/admin/me` 都必须返回 401。
3. 把 `myroot-job-dispatcher` 的 `ROOT_ADMIN_JOB_TOKEN` 更新为新值。
4. 手工 dry-run 所有已部署 Job，并观察至少一个自动触发周期全部成功。
5. 云托管单值切到新 token，移除集合中的旧值，再次部署与验证。
6. 观察窗口结束后销毁旧 token。

回滚：Cloud Function 切回旧 token；云托管双收窗口必须保留到回滚验证完成。

## 3. CloudBase MySQL 应用账号

当前 `myroot_app` 已有 DML、`CREATE` 和 `ALTER`，但作用域仍为 `*.*`。采用新账号切换比直接撤权更容易回滚。

2026-07-12 已完成步骤 1 至 4：`myroot_app_v2@'%'` 凭据保存于 macOS 钥匙串，最终授权仅限 `myroot-prod-d5gl3gzg7115f149a` schema 的六项必要权限；全局仅有 `USAGE`。步骤 5 起仍待 0% 候选验证，旧账号保持可用。

1. 在密码管理器中生成强随机密码；不得在聊天、终端、脚本参数、剪贴板历史或发布文档中显示该值。
2. 使用 CloudBase 控制台 SQL 型数据库的账号管理界面创建 `myroot_app_v2@'%'`，密码只输入到专用密码框。不得通过 `tcb db execute --sql "CREATE USER ... IDENTIFIED BY ..."` 创建账号，因为密码会进入进程参数和可能的命令历史。
3. 在控制台权限界面把账号限定到 schema `myroot-prod-d5gl3gzg7115f149a`，仅授予 `SELECT / INSERT / UPDATE / DELETE / CREATE / ALTER`。若控制台只能通过查询编辑器授予权限，查询中不得包含密码。
4. CLI 仅执行不含秘密的只读验证：`SHOW GRANTS FOR 'myroot_app_v2'@'%'`。结果必须是目标 schema 权限，不得出现 `*.*` 数据权限、额外 schema、`DROP`、用户管理或 `GRANT OPTION`。
5. 用新账号执行只读连接、迁移状态读取和隔离写入回滚测试。
6. 只把账号和密码写入 CloudRun 0% 候选环境变量，完成 `/ready`、登录、幂等写入和回滚验证；证据只记录账号名、权限作用域和 Gate 结果。
7. 小比例灰度后再全量切换，不删除旧账号。
8. 观察至少 24 小时且备份有效后，经独立确认再撤销并删除旧 `myroot_app`。
9. 后续再拆分只读迁移账号，使运行账号最终仅保留 `SELECT / INSERT / UPDATE / DELETE`。

回滚：云托管切回旧账号环境变量；旧账号在观察窗口结束前保持可用。

## 4. 微信 AppSecret

AppSecret 重置可能立即使旧密钥失效，因此放在其他凭据之后单独执行。

1. 选定低流量窗口并确认 myRoot AppID 为 `wx7727a02565aed1c2`。
2. 在微信公众平台重置 AppSecret，立即写入密码管理器和 CloudBase 环境变量。
3. 部署新候选版，不在聊天、截图、终端输出或文档中展示新值。
4. 通过微信开发者工具验证手机号快捷登录、`openid/unionid` 透传和订阅消息 dry-run。
5. 验证 access token 获取失败告警、登录错误率和提醒 Job。
6. 若平台不允许恢复旧 AppSecret，回滚只能修正新密钥配置，不能依赖旧值。

## 5. 有赞 Access Token

当前采用 `STATIC_ROTATION`。`client_secret` 只保存在密码管理器或受控轮换终端，不进入 CloudRun；运行容器只配置 `YOUZAN_CLIENT_ID`、`YOUZAN_GRANT_ID`、access token、到期时间与轮换负责人。

1. 唯一轮换负责人在受控终端使用 client id、client secret 与 grant id 换取新 token。
2. 先记录新 token 的准确到期时间，确认发布窗口开始时至少剩余 24 小时。
3. 在 CloudRun 0% 候选配置新 token 与到期时间，不把 client secret 写入环境变量、命令历史或发布证据。
4. 依次 dry-run 订单、客户、User Query、发券和券状态查询；只记录业务码、计数和脱敏回执。
5. 小批量校准通过后再进入灰度；旧 token 在有赞平台失效前不得被其他系统重复刷新覆盖。

回滚：候选或灰度调用失败时切回仍有效的旧 token，并保持所有有赞 execute 开关关闭；重新确认唯一轮换负责人后再换取。

## 完成证据

- Admin 新 token 验证与旧 token 停用时间。
- 全部 CloudBase Job 手工 dry-run 和自动触发日志；当前仓库目标为 11 个。
- `myroot_app_v2` schema-scoped `SHOW GRANTS` 脱敏截图或文本。
- 新账号候选版 `/ready`、幂等写入与回滚记录。
- 微信真机登录、unionid 和提醒模板验证结果。
- 有赞 token 到期时间、轮换负责人和不在 CloudRun 中保存 client secret 的变量名级证明。
- 凭据轮换完成后生成的新发布证据包留档 ID。
