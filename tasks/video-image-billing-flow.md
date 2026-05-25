# 主Agent（ClawSolo）视频/图片生成计费消耗全流程调查报告

## 一、整体架构（两阶段扣费）

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│  用户在小程序对话页发送消息："生成一段10秒宣传视频"                    │
└────────────────────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌────────────────────────────────────────────────────────────────────────────────────┐
│  [阶段一] 预检拦截（发给 Hermes 之前）                                    │
│  1. detectIntentFromMessage()：从用户输入判断意图类型 (video/image/text)             │
│  2. preflightCheck()：拦截明显不满足的请求（配额/余额/权限）                    │
└────────────────────────────────────────────────────────────────────────────────────┘
                                │
          是                       ▼ 否（被拦截，返回提示，不调用Hermes）
┌────────────────────────────────────────────────────────────────────────────────────┐
│  调用 Hermes Agent (152.136.47.2:8642)                                │
│  发送 SYSTEM_PROMPT + 历史消息 + 当前消息                             │
│  Hermes 生成视额/图片内容，在回复末尾追加 LUNA_META 标记                │
└────────────────────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌────────────────────────────────────────────────────────────────────────────────────┐
│  [阶段二] 实际扣费（收到 Hermes 回复后）                                   │
│  1. extractActualUsage()：从 rawReply 读取实际视频秒数/图片张数       │
│  2. processDeduct()：更新 profiles（余额、已用配额）+写入 usage_records   │
│  3. 若竞态欠账，在回复后追加⚠️提示                                      │
└────────────────────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌────────────────────────────────────────────────────────────────────────────────────┐
│  返回给小程序前端：{reply, tokens, model, usage}                            │
│  前端通过流式打字展示，并保存消息到 messages 表                            │
│  用户在「消耗记录」页查看明细                                         │
└────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 二、阶段一：预检拦截详细流程

### 2.1 意图识别（`detectIntentFromMessage`）

位置：`supabase/functions/arkclaw_chat/index.ts:27-44`

| 检测条件 | 意图类型 |
|---------|---------|
| 含“视额”+生成类动词，或 `generate.*video` | `video` |
| 含“图片/海报/封面”+生成类动词，或 `generate.*image` | `image` |
| 不匹配上述 | `text` |

**例子：**
- `"生成一个宣传视频"` → `video`
- `"画一张海报"` → `image`
- `"分析粉丝画像"` → `text`

### 2.2 配额余额预检（`preflightCheck`）

位置：`supabase/functions/arkclaw_chat/index.ts:56-104`

预检采用**保守估算**：视额拟算4秒，图片估算1张，用于保证即使表达不准也能拦截明显不足的情况。

```
┌────────────────────────────────────────────────────────────┐
│                    video 意图                                   │
├────────────────────────────────────────────────────────────┤
│  是────────────────────────────────────────────────────────────┤
│  · 套餐支持视额生成？(拦截: 免费版不支持)              │
│  · 已用视额秒数 < 配额秒数？                        │
│  · 余额 >= 5秒×0.8（保守估算¤4.00）？                     │
├────────────────────────────────────────────────────────────┤
│                    image 意图                                   │
├────────────────────────────────────────────────────────────┤
│  · 已用图片张数 < 配额张数？                        │
│  · 余额 >= 1张×0.06（保守估算¤0.06）？                     │
├────────────────────────────────────────────────────────────┤
│                    text 意图                                   │
├────────────────────────────────────────────────────────────┤
│  · free 用户检查 ai_count < 8？                        │
└────────────────────────────────────────────────────────────┘
```

### 2.3 套餐配额表

位置：`supabase/functions/arkclaw_chat/index.ts:12-19`

| 套餐 | 视额秒数 | 图片张数 |
|------|---------|---------|
| free | 0 | 8 |
| graphic | 0 | 50 |
| video_starter | 120 | 40 |
| video_pro | 280 | 30 |
| professional | 800 | 60 |
| enterprise | 1200 | 100 |

