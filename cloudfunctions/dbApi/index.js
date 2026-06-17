const cloud = require('wx-server-sdk')
const crypto = require('crypto')

cloud.init({env: cloud.DYNAMIC_CURRENT_ENV})

const db = cloud.database()
const cmd = db.command
const FUNCTION_VERSION = 'auth-account-session-20260605-1'
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

function now() {
  return new Date().toISOString()
}

function normalize(row) {
  if (!row) return row
  return {...row, id: row.id || row._id}
}

function stripReservedFields(data) {
  if (!data || typeof data !== 'object') return data
  const clean = {...data}
  delete clean._id
  return clean
}

function publicProfile(profile) {
  if (!profile) return profile
  const clean = normalize(profile)
  delete clean.password_hash
  delete clean.password_salt
  return clean
}

async function getProfile(userId) {
  return db.collection('profiles').doc(userId).get().then((res) => publicProfile(res.data)).catch(() => null)
}

function hashPassword(password, salt) {
  return crypto.createHash('sha256').update(`${salt}:${password}`).digest('hex')
}

function accountIdForUsername(username) {
  return `acct_${crypto.createHash('sha256').update(String(username || '').toLowerCase()).digest('hex').slice(0, 32)}`
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

async function getOrCreateProfile(openid, metadata = {}) {
  const existing = await getProfile(openid)
  if (existing) return existing

  const profile = {
    id: openid,
    openid,
    username: metadata.username || `wx_${openid.slice(0, 20)}`,
    nickname: metadata.nickname || 'WeChat User',
    account_type: 'wechat',
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
  await db.collection('profiles').doc(openid).set({data: stripReservedFields(profile)})
  return profile
}

async function createAuthSession(userId, openid, accountType) {
  const token = crypto.randomBytes(32).toString('hex')
  const createdAt = now()
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString()
  const row = {
    token_hash: hashToken(token),
    user_id: userId,
    account_type: accountType,
    login_openid: openid || null,
    revoked_at: null,
    created_at: createdAt,
    expires_at: expiresAt,
  }
  try {
    await db.collection('auth_sessions').add({data: row})
  } catch (error) {
    if (!String(error?.message || error).includes('collection not exists')) throw error
    await db.createCollection('auth_sessions').catch(() => null)
    await db.collection('auth_sessions').add({data: row})
  }
  return {token, expiresAt}
}

async function getSessionUser(event, openid) {
  const token = String(event.authToken || '').trim()
  if (!token) return null
  const res = await db.collection('auth_sessions')
    .where({token_hash: hashToken(token), revoked_at: null})
    .limit(1)
    .get()
  const session = res.data[0]
  if (!session) return null
  if (session.expires_at && new Date(session.expires_at).getTime() < Date.now()) return null
  if (session.login_openid && openid && session.login_openid !== openid) return null
  const profile = await getProfile(session.user_id)
  if (!profile) return null
  return {userId: session.user_id, profile, session}
}

async function resolveOwner(event, openid) {
  const sessionUser = await getSessionUser(event, openid)
  if (sessionUser) return sessionUser
  if (!openid) throw new Error('Missing WeChat openid')
  const profile = await getOrCreateProfile(openid)
  return {userId: openid, profile, session: null}
}

async function authAccount(action, openid, username, password) {
  const name = String(username || '').trim()
  const pass = String(password || '')
  if (!/^[a-zA-Z0-9_]+$/.test(name)) return {ok: false, error: 'Username can only contain letters, numbers and underscores'}
  if (pass.length < 6) return {ok: false, error: 'Password must be at least 6 characters'}

  const profiles = db.collection('profiles')
  const existing = await profiles.where({username: name}).limit(1).get()

  if (action === 'register') {
    if (existing.data.length) {
      return {ok: false, error: 'Username already exists'}
    }
    const accountId = accountIdForUsername(name)
    const existingDoc = await getProfile(accountId)
    if (existingDoc) return {ok: false, error: 'Username already exists'}
    const salt = crypto.randomBytes(8).toString('hex')
    const createdAt = now()
    const profile = {
      id: accountId,
      openid: null,
      username: name,
      nickname: name,
      account_type: 'manual',
      last_login_openid: openid || null,
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
      password_salt: salt,
      password_hash: hashPassword(pass, salt),
      created_at: createdAt,
      updated_at: createdAt,
    }
    await profiles.doc(accountId).set({data: stripReservedFields(profile)})
    const session = await createAuthSession(accountId, openid, 'manual')
    return {ok: true, data: {
      user: {id: accountId, openid, accountType: 'manual', sessionToken: session.token},
      profile: publicProfile(profile),
    }}
  }

  if (action === 'login') {
    const profile = existing.data[0]
    if (!profile?.password_hash || !profile?.password_salt) return {ok: false, error: 'Invalid username or password'}
    if (hashPassword(pass, profile.password_salt) !== profile.password_hash) {
      return {ok: false, error: 'Invalid username or password'}
    }
    const userId = profile.id || profile._id || profile.openid
    const patch = {last_login_openid: openid || null, updated_at: now()}
    await profiles.doc(userId).update({data: patch}).catch(() => null)
    const accountType = profile.account_type || (String(userId).startsWith('acct_') ? 'manual' : 'wechat')
    const session = await createAuthSession(userId, openid, accountType)
    return {ok: true, data: {
      user: {id: userId, openid, accountType, sessionToken: session.token},
      profile: publicProfile({...profile, ...patch, id: userId}),
    }}
  }

  return {ok: false, error: 'Unknown account action'}
}

async function authDebug(openid, username) {
  const name = String(username || `debug_${Date.now()}`).replace(/[^a-zA-Z0-9_]/g, '_')
  const steps = []
  const mark = (step) => steps.push({step, at: Date.now()})
  mark('start')
  await db.collection('profiles').doc(openid).get().then(() => mark('doc_get_exists')).catch(() => mark('doc_get_missing'))
  await db.collection('profiles').where({username: name}).limit(1).get()
  mark('username_query')
  const debugId = `${openid}_debug`
  await db.collection('profiles').doc(debugId).set({data: stripReservedFields({
    id: debugId,
    openid: debugId,
    username: name,
    nickname: 'debug',
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
  })})
  mark('doc_set')
  await db.collection('profiles').doc(debugId).remove().then(() => mark('doc_remove')).catch(() => mark('doc_remove_skip'))
  return {ok: true, data: {version: FUNCTION_VERSION, steps}}
}

async function requireAdmin(openid) {
  const profile = await getProfile(openid)
  if (!profile?.is_admin && profile?.role !== 'admin') throw new Error('仅管理员可访问')
  return profile
}

async function authorizeAdminMutation(openid, setupToken) {
  const expectedToken = process.env.ADMIN_SETUP_TOKEN || ''
  if (expectedToken && setupToken && setupToken === expectedToken) return true
  if (!openid) throw new Error('管理员操作需要微信 openid 或后台 setup token')
  await requireAdmin(openid)
  return true
}

async function setUserAdmin(event, operatorOpenid) {
  await authorizeAdminMutation(operatorOpenid, event.setupToken || event.adminSetupToken)
  const username = String(event.username || '').trim()
  const openid = String(event.openid || '').trim()
  if (!username && !openid) return {ok: false, error: '请提供 username 或 openid'}

  let target = null
  if (openid) {
    target = await getProfile(openid)
  } else {
    const res = await db.collection('profiles').where({username}).limit(1).get()
    target = normalize(res.data[0] || null)
  }

  if (!target?.openid && !target?.id) return {ok: false, error: '未找到目标用户'}
  const targetOpenid = target.openid || target.id
  const isAdmin = event.isAdmin !== false
  const patch = {
    role: isAdmin ? 'admin' : 'user',
    is_admin: isAdmin,
    updated_at: now(),
  }
  await db.collection('profiles').doc(targetOpenid).update({data: patch})
  return {ok: true, data: {openid: targetOpenid, username: target.username || null, ...patch}}
}

async function listOwned(collection, openid, limit = 30, extra = {}) {
  const res = await db.collection(collection)
    .where({user_id: openid, ...extra})
    .orderBy('created_at', 'desc')
    .limit(limit)
    .get()
  return res.data.map(normalize)
}

async function getOwnedDoc(collection, id, openid) {
  if (!id) return null
  try {
    const doc = await db.collection(collection).doc(id).get()
    const row = normalize(doc.data)
    if (row?.user_id && row.user_id !== openid) return null
    return row
  } catch {
    return null
  }
}

function docId(row) {
  return row?._id || row?.id || ''
}

async function getDoc(collection, id) {
  if (!id) return null
  try {
    const res = await db.collection(collection).doc(id).get()
    return normalize(res.data)
  } catch {
    return null
  }
}

async function queryRows(collection, where, limit = 30, orderField = 'created_at') {
  try {
    const res = await db.collection(collection)
      .where(where)
      .orderBy(orderField, 'desc')
      .limit(limit)
      .get()
    return res.data.map(normalize)
  } catch {
    return []
  }
}

async function updateDoc(collection, id, patch) {
  if (!id) return false
  await db.collection(collection).doc(id).update({data: patch})
  return true
}

async function repairGeneratedOwnership(event, effectiveOpenid, userId) {
  if (!effectiveOpenid) return {ok: false, error: 'Missing WeChat openid'}
  if (!userId || userId === effectiveOpenid) {
    return {ok: false, error: 'Manual account session is required for ownership repair'}
  }

  const dryRun = event.dryRun !== false
  const limit = Math.min(Number(event.limit || 5), 20)
  const patchedAt = now()
  const targetUserId = userId
  const oldUserId = effectiveOpenid
  const jobIds = new Set()
  const materialIds = new Set()
  const draftIds = new Set()

  if (event.jobId || event.job_id) jobIds.add(String(event.jobId || event.job_id))
  if (event.materialId || event.material_id) materialIds.add(String(event.materialId || event.material_id))

  if (materialIds.size) {
    for (const id of [...materialIds]) {
      const material = await getDoc('materials', id)
      if (!material || material.user_id !== oldUserId) continue
      const jobId = material.package_config?.generation_job_id || material.generation_job_id
      if (jobId) jobIds.add(String(jobId))
      if (material.parent_material_id) materialIds.add(String(material.parent_material_id))
    }
  }

  let jobs = []
  if (jobIds.size) {
    for (const id of [...jobIds]) {
      const job = await getDoc('generation_jobs', id)
      if (!job || job.user_id !== oldUserId) continue
      if (job.openid && job.openid !== effectiveOpenid) continue
      jobs.push(job)
    }
  } else {
    jobs = await queryRows('generation_jobs', {user_id: oldUserId, openid: effectiveOpenid}, limit, 'updated_at')
  }

  for (const job of jobs) {
    const id = docId(job)
    if (id) jobIds.add(id)
    if (job.result_material_id) materialIds.add(String(job.result_material_id))
    if (job.draft_id) draftIds.add(String(job.draft_id))
  }

  for (const jobId of [...jobIds]) {
    const related = await queryRows('materials', {user_id: oldUserId, 'package_config.generation_job_id': jobId}, 100, 'created_at')
    related.forEach((row) => {
      const id = docId(row)
      if (id) materialIds.add(id)
    })
  }

  for (const materialId of [...materialIds]) {
    const children = await queryRows('materials', {user_id: oldUserId, parent_material_id: materialId}, 100, 'created_at')
    children.forEach((row) => {
      const id = docId(row)
      if (id) materialIds.add(id)
    })
  }

  const updates = {
    generation_jobs: [...jobIds],
    materials: [...materialIds],
    stage0_drafts: [...draftIds],
    generation_job_events: [],
  }

  for (const jobId of [...jobIds]) {
    const events = await queryRows('generation_job_events', {user_id: oldUserId, job_id: jobId}, 100, 'created_at')
    events.forEach((row) => {
      const id = docId(row)
      if (id) updates.generation_job_events.push(id)
    })
  }

  if (dryRun) {
    return {ok: true, data: {dryRun, from: oldUserId, to: targetUserId, updates}}
  }

  const patch = {user_id: targetUserId, ownership_repaired_from: oldUserId, ownership_repaired_at: patchedAt, updated_at: patchedAt}
  const counts = {generation_jobs: 0, materials: 0, stage0_drafts: 0, generation_job_events: 0}
  for (const id of updates.generation_jobs) {
    if (await updateDoc('generation_jobs', id, patch).catch(() => false)) counts.generation_jobs += 1
  }
  for (const id of updates.materials) {
    if (await updateDoc('materials', id, patch).catch(() => false)) counts.materials += 1
  }
  for (const id of updates.stage0_drafts) {
    if (await updateDoc('stage0_drafts', id, patch).catch(() => false)) counts.stage0_drafts += 1
  }
  for (const id of updates.generation_job_events) {
    if (await updateDoc('generation_job_events', id, patch).catch(() => false)) counts.generation_job_events += 1
  }
  return {ok: true, data: {dryRun, from: oldUserId, to: targetUserId, counts, updates}}
}

async function createRow(collection, data) {
  const res = await db.collection(collection).add({data})
  return normalize({...data, _id: res._id, id: res._id})
}

async function listByDate(collection, start, end, limit = 1000) {
  const res = await db.collection(collection)
    .where({created_at: cmd.gte(start).and(cmd.lte(end))})
    .limit(limit)
    .get()
  return res.data.map(normalize)
}

function dayStart(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function sum(rows, selector) {
  return rows.reduce((total, row) => total + Number(selector(row) || 0), 0)
}

exports.main = async (event = {}) => {
  const action = event.action
  const {OPENID} = cloud.getWXContext()
  const debugOpenid = String(event.debugOpenid || event.testOpenid || 'debug_openid_for_cloud_test')
  const effectiveOpenid = OPENID || (action === 'ping' || action === 'authDebug' ? debugOpenid : '')
  if (!effectiveOpenid) return {ok: false, error: 'Missing WeChat openid'}
  const limit = Math.min(Number(event.limit || 30), 100)

  try {
    const authActions = new Set(['ping', 'authDebug', 'register', 'login', 'ensureProfile'])
    let USER_ID = effectiveOpenid
    if (!authActions.has(action)) {
      const owner = await resolveOwner(event, effectiveOpenid)
      USER_ID = owner.userId
    }

    switch (action) {
      case 'ping':
        return {ok: true, data: {version: FUNCTION_VERSION, openid: effectiveOpenid, hasWechatOpenid: Boolean(OPENID)}}

      case 'authDebug':
        return authDebug(effectiveOpenid, event.username)

      case 'setUserAdmin':
        return setUserAdmin(event, USER_ID)

      case 'register':
      case 'login':
        return authAccount(action, effectiveOpenid, event.username, event.password)

      case 'ensureProfile': {
        const metadata = event.metadata || {}
        const profile = await getOrCreateProfile(OPENID, metadata)
        const patch = {
          updated_at: now(),
          ...(metadata.nickname && !profile.nickname ? {nickname: metadata.nickname} : {}),
          ...(metadata.avatar_url ? {avatar_url: metadata.avatar_url} : {}),
        }
        await db.collection('profiles').doc(OPENID).update({data: patch})
        return {ok: true, data: {user: {id: OPENID, openid: OPENID || null, accountType: 'wechat'}, profile: publicProfile({...profile, ...patch})}}
      }

      case 'getProfile':
        return {ok: true, data: await getProfile(USER_ID)}

      case 'updateProfile': {
        const updates = event.updates || {}
        delete updates.id
        delete updates._id
        delete updates.openid
        delete updates.role
        delete updates.is_admin
        await db.collection('profiles').doc(USER_ID).update({data: {...updates, updated_at: now()}})
        return {ok: true, data: true}
      }

      case 'repairGeneratedOwnership':
        return repairGeneratedOwnership(event, effectiveOpenid, USER_ID)

      case 'getMaterials':
        return {ok: true, data: await listOwned('materials', USER_ID, limit)}
      case 'getMaterialPackages':
        return {ok: true, data: await listOwned('materials', USER_ID, limit, {type: 'work'})}
      case 'getGenerationJobs':
        return {ok: true, data: await listOwned('generation_jobs', USER_ID, limit)}
      case 'getGenerationJobById':
        return {ok: true, data: await getOwnedDoc('generation_jobs', event.jobId, USER_ID)}
      case 'getMaterialById':
        return {ok: true, data: await getOwnedDoc('materials', event.materialId, USER_ID)}
      case 'getMaterialChildren': {
        const parentId = event.materialId || event.parentMaterialId
        const parent = await getOwnedDoc('materials', parentId, USER_ID)
        if (!parent) return {ok: true, data: []}
        const children = await db.collection('materials')
          .where({user_id: USER_ID, parent_material_id: parentId})
          .orderBy('created_at', 'desc')
          .limit(Math.min(Math.max(Number(event.limit) || 100, 1), 200))
          .get()
        return {ok: true, data: children.data.map(normalize)}
      }
      case 'deleteMaterial': {
        const row = await getOwnedDoc('materials', event.materialId, USER_ID)
        if (!row) return {ok: false, error: 'No permission to delete this material'}
        await db.collection('materials').doc(event.materialId).remove()
        return {ok: true, data: true}
      }
      case 'recordAsset': {
        const asset = event.asset || {}
        const row = {
          user_id: USER_ID,
          type: asset.type === 'video' ? 'script' : asset.type === 'image' ? 'image' : 'copywriting',
          title: asset.name || 'Material',
          content: asset.url || asset.fileID || '',
          source_mode: 'material',
          package_config: null,
          package_result: null,
          key: asset.key || '',
          url: asset.url || '',
          sizeStr: asset.size ? `${Math.round(Number(asset.size) / 1024)}KB` : '',
          created_at: now(),
          updated_at: now(),
        }
        return {ok: true, data: await createRow('materials', row)}
      }

      case 'getCsMessages':
        return {ok: true, data: await listOwned('cs_messages', USER_ID, limit)}
      case 'saveCsMessage': {
        const row = {
          user_id: USER_ID,
          role: event.role === 'assistant' ? 'assistant' : 'user',
          content: String(event.content || ''),
          image_url: event.imageUrl || null,
          message_type: event.imageUrl ? 'mixed' : 'text',
          is_read: event.role === 'assistant',
          created_at: now(),
        }
        return {ok: true, data: await createRow('cs_messages', row)}
      }

      case 'getOrders':
        return {ok: true, data: await listOwned('orders', USER_ID, limit)}
      case 'getOrderStatus': {
        const res = await db.collection('orders').where({order_no: event.orderNo, user_id: USER_ID}).limit(1).get()
        return {ok: true, data: normalize(res.data[0] || null)}
      }
      case 'createOrder': {
        const row = {
          user_id: USER_ID,
          openid: OPENID || null,
          order_no: event.orderNo,
          plan_name: event.planName,
          plan_level: event.planLevel,
          status: 'pending',
          amount: Number(event.amount || 0),
          wechat_transaction_id: null,
          version: 1,
          paid_at: null,
          created_at: now(),
          updated_at: now(),
        }
        return {ok: true, data: await createRow('orders', row)}
      }

      case 'createConversation': {
        const row = {
          user_id: USER_ID,
          title: String(event.title || '新对话'),
          created_at: now(),
          updated_at: now(),
        }
        return {ok: true, data: await createRow('conversations', row)}
      }
      case 'getConversations':
        return {ok: true, data: await listOwned('conversations', USER_ID, limit)}
      case 'deleteConversation': {
        const row = await getOwnedDoc('conversations', event.conversationId, USER_ID)
        if (!row) return {ok: false, error: 'No permission to delete this conversation'}
        await db.collection('conversations').doc(event.conversationId).remove()
        return {ok: true, data: true}
      }
      case 'saveMessage': {
        const conversation = await getOwnedDoc('conversations', event.conversationId, USER_ID)
        if (!conversation) return {ok: false, error: 'No permission to write this conversation'}
        const row = {
          conversation_id: event.conversationId,
          user_id: USER_ID,
          role: event.role === 'assistant' ? 'assistant' : 'user',
          content: String(event.content || ''),
          tokens_used: Number(event.tokensUsed || 0),
          created_at: now(),
        }
        await db.collection('conversations').doc(event.conversationId).update({data: {updated_at: now()}})
        return {ok: true, data: await createRow('messages', row)}
      }
      case 'getMessages': {
        const conversation = await getOwnedDoc('conversations', event.conversationId, USER_ID)
        if (!conversation) return {ok: true, data: []}
        const res = await db.collection('messages')
          .where({conversation_id: event.conversationId, user_id: USER_ID})
          .orderBy('created_at', 'asc')
          .limit(Math.min(limit, 100))
          .get()
        return {ok: true, data: res.data.map(normalize)}
      }

      case 'createHermesChatTurn': {
        const row = {
          user_id: USER_ID,
          openid: OPENID || null,
          conversation_id: event.conversationId || event.conversation_id || null,
          request_id: event.requestId || event.request_id || `turn_${Date.now()}`,
          user_message: String(event.userMessage || event.user_message || ''),
          history: Array.isArray(event.history) ? event.history.slice(-12) : [],
          status: 'pending',
          reply: '',
          handoff: null,
          interaction: null,
          retry_count: 0,
          max_retries: Number(event.maxRetries || event.max_retries || 3),
          error_message: event.errorMessage || event.error_message || null,
          created_at: now(),
          updated_at: now(),
        }
        return {ok: true, data: await createRow('hermes_chat_turns', row)}
      }
      case 'getHermesChatTurn':
        return {ok: true, data: await getOwnedDoc('hermes_chat_turns', event.turnId || event.turn_id, USER_ID)}
      case 'getHermesChatTurns':
        return {ok: true, data: await listOwned('hermes_chat_turns', USER_ID, limit)}
      case 'updateHermesChatTurn': {
        await requireAdmin(USER_ID)
        const turnId = event.turnId || event.turn_id
        if (!turnId) return {ok: false, error: 'Missing turnId'}
        const patch = {...(event.updates || {})}
        delete patch._id
        delete patch.id
        delete patch.user_id
        await db.collection('hermes_chat_turns').doc(turnId).update({data: {...patch, updated_at: now()}})
        return {ok: true, data: true}
      }
      case 'getStage0Draft':
        return {ok: true, data: await getOwnedDoc('stage0_drafts', event.draftId || event.draft_id, USER_ID)}
      case 'getStage0Drafts':
        return {ok: true, data: await listOwned('stage0_drafts', USER_ID, limit)}
      case 'getActiveStage0Draft': {
        const res = await db.collection('stage0_drafts')
          .where({user_id: USER_ID, status: cmd.in(['collecting', 'ready'])})
          .orderBy('updated_at', 'desc')
          .limit(1)
          .get()
        return {ok: true, data: normalize(res.data[0] || null)}
      }
      case 'cancelStage0Draft': {
        const draft = await getOwnedDoc('stage0_drafts', event.draftId || event.draft_id, USER_ID)
        if (!draft) return {ok: false, error: 'No permission to cancel this draft'}
        await db.collection('stage0_drafts').doc(draft._id || draft.id).update({data: {status: 'cancelled', updated_at: now()}})
        return {ok: true, data: true}
      }

      case 'getSocialAccounts':
        return {ok: true, data: await listOwned('social_accounts', USER_ID, 100)}
      case 'createSocialAccount': {
        const row = {
          user_id: USER_ID,
          platform: String(event.platform || ''),
          account_name: String(event.accountName || ''),
          account_id: event.accountId || null,
          avatar_url: null,
          follower_count: 0,
          is_active: true,
          profile_url: null,
          red_id: null,
          xhs_user_id: null,
          last_sync_at: null,
          raw_profile: null,
          created_at: now(),
          updated_at: now(),
        }
        return {ok: true, data: await createRow('social_accounts', row)}
      }
      case 'deleteSocialAccount': {
        const row = await getOwnedDoc('social_accounts', event.accountId, USER_ID)
        if (!row) return {ok: false, error: 'No permission to delete this account'}
        await db.collection('social_accounts').doc(event.accountId).remove()
        return {ok: true, data: true}
      }

      case 'upsertAnalytics': {
        const date = event.date || now().slice(0, 10)
        const existing = await db.collection('analytics').where({user_id: USER_ID, date}).limit(1).get()
        const data = {
          user_id: USER_ID,
          date,
          granularity: event.granularity || 'day',
          raw_data: event.stats || {},
          updated_at: now(),
        }
        if (existing.data.length) {
          await db.collection('analytics').doc(existing.data[0]._id).update({data})
        } else {
          await db.collection('analytics').add({data: {...data, created_at: now()}})
        }
        return {ok: true, data: true}
      }
      case 'getAnalytics': {
        const res = await db.collection('analytics')
          .where({user_id: USER_ID, granularity: event.granularity || 'day'})
          .orderBy('date', 'desc')
          .limit(limit)
          .get()
        return {ok: true, data: res.data.map(normalize)}
      }

      case 'writeUsageRecord': {
        const before = event.balanceBefore ?? null
        const after = event.balanceAfter ?? null
        const row = {
          user_id: USER_ID,
          type: event.type || 'text',
          model: event.model || null,
          quantity: Number(event.quantity || 0),
          unit: event.unit || 'count',
          amount_deducted: Number(event.amountDeducted || 0),
          balance_before: before,
          balance_after: after,
          from_plan: event.fromPlan !== false,
          raw_response: event.rawResponse ? JSON.stringify(event.rawResponse).slice(0, 2000) : null,
          created_at: now(),
        }
        return {ok: true, data: await createRow('usage_records', row)}
      }
      case 'getUserUsageRecords': {
        const offset = Number(event.offset || 0)
        const res = await db.collection('usage_records')
          .where({user_id: USER_ID})
          .orderBy('created_at', 'desc')
          .skip(offset)
          .limit(limit)
          .get()
        return {ok: true, data: res.data.map(normalize)}
      }
      case 'getUsageSummaryByDay': {
        await requireAdmin(USER_ID)
        const days = Math.min(Number(event.days || 7), 31)
        const rows = []
        for (let i = days - 1; i >= 0; i--) {
          const d = dayStart(new Date())
          d.setDate(d.getDate() - i)
          const next = new Date(d)
          next.setDate(next.getDate() + 1)
          const usage = await listByDate('usage_records', d.toISOString(), next.toISOString())
          rows.push({
            date: d.toISOString().slice(0, 10),
            video_seconds: sum(usage, (row) => row.type === 'video' ? row.quantity : 0),
            graphic_count: sum(usage, (row) => row.type === 'image' ? row.quantity : 0),
            total_deducted: sum(usage, (row) => row.amount_deducted),
            record_count: usage.length,
          })
        }
        return {ok: true, data: rows}
      }

      case 'getAnnouncements': {
        const res = await db.collection('announcements')
          .where({is_active: true})
          .orderBy('created_at', 'desc')
          .limit(10)
          .get()
        return {ok: true, data: res.data.map(normalize)}
      }

      case 'getFinanceReports': {
        await requireAdmin(USER_ID)
        const res = await db.collection('finance_reports').orderBy('report_date', 'desc').limit(limit).get()
        return {ok: true, data: res.data.map(normalize)}
      }
      case 'getLatestFinanceReport': {
        await requireAdmin(USER_ID)
        const res = await db.collection('finance_reports').orderBy('report_date', 'desc').limit(1).get()
        return {ok: true, data: normalize(res.data[0] || null)}
      }
      case 'getTransferOrderByReport': {
        await requireAdmin(USER_ID)
        const res = await db.collection('transfer_orders').where({report_id: event.reportId}).limit(1).get()
        return {ok: true, data: normalize(res.data[0] || null)}
      }
      case 'confirmTransferOrder': {
        await requireAdmin(USER_ID)
        await db.collection('transfer_orders').doc(event.orderId).update({
          data: {
            status: 'confirmed',
            actual_amount: Number(event.actualAmount || 0),
            confirmed_by: USER_ID,
            confirmed_at: now(),
            notes: event.notes || '',
            updated_at: now(),
          },
        })
        return {ok: true, data: true}
      }
      case 'skipTransferOrder': {
        await requireAdmin(USER_ID)
        await db.collection('transfer_orders').doc(event.orderId).update({
          data: {status: 'skipped', notes: event.notes || '', updated_at: now()},
        })
        return {ok: true, data: true}
      }
      case 'getRechargeSummary': {
        await requireAdmin(USER_ID)
        const orders = await db.collection('orders').where({status: 'paid'}).limit(1000).get()
        const all = orders.data
        const month = now().slice(0, 7)
        return {ok: true, data: {
          total_amount: sum(all, (row) => row.amount),
          total_count: all.length,
          this_month_amount: sum(all.filter((row) => String(row.paid_at || row.created_at || '').startsWith(month)), (row) => row.amount),
        }}
      }

      default:
        return {ok: false, error: `Unknown dbApi action: ${action}`}
    }
  } catch (error) {
    return {ok: false, error: error.message || 'Database operation failed'}
  }
}
