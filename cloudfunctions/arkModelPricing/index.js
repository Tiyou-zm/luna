exports.main = async () => ({
  ok: true,
  data: {
    models: [
      {id: 'doubao-lite', name: '豆包 Lite', inputPrice: 0.0008, outputPrice: 0.002, desc: '轻量文本生成', inApiList: true},
      {id: 'hermes-agent', name: 'Hermes Agent', inputPrice: 0.001, outputPrice: 0.003, desc: '内容生成主模型', inApiList: true},
    ],
    rechargePlans: [
      {amount: 50, credits: 65, bonus: '15积分', popular: false},
      {amount: 100, credits: 140, bonus: '40积分', popular: true},
      {amount: 300, credits: 450, bonus: '150积分', popular: false},
    ],
    computeRate: '1积分 ≈ 约100万Tokens（lite模型）',
    lastUpdated: new Date().toISOString(),
    dataSource: 'cloudbase-static',
  },
})
