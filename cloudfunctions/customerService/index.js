const cloud = require('wx-server-sdk')
const http = require('http')
const https = require('https')

cloud.init({env: cloud.DYNAMIC_CURRENT_ENV})

const db = cloud.database()

const CS_BASE_URL = process.env.CUSTOMER_SERVICE_BASE_URL || process.env.HERMES_BASE_URL || ''
const CS_API_KEY = process.env.CUSTOMER_SERVICE_API_KEY || process.env.HERMES_API_KEY || ''
const CS_MODEL = process.env.CUSTOMER_SERVICE_MODEL || process.env.HERMES_MODEL || 'hermes-agent'

function now() {
  return new Date().toISOString()
}

function joinUrl(baseUrl, path) {
  if (/\/v1\/chat\/completions\/?$/.test(baseUrl)) return baseUrl
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

function safeSessionPart(value, fallback = 'default') {
  const text = String(value || fallback).trim()
  const safe = text
    .replace(/[^a-zA-Z0-9_.:-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96)
  return safe || fallback
}

function buildCustomerSessionId(openid) {
  return `luna_cs_${safeSessionPart(openid, 'anonymous')}`.slice(0, 180)
}

function postJson(url, payload, headers = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const lib = target.protocol === 'http:' ? http : https
    const body = JSON.stringify(payload)
    const req = lib.request({
      method: 'POST',
      hostname: target.hostname,
      port: target.port || undefined,
      path: `${target.pathname}${target.search}`,
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        ...headers,
      },
      timeout: 120000,
    }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`Customer service HTTP ${res.statusCode}: ${text.slice(0, 200)}`))
          return
        }
        try { resolve(JSON.parse(text)) } catch { resolve({content: text}) }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('Customer service request timeout')))
    req.write(body)
    req.end()
  })
}

async function buildReply(openid, text, imageUrl) {
  if (!CS_BASE_URL || !CS_API_KEY) {
    return '已收到，我已经把你的问题记录到客服消息里。客服接入密钥配置后，这里会自动给出 AI 初步回复。'
  }

  const response = await postJson(joinUrl(CS_BASE_URL, '/v1/chat/completions'), {
    model: CS_MODEL,
    messages: [
      {
        role: 'system',
        content: '你是 Luna 小程序客服。用中文简短回答，先解决用户问题；如果涉及支付、订单、账号安全，引导用户保留截图并等待人工复核。',
      },
      {
        role: 'user',
        content: imageUrl ? `${text || '用户上传了一张图片'}\n图片链接：${imageUrl}` : text,
      },
    ],
    temperature: 0.3,
  }, {
    authorization: `Bearer ${CS_API_KEY}`,
    'X-Hermes-Session-Id': buildCustomerSessionId(openid),
  })

  return response?.choices?.[0]?.message?.content || response?.content || '已收到，我会继续帮你跟进这个问题。'
}

exports.main = async (event = {}) => {
  const {OPENID} = cloud.getWXContext()
  if (!OPENID) return {ok: false, error: '未获取到微信 openid'}

  const text = String(event.message || '').trim()
  const imageUrl = event.imageUrl || null
  const userMessage = {
    user_id: OPENID,
    role: 'user',
    content: text || '[图片]',
    image_url: imageUrl,
    message_type: imageUrl ? (text ? 'mixed' : 'image') : 'text',
    is_read: false,
    created_at: now(),
  }
  const userRes = await db.collection('cs_messages').add({data: userMessage})

  let replyText = ''
  try {
    replyText = await buildReply(OPENID, text, imageUrl)
  } catch (error) {
    console.error('customer service reply failed:', error)
    replyText = '已收到，我已经记录你的问题。AI 客服暂时繁忙，人工客服会继续跟进。'
  }

  const reply = {
    user_id: OPENID,
    role: 'assistant',
    content: replyText,
    image_url: null,
    message_type: 'text',
    is_read: true,
    created_at: now(),
  }
  const replyRes = await db.collection('cs_messages').add({data: reply})
  return {
    ok: true,
    data: {
      userMessage: {...userMessage, id: userRes._id, _id: userRes._id},
      message: {...reply, id: replyRes._id, _id: replyRes._id},
    },
  }
}
