// @title 关于我们
import Taro from '@tarojs/taro'
import {LunaAvatar} from '@/components/LunaAvatar'

const APP_VERSION = '2.0.0'
const BUILD_DATE = '2026-04-28'
const SUPPORT_EMAIL = 'phantomfuture@126.com'

export default function AboutPage() {
  const handleContactEmail = () => {
    Taro.setClipboardData({
      data: SUPPORT_EMAIL,
      success: () => Taro.showToast({title: '邮箱已复制，请发送邮件联系客服', icon: 'none', duration: 3000})
    })
  }

  return (
    <div className="min-h-screen bg-background pb-8">
      {/* ===品牌展示区=== */}
      <div className="relative overflow-hidden" style={{minHeight: '260px'}}>
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: 'linear-gradient(135deg, hsl(210 95% 58% / 0.95) 0%, hsl(243 67% 52% / 0.94) 48%, hsl(263 60% 40% / 0.96) 100%), linear-gradient(rgba(255,255,255,0.16) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.12) 1px, transparent 1px)',
            backgroundSize: '100% 100%, 18px 18px, 18px 18px'
          }}
        >
          <div
            className="absolute inset-0"
            style={{background: 'linear-gradient(180deg, hsl(243 67% 52% / 0.7) 0%, hsl(263 60% 40% / 0.85) 60%, hsl(243 30% 12% / 0.95) 100%)'}}
          />
        </div>
        <div className="relative flex flex-col items-center pt-12 pb-8 px-6">
          <div
            className="mb-4 flex items-center justify-center"
            style={{
              width: '88px', height: '88px',
              background: 'rgba(255,255,255,0.15)',
              border: '3px solid rgba(255,255,255,0.4)',
              borderRadius: '20px',
              boxShadow: '0 0 0 6px rgba(255,255,255,0.08), 4px 4px 0 rgba(0,0,0,0.3)'
            }}
          >
            <LunaAvatar size={72} iconSize={42} />
          </div>
          <h1 className="font-bold text-white mb-1 text-center tracking-wider" style={{fontSize: '36px', textShadow: '3px 3px 0 rgba(0,0,0,0.4)', letterSpacing: '4px'}}>
            Luna AI
          </h1>
          <p className="text-xl text-white/80 mb-4 text-center">自媒体创作者的AI工作站</p>
          <div style={{padding: '4px 16px', background: 'rgba(255,255,255,0.2)', border: '2px solid rgba(255,255,255,0.35)', borderRadius: '6px', boxShadow: '2px 2px 0 rgba(0,0,0,0.25)'}}>
            <span className="text-xl text-white font-bold tracking-widest">v{APP_VERSION}</span>
          </div>
          <div className="flex items-center gap-3 mt-6">
            {['#A29BFE', '#6C5CE7', '#74B9FF', '#A29BFE', '#6C5CE7'].map((color, i) => (
              <div key={i} style={{width: '10px', height: '10px', background: color, boxShadow: '1px 1px 0 rgba(0,0,0,0.3)', transform: 'rotate(45deg)'}} />
            ))}
          </div>
        </div>
      </div>

      {/* 版本信息 */}
      <div className="mx-4 mt-4 bg-card shadow-card border border-border rounded-2xl overflow-hidden">
        {[
          {label: '当前版本', value: `v${APP_VERSION}`},
          {label: '更新日期', value: BUILD_DATE},
          {label: '适用平台', value: '微信小程序 / H5'}
        ].map((item, idx, arr) => (
          <div key={item.label} className={`flex items-center justify-between px-5 py-4 ${idx < arr.length - 1 ? 'border-b border-border' : ''}`}>
            <span className="text-2xl text-foreground">{item.label}</span>
            <span className="text-xl text-muted-foreground">{item.value}</span>
          </div>
        ))}
      </div>

      {/* 法律文件 */}
      <div className="mx-4 mt-4 bg-card shadow-card border border-border rounded-2xl overflow-hidden">
        {[
          {label: '用户服务协议', icon: 'i-mdi-file-document-outline'},
          {label: '隐私政策', icon: 'i-mdi-shield-lock-outline'},
          {label: '免责声明', icon: 'i-mdi-alert-outline'}
        ].map((item, idx, arr) => (
          <div key={item.label} className={`flex items-center gap-4 px-5 py-4 ${idx < arr.length - 1 ? 'border-b border-border' : ''}`}>
            <div className={`${item.icon} text-primary`} style={{fontSize: '22px'}} />
            <span className="flex-1 text-2xl font-medium text-foreground">{item.label}</span>
            <div className="i-mdi-chevron-right text-muted-foreground" style={{fontSize: '20px'}} />
          </div>
        ))}
      </div>

      {/* 联系我们 */}
      <div className="mx-4 mt-4 bg-card shadow-card border border-border rounded-2xl overflow-hidden">
        <div className="flex items-center gap-4 px-5 py-4 border-b border-border" onClick={handleContactEmail}>
          <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center flex-shrink-0">
            <div className="i-mdi-email-outline text-primary" style={{fontSize: '22px'}} />
          </div>
          <div className="flex-1">
            <p className="text-2xl font-medium text-foreground">联系客服</p>
            <p className="text-xl text-muted-foreground">{SUPPORT_EMAIL}</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className="text-xl text-muted-foreground">7×12小时在线</span>
            <div className="flex items-center gap-1">
              <div className="i-mdi-content-copy text-primary" style={{fontSize: '14px'}} />
              <span className="text-xl text-primary">点击复制邮箱</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4 px-5 py-4" onClick={() => Taro.switchTab({url: '/pages/service/index'})}>
          <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center flex-shrink-0">
            <div className="i-mdi-headset text-primary" style={{fontSize: '22px'}} />
          </div>
          <span className="flex-1 text-2xl font-medium text-foreground">在线客服</span>
          <div className="i-mdi-chevron-right text-muted-foreground" style={{fontSize: '20px'}} />
        </div>
      </div>

      {/* 版权信息 */}
      <div className="px-6 py-6 text-center">
        <p className="text-xl text-muted-foreground">© 2026 Luna AI. All Rights Reserved.</p>
        <p className="text-xl text-muted-foreground mt-1">为自媒体创作者提供最优质的AI工具</p>
      </div>
    </div>
  )
}
