# 2026-07-11 myRoot 生产回滚演练证据

## 结论

2026-07-11 已在 CloudBase 生产环境 `myroot-prod-d5gl3gzg7115f149a` 对 `myroot-api` 完成两段隔离数据回滚演练：

1. `MANUAL_SAMPLE` 合成订单导入后按 Adapter runId 回滚。
2. 同一合成订单先建立基线、再写入错误字段，回滚更新 run 后恢复基线，最后回滚基线 run 清理记录。

两段演练均只操作本次新建的合成探针记录。最终通过 CloudBase SQL 回读确认 `youzanOrders=0`、`orderFulfillments=0`，没有残留订单或履约数据。当前生产流量仍为 `myroot-api-012=100%`，`myroot-api-013=0%` 灰度。

本记录只证明研发侧数据回滚能力。运营负责人尚未在 Element Plus Admin 中实际执行人工订单、物流、券状态、线索或标签兜底并确认 SOP，因此生产切换项 `rollback_drill_completed` 继续保持未验证，不写入 `VERIFIED`。

## 演练一：新建记录回滚

| 项目 | 实测结果 |
|---|---|
| 合成订单号 | `YZ_RELEASE_ROLLBACK_1783773502394_ae409a` |
| Adapter runId | `adr_f66578e82f9da6` |
| 导入状态 | `COMPLETED` |
| 回滚目标 | 2 个 |
| 回滚状态 | `ROLLED_BACK` |
| 实际回滚 | 2 个 |
| 幂等复调 | 同一 requestId 返回同一审计记录 |
| 审计 ID | `aud_254f47572f9e1b` |

CloudBase SQL 回读：

```text
revision=196
youzanOrders=0
orderFulfillments=0
residual_order_path=NULL
residual_fulfillment_path=NULL
```

## 演练二：字段快照恢复

| 项目 | 实测结果 |
|---|---|
| 合成订单号 | `YZ_RELEASE_SNAPSHOT_1783773638222_02dd9b` |
| 基线 runId | `adr_7e5f714331b035` |
| 错误更新 runId | `adr_2dc9c3e331b09e` |
| 错误值 | `receiverName=发布回滚错误值`、`amount=9.99`、`orderStatus=CLOSED` |
| 回滚后基线 | `receiverName=发布回滚基线`、`amount=0.01`、`orderStatus=PAID` |
| 更新回滚状态 | `ROLLED_BACK` |
| 基线清理状态 | `ROLLED_BACK` |
| 最终查询残留 | 0 条 |

最终 CloudBase SQL 回读：

```text
revision=204
youzanOrders=0
orderFulfillments=0
residual_order_path=NULL
```

## 已证明

1. `myroot_app` 的 `DELETE` 权限可支撑真实 MySQL Store 提交和关系投影清理。
2. `MANUAL_SAMPLE` 导入会记录可回滚目标。
3. Adapter rollback 可以删除本次新建记录。
4. Adapter rollback 可以恢复更新前字段快照。
5. 同一 requestId 重复提交不会重复回滚或重复写审计。
6. 回滚完成后业务订单和履约集合无残留。

## 仍待完成

1. 由运营负责人登录 Element Plus Admin，实际演练真实 Adapter 停用后的人工订单、物流、券状态、企微线索和标签处理路径。
2. 确认运营人工处理的负责人、升级路径、处理时限和审计留存方式。
3. 运营与研发共同确认后，通过 `POST /api/v1/admin/production-cutover-proofs` 为 `rollback_drill_completed` 记录生产 `VERIFIED` 证明。
4. `myroot-api-013` 完成灰度探针和回退验证后，再把云托管版本回退步骤补入同一证据链。
