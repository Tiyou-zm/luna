# lunaGuardian 云函数 3 秒超时修复

现象：

```text
cloud.callFunction:fail errCode: -504003
Invoking task timed out after 3 seconds
```

结论：小程序端已经能正确调用 `lunaGuardian`，但云端函数仍按默认 3 秒超时运行。本地的 `cloudfunctions/lunaGuardian/config.json` 已写 `timeout: 60`，但云端配置还没有生效。

微信云函数当前配置页上限是 60 秒，但小程序端 `wx.cloud.callFunction` 轮询通常约 35-38 秒会报 `-404005 exceed max poll retry`。因此同步函数必须在 30 秒左右返回。

当前同步策略：

- MiniMax 安保最多等 `6 秒`。
- Hermes 最多等 `22 秒`。
- Hermes 超时后，云函数返回本地 fallback 素材包，避免小程序端轮询超限。

Hermes 如果稳定超过 22-30 秒，不能继续走同步云函数，需要改为“创建任务 + 后台 Worker + 小程序轮询结果”。

## 微信开发者工具方式

1. 打开“云开发”。
2. 进入环境 `cloud1-d3g0qen9b36b6a0b8`。
3. 进入“云函数”。
4. 选中 `lunaGuardian`。
5. 进入“版本与配置”或“函数配置”。
6. 把超时时间改为 `60` 秒，内存改为 `512 MB`。
7. 保存配置。
8. 回到云函数列表，右键 `lunaGuardian`，选择“上传并部署：云端安装依赖”。

## CloudBase CLI 方式

项目根目录已经写好 `cloudbaserc.json`。登录 CloudBase CLI 后执行：

```bash
tcb config update fn lunaGuardian --timeout 60 --memory 512 -e cloud1-d3g0qen9b36b6a0b8 --yes
tcb fn deploy lunaGuardian -e cloud1-d3g0qen9b36b6a0b8
```

如果 CLI 提示未登录，先执行：

```bash
tcb login
```

## 验证

重新编译小程序，发送一条工作台消息。

期望日志：

```text
[CloudBase] call start {name: "lunaGuardian"}
[CloudBase] call end {name: "lunaGuardian", duration: ...}
```

如果仍看到 `timed out after 3 seconds`，说明云端配置仍未更新成功，继续检查函数详情页里的超时时间。

如果看到 `-404005 exceed max poll retry`，说明函数执行超过了小程序端轮询上限。请确认已经重新部署最新 `lunaGuardian`，最新代码会让 Hermes 在 22 秒超时并返回 fallback。

## 60 秒上限后的长期方案

同步云函数只适合短请求。正式生成建议拆成三段：

1. `createGenerationJob` 云函数：校验登录、扣额度/锁额度、写入 `generation_jobs`，立即返回 `job_id`。
2. 后台 Worker：部署在 CloudBase Run、腾讯云云托管、CVM 或 Hermes 同机服务里，读取任务，调用 Hermes，生成素材包，写入 `materials` 和 `generation_jobs.result_material_id`。
3. 小程序轮询：每 2-3 秒调用 `getGenerationJob`，状态从 `queued/running` 变成 `succeeded/failed` 后跳转素材包结果页。

这样 Hermes 跑 2 分钟、5 分钟都不会被微信云函数 60 秒限制杀掉。
