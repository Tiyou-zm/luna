// 获取火山方舟模型列表 + 算力价格参考
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
}

// 已知的模型价格表（元/百万Token，仅供参考）
const MODEL_PRICE_MAP: Record<string, {input: number; output: number; desc: string}> = {
  'doubao-1-5-lite-32k': {input: 0.3, output: 0.9, desc: '轻量高效文本模型，适合日常创作'},
  'doubao-1-5-pro-32k': {input: 0.8, output: 2.0, desc: '专业文本生成，平衡性能与成本'},
  'doubao-1-5-pro-256k': {input: 5.0, output: 9.0, desc: '超长上下文，适合长文档处理'},
  'doubao-1-5-vision-pro-32k': {input: 3.0, output: 9.0, desc: '多模态视觉理解，支持图片分析'},
  'doubao-1-5-vision-lite-32k': {input: 0.8, output: 2.0, desc: '轻量视觉模型，图片描述生成'},
  'doubao-pro-32k': {input: 0.8, output: 2.0, desc: '旗舰对话模型'},
  'doubao-lite-32k': {input: 0.3, output: 0.9, desc: '快速轻量对话'},
  'doubao-embedding-large': {input: 0.5, output: 0, desc: '文本向量化，语义检索'},
  'moonshot-v1-8k': {input: 12, output: 12, desc: '月之暗面，精准推理'},
  'glm-4-flash': {input: 0.1, output: 0.1, desc: '智谱AI闪电版，免费额度'}
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', {headers: corsHeaders})

  try {
    const apiKey = Deno.env.get('ARKCLAW_API_TOKEN')
    let apiModels: string[] = []

    // 尝试从 Ark API 获取模型列表
    if (apiKey) {
      try {
        const res = await fetch('https://ark.cn-beijing.volces.com/api/v3/models', {
          headers: {Authorization: `Bearer ${apiKey}`}
        })
        if (res.ok) {
          const data = await res.json()
          apiModels = (data?.data || []).map((m: {id: string}) => m.id)
        }
      } catch (e) {
        console.warn('Failed to fetch Ark model list:', e)
      }
    }

    // 构建模型价格列表
    // 如果 API 返回了模型列表，以 API 数据为准并补充价格信息
    const allModelIds = apiModels.length > 0
      ? [...new Set([...apiModels, ...Object.keys(MODEL_PRICE_MAP)])]
      : Object.keys(MODEL_PRICE_MAP)

    const models = allModelIds.map((id) => {
      const priceInfo = MODEL_PRICE_MAP[id] || {input: 0, output: 0, desc: ''}
      return {
        id,
        name: id,
        inputPrice: priceInfo.input,
        outputPrice: priceInfo.output,
        desc: priceInfo.desc || 'Ark平台模型',
        inApiList: apiModels.includes(id)
      }
    }).filter(m => m.inputPrice > 0 || m.inApiList)  // 过滤掉未知且不在API列表的

    // 算力充值档位（起充¥50）
    const rechargePlans = [
      {amount: 50, credits: 65, bonus: '赠30%', popular: false},
      {amount: 100, credits: 140, bonus: '赠40%', popular: true},
      {amount: 300, credits: 450, bonus: '赠50%', popular: false},
      {amount: 500, credits: 800, bonus: '赠60%', popular: false},
      {amount: 1000, credits: 1700, bonus: '赠70%', popular: false},
      {amount: 2000, credits: 3600, bonus: '赠80%', popular: false}
    ]

    // 单位换算：1算力积分 ≈ 100万 tokens 的 lite 模型成本
    const computeRate = '1积分 ≈ 约100万Tokens（lite模型）'

    return Response.json({
      models: models.slice(0, 20),  // 最多展示20个
      rechargePlans,
      computeRate,
      lastUpdated: new Date().toISOString(),
      dataSource: apiModels.length > 0 ? '实时API' : '参考数据'
    }, {headers: corsHeaders})
  } catch (err) {
    console.error('ark_model_pricing error:', err)
    return Response.json({error: String(err)}, {status: 500, headers: corsHeaders})
  }
})
