# 自建账户与微信身份分离说明

## 新身份模型

Luna 现在保留两种登录方式：

1. 微信一键登录
   - 用户 ID 仍然是微信 `OPENID`。
   - 适合不想注册账号的用户。

2. 自建账号登录
   - 用户 ID 改为 `acct_` 开头的独立 `accountId`。
   - 同一个微信号可以注册/登录不同自建账号。
   - 登录成功后后端会签发 `sessionToken`，前端后续调用云函数时自动携带。

## 数据归属

普通业务数据统一按当前登录账号归属：

- 素材库：`materials.user_id`
- 生成任务：`generation_jobs.user_id`
- 客服消息：`cs_messages.user_id`
- 订单：`orders.user_id`
- 生成记录：`usage_records.user_id`
- 账号资料：`profiles._id`

微信 `openid` 只作为微信来源或支付人记录，不再强制等同于自建账号 ID。

## 本次改动文件

- `cloudfunctions/dbApi/index.js`
  - 自建账号注册创建独立 `acct_` 用户。
  - 自建账号登录签发 `auth_sessions`。
  - 普通数据库接口优先用 `authToken` 解析出的账号 ID。

- `src/client/cloudbase.ts`
  - 本地保存 `sessionToken`。
  - 调用业务云函数时自动附带 `authToken`。

- `src/contexts/AuthContext.tsx`
  - 手动账号刷新资料时不再强制切回微信 profile。

- `cloudfunctions/lunaGuardian/index.js`
  - 生成任务和同步素材包保存到当前账号 ID。

- `cloudfunctions/createWechatPayment/index.js`
  - 付款人仍用微信 `OPENID`。
  - 订单和会员权益落到当前账号 ID。

- `src/pages/compute-recharge/index.tsx`
  - 充值不再依赖前端 profile 中的 `openid`。

## 需要上传的云函数

请重新上传部署：

1. `dbApi`
2. `lunaGuardian`
3. `createWechatPayment`

如果要测支付异步回调，`wechatPaymentCallback` 也保持已部署即可。

## 验收步骤

1. 清除小程序本地缓存。
2. 注册 `test1`，进入「我的」页应显示 `test1`，不是 `test`。
3. 退出登录。
4. 用 `test` 登录，应进入 `test` 的资料和素材空间。
5. 再退出，用 `test1` 登录，应进入 `test1` 的资料和素材空间。
6. 用 `test1` 发起一次素材包生成，素材应进入 `test1` 的素材库。
7. 用 `test` 查看素材库，不应看到 `test1` 新生成的素材。

## 注意

旧数据中，早期按微信 `OPENID` 存下来的素材和订单仍属于微信一键登录用户空间。新注册的自建账号从这次改动后开始使用独立账号空间。
