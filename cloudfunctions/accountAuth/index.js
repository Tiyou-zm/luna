const cloud = require('wx-server-sdk')
const crypto = require('crypto')

cloud.init({env: cloud.DYNAMIC_CURRENT_ENV})

const db = cloud.database()

function now() {
  return new Date().toISOString()
}

function hashPassword(password, salt) {
  return crypto.createHash('sha256').update(`${salt}:${password}`).digest('hex')
}

function stripReservedFields(data) {
  if (!data || typeof data !== 'object') return data
  const clean = {...data}
  delete clean._id
  return clean
}

async function getOrCreateProfile(openid) {
  const ref = db.collection('profiles').doc(openid)
  try {
    return (await ref.get()).data
  } catch {
    const profile = {
      id: openid,
      openid,
      username: `wx_${openid.slice(0, 20)}`,
      nickname: '微信用户',
      avatar_url: null,
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
    await ref.set({data: stripReservedFields(profile)})
    return profile
  }
}

exports.main = async (event = {}) => {
  const {OPENID} = cloud.getWXContext()
  if (!OPENID) return {ok: false, error: '未获取到微信 openid'}

  const action = event.action
  const username = String(event.username || '').trim()
  const password = String(event.password || '')

  if (action === 'changePassword') {
    if (password.length < 6) return {ok: false, error: '密码至少 6 位'}
    const salt = crypto.randomBytes(8).toString('hex')
    await db.collection('profiles').doc(OPENID).update({
      data: {password_salt: salt, password_hash: hashPassword(password, salt), updated_at: now()},
    })
    return {ok: true, data: true}
  }

  if (!/^[a-zA-Z0-9_]+$/.test(username)) return {ok: false, error: '用户名只能包含字母、数字和下划线'}
  if (password.length < 6) return {ok: false, error: '密码至少 6 位'}

  const profiles = db.collection('profiles')
  const existing = await profiles.where({username}).limit(1).get()

  if (action === 'register') {
    if (existing.data.length && existing.data[0].openid !== OPENID) return {ok: false, error: '用户名已被占用'}
    const profile = await getOrCreateProfile(OPENID)
    const salt = crypto.randomBytes(8).toString('hex')
    const patch = {
      username,
      nickname: profile.nickname || username,
      password_salt: salt,
      password_hash: hashPassword(password, salt),
      updated_at: now(),
    }
    await profiles.doc(OPENID).update({data: patch})
    return {ok: true, data: {user: {id: OPENID, openid: OPENID}, profile: {...profile, ...patch}}}
  }

  if (action === 'login') {
    const profile = existing.data[0]
    if (!profile?.password_hash || !profile?.password_salt) return {ok: false, error: '用户名或密码错误'}
    if (hashPassword(password, profile.password_salt) !== profile.password_hash) {
      return {ok: false, error: '用户名或密码错误'}
    }
    return {ok: true, data: {user: {id: profile.openid, openid: profile.openid}, profile}}
  }

  return {ok: false, error: '未知账号操作'}
}
