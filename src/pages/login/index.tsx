// @title 登录
import {useState} from 'react'
import Taro from '@tarojs/taro'
import {LunaAvatar} from '@/components/LunaAvatar'
import {useAuth} from '@/contexts/AuthContext'
import {STORAGE_KEY_REDIRECT_PATH} from '@/components/RouteGuard'
import {openPrivacyContract} from '@/utils/privacy'

const TAB_PAGES = [
  '/pages/chat/index',
  '/pages/materials/index',
  '/pages/service/index',
  '/pages/profile/index'
]

export default function LoginPage() {
  const {signInWithUsername, signUpWithUsername, signInWithWechat} = useAuth()
  const [isRegister, setIsRegister] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [agreed, setAgreed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [wechatLoading, setWechatLoading] = useState(false)

  const redirectAfterLogin = async () => {
    const redirectPath = Taro.getStorageSync(STORAGE_KEY_REDIRECT_PATH) || '/pages/chat/index'
    Taro.removeStorageSync(STORAGE_KEY_REDIRECT_PATH)
    const normalizedPath = redirectPath.startsWith('/') ? redirectPath : `/${redirectPath}`
    const isTabPage = TAB_PAGES.includes(normalizedPath)
    console.info('[Login] redirect start', {url: normalizedPath, isTabPage})
    try {
      if (isTabPage) {
        await Taro.switchTab({url: normalizedPath})
      } else {
        await Taro.navigateTo({url: normalizedPath})
      }
      console.info('[Login] redirect success', {url: normalizedPath})
    } catch (error) {
      console.warn('[Login] redirect failed, fallback to workbench', error)
      await Taro.reLaunch({url: '/pages/chat/index'})
    }
  }

  const handleSubmit = async () => {
    if (!username.trim() || !password.trim()) {
      Taro.showToast({title: '请填写用户名和密码', icon: 'none'})
      return
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      Taro.showToast({title: '用户名只能包含字母、数字和下划线', icon: 'none'})
      return
    }
    if (password.length < 6) {
      Taro.showToast({title: '密码至少 6 位', icon: 'none'})
      return
    }
    if (!agreed) {
      Taro.showToast({title: '请先同意用户协议和隐私政策', icon: 'none'})
      return
    }
    setLoading(true)
    try {
      if (isRegister) {
        const {error} = await signUpWithUsername(username, password)
        if (error) {
          Taro.showToast({title: error.message || '注册失败', icon: 'none'})
        } else {
          Taro.showToast({title: '注册成功', icon: 'success'})
          setTimeout(() => { redirectAfterLogin() }, 200)
        }
      } else {
        const {error} = await signInWithUsername(username, password)
        if (error) {
          Taro.showToast({title: error.message || '用户名或密码错误', icon: 'none'})
        } else {
          setTimeout(() => { redirectAfterLogin() }, 200)
        }
      }
    } finally {
      setLoading(false)
    }
  }

  const handleWechatLogin = async () => {
    if (!agreed) {
      Taro.showToast({title: '请先同意用户协议和隐私政策', icon: 'none'})
      return
    }
    if (Taro.getEnv() !== Taro.ENV_TYPE.WEAPP) {
      Taro.showToast({title: '微信一键登录请在小程序环境中使用', icon: 'none', duration: 3000})
      return
    }
    setWechatLoading(true)
    try {
      const {error} = await signInWithWechat()
      if (error) {
        Taro.showToast({title: error.message || '微信登录失败', icon: 'none'})
      } else {
        setTimeout(() => { redirectAfterLogin() }, 200)
      }
    } finally {
      setWechatLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col" style={{background: 'linear-gradient(160deg, hsl(222 90% 12%) 0%, hsl(228 85% 18%) 45%, hsl(215 78% 24%) 100%)'}}>
      {/* 像素网格底纹 */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: 'linear-gradient(rgba(100,180,255,0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(100,180,255,0.12) 1px, transparent 1px)',
          backgroundSize: '20px 20px',
          zIndex: 0
        }}
      />
      {/* 顶部光晕 */}
      <div
        className="absolute pointer-events-none"
        style={{top: '-60px', left: '50%', transform: 'translateX(-50%)', width: '320px', height: '260px', background: 'radial-gradient(ellipse at center, rgba(56,189,248,0.18) 0%, transparent 65%)', zIndex: 0}}
      />

      {/* 顶部品牌区 */}
      <div className="flex flex-col items-center pt-20 pb-10 px-6 relative" style={{zIndex: 1}}>
        <div
          style={{
            width: '100px', height: '100px',
            borderRadius: '24px',
            overflow: 'hidden',
            border: '2.5px solid rgba(56,189,248,0.8)',
            boxShadow: '0 0 24px rgba(56,189,248,0.45), 0 8px 24px rgba(0,0,0,0.4)',
            marginBottom: '20px'
          }}
        >
          <LunaAvatar size={100} iconSize={58} />
        </div>
        <h1
          className="font-black leading-none mb-2"
          style={{
            fontSize: '38px',
            color: '#FFFFFF',
            fontFamily: 'monospace',
            letterSpacing: '4px',
            textShadow: [
              '2px 2px 0px #38BDF8',
              '4px 4px 0px #0EA5E9',
              '6px 6px 0px #0369A1',
              '8px 8px 0px rgba(0,0,0,0.55)',
              '0px 0px 20px rgba(56,189,248,0.75)',
              '0px 0px 48px rgba(14,165,233,0.4)'
            ].join(', '),
            WebkitTextStroke: '0.5px rgba(186,230,255,0.45)'
          }}
        >
          Luna AI
        </h1>
        <p style={{fontSize: '16px', color: '#93C5FD', fontFamily: 'monospace', letterSpacing: '4px', textShadow: '0 0 10px rgba(56,189,248,0.6)'}}>
          自媒体创作者的AI工作站
        </p>
      </div>

      {/* 登录卡片 */}
      <div className="flex-1 bg-background rounded-t-3xl px-6 pt-8 pb-6" style={{position: 'relative', zIndex: 1}}>
        {/* 切换标签 */}
        <div className="flex bg-muted rounded-xl p-1 mb-8">
          <button
            type="button"
            className={`flex-1 py-3 rounded-lg text-2xl font-medium flex items-center justify-center leading-none transition ${!isRegister ? 'bg-primary text-primary-foreground shadow-primary' : 'text-muted-foreground'}`}
            onClick={() => setIsRegister(false)}
          >
            登录
          </button>
          <button
            type="button"
            className={`flex-1 py-3 rounded-lg text-2xl font-medium flex items-center justify-center leading-none transition ${isRegister ? 'bg-primary text-primary-foreground shadow-primary' : 'text-muted-foreground'}`}
            onClick={() => setIsRegister(true)}
          >
            注册
          </button>
        </div>

        {/* 输入框 */}
        <div className="flex flex-col gap-4 mb-6">
          <div className="border-2 border-input rounded-xl px-4 py-3 bg-card overflow-hidden">
            <input
              className="w-full text-2xl text-foreground bg-transparent outline-none"
              placeholder="用户名（字母、数字、下划线）"
              value={username}
              onInput={(e) => { const ev = e as any; setUsername(ev.detail?.value ?? ev.target?.value ?? '') }}
            />
          </div>
          <div className="border-2 border-input rounded-xl px-4 py-3 bg-card overflow-hidden flex items-center gap-2">
            <input
              className="flex-1 text-2xl text-foreground bg-transparent outline-none"
              type={showPassword ? 'text' : 'password'}
              placeholder="密码（至少6位）"
              value={password}
              onInput={(e) => { const ev = e as any; setPassword(ev.detail?.value ?? ev.target?.value ?? '') }}
            />
            <button
              type="button"
              className="w-9 h-9 flex items-center justify-center text-muted-foreground"
              style={{padding: 0, border: 0, background: 'transparent', lineHeight: 1}}
              onClick={() => setShowPassword((value) => !value)}
            >
              <div className={showPassword ? 'i-mdi-eye-off-outline' : 'i-mdi-eye-outline'} style={{fontSize: '22px'}} />
            </button>
          </div>
        </div>

        {/* 协议勾选 */}
        <div className="flex items-center gap-3 mb-6" onClick={() => setAgreed(!agreed)}>
          <div className={`w-6 h-6 rounded border-2 flex items-center justify-center flex-shrink-0 transition ${agreed ? 'bg-primary border-primary' : 'border-border bg-background'}`}>
            {agreed && <div className="i-mdi-check text-white" style={{fontSize: '16px'}} />}
          </div>
          <span className="text-xl text-muted-foreground">
            我已阅读并同意《用户协议》和
            <span
              className="text-primary"
              onClick={(event) => {
                event.stopPropagation()
                openPrivacyContract()
              }}
            >
              《隐私政策》
            </span>
          </span>
        </div>

        {/* 主登录按钮 */}
        <button
          type="button"
          className={`w-full py-1 rounded-xl bg-gradient-primary text-primary-foreground text-2xl font-bold flex items-center justify-center leading-none shadow-primary mb-4 transition ${loading ? 'opacity-60' : ''}`}
          onClick={handleSubmit}
        >
          <div className="py-4">{loading ? '处理中...' : isRegister ? '立即注册' : '登录'}</div>
        </button>

        {/* 分割线 */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1 h-px bg-border" />
          <span className="text-xl text-muted-foreground">或</span>
          <div className="flex-1 h-px bg-border" />
        </div>

        {/* 微信登录 */}
        <button
          type="button"
          className={`w-full py-1 rounded-xl border-2 border-primary text-primary text-2xl font-bold flex items-center justify-center leading-none gap-2 transition ${wechatLoading ? 'opacity-60' : ''}`}
          onClick={handleWechatLogin}
        >
          <div className="flex items-center gap-2 py-4">
            <div className="i-mdi-wechat" style={{fontSize: '24px'}} />
            <span>{wechatLoading ? '登录中...' : '微信一键登录'}</span>
          </div>
        </button>

        <p className="text-center text-xl text-muted-foreground mt-4">微信登录仅限小程序环境使用</p>
      </div>
    </div>
  )
}
