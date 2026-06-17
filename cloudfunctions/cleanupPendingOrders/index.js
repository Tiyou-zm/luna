const cloud = require('wx-server-sdk')

cloud.init({env: cloud.DYNAMIC_CURRENT_ENV})

const db = cloud.database()
const cmd = db.command
const FUNCTION_VERSION = 'cleanup-pending-orders-20260605-1'
const DEFAULT_TTL_MINUTES = 30

function now() {
  return new Date().toISOString()
}

async function ensureCollection(name) {
  try {
    await db.collection(name).limit(1).get()
  } catch (error) {
    if (!String(error?.message || error).includes('collection not exists')) throw error
    await db.createCollection(name).catch(() => null)
  }
}

async function cleanupCollection(collection, cutoff, limit) {
  await ensureCollection(collection)
  const res = await db.collection(collection)
    .where({
      status: 'pending',
      created_at: cmd.lt(cutoff),
    })
    .limit(limit)
    .get()

  const rows = res.data || []
  const cleanedAt = now()
  let updated = 0
  for (const row of rows) {
    if (!row?._id) continue
    await db.collection(collection).doc(row._id).update({
      data: {
        status: 'cancelled',
        cancelled_at: cleanedAt,
        cancel_reason: 'pending_timeout',
        updated_at: cleanedAt,
      },
    })
    updated++
  }
  return {collection, matched: rows.length, updated}
}

exports.main = async (event = {}) => {
  const ttlMinutes = Math.max(10, Number(event.ttlMinutes || process.env.PENDING_ORDER_TTL_MINUTES || DEFAULT_TTL_MINUTES))
  const limit = Math.min(Math.max(1, Number(event.limit || 100)), 500)
  const cutoff = new Date(Date.now() - ttlMinutes * 60 * 1000).toISOString()

  const results = []
  for (const collection of ['orders']) {
    results.push(await cleanupCollection(collection, cutoff, limit))
  }

  return {
    ok: true,
    data: {
      version: FUNCTION_VERSION,
      ttlMinutes,
      cutoff,
      results,
    },
  }
}
