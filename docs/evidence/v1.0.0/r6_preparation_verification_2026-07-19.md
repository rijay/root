# R6 本地准备验证

截至 2026-07-19 21:59 +08:00，R6 冻结包已准备，但未授权、未执行。

- R6 JSON SHA-256：`58f04a58a10c50acd7942bfe94a901416ccde49625079685b219b09e93cb0b83`
- 单次 nonce：`91a87317-7cf5-4eeb-ade7-47e684a8bb7b`
- 状态：`R6_PREPARED_NOT_AUTHORIZED_LOCAL_CONTRACTS_PASS_FORMAL_GATES_OPEN`

## 已完成的本地修复与验证

- Attempt 5 的两个 `information_schema` 字段标签问题已在查询 Interface 和读取归一化处修复。
- MIGRATOR 精确 schema 权限已补入迁移实际需要的 `CREATE TEMPORARY TABLES`；运行期权限收敛与 definer 锁定保持不变。
- 既有 migration 001～065 未修改，checksum 全部保持通过。
- 根因定向检查：23 PASS / 3 默认关闭真实引擎 SKIP / 0 FAIL。
- Runner 与 R6 授权包合同：26/26 PASS。
- Backend：1287 tests，1278 PASS / 9 默认关闭真实引擎 SKIP / 0 FAIL。
- Foundation：PASS。
- Final verification：17/18；唯一失败仍是 committed `schema.sql` 只到 057，而 migration-set 已到 065。
- 未授权调用 R6 runner 返回 `MYSQL_LOCAL_RUNNER_NOT_AUTHORIZED`，退出码 1；Docker 未启动，R6 nonce 未消费。

## Gate 结论

R6 仅证明修复后的本地字节和执行合同已冻结。本证据不关闭本地 engine/schema proof，也不关闭 Candidate、生产、容量、真实送达或正式上线 Gate。任何 R6 真实引擎执行仍需新的单次明确授权。
