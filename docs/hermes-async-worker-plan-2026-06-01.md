# Hermes 40 分钟生成流程异步化修改记录

## 1. 本次备份

已在本地创建修改前备份：

```text
C:\Users\Administrator\Desktop\app-b9plzy10uj29\backups\luna-async-before-20260601-120927
```

备份范围包含本次会动到的 `src` 页面、`cloudfunctions`、`docs`、`scripts`、配置文件等关键代码。没有备份 `node_modules`、`dist` 和大量截图产物。

## 2. 修改原因

Hermes 完整生成流程需要 40 分钟起步，不能继续使用：

```text
小程序 -> cloud.callFunction -> lunaGuardian -> 等 Hermes -> 返回结果
```

微信云函数最长执行时间有限，小程序端 `cloud.callFunction` 轮询也会超时。同步等待会导致 `-504003` 或 `-404005 exceed max poll retry`。

## 3. 修改前链路

```text
工作台/素材包创建页
  -> callCloudFunction('lunaGuardian')
  -> lunaGuardian 安保层
  -> 同步请求 Hermes /v1/chat/completions
  -> 等待 Hermes 返回 material_package
  -> 写入 materials
  -> 小程序展示结果
```

关键文件：

```text
src/pages/chat/index.tsx
src/pages/package-create/index.tsx
cloudfunctions/lunaGuardian/index.js
src/pages/materials/index.tsx
```

## 4. 修改后链路（方案 B）

```text
工作台/素材包创建页
  -> callCloudFunction('lunaGuardian')
  -> lunaGuardian 登录校验 + MiniMax 安保层
  -> 创建 generation_jobs(status=queued)
  -> 立即返回 accepted + job_id
  -> 小程序提示“已收到，后台制作”
  -> 用户去素材库看生成中任务

长期运行 Worker
  -> 读取 generation_jobs(status=queued)
  -> 标记 running
  -> 调 Hermes /v1/chat/completions，可等待 40 分钟以上
  -> 解析 material_package
  -> 写入 materials
  -> 标记 generation_jobs(status=succeeded, result_material_id=xxx)
```

## 5. 本次新增/修改文件

### 云函数

```text
cloudfunctions/lunaGuardian/index.js
```

- 新增 `FUNCTION_VERSION=luna-guardian-async-job-20260601-1`。
- 新增 `generation_jobs` 和 `generation_job_events` 写入逻辑。
- 默认不再同步等 Hermes。
- 默认返回：

```json
{
  "ok": true,
  "data": {
    "accepted": true,
    "job_id": "xxx",
    "reply": "Luna 已收到你的任务..."
  }
}
```

- 保留旧同步链路：调用时传 `sync: true` 仍可走旧逻辑，便于临时测试。

### 数据 API

```text
cloudfunctions/dbApi/index.js
src/db/api.ts
src/db/types.ts
```

- 新增 `getGenerationJobs`。
- 新增 `getGenerationJobById`。
- 新增前端 `GenerationJob` 类型。

### 前端页面

```text
src/pages/chat/index.tsx
```

- 工作台收到 `accepted/job_id` 后，不再等待素材包。
- 聊天框显示“后台制作，完成后进素材库”。

```text
src/pages/package-create/index.tsx
```

- 创建任务成功后弹窗提示，并跳转素材库。

```text
src/pages/materials/index.tsx
```

- 素材库新增 `generation_jobs` 展示。
- 可看到 `排队中 / 制作中 / 失败` 等状态。
- 完成后的素材仍走原有 `materials` 结果卡片。

### Worker

```text
workers/hermes-worker/index.cjs
workers/hermes-worker/package.json
workers/hermes-worker/README.md
```

Worker 是长期运行进程，不是小程序云函数。它负责：

- 拉取 `generation_jobs.status=queued`
- 调 Hermes
- 写入 `materials`
- 更新任务状态

## 6. 云数据库集合

需要确保云数据库里有：

```text
generation_jobs
generation_job_events
materials
profiles
usage_records
```

