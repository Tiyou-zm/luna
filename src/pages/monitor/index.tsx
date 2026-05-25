import Taro, {useShareAppMessage, useShareTimeline} from '@tarojs/taro'
import {withRouteGuard} from '@/components/RouteGuard'

// 即将上线的趋势研究功能介绍
const COMING_FEATURES = [
  {
    icon: 'i-mdi-fire',
    title: '热点追踪',
    desc: '实时追踪各平台热点内容规律，发现行业爆款选题',
  },
  {
    icon: 'i-mdi-chart-line',
    title: '趋势预测',
    desc: '基于公开内容规律，预判下一波流行方向',
  },
  {
    icon: 'i-mdi-magnify',
    title: '竞品分析',
    desc: '分析同行高互动内容的结构和规律',
  },
  {
    icon: 'i-mdi-calendar-clock',
    title: '发布节奏建议',
    desc: '基于平台流量规律，推荐最佳内容发布时间',
  },
]

function TrendResearchPage() {
  useShareAppMessage(() => ({title: 'Luna AI — 趋势研究'}))
  useShareTimeline(() => ({title: 'Luna AI — 趋势研究'}))

  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <div className="bg-gradient-hero px-6 pt-10 pb-8">
        <div className="flex items-center gap-2 mb-3">
          <div className="i-mdi-trending-up text-3xl text-white" />
          <span className="text-3xl font-bold text-white">趋势研究</span>
          <span className="px-2 py-0 text-xl font-bold border border-white" style={{background: 'hsl(var(--accent))'}}>即将上线</span>
        </div>
        <p className="text-xl leading-relaxed" style={{color: 'rgba(255,255,255,0.65)'}}>
          深度分析各平台内容规律和热点趋势，让每次创作都踩在流量节点上
        </p>
        <div className="mt-4 px-3 py-2 border" style={{borderColor: 'rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.06)'}}>
          <p className="text-xl" style={{color: 'rgba(255,255,255,0.5)'}}>
            Luna 基于用户提供素材、公开信息和平台内容规律生成建议
          </p>
        </div>
      </div>

      {/* 即将上线功能 */}
      <div className="px-4 pt-6">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-1 h-5" style={{background: 'hsl(var(--accent))'}} />
          <span className="text-2xl font-bold text-foreground">即将推出</span>
        </div>
        <div className="flex flex-col gap-4">
          {COMING_FEATURES.map((feat, i) => (
            <div key={i} className="border border-border bg-card shadow-card px-4 py-4">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0" style={{background: 'hsl(var(--primary))'}}>
                  <div className={`${feat.icon} text-2xl text-white`} />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-2xl font-bold text-foreground">{feat.title}</span>
                    <span className="px-2 py-0 text-xl border border-border text-muted-foreground">开发中</span>
                  </div>
                  <p className="text-xl text-muted-foreground leading-relaxed">{feat.desc}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 当前可用替代入口 */}
      <div className="px-4 pt-6 pb-8">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-1 h-5" style={{background: 'hsl(var(--accent))'}} />
          <span className="text-2xl font-bold text-foreground">现在就能用</span>
        </div>
        <div className="border border-border bg-accent rounded-xl px-4 py-5 shadow-card">
          <p className="text-xl font-bold text-white mb-2">方向热点生成素材包</p>
          <p className="text-xl leading-relaxed mb-4" style={{color: 'rgba(255,255,255,0.7)'}}>
            输入行业方向（母婴/美妆/餐饮…），Luna 基于公开信息和平台内容规律，分析热点方向并直接生成可用的多平台素材包。
          </p>
          <button
            type="button"
            className="w-full border-2 border-white rounded-xl flex items-center justify-center leading-none text-xl font-bold text-white"
            style={{background: 'hsl(var(--accent))', padding: 0}}
            onClick={() => Taro.navigateTo({url: '/pages/package-create/index?mode=direction'})}
          >
            <div className="py-4 flex items-center gap-2">
              <div className="i-mdi-creation text-xl text-white" />
              <span>立即体验方向热点生成</span>
            </div>
          </button>
        </div>
      </div>
    </div>
  )
}

export default withRouteGuard(TrendResearchPage)
