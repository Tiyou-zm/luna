const cloud = require('wx-server-sdk')
const crypto = require('crypto')

cloud.init({env: cloud.DYNAMIC_CURRENT_ENV})

const db = cloud.database()
const cmd = db.command
const FUNCTION_VERSION = 'auth-manual-admin-20260601-1'

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

async function getProfile(openid) {
  return db.collection('profiles').doc(openid).get().then((res) => normalize(res.data)).catch(() => null)
}

function hashPassword(password, salt) {
  return crypto.createHash('sha256').update(`${salt}:${password}`).digest('hex')
}

async function getOrCreateProfile(openid, metadata = {}) {
  const existing = await getProfile(openid)
  if (existing) return existing

  const profile = {
    id: openid,
    openid,
    username: metadata.username || `wx_${openid.slice(0, 20)}`,
    nickname: metadata.nickname || 'WeChat User',
    avatar_url: metadata.avatar_url || null,
    role: 'user',
    is_admin: false,
    membership_level: 'free',
    membership_expires: null,
    balance: 0,
    ai_count: 0,
    bound_accounts: 0,
    phone: null,
    created_at: now(),
    updated_at: now(),
  }
  await db.collection('profiles').doc(openid).set({data: stripReservedFields(profile)})
  return profile
}

async function authAccount(action, openid, username, password) {
  const name = String(username || '').trim()
  const pass = String(password || '')
  if (!/^[a-zA-Z0-9_]+$/.test(name)) return {ok: false, error: 'Username can only contain letters, numbers and underscores'}
  if (pass.length < 6) return {ok: false, error: 'Password must be at least 6 characters'}

  const profiles = db.collection('profiles')
  const existing = await profiles.where({username: name}).limit(1).get()

  if (action === 'register') {
    if (existing.data.length && existing.data[0].openid !== openid) {
      return {ok: false, error: 'Username already exists'}
    }
    const profile = await getOrCreateProfile(openid, {username: name, nickname: name})
    const salt = crypto.randomBytes(8).toString('hex')
    const patch = {
      username: name,
      nickname: profile.nickname || name,
      password_salt: salt,
      password_hash: hashPassword(pass, salt),
      updated_at: now(),
    }
    await profiles.doc(openid).update({data: patch})
    return {ok: true, data: {user: {id: openid, openid}, profile: {...profile, ...patch}}}
  }

  if (action === 'login') {
    const profile = existing.data[0]
    if (!profile?.password_hash || !profile?.password_salt) return {ok: false, error: 'Invalid username or password'}
    if (hashPassword(pass, profile.password_salt) !== profile.password_hash) {
      return {ok: false, error: 'Invalid username or password'}
    }
    return {ok: true, data: {user: {id: profile.openid, openid: profile.openid}, profile: normalize(profile)}}
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
    switch (action) {
      case 'ping':
        return {ok: true, data: {version: FUNCTION_VERSION, openid: effectiveOpenid, hasWechatOpenid: Boolean(OPENID)}}

      case 'authDebug':
        return authDebug(effectiveOpenid, event.username)

      case 'setUserAdmin':
        return setUserAdmin(event, OPENID)

      case 'register':
      case 'login':
        return authAccount(action, OPENID, event.username, event.password)

      case 'ensureProfile': {
        const metadata = event.metadata || {}
        const profile = await getOrCreateProfile(OPENID, metadata)
        const patch = {
          updated_at: now(),
          ...(metadata.nickname && !profile.nickname ? {nickname: metadata.nickname} : {}),
          ...(metadata.avatar_url ? {avatar_url: metadata.avatar_url} : {}),
        }
        await db.collection('profiles').doc(OPENID).update({data: patch})
        return {ok: true, data: {user: {id: OPENID, openid: OPENID}, profile: {...profile, ...patch}}}
      }

      case 'getProfile':
        return {ok: true, data: await getProfile(OPENID)}

      case 'updateProfile': {
        const updates = event.updates || {}
        delete updates.id
        delete updates._id
        delete updates.openid
        delete updates.role
        delete updates.is_admin
        await db.collection('profiles').doc(OPENID).update({data: {...updates, updated_at: now()}})
        return {ok: true, data: true}
      }

      case 'getMaterials':
        return {ok: true, data: await listOwned('materials', OPENID, limit)}
      case 'getMaterialPackages':
        return {ok: true, data: await listOwned('materials', OPENID, limit, {type: 'work'})}
      case 'getGenerationJobs':
        return {ok: true, data: await listOwned('generation_jobs', OPENID, limit)}
      case 'getGenerationJobById':
        return {ok: true, data: await getOwnedDoc('generation_jobs', event.jobId, OPENID)}
      case 'getMaterialById':
        return {ok: true, data: await getOwnedDoc('materials', event.materialId, OPENID)}
      case 'deleteMaterial': {
        const row = await getOwnedDoc('materials', event.materialId, OPENID)
        if (!row) return {ok: false, error: 'No permission to delete this material'}
        await db.collection('materials').doc(event.materialId).remove()
        return {ok: true, data: true}
      }
      case 'recordAsset': {
        const asset = event.asset || {}
        const row = {
          user_id: OPENID,
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
        return {ok: true, data: await listOwned('cs_messages', OPENID, limit)}
      case 'saveCsMessage': {
        const row = {
          user_id: OPENID,
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
        return {ok: true, data: await listOwned('orders', OPENID, limit)}
      case 'getComputeRecharges':
        return {ok: true, data: await listOwned('compute_recharges', OPENID, limit)}
      case 'getOrderStatus': {
        const res = await db.collection('orders').where({order_no: event.orderNo, user_id: OPENID}).limit(1).get()
        return {ok: true, data: normalize(res.data[0] || null)}
      }
      case 'getComputeRechargeStatus': {
        const res = await db.collection('compute_recharges').where({order_no: event.orderNo, user_id: OPENID}).limit(1).get()
        return {ok: true, data: normalize(res.data[0] || null)}
      }
      case 'createOrder': {
        const row = {
          user_id: OPENID,
          openid: OPENID,
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
          user_id: OPENID,
          title: String(event.title || '新对话'),
          created_at: now(),
          updated_at: now(),
        }
        return {ok: true, data: await createRow('conversations', row)}
      }
      case 'getConversations':
        return {ok: true, data: await listOwned('conversations', OPENID, limit)}
      case 'deleteConversation': {
        const row = await getOwnedDoc('conversations', event.conversationId, OPENID)
        if (!row) return {ok: false, error: 'No permission to delete this conversation'}
        await db.collection('conversations').doc(event.conversationId).remove()
        return {ok: true, data: true}
      }
      case 'saveMessage': {
        const conversation = await getOwnedDoc('conversations', event.conversationId, OPENID)
        if (!conversation) return {ok: false, error: 'No permission to write this conversation'}
        const row = {
          conversation_id: event.conversationId,
          user_id: OPENID,
          role: event.role === 'assistant' ? 'assistant' : 'user',
          content: String(event.content || ''),
          tokens_used: Number(event.tokensUsed || 0),
          created_at: now(),
        }
        await db.collection('conversations').doc(event.conversationId).update({data: {updated_at: now()}})
        return {ok: true, data: await createRow('messages', row)}
      }
      case 'getMessages': {
        const conversation = await getOwnedDoc('conversations', event.conversationId, OPENID)
        if (!conversation) return {ok: true, data: []}
        const res = await db.collection('messages')
          .where({conversation_id: event.conversationId, user_id: OPENID})
          .orderBy('created_at', 'asc')
          .limit(Math.min(limit, 100))
          .get()
        return {ok: true, data: res.data.map(normalize)}
      }

      case 'getSocialAccounts':
        return {ok: true, data: await listOwned('social_accounts', OPENID, 100)}
      case 'createSocialAccount': {
        const row = {
          user_id: OPENID,
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
        const row = await getOwnedDoc('social_accounts', event.accountId, OPENID)
        if (!row) return {ok: false, error: 'No permission to delete this account'}
        await db.collection('social_accounts').doc(event.accountId).remove()
        return {ok: true, data: true}
      }

      case 'upsertAnalytics': {
        const date = event.date || now().slice(0, 10)
        const existing = await db.collection('analytics').where({user_id: OPENID, date}).limit(1).get()
        const data = {
          user_id: OPENID,
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
          .where({user_id: OPENID, granularity: event.granularity || 'day'})
          .orderBy('date', 'desc')
          .limit(limit)
          .get()
        return {ok: true, data: res.data.map(normalize)}
      }

      case 'writeUsageRecord': {
        const before = event.balanceBefore ?? null
        const after = event.balanceAfter ?? null
        const row = {
          user_id: OPENID,
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
          .where({user_id: OPENID})
          .orderBy('created_at', 'desc')
          .skip(offset)
          .limit(limit)
          .get()
        return {ok: true, data: res.data.map(normalize)}
      }
      case 'getUsageSummaryByDay': {
        await requireAdmin(OPENID)
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
        await requireAdmin(OPENID)
        const res = await db.collection('finance_reports').orderBy('report_date', 'desc').limit(limit).get()
        return {ok: true, data: res.data.map(normalize)}
      }
      case 'getLatestFinanceReport': {
        await requireAdmin(OPENID)
        const res = await db.collection('finance_reports').orderBy('report_date', 'desc').limit(1).get()
        return {ok: true, data: normalize(res.data[0] || null)}
      }
      case 'getTransferOrderByReport': {
        await requireAdmin(OPENID)
        const res = await db.collection('transfer_orders').where({report_id: event.reportId}).limit(1).get()
        return {ok: true, data: normalize(res.data[0] || null)}
      }
      case 'confirmTransferOrder': {
        await requireAdmin(OPENID)
        await db.collection('transfer_orders').doc(event.orderId).update({
          data: {
            status: 'confirmed',
            actual_amount: Number(event.actualAmount || 0),
            confirmed_by: OPENID,
            confirmed_at: now(),
            notes: event.notes || '',
            updated_at: now(),
          },
        })
        return {ok: true, data: true}
      }
      case 'skipTransferOrder': {
        await requireAdmin(OPENID)
        await db.collection('transfer_orders').doc(event.orderId).update({
          data: {status: 'skipped', notes: event.notes || '', updated_at: now()},
        })
        return {ok: true, data: true}
      }
      case 'getRechargeSummary': {
        await requireAdmin(OPENID)
        const recharges = await db.collection('compute_recharges').where({status: 'paid'}).limit(1000).get()
        const orders = await db.collection('orders').where({status: 'paid'}).limit(1000).get()
        const all = [...recharges.data, ...orders.data]
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
