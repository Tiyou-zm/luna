import path from 'node:path'
import {defineConfig, type UserConfigExport} from '@tarojs/cli'
import tailwindcss from 'tailwindcss'
import type {Plugin} from 'vite'
import {UnifiedViteWeappTailwindcssPlugin as uvtw} from 'weapp-tailwindcss/vite'

import devConfig from './dev'
import lintConfig from './lint'
import prodConfig from './prod'

const base = String(process.argv[process.argv.length - 1])
const publicPath = base.startsWith('http') ? base : '/'
const outputRoot = process.env.TARO_OUTPUT_ROOT || 'dist'

const clientEnv = {
  TARO_APP_APP_ID: process.env.TARO_APP_APP_ID || 'app-b9plzy10uj29',
  TARO_APP_CLOUDBASE_ENV_ID: process.env.TARO_APP_CLOUDBASE_ENV_ID || '',
  TARO_APP_AUTH_EMAIL_DOMAIN: process.env.TARO_APP_AUTH_EMAIL_DOMAIN || 'luna.local',
  TARO_APP_COS_PUBLIC_BASE_URL:
    process.env.TARO_APP_COS_PUBLIC_BASE_URL ||
    'https://wechat-app-1409532217.cos-website.ap-beijing.myqcloud.com'
}

function replaceNodeProcessPlugin(): Plugin {
  return {
    name: 'replace-node-process-for-weapp',
    enforce: 'pre',
    transform(code) {
      if (!code.includes('process.')) return null
      return {
        code: code
          .replace(/\bprocess\.platform\b/g, JSON.stringify('wechat'))
          .replace(/\bprocess\.version\b/g, JSON.stringify(''))
          .replace(/\bprocess\.versions\b/g, '({})'),
        map: null
      }
    }
  }
}

const htmlToTaroComponents: Record<string, string> = {
  div: 'View',
  section: 'View',
  main: 'View',
  header: 'View',
  footer: 'View',
  article: 'View',
  aside: 'View',
  nav: 'View',
  ul: 'View',
  ol: 'View',
  li: 'View',
  span: 'View',
  p: 'View',
  strong: 'View',
  em: 'View',
  h1: 'View',
  h2: 'View',
  h3: 'View',
  h4: 'View',
  h5: 'View',
  h6: 'View',
  img: 'Image',
  button: 'Button',
  input: 'Input',
  textarea: 'Textarea'
}

function addTaroComponentImports(code: string, components: Set<string>): string {
  const importPattern = /import\s*\{([^}]*)\}\s*from\s*['"]@tarojs\/components['"];?/
  const match = code.match(importPattern)
  const needed = Array.from(components).sort()

  if (!match) {
    return `import {${needed.join(', ')}} from '@tarojs/components'\n${code}`
  }

  const current = match[1]
    .split(',')
    .map((item) => item.trim().split(/\s+as\s+/)[0]?.trim())
    .filter(Boolean)
  const missing = needed.filter((component) => !current.includes(component))

  if (missing.length === 0) return code

  return code.replace(importPattern, (statement, imports: string) => {
    const nextImports = `${imports.trim()}, ${missing.join(', ')}`
    return statement.replace(imports, nextImports)
  })
}

function jsxHtmlToTaroTagsPlugin(): Plugin {
  const tagPattern = new RegExp(`(<\\/?\\s*)(${Object.keys(htmlToTaroComponents).join('|')})(?=[\\s>/])`, 'g')

  return {
    name: 'jsx-html-to-taro-components',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('/src/') && !id.includes('\\src\\')) return null
      if (!/\.[jt]sx$/.test(id)) return null
      if (!tagPattern.test(code)) return null

      tagPattern.lastIndex = 0
      const usedComponents = new Set<string>()
      const transformed = code.replace(tagPattern, (_match, prefix: string, tag: string) => {
        const component = htmlToTaroComponents[tag]
        usedComponents.add(component)
        return `${prefix}${component}`
      })

      return {
        code: addTaroComponentImports(transformed, usedComponents),
        map: null
      }
    }
  }
}

