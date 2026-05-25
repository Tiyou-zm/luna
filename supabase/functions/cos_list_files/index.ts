// 列出用户在腾讯云COS中的文件（使用主凭证，服务端隔离）
import {createClient} from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
}

// ===== COS HMAC-SHA1 签名工具 =====
async function hmacSHA1Bytes(key: string | Uint8Array, data: string): Promise<Uint8Array> {
  const keyData = typeof key === 'string' ? new TextEncoder().encode(key) : key
  const ck = await crypto.subtle.importKey('raw', keyData, {name: 'HMAC', hash: 'SHA-1'}, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', ck, new TextEncoder().encode(data)))
}

async function sha1Hex(data: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(data))
  return toHex(new Uint8Array(h))
}

function toHex(buf: Uint8Array): string {
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('')
}

// 生成COS REST API Authorization
async function cosAuth(
  secretId: string, secretKey: string,
  method: string, path: string,
  queryParams: Record<string, string>,
  headers: Record<string, string>
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const endTime = now + 3600
  const keyTime = `${now};${endTime}`
  const signKey = await hmacSHA1Bytes(secretKey, keyTime)

  // 排序后的URL参数（用于签名）
  const sortedParamKeys = Object.keys(queryParams).map(k => k.toLowerCase()).sort()
  const sortedParamStr = sortedParamKeys
    .map(k => `${k}=${encodeURIComponent(queryParams[k])}`)
    .join('&')

  // 排序后的Header（用于签名）
  const sortedHeaderKeys = Object.keys(headers).map(k => k.toLowerCase()).sort()
  const sortedHeaderStr = sortedHeaderKeys
    .map(k => `${k}=${encodeURIComponent(headers[k])}`)
    .join('&')

  const httpString = `${method.toLowerCase()}\n${path}\n${sortedParamStr}\n${sortedHeaderStr}\n`
  const sha1Hash = await sha1Hex(httpString)
  const stringToSign = `sha1\n${keyTime}\n${sha1Hash}\n`
  const signature = toHex(await hmacSHA1Bytes(signKey, stringToSign))

  return [
    'q-sign-algorithm=sha1',
    `q-ak=${secretId}`,
    `q-sign-time=${keyTime}`,
    `q-key-time=${keyTime}`,
    `q-header-list=${sortedHeaderKeys.join(';')}`,
    `q-url-param-list=${sortedParamKeys.join(';')}`,
    `q-signature=${signature}`
  ].join('&')
}

// 简单XML标签提取（不依赖外部XML库）
function extractTags(xml: string, tag: string): string[] {
  const results: string[] = []
  const regex = new RegExp(`<${tag}>([\\\s\\\S]*?)<\\/${tag}>`, 'g')
  let match
  while ((match = regex.exec(xml)) !== null) {
    results.push(match[1].trim())
  }
  return results
}

function extractTag(xml: string, tag: string): string {
  const match = new RegExp(`<${tag}>([\\\s\\\S]*?)<\\/${tag}>`).exec(xml)
  return match ? match[1].trim() : ''
}

