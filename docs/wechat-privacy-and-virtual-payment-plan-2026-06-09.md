# Luna 微信隐私与虚拟支付改造记录

日期：2026-06-09

## 计划 A：用户隐私保护指引

### 已改代码

- 新增 `src/utils/privacy.ts`，封装 `getPrivacySetting`、`requirePrivacyAuthorize`、`openPrivacyContract`。
- 在 `src/utils/upload.ts` 的图片/视频选择和文件选择前接入隐私授权。
- 登录页《隐私政策》入口改为打开微信官方隐私协议。
- 设置页增加“用户隐私保护指引”入口。
- 关于页点击“隐私政策”时打开微信官方隐私协议。

### 仍需在微信公众平台完成

路径：`mp.weixin.qq.com -> 设置 -> 服务内容声明 -> 用户隐私保护指引`

建议补充的信息类型：

- 微信用户唯一标识 openid：登录、账号识别、生成记录归属、会员状态。
- 昵称、头像：个人资料展示和头像修改。
- 图片、视频、文件：素材上传、客服沟通、AI 内容生成。
- 用户输入内容：Luna/Hermes 对话和素材包生成。
- 订单/支付信息：会员开通、订单核验、售后处理。
- 生成记录/素材库内容：历史任务、成品包、内容组件、文件资产展示。

第三方处理方建议填写：

- 微信云开发 / CloudBase。
- 微信支付 / 微信虚拟支付。
- Hermes AI 服务。
- MiniMax/安保审核服务（如生产环境仍在调用）。

## 计划 B：微信虚拟支付

### 已改代码

- 新增 `cloudfunctions/createVirtualPayment`。
- 会员页从普通 `Taro.requestPayment` 切换为 `wx.requestVirtualPayment`。
- 普通 `createWechatPayment` 增加会员购买保护，避免会员继续走 JSAPI 普通支付。
- `.env.example` 增加虚拟支付环境变量说明。

### 新虚拟支付流程

```text
用户点击购买 Luna 试用会员
-> 前端 wx.login 获取 code
-> createVirtualPayment 用 code 换 session_key
-> 云函数创建 orders 订单
-> 云函数生成 signData / paySig / signature
-> 前端 wx.requestVirtualPayment 拉起支付
-> 支付成功后 confirm
-> 更新 profiles 会员状态和 orders 订单状态
```

### 仍需在云函数环境变量补齐

```text
WECHAT_APPID=
WECHAT_APP_SECRET=
VIRTUAL_PAY_OFFER_ID=
VIRTUAL_PAY_APP_KEY=
VIRTUAL_PAY_SANDBOX_APP_KEY=
VIRTUAL_PAY_ENV=0
VIRTUAL_PAY_MODE=short_series_goods
VIRTUAL_PAY_TRIAL_PRODUCT_ID=
VIRTUAL_PAY_TRIAL_PRICE_CENTS=666
VIRTUAL_PAY_TRIAL_PLAN_LEVEL=trial
```

### 上传云函数后诊断

在开发者工具中调用：

```js
wx.cloud.callFunction({
  name: 'createVirtualPayment',
  data: {action: 'diagnose'},
  success: console.log,
  fail: console.error
})
```

`missing` 必须为空，才可以真机测试拉起虚拟支付。

## 测试重点

- 首次上传图片/文件时弹出微信隐私授权。
- 拒绝隐私授权后不会继续上传。
- 登录页、设置页、关于页能打开隐私政策。
- 会员页调用的是 `createVirtualPayment`，不是 `createWechatPayment`。
- 微信版本支持 `wx.requestVirtualPayment` 时能拉起虚拟支付。
- 支付成功后订单变为 `paid`，会员变为 `trial`。
