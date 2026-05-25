// 腾讯云COS STS临时凭证生成 + POST Object预签名
import {createClient} from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
}

// ===== TC3-HMAC-SHA256（用于腾讯云STS API签名）=====
async function hmacSHA256Bytes(key: string | Uint8Array, data: string): Promise<Uint8Array> {
  const keyData = typeof key === 'string' ? new TextEncoder().encode(key) : key
  const ck = await crypto.subtle.importKey('raw', keyData, {name: 'HMAC', hash: 'SHA-256'}, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', ck, new TextEncoder().encode(data)))
}

async function sha256Hex(data: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data))
  return toHex(new Uint8Array(h))
}

// ===== HMAC-SHA1（用于COS REST API签名）=====
async function hmacSHA1Bytes(key: string | Uint8Array, data: string): Promise<Uint8Array> {
  const keyData = typeof key === 'string' ? new TextEncoder().encode(key) : key
  const ck = await crypto.subtle.importKey('raw', keyData, {name: 'HMAC', hash: 'SHA-1'}, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', ck, new TextEncoder().encode(data)))
}

function toHex(buf: Uint8Array): string {
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('')
}

// TC3-HMAC-SHA256签名（腾讯云STS接口使用）
async function tc3Sign(
  secretId: string, secretKey: string,
  service: string, action: string, version: string, body: string
): Promise<Record<string, string>> {
  const now = Math.floor(Date.now() / 1000)
  const date = new Date(now * 1000).toISOString().slice(0, 10)
  const host = `${service}.tencentcloudapi.com`
  const contentType = 'application/json'
  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\n`
  const signedHeaders = 'content-type;host'
  const payloadHash = await sha256Hex(body)
  const canonicalReq = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`
  const credentialScope = `${date}/${service}/tc3_request`
  const stringToSign = `TC3-HMAC-SHA256\n${now}\n${credentialScope}\n${await sha256Hex(canonicalReq)}`
  const secretDate = await hmacSHA256Bytes(`TC3${secretKey}`, date)
  const secretService = await hmacSHA256Bytes(secretDate, service)
  const secretSigning = await hmacSHA256Bytes(secretService, 'tc3_request')
  const signature = toHex(await hmacSHA256Bytes(secretSigning, stringToSign))
  return {
    'Authorization': `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    'Content-Type': contentType,
    'Host': host,
    'X-TC-Action': action,
    'X-TC-Version': version,
    'X-TC-Timestamp': String(now)
  }
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

    // 查询用户付费状态 & openid
    const {data: profile} = await supabase
      .from('profiles')
      .select('openid, membership_level, cos_space_initialized')
      .eq('id', user.id)
      .maybeSingle()

    if (!profile) return Response.json({error: '用户信息不存在'}, {status: 404, headers: corsHeaders})
    if (!profile.membership_level || profile.membership_level === 'free') {
      return Response.json({error: '请先购买套餐以开通COS存储空间', code: 'NOT_PAID'}, {status: 403, headers: corsHeaders})
    }

    const openid = (profile.openid as string) || user.id
    const secretId = Deno.env.get('TENCENT_SECRET_ID')!
    const secretKey = Deno.env.get('TENCENT_SECRET_KEY')!
    const bucket = Deno.env.get('COS_BUCKET')!
    const region = Deno.env.get('COS_REGION')!
    // 从bucket名称提取APPID（格式：name-appid）
    const appid = bucket.split('-').pop()!

    // ===== 调用腾讯云STS GetFederationToken =====
    // 策略：仅允许访问 users/{openid}/* 路径
    const cosResource = `qcs::cos:${region}:uid/${appid}:${bucket}/users/${openid}/*`
    const stsPolicy = JSON.stringify({
      version: '2.0',
      statement: [{
        effect: 'allow',
        action: [
          'cos:GetObject', 'cos:PutObject', 'cos:DeleteObject',
          'cos:ListParts', 'cos:InitiateMultipartUpload',
          'cos:UploadPart', 'cos:CompleteMultipartUpload',
          'cos:AbortMultipartUpload', 'cos:ListObjectsV2'
        ],
        resource: [cosResource]
      }]
    })

    const stsBody = JSON.stringify({
      Name: `u${user.id.replace(/-/g, '').slice(0, 28)}`,
      Policy: encodeURIComponent(stsPolicy),
      DurationSeconds: 1800
    })

    const stsHeaders = await tc3Sign(secretId, secretKey, 'sts', 'GetFederationToken', '2018-08-13', stsBody)
    const stsResp = await fetch('https://sts.tencentcloudapi.com/', {method: 'POST', headers: stsHeaders, body: stsBody})
    const stsData = await stsResp.json()

    if (stsData.Response?.Error) {
      console.error('STS error:', stsData.Response.Error)
      return Response.json({error: `STS错误: ${stsData.Response.Error.Message}`}, {status: 500, headers: corsHeaders})
    }

    const creds = stsData.Response.Credentials
    const tmpSecretId: string = creds.TmpSecretId
    const tmpSecretKey: string = creds.TmpSecretKey
    const sessionToken: string = creds.Token
    const expiredTime: number = stsData.Response.ExpiredTime

    // ===== 生成 POST Object 预签名表单字段（小程序直传用）=====
    const startTime = Math.floor(Date.now() / 1000)
    const endTime = startTime + 1800
    const keyTime = `${startTime};${endTime}`
    const uploadPrefix = `users/${openid}/uploads/`
    const outputPrefix = `users/${openid}/outputs/`
    const cosUploadUrl = `https://${bucket}.cos.${region}.myqcloud.com/`

    // SignKey = HMAC-SHA1(tmpSecretKey, keyTime)
    const signKey = await hmacSHA1Bytes(tmpSecretKey, keyTime)

    const postPolicy = {
      expiration: new Date(endTime * 1000).toISOString(),
      conditions: [
        ['starts-with', '$key', uploadPrefix],
        {bucket},
        ['starts-with', '$Content-Type', ''],
        {'q-sign-algorithm': 'sha1'},
        {'q-ak': tmpSecretId},
        {'q-key-time': keyTime},
        ...(sessionToken ? [{'x-cos-security-token': sessionToken}] : [])
      ]
    }
    // policyBase64 作为 StringToSign
    const policyBase64 = btoa(JSON.stringify(postPolicy))
    const postSignature = toHex(await hmacSHA1Bytes(signKey, policyBase64))

    return Response.json({
      tmpSecretId,
      tmpSecretKey,
      sessionToken,
      expiredTime,
      bucket,
      region,
      openid,
      cosSpaceInitialized: profile.cos_space_initialized || false,
      uploadConfig: {
        url: cosUploadUrl,
        prefix: uploadPrefix,
        outputPrefix,
        formFields: {
          'q-sign-algorithm': 'sha1',
          'q-ak': tmpSecretId,
          'q-key-time': keyTime,
          'q-signature': postSignature,
          ...(sessionToken ? {'x-cos-security-token': sessionToken} : {}),
          policy: policyBase64
        }
      }
    }, {headers: corsHeaders})

  } catch (e: any) {
    console.error('cos_credential error:', e)
    return Response.json({error: e.message || '服务器错误'}, {status: 500, headers: corsHeaders})
  }
})
