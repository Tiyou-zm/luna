# Hermes 素材包 v2 适配修改记录

日期：2026-06-04

## 1. 本次目标

根据 `luna-material-package-json-v2.md` 的最新回传协议，把 Luna 的素材生成链路从旧版“多平台文案 + 可选视频”调整为：

- 完整素材包仍作为主结果入库。
- 视频栏目不再等待真实视频文件，只展示短视频脚本、推送建议和投放逻辑。
- Worker 只把完整素材包和真实文件类资产写入素材库；文案、视频脚本、投放分析保留在完整包详情内部展示。
- 会员套餐从多档展示收敛为一个 6.66 元试用版。
- Hermes 使用 `creater-v2.8.0-fixed.tar.gz` 中的新 skill，支持更强的前置澄清和交互式任务确认。

## 2. 最新 JSON 结构识别

Worker 已支持识别以下 v2 主结构：

```text
type = material_package
version = 2.0.0
workflow
time_sensitivity
trending_research
content_strategy
content.platforms
image_prompts
assets.generated
assets.video_scripts
assets.not_generated
assets.placeholder
package_archive
qa
final_checks
```

其中 `content.platforms` 是新的平台内容入口：

- `xiaohongshu.posts` -> 小红书图文文案
- `douyin.scripts` -> 抖音短视频脚本、推送建议、投放逻辑
- `moments.posts` -> 朋友圈文案
- `wechat_public.outline` -> 公众号大纲

## 3. Worker 入库策略

主素材包仍写入 `materials` 集合，`type = work`，用于素材包结果页展示完整结果。

Worker 写入策略：

| 栏目 | 判断字段 | 入库类型 | 用途 |
| --- | --- | --- | --- |
| 完整包 | 主 `material_package` | `work` | 结果页完整预览 |
| 文案 | 小红书、朋友圈、公众号等非视频平台内容 | 不单独拆库 | 在完整包详情中展示 |
| 视频脚本 | 抖音/视频号脚本、`assets.video_scripts` | 不单独拆库 | 替换旧“视频素材”块，在完整包详情中展示脚本、推送建议、投放逻辑 |
| 投放分析 | `trending_research`、`content_strategy`、`qa`、`final_checks` | 不单独拆库 | 在完整包详情中展示 |
| 素材文件 | `assets.generated`、`assets.placeholder`、`package_archive` | `image` / `copywriting` / `archive` | 素材库素材文件栏目 |

素材文件派生记录会带上：

- `parent_material_id`：指向完整素材包。
- `library_section`：用于前端分栏。
- `platform_label`：中文平台名。
- `metadata`：保存来源字段和平台原始结构，方便后续继续扩展。

## 4. 前端素材库适配

`src/pages/materials/index.tsx` 保留两个一级入口：

- 完整包
- 素材文件

文案、视频脚本、投放分析不是一级素材库栏目，它们属于完整包内部内容，用于替换旧的视频素材块。

## 5. 结果页适配

`src/pages/package-result/index.tsx` 已补充：

- 朋友圈平台展示。
- 抖音脚本中的 `推送建议`。
- 抖音脚本中的 `投放逻辑`。
- 质检说明。

这样 v2 回传里“视频已经砍成脚本 + 推送建议 + 投放逻辑”的变化，可以直接在结果页和素材库里看到。

## 6. 对话框适配

`src/pages/chat/index.tsx` 已把任务确认话术改为 v2 流程：

- 先问产品/主题。
- 再问目标平台。
- 再问本次目标，例如曝光、转化、涨粉、活动引流。
- 再收集卖点、禁用词、素材链接。
- 明确视频只输出脚本、推送建议和投放逻辑。

用户直接发明确需求时，仍然创建异步生成任务；用户需求不完整时，Luna 会先走澄清问题，避免把低质量指令直接丢给 Hermes 跑 40 分钟。

## 7. 会员调整

`src/db/types.ts` 中新增 `trial` 会员等级，`ACTIVE_PLANS` 只暴露一个试用套餐。

`src/pages/pricing/index.tsx` 只渲染 `ACTIVE_PLANS`，当前展示唯一套餐：

- 试用版
- 价格：6.66 元
- 权益：一次完整素材包试用，含文案、脚本、投放建议与素材库归档

`cloudfunctions/createWechatPayment/index.js` 已补充 `trial` 的支付权益映射。

## 8. Hermes Skill 部署

远端 Hermes 服务器已把 `creater-v2.8.0-fixed.tar.gz` 解压到 Hermes skill 目录，并备份旧版 skill。

当前 worker 服务：

```text
/home/ubuntu/luna-hermes-worker
luna-hermes-worker.service
```

本次部署后服务已重启，状态为 active。

## 9. 需要上传的云函数

小程序端代码已经完成本地构建，但云函数需要在微信开发者工具里手动上传：

1. `lunaGuardian`
   - 更新 v2 prompt。
   - 告诉 Hermes 视频只输出脚本、推送建议和投放逻辑。
   - 用户收到“已开始制作”后，结果由后台 worker 写入素材库。

2. `createWechatPayment`
   - 更新 6.66 元试用版权益映射。

## 10. 已验证

- `workers/hermes-worker/index.cjs` 语法检查通过。
- `cloudfunctions/lunaGuardian/index.js` 语法检查通过。
- `cloudfunctions/createWechatPayment/index.js` 语法检查通过。
- 小程序安全构建通过，产物已写入 `dist/`。

## 11. 后续测试建议

1. 在微信开发者工具上传 `lunaGuardian` 和 `createWechatPayment`。
2. 重新编译小程序。
3. 工作台发送一个明确素材包需求，例如“帮我做一个小红书和抖音的新品推广素材包，视频只要脚本和投放建议”。
4. 确认对话框立即返回“已开始制作”。
5. 等 worker 完成后进入素材库，分别检查：
   - 完整包
   - 素材文件
6. 进入完整包结果页，确认文案、抖音脚本、推送建议、投放逻辑、投放分析都在完整包内部展示。

## 12. 2026-06-04 交互链路修正

工作台交互不再使用固定的“澄清 -> 大纲 -> 确认 -> 生成”状态机。

新的原则：

- Luna 只做安全边界检查和 UI 解释器。
- Hermes 原生决定当前要普通回答、追问、给大纲、请求确认，还是开始生成。
- Luna 解析 Hermes 回传的交互意图：
  - `normal_reply`：直接展示普通对话。
  - `clarify`：直接展示 Hermes 的追问。
  - `outline`：展示大纲确认卡。
  - `confirm_start`：展示开始制作确认卡。
  - `start_generation`：在用户明确确认后创建后台任务。
- Worker 只接手“用户已经确认开始制作”之后的长时间素材包生成。

确认卡点击“确认开始制作”后，前端调用 `lunaGuardian`：

```json
{
  "action": "start_generation",
  "confirmed_outline": "...",
  "pending_task": {}
}
```

云函数再创建 `generation_jobs`，由远端 worker 执行 40 分钟级别的正式素材包生成。
