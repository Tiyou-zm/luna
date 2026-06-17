import {createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode} from 'react'
import {
  authCloudAccount,
  ensureCloudProfile,
  getActiveCloudProfile,
  getLocalUser,
  saveLocalUser,
  type AppUser,
} from '@/client/cloudbase'

export interface Profile {
  id: string
  username: string | null
  nickname: string | null
  avatar_url: string | null
  openid: string | null
  role: 'user' | 'admin'
  membership_level: 'trial' | 'free' | 'graphic' | 'video_starter' | 'video_pro' | 'professional' | 'enterprise'
  membership_expires: string | null
  balance: number
  ai_count: number
  free_chat_count?: number
  bound_accounts: number
  phone: string | null
  is_admin: boolean
  created_at: string
  updated_at: string
}

export async function getProfile(_userId: string): Promise<Profile | null> {
  try {
    return await getActiveCloudProfile()
  } catch (error) {
    console.error('Failed to fetch cloud profile:', error)
    return null
  }
}

interface AuthContextType {
  user: AppUser | null
  profile: Profile | null
  loading: boolean
  signInWithUsername: (username: string, password: string) => Promise<{error: Error | null}>
  signUpWithUsername: (username: string, password: string) => Promise<{error: Error | null}>
  signUpWithPhone: (phone: string, password: string) => Promise<{error: Error | null}>
  signInWithPhone: (phone: string) => Promise<{error: Error | null}>
  verifyPhoneOtp: (phone: string, code: string) => Promise<{error: Error | null}>
  signInWithWechat: () => Promise<{error: Error | null}>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({children}: {children: ReactNode}) {
  const [user, setUser] = useState<AppUser | null>(() => getLocalUser())
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  const applySession = useCallback((nextUser: AppUser, nextProfile: Profile) => {
    setUser((prev) => (
      prev?.id === nextUser.id && prev?.openid === nextUser.openid && prev?.sessionToken === nextUser.sessionToken ? prev : nextUser
    ))
    setProfile(nextProfile)
    saveLocalUser(nextUser)
  }, [])

  const refreshProfile = useCallback(async () => {
    if (!user?.id) {
      setProfile(null)
      return
    }
    if (user.sessionToken) {
      const nextProfile = await getActiveCloudProfile()
      applySession(user, nextProfile)
      return
    }
    const {user: nextUser, profile: nextProfile} = await ensureCloudProfile()
    applySession(nextUser, nextProfile)
  }, [applySession, user])

  useEffect(() => {
    setLoading(false)
  }, [])

  const signInWithUsername = useCallback(async (username: string, password: string) => {
    try {
      const {user: nextUser, profile: nextProfile} = await authCloudAccount('login', username, password)
      applySession(nextUser, nextProfile)
      return {error: null}
    } catch (error) {
      return {error: error as Error}
    }
  }, [applySession])

  const signUpWithUsername = useCallback(async (username: string, password: string) => {
    try {
      const {user: nextUser, profile: nextProfile} = await authCloudAccount('register', username, password)
      applySession(nextUser, nextProfile)
      return {error: null}
    } catch (error) {
      return {error: error as Error}
    }
  }, [applySession])

  const signInWithWechat = useCallback(async () => {
    try {
      const {user: nextUser, profile: nextProfile} = await ensureCloudProfile({nickname: '微信用户'})
      applySession(nextUser, nextProfile)
      return {error: null}
    } catch (error) {
      return {error: error as Error}
    }
  }, [applySession])

  const signUpWithPhone = useCallback(async () => {
    return {error: new Error('手机号注册将在 CloudBase 阶段二接入')}
  }, [])

  const signInWithPhone = useCallback(async () => {
    return {error: new Error('手机号登录将在 CloudBase 阶段二接入')}
  }, [])

  const verifyPhoneOtp = useCallback(async () => {
    return {error: new Error('短信验证码将在 CloudBase 阶段二接入')}
  }, [])

  const signOut = useCallback(async () => {
    setUser(null)
    setProfile(null)
    saveLocalUser(null)
  }, [])

  const value = useMemo(() => ({
    user,
    profile,
    loading,
    signInWithUsername,
    signUpWithUsername,
    signUpWithPhone,
    signInWithPhone,
    verifyPhoneOtp,
    signInWithWechat,
    signOut,
    refreshProfile,
  }), [
    user,
    profile,
    loading,
    signInWithUsername,
    signUpWithUsername,
    signUpWithPhone,
    signInWithPhone,
    verifyPhoneOtp,
    signInWithWechat,
    signOut,
    refreshProfile,
  ])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
