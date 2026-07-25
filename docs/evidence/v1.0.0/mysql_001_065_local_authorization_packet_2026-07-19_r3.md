# MySQL 001-065 本机一次性执行授权包 R3

状态：`PREPARED_NOT_AUTHORIZED_NOT_EXECUTED`。

本包不构成授权。它只冻结下一次拟执行的字节、一次性 nonce、容器策略、真实引擎测试与成功后的 schema provenance 验证。机器可读包：`mysql_001_065_local_authorization_packet_2026-07-19_r3.json`，SHA-256：`8c46d1b15b8e858bc8b2ea00ddc8d9f4068c93eee4fb63a4efc8c2a0df1004e8`。

## R3 修正

- 宿主机使用与测试相同的 root 凭据连续两次执行认证 SQL。
- 同时校验 `SELECT 1`、精确 MySQL `8.0.43`、`CURRENT_USER()`、稳定 `server_uuid` 与唯一空 marker schema。
- Docker 端口必须由 `inspect` 回读为唯一 `127.0.0.1` 随机端口。
- 容器使用随机 ownership label；清理只接受精确 container ID + label，禁止按前缀处理其他容器。
- 冻结输入在 Docker 启动前及真实测试启动前各校验一次。
- 六组测试必须得到 `12 tests / 12 pass / 0 fail / 0 skip`，退出码为 0 但存在 SKIP 仍失败。
- 密码只通过子进程环境传递，不进入 argv 或结果证据。
- nonce `a282c9d3-8adb-4e25-ba7c-65eac5c6c275` 只能消费一次；失败后也不得重用。

## 授权后唯一入口

只有获得明确绑定本包 SHA 与 nonce 的新授权后，才可设置：

```sh
MYROOT_LOCAL_MYSQL_AUTHORIZED=true \
MYROOT_LOCAL_MYSQL_PACKET_SHA256=8c46d1b15b8e858bc8b2ea00ddc8d9f4068c93eee4fb63a4efc8c2a0df1004e8 \
MYROOT_LOCAL_MYSQL_AUTHORIZATION_NONCE=a282c9d3-8adb-4e25-ba7c-65eac5c6c275 \
npm run v1:mysql-local-authorized:run -- \
  --packet docs/evidence/v1.0.0/mysql_001_065_local_authorization_packet_2026-07-19_r3.json
```

Runner 内部生成一次性密码，使用固定 digest 的 MySQL 8.0.43 镜像，仅发布 `127.0.0.1::3306`。它依次执行：

1. `npm run v1:mysql-001-065-authorized:check`
2. `npm run db:schema-snapshot:write`
3. `npm run db:schema-snapshot:verify`
4. `npm run verify -- --json`

任一步失败都会停止后续步骤并清理本次容器。成功也会清理。R3 仅可能推进本地 MySQL engine/schema proof；不会关闭 Candidate/生产、容量、IAM、真实告警或微信送达等正式 Gate。
