# 微信登录与会员支付接入说明

## 当前代码链路

### 微信一键登录

1. 登录页点击「微信一键登录」。
2. 前端调用 `signInWithWechat()`。
3. `signInWithWechat()` 调用云函数 `dbApi` 的 `ensureProfile` 动作。
4. `dbApi` 通过 `cloud.getWXContext()` 读取当前微信小程序用户的 `OPENID`。
5. 如果 `profiles` 集合中不存在该用户，就按 `OPENID` 创建用户档案。
6. 前端保存 `{id, openid}` 到本地缓存，并把 `profile` 写入登录上下文。

相关文件：

- `src/pages/login/index.tsx`
- `src/contexts/AuthContext.tsx`
- `src/client/cloudbase.ts`
- `cloudfunctions/dbApi/index.js`

### 19.9 试用版会员支付

1. 套餐页只展示 `trial` 试用版。
2. 点击购买后，前端调用 `createWechatPayment` 云函数创建 JSAPI 订单。
3. 云函数用当前微信上下文 `OPENID` 作为支付人，不再依赖前端缓存的 openid。
4. 云函数请求微信支付 `/v3/pay/transactions/jsapi`，返回 `paymentParams`。
5. 前端调用 `Taro.requestPayment()` 拉起微信支付。
6. 支付成功后，前端调用 `createWechatPayment` 的 `confirm` 动作查询微信支付订单状态。
7. 同时支持微信支付异步回调 `wechatPaymentCallback` 更新订单和会员权益。

相关文件：

- `src/pages/pricing/index.tsx`
- `cloudfunctions/createWechatPayment/index.js`
- `cloudfunctions/wechatPaymentCallback/index.js`
- `src/db/types.ts`

## 本次修改

1. `createWechatPayment` 新增 `diagnose` / `ping` 动作，用于云端自检微信支付配置。
2. 套餐页购买不再向云函数传 `openid`，避免前端登录缓存过期导致支付失败。
3. 未登录购买会员时，明确弹窗引导去登录。
4. 微信一键登录在非小程序环境下直接提示，不再抛出云能力异常。
5. `.env.example` 补充微信支付云函数环境变量占位。

## 云函数环境变量

这些变量需要配置到腾讯云开发的云函数环境变量中，不能放到前端包里：

```text
WECHAT_APPID=微信小程序 AppID
WECHAT_MCH_ID=微信支付商户号
WECHAT_PAY_SERIAL_NO=商户 API 证书序列号
WECHAT_PAY_PRIVATE_KEY=商户 API 证书私钥 PEM，或 base64 后的 PEM
WECHAT_PAY_API_V3_KEY=微信支付 API v3 密钥
WECHAT_PAY_NOTIFY_URL=微信支付异步回调公网地址
```

`createWechatPayment` 兼容这些旧变量名：

```text
WECHAT_PAY_MCH_ID
WECHAT_PAY_CERT_SERIAL_NO
```

## 上传与自检步骤

1. 在微信开发者工具中上传并部署 `dbApi`。
2. 上传并部署 `createWechatPayment`。
3. 上传并部署 `wechatPaymentCallback`。
4. 在云函数 `createWechatPayment` 的云端测试里传：

```json
{
  "action": "diagnose"
}
```

期望返回：

```json
{
  "ok": true,
  "data": {
    "hasOpenid": true,
    "hasAppid": true,
    "hasMchId": true,
    "hasSerialNo": true,
    "hasPrivateKey": true,
    "privateKeyValid": true,
    "hasApiV3Key": true,
    "hasNotifyUrl": true,
    "missing": []
  }
}
```

如果 `missing` 不为空，先补云函数环境变量。

## 必须在微信后台完成的配置

1. 小程序必须使用正式 AppID，不能用测试号。
2. 小程序需要开通微信支付，并绑定商户号。
3. 商户平台需要配置 API v3 密钥。
4. 商户平台需要下载 API 证书，并把私钥填入云函数环境变量。
5. 支付回调地址需要是公网 HTTPS 地址，并能转发到 `wechatPaymentCallback`。
6. 小程序后台需要配置云开发环境和合法域名。

## 验收用例

### 登录

1. 清除小程序本地缓存。
2. 进入「我的」页，未登录状态不应显示退出登录。
3. 进入登录页，勾选协议，点击微信一键登录。
4. 预期：进入工作台或原目标页，`profiles` 集合出现当前 `openid` 对应用户。

### 支付

1. 使用真机或微信开发者工具小程序环境。
2. 先完成微信一键登录。
3. 进入套餐页，选择 19.9 试用版并点击购买。
4. 预期：成功拉起微信支付。
5. 支付完成后，`orders` 中订单状态变为 `paid`。
6. `profiles` 中 `membership_level` 变为 `trial`，并写入 `membership_expires`。

## 当前限制

本地构建只能验证前端和云函数语法。真实支付必须依赖微信支付商户配置、正式小程序 AppID、HTTPS 回调地址和微信支付沙箱/真实支付环境。
