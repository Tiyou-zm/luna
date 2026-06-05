# Luna 小程序实际能力打通记录

日期：2026-05-27

## 已接入的真实链路

1. 登录
   - 微信一键登录：`ensureProfile`
   - 自建账号注册/登录/改密：`accountAuth`
   - 用户资料读取/更新：`dbApi`

2. 素材上传与素材库
   - 前端上传走 CloudBase 云存储：`src/utils/cos.ts`
   - 上传成功后写入 `materials`
   - 素材库读取、删除、结果页读取走 `dbApi`

3. Luna/Hermes 生成
   - 工作台和素材包创建页调用 `lunaGuardian`
   - `lunaGuardian` 已支持真实调用 `HERMES_BASE_URL/v1/chat/completions`
   - Hermes 未配置或返回不可解析时，保留本地兜底结果，避免业务中断
   - 每次生成会写入 `materials`，并写入 `usage_records`，同时增加 `profiles.ai_count`

4. 客服
   - 客服消息写入 `cs_messages`
   - 如配置 `CUSTOMER_SERVICE_*` 或 `HERMES_*`，客服会调用 `/v1/chat/completions` 生成 AI 初步回复
   - 未配置时仍保存工单并返回明确状态

5. 微信支付
   - `createWechatPayment` 已接入微信支付 JSAPI 下单
   - 前端套餐购买和算力充值支付成功后，会调用 `createWechatPayment` 的 `confirm` 动作查询微信支付订单并落库
   - 套餐支付成功后更新 `profiles.membership_level`、有效期和配额
   - 算力充值成功后更新 `compute_recharges` 和 `profiles.balance`
   - 新增 `wechatPaymentCallback`，可作为微信支付回调函数，处理用户关闭小程序后的异步支付通知

6. 财务
   - `financeDailyCalc` 已从 `orders`、`compute_recharges`、`usage_records`、`profiles` 汇总日报
   - `dbApi` 已支持财务报告、充值汇总、用量汇总、转账确认/跳过

7. 其他数据能力
   - `dbApi` 已补齐会话、消息、社交账号、分析数据、公告、用量记录等原占位动作。

## 必填云函数环境变量

Hermes：

```text
HERMES_BASE_URL=
HERMES_API_KEY=
HERMES_MODEL=hermes-agent
```

客服可以复用 Hermes，也可以单独配置：

```text
CUSTOMER_SERVICE_BASE_URL=
CUSTOMER_SERVICE_API_KEY=
CUSTOMER_SERVICE_MODEL=
```

微信支付：

```text
WECHAT_APPID=
WECHAT_MCH_ID=              # 兼容 WECHAT_PAY_MCH_ID
WECHAT_PAY_SERIAL_NO=       # 兼容 WECHAT_PAY_CERT_SERIAL_NO
WECHAT_PAY_PRIVATE_KEY=
WECHAT_PAY_API_V3_KEY=
WECHAT_PAY_NOTIFY_URL=
```

财务：

```text
VOLCANO_BALANCE=
FINANCE_SAFETY_THRESHOLD=300
```

## 需要确认存在的集合

已使用集合：

```text
profiles
materials
cs_messages
orders
compute_recharges
usage_records
announcements
conversations
messages
social_accounts
analytics
finance_reports
transfer_orders
```

## 需要上传/部署的云函数

```text
ensureProfile
accountAuth
dbApi
lunaGuardian
customerService
arkModelPricing
createWechatPayment
financeDailyCalc
wechatPaymentCallback
```

每个函数建议使用“上传并部署：云端安装依赖”。

## 验证结果

- 云函数 `node -c` 语法检查通过。
- 小程序 `taro build --type weapp` 通过。
- `scripts/patchWeappDist.mjs` 已执行。
- `tsc --noEmit` 仍会被 Taro/依赖类型声明阻塞，这不是小程序构建阻塞项。

## 下一步实测顺序

1. 登录页：微信一键登录、自建账号注册、自建账号登录。
2. 工作台：输入指令生成素材包，确认 `materials`、`usage_records`、`profiles.ai_count` 变化。
3. 素材上传：上传图片/文件，确认素材库出现记录。
4. 客服：发送文字/图片，确认 `cs_messages` 有用户消息和回复。
5. 套餐购买：配置微信支付后，创建订单、拉起支付、支付后确认会员生效。
6. 算力充值：配置微信支付后，创建充值单、拉起支付、支付后确认余额变化。
7. 财务页：执行跑批，确认 `finance_reports` 和 `transfer_orders` 生成。
