const http = require('http')
const https = require('https')
const cloudbase = require('@cloudbase/node-sdk')

const ENV_ID = process.env.CLOUDBASE_ENV_ID || process.env.TCB_ENV_ID || 'cloud1-d3g0qen9b36b6a0b8'
const SECRET_ID = process.env.TENCENT_SECRET_ID || process.env.TENCENTCLOUD_SECRETID || ''
const SECRET_KEY = process.env.TENCENT_SECRET_KEY || process.env.TENCENTCLOUD_SECRETKEY || ''

const HERMES_BASE_URL = process.env.HERMES_BASE_URL || 'http://152.136.47.2:8642/v1/chat/completions'
const HERMES_API_KEY = process.env.HERMES_API_KEY || ''
const HERMES_MODEL = process.env.HERMES_MODEL || 'hermes-agent'
const HERMES_TIMEOUT_MS = Number(process.env.HERMES_TIMEOUT_MS || 50 * 60 * 1000)
const HERMES_REPAIR_TIMEOUT_MS = Number(process.env.HERMES_REPAIR_TIMEOUT_MS || 10 * 60 * 1000)
const HERMES_REPAIR_MAX_CHARS = Number(process.env.HERMES_REPAIR_MAX_CHARS || 18000)
const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS || 15000)
const WORKER_ID = process.env.WORKER_ID || `hermes-worker-${process.pid}`
const WORKER_ONCE = process.env.WORKER_ONCE === 'true'

const app = cloudbase.init({
  env: ENV_ID,
  ...(SECRET_ID && SECRET_KEY ? {secretId: SECRET_ID, secretKey: SECRET_KEY} : {}),
})
const db = app.database()
const cmd = db.command

function now() {
  return new Date().toISOString()
}