// https://taro-docs.jd.com/docs/next/config#defineconfig-辅助函数
export default defineConfig<'vite'>(async (merge) => {
  const baseConfig: UserConfigExport<'vite'> = {
    projectName: 'taro-vite',
    date: '2025-8-25',
    designWidth: 375,
    deviceRatio: {
      640: 2.34 / 2,
      750: 1,
      375: 2,
      828: 1.81 / 2
    },
    sourceRoot: 'src',
    outputRoot,
    plugins: [
      '@tarojs/plugin-generator'
    ],
    alias: {
      '@': path.resolve(__dirname, '../src')
    },
    defineConstants: {
      'process.env.TARO_APP_APP_ID': JSON.stringify(clientEnv.TARO_APP_APP_ID),
      'process.env.TARO_APP_CLOUDBASE_ENV_ID': JSON.stringify(clientEnv.TARO_APP_CLOUDBASE_ENV_ID),
      'process.env.TARO_APP_AUTH_EMAIL_DOMAIN': JSON.stringify(clientEnv.TARO_APP_AUTH_EMAIL_DOMAIN),
      'process.env.TARO_APP_COS_PUBLIC_BASE_URL': JSON.stringify(clientEnv.TARO_APP_COS_PUBLIC_BASE_URL)
    },
    copy: {
      patterns: [],
      options: {}
    },
    framework: 'react',
    compiler: {
      type: 'vite',
      vitePlugins: [
        jsxHtmlToTaroTagsPlugin(),
        replaceNodeProcessPlugin(),
        {
          // 通过 vite 插件加载 postcss,
          name: 'postcss-config-loader-plugin',
          config(config) {
            // 加载 tailwindcss
            if (typeof config.css?.postcss === 'object') {
              config.css?.postcss.plugins?.unshift(tailwindcss())
            }
          }
        },
        uvtw({
          // rem转rpx
          rem2rpx: {
            rootValue: 24,
            propList: ['*'],
            transformUnit: 'rpx'
          } as any,
          cssChildCombinatorReplaceValue: ['view', 'text', 'button'],
          // 除了小程序这些，其他平台都 disable
          disabled: process.env.TARO_ENV === 'h5',
          // 由于 taro vite 默认会移除所有的 tailwindcss css 变量，所以一定要开启这个配置，进行css 变量的重新注入
          injectAdditionalCssVarScope: true
        })
      ] as Plugin[]
    },
    mini: {
      // 禁止将图片转换为 base64，确保图片作为独立文件输出
      imageUrlLoaderOption: {
        limit: 0
      },
      fontUrlLoaderOption: {
        limit: 0
      },
      mediaUrlLoaderOption: {
        limit: 0
      },
      postcss: {
        pxtransform: {
          enable: true,
          config: {
            baseFontSize: 12,
            minRootSize: 12
          }
        },
        cssModules: {
          enable: false, // 默认为 false，如需使用 css modules 功能，则设为 true
          config: {
            namingPattern: 'module', // 转换模式，取值为 global/module
            generateScopedName: '[name]__[local]___[hash:base64:5]'
          }
        }
      }
    },
    h5: {
      publicPath,
      staticDirectory: 'static',

      sassLoaderOption: {
        additionalData: `@use "@/styles/overrides.scss";`
      },

      miniCssExtractPluginOption: {
        ignoreOrder: true,
        filename: 'css/[name].[hash].css',
        chunkFilename: 'css/[name].[chunkhash].css'
      },
      postcss: {
        pxtransform: {
          enable: true,
          config: {
            baseFontSize: 12,
            minRootSize: 12
          }
        },
        autoprefixer: {
          enable: true,
          config: {}
        },
        cssModules: {
          enable: false, // 默认为 false，如需使用 css modules 功能，则设为 true
          config: {
            namingPattern: 'module', // 转换模式，取值为 global/module
            generateScopedName: '[name]__[local]___[hash:base64:5]'
          }
        }
      },
      devServer: {
        open: false
      }
    }
  }

  if (process.env.LINT_MODE === 'true') {
    return merge({}, baseConfig, lintConfig)
  }

  if (process.env.NODE_ENV === 'development') {
    // 本地开发构建配置（不混淆压缩）
    return merge({}, baseConfig, devConfig)
  }

  // 生产构建配置（默认开启压缩混淆等）
  return merge({}, baseConfig, prodConfig)
})
