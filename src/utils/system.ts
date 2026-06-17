import Taro from '@tarojs/taro'

export interface MiniWindowMetrics {
  windowHeight: number
  screenHeight: number
  safeBottom: number
}

export function getMiniWindowMetrics(fallback = 812): MiniWindowMetrics {
  const taroApi = Taro as unknown as {
    getWindowInfo?: () => {windowHeight?: number; screenHeight?: number; safeArea?: {bottom?: number}}
    getSystemInfoSync?: () => {windowHeight?: number; screenHeight?: number; safeArea?: {bottom?: number}}
  }

  const normalize = (info?: {windowHeight?: number; screenHeight?: number; safeArea?: {bottom?: number}}): MiniWindowMetrics => {
    const windowHeight = info?.windowHeight || fallback
    const screenHeight = info?.screenHeight || windowHeight
    const safeBottom = info?.safeArea?.bottom ? Math.max(0, screenHeight - info.safeArea.bottom) : 0
    return {windowHeight, screenHeight, safeBottom}
  }

  try {
    if (typeof taroApi.getWindowInfo === 'function') {
      return normalize(taroApi.getWindowInfo())
    }
  } catch {}

  try {
    if (typeof taroApi.getSystemInfoSync === 'function') {
      return normalize(taroApi.getSystemInfoSync())
    }
  } catch {}

  return {windowHeight: fallback, screenHeight: fallback, safeBottom: 0}
}

export function getMiniWindowHeight(fallback = 812): number {
  return getMiniWindowMetrics(fallback).windowHeight
}
