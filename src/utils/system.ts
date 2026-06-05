import Taro from '@tarojs/taro'

export function getMiniWindowHeight(fallback = 812): number {
  const taroApi = Taro as unknown as {
    getWindowInfo?: () => {windowHeight?: number; screenHeight?: number}
  }

  try {
    if (typeof taroApi.getWindowInfo === 'function') {
      const info = taroApi.getWindowInfo()
      return info.windowHeight || info.screenHeight || fallback
    }
  } catch {}

  return fallback
}
