# ⚠️ 技术约束 — Hermes 为唯一 AI 后端（不可替换）

**生效日期**：2026-04-28
**约束来源**：产品方（用户）强制要求
**违反后果**：AI 对话功能将中断，业务不可用

---

## 核心约束

| 项 | 值 | 说明 |
|---|---|---|
| AI 后端 | **Hermes Agent（Luna 2.0）** | 固定不可变更 |
| 地址 | `http://152.136.47.2:8642` | 腾讯云 CVM 公网 IP |
| 接口 | `/v1/chat/completions` | OpenAI 兼容格式 |
| 模型名 | `hermes-agent` | 请求体 model 字段 |
| API Key | `bWmhP67eBZsbta58h8QRKrZT0XcPh2NJ` | Bearer Token 鉴权 |
| 服务端 | Python/3.11 aiohttp/3.13.5 | Hermes 服务端信息 |

---

## 为什么不能用文心/百度替换

1. **Hermes 是业务核心**：ClawSolo 品牌的人格、语气、功能逻辑全部内建在 Hermes 模型中
2. **Luna 2.0 专属**："我是 Luna 2.0，你的自媒体助手"是 Hermes 的固定开场白，替换后品牌断裂
3. **功能深度集成**：视频/图片生成的 LUNA_META 标记解析、意图识别、扣费逻辑与 Hermes 输出格式强绑定
4. **用户明确要求**：产品方已多次强调必须用 Hermes

---

## 网络连通性说明

- ✅ **工作区 Linux 容器**：TCP 连接成功，返回 `401 Unauthorized`（鉴权正常）
- ✅ **工作区 curl 测试**：完整对话可用，返回 Luna 2.0 回复
- ❌ **Deno Deploy（Edge Function）**：TCP 连接被网络层拦截（安全组/防火墙限制 Deno Deploy 出口 IP）

**结论**：代码正确，问题在 Hermes 服务端网络策略，需服务端放行 Deno Deploy 出口 IP。

---

## 历史记录

- **v27 错误操作**：把 `arkclaw_chat` 从文心替换为文心 → 已回滚
- **当前状态**：`arkclaw_chat` 已恢复 Hermes 调用逻辑，已重新部署

---

## 未来维护者注意

- ❌ **禁止**把 `arkclaw_chat` 中的 `callHermes` 改为 `callWenxin` 或任何其他 LLM 调用
- ❌ **禁止**修改 `SYSTEM_PROMPT` 中"由 Hermes Agent（Luna 2.0）驱动"的声明
- ❌ **禁止**修改返回的 `model` 字段（必须保持 `'hermes-agent'`）
- ✅ 网络问题只能在 Hermes 服务端（腾讯云安全组）解决，不能通过换模型绕开