`lunaGuardian` 里已经尽量调用 `createCollection` 自动创建，但正式环境建议你在云开发控制台手动确认集合存在。

## 7. Worker 部署环境变量

```bash
CLOUDBASE_ENV_ID=cloud1-d3g0qen9b36b6a0b8
TENCENT_SECRET_ID=腾讯云 SecretId
TENCENT_SECRET_KEY=腾讯云 SecretKey
HERMES_BASE_URL=http://152.136.47.2:8642/v1/chat/completions
HERMES_API_KEY=你的 Hermes Key
HERMES_MODEL=hermes-agent
```

运行：

```bash
cd workers/hermes-worker
npm install
npm start
```

## 8. 本地验证

已执行：

```bash
node --check cloudfunctions/lunaGuardian/index.js
node --check cloudfunctions/dbApi/index.js
node --check workers/hermes-worker/index.cjs
node scripts/buildWeappSafe.mjs
node scripts/test-luna-guardian-local.mjs
```

结果：

```text
小程序构建通过
lunaGuardian 本地测试通过
默认异步模式下 Hermes 同步调用次数为 0
```

## 9. 下一步部署

1. 在微信开发者工具上传并部署：

```text
cloudfunctions/lunaGuardian
cloudfunctions/dbApi
```

2. 确认云数据库集合：

```text
generation_jobs
generation_job_events
materials
profiles
usage_records
```

3. 部署 `workers/hermes-worker` 到 CVM、CloudBase 云托管、腾讯云轻量服务器或 Hermes 同机服务。

4. 小程序端重新编译 `dist` 后测试：

```text
工作台发起任务 -> 立即显示已收到
素材库 -> 出现生成中任务
Worker 完成 -> 素材库出现素材包结果
```

## 10. 当前限制

本次已经完成小程序侧和云函数侧的异步改造，但 Hermes 40 分钟任务真正跑完，依赖 Worker 进程在线运行。只上传云函数还不够，必须把 `workers/hermes-worker` 部署到一个不会 60 秒超时的长期运行环境。

## 11. 服务器部署记录

2026-06-01 已把 Worker 部署到 Hermes 所在服务器：

```text
服务器：152.136.47.2
用户：ubuntu
目录：/home/ubuntu/luna-hermes-worker
服务：luna-hermes-worker.service
状态：已安装，已启动，并已设为开机自启
```

已完成：

```text
1. 上传 index.cjs / package.json / package-lock.json / README.md
2. 在服务器执行 npm ci --omit=dev
3. 创建 /home/ubuntu/luna-hermes-worker/.env
4. 创建 /etc/systemd/system/luna-hermes-worker.service
5. systemctl daemon-reload
6. 验证 node --check index.cjs 通过
7. 验证本机 Hermes 端口 8642 可访问
```

当前运维命令：

```bash
sudo systemctl status luna-hermes-worker
sudo systemctl restart luna-hermes-worker
sudo journalctl -u luna-hermes-worker -f
```

2026-06-01 补齐腾讯云密钥后，已创建缺失集合：

```text
generation_jobs
generation_job_events
```

Worker 最新日志已显示：

```text
[hermes-worker-xxxx] no queued job
```

说明 Worker 已能连接 CloudBase，并正在等待小程序创建任务。

## 12. 2026-06-01 任务状态修复记录

检查任务 `d0222e176a1d3ee30035391b6f758e0a` 时发现：

```text
Worker 已调用 Hermes，并写入了 materials
但 Worker 使用了微信云函数 SDK 的 {data: ...} 写法
服务器端 @cloudbase/node-sdk 需要直接传对象
导致 generation_jobs.status 没有正确从 queued 改为 succeeded
```

已修复：

```text
1. 修正 workers/hermes-worker/index.cjs 的 add/update 写库方式
2. 上传修正版 Worker 到服务器
3. 暂停 Worker，防止重复处理同一任务
4. 将已生成素材迁移为标准 materials 字段
5. 将任务标记为 succeeded
6. 重启 Worker
```

当前确认：

```text
任务状态：succeeded
结果素材：76f32dcb6a1d434f0038727b6ed0ccf5
Worker 状态：active
最新日志：no queued job
```

