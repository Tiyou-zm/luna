import assert from 'node:assert/strict'
import Module from 'node:module'
import http from 'node:http'
import {pathToFileURL} from 'node:url'

const originalLoad = Module._load

const state = {
  calls: [],
  collections: new Map(),
}

function nowDoc(collection, id) {
  const map = state.collections.get(collection) || new Map()
  state.collections.set(collection, map)
  return {map, id}
}

function makeDb() {
  return {
    command: {
      inc(value) {
        return {__op: 'inc', value}
      },
    },
    collection(name) {
      return {
        doc(id) {
          const {map} = nowDoc(name, id)
          return {
            async get() {
              if (!map.has(id)) throw new Error(`doc not found: ${name}/${id}`)
              return {data: map.get(id)}
            },
            async update({data}) {
              const prev = map.get(id) || {_id: id, id}
              const next = {...prev}
              for (const [key, value] of Object.entries(data || {})) {
                if (value && typeof value === 'object' && value.__op === 'inc') {
                  next[key] = Number(next[key] || 0) + Number(value.value || 0)
                } else {
                  next[key] = value
                }
              }
              map.set(id, next)
              return {updated: 1}
            },
            async set({data}) {
              map.set(id, {...data, _id: id, id})
              return {id}
            },
          }
        },
        async add({data}) {
          const map = state.collections.get(name) || new Map()
          state.collections.set(name, map)
          const id = `${name}_${map.size + 1}`
          map.set(id, {...data, _id: id, id})
          return {_id: id}
        },
      }
    },
  }
}

Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'wx-server-sdk') {
    return {
      DYNAMIC_CURRENT_ENV: 'local-test',
      init() {},
      getWXContext() {
        return {OPENID: 'test_openid'}
      },
      database: makeDb,
    }
  }
  return originalLoad.call(this, request, parent, isMain)
}

function seedProfile(overrides = {}) {
  const {map} = nowDoc('profiles', 'test_openid')
  map.set('test_openid', {
    _id: 'test_openid',
    id: 'test_openid',
    openid: 'test_openid',
    membership_level: 'free',
    ai_count: 0,
    ...overrides,
  })
}

function getRows(name) {
  return Array.from((state.collections.get(name) || new Map()).values())
}

function startMockAiServer() {
  const server = http.createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = Buffer.concat(chunks).toString('utf8')
    state.calls.push({url: req.url, body})

    res.setHeader('content-type', 'application/json')

    if (req.url === '/v1/chat/completions') {
      res.end(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              type: 'material_package',
              platforms: {
                xiaohongshu: {
                  posts: [{
                    scene: '功能种草',
                    title: '测试封面标题',
                    body: '这是一段测试小红书正文。',
                    tags: ['#AI工具', '#内容创作'],
                  }],
                },
                douyin: {
                  scripts: [{
                    duration: 30,
                    hook: '3秒讲清核心卖点',
                    sections: [{time: '0-3s', type: 'hook', content: '先抛出痛点。'}],
                  }],
                },
                moments: {
                  posts: [{style: '产品体验型', body: '朋友圈测试文案。'}],
                },
                wechat_public: {
                  outline: {title: '测试公众号标题', sections: ['开头Hook', '痛点共鸣', '功能拆解']},
                },
              },
            }),
          },
        }],
      }))
      return
    }

    if (req.url === '/chat/completions') {
      const unsafe = body.includes('登录小红书后台') || body.includes('抓数据')
      res.end(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify(unsafe
              ? {action: 'safe_redirect', task_type: 'blocked_collection', reason: '后台登录采集'}
              : {action: 'allow_generate', task_type: 'material_package', reason: '正常创作'}),
          },
        }],
      }))
      return
    }

    res.statusCode = 404
    res.end(JSON.stringify({error: 'not found'}))
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({server, port: server.address().port})
    })
  })
}

async function loadFunction(port) {
  process.env.HERMES_BASE_URL = `http://127.0.0.1:${port}/v1/chat/completions`
  process.env.HERMES_API_KEY = 'local-test-key'
  process.env.HERMES_MODEL = 'hermes-agent'
  process.env.MINIMAX_BASE_URL = `http://127.0.0.1:${port}`
  process.env.MINIMAX_API_KEY = 'local-test-minimax-key'
  process.env.MINIMAX_MODEL = 'MiniMax-M2.7-highspeed'

  const mod = await import(pathToFileURL(`${process.cwd()}\\cloudfunctions\\lunaGuardian\\index.js`).href)
  return mod.default || mod
}

async function testBlocked(main) {
  state.calls.length = 0
  seedProfile()
  const res = await main({
    user_message: '帮我登录小红书后台抓数据',
    platforms: ['小红书', '抖音', '视频号', '公众号'],
  })

  assert.equal(res.ok, true)
  assert.equal(res.data.blocked, true)
  assert.equal(res.data.task_type, 'blocked_collection')
  assert.equal(getRows('materials').length, 0)
  assert.equal(state.calls.some((call) => call.url === '/v1/chat/completions'), false)
}

async function testGenerate(main) {
  state.calls.length = 0
  seedProfile()
  const res = await main({
    user_message: '帮我做一个小红书种草文案',
    platforms: ['小红书', '抖音', '视频号', '公众号'],
    goal: '品牌曝光',
  })

  assert.equal(res.ok, true)
  assert.equal(res.data.blocked, undefined)
  assert.equal(res.data.accepted, true)
  assert.ok(res.data.job_id)
  assert.equal(getRows('generation_jobs').length, 1)
  assert.equal(getRows('materials').length, 0)
  assert.equal(state.calls.some((call) => call.url === '/v1/chat/completions'), false)
  return
  assert.equal(res.data.provider, 'hermes')
  assert.ok(res.data.material_id)
  assert.ok(res.data.result['小红书'])
  assert.equal(getRows('materials').length, 1)
  assert.equal(getRows('usage_records').length, 1)
  assert.equal(getRows('profiles')[0].ai_count, 1)
}

async function testFreeQuota(main) {
  seedProfile({ai_count: 5})
  const res = await main({
    user_message: '帮我做一个小红书种草文案',
    platforms: ['小红书'],
  })
  assert.equal(res.ok, true)
  assert.equal(res.data.task_type, 'need_more_info')
  assert.match(res.data.reply, /免费额度/)
}

async function main() {
  const {server, port} = await startMockAiServer()
  try {
    const fn = await loadFunction(port)
    const cloudFunctionMain = fn.main
    assert.equal(typeof cloudFunctionMain, 'function')

    await testBlocked(cloudFunctionMain)
    state.collections.clear()
    await testGenerate(cloudFunctionMain)
    state.collections.clear()
    await testFreeQuota(cloudFunctionMain)

    console.log(JSON.stringify({
      ok: true,
      tests: ['blocked_request', 'generate_package', 'free_quota'],
      hermes_calls: state.calls.filter((call) => call.url === '/v1/chat/completions').length,
      minimax_calls: state.calls.filter((call) => call.url === '/chat/completions').length,
    }, null, 2))
  } finally {
    server.close()
    Module._load = originalLoad
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
