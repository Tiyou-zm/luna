import {useState} from 'react'
import Taro from '@tarojs/taro'
import {withRouteGuard} from '@/components/RouteGuard'
import {useAuth} from '@/contexts/AuthContext'
import {supabase} from '@/client/supabase'

function AccountSecurityPage() {
  const {signOut, profile} = useAuth()
  const [showChangePassword, setShowChangePassword] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const handleChangePassword = async () => {
    if (!newPassword || !confirmPassword) {
      Taro.showToast({title: '请填写新密码', icon: 'none'})
      return
    }
    if (newPassword !== confirmPassword) {
      Taro.showToast({title: '两次密码不一致', icon: 'none'})
      return
    }
    if (newPassword.length < 6) {
      Taro.showToast({title: '密码不能少于6位', icon: 'none'})
      return
    }
    setLoading(true)
    try {
      const {error} = await supabase.auth.updateUser({password: newPassword})
      if (error) {
        Taro.showToast({title: error.message || '修改失败', icon: 'none'})
      } else {
        Taro.showToast({title: '密码修改成功', icon: 'success'})
        setShowChangePassword(false)
        setNewPassword('')
        setConfirmPassword('')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleSignOut = async () => {
    Taro.showModal({
      title: '退出登录',
      content: '确认退出当前账号？',
      success: async ({confirm}) => {
        if (confirm) {
          await signOut()
          Taro.reLaunch({url: '/pages/login/index'})
        }
      }
    })
  }

  return (
    <div className="min-h-screen bg-background px-4 pt-4 pb-8">
      {/* 账号信息 */}
      <div className="bg-card p-5 shadow-card border border-border rounded-2xl mb-4">
        <p className="text-xl font-bold text-muted-foreground mb-3">当前账号</p>
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-primary rounded-xl flex items-center justify-center">
            <div className="i-mdi-account-outline text-white" style={{fontSize: '24px'}} />
          </div>
          <div>
            <p className="text-2xl font-bold text-foreground">
              {profile?.nickname || profile?.username || '未知用户'}
            </p>
            <p className="text-xl text-muted-foreground">@{profile?.username || 'unknown'}</p>
          </div>
        </div>
      </div>

      {/* 微信登录说明 */}
      <div className="bg-secondary border border-border px-5 py-4 mb-4 flex items-center gap-3">
        <div className="i-mdi-wechat text-green-500 flex-shrink-0" style={{fontSize: '24px'}} />
        <p className="text-xl text-foreground leading-relaxed">
          本小程序使用微信账号登录，无需绑定手机号，账号安全由微信保障
        </p>
      </div>

      {/* 安全选项 */}
      <div className="bg-card shadow-card border border-border rounded-2xl overflow-hidden mb-4">
        {/* 修改密码 */}
        <div
          className="flex items-center gap-4 px-5 py-4"
          onClick={() => setShowChangePassword(!showChangePassword)}
        >
          <div className="w-10 h-10 bg-accent flex items-center justify-center">
            <div className="i-mdi-key-outline text-foreground" style={{fontSize: '22px'}} />
          </div>
          <div className="flex-1">
            <p className="text-2xl font-medium text-foreground">修改密码</p>
            <p className="text-xl text-muted-foreground">建议定期更换密码保护账号安全</p>
          </div>
          <div
            className={`i-mdi-chevron-right text-muted-foreground transition ${showChangePassword ? 'rotate-90' : ''}`}
            style={{fontSize: '20px'}}
          />
        </div>

        {showChangePassword && (
          <div className="px-5 py-4 bg-muted/30 border-t border-border">
            <div className="flex flex-col gap-3">
              <div className="border border-border px-4 py-2 bg-background overflow-hidden">
                <input
                  className="w-full text-xl text-foreground bg-transparent outline-none"
                  type="password"
                  placeholder="新密码（至少6位）"
                  value={newPassword}
                  onInput={(e) => {
                    const ev = e as any
                    setNewPassword(ev.detail?.value ?? ev.target?.value ?? '')
                  }}
                />
              </div>
              <div className="border border-border px-4 py-2 bg-background overflow-hidden">
                <input
                  className="w-full text-xl text-foreground bg-transparent outline-none"
                  type="password"
                  placeholder="确认新密码"
                  value={confirmPassword}
                  onInput={(e) => {
                    const ev = e as any
                    setConfirmPassword(ev.detail?.value ?? ev.target?.value ?? '')
                  }}
                />
              </div>
              <button
                type="button"
                className={`py-1 flex items-center justify-center leading-none transition ${loading ? 'bg-secondary' : 'bg-gradient-primary shadow-primary'}`}
                onClick={handleChangePassword}
              >
                <div className="py-3">
                  <span className="text-xl font-bold text-white">{loading ? '修改中...' : '确认修改'}</span>
                </div>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 退出登录 */}
      <button
        type="button"
        className="w-full py-1 border-2 border-destructive flex items-center justify-center leading-none"
        onClick={handleSignOut}
      >
        <div className="py-4">
          <span className="text-2xl font-medium text-destructive">退出登录</span>
        </div>
      </button>
    </div>
  )
}

export default withRouteGuard(AccountSecurityPage)
