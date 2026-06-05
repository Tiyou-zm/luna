# Luna Hermes Worker

这个 Worker 用于方案 B：在小程序创建 `generation_jobs` 后，由长期运行的 Node 进程消费任务、调用 Hermes、把结果写回 `materials`。

## 为什么不用云函数

Hermes 完整生成流程需要 40 分钟起步，微信云函数和小程序 `cloud.callFunction` 都不适合长时间等待。云函数只负责创建任务并立即返回，Worker 负责慢任务。

## 必填环境变量

```bash
CLOUDBASE_ENV_ID=cloud1-d3g0qen9b36b6a0b8
TENCENT_SECRET_ID=腾讯云 SecretId
TENCENT_SECRET_KEY=腾讯云 SecretKey
HERMES_BASE_URL=http://152.136.47.2:8642/v1/chat/completions
HERMES_API_KEY=你的 Hermes Key
HERMES_MODEL=hermes-agent
```

## 运行

```bash
cd workers/hermes-worker
npm install
npm start
```

单次测试：

```bash
WORKER_ONCE=true npm start
```

## 数据流

```text
lunaGuardian -> generation_jobs(status=queued)
Worker -> generation_jobs(status=running)
Worker -> Hermes /v1/chat/completions
Worker -> materials
Worker -> generation_jobs(status=succeeded, result_material_id=xxx)
```
