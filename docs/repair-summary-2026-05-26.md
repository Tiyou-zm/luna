# Luna AI 小程序修复过程总结

日期：2026-05-26

## 目标

把从秒哒导出的 Luna AI 小程序改到可以脱离秒哒构建，并在微信开发者工具里先跑通基础页面链路。当前阶段不测试 Hermes 通信，只验证小程序自身页面、路由、构建产物和运行时稳定性。

## 一、最初问题

1. 微信开发者工具按 `project.config.json` 读取 `miniprogramRoot` 时，找不到 `dist/app.json`。
2. 小程序运行时报 `process is not defined`，导致 `app.js` 初始化失败。
3. 多个页面提示未注册，表现为只有顶部导航和底部 tab，中间区域白屏。
4. 控制台曾出现 `https://backend.appmiaoda.com` 不在 request 合法域名中，说明原秒哒平台域名仍残留在请求链路里。
5. 部分页进入后会长时间 pending，最终触发微信开发者工具 timeout。

## 二、已修复内容

### 1. 构建入口和产物

已确认项目使用 Taro 构建微信小程序，构建产物目录是 `dist/`。通过重新执行微信小程序构建，已生成 `dist/app.json`，微信开发者工具可以按 `miniprogramRoot=dist/` 加载项目。

验证命令：

```bash
pnpm run build:weapp
```

结果：构建通过，`dist/app.json` 存在。

### 2. 微信小程序运行时 process 报错

问题来源是部分依赖和编译产物引用了 Node 环境变量，例如 `process.env`、`process.platform`、`process.version`。微信小程序运行时没有 `process`，所以应用启动阶段直接中断。

处理方式：

- 在 Taro 构建配置里补齐编译期替换。
- 将 HTML 标签 JSX 转换为 Taro 小程序组件，避免 web 标签进入小程序运行时。
- 重新构建后检查 `dist/`，确认不再出现 `process.env`、`process.platform`、`process.version` 等残留。

关键文件：

- `config/index.ts`
- `src/types/global.d.ts`

验证结果：微信开发者工具日志里不再出现 `process is not defined`。

### 3. 路由守卫导致页面卡住

原页面路由守卫和登录状态加载容易互相等待，导致页面已经进入但主体区域一直不渲染。当前阶段为了先跑通基础业务，把路由守卫调整为更轻量的放行逻辑，让页面自己处理登录态和空状态。

关键文件：

- `src/components/RouteGuard.tsx`
- `src/contexts/AuthContext.tsx`

验证结果：首页、功能页、客服页、我的页四个 tab 均能渲染主体内容。

### 4. 数据请求 timeout 导致白屏

订单、用量、素材库、充值、素材包结果、财务后台等页面存在等待远端数据的逻辑。如果本地没有完整后端、登录态或数据库数据，请求会卡住页面加载。

处理方式：

- 新增通用 `withTimeout`。
- 页面请求超时后进入空状态或错误状态。
- 未登录或无权限时直接显示可理解的页面，不再无限 loading。

关键文件：

- `src/utils/async.ts`
- `src/pages/orders/index.tsx`
- `src/pages/usage-records/index.tsx`
- `src/pages/materials/index.tsx`
- `src/pages/compute-recharge/index.tsx`
- `src/pages/package-result/index.tsx`
- `src/pages/admin-finance/index.tsx`

验证结果：强行打开缺数据页面时，页面能显示空状态或错误状态，不再白屏。

### 5. 微信开发者工具强开验证

使用开发者工具 Console 强行跳转并截图验证了以下页面：

- `/pages/chat/index`
- `/pages/features/index`
- `/pages/service/index`
- `/pages/profile/index`
- `/pages/orders/index`
- `/pages/usage-records/index`
- `/pages/materials/index`
- `/pages/monitor/index`
- `/pages/account-security/index`
- `/pages/pricing/index`
- `/pages/settings/index`
- `/pages/about/index`
- `/pages/package-create/index`
- `/pages/compute-recharge/index`
- `/pages/admin-finance/index`
- `/pages/package-result/index?id=__smoke_missing__`
- `/pages/login/index`

强开验证后再次扫描微信开发者工具最新日志，未命中以下错误：

- `ReferenceError`
- `TypeError`
- `process is not defined`
- `Page ... has not been registered`
- `App render failed`
- `backend.appmiaoda`
- `request 合法域名`
- `timeout`

## 三、当前状态

当前小程序已经可以：

1. 本地构建微信小程序产物。
2. 被微信开发者工具加载。
3. 打开主 tab 页面。
4. 强行打开二级页面。
5. 在缺少后端数据时显示空状态或错误状态。
6. 避免秒哒旧域名和 Node 运行时对象导致的启动失败。

## 四、尚未完成或未测试

1. Hermes 通信尚未实际测试。
2. 微信支付尚未打通完整支付闭环。
3. 微信登录需要真实 appid、后端换取 openid/session、用户表绑定后再做线上验证。
4. COS 上传链路代码存在，但还需要后端签名、权限策略、路径前缀和用户隔离策略一起联调。
5. 素材包从 Hermes 返回后自动解压、入库、展示的完整链路仍需继续开发。

## 五、后续建议

1. 先固定小程序本地运行脚本和微信开发者工具打开方式。
2. 接入正式微信 appid 和后端登录接口。
3. 为 COS 上传补齐后端签名接口，路径建议使用 `users/{userId}/uploads/` 和 `users/{userId}/packages/`。
4. 让 Hermes 只接收可访问的 COS URL，并返回结构化素材包 JSON 或压缩包下载地址。
5. 小程序侧新增素材包解析、保存、素材库刷新和失败重试状态。
6. 上线前补齐微信合法域名、uploadFile/downloadFile 域名、业务域名和隐私合规配置。