// 根据文件扩展名判断分类
function getCategory(key: string): 'image' | 'video' | 'audio' | 'document' | 'data' | 'other' {
  const ext = key.split('.').pop()?.toLowerCase() || ''
  if (['jpg','jpeg','png','gif','webp','heic','bmp','svg'].includes(ext)) return 'image'
  if (['mp4','mov','avi','mkv','webm','flv','m4v'].includes(ext)) return 'video'
  if (['mp3','wav','aac','flac','ogg','m4a'].includes(ext)) return 'audio'
  if (['pdf','doc','docx','xls','xlsx','ppt','pptx','txt','md'].includes(ext)) return 'document'
  if (['json','csv','xml','yaml','yml'].includes(ext)) return 'data'
  return 'other'
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', {headers: corsHeaders})

  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // 验证用户身份
    const authHeader = req.headers.get('Authorization') || ''
    if (!authHeader) return Response.json({error: '未授权'}, {status: 401, headers: corsHeaders})
    const {data: {user}, error: authErr} = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    if (authErr || !user) return Response.json({error: '认证失败'}, {status: 401, headers: corsHeaders})

    // 查询用户信息
    const {data: profile} = await supabase
      .from('profiles')
      .select('openid, membership_level, cos_space_initialized')
      .eq('id', user.id)
      .maybeSingle()

    if (!profile) return Response.json({error: '用户信息不存在'}, {status: 404, headers: corsHeaders})
    if (!profile.membership_level || profile.membership_level === 'free') {
      return Response.json({error: '请先购买套餐', code: 'NOT_PAID', files: []}, {status: 403, headers: corsHeaders})
    }

    const openid = (profile.openid as string) || user.id
    const secretId = Deno.env.get('TENCENT_SECRET_ID')!
    const secretKey = Deno.env.get('TENCENT_SECRET_KEY')!
    const bucket = Deno.env.get('COS_BUCKET')!
    const region = Deno.env.get('COS_REGION')!
    const host = `${bucket}.cos.${region}.myqcloud.com`
    const userPrefix = `users/${openid}/`

    // ==================
    // DELETE：删除指定文件
    // ==================
    if (req.method === 'DELETE') {
      const urlObj = new URL(req.url)
      const fileKey = urlObj.searchParams.get('key')
      if (!fileKey) return Response.json({error: '缺少 key 参数'}, {status: 400, headers: corsHeaders})

      // 安全校验：只允许删除属于该用户的文件
      if (!fileKey.startsWith(userPrefix)) {
        return Response.json({error: '无权删除该文件'}, {status: 403, headers: corsHeaders})
      }

      const encodedKey = '/' + fileKey.split('/').map(encodeURIComponent).join('/')
      const sigHeaders: Record<string, string> = {host}
      const auth = await cosAuth(secretId, secretKey, 'DELETE', encodedKey, {}, sigHeaders)

      const delResp = await fetch(`https://${host}${encodedKey}`, {
        method: 'DELETE',
        headers: {Host: host, Authorization: auth}
      })

      if (!delResp.ok && delResp.status !== 204) {
        const errText = await delResp.text()
        console.error('COS delete error:', errText)
        return Response.json({error: `删除失败: ${delResp.status}`}, {status: 500, headers: corsHeaders})
      }

      return Response.json({success: true, message: '文件已删除'}, {headers: corsHeaders})
    }

    // ==================
    // GET：列出文件
    // ==================
    const prefix = userPrefix
    const queryParams: Record<string, string> = {
      'list-type': '2',
      prefix,
      'max-keys': '500'
    }

    const sigHeaders: Record<string, string> = {host}
    const auth = await cosAuth(secretId, secretKey, 'GET', '/', queryParams, sigHeaders)

    // 构建请求URL（参数需要正确编码）
    const qs = Object.entries(queryParams)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&')
    const url = `https://${host}/?${qs}`

    const cosResp = await fetch(url, {
      headers: {
        Host: host,
        Authorization: auth
      }
    })

    if (!cosResp.ok) {
      const errText = await cosResp.text()
      console.error('COS list error:', errText)
      return Response.json({error: `COS请求失败: ${cosResp.status}`, files: []}, {status: 500, headers: corsHeaders})
    }

    const xmlText = await cosResp.text()

    // 解析 XML 提取 Contents 列表
    const contentBlocks = extractTags(xmlText, 'Contents')
    const files = contentBlocks
      .map(block => {
        const key = extractTag(block, 'Key')
        const size = parseInt(extractTag(block, 'Size') || '0', 10)
        const lastModified = extractTag(block, 'LastModified')

        // 跳过 .meta 文件和以 / 结尾的目录条目
        if (!key || key.endsWith('.meta') || key.endsWith('/')) return null

        // 判断文件属于 uploads 还是 outputs
        const fileType = key.includes('/uploads/') ? 'upload' : key.includes('/outputs/') ? 'output' : 'other'
        const name = key.split('/').pop() || key
        const cosUrl = `https://${host}/${key}`

        return {
          key,
          name,
          size,
          sizeStr: formatSize(size),
          category: getCategory(key),
          lastModified,
          type: fileType,
          url: cosUrl
        }
      })
      .filter(Boolean)

    return Response.json({
      files,
      total: files.length,
      cosSpaceInitialized: profile.cos_space_initialized || false,
      userPrefix: prefix
    }, {headers: corsHeaders})

  } catch (e: any) {
    console.error('cos_list_files error:', e)
    return Response.json({error: e.message || '服务器错误', files: []}, {status: 500, headers: corsHeaders})
  }
})
