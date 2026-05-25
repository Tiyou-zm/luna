import QRCode from 'npm:qrcode@1.5.3'
import {createClient} from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {headers: corsHeaders})
  }

  try {
    const {user_id, platform, account_name} = await req.json()

    if (!user_id || !platform || !account_name) {
      return Response.json(
        {error: '缺少必要参数: user_id, platform, account_name'},
        {status: 400, headers: corsHeaders}
      )
    }

    // 二维码编码的 JSON 内容（Claw MCP 扫码后直接读取并自动配置）
    const qrContent = JSON.stringify({
      luna_user_id: user_id,
      platform,
      account_name,
      webhook_url: 'https://backend.appmiaoda.com/projects/supabase307415807476936704/functions/v1/update_analytics',
      auth: 'Bearer claw-mcp-default-secret-2026',
    })

    // 使用 qrcode 生成 PNG Buffer
    const pngBuffer: Buffer = await QRCode.toBuffer(qrContent, {
      type: 'png',
      width: 400,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#FFFFFF',
      },
      errorCorrectionLevel: 'M',
    })

    // 上传到 Supabase Storage qrcodes bucket
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const timestamp = Date.now()
    const filename = `${user_id.slice(0, 8)}_${platform}_${timestamp}.png`

    const {data: uploadData, error: uploadError} = await supabase.storage
      .from('qrcodes')
      .upload(filename, pngBuffer, {
        contentType: 'image/png',
        upsert: true,
      })

    if (uploadError) {
      console.error('上传二维码失败:', uploadError)
      return Response.json(
        {error: '二维码上传失败: ' + uploadError.message},
        {status: 500, headers: corsHeaders}
      )
    }

    const {data: urlData} = supabase.storage
      .from('qrcodes')
      .getPublicUrl(uploadData.path)

    return Response.json(
      {url: urlData.publicUrl},
      {headers: corsHeaders}
    )
  } catch (err) {
    console.error('generate-binding-qrcode 错误:', err)
    return Response.json(
      {error: '服务器内部错误'},
      {status: 500, headers: corsHeaders}
    )
  }
})
