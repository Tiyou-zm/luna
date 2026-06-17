const cloud = require('wx-server-sdk')

cloud.init({env: cloud.DYNAMIC_CURRENT_ENV})

const db = cloud.database()

function now() {
  return new Date().toISOString()
}

function stripReservedFields(data) {
  if (!data || typeof data !== 'object') return data
  const clean = {...data}
  delete clean._id
  return clean
}

function defaultProfile(openid, metadata = {}) {
  const username = metadata.username || `wx_${openid.slice(0, 20)}`
  return {
    id: openid,
    openid,
    username,
    nickname: metadata.nickname || '微信用户',
    avatar_url: metadata.avatar_url || null,
    role: 'user',
    is_admin: false,
    membership_level: 'free',
    membership_expires: null,
    balance: 0,
    ai_count: 0,
    free_chat_count: 0,
    bound_accounts: 0,
    phone: null,
    created_at: now(),
    updated_at: now(),
  }
}

exports.main = async (event = {}) => {
  const {OPENID} = cloud.getWXContext()
  if (!OPENID) return {ok: false, error: '未获取到微信 openid'}

  const metadata = event.metadata || {}
  const ref = db.collection('profiles').doc(OPENID)

  try {
    const existing = await ref.get()
    const profile = existing.data
    const patch = {
      updated_at: now(),
      ...(metadata.nickname && !profile.nickname ? {nickname: metadata.nickname} : {}),
      ...(metadata.avatar_url ? {avatar_url: metadata.avatar_url} : {}),
    }
    await ref.update({data: patch})
    return {ok: true, data: {user: {id: OPENID, openid: OPENID}, profile: {...profile, ...patch}}}
  } catch {
    const profile = defaultProfile(OPENID, metadata)
    await ref.set({data: stripReservedFields(profile)})
    return {ok: true, data: {user: {id: OPENID, openid: OPENID}, profile}}
  }
}
