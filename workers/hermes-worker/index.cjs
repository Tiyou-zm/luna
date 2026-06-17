const http = require('http')
const https = require('https')
const path = require('path')
const AdmZip = require('adm-zip')
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
const PACKAGE_ARCHIVE_MAX_BYTES = Number(process.env.PACKAGE_ARCHIVE_MAX_BYTES || 120 * 1024 * 1024)
const PACKAGE_ARCHIVE_MAX_FILES = Number(process.env.PACKAGE_ARCHIVE_MAX_FILES || 80)

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

function safeHermesSessionPart(value, fallback = 'default') {
  const text = String(value || fallback).trim()
  const safe = text
    .replace(/[^a-zA-Z0-9_.:-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96)
  return safe || fallback
}

function buildHermesSessionId(scope, userId, openid, threadId) {
  const owner = safeHermesSessionPart(userId || openid, 'anonymous')
  const thread = safeHermesSessionPart(threadId, 'default')
  return `luna_${safeHermesSessionPart(scope)}_${owner}_${thread}`.slice(0, 180)
}

function getChatTurnSessionId(turn) {
  return turn.hermes_session_id ||
    buildHermesSessionId('stage0', turn.user_id, turn.openid, turn.draft_id || turn.conversation_id || turn.request_id || turn._id || turn.id)
}

function getJobSessionId(job) {
  return job.hermes_session_id ||
    buildHermesSessionId('job', job.user_id, job.openid, job._id || job.id || job.draft_id || job.request_id)
}

function hermesHeaders(sessionId) {
  const headers = {authorization: `Bearer ${HERMES_API_KEY}`}
  if (sessionId) headers['X-Hermes-Session-Id'] = sessionId
  return headers
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

function getBinary(url, timeout = 5 * 60 * 1000, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (!/^https?:\/\//i.test(url)) {
      reject(new Error(`Unsupported archive url: ${url}`))
      return
    }
    const target = new URL(url)
    const lib = target.protocol === 'http:' ? http : https
    const req = lib.request({
      method: 'GET',
      hostname: target.hostname,
      port: target.port || undefined,
      path: `${target.pathname}${target.search}`,
      timeout,
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirectCount < 5) {
        res.resume()
        const nextUrl = new URL(res.headers.location, url).toString()
        getBinary(nextUrl, timeout, redirectCount + 1).then(resolve, reject)
        return
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume()
        reject(new Error(`Archive download HTTP ${res.statusCode}`))
        return
      }
      const chunks = []
      let total = 0
      res.on('data', (chunk) => {
        total += chunk.length
        if (total > PACKAGE_ARCHIVE_MAX_BYTES) {
          req.destroy(new Error('Archive exceeds max size'))
          return
        }
        chunks.push(chunk)
      })
      res.on('end', () => resolve(Buffer.concat(chunks)))
    })
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('Archive download timeout')))
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

function sectionText(section) {
  if (section == null) return ''
  if (typeof section === 'string') return section
  if (typeof section !== 'object') return String(section)
  const parts = []
  const title = section.title || section.heading || section.name || section.type || ''
  const content = section.content || section.body || section.text || section.summary || ''
  if (title) parts.push(String(title))
  if (content) parts.push(String(content))
  const bullets = section.bullets || section.points || section.items || section.children
  if (Array.isArray(bullets) && bullets.length) {
    bullets.forEach((item) => {
      const text = sectionText(item)
      if (text) parts.push(`- ${text}`)
    })
  }
  if (parts.length) return parts.join('\n')
  return JSON.stringify(section, null, 2)
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
  const body = sections.map(sectionText).filter(Boolean).join('\n\n')
  return displayPost({
    ...outline,
    body: outline.body || body || fallbackBody,
  }, fallbackTitle, fallbackBody, pkg, platformKey)
}

function mergeDisplayItems(items, renderItem, itemLabel = '方案') {
  const rendered = (Array.isArray(items) ? items : [])
    .map((item, index) => renderItem(item, index))
    .filter(Boolean)
  if (rendered.length === 0) return null
  if (rendered.length === 1) return rendered[0]
  const unique = (values) => Array.from(new Set(values.filter(Boolean)))
  const body = rendered.map((item, index) => {
    const title = item.titles?.[0] ? `${itemLabel} ${index + 1}：${item.titles[0]}` : `${itemLabel} ${index + 1}`
    return [title, item.body].filter(Boolean).join('\n')
  }).join('\n\n')
  return {
    ...rendered[0],
    titles: unique(rendered.flatMap((item) => item.titles || [])),
    body,
    image_prompts: rendered.flatMap((item) => item.image_prompts || []),
    hashtags: unique(rendered.flatMap((item) => item.hashtags || [])),
    sections: rendered.flatMap((item) => item.sections || []),
  }
}