function joinUrl(baseUrl, path) {
  if (/\/v1\/chat\/completions\/?$/.test(baseUrl)) return baseUrl
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

function postJson(url, payload, headers = {}, timeout = HERMES_TIMEOUT_MS) {
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
      timeout,
    }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}: ${text.slice(0, 500)}`))
          return
        }
        try {
          resolve(JSON.parse(text))
        } catch {
          resolve({content: text})
        }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('Hermes request timeout')))
    req.write(body)
    req.end()
  })
}

function extractJson(value) {
  if (!value) return null
  if (typeof value === 'object') return value
  const text = String(value)
    .replace(/<thinking>[\s\S]*?<\/thinking>/g, '')
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .trim()
  const parseBalancedAt = (source, start) => {
    if (start < 0) return null
    const open = source[start]
    if (open !== '{' && open !== '[') return null
    const close = open === '{' ? '}' : ']'
    let depth = 0
    let inString = false
    let escaped = false

    for (let i = start; i < source.length; i += 1) {
      const ch = source[i]
      if (inString) {
        if (escaped) {
          escaped = false
        } else if (ch === '\\') {
          escaped = true
        } else if (ch === '"') {
          inString = false
        }
        continue
      }
      if (ch === '"') {
        inString = true
      } else if (ch === open) {
        depth += 1
      } else if (ch === close) {
        depth -= 1
        if (depth === 0) {
          try { return {value: JSON.parse(source.slice(start, i + 1)), end: i} } catch { return null }
        }
      }
    }
    return null
  }
  const collectBalanced = (source) => {
    const values = []
    for (let i = 0; i < source.length; i += 1) {
      if (source[i] !== '{' && source[i] !== '[') continue
      const parsed = parseBalancedAt(source, i)
      if (parsed) {
        values.push(parsed.value)
        i = parsed.end
      }
    }
    return values
  }
  const hasMaterialPackageShape = (candidate) => {
    const pkg = candidate?.type === 'material_package'
      ? candidate
      : candidate?.material_package || candidate
    const platforms = pkg?.content?.platforms || pkg?.platforms
    return Boolean(platforms && typeof platforms === 'object')
  }
  const preferMaterialPackage = (candidates) => {
    if (!Array.isArray(candidates)) return hasMaterialPackageShape(candidates) ? candidates : null
    return candidates.find(hasMaterialPackageShape) || null
  }

  try {
    const parsed = JSON.parse(text)
    return preferMaterialPackage(parsed) || parsed
  } catch {
    const block = text.match(/```(?:json)?\s*([\s\S]+?)```/)
    if (block) {
      try {
        const parsed = JSON.parse(block[1])
        const blockPackage = preferMaterialPackage(parsed)
        if (blockPackage) return blockPackage
      } catch {}
      const blockCandidates = collectBalanced(block[1])
      const blockPackage = preferMaterialPackage(blockCandidates)
      if (blockPackage) return blockPackage
    }
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(text.slice(start, end + 1))
        return preferMaterialPackage(parsed) || parsed
      } catch {}
    }
    const candidates = collectBalanced(text)
    const packageCandidate = preferMaterialPackage(candidates)
    if (packageCandidate) return packageCandidate
    if (candidates[0]) return candidates[0]
    return null
  }
}

function cleanTags(tags) {
  if (!Array.isArray(tags)) return []
  return tags.map((tag) => String(tag).replace(/^#+/, '').trim()).filter(Boolean)
}

function fromPost(post = {}, fallbackTitle, fallbackBody) {
  return {
    titles: [post.title || fallbackTitle].filter(Boolean),
    body: post.body || post.content || fallbackBody,
    cover_suggestion: post.cover_suggestion || post.cover || '',
    image_prompts: Array.isArray(post.image_prompts) ? post.image_prompts : [],
    hashtags: cleanTags(post.tags || post.hashtags),
    best_time: post.best_time || '',
    ad_advice: post.ad_advice || '',
    risk_warning: post.risk_warning || '',
  }
}

function fromScript(script = {}, fallbackTitle, fallbackBody) {
  const sections = Array.isArray(script.sections) ? script.sections : []
  const body = sections.map((section) => {
    const time = section.time ? `${section.time} ` : ''
    const type = section.type ? `【${section.type}】` : ''
    return `${time}${type}${section.content || ''}`.trim()
  }).filter(Boolean).join('\n')
  return fromPost({
    ...script,
    body: body || script.body || (script.hook ? `开场：${script.hook}` : ''),
  }, fallbackTitle, fallbackBody)
}

function fromOutline(outline = {}, fallbackTitle, fallbackBody) {
  const sections = Array.isArray(outline.sections) ? outline.sections : []
  return fromPost({
    ...outline,
    body: outline.body || sections.join('\n'),
  }, fallbackTitle, fallbackBody)
}

function normalizeHermesResult(rawPackage, job) {
  const pkg = rawPackage && rawPackage.type === 'material_package'
    ? rawPackage
    : (rawPackage && rawPackage.material_package) || rawPackage
  const platforms = (pkg && pkg.platforms) || {}
  const fallbackBody = `围绕“${job.user_message || job.goal || '内容方向'}”生成多平台内容包。`
  const result = {}

  const xhsPost = platforms.xiaohongshu?.posts?.[0] || platforms.xhs?.posts?.[0]
  if (xhsPost) result['小红书'] = fromPost(xhsPost, `${job.goal || '品牌曝光'}种草文案`, fallbackBody)

  const douyinScript = platforms.douyin?.scripts?.[0] || platforms.tiktok?.scripts?.[0]
  if (douyinScript) result['抖音'] = fromScript(douyinScript, `${job.goal || '品牌曝光'}短视频脚本`, fallbackBody)

  const momentsPost = platforms.moments?.posts?.[0]
  if (momentsPost) result['视频号'] = fromPost(momentsPost, `${job.goal || '品牌曝光'}朋友圈/视频号文案`, fallbackBody)

  const publicOutline = platforms.wechat_public?.outline || platforms.wechat_public?.article || platforms.official_account?.outline
  if (publicOutline) result['公众号'] = fromOutline(publicOutline, `${job.goal || '品牌曝光'}公众号文章`, fallbackBody)

  return Object.keys(result).length > 0 ? result : null
}

const PLATFORM_LABELS_V2 = {
  xiaohongshu: '小红书',
  xhs: '小红书',
  douyin: '抖音',
  tiktok: '抖音',
  moments: '朋友圈',
  wechat_video: '视频号',
  video_channel: '视频号',
  wechat_public: '公众号',
  official_account: '公众号',
}

function cleanTagsV2(tags) {
  if (!Array.isArray(tags)) return []
  return tags.map((tag) => String(tag).replace(/^#+/, '').trim()).filter(Boolean)
}

function textList(items) {
  if (!Array.isArray(items)) return []
  return items.map((item) => {
    if (typeof item === 'string') return item
    return item?.content || item?.title || item?.name || JSON.stringify(item)
  }).filter(Boolean)
}

function materialPackage(rawPackage) {
  return rawPackage?.type === 'material_package'
    ? rawPackage
    : rawPackage?.material_package || rawPackage
}

function packagePlatforms(pkg) {
  return pkg?.content?.platforms || pkg?.platforms || {}
}

function platformPlan(pkg, key) {
  return pkg?.content_strategy?.platform_plan?.[key] || ''
}

function researchSummary(pkg) {
  const research = pkg?.trending_research || {}
  const hotTopics = textList(research.hot_topics).slice(0, 5)
  const pains = textList(research.user_pains).slice(0, 5)
  const features = textList(research.key_features).slice(0, 5)
  return [
    hotTopics.length ? `热点方向：${hotTopics.join(' / ')}` : '',
    pains.length ? `用户痛点：${pains.join(' / ')}` : '',
    features.length ? `核心卖点：${features.join(' / ')}` : '',
  ].filter(Boolean).join('\n')
}

function displayPost(post = {}, fallbackTitle, fallbackBody, pkg, platformKey) {
  return {
    titles: Array.isArray(post.titles) && post.titles.length ? post.titles : [post.title || fallbackTitle].filter(Boolean),
    body: post.body || post.content || fallbackBody,
    cover_suggestion: post.cover_suggestion || post.cover || post.image_concept || '',
    image_prompts: Array.isArray(post.image_prompts) ? post.image_prompts : [],
    hashtags: cleanTagsV2(post.tags || post.hashtags),
    best_time: post.best_time || post.publish_time || '',
    ad_advice: post.ad_advice || post.push_advice || platformPlan(pkg, platformKey),
    risk_warning: post.risk_warning || post.fact_check_notes || '',
    fact_check_notes: post.fact_check_notes || '',
    delivery_logic: post.delivery_logic || researchSummary(pkg),
  }
}

function displayScript(script = {}, fallbackTitle, fallbackBody, pkg, platformKey) {
  const sections = Array.isArray(script.sections) ? script.sections : []
  const body = sections.map((section) => {
    const time = section.time ? `${section.time} ` : ''
    const type = section.type ? `【${section.type}】` : ''
    return `${time}${type}${section.content || ''}`.trim()
  }).filter(Boolean).join('\n')
  const pushAdvice = script.push_advice || script.publish_advice || script.ad_advice || platformPlan(pkg, platformKey)
  const deliveryLogic = script.delivery_logic || script.launch_logic || researchSummary(pkg)
  return {
    ...displayPost({
      ...script,
      body: body || script.body || (script.hook ? `开场：${script.hook}` : ''),
      ad_advice: pushAdvice,
    }, fallbackTitle, fallbackBody, pkg, platformKey),
    duration: script.duration || '',
    hook: script.hook || '',
    sections,
    push_advice: pushAdvice,
    delivery_logic: deliveryLogic,
  }
}

function displayOutline(outline = {}, fallbackTitle, fallbackBody, pkg, platformKey) {
  const sections = Array.isArray(outline.sections) ? outline.sections : []
  return displayPost({
    ...outline,
    body: outline.body || sections.join('\n') || fallbackBody,
  }, fallbackTitle, fallbackBody, pkg, platformKey)
}

function normalizeHermesResult(rawPackage, job) {
  const pkg = materialPackage(rawPackage)
  const platforms = packagePlatforms(pkg)
  const fallbackBody = `围绕“${job.user_message || job.goal || '内容方向'}”生成多平台内容包。`
  const result = {}

  const xhsPost = platforms.xiaohongshu?.posts?.[0] || platforms.xhs?.posts?.[0]
  if (xhsPost) result['小红书'] = displayPost(xhsPost, `${job.goal || '品牌曝光'}种草文案`, fallbackBody, pkg, 'xiaohongshu')

  const douyinScript = platforms.douyin?.scripts?.[0] || platforms.tiktok?.scripts?.[0]
  if (douyinScript) result['抖音'] = displayScript(douyinScript, `${job.goal || '品牌曝光'}短视频脚本`, fallbackBody, pkg, 'douyin')

  const videoScript = platforms.wechat_video?.scripts?.[0] || platforms.video_channel?.scripts?.[0]
  if (videoScript) result['视频号'] = displayScript(videoScript, `${job.goal || '品牌曝光'}视频号脚本`, fallbackBody, pkg, 'wechat_video')

  const momentsPost = platforms.moments?.posts?.[0]
  if (momentsPost) result['朋友圈'] = displayPost(momentsPost, `${job.goal || '品牌曝光'}朋友圈文案`, fallbackBody, pkg, 'moments')

  const publicOutline = platforms.wechat_public?.outline || platforms.wechat_public?.article || platforms.official_account?.outline
  if (publicOutline) result['公众号'] = displayOutline(publicOutline, `${job.goal || '品牌曝光'}公众号文章`, fallbackBody, pkg, 'wechat_public')

  return Object.keys(result).length > 0 ? result : null
}

function formatJsonBlock(value) {
  if (!value || (Array.isArray(value) && value.length === 0)) return ''
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

function buildDerivedMaterials(baseMaterial, rawPackage, result, job, materialId) {
  const pkg = materialPackage(rawPackage)
  const platforms = packagePlatforms(pkg)
  const rows = []
  const common = {
    user_id: job.user_id,
    source_mode: job.mode === 'direction' ? 'direction' : 'material',
    parent_material_id: materialId,
    package_config: baseMaterial.package_config,
    package_result: null,
    created_at: now(),
    updated_at: now(),
  }

  const fileAssets = [
    ...(Array.isArray(pkg?.assets?.generated) ? pkg.assets.generated : []),
    ...(Array.isArray(pkg?.assets?.placeholder) ? pkg.assets.placeholder : []),
  ]

  fileAssets.forEach((asset, index) => {
    rows.push({
      ...common,
      type: asset.type === 'image' ? 'image' : 'copywriting',
      library_section: 'asset',
      title: asset.name || asset.title || `Asset file ${index + 1}`,
      content: asset.url || asset.path || '',
      url: asset.url || asset.path || '',
      key: asset.path || asset.url || '',
      sizeStr: asset.size || '',
      metadata: asset,
    })
  })

  if (pkg?.package_archive?.enabled || pkg?.package_archive?.path) {
    rows.push({
      ...common,
      type: 'archive',
      library_section: 'asset',
      title: pkg.package_archive.name || `${baseMaterial.title} package archive`,
      content: pkg.package_archive.path || '',
      url: pkg.package_archive.url || pkg.package_archive.path || '',
      metadata: pkg.package_archive,
    })
  }

  return rows

  Object.entries(result || {}).forEach(([platform, item]) => {
    rows.push({
      ...common,
      type: platform === '抖音' || platform === '视频号' ? 'script' : 'copywriting',
      library_section: platform === '抖音' || platform === '视频号' ? 'video' : 'copy',
      platform_label: platform,
      title: `${platform}｜${item.titles?.[0] || baseMaterial.title}`,
      content: item.body || '',
      metadata: item,
    })
  })

  const videoScripts = Array.isArray(pkg?.assets?.video_scripts) ? pkg.assets.video_scripts : []
  videoScripts.forEach((script, index) => {
    rows.push({
      ...common,
      type: 'script',
      library_section: 'video',
      platform_label: script.platform || '视频脚本',
      title: script.title || `视频脚本 ${index + 1}`,
      content: formatJsonBlock(script),
      metadata: script,
    })
  })

  const generated = Array.isArray(pkg?.assets?.generated) ? pkg.assets.generated : []
  const placeholders = Array.isArray(pkg?.assets?.placeholder) ? pkg.assets.placeholder : []
  ;[...generated, ...placeholders].forEach((asset, index) => {
    rows.push({
      ...common,
      type: asset.type === 'image' ? 'image' : 'copywriting',
      library_section: 'asset',
      title: asset.name || asset.title || `素材文件 ${index + 1}`,
      content: asset.url || asset.path || '',
      url: asset.url || asset.path || '',
      key: asset.path || asset.url || '',
      sizeStr: asset.size || '',
      metadata: asset,
    })
  })

  const strategyText = [
    pkg?.content_strategy ? `内容策略\n${formatJsonBlock(pkg.content_strategy)}` : '',
    pkg?.trending_research ? `热点与用户洞察\n${formatJsonBlock(pkg.trending_research)}` : '',
    pkg?.qa ? `质检结果\n${formatJsonBlock(pkg.qa)}` : '',
    pkg?.final_checks ? `最终校验\n${formatJsonBlock(pkg.final_checks)}` : '',
  ].filter(Boolean).join('\n\n')
  if (strategyText) {
    rows.push({
      ...common,
      type: 'analysis',
      library_section: 'strategy',
      title: `${baseMaterial.title}｜策略与投放逻辑`,
      content: strategyText,
      metadata: {
        workflow: pkg?.workflow || null,
        time_sensitivity: pkg?.time_sensitivity || null,
        content_strategy: pkg?.content_strategy || null,
        trending_research: pkg?.trending_research || null,
        qa: pkg?.qa || null,
        final_checks: pkg?.final_checks || null,
      },
    })
  }

  if (pkg?.package_archive?.enabled || pkg?.package_archive?.path) {
    rows.push({
      ...common,
      type: 'archive',
      library_section: 'asset',
      title: `${baseMaterial.title}｜交付压缩包`,
      content: pkg.package_archive.path || '',
      url: pkg.package_archive.url || pkg.package_archive.path || '',
      metadata: pkg.package_archive,
    })
  }

  return rows
}

async function logEvent(job, type, message) {
  await db.collection('generation_job_events').add({
    job_id: job._id || job.id,
    user_id: job.user_id,
    type,
    message,
    created_at: now(),
  }).catch(() => null)
}

async function getNextJob() {
  const res = await db.collection('generation_jobs')
    .where({status: 'queued'})
    .orderBy('created_at', 'asc')
    .limit(1)
    .get()
  return res.data[0] || null
}

async function markJob(jobId, data) {
  await db.collection('generation_jobs').doc(jobId).update({
    ...data,
    updated_at: now(),
  })
}

async function callHermes(job) {
  const prompt = job.hermes_prompt || job.user_message || ''
  const response = await postJson(joinUrl(HERMES_BASE_URL, '/v1/chat/completions'), {
    model: job.hermes_model || HERMES_MODEL,
    messages: [
      {role: 'system', content: '你只输出可解析 JSON。'},
      {role: 'user', content: prompt},
    ],
    temperature: 0.7,
  }, {
    authorization: `Bearer ${HERMES_API_KEY}`,
  })
  const content = response?.choices?.[0]?.message?.content || response?.content || response
  return {
    parsed: extractJson(content),
    raw: typeof content === 'string' ? content : JSON.stringify(content),
  }
}

function buildRepairPrompt(job, brokenRaw, reason) {
  const rawText = String(brokenRaw || '')
  const head = rawText.slice(0, Math.ceil(HERMES_REPAIR_MAX_CHARS * 0.65))
  const tail = rawText.length > head.length
    ? rawText.slice(-Math.floor(HERMES_REPAIR_MAX_CHARS * 0.35))
    : ''

  return [
    '你是 Luna 的素材包 JSON 修复器。',
    '任务：把下面 Hermes 已生成但格式损坏或混入废话的结果，修复成一个可被 JSON.parse 解析的 material_package。',
    '只允许输出 JSON，不要 Markdown，不要解释，不要补充自然语言。',
    '必须保留已有内容，不要重新创作一套无关内容。',
    '如果有残缺字段，请根据上下文补齐最小必要结构。',
    '目标格式：',
    '{"type":"material_package","platforms":{"xiaohongshu":{"posts":[{"scene":"功能种草","title":"封面标题","body":"正文内容","tags":["#AI工具"]}]},"douyin":{"scripts":[{"duration":30,"hook":"开场","sections":[{"time":"0-3s","type":"hook","content":"..."}]}]},"moments":{"posts":[{"style":"产品体验型","body":"文案内容"}]},"wechat_public":{"outline":{"title":"文章标题","sections":["开头Hook","痛点共鸣","功能拆解"]}}}}',
    '',
    `修复原因：${reason || 'parse_failed'}`,
    `用户指令：${job.user_message || job.goal || ''}`,
    `目标平台：${(job.platforms || []).join('、') || '小红书、抖音、视频号、公众号'}`,
    '',
    '损坏输出开始：',
    head,
    tail ? '\n--- 中间内容已省略，以下是尾部 ---\n' + tail : '',
    '损坏输出结束。',
  ].join('\n')
}

function buildRepairPrompt(job, brokenRaw, reason) {
  const rawText = String(brokenRaw || '')
  const head = rawText.slice(0, Math.ceil(HERMES_REPAIR_MAX_CHARS * 0.65))
  const tail = rawText.length > head.length
    ? rawText.slice(-Math.floor(HERMES_REPAIR_MAX_CHARS * 0.35))
    : ''

  return [
    '你是 Luna 的素材包 JSON 修复器。',
    '任务：把下面 Hermes 已生成但格式损坏或混入废话的结果，修复成一个可被 JSON.parse 解析的 material_package v2.0.0。',
    '只允许输出 JSON，不要 Markdown，不要解释，不要补充自然语言。',
    '必须保留已有内容，不要重新创作一套无关内容。',
    '视频内容只允许保留为脚本、推送建议、投放逻辑，不要生成视频文件字段。',
    '目标格式最小骨架：',
    '{"type":"material_package","version":"2.0.0","workflow":{},"trending_research":{},"content_strategy":{},"content":{"platforms":{"xiaohongshu":{"posts":[]},"douyin":{"scripts":[]},"moments":{"posts":[]},"wechat_public":{"outline":{"title":"","sections":[]}}}},"image_prompts":{},"assets":{"generated":[],"video_scripts":[],"not_generated":[],"placeholder":[]},"qa":{},"final_checks":{}}',
    '',
    `修复原因：${reason || 'parse_failed'}`,
    `用户指令：${job.user_message || job.goal || ''}`,
    `目标平台：${(job.platforms || []).join('、') || '小红书、抖音、朋友圈、公众号'}`,
    '',
    '损坏输出开始：',
    head,
    tail ? '\n--- 中间内容已省略，以下是尾部 ---\n' + tail : '',
    '损坏输出结束。',
  ].join('\n')
}

async function callHermesRepair(job, brokenRaw, reason) {
  const response = await postJson(joinUrl(HERMES_BASE_URL, '/v1/chat/completions'), {
    model: job.hermes_model || HERMES_MODEL,
    messages: [
      {role: 'system', content: '你只修复并输出可解析 JSON。'},
      {role: 'user', content: buildRepairPrompt(job, brokenRaw, reason)},
    ],
    temperature: 0,
  }, {
    authorization: `Bearer ${HERMES_API_KEY}`,
  }, HERMES_REPAIR_TIMEOUT_MS)
  const content = response?.choices?.[0]?.message?.content || response?.content || response
  return {
    parsed: extractJson(content),
    raw: typeof content === 'string' ? content : JSON.stringify(content),
  }
}

async function processJob(job) {
  const jobId = job._id || job.id
  console.log(`[${WORKER_ID}] start job ${jobId}`)
  await markJob(jobId, {
    status: 'running',
    worker_id: WORKER_ID,
    progress_text: 'Hermes 正在收集信息和制作素材包',
    started_at: job.started_at || now(),
  })
  await logEvent(job, 'started', 'Hermes Worker 已开始执行')

  try {
    const hermesResponse = await callHermes(job)
    let rawPackage = hermesResponse.parsed
    let result = normalizeHermesResult(rawPackage, job)
    let repairResponse = null

    if (!result) {
      await markJob(jobId, {
        hermes_raw_preview: (hermesResponse.raw || '').slice(0, 3000),
        progress_text: 'Hermes 回传格式异常，正在自动修复素材包',
      })
      await logEvent(job, 'repairing', 'Hermes 回传格式异常，Worker 正在请求 Hermes 修复 JSON')

      try {
        repairResponse = await callHermesRepair(job, hermesResponse.raw, rawPackage ? 'invalid_material_package_shape' : 'parse_failed_or_truncated')
        const repairedPackage = repairResponse.parsed
        const repairedResult = normalizeHermesResult(repairedPackage, job)
        if (repairedResult) {
          rawPackage = repairedPackage
          result = repairedResult
          await markJob(jobId, {
            hermes_repair_raw_preview: (repairResponse.raw || '').slice(0, 3000),
          })
          await logEvent(job, 'repaired', 'Hermes 回传已自动修复为可入库素材包')
        }
      } catch (repairError) {
        await markJob(jobId, {
          hermes_repair_error: repairError instanceof Error ? repairError.message : String(repairError),
        })
      }

      if (!result) {
        await markJob(jobId, {
          hermes_repair_raw_preview: (repairResponse?.raw || '').slice(0, 3000),
        })
        throw new Error('Hermes did not return a parsable material_package after repair')
      }
    }

    const pkg = materialPackage(rawPackage)
    const material = {
      user_id: job.user_id,
      type: 'work',
      title: job.title || `${(job.platforms || [])[0] || 'Luna'}素材包`,
      content: `已生成 ${Object.keys(result).length} 个平台的素材包`,
      source_mode: job.mode === 'direction' ? 'direction' : 'material',
      package_config: {
        mode: job.mode,
        platforms: job.platforms || [],
        goal: job.goal || '',
        industry: job.industry || null,
        task_type: job.guard?.task_type || (job.mode === 'direction' ? 'direction_package' : 'material_package'),
        provider: 'hermes',
        version: pkg?.version || '1.0.0',
        delivery_mode: pkg?.workflow?.delivery_mode || null,
        guard: job.guard || null,
        generation_job_id: jobId,
        repair_used: Boolean(repairResponse),
      },
      package_result: result,
      hermes_raw: rawPackage,
      workflow: pkg?.workflow || null,
      trending_research: pkg?.trending_research || null,
      content_strategy: pkg?.content_strategy || null,
      assets: pkg?.assets || null,
      package_archive: pkg?.package_archive || null,
      qa: pkg?.qa || null,
      final_checks: pkg?.final_checks || null,
      hermes_raw_preview: (hermesResponse.raw || '').slice(0, 3000),
      hermes_repair_raw_preview: (repairResponse?.raw || '').slice(0, 3000),
      created_at: now(),
      updated_at: now(),
    }
    const res = await db.collection('materials').add(material)
    const materialId = res.id || res._id
    const derivedMaterials = buildDerivedMaterials(material, rawPackage, result, job, materialId)
    for (const row of derivedMaterials) {
      await db.collection('materials').add(row).catch((error) => {
        console.error(`[${WORKER_ID}] failed to add derived material:`, error.message || error)
      })
    }
    await markJob(jobId, {
      status: 'succeeded',
      progress_text: '素材包已完成并保存到素材库',
      result_material_id: materialId,
      derived_material_count: derivedMaterials.length,
      finished_at: now(),
    })
    await db.collection('profiles').doc(job.user_id).update({
      ai_count: cmd.inc(1),
      updated_at: now(),
    }).catch(() => null)
    await db.collection('usage_records').add({
      user_id: job.user_id,
      type: 'text',
      model: job.hermes_model || HERMES_MODEL,
      quantity: Math.max(1, String(job.user_message || '').length),
      unit: 'chars',
      amount_deducted: 1,
      balance_before: null,
      balance_after: null,
      from_plan: true,
      raw_response: JSON.stringify({provider: 'hermes', material_id: materialId, job_id: jobId, derived_material_count: derivedMaterials.length}).slice(0, 2000),
      created_at: now(),
    }).catch(() => null)
    await logEvent(job, 'completed', '素材包已完成并写入素材库')
    console.log(`[${WORKER_ID}] completed job ${jobId}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await markJob(jobId, {
      status: 'failed',
      progress_text: '生成失败，请稍后重试',
      error_message: message,
      finished_at: now(),
    })
    await logEvent(job, 'failed', message)
    console.error(`[${WORKER_ID}] failed job ${jobId}:`, message)
  }
}

async function tick() {
  const job = await getNextJob()
  if (!job) {
    console.log(`[${WORKER_ID}] no queued job`)
    return false
  }
  await processJob(job)
  return true
}

async function main() {
  console.log(`[${WORKER_ID}] started, env=${ENV_ID}, once=${WORKER_ONCE}`)
  do {
    await tick().catch((error) => console.error(`[${WORKER_ID}] tick error:`, error))
    if (WORKER_ONCE) break
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  } while (true)
}

main().catch((error) => {
  console.error(`[${WORKER_ID}] fatal:`, error)
  process.exit(1)
})
