import {useState} from 'react'
import Taro, {useShareAppMessage, useShareTimeline} from '@tarojs/taro'
import {Image} from '@tarojs/components'

// 核心功能模块
const CORE_FEATURES = [
  {
    icon: 'i-mdi-layers-outline',
    title: '多平台素材包生成',
    tag: '核心功能',
    desc: '上传产品图、文案、活动信息，或直接告诉 Luna 行业方向，一键生成适配小红书、抖音、视频号、公众号的完整内容方案。',
    bullets: [
      '标题方案：每平台 3 条差异化标题',
      '正文脚本：平台调性定制，字数精准控制',
      '封面建议：视觉策略 + 图片提示词',
      '话题标签：精选高流量标签组合',
      '发布时间建议 + 投放策略',
    ],
    accent: true,
  },
  {
    icon: 'i-mdi-trending-up',
    title: '热点方向分析',
    tag: '趋势研究',
    desc: '输入行业方向，Luna 基于公开信息和平台内容规律，分析当前热点趋势，输出可直接执行的内容方向和选题建议。',
    bullets: [
      '母婴、美妆、餐饮、民宿等 20+ 行业',
      '平台热点分析 + 选题方向推荐',
      '竞品内容规律总结',
      '直接生成素材包落地执行',
    ],
    accent: false,
  },
  {
    icon: 'i-mdi-compare-horizontal',
    title: '多平台内容适配',
    tag: '风格差异化',
    desc: '同一个产品，不同平台需要完全不同的内容风格。Luna 自动适配各平台的调性、字数、格式规范，一次输入，四端输出。',
    bullets: [
      '小红书：标题党 + 生活化语气 + 长标签',
      '抖音：口播脚本 + 节奏感 + 短钩子',
      '视频号：微信生态语气 + 私域导流逻辑',
      '公众号：深度内容 + SEO 标题 + 图文排版',
    ],
    accent: false,
  },
  {
    icon: 'i-mdi-palette-outline',
    title: '图片提示词生成',
    tag: '创意辅助',
    desc: '每个平台方案都附带图片创作提示词，中英文双语，可直接用于 Midjourney、Stable Diffusion、即梦等 AI 绘图工具。',
    bullets: [
      '中文描述 + 英文 Prompt 双语输出',
      '适配封面尺寸（3:4 竖版为主）',
      '风格词精准：写实、插画、产品图、人物出镜',
    ],
    accent: false,
  },
]

// 使用流程
const FLOW_STEPS = [
  {num: '01', title: '选择模式', desc: '用户提供 或 方向生成'},
  {num: '02', title: '输入内容', desc: '上传图片/文案，或输入行业方向'},
  {num: '03', title: '选择平台', desc: '小红书 / 抖音 / 视频号 / 公众号'},
  {num: '04', title: '一键生成', desc: 'Luna 生成完整四平台素材包'},
  {num: '05', title: '复制使用', desc: '一键复制各平台内容，即可发布'},
]

// 平台覆盖
const PLATFORMS = [
  {name: '小红书', icon: 'i-mdi-flower-outline', desc: '图文 / 笔记'},
  {name: '抖音',   icon: 'i-mdi-music-note-outline', desc: '短视频脚本'},
  {name: '视频号', icon: 'i-mdi-wechat', desc: '微信生态'},
  {name: '公众号', icon: 'i-mdi-newspaper-variant-outline', desc: '图文长文'},
]

