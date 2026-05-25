# 生图生视频算力消耗计费调查报告

## 一、当前系统现状（已发现的问题）

### 1.1 【严重】双重扣费漏洞

**现象：**有套餐的用户发生成请求时，系统同时扣减了**套餐配额**（`video_seconds_used` / `graphic_count_used`）和**算力余额**（`balance`）。

**代码位置：**`supabase/functions/arkclaw_chat/index.ts:268-272`

```typescript
const newBalance = currentBalance - cost
await supabase.from('profiles').update({
  video_seconds_used: videoUsed + usage.quantity,  // 又扣配额
  balance: newBalance                                // 又扣余额！！
}).eq('id', userId)
```

**影响：**
- 套餐用户被收了两份钱：一份是套餐费，一份是算力费
- PRD明确规定："套餐配额消耗时，不扣减算力余额，仅扣减套餐配额"

### 1.2 【严重】价格硬编码

**现象：**视额/图片生成的扣费单价是写死在代码中的常量，未与火山引擎实际报价对接。

**代码位置：**`supabase/functions/arkclaw_chat/index.ts:21-23`

```typescript
const PRICE_VIDEO_PER_SECOND = 0.8  // 种子数据，未接入实际API
const PRICE_IMAGE_PER_COUNT  = 0.06 // 种子数据，未接入实际API
```

**影响：**
- PRD要求"按火山引擎实际报价扣减"，实际是经营者自己定价
- 价格变动需要重新部署 Edge Function
- 无法与火山引擎实际账单对账

### 1.3 【中等】缺少统一算力计量单位

**现象：**系统中没有将生成内容（文字、图片、视额）转换为统一的"算力点数"单位。

**影响：**
- 用户充值页面说"1算力积分 ≈ 100万Tokens"，但生成视额/图片时扣的是人民币
- `算力余额` 与 `元` 混淆，用户理解困难
- 不便于对外报价和对账

### 1.4 【中等】配额余额优先级不清晰

**现象：**预检逻辑同时检查配额和余额，但没有明确优先级。

**影响：**
- PRD明确：先扣配额 → 配额用尽才扣算力余额
- 当前逻辑导致有套餐的用户也被扣了算力，体验差

---

## 二、PRD 规定的正确计费流程

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│  用户发起视额/图片生成请求                                     │
└───────────────────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
              ┌──────────────────────────────┐
              │  检查套餐配额是否足够              │
              └──────────────────────────────┘
                    │              │
              是   ▼              ▼  否
          ┌─────────┐        ┌──────────────────────────────┐
          │ 只扣配额 │        │ 检查算力余额是否足够    │
          │ 不扣balance│        └──────────────────────────────┘
          └─────────┘                    │              │
                                     是   ▼              ▼  否
                                 ┌────────────┐        ┌────────────────┐
                                 │ 扣算力余额     │        │ 拦截：余额不足  │
                                 │ 按实际价格    │        │ 提示充值      │
                                 └────────────┘        └────────────────┘
```

**PRD 4.21 配额消耗与计费分离规则：**

> - 套餐配额消耗：用户使用套餐内的图文条数与视额时长配额时，不扣减算力余额，仅扣减套餐配额
> - 算力余额扣减：用户单独充值的算力余额仅在套餐配额用尽后使用，按火山引擎实际报价扣减
> - 配额与算力余额独立计算，互不影响

---

## 三、推荐修复方案

### 方案A：立即修复版（保持现有架构，仅修逻辑）

**核心改动：**修复 `processDeduct` 函数，使其符合 PRD 规则。

```typescript
// 视额扣费新逻辑
if (usage.type === 'video') {
  const quotaRemaining = quota.videoSeconds - videoUsed

  if (quotaRemaining >= usage.quantity) {
    // 【情况1】配额足够：只扣配额，不扣balance
    await supabase.from('profiles').update({
      video_seconds_used: videoUsed + usage.quantity
    }).eq('id', userId)
    await supabase.from('usage_records').insert({
      user_id: userId, type: 'video', model: usage.model,
      quantity: usage.quantity, unit: 'seconds',
      amount_deducted: 0, from_plan: true,  // 从套餐配额
      balance_before: currentBalance, balance_after: currentBalance,
      raw_response: replySnippet.slice(0, 500)
    })
    return {blocked: false, type: 'video', quantity: usage.quantity, amountDeducted: 0, fromPlan: true}
  } else {
    // 【情况2】配额不足：配额部分免费，超出部分扣算力
    const freePart = quotaRemaining        // 配额内免费
    const paidPart = usage.quantity - freePart // 超出部分按实际价格

    if (paidPart > 0) {
      const cost = paidPart * PRICE_VIDEO_PER_SECOND
      if (currentBalance < cost) {
        // 算力不足拦截
        return {blocked: true, reason: `算力余额不足（配额已用尽${quota.videoSeconds}秒，本次需扣${paidPart}秒×0.8=¥${cost.toFixed(2)}）`, ...}
      }
      const newBalance = currentBalance - cost
      // 先扣完配额
      await supabase.from('profiles').update({
        video_seconds_used: quota.videoSeconds // 配额扣到0
      }).eq('id', userId)
      // 再扣算力
      await supabase.from('profiles').update({
        balance: newBalance
      }).eq('id', userId)
      await supabase.from('usage_records').insert({
        user_id: userId, type: 'video', model: usage.model,
        quantity: usage.quantity, unit: 'seconds',
        amount_deducted: cost, from_plan: false,  // 从算力余额
        balance_before: currentBalance, balance_after: newBalance,
        raw_response: `配额${freePart}秒免费 + 算力${paidPart}秒×0.8=¥${cost.toFixed(2)} | ${replySnippet.slice(0, 300)}`
      })
      return {blocked: false, type: 'video', quantity: usage.quantity, amountDeducted: cost, fromPlan: false}
    }
  }
}
```

**优点：**
- 修复快，不需要改数据库
- 立即解决双重扣费问题

**缺点：**
- 价格仍然硬编码
- 算力余额与元混淆问题仍然存在

---

### 方案B（推荐）：引入统一算力计量体系

**核心设计：**将生成内容转换为统一的"算力点数"，`平衡`以"算力点数"为单位存储。

**算力兑换表（建议）：**

| 服务类型 | 计量单位 | 算力点数 |
|---------|---------|---------|
| 文字对话 | 1 Token | 0.003 算力点 |
| 图片生成 | 1 张 | 6 算力点 |
| 视额生成 | 1 秒 | 80 算力点 |

> 说明：100算力点 ≈ 1元人民币，与充值页面的"算力积分"保持一致。

**数据库调整：**
1. `profiles.balance` 保持不变（将其理解为"算力点数"）
2. 新增 `model_pricing` 配置表（可配置算力兑换率）
3. `usage_records` 新增 `compute_points` 字段（记录每次消耗的算力点数）

**扣费逻辑新版：**

```typescript
// 1. 计算本次消耗的算力点数
const computePoints = usage.quantity * COMPUTE_RATE[usage.type] // 视额: 秒×80, 图片: 张×6