function normalizeHermesResult(rawPackage, job) {
  const pkg = materialPackage(rawPackage)
  const platforms = packagePlatforms(pkg)
  const fallbackBody = `围绕“${job.user_message || job.goal || '内容方向'}”生成多平台内容包。`
  const result = {}

  const xhsPosts = platforms.xiaohongshu?.posts || platforms.xhs?.posts || []
  const xhsPost = mergeDisplayItems(xhsPosts, (post) => displayPost(post, `${job.goal || '品牌曝光'}种草文案`, fallbackBody, pkg, 'xiaohongshu'), '小红书文案')
  if (xhsPost) result['小红书'] = xhsPost

  const douyinScripts = platforms.douyin?.scripts || platforms.tiktok?.scripts || []
  const douyinScript = mergeDisplayItems(douyinScripts, (script) => displayScript(script, `${job.goal || '品牌曝光'}短视频脚本`, fallbackBody, pkg, 'douyin'), '抖音脚本')
  if (douyinScript) result['抖音'] = douyinScript

  const videoScripts = platforms.wechat_video?.scripts || platforms.video_channel?.scripts || platforms.shipinhao?.scripts || []
  const videoScript = mergeDisplayItems(videoScripts, (script) => displayScript(script, `${job.goal || '品牌曝光'}视频号脚本`, fallbackBody, pkg, 'wechat_video'), '视频号脚本')
  if (videoScript) result['视频号'] = videoScript

  const momentsPosts = platforms.moments?.posts || []
  const momentsPost = mergeDisplayItems(momentsPosts, (post) => displayPost(post, `${job.goal || '品牌曝光'}朋友圈文案`, fallbackBody, pkg, 'moments'), '朋友圈文案')
  if (momentsPost) result['朋友圈'] = momentsPost

  const publicOutline = platforms.wechat_public?.outline || platforms.wechat_public?.article || platforms.official_account?.outline
  if (publicOutline) result['公众号'] = displayOutline(publicOutline, `${job.goal || '品牌曝光'}公众号文章`, fallbackBody, pkg, 'wechat_public')

  return Object.keys(result).length > 0 ? result : null
}

function formatJsonBlock(value) {
  if (!value || (Array.isArray(value) && value.length === 0)) return ''
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

function parseJsonBuffer(buffer) {
  try {
    return JSON.parse(Buffer.isBuffer(buffer) ? buffer.toString('utf8') : String(buffer || ''))
  } catch {
    return null
  }
}

function contentValueScore(value) {
  if (value == null) return 0
  if (typeof value === 'string') return value.trim().length
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).length
  if (Array.isArray(value)) {
    return value.reduce((total, item) => total + contentValueScore(item), value.length * 25)
  }
  if (typeof value === 'object') {
    return Object.entries(value).reduce((total, [key, item]) => total + String(key).length + contentValueScore(item), Object.keys(value).length * 12)
  }
  return String(value).length
}

function packageContentScore(pkg) {
  const platforms = packagePlatforms(materialPackage(pkg))
  if (!platforms || typeof platforms !== 'object') return 0
  return Object.entries(platforms).reduce((total, [platform, value]) => total + String(platform).length * 5 + contentValueScore(value), 0)
}

function hasRichPackageContent(pkg) {
  return packageContentScore(pkg) > 120
}

function mergeArchivePackage(rawPackage, archivePackage, archiveContent, archiveImagePrompts) {
  const current = materialPackage(rawPackage) || {}
  const archive = materialPackage(archivePackage) || {}
  const merged = {
    ...current,
    ...archive,
    workflow: archive.workflow || current.workflow || null,
    trending_research: archive.trending_research || current.trending_research || null,
    content_strategy: archive.content_strategy || current.content_strategy || null,
    content: archive.content || archiveContent || current.content || null,
    image_prompts: archive.image_prompts || archiveImagePrompts || current.image_prompts || null,
    assets: archive.assets || current.assets || null,
    package_archive: archive.package_archive || current.package_archive || null,
    qa: archive.qa || current.qa || null,
    final_checks: archive.final_checks || current.final_checks || null,
  }
  if (!merged.type) merged.type = 'material_package'
  return merged
}

async function enrichPackageFromArchive(rawPackage, packageAssets) {
  const current = materialPackage(rawPackage)
  const archiveAsset = (packageAssets || []).find(isZipAsset)
  if (!archiveAsset || !isDownloadableAssetUrl(archiveAsset.url)) return null
  const zipBuffer = await getBinary(archiveAsset.url)
  const zip = new AdmZip(zipBuffer)
  const materialEntry = zip.getEntry('material_package.json')
  const contentEntry = zip.getEntry('data/content.json')
  const imagePromptEntry = zip.getEntry('data/image_prompts.json')
  const archivePackage = materialEntry ? parseJsonBuffer(materialEntry.getData()) : null
  const archiveContent = contentEntry ? parseJsonBuffer(contentEntry.getData()) : null
  const archiveImagePrompts = imagePromptEntry ? parseJsonBuffer(imagePromptEntry.getData()) : null
  const merged = mergeArchivePackage(current, archivePackage, archiveContent, archiveImagePrompts)
  const currentScore = packageContentScore(current)
  const mergedScore = packageContentScore(merged)
  return mergedScore > currentScore ? merged : null
}

