# myRoot v0.6.0 归档测试记录

> 执行日期：2026-08-25
> 分支：`codex/v0.6.0-review-archive-20260825`
> 用途：证明归档代码在本地通过自动化门禁；不替代真机验收、微信审核或生产部署验证。

## 1. 小程序

先对提审源快照与 Git 归档目录执行内容校验：

```bash
rsync -nrc --delete \
  --exclude node_modules \
  --exclude .DS_Store \
  --exclude project.private.config.json \
  /Users/rijay/Documents/Root/myroot-v060-slim-20260820/miniprogram/ \
  ./miniprogram/
```

结果：无差异输出。除本机私有配置和依赖目录外，Git 归档中的小程序与 12:05 提审源快照内容一致。

执行：

```bash
cd miniprogram
npm run check
```

结果：`PASS`。

覆盖范围包括运行配置一致性、本机健康数据 180 天保留期、健康数据同意、内部发布门禁、Launching 入口、肠道固定入口、v0.6.0 范围回归、产品与体验装、运营入口、页面分享、活动、请求和微信登录流程。

## 2. 运营后台

执行：

```bash
cd admin
npm run check
```

结果：`41/41 PASS`。

其中 HTTP 测试使用本机 `127.0.0.1` 回环地址，不连接生产环境。

随后执行生产构建及静态资源同步：

```bash
npm run build
npm run deploy:prepare-admin
```

结果：`PASS`。生成资源已同步至 `backend/public/admin-dist`。

构建保留一个既有提示：Element Plus 相关产物存在大于 500 KB 的 chunk。该提示未导致构建失败，本次归档没有为此扩大拆包范围。

## 3. 后端

执行：

```bash
cd backend
npm ci
npm test
```

结果：

| 指标 | 数量 |
|---|---:|
| tests | 612 |
| pass | 608 |
| skipped | 4 |
| fail | 0 |

`npm ci` 按锁文件补齐了归档工作树缺少的 `mysql2` 本地依赖；未改变 `package.json` 或 `package-lock.json`。

后端测试会启动本机回环 HTTP 服务并执行内存/模拟存储验证，不连接或写入生产 CloudBase、MySQL、微信公众平台或会员商城。

## 4. 验证边界

### 提审后本地调整复验

在五类纤维建议和 Banner3 字号调整后再次执行：

- `node scripts/local-v060-compat.test.js`：通过，五类结果均验证第一条对应建议；
- `node scripts/formal-health.test.js`：通过，结果文案版本 v5 和五类文案均被锁定；
- `node scripts/p2-polish.test.js`：通过，Banner3 两行副文案字号锁定为 `36rpx`；
- 小程序 `npm run check`：全量通过；
- 根目录 `npm run verify`：本地证据刷新后 `6/6 PASS`。

以上调整尚未重新上传微信平台，因此不属于 12:05 已提交审核候选。

完成上述单项验证后，在仓库根目录执行：

```bash
npm run verify
```

结果：正式上线本地门禁 `6/6 PASS`，包括正式路由面、后端测试、小程序正式范围与性能、运营后台检查、运营后台生产构建与性能、本地发布证据。

仓库根包和运营后台包仍保留历史内部版本号 `0.5.13`；微信提审版本的权威版本号来自 `miniprogram/package.json`，为 `0.6.0`。本次归档不为统一内部包版本号而扩大提审代码范围。

本记录没有执行：

- 微信小程序重新上传、重新提审或正式发布；
- CloudBase 服务部署或流量修改；
- 数据库迁移 069–071；
- 生产数据写入；
- ROOT 会员商城库存或领取资格写操作。

真机冒烟和公众平台操作使用项目负责人此前确认的证据边界，详见 `docs/v0.6.0_内部发布门禁_2026-08-25.md`。
