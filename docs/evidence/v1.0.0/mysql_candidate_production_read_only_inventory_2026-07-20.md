# myRoot v1.0.0 Candidate / 生产 MySQL 只读清点

日期：2026-07-20  
执行性质：只读  
环境：`myroot-prod-d5gl3gzg7115f149a`（`myroot-prod`，`ap-shanghai`）

## 1. 来源与限制

实际读取：

1. CloudBase CLI `env list/detail`。
2. Tencent Cloud TCB 只读动作 `DescribeCloudBaseRunServers`、`DescribeCloudBaseRunServer`、`DescribeCloudBaseRunServerVersion`。
3. CloudBase CLI `db instance list/config get`、`db backup list`。
4. CloudBase CLI `db execute --read-only` 执行固定 `SELECT` / `SHOW GLOBAL STATUS`。
5. 公开 `/health` 与 `/ready`。

没有执行部署、切流、环境变量修改、数据库写入、账号/权限修改、备份创建或恢复。

缺口：

1. 当前没有独立 Candidate 环境、Candidate MySQL 或 Candidate schema。
2. CloudRun 版本清单把所有版本的 `FlowRatio` 报告为 `0`，公开响应又不返回 revision identity；因此无法只凭这些接口确认无参数公开请求最终命中的 revision。
3. 本机到 MySQL 私网地址的只读直连在握手阶段中断；数据库实证改由 `tcb db execute --read-only` 完成。
4. 已存在备份，但没有恢复演练证据。
5. 后续读取 revision 详情时，平台返回体包含完整 `EnvParams` 并进入本次工具输出。秘密值未写入本文或仓库，但数据库、后台、微信与 CloudBase 凭据必须按已暴露处理。后续清点停止调用该详情动作，轮换完成前禁止传播原始工具输出。

## 2. CloudBase / CloudRun

1. 账号下只发现一个环境：`myroot-prod-d5gl3gzg7115f149a`，状态 `NORMAL`。
2. 仅发现一个 CloudRun Module：`myroot-api`。
3. 共 10 个历史 revision：`012`、`019`～`027`；其中 `020`、`021` 为 `deploy_failed`，其余为 `normal`。
4. `012` 与 `027` 各报告 1 个当前实例；所有 revision 均报告 `FlowRatio=0`。
5. `027`：1 CPU、2 GiB、最小 1 实例、最大 2 实例；`MYSQL_CONNECTION_LIMIT=8`。
6. `027` 未配置以下 v1 MySQL 变量：
   - `ROOT_MYSQL_MIGRATION_MODE`
   - `MYROOT_V1_RUNTIME_CONNECTION_LIMIT`
   - `MYROOT_V1_RUNTIME_HEARTBEAT_CONNECTION_LIMIT`
   - Registrar / Worker / Inspector pool limit
   - `MYROOT_CLOUDRUN_MAX_INSTANCES`
   - `MYROOT_MYSQL_CONNECTION_HEADROOM`
   - `MYROOT_MYSQL_CAPACITY_EVIDENCE_REF`
7. CloudRun revision 元数据的 `VpcId` 为空；MySQL 实例本身位于私网 VPC / subnet，未启用公网入口。公开 `/ready` 证明当前 CloudRun 到 MySQL 的平台内连接有效。

## 3. MySQL 实证

平台资源：

- 类型：MySQL 8.0 Serverless（CynosDB）。
- 实际版本：`8.0.30-cynos-3.1.16.006`。
- 状态：`running`，Serverless 状态 `resume`。
- CCU：最小 `0.25`，最大 `1`。
- 公网入口：未开启。

只读 SQL：

| 项目 | 结果 |
|---|---:|
| `max_connections` | 1000 |
| `Threads_connected` | 6 |
| `Threads_running` | 1 |
| `Max_used_connections` | 17 |
| `Connection_errors_max_connections` | 0 |
| `Uptime` | 778578 秒 |
| 表数量 | 26 |
| 列数量 | 310 |
| 已登记迁移 | 5 |
| 最新迁移 | `005_notification_subscription_grants.sql` |
| 本地目标迁移 | 66 |
| 下一迁移 | `006_command_event_foundation.sql` |