## 13. 2026-06-01 Hermes 回传格式失败排查

任务 `30f0494c6a1d4de9002fe07b2e1be212` 曾被标记为 `failed`：

```text
用户指令：我要投放一个关于诛仙世界的推广，生成素材包，包含图片和视频
失败原因：Hermes did not return a parsable material_package
执行时间：2026-06-01 17:16:30 -> 17:20:28
```

排查结论：

```text
1. Worker 已正常接到任务。
2. Hermes 接口返回 HTTP 200，不是网络失败，也不是云函数 60 秒超时。
3. Hermes 原文长度约 5179 字符，确实生成了素材内容。
4. 原文前半段是 material_package，但尾部额外追加了 generation_notes，导致整体 JSON 非法。
5. 旧版 Worker 使用 lastIndexOf('}') 截取整段文本，无法容错这种“前半段合法、尾部跑偏”的返回。
```

已修复：

```text
1. workers/hermes-worker/index.cjs 新增平衡括号 JSON 提取逻辑。
2. 后续 Hermes 多吐尾部字段时，Worker 会截取第一个完整 JSON 对象继续入库。
3. 若仍解析失败，Worker 会把 hermes_raw_preview 写回 generation_jobs 方便追查。
4. 已上传 Worker 到服务器并重启 luna-hermes-worker.service。
5. 已从 Hermes 历史会话恢复失败任务，写入 materials。
```

当前确认：

```text
任务状态：succeeded
结果素材：76f32dcb6a1d56d1003a21130adac500
素材平台：小红书、抖音、视频号、公众号
Worker 状态：active
```

## 14. 2026-06-02 Hermes 废话回传容错升级

背景：

```text
Hermes 在长任务结束时可能不会只返回纯 JSON。
已观察到的情况包括：前置说明、尾部 generation_notes、Markdown code block、先给状态 JSON 再给素材包 JSON。
```

本次加固：

```text
1. workers/hermes-worker/index.cjs 不再只抓第一个 JSON。
2. 会扫描文本中所有平衡闭合的 JSON 片段。
3. 优先选择 type=material_package 或包含 platforms 的素材包结构。
4. Markdown code block 内如果不是素材包，不会提前返回，会继续向后找真正素材包。
5. 本地模拟 5 类脏返回均通过。
6. 已上传服务器并重启 luna-hermes-worker.service。
```

当前边界：

```text
可以处理：废话 + JSON、JSON + 废话、状态 JSON + 素材包 JSON、code block + 素材包 JSON、尾部多吐字段。
不能保证：Hermes 输出的素材包本体被截断、字段完全不含 platforms、只返回自然语言且没有结构化数据。
```

## 15. 2026-06-02 Hermes 吐残自动修复

新增策略：

```text
Worker 不再把第一次解析失败直接视为最终失败。
当 Hermes 原始回传无法解析，或解析后不符合 material_package/platforms 结构时：
1. 任务保持 running。
2. 写入 generation_job_events: repairing。
3. Worker 把损坏输出的头部和尾部、用户指令、目标平台、目标 JSON schema 发给 Hermes。
4. Hermes 第二次只做 JSON 修复，不重新跑完整素材生成。
5. 修复成功后写入 generation_job_events: repaired，并正常入库 materials。
6. 修复仍失败时，才标记 generation_jobs.status=failed。
```

新增字段：

```text
generation_jobs.hermes_raw_preview
generation_jobs.hermes_repair_raw_preview
generation_jobs.hermes_repair_error
materials.package_config.repair_used
materials.hermes_repair_raw_preview
```

默认参数：

```text
HERMES_REPAIR_TIMEOUT_MS=600000
HERMES_REPAIR_MAX_CHARS=18000
```

当前边界：

```text
可以修：JSON 被截断一部分、尾部混入废话、多段 JSON、Markdown 包裹、字段结构轻微跑偏。
不保证修：Hermes 原文里根本没有可用素材内容、返回完全是自然语言、素材核心内容缺失太多。
```
