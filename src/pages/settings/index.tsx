import {useState, useEffect} from 'react'
import Taro from '@tarojs/taro'
import {withRouteGuard} from '@/components/RouteGuard'

const STORAGE_KEY = 'luna_settings'

function loadSettings() {
  try {
    const raw = Taro.getStorageSync(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return {notifications: true, aiNotify: true, orderNotify: true, dataCollection: true, personalized: true}
}

function SettingsPage() {
  const [settings, setSettings] = useState(loadSettings)

  // 任何设置变更都持久化
  const update = (key: string, value: boolean) => {
    const next = {...settings, [key]: value}
    setSettings(next)
    try { Taro.setStorageSync(STORAGE_KEY, JSON.stringify(next)) } catch {}
  }

  const handleClearCache = () => {
    Taro.showModal({
      title: '清除缓存',
      content: '确认清除本地缓存数据？',
      success: ({confirm}) => {
        if (!confirm) return
        try {
          Taro.clearStorageSync()
          // 恢复设置默认值
          const defaults = {notifications: true, aiNotify: true, orderNotify: true, dataCollection: true, personalized: true}
          Taro.setStorageSync(STORAGE_KEY, JSON.stringify(defaults))
          setSettings(defaults)
          Taro.showToast({title: '缓存已清除', icon: 'success'})
        } catch {
          Taro.showToast({title: '清除失败，请重试', icon: 'none'})
        }
      }
    })
  }

  const ToggleSwitch = ({value, onChange}: {value: boolean; onChange: (v: boolean) => void}) => (
    <div
      className={`w-14 h-7 transition relative border border-border ${value ? 'bg-primary' : 'bg-muted'}`}
      onClick={() => onChange(!value)}
    >
      <div
        className={`absolute top-0.5 w-5 h-5 bg-white border border-border transition-all ${value ? 'left-7' : 'left-0.5'}`}
      />
    </div>
  )

  return (
    <div className="min-h-screen bg-background px-4 pt-4 pb-8">
      {/* 消息通知 */}
      <div className="mb-4">
        <p className="text-xl font-bold text-muted-foreground px-1 mb-2">消息通知</p>
        <div className="bg-card shadow-card border border-border rounded-2xl overflow-hidden">
          {[
            {key: 'notifications', label: '开启通知', sub: '接收所有消息提醒'},
            {key: 'aiNotify', label: 'AI生成通知', sub: '生成完成后推送提醒'},
            {key: 'orderNotify', label: '订单通知', sub: '支付成功等订单提醒'}
          ].map((item, idx, arr) => (
            <div
              key={item.key}
              className={`flex items-center gap-4 px-5 py-4 ${idx < arr.length - 1 ? 'border-b border-border' : ''}`}
            >
              <div className="flex-1">
                <p className="text-2xl font-medium text-foreground">{item.label}</p>
                <p className="text-xl text-muted-foreground">{item.sub}</p>
              </div>
              <ToggleSwitch value={settings[item.key]} onChange={(v) => update(item.key, v)} />
            </div>
          ))}
        </div>
      </div>

      {/* 隐私设置 */}
      <div className="mb-4">
        <p className="text-xl font-bold text-muted-foreground px-1 mb-2">隐私设置</p>
        <div className="bg-card shadow-card border border-border rounded-2xl overflow-hidden">
          {[
            {key: 'dataCollection', label: '数据收集', sub: '允许收集使用数据以改善产品体验'},
            {key: 'personalized', label: '个性化推荐', sub: '基于使用行为提供个性化建议'}
          ].map((item, idx, arr) => (
            <div
              key={item.key}
              className={`flex items-center gap-4 px-5 py-4 ${idx < arr.length - 1 ? 'border-b border-border' : ''}`}
            >
              <div className="flex-1">
                <p className="text-2xl font-medium text-foreground">{item.label}</p>
                <p className="text-xl text-muted-foreground">{item.sub}</p>
              </div>
              <ToggleSwitch value={settings[item.key]} onChange={(v) => update(item.key, v)} />
            </div>
          ))}
        </div>
      </div>

      {/* 其他设置 */}
      <div>
        <p className="text-xl font-bold text-muted-foreground px-1 mb-2">其他</p>
        <div className="bg-card shadow-card border border-border rounded-2xl overflow-hidden">
          <div
            className="flex items-center gap-4 px-5 py-4 border-b border-border"
            onClick={handleClearCache}
          >
            <div className="flex-1">
              <p className="text-2xl font-medium text-foreground">清除缓存</p>
              <p className="text-xl text-muted-foreground">清除本地缓存数据</p>
            </div>
            <div className="i-mdi-chevron-right text-muted-foreground" style={{fontSize: '20px'}} />
          </div>
          <div className="flex items-center gap-4 px-5 py-4">
            <div className="flex-1">
              <p className="text-2xl font-medium text-foreground">语言设置</p>
              <p className="text-xl text-muted-foreground">简体中文</p>
            </div>
            <div className="i-mdi-chevron-right text-muted-foreground" style={{fontSize: '20px'}} />
          </div>
        </div>
      </div>
    </div>
  )
}

export default withRouteGuard(SettingsPage)
