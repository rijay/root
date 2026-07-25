# MySQL 001～066 本机执行结果（Attempt 10）

- 时间：2026-07-20 09:59:34 +08:00
- R11 packet SHA：`d0369e06f7fb57a2085cd5a567bf775370fe0ae2a43178179465a435e7aa3016`
- nonce：`dd1a2ef2-8687-4509-a799-0960748cb6fd`（已消费，不得复用）
- 结果：`FAIL_PRE_DOCKER_DAEMON_UNAVAILABLE_NONCE_CONSUMED`

Runner 在 nonce 消费后执行 pinned image inspect。当时 Docker Desktop 未运行，`docker image inspect` 无法连接 daemon；Runner 将所有 inspect 失败统一映射成 `MYSQL_LOCAL_RUNNER_PINNED_IMAGE_MISSING`，因此在容器启动前退出。

Docker Desktop 随后按 `docker info` 条件轮询启动成功；相同精确 digest 的 inspect 通过，`docker pull` 返回 `Image is up to date`。这证明失败原因是 daemon 不可用，而不是冻结镜像不存在。

本轮没有分配端口、启动容器、创建数据库/主体、运行真实引擎测试、改写 schema snapshot 或执行最终验证。`backend/db/schema.sql` 仍为 SHA-256 `e84fe654b674981917c472cc73593657dd6a9189dd32b736ff1bae895be7a7c3`。Candidate/生产连接、部署、提交和推送均未发生。

R12 必须修复：daemon 与 exact image 预检发生在 nonce 消费前；daemon 不可用与镜像缺失使用不同错误码；nonce 消费后、`docker run` 前再次校验两项条件。Attempt 10 不关闭任何 Gate。