function FeaturesPage() {
  const [expanded, setExpanded] = useState<number | null>(0)

  useShareAppMessage(() => ({title: 'Luna AI — 多平台素材包生成工作台'}))
  useShareTimeline(() => ({title: 'Luna AI — 多平台素材包生成工作台'}))

  return (
    <div className="min-h-screen bg-background pb-10">
      {/* Hero */}
      <div className="bg-gradient-hero px-6 pt-8 pb-8">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-3xl font-bold text-white tracking-wide">Luna AI</span>
          <span className="px-2 py-0 bg-accent text-white text-xl font-bold border border-white">BETA</span>
        </div>
        <p className="text-2xl font-bold text-white mb-2">多平台素材包生成工作台</p>
        <p className="text-xl leading-relaxed" style={{color: 'rgba(255,255,255,0.65)'}}>
          从用户提供文件或行业方向出发，一次输入，生成小红书 / 抖音 / 视频号 / 公众号的完整内容方案。
        </p>
        <div className="mt-4 px-3 py-2 border" style={{borderColor: 'rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.06)'}}>
          <p className="text-xl" style={{color: 'rgba(255,255,255,0.5)'}}>
            Luna 基于用户提供信息、公开信息和平台内容规律生成建议
          </p>
        </div>
      </div>

      {/* 平台覆盖 */}
      <div className="px-4 pt-6">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-1 h-5" style={{background: 'hsl(var(--accent))'}} />
          <span className="text-2xl font-bold text-foreground">四平台全覆盖</span>
        </div>
        <div className="grid gap-3" style={{gridTemplateColumns: '1fr 1fr'}}>
          {PLATFORMS.map((p) => (
            <div
              key={p.name}
              className="border border-border bg-card flex flex-col items-center py-5 gap-2 shadow-card rounded-xl"
            >
              <div className={`${p.icon} text-3xl text-primary`} />
              <span className="text-2xl font-bold text-foreground">{p.name}</span>
              <span className="text-xl text-muted-foreground">{p.desc}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 核心功能 */}
      <div className="px-4 pt-6">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-1 h-5" style={{background: 'hsl(var(--accent))'}} />
          <span className="text-2xl font-bold text-foreground">核心功能</span>
        </div>
        <div className="flex flex-col gap-4">
          {CORE_FEATURES.map((feat, i) => (
            <div key={i} className="border border-border bg-card shadow-card rounded-2xl overflow-hidden">
              {/* 标题栏 */}
              <div
                className="flex items-center justify-between px-4 py-4"
                style={{background: feat.accent ? 'hsl(var(--accent))' : 'hsl(var(--primary))'}}
                onClick={() => setExpanded(expanded === i ? null : i)}
              >
                <div className="flex items-center gap-3">
                  <div className={`${feat.icon} text-2xl text-white`} />
                  <span className="text-2xl font-bold text-white">{feat.title}</span>
                  <span className="px-2 py-0 text-xl border border-white text-white">{feat.tag}</span>
                </div>
                <div className={`${expanded === i ? 'i-mdi-chevron-up' : 'i-mdi-chevron-down'} text-2xl text-white`} />
              </div>
              {/* 展开内容 */}
              {expanded === i && (
                <div className="px-4 py-4">
                  <p className="text-xl text-foreground leading-relaxed mb-3">{feat.desc}</p>
                  <div className="flex flex-col gap-2">
                    {feat.bullets.map((b, j) => (
                      <div key={j} className="flex items-start gap-2">
                        <div className="i-mdi-check-circle text-xl mt-1 flex-shrink-0" style={{color: 'hsl(var(--accent))'}} />
                        <span className="text-xl text-foreground">{b}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 使用流程 */}
      <div className="px-4 pt-6">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-1 h-5" style={{background: 'hsl(var(--accent))'}} />
          <span className="text-2xl font-bold text-foreground">使用流程</span>
        </div>
        <div className="flex flex-col gap-0">
          {FLOW_STEPS.map((step, i) => (
            <div key={i} className="flex items-start gap-4">
              {/* 左侧编号+竖线 */}
              <div className="flex flex-col items-center">
                <div
                  className="w-10 h-10 rounded-lg border border-border flex items-center justify-center flex-shrink-0"
                  style={{background: i === 0 ? 'hsl(var(--accent))' : 'hsl(var(--primary))'}}
                >
                  <span className="text-xl font-bold text-white">{step.num}</span>
                </div>
                {i < FLOW_STEPS.length - 1 && (
                  <div className="w-0.5 flex-1" style={{background: 'hsl(var(--border))', minHeight: '24px'}} />
                )}
              </div>
              {/* 内容 */}
              <div className="flex-1 pb-5">
                <span className="text-2xl font-bold text-foreground">{step.title}</span>
                <p className="text-xl text-muted-foreground mt-1">{step.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* CTA */}
      <div className="px-4 pt-4">
        <div
          className="border border-border bg-accent rounded-2xl px-4 py-6 shadow-card flex flex-col items-center gap-4"
          onClick={() => Taro.navigateTo({url: '/pages/package-create/index?mode=material'})}
        >
          <div className="i-mdi-creation text-4xl text-white" />
          <span className="text-2xl font-bold text-white">立即新建生成</span>
          <span className="text-xl" style={{color: 'rgba(255,255,255,0.6)'}}>免费版可体验 5 次</span>
        </div>
      </div>
    </div>
  )
}

export default FeaturesPage