const ASSET_URL_FIELDS = [
  'url',
  'asset_url',
  'assetUrl',
  'file_url',
  'fileUrl',
  'file_path',
  'filePath',
  'download_url',
  'downloadUrl',
  'download_path',
  'downloadPath',
  'download_link',
  'downloadLink',
  'public_url',
  'publicUrl',
  'cos_url',
  'cosUrl',
  'cdn_url',
  'cdnUrl',
  'zip_url',
  'zipUrl',
  'archive_url',
  'archiveUrl',
  'package_url',
  'packageUrl',
  'source_url',
  'sourceUrl',
  'media_url',
  'mediaUrl',
  'image_url',
  'imageUrl',
  'image',
  'src',
  'path',
  'local_path',
  'localPath',
  'key',
  'cover_url',
  'cover_image',
  'thumbnail_url',
]

const ASSET_ARRAY_FIELDS = [
  'generated',
  'generated_assets',
  'generatedAssets',
  'placeholder',
  'images',
  'image_assets',
  'imageAssets',
  'image_files',
  'image_urls',
  'asset_urls',
  'assetUrls',
  'download_urls',
  'downloadUrls',
  'generated_images',
  'generatedImages',
  'files',
  'file_assets',
  'fileAssets',
  'material_files',
  'package_files',
  'packageFiles',
  'attachments',
  'outputs',
  'deliverables',
  'resources',
  'archives',
]

const PLATFORM_ASSET_ARRAY_FIELDS = [
  'images',
  'image_urls',
  'image_files',
  'covers',
  'cover_images',
  'attachments',
  'assets',
  'files',
  'materials',
  'downloads',
  'resources',
  'generated_assets',
  'asset_urls',
  'download_urls',
]

function looksLikeUrlOrPath(value) {
  if (typeof value !== 'string') return false
  const text = value.trim()
  if (!text) return false
  return /^(https?:\/\/|cloud:\/\/|wxfile:\/\/|\/|[A-Za-z0-9_-]+\/)/.test(text)
}

function normalizeAssetUrl(value) {
  if (typeof value !== 'string') return ''
  let text = value.trim()
  if (!text) return ''
  if (/^MEDIA:/i.test(text)) text = text.replace(/^MEDIA:/i, '').trim()
  if (text.startsWith('/var/www/images/')) {
    const base = process.env.HERMES_PUBLIC_ASSET_BASE || 'http://152.136.47.2:8080'
    return `${base.replace(/\/$/, '')}/${path.posix.basename(text)}`
  }
  return text
}

function isDownloadableAssetUrl(url) {
  return /^(https?:\/\/|cloud:\/\/)/i.test(String(url || '').trim())
}