**前端也需保持同步** → 如果前后台不一致会出现拦截断裂。

---

## 三、Hermes Agent 调用与 LUNA_META 约定

### 3.1 SYSTEM_PROMPT 中的上报约定

位置：`supabase/functions/arkclaw_chat/index.ts:345-363`

Hermes 收到的 SYSTEM_PROMPT 明确要求：

```
每次成功完成视额或图片生成后，
必须在回复的最末尾追加以下格式的标记，
用户界面会自动隐藏该标记，不会展示给用户：

视额生成完成时追加：
<!--LUNA_META:{"type":"video","duration_seconds":8,"model":"seedance"}-->

图片生成完成时追加：
<!--LUNA_META:{"type":"image","count":2,"model":"seedream"}-->
```

### 3.2 Hermes API 调用

位置：`supabase/functions/arkclaw_chat/index.ts:444-473`

```
POST http://152.136.47.2:8642/v1/chat/completions
Authorization: Bearer <API_KEY>
Body: { model: 'hermes-agent', messages, stream: false, max_tokens: 2048, temperature: 0.7 }
```

主模型失败时降级重试一次（同端口只有一个模型，这里是防御性逻辑）。

---

## 四、阶段二：实际扣费详细流程

### 4.1 从回复提取实际用量（`extractActualUsage`）

位置：`supabase/functions/arkclaw_chat/index.ts:133-192`

采用三层优先级查找：

| 优先级 | 来源 | 示例 |
|-------|------|------|
| P1 | 回复末尾的 `<!--LUNA_META:{...}-->` 标记 | `视额8秒, seedance` |
| P2 | Hermes API 层的 `metadata` / `generation_info` 字段 | Hermes 服务器透传 |
| P3 | 回复文本中的正则匹配 | `已生成 8 秒视额` |
| 跴底 | 无法确认生成则降级为 `text` | 不扣视额/图片配额 |

**视额降级逻辑：**
- 文本中匹配到秒数 → 用该秒数
- 文本中出现 `.mp4` / `.mov` / `.webm` 链接 → 默认5秒
- 以上均不匹配 → 降级为 `text`，不扣视额配额

**图片降级逻辑：**
- 文本中匹配到张数 → 用该张数
- 文本中出现 `.jpg` / `.png` / `.webp` 链接 → 默认1张
- 以上均不匹配 → 降级为 `text`，不扣图片配额

### 4.2 扣费执行（`processDeduct`）

位置：`supabase/functions/arkclaw_chat/index.ts:212-327`

**1. 文字对话**
- free 用户：`profiles.ai_count += 1`
- 写入 usage_records: `type='text', unit='tokens', amount_deducted=0, from_plan=true`

**2. 视额扣费**
- 配额二次确认（防竞态）
- 金额 = `seconds × 0.8`
- 更新 `profiles.video_seconds_used += seconds`
- 更新 `profiles.balance -= 金额`
- 写入 usage_records: `type='video', unit='seconds', amount_deducted=金额, from_plan=true`

**3. 图片扣费**
- 配额二次确认（防竞态）
- 金额 = `count × 0.06`
- 更新 `profiles.graphic_count_used += count`
- 更新 `profiles.balance -= 金额`
- 写入 usage_records: `type='image', unit='count', amount_deducted=金额, from_plan=true`

### 4.3 竞态欠账处理

当内容已生成但扣费失败时：

```
1. 写入 usage_records（amount_deducted=0, from_plan=false）
2. raw_response 标注 `[竞态欠账] 配额不足` 或 `[竞态欠账] 余额不足`
3. 在回复结尾追加 ⚠️ 提示：
   “本次生成内容已完成，但扣费未成功（...）。
    请补足余额或套餐配额，否则后续请求将被拦截。”
```

---

## 五、数据存储模型

### 5.1 profiles 表（用户档案）

