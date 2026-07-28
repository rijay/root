# myRoot v1.0.0 本机 MySQL 001～066 单次授权包 R11

- 状态：`PREPARED_NOT_AUTHORIZED_NOT_EXECUTED`
- JSON：`mysql_001_066_local_authorization_packet_2026-07-20_r11.json`
- JSON SHA-256：`d0369e06f7fb57a2085cd5a567bf775370fe0ae2a43178179465a435e7aa3016`
- 单次 nonce：`dd1a2ef2-8687-4509-a799-0960748cb6fd`
- 运行/包版本：`0.5.13`
- 固定镜像：`mysql:8.0.43@sha256:3e646bcda0d9448ffa3d2024eef04e1bca95528ec19b9e8b76749da9d97d4a10`
- 网络：仅随机 `127.0.0.1` 临时端口；Candidate/生产连接均未授权。

## 为什么取代 R10

R10 未执行、nonce 未消费，但只冻结了局部测试与支持文件，没有完整绑定 schema snapshot CLI、最终验证 Implementation、动态源码/测试集合和工具链；post-success 阶段也只检查退出码。R11 因此取代而不是复用 R10：

- 绑定 688 个执行输入，aggregate SHA-256=`36dd29f585c0192c889ea193de1ce7a4d3e6a554cbae61fee779271e12d0a4ec`；新增、删除或修改任一执行输入均在 Docker 前或阶段切换时拒绝。
- 绑定 Node `v24.13.1`、darwin/arm64、Node executable SHA 与 npm `11.8.0`。
- 冻结四阶段 argv：13 项真实引擎测试、原子 schema snapshot write、独立 verify、18 项最终验证。
- 每阶段前后重新验证授权包、迁移集、执行输入与工具链，关闭 post-success TOCTOU。
- 只允许改写 `backend/db/schema.sql`、`admin/dist`、`backend/public/admin-dist`；失败时恢复执行前字节。
- schema verify 必须结构化返回 `matches=true` 且 migration-set digest 精确匹配；最终验证必须按冻结顺序返回 18 个具名 check 全部 PASS。
- 文件路径逐层拒绝 symlink；重复冻结路径拒绝。

## 唯一执行入口

本包不构成授权。只有用户另行明确绑定上述 JSON SHA 与 nonce，并继续限定本机 loopback、失败即停和清理后，才可设置三项一次性环境变量并运行：

```bash
npm run v1:mysql-local-authorized:run -- --packet docs/evidence/v1.0.0/mysql_001_066_local_authorization_packet_2026-07-20_r11.json
```

Runner 在验证成功前不得启动 Docker；nonce 在正式尝试开始前消费且不可复用。任一阶段失败立即停止、回滚允许的生成输出并按精确容器 ID 与 ownership label 清理。

即使 R11 全部通过，也只推进本地 MySQL engine/schema/principal 证明；不关闭远端 CI、Candidate/生产 MySQL、容量、IAM、告警、真实微信身份/送达、内容/UED/摄影授权或正式上线 Gate。