迁移 `001`～`005` 的顺序和 checksum 与当前仓库 manifest 一致。生产缺少 `006`～`066`，因此 `migrationSetReady=false`。

B 方案只读冲突核对：

- `root_checkin_candidate_v1` schema 冲突数：`0`。
- `myroot_cand_app`、`myroot_cand_definer`、`myroot_cand_registrar`、`myroot_cand_worker`、`myroot_cand_inspector` 账号冲突数：`0`。
- 当前生产运行账号 Host 为 `%`，认证插件为 `mysql_native_password`，未锁定。
- 当前生产运行账号除四项 DML 外仍持有目标生产 schema 的 `CREATE, ALTER`；它不满足 v1 最小权限，但本轮未修改。
- 当前生产 schema 默认字符集为 `utf8mb3`、排序规则为 `utf8mb3_general_ci`；B 方案 Candidate schema 应显式使用 `utf8mb4 / utf8mb4_unicode_ci`。

数据库及 SQL 执行 principal 仅以 SHA-256 不透明引用保留：

- database ref：`sha256:91311e1f209f07e93f7ab02cfa2c199bd000eabca88fd900be8255f7a0b4ffd9`
- executor principal ref：`sha256:188730229fcaf1eb494d829fc44ae2e3c7b0e6726d5de4912766c545f8ba4bdd`

## 4. 备份

1. 共读取到 9 份可用备份，状态均为 `success` / `done`。
2. 最新自动增量快照：2026-07-19 17:34:18。
3. 最近自动全量快照：2026-07-16 14:44:58。
4. 2026-07-11 存在发布前手工全量快照、迁移后逻辑备份和迁移后集群快照。
5. 没有 v1.0.0 迁移前快照，也没有恢复演练结果；现有备份不能直接作为本次变更的已验证回滚点。

## 5. 容量判断

旧 revision 的主 pool 上限为每实例 8，CloudRun 最多 2 实例，即旧主 pool 理论上限 16；数据库上限 1000，历史峰值 17，当前没有连接上限压力。

但 v1.0.0 会新增 Orchestration、heartbeat、Registrar、Worker、Inspector 等独立 pool。生产 revision 未配置这些变量，也没有对应 Candidate 负载实证，因此：

- 当前容量基础：充足；
- v1 Candidate 容量 Gate：`OPEN`；
- 不得把旧 revision 的 16 连接预算写成 v1 多 pool 容量证明。

## 6. 结论与推荐结构

当前不存在可安全承载 61 个新增迁移的独立 Candidate。若直接让 0% Candidate 使用现有 schema，迁移仍会立即修改生产数据库；0% 只隔离流量，不隔离 DDL。

推荐顺序：

1. 创建独立 Candidate 环境与独立 MySQL，完成 `001`～`066`、恢复演练、容量和跨实例验证。
2. 若成本限制不能创建独立环境，次选为同一集群的独立 Candidate schema + 独立账号；它隔离数据/DDL，但不隔离数据库容量与集群故障。
3. 不采用现有生产 schema 直接作为首次 Candidate 迁移目标。
4. Candidate 通过后，为生产创建本次迁移前全量快照，执行 `006`～`066`，部署 `verify_only` revision，再收敛运行时账号权限。

当前 Gate：

- Candidate 隔离：`BLOCKED`（目标不存在）。
- 生产迁移：`BLOCKED`（5/66、无本次恢复点、无 Candidate 实证）。
- 当前生产可用性：`PASS`（公开 `/ready` 连接正常，但只代表旧版本）。
- 凭据轮换：`BLOCKED`（revision 详情返回体造成秘密暴露，尚未轮换）。
