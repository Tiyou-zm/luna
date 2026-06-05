import fs from 'node:fs'
import vm from 'node:vm'
import {createRequire} from 'node:module'

const source = fs.readFileSync('cloudfunctions/lunaGuardian/index.js', 'utf8')
const requireFromHere = createRequire(import.meta.url)

const fakeDb = {
  command: {inc: (value) => ({$inc: value})},
  collection: () => ({
    limit: () => ({get: async () => ({data: []})}),
  }),
}

const sandbox = {
  console,
  process: {env: {}},
  require(name) {
    if (name === 'wx-server-sdk') {
      return {
        init() {},
        DYNAMIC_CURRENT_ENV: 'test',
        database: () => fakeDb,
        getWXContext: () => ({OPENID: 'test-openid', APPID: 'test-appid'}),
      }
    }
    return requireFromHere(name)
  },
  exports: {},
  URL,
  Buffer,
  setTimeout,
  clearTimeout,
}

vm.runInNewContext(source, sandbox, {filename: 'lunaGuardian/index.js'})

const cases = [
  {
    name: 'normal reply',
    text: '可以，我先帮你把这段文案改得更像小红书口吻。',
    want: 'normal_reply',
  },
  {
    name: 'clarify',
    text: '我需要先确认一下：目标平台是小红书还是抖音？',
    want: 'clarify',
  },
  {
    name: 'outline',
    text: '以下是素材包大纲：1. 小红书种草 2. 抖音脚本。请确认后我再开始制作。',
    want: 'outline',
  },
  {
    name: 'structured outline',
    text: '```json\n{"type":"luna_interaction","intent":"outline","reply":"这是大纲，请确认","outline":{"title":"测试素材包"}}\n```',
    want: 'outline',
  },
  {
    name: 'confirmed start',
    text: '确认，开始制作',
    event: {pending_task: {title: '测试'}, confirmed_outline: '测试大纲'},
    want: 'start_generation',
  },
]

let failed = 0
for (const item of cases) {
  const res = await sandbox.exports.main({
    action: '__test_parse_interaction',
    text: item.text,
    user_message: item.text,
    ...(item.event || {}),
  })
  const got = res?.data?.intent
  if (got !== item.want) {
    failed += 1
    console.error(`[fail] ${item.name}: want ${item.want}, got ${got}`)
  } else {
    console.log(`[ok] ${item.name}: ${got}`)
  }
}

if (failed) process.exit(1)

const capability = await sandbox.exports.main({
  user_message: '你可以帮我做什么',
  history: [],
})

if (!capability?.data?.reply?.includes('直接对话创作') || capability?.data?.interaction_intent !== 'normal_reply') {
  console.error('[fail] capability reply should use local normal reply fallback')
  process.exit(1)
}

console.log('[ok] capability reply: normal local answer')
