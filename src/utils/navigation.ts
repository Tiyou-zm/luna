import Taro from '@tarojs/taro'

const TAB_PAGES = new Set([
  '/pages/chat/index',
  '/pages/materials/index',
  '/pages/service/index',
  '/pages/profile/index',
])

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function safeNavigate(url: string, options: {replace?: boolean; delay?: number} = {}) {
  const normalized = url.startsWith('/') ? url : `/${url}`
  const delay = options.delay ?? 80
  if (delay > 0) await wait(delay)

  try {
    if (TAB_PAGES.has(normalized.split('?')[0])) {
      await Taro.switchTab({url: normalized})
      return true
    }
    if (options.replace) {
      await Taro.redirectTo({url: normalized})
    } else {
      await Taro.navigateTo({url: normalized})
    }
    return true
  } catch (error) {
    console.error('[Route] safeNavigate failed', {url: normalized, replace: options.replace, error})
    try {
      if (!TAB_PAGES.has(normalized.split('?')[0])) {
        await Taro.redirectTo({url: normalized})
        return true
      }
    } catch (fallbackError) {
      console.error('[Route] safeNavigate fallback failed', {url: normalized, error: fallbackError})
    }
    Taro.showToast({title: '页面跳转失败，请稍后重试', icon: 'none'})
    return false
  }
}
