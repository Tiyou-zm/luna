// 列出用户在火山 TOS 中的文件
import {createClient} from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
}

// ===== TOS V4 签名实现 =====
async function hmacSHA256(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw', key instanceof ArrayBuffer ? key : key.buffer,
    {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']
  )
  return await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data))
}

async function sha256Hex(data: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data))
  return toHex(hash)
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function tosSign(
  method: string,
  host: string,
  path: string,
  query: Record<string, string>,
  headers: Record<string, string>,
  accessKey: string,
  secretKey: string,
  region: string
): Promise<Record<string, string>> {
  const now = new Date()
  const datetime = now.toISOString().replace(/[:-]/g, '').replace(/\..+/, '') + 'Z' // yyyymmddTHHmmssZ
  const date = datetime.substring(0, 8) // yyyymmdd
  const payloadHash = await sha256Hex('')

  const allHeaders: Record<string, string> = {
    ...headers,
    host,
    'x-tos-date': datetime,
    'x-tos-content-sha256': payloadHash
  }

  // 正规化请求头
  const signedHeaderList = Object.keys(allHeaders).sort()
  const canonicalHeaders = signedHeaderList.map((k) => `${k.toLowerCase()}:${allHeaders[k].trim()}`).join('\n') + '\n'
  const signedHeaders = signedHeaderList.map((k) => k.toLowerCase()).join(';')

  // 正规化查询字符串
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`)
    .join('&')

  const canonicalRequest = [
    method,
    path,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join('\n')

  const credentialScope = `${date}/${region}/tos/tos4_request`
  const stringToSign = [
    'TOS4-HMAC-SHA256',
    datetime,
    credentialScope,
    await sha256Hex(canonicalRequest)
  ].join('\n')

  // 签名密钥推导
  const kDate = await hmacSHA256(new TextEncoder().encode('TOS4' + secretKey), date)
  const kRegion = await hmacSHA256(kDate, region)
  const kService = await hmacSHA256(kRegion, 'tos')
  const kSigning = await hmacSHA256(kService, 'tos4_request')
  const signature = toHex(await hmacSHA256(kSigning, stringToSign))

  const authHeader = `TOS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

  return {
    ...allHeaders,
    Authorization: authHeader
  }
}

// ===== 文件类型判断 =====
function getFileCategory(key: string): string {
  const ext = (key.split('.').pop() || '').toLowerCase()
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) return 'image'
  if (['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv'].includes(ext)) return 'video'
  if (['mp3', 'wav', 'ogg', 'aac', 'flac'].includes(ext)) return 'audio'
  if (['pdf', 'doc', 'docx', 'txt', 'ppt', 'pptx', 'xls', 'xlsx'].includes(ext)) return 'document'
  if (['json', 'csv'].includes(ext)) return 'data'
  return 'other'
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ===== 简单 XML 提取 =====
function extractXmlTag(xml: string, tag: string): string[] {
  const results: string[] = []
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'g')
  let match
  while ((match = regex.exec(xml)) !== null) {
    results.push(match[1])
  }
  return results
}

function extractXmlField(xml: string, field: string): string {
  const m = new RegExp(`<${field}[^>]*>([^<]*)<\\/${field}>`).exec(xml)
  return m ? m[1] : ''
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', {headers: corsHeaders})

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return Response.json({error: '未授权'}, {status: 401, headers: corsHeaders})

    const {data: {user}, error: authErr} = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    )
    if (authErr || !user) return Response.json({error: '认证失败'}, {status: 401, headers: corsHeaders})

    const accessKey = Deno.env.get('TOS_ACCESS_KEY')
    const secretKey = Deno.env.get('TOS_SECRET_KEY')
    const bucket = Deno.env.get('TOS_BUCKET_NAME')
    const region = Deno.env.get('TOS_REGION') || 'cn-beijing'

    if (!accessKey || !secretKey || !bucket) {
      return Response.json({
        files: [],
        error: 'TOS未配置',
        message: '火山TOS存储尚未配置，请联系管理员'
      }, {headers: corsHeaders})
    }

    const host = `${bucket}.tos-${region}.volces.com`
    const prefix = `users/${user.id}/`
    const queryParams: Record<string, string> = {
      'list-type': '2',
      'max-keys': '500',
      prefix
    }

    const signedHeaders = await tosSign('GET', host, '/', queryParams, {}, accessKey, secretKey, region)

    const queryStr = Object.entries(queryParams).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
    const url = `https://${host}/?${queryStr}`

    const response = await fetch(url, {headers: signedHeaders})
    if (!response.ok) {
      const text = await response.text()
      console.error('TOS list error:', response.status, text)
      return Response.json({
        files: [],
        error: `TOS请求失败: ${response.status}`,
        message: '文件列表获取失败，请检查TOS配置'
      }, {headers: corsHeaders})
    }

    const xml = await response.text()
    const contents = extractXmlTag(xml, 'Contents')

    const files = contents.map((item) => {
      const key = extractXmlField(item, 'Key')
      const size = parseInt(extractXmlField(item, 'Size') || '0')
      const lastModified = extractXmlField(item, 'LastModified')
      const fileName = key.split('/').pop() || key
      const category = getFileCategory(key)

      return {
        key,
        name: fileName,
        size,
        sizeStr: formatBytes(size),
        category,
        lastModified,
        url: `https://${host}/${key}`
      }
    }).filter(f => f.name && f.name !== '') // 过滤掉目录前缀本身

    return Response.json({files, total: files.length}, {headers: corsHeaders})
  } catch (err) {
    console.error('tos_list_files error:', err)
    return Response.json({error: String(err), files: []}, {status: 500, headers: corsHeaders})
  }
})
