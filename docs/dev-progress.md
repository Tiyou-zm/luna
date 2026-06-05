# 基础业务跑通开发记录

## 目标

跑通小程序到 Hermes 的两个基础路径：

1. 用户上传素材，Hermes 基于素材生成素材包，素材包包含图片素材引用和文案。
2. 用户只提供定位和方向，Hermes 启动信息收集、热点预测、热点追踪，再基于结果生成素材包，素材包包含图片素材引用和文案。

## 存储方案

- 用户上传文件存放到腾讯云 COS。
- COS key 使用用户隔离前缀：`users/{openid-or-user-id}/uploads/` 和 `users/{openid-or-user-id}/outputs/`。
- 前端只拿临时授权配置，不持有腾讯云永久密钥。
- Hermes 通过可访问链接读取上传素材。
- Hermes 返回的素材包结果落库到 `materials`，可选图片/附件引用写入 `package_result`，素材库统一读取。

## 节点记录

### 2026-05-25 节点 1：建立执行文档

- 状态：完成。
- 说明：本文件用于记录每个阶段的修改、测试命令和结论。

### 2026-05-25 节点 2：审查现有链路

- 状态：完成。
- 结论：项目已有 `cos_credential` 和 `cos_list_files`，可复用腾讯云 COS STS 临时授权和用户前缀隔离。
- 结论：主生成链路为 `chat/package-create -> luna_guardian -> luna_hermes_chat -> Hermes /v1/chat/completions`。
- 结论：原上传链路主要使用 Supabase Storage，需要切换主业务素材到 COS。

### 2026-05-25 节点 3：COS 上传链路

- 状态：完成。
- 新增：`src/utils/cos.ts`，封装 `cos_credential` 获取临时授权和前端直传 COS。
- 修改：`src/pages/chat/index.tsx`，工作台上传图片、视频、文档改走 COS。
- 修改：`src/pages/package-create/index.tsx`，素材包创建页上传改走 COS，并把 `file_url/file_key/mime_type/file_type/name` 传给后端。
- 修改：`src/pages/materials/index.tsx`，素材库上传改走 COS，素材列表从 `cos_list_files` 读取 `uploads/`。

### 2026-05-25 节点 4：Hermes 生成与结果保存

- 状态：完成。
- 修改：`luna_guardian` 从 Authorization token 校验真实用户，避免完全信任前端 `user_id`。
- 修改：方向路径 prompt 增加信息收集、热点预测、热点追踪、素材组织四步要求。
- 修改：素材包保存到 `materials` 后，额外写 `users/{openid-or-userId}/outputs/{materialId}/manifest.json` 到 COS。
- 返回：`luna_guardian` 生成响应增加 `output_manifest`。

### 2026-05-25 节点 5：测试记录

- `pnpm run build:weapp`：通过，已生成 `dist/app.json` 和小程序产物。
- `pnpm exec tsgo -p tsconfig.check.json`：通过。
- Edge Function TypeScript 语法解析：`luna_guardian`、`luna_hermes_chat`、`cos_credential`、`cos_list_files` 均通过。
- 本机限制：未安装 `deno` / `supabase` CLI，因此没有执行本地 Edge Function runtime 级启动测试。

### 2026-05-25 节点 6：脱离秒哒构建依赖

- 状态：进行中。
- 已完成：移除 Taro 构建插件中的秒哒注入依赖，`dist/app.json` 可正常生成。
- 已完成：从 `package.json` 和 `pnpm-lock.yaml` 移除 `miaoda-sc-plugin`、`miaoda-taro-utils`、`miaoda-taro-plugin-html`。
- 已完成：删除已过期的 `package-lock.json`，项目依赖管理统一使用 `pnpm`。
- 已完成：用户名登录邮箱后缀改为 `TARO_APP_AUTH_EMAIL_DOMAIN` 配置；当前 `.env` 临时保留 `miaoda.com`，用于兼容现有测试账号 `testZM`。
- 已完成：二维码绑定回调和旧文心代理上游地址改为环境变量，不再硬编码秒哒网关。
- 已完成：移除登录、关于、工作台、客服页中的旧远程静态图，改用本地渲染的 `LunaAvatar` 组件，减少小程序域名校验干扰。
- 待配置：`TARO_APP_SUPABASE_URL` 仍需要替换为新的 Supabase / Edge Functions 网关地址；没有新后端地址前，前端请求仍会打到旧地址。

### 2026-05-25 节点 7：脱离秒哒后的验证

- `pnpm install --lockfile-only=false`：通过，依赖与 lock 文件保持一致。
- `pnpm run build:weapp`：通过，`dist/` 已重新生成。
- `pnpm exec tsgo -p tsconfig.check.json`：通过。
- `dist/app.json` JSON 解析：通过。
- Edge Function TypeScript 语法解析：`luna_guardian`、`luna_hermes_chat`、`cos_credential`、`cos_list_files`、`generate-binding-qrcode`、`wenxin-text-generation` 均通过。
- 仍需人工/线上配置：新的 `TARO_APP_SUPABASE_URL`、小程序后台 request 合法域名、COS 临时授权所需环境变量和 Edge Functions 部署。