function inferAssetType(asset, url = '') {
  const rawType = String(asset?.type || asset?.file_type || asset?.media_type || asset?.mime || '').toLowerCase()
  const source = `${rawType} ${url}`.toLowerCase()
  if (source.includes('zip') || source.includes('archive') || /\.(zip|rar|7z|tar|gz)(\?|#|$)/.test(source)) return 'archive'
  if (source.includes('image') || /\.(png|jpe?g|webp|gif|bmp|svg)(\?|#|$)/.test(source)) return 'image'
  return 'copywriting'
}

function inferArchiveEntryType(entryName) {
  const ext = path.extname(String(entryName || '')).replace(/^\./, '').toLowerCase()
  if (/^(png|jpe?g|webp|gif|bmp|svg)$/.test(ext)) return 'image'
  if (/^(zip|rar|7z|tar|gz)$/.test(ext)) return 'archive'
  return 'copywriting'
}

function inferArchiveAssetKind(entryName, type) {
  const normalized = String(entryName || '').replace(/\\/g, '/').toLowerCase()
  if (type === 'image' && normalized.includes('reference_images/')) return 'reference_image'
  if (type === 'image') return 'package_image'
  if (normalized.includes('image_prompts')) return 'prompt_file'
  if (type === 'archive') return 'package_archive'
  return 'package_file'
}

function isZipAsset(asset) {
  const url = asset?.url || asset?.content || ''
  const rawType = String(asset?.metadata?.original?.type || asset?.metadata?.original?.mime || asset?.type || '').toLowerCase()
  return rawType.includes('zip') || rawType.includes('archive') || /\.zip(\?|#|$)/i.test(url)
}

function safeFileName(name, fallback = 'file') {
  const parsed = path.posix.basename(String(name || fallback).replace(/\\/g, '/'))
  const ext = path.extname(parsed) || path.extname(fallback)
  const base = path.basename(parsed, ext).replace(/[^\w.-]+/g, '-').slice(0, 64) || 'file'
  return `${base}${ext || ''}`
}

function cloudSafePathSegment(value, fallback = 'item') {
  return String(value || fallback).replace(/[^\w.-]+/g, '-').slice(0, 80) || fallback
}

function getAssetUrl(asset) {
  const directUrl = normalizeAssetUrl(asset)
  if (looksLikeUrlOrPath(directUrl)) return directUrl
  if (!asset || typeof asset !== 'object') return ''
  for (const field of ASSET_URL_FIELDS) {
    const url = normalizeAssetUrl(asset[field])
    if (looksLikeUrlOrPath(url)) return url
  }
  return ''
}

function getAssetTitle(asset, fallback) {
  if (!asset || typeof asset !== 'object') return fallback
  return asset.name || asset.title || asset.filename || asset.file_name || asset.label || asset.desc || fallback
}

function pushAsset(list, seen, asset, source, platformLabel) {
  const url = getAssetUrl(asset)
  if (!url) return
  const key = url.replace(/\?.*$/, '')
  if (seen.has(key)) return
  seen.add(key)
  const type = inferAssetType(asset, url)
  list.push({
    type,
    title: getAssetTitle(asset, type === 'image' ? `素材包图片 ${list.length + 1}` : `素材包文件 ${list.length + 1}`),
    content: url,
    url,
    key: typeof asset === 'object' ? (asset.path || asset.key || asset.file_id || url) : url,
    sizeStr: typeof asset === 'object' ? (asset.size || asset.sizeStr || '') : '',
    platform_label: platformLabel || (typeof asset === 'object' ? (asset.platform || asset.platform_label || '') : ''),
    metadata: {
      source,
      asset_kind: type === 'image' ? 'package_image' : 'package_file',
      original: asset,
    },
  })
}

function collectFromArrayFields(list, seen, container, fields, source, platformLabel) {
  if (!container || typeof container !== 'object') return
  for (const field of fields) {
    const value = container[field]
    if (Array.isArray(value)) {
      value.forEach((item) => pushAsset(list, seen, item, `${source}.${field}`, platformLabel))
    } else {
      pushAsset(list, seen, value, `${source}.${field}`, platformLabel)
    }
  }
}

function collectPackageAssets(pkg) {
  const list = []
  const seen = new Set()
  const assets = pkg?.assets || {}

  collectFromArrayFields(list, seen, assets, ASSET_ARRAY_FIELDS, 'assets')

  const archive = pkg?.package_archive
  if (archive && (archive.enabled || getAssetUrl(archive))) {
    pushAsset(list, seen, {
      ...archive,
      type: archive.type || 'archive',
      title: archive.name || archive.title || '素材包压缩包',
    }, 'package_archive')
  }

  const platforms = packagePlatforms(pkg)
  Object.entries(platforms || {}).forEach(([platformKey, platformValue]) => {
    const platformLabel = PLATFORM_LABELS_V2[platformKey] || platformKey
    const buckets = []
    if (platformValue && typeof platformValue === 'object') {
      buckets.push(platformValue)
      Object.values(platformValue).forEach((value) => {
        if (Array.isArray(value)) buckets.push(...value)
        else if (value && typeof value === 'object') buckets.push(value)
      })
    }

    buckets.forEach((bucket, bucketIndex) => {
      collectFromArrayFields(
        list,
        seen,
        bucket,
        PLATFORM_ASSET_ARRAY_FIELDS,
        `content.platforms.${platformKey}.${bucketIndex}`,
        platformLabel,
      )
      for (const field of ASSET_URL_FIELDS) {
        if (field === 'key') continue
        if (looksLikeUrlOrPath(bucket?.[field])) {
          pushAsset(list, seen, bucket, `content.platforms.${platformKey}.${field}`, platformLabel)
        }
      }
    })
  })

  return list
}

function hasUsableGeneratedAsset(packageAssets) {
  return packageAssets.some((asset) => {
    if (!asset?.url) return false
    return isDownloadableAssetUrl(asset.url)
  })
}

function hasExplicitNoGeneratedAssets(pkg) {
  const assets = pkg?.assets || {}
  const notGenerated = [
    ...(Array.isArray(assets.not_generated) ? assets.not_generated : []),
    ...(Array.isArray(assets.notGenerated) ? assets.notGenerated : []),
  ]
  if (notGenerated.length > 0) return true
  const text = JSON.stringify({
    not_generated: notGenerated,
    final_checks: pkg?.final_checks || {},
    qa: pkg?.qa || {},
  }).toLowerCase()
  return /(no real|not generated|未生成|没有生成|未实际生成|无真实|prompt only|提示词)/i.test(text)
}

function expectsGeneratedAssets(pkg, job) {
  const workflow = pkg?.workflow || {}
  const deliveryMode = String(workflow.delivery_mode || workflow.deliveryMode || '').toLowerCase()
  const handoff = job?.handoff_context || {}
  const collected = handoff.collected || {}
  const raw = JSON.stringify({
    workflow,
    handoff,
    assets: pkg?.assets || {},
    image_prompts: pkg?.image_prompts || {},
  }).toLowerCase()

  if (deliveryMode.includes('asset_generation')) return true
  if (collected.needs_images === true || handoff.needs_images === true) return true
  if (/(图片素材|生成图片|真实图片|image assets|generated images|asset_generation)/i.test(raw)) return true
  return false
}

function validatePackageAssets(pkg, packageAssets, job) {
  const expected = expectsGeneratedAssets(pkg, job)
  if (!expected) return null
  if (hasUsableGeneratedAsset(packageAssets)) return null
  if (hasExplicitNoGeneratedAssets(pkg)) return null
  return 'assets_missing: expected generated image/archive assets, but no usable assets.generated url or package_archive.url was found'
}

async function uploadCloudBuffer(cloudPath, buffer) {
  const res = await app.uploadFile({
    cloudPath,
    fileContent: buffer,
  })
  const fileID = res.fileID || res.fileId || res.fileid || cloudPath
  return {fileID, url: fileID}
}

function archiveEntriesToAssets(zipBuffer, archiveAsset, job, materialId) {
  const zip = new AdmZip(zipBuffer)
  const entries = zip.getEntries()
    .filter((entry) => !entry.isDirectory)
    .filter((entry) => !/(^|\/)__MACOSX\//.test(entry.entryName))
    .filter((entry) => !/(^|\/)\./.test(entry.entryName))
    .slice(0, PACKAGE_ARCHIVE_MAX_FILES)

  return entries.map((entry, index) => {
    const name = safeFileName(entry.entryName, `asset-${index + 1}`)
    const type = inferArchiveEntryType(entry.entryName || name)
    const folder = type === 'image' ? 'images' : 'files'
    const cloudPath = [
      'users',
      cloudSafePathSegment(job.user_id, 'user'),
      'generated',
      cloudSafePathSegment(materialId, 'material'),
      'package-assets',
      folder,
      `${Date.now()}-${index + 1}-${name}`,
    ].join('/')
    return {
      type,
      title: name,
      cloudPath,
      buffer: entry.getData(),
      size: entry.header?.size || entry.getData().length,
      sourceEntry: entry.entryName,
      assetKind: inferArchiveAssetKind(entry.entryName || name, type),
      archiveUrl: archiveAsset.url,
      platform_label: archiveAsset.platform_label || '',
    }
  }).filter((asset) => asset.type === 'image' || asset.type === 'copywriting' || asset.type === 'archive')
}

async function extractArchiveAssets(baseMaterial, archiveAsset, job, materialId, common) {
  if (!isZipAsset(archiveAsset)) return []
  const rows = []
  try {
    const zipBuffer = await getBinary(archiveAsset.url || archiveAsset.content)
    const extractedAssets = archiveEntriesToAssets(zipBuffer, archiveAsset, job, materialId)
    for (const asset of extractedAssets) {
      const uploaded = await uploadCloudBuffer(asset.cloudPath, asset.buffer)
      rows.push({
        ...common,
        type: asset.type,
        library_section: 'asset',
        platform_label: asset.platform_label,
        title: asset.title,
        content: uploaded.url,
        url: uploaded.url,
        key: uploaded.fileID,
        sizeStr: asset.size ? `${Math.round(Number(asset.size) / 1024)}KB` : '',
        metadata: {
          source: 'package_archive.extract',
          asset_kind: asset.assetKind,
          archive_url: asset.archiveUrl,
          archive_title: archiveAsset.title,
          entry_name: asset.sourceEntry,
          cloud_path: asset.cloudPath,
        },
      })
    }
    if (rows.length > 0) {
      console.log(`[${WORKER_ID}] extracted ${rows.length} assets from archive for material ${materialId}`)
    }
  } catch (error) {
    rows.push({
      ...common,
      type: 'copywriting',
      library_section: 'asset',
      title: `${baseMaterial.title || '素材包'} archive extract failed`,
      content: '',
      url: archiveAsset.url || archiveAsset.content || '',
      key: archiveAsset.key || archiveAsset.url || '',
      metadata: {
        source: 'package_archive.extract_failed',
        asset_kind: 'package_file',
        archive: archiveAsset,
        error: error instanceof Error ? error.message : String(error),
      },
    })
    console.error(`[${WORKER_ID}] failed to extract archive:`, error.message || error)
  }
  return rows
}

function isVideoPlatformLabel(platform, item) {
  const text = `${platform || ''} ${item?.platform || ''}`.toLowerCase()
  const hasSections = Array.isArray(item?.sections) && item.sections.length > 0
  return /douyin|shipinhao|video|抖音|视频号/.test(text) || hasSections || Boolean(item?.duration || item?.hook)
}

function buildPlatformContentText(platform, item) {
  const lines = [`【${platform}】`]
  if (Array.isArray(item?.titles) && item.titles.length > 0) {
    lines.push('标题')
    item.titles.forEach((title, index) => lines.push(`${index + 1}. ${title}`))
  }
  if (item?.body) {
    lines.push('', '正文/脚本', String(item.body))
  }
  if (item?.hook) lines.push('', `开场：${item.hook}`)
  if (Array.isArray(item?.sections) && item.sections.length > 0) {
    lines.push('', '分镜/段落')
    item.sections.forEach((section, index) => lines.push(`${index + 1}. ${formatJsonBlock(section)}`))
  }
  if (item?.cover_suggestion) lines.push('', `封面建议：${item.cover_suggestion}`)
  if (Array.isArray(item?.image_prompts) && item.image_prompts.length > 0) {
    lines.push('', '图片提示词')
    item.image_prompts.forEach((prompt, index) => lines.push(`${index + 1}. ${prompt}`))
  }
  if (Array.isArray(item?.hashtags) && item.hashtags.length > 0) lines.push('', `话题：${item.hashtags.map((tag) => `#${tag}`).join(' ')}`)
  if (item?.best_time) lines.push('', `建议发布时间：${item.best_time}`)
  if (item?.ad_advice) lines.push('', `投放建议：${item.ad_advice}`)
  if (item?.push_advice) lines.push('', `推送建议：${item.push_advice}`)
  if (item?.delivery_logic) lines.push('', `投放逻辑：${item.delivery_logic}`)
  if (item?.fact_check_notes) lines.push('', `质检说明：${item.fact_check_notes}`)
  if (item?.risk_warning) lines.push('', `风险提醒：${item.risk_warning}`)
  return lines.join('\n')
}

function buildContentDerivedMaterials(baseMaterial, pkg, result, common) {
  const rows = []
  Object.entries(result || {}).forEach(([platform, item]) => {
    if (!item || typeof item !== 'object') return
    const isVideo = isVideoPlatformLabel(platform, item)
    const title = Array.isArray(item.titles) && item.titles[0] ? item.titles[0] : baseMaterial.title
    const content = buildPlatformContentText(platform, item)
    if (!content.trim()) return
    rows.push({
      ...common,
      type: isVideo ? 'script' : 'copywriting',
      library_section: isVideo ? 'video' : 'copy',
      platform_label: platform,
      title: `${platform} - ${title}`,
      content,
      metadata: {
        source: 'package_result.platform',
        platform,
        original: item,
      },
    })
  })

  const strategyText = [
    pkg?.content_strategy ? `内容策略\n${formatJsonBlock(pkg.content_strategy)}` : '',
    pkg?.trending_research ? `热点与素材分析\n${formatJsonBlock(pkg.trending_research)}` : '',
    pkg?.qa ? `质检结果\n${formatJsonBlock(pkg.qa)}` : '',
    pkg?.final_checks ? `最终校验\n${formatJsonBlock(pkg.final_checks)}` : '',
  ].filter(Boolean).join('\n\n')
  if (strategyText) {
    rows.push({
      ...common,
      type: 'analysis',
      library_section: 'strategy',
      platform_label: '',
      title: `${baseMaterial.title || '素材包'} - 策略与投放分析`,
      content: strategyText,
      metadata: {
        source: 'package_result.strategy',
        workflow: pkg?.workflow || null,
        content_strategy: pkg?.content_strategy || null,
        trending_research: pkg?.trending_research || null,
        qa: pkg?.qa || null,
        final_checks: pkg?.final_checks || null,
      },
    })
  }
  return rows
}

async function buildDerivedMaterials(baseMaterial, rawPackage, result, job, materialId, packageAssetsOverride = null) {
  const pkg = materialPackage(rawPackage)
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

  rows.push(...buildContentDerivedMaterials(baseMaterial, pkg, result, common))

  const packageAssets = (Array.isArray(packageAssetsOverride) ? packageAssetsOverride : collectPackageAssets(pkg))
    .filter((asset) => isDownloadableAssetUrl(asset.url))
  packageAssets.forEach((asset) => {
    rows.push({
      ...common,
      type: asset.type,
      library_section: 'asset',
      platform_label: asset.platform_label || '',
      title: asset.title,
      content: asset.content,
      url: asset.url,
      key: asset.key,
      sizeStr: asset.sizeStr,
      metadata: asset.metadata,
    })
  })

  for (const asset of packageAssets.filter(isZipAsset)) {
    const extractedRows = await extractArchiveAssets(baseMaterial, asset, job, materialId, common)
    rows.push(...extractedRows)
  }

  return rows
}

function buildDerivedMaterialsLegacyUnused(baseMaterial, pkg, result, common, rows) {
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

async function logEvent(job, type, message, extra = {}) {
  await db.collection('generation_job_events').add({
    job_id: job._id || job.id,
    user_id: job.user_id,
    type,
    message,
    ...extra,
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

function cleanHermesChatReply(content) {
  return String(content || '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```json\s*[\s\S]*?```/gi, '')
    .trim()
}

function parseHandoffFromText(content) {
  const text = String(content || '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim()
  const candidates = []
  const whole = extractJson(text)
  if (whole) candidates.push(whole)
  for (const match of text.matchAll(/```json\s*([\s\S]*?)```/gi)) {
    const parsed = extractJson(match[1])
    if (parsed) candidates.push(parsed)
  }
  return candidates.find((item) => item && item.type === 'luna_handoff') || null
}

function buildChatTurnMessages(turn) {
  const history = Array.isArray(turn.history) ? turn.history.slice(-12) : []
  return [
    {
      role: 'system',
      content: [
        'You are Hermes continuing a Luna mini program foreground Stage 0 chat turn.',
        'The previous cloud-function request timed out, but the user is still waiting.',
        'Continue the user request normally according to your native SOP.',
        'Do not output local fallback text. Do not repeat already answered questions unless needed.',
        'Natural language must come first. If Luna needs machine-readable state, append a luna_handoff JSON block.',
      ].join('\n'),
    },
    ...history.map((item) => ({role: item.role, content: String(item.content || '').slice(0, 3000)})),
    {role: 'user', content: String(turn.user_message || '')},
  ]
}

async function getNextChatTurn() {
  const res = await db.collection('hermes_chat_turns')
    .where({status: 'pending'})
    .orderBy('created_at', 'asc')
    .limit(1)
    .get()
  return res.data[0] || null
}

async function markChatTurn(turnId, data) {
  await db.collection('hermes_chat_turns').doc(turnId).update({
    ...data,
    updated_at: now(),
  })
}

async function callHermesForChatTurn(turn) {
  const hermesSessionId = getChatTurnSessionId(turn)
  const response = await postJson(joinUrl(HERMES_BASE_URL, '/v1/chat/completions'), {
    model: turn.hermes_model || HERMES_MODEL,
    messages: buildChatTurnMessages(turn),
    temperature: 0.7,
  }, hermesHeaders(hermesSessionId))
  const content = response?.choices?.[0]?.message?.content || response?.content || response
  const raw = typeof content === 'string' ? content : JSON.stringify(content)
  return {
    raw,
    reply: cleanHermesChatReply(raw),
    handoff: parseHandoffFromText(raw),
  }
}

async function processChatTurn(turn) {
  const turnId = turn._id || turn.id
  const retryCount = Number(turn.retry_count || 0)
  const maxRetries = Number(turn.max_retries || 3)
  const hermesSessionId = getChatTurnSessionId(turn)
  console.log(`[${WORKER_ID}] continue chat turn ${turnId}`)
  await markChatTurn(turnId, {
    status: 'running',
    worker_id: WORKER_ID,
    hermes_session_id: hermesSessionId,
    retry_count: retryCount + 1,
  })

  try {
    const response = await callHermesForChatTurn(turn)
    await markChatTurn(turnId, {
      status: 'succeeded',
      reply: response.reply || response.raw,
      handoff: response.handoff || null,
      interaction: response.handoff ? {
        stage: response.handoff.stage || null,
        ready_for_generation: response.handoff.ready_for_generation === true,
        handoff_context: response.handoff.handoff_context || null,
      } : null,
      hermes_raw_preview: response.raw.slice(0, 3000),
      error_message: null,
      finished_at: now(),
    })
    console.log(`[${WORKER_ID}] completed chat turn ${turnId}`)
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const shouldRetry = retryCount + 1 < maxRetries
    await markChatTurn(turnId, {
      status: shouldRetry ? 'pending' : 'failed',
      error_message: message,
      finished_at: shouldRetry ? null : now(),
    })
    console.error(`[${WORKER_ID}] failed chat turn ${turnId}:`, message)
    return true
  }
}

async function callHermes(job) {
  const prompt = job.hermes_prompt || job.user_message || ''
  const hermesSessionId = getJobSessionId(job)
  const response = await postJson(joinUrl(HERMES_BASE_URL, '/v1/chat/completions'), {
    model: job.hermes_model || HERMES_MODEL,
    messages: [
      {role: 'system', content: 'Stage 0 has already been completed and confirmed by the user. You are Hermes. Continue SOP Stage 1-6 and return only parsable Luna material_package JSON. The worker only waits, receives, unpacks, and persists your result.'},
      {role: 'user', content: prompt},
    ],
    temperature: 0.7,
  }, hermesHeaders(hermesSessionId))
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
    'Asset rule: if workflow.delivery_mode is asset_generation, or you claim generated images/files, return public downloadable URLs in assets.generated[].url and/or package_archive.url.',
    'Asset rule: image prompts, local filesystem paths, and descriptions are not generated assets. They do not count unless a public URL is provided.',
    'Asset rule: if no real image/file/archive was generated, explicitly set assets.not_generated with the reason instead of pretending assets exist.',
    'Recommended asset shape: {"assets":{"generated":[{"type":"image","title":"...","url":"http://152.136.47.2:8080/xxx.png"}]},"package_archive":{"type":"archive","title":"完整素材包压缩包","url":"http://152.136.47.2:8080/xxx.zip"}}',
    '{"type":"material_package","version":"2.0.0","workflow":{},"trending_research":{},"content_strategy":{},"content":{"platforms":{"xiaohongshu":{"posts":[]},"douyin":{"scripts":[]},"moments":{"posts":[]},"wechat_public":{"outline":{"title":"","sections":[]}}}},"image_prompts":{},"assets":{"generated":[],"video_scripts":[],"not_generated":[],"placeholder":[]},"package_archive":{"type":"archive","title":"","url":""},"qa":{},"final_checks":{}}',
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
  const hermesSessionId = getJobSessionId(job)
  const response = await postJson(joinUrl(HERMES_BASE_URL, '/v1/chat/completions'), {
    model: job.hermes_model || HERMES_MODEL,
    messages: [
      {role: 'system', content: '你只修复并输出可解析 JSON。'},
      {role: 'user', content: buildRepairPrompt(job, brokenRaw, reason)},
    ],
    temperature: 0,
  }, hermesHeaders(hermesSessionId), HERMES_REPAIR_TIMEOUT_MS)
  const content = response?.choices?.[0]?.message?.content || response?.content || response
  return {
    parsed: extractJson(content),
    raw: typeof content === 'string' ? content : JSON.stringify(content),
  }
}

async function processJob(job) {
  const jobId = job._id || job.id
  const hermesSessionId = getJobSessionId(job)
  console.log(`[${WORKER_ID}] start job ${jobId}`)
  await markJob(jobId, {
    status: 'running',
    worker_id: WORKER_ID,
    hermes_session_id: hermesSessionId,
    progress_text: 'Hermes 正在收集信息和制作素材包',
    started_at: job.started_at || now(),
  })
  await logEvent(job, 'started', 'Hermes Worker 已开始执行')

  try {
    job.hermes_session_id = hermesSessionId
    await logEvent(job, 'hermes_session_assigned', 'Hermes session header assigned for this generation job.', {
      hermes_session_id: hermesSessionId,
    })
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

    let pkg = materialPackage(rawPackage)
    let packageAssets = collectPackageAssets(pkg)
    const archiveEnrichedPackage = await enrichPackageFromArchive(rawPackage, packageAssets).catch((error) => {
      console.error(`[${WORKER_ID}] failed to enrich package from archive:`, error.message || error)
      return null
    })
    if (archiveEnrichedPackage) {
      rawPackage = archiveEnrichedPackage
      pkg = materialPackage(rawPackage)
      result = normalizeHermesResult(rawPackage, job) || result
      packageAssets = collectPackageAssets(pkg)
      await markJob(jobId, {archive_content_enriched: true})
      await logEvent(job, 'archive_content_enriched', 'Worker used package archive JSON to restore full platform content')
    }
    let assetWarning = validatePackageAssets(pkg, packageAssets, job)
    if (assetWarning) {
      await markJob(jobId, {
        progress_text: 'Hermes 已返回素材包，正在补要素材文件下载地址',
        asset_warning: assetWarning,
      })
      await logEvent(job, 'assets_missing', assetWarning)

      try {
        repairResponse = await callHermesRepair(job, hermesResponse.raw || JSON.stringify(rawPackage), assetWarning)
        const repairedPackage = repairResponse.parsed
        const repairedResult = normalizeHermesResult(repairedPackage, job)
        const repairedPkg = materialPackage(repairedPackage)
        const repairedAssets = collectPackageAssets(repairedPkg)
        const repairedWarning = repairedResult
          ? validatePackageAssets(repairedPkg, repairedAssets, job)
          : 'assets_missing: Hermes repair did not return a valid material_package'

        await markJob(jobId, {
          hermes_repair_raw_preview: (repairResponse.raw || '').slice(0, 3000),
        })

        if (!repairedWarning) {
          rawPackage = repairedPackage
          result = repairedResult
          pkg = repairedPkg
          packageAssets = repairedAssets
          assetWarning = null
          await logEvent(job, 'assets_repaired', 'Hermes 已补回素材文件下载地址')
        } else {
          assetWarning = repairedWarning
          await markJob(jobId, {asset_warning: assetWarning})
          await logEvent(job, 'assets_missing_after_repair', assetWarning)
        }
      } catch (repairError) {
        const repairMessage = repairError instanceof Error ? repairError.message : String(repairError)
        await markJob(jobId, {
          hermes_repair_error: repairMessage,
          asset_warning: assetWarning,
        })
        await logEvent(job, 'assets_repair_failed', repairMessage)
      }
    }

    const persistablePackageAssets = packageAssets.filter((asset) => isDownloadableAssetUrl(asset.url))
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
        asset_warning: assetWarning,
        asset_counts: {
          total: persistablePackageAssets.length,
          image: persistablePackageAssets.filter((asset) => asset.type === 'image').length,
          archive: persistablePackageAssets.filter((asset) => asset.type === 'archive').length,
          file: persistablePackageAssets.filter((asset) => asset.type !== 'image' && asset.type !== 'archive').length,
        },
      },
      package_result: result,
      hermes_raw: rawPackage,
      workflow: pkg?.workflow || null,
      trending_research: pkg?.trending_research || null,
      content_strategy: pkg?.content_strategy || null,
      assets: pkg?.assets || null,
      package_archive: pkg?.package_archive || null,
      asset_warning: assetWarning,
      qa: pkg?.qa || null,
      final_checks: pkg?.final_checks || null,
      hermes_raw_preview: (hermesResponse.raw || '').slice(0, 3000),
      hermes_repair_raw_preview: (repairResponse?.raw || '').slice(0, 3000),
      created_at: now(),
      updated_at: now(),
    }
    const res = await db.collection('materials').add(material)
    const materialId = res.id || res._id
    const derivedMaterials = await buildDerivedMaterials(material, rawPackage, result, job, materialId, persistablePackageAssets)
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
  const chatTurn = await getNextChatTurn().catch((error) => {
    const text = String(error?.message || error)
    if (!text.includes('collection') && !text.includes('DATABASE_COLLECTION_NOT_EXIST') && !text.includes('Db or Table not exist')) {
      console.error(`[${WORKER_ID}] chat turn query error:`, error)
    }
    return null
  })
  if (chatTurn) {
    await processChatTurn(chatTurn)
    return true
  }

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