// 2. 检查套餐配额
const quotaRemaining = getQuotaRemaining(profile, usage.type)

if (quotaRemaining >= usage.quantity) {
  // 配额足够：免费，只扣配额
  await deductQuota(userId, usage.type, usage.quantity)
  await recordUsage(userId, usage, {computePoints, amountDeducted: 0, fromPlan: true})
} else {
  // 配额不足：配额免费 + 超出部分扣算力
  const paidQuantity = usage.quantity - quotaRemaining
  const paidPoints = paidQuantity * COMPUTE_RATE[usage.type]

  if (profile.balance < paidPoints) {
    return {blocked: true, reason: '算力不足，请充值'}
  }

  await deductQuota(userId, usage.type, quotaRemaining) // 扣完配额
  await deductBalance(userId, paidPoints)                // 扣算力
  await recordUsage(userId, usage, {computePoints: paidPoints, amountDeducted: paidPoints/100, fromPlan: false})
}
```

**优点：**
- 算力余额单位统一为"算力点数"，与充值页面一致
- 价格变动时只需调整 `model_pricing` 表，不用重新部署
- 便于与火山引擎对账（按算力点数对账）
- 支持记录每次生成的算力点数消耗

**缺点：**
- 需要新增数据库表
- 需要调整充值/余额展示逻辑
- 工作量较大

---

### 方案C（最简单）：仅修复双重扣费

**改动点：**只是在扣配额的时候不扣 balance，其他保持不变。

```typescript
// 视额扣费
if (usage.type === 'video') {
  const cost = usage.quantity * PRICE_VIDEO_PER_SECOND
  const newBalance = currentBalance - cost

  // ❌ 原来：同时更新配额和余额
  // await supabase.from('profiles').update({
  //   video_seconds_used: videoUsed + usage.quantity,
  //   balance: newBalance
  // })

  // ✅ 修复：先检查配额是否足够
  if (videoUsed + usage.quantity <= quota.videoSeconds) {
    // 配额足够：只扣配额
    await supabase.from('profiles').update({
      video_seconds_used: videoUsed + usage.quantity
    }).eq('id', userId)
    // 不改变 balance！
  } else {
    // 配额不足：扣算力余额
    await supabase.from('profiles').update({
      balance: newBalance
    }).eq('id', userId)
  }
}
```

**优点：**
- 修复最快，代码最少

**缺点：**
- 配额用尽后的提示还不完善
- 何时切换到算力扣减的体验不好

---

## 四、数据存储对比

### 现有数据流

```
充值流程：
  充值¥50 → compute_recharges 记录订单
  支付成功 → wechat_payment_callback 更新 profiles.balance += 65
  （balance 单位 = 元，但前端显示为"算力积分"）

扣费流程（当前错误版）：
  视额生成 10秒 → 扣配额 10秒 + 扣余额 ¥8.0
  （套餐用户被收了两份钱）
```

### 修复后数据流（方案A）

```
扣费流程：
  套餐内：视额生成 10秒 → 只扣配额 10秒，balance 不变
  套餐外：视额生成 10秒 → 配额免费 + 超出部分扣 balance
```

### 修复后数据流（方案B）

```
充值流程：
  充值¥50 → 获得 6500 算力点（余额存储为算力点数）

扣费流程：
  套餐内：视额生成 10秒 → 只扣配额，balance 不变
  套餐外：视额生成 10秒 → 配额免费 + 超出部分扣 800 算力点
```

---

## 五、修复建议

**短期（立即）：**采用方案C修复双重扣费漏洞，修改 `processDeduct` 中视额/图片扣费逻辑，使其在配额足够时不扣减 balance。

**中期（2-3周）：**采用方案A完善配额不足时的扣费逻辑，实现"配额免费+超出算力"的混合扣费。

**长期（1-2月）：**采用方案B引入统一算力计量体系，建设 `model_pricing` 配置表，支持动态价格调整。
