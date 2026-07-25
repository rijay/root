# myRoot v1.0.0 migrations 001–065 本机一次性 MySQL 授权执行包

状态：`PREPARED_NOT_AUTHORIZED_NOT_EXECUTED`

机器可读冻结输入：`mysql_001_065_local_authorization_packet_2026-07-19.json`，SHA-256=`85a3fe25b73799be52bb5ccf983cb122acc218bfa3d174094a580c9e1428bd6e`。JSON 同时冻结每个真实引擎测试文件的 SHA-256；任一测试字节变化都必须重新生成本包并重新申请授权。

本包不构成授权。它只描述下一次获得明确单次授权后，如何在随机 `127.0.0.1` 临时端口和 disposable database 上证明迁移与权限；不连接 Candidate/生产，不授权提交、推送、部署或外部发送。

## 冻结输入

- 运行包版本：`0.5.13`。
- migration：001 至 `065_v1_runtime_alert_registration_return_row.sql`，共 65 个。
- migration-set digest：`68eccf21a90de28059e0b553799a8d4200feee64bbbd67746ade174cfb70467e`。
- MySQL 镜像：`mysql:8.0.43@sha256:3e646bcda0d9448ffa3d2024eef04e1bca95528ec19b9e8b76749da9d97d4a10`。
- 六组真实引擎测试的单一入口：`npm run v1:mysql-001-065-authorized:check`；未显式设置六个 enable variable 时只能得到 6 guard PASS / 6 engine SKIP，不得解释为实证。
- 容器、数据库、密码、主体和端口均一次性随机生成；运行后全部删除。

## 必须证明的顺序

1. 创建空 disposable database 与四个不同主体：DEFINER、REGISTRAR、WORKER、INSPECTOR。
2. 仅临时授予 DEFINER migration 权限，并以该主体执行 001～065。
3. 撤销 DEFINER 的 migration 权限，仅授予 22 个 routine `EXECUTE` 与 routine Implementation 所需的精确基表权限，然后 `ACCOUNT LOCK`。
4. 授予运行主体精确权限：Registrar 仅一个固定模式注册 routine；Worker 仅工作 routine 和必要只读事实；Inspector 仅聚合 inspect routine。
5. 回读 `SHOW GRANTS`、`mysql.user.account_locked`、`SHOW CREATE PROCEDURE` 与每个 pool 的 `CURRENT_USER()`。
6. 正向证明允许的 procedure 调用；负向证明所有运行主体的直接 DML/DDL、跨角色 procedure 与额外 schema 访问被拒。
7. 执行通知 fencing、Runtime Alert、Control Ledger、Settlement authority 的真实并发、ACK-unknown 与回滚测试。
8. 生成 001～065 schema snapshot，并在第二个随机数据库独立 verify。
9. 运行最终验证，目标为 `18/18 PASS`。
10. 无论成功失败，删除所有临时主体、数据库、容器和监听；清理失败即本次实证失败。

## 关键裁决

- MySQL 8.0 的 `ALTER PROCEDURE` 不能修改 `DEFINER`，因此不采用“迁移后重新绑定 definer”的无效步骤。
- migration 必须一开始就由未来的专用 DEFINER 主体执行；发布后将其收敛为锁定、最小权限账号。
- Registrar 不拥有任何 alert delivery、cycle 或 alert 基表权限；065 的注册 routine 直接返回唯一持久化业务行。
- 本机真实引擎 PASS 只能推进本地 schema/principal 证据，不能关闭 Candidate、生产、容量、真实告警或微信送达 Gate。

## 当前验证状态

- Runtime Alert：139 PASS、1 real-engine SKIP、0 FAIL。
- Runtime Principal：52 PASS、1 real-engine SKIP、0 FAIL；包含 Store、`/ready` 与 Candidate canary 的安全聚合 readiness/fail-close 回归。
- Runtime Control：71/71 PASS。
- Backend：1231 PASS、8 SKIP、0 FAIL，共 1239 tests。
- 最终验证：17/18 PASS；唯一失败是 `schema.sql` 仍为 001～057 的历史引擎快照。

执行前必须再次核对 JSON digest、当前 migration-set digest、工作树状态和本次明确授权文字。旧的 001～063 包已标记为 `SUPERSEDED`，不得复用。