```
membership_level        TEXT     -- 套餐级别
ai_count                INTEGER  -- free 用户已用对话次数
balance                 NUMERIC  -- 算力余额（元）
video_seconds_used      INTEGER  -- 已用视额秒数
graphic_count_used      INTEGER  -- 已用图片张数
```

### 5.2 usage_records 表（消耗明细）

位置：`supabase/migrations/00010_add_usage_tracking.sql:9-22`

| 字段 | 说明 |
|------|------|
| type | `video` / `image` / `text` |
| quantity | 视额:秒数, 图片:张数, 文字:tokens |
| unit | `seconds` / `count` / `tokens` |
| amount_deducted | 实际扣费金额（元） |
| balance_before | 扣费前余额 |
| balance_after | 扣费后余额 |
| from_plan | `true`=套餐配额, `false`=余额扣减或欠账 |
| raw_response | Hermes 原始回复片段（用于核对） |

### 5.3 RLS 策略

```sql
-- 用户只能查看自己的记录
SELECT USING (user_id = auth.uid())

-- 写入不受限制（依赖服务端控制 user_id）
INSERT WITH CHECK (true)
```

---

## 六、价格体系

位置：`supabase/functions/arkclaw_chat/index.ts:21-23`

| 服务 | 单价 | 说明 |
|------|------|------|
| 视额生成 | 0.80 元/秒 | Seedance 系列 |
| 图片生成 | 0.06 元/张 | Seedream 系列 |
| 文字对话 | 0 元 | free 限 8 次，付费不限 |

**预检估算：**
- 视额按 5 秒估算 = 5 × 0.8 = 4.00 元
- 图片按 1 张估算 = 1 × 0.06 = 0.06 元

---

## 七、前端展示

### 7.1 消耗记录页（`src/pages/usage-records/index.tsx`）

每条记录显示：
- 类型标签：视额 / 图片 / 文字
- 数量：8 秒、共 2 张、�d 128 tokens
- 扣费状态：
  - `套餐配额` 标签 → `from_plan=true`
  - `- ¥X.XX` → `余额扣减`
  - `欠账未扣` 红色标签 → `from_plan=false && amount_deducted=0`
- 余额变化：`¥balance_before → ¥balance_after`
- raw_response 点击展开查看

### 7.2 消耗记录的调用链路

位置：`src/db/api.ts:426-467`

```
getUserUsageRecords(userId, limit, offset) → Supabase SELECT
→ 按 created_at 倒序
→ 带分页功能
```

---

## 八、安全与竞态考量

### 8.1 多重拦截

1. **前端预检（chat/index.tsx:186）**：free 用户 `ai_count >= 8` 则不发请求
2. **后端预检（arkclaw_chat:402-410）**：意图识别 + 配额/余额检查
3. **后端二次确认（processDeduct）**：内容生成后再确认一次配额和余额

### 8.2 负债追踪

每次拒绝或欠账，都写入 `usage_records`：
- 前端拦截 → `model='client-preflight'`
- 后端预检拦截 → 暂时未写（前方缺失，已修复）
- 竞态欠账 → `raw_response='[竞态欠账] ...'`

### 8.3 单价更新

`PRICE_VIDEO_PER_SECOND` 和 `PRICE_IMAGE_PER_COUNT` 是 Edge Function 中的常量，单价变更需要重新部署。

---

## 九、关键文件清单

| 文件 | 责任 |
|------|------|
| `supabase/functions/arkclaw_chat/index.ts` | 主扣费逻辑（两阶段架构） |
| `supabase/functions/ai_chat/index.ts` | 备用对话接口（同步写记录） |
| `src/pages/chat/index.tsx` | 前端发送 + 前端预检 |
| `src/pages/usage-records/index.tsx` | 消耗明细展示 |
| `src/db/api.ts` | usage_records 查询 API |
| `src/db/types.ts` | UsageRecord 类型定义 |
| `supabase/migrations/00010_add_usage_tracking.sql` | 数据库表结构 |
