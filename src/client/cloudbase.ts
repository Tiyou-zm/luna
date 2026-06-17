import Taro from '@tarojs/taro'
import type {Profile} from '@/db/types'
import {setLastCloudCall} from '@/utils/runtimeDiagnostics'

export const CLOUDBASE_ENV_ID = process.env.TARO_APP_CLOUDBASE_ENV_ID || ''
export const isCloudBaseReady = Boolean(CLOUDBASE_ENV_ID)

let initialized = false

export interface AppUser {
  id: string
  openid?: string | null
  accountType?: 'manual' | 'wechat'
  sessionToken?: string | null
}

export interface CloudResponse<T = unknown> {
  ok: boolean
  data?: T
  error?: string
  code?: string
}

function getCloud() {
  return typeof wx !== 'undefined' ? wx.cloud : undefined
}

export function initCloudBase() {
  if (initialized || !isCloudBaseReady) return
  const cloud = getCloud()
  if (!cloud?.init) return
  cloud.init({env: CLOUDBASE_ENV_ID, traceUser: false})
  initialized = true
}

export async function callCloudFunction<T = unknown>(
  name: string,
  data: Record<string, unknown> = {},
): Promise<T> {
  initCloudBase()
  const cloud = getCloud()
  if (!cloud?.callFunction) {
    throw new Error('当前环境不支持微信云开发，请在微信开发者工具或真机中运行')
  }
  const user = getLocalUser()
  const action = typeof data.action === 'string' ? data.action : ''
  const isAuthAction = name === 'dbApi' && ['login', 'register', 'ensureProfile', 'ping', 'authDebug'].includes(action)
  const payload = (!isAuthAction && user?.sessionToken && !data.authToken)
    ? {...data, authToken: user.sessionToken}
    : data
  const startedAt = Date.now()
  setLastCloudCall({name, action, env: CLOUDBASE_ENV_ID, status: 'start'})
  console.info('[CloudBase] call start', {name, action, env: CLOUDBASE_ENV_ID})
  let res
  try {
    res = await cloud.callFunction<CloudResponse<T> | T>({
      name,
      data: payload,
      config: {env: CLOUDBASE_ENV_ID},
    } as any)
  } catch (error) {
    const duration = Date.now() - startedAt
    setLastCloudCall({name, action, env: CLOUDBASE_ENV_ID, status: 'error', duration, error: String(error)})
    console.error('[CloudBase] call error', {name, action, duration, error})
    throw error
  }
  const duration = Date.now() - startedAt
  setLastCloudCall({name, action, env: CLOUDBASE_ENV_ID, status: 'end', duration})
  console.info('[CloudBase] call end', {name, action, duration})
  const result = res.result as CloudResponse<T> | T
  if (result && typeof result === 'object' && 'ok' in result) {
    const wrapped = result as CloudResponse<T>
    if (!wrapped.ok) throw new Error(wrapped.error || '云函数调用失败')
    return wrapped.data as T
  }
  return result as T
}

export async function ensureCloudProfile(metadata: Partial<Profile> = {}) {
  return callCloudFunction<{user: AppUser; profile: Profile}>('dbApi', {action: 'ensureProfile', metadata})
}

export async function getActiveCloudProfile() {
  return callCloudFunction<Profile>('dbApi', {action: 'getProfile'})
}

export async function authCloudAccount(action: 'login' | 'register', username: string, password: string) {
  return callCloudFunction<{user: AppUser; profile: Profile}>('dbApi', {action, username, password})
}

export async function callDbApi<T = unknown>(action: string, payload: Record<string, unknown> = {}) {
  return callCloudFunction<T>('dbApi', {action, ...payload})
}

export async function uploadCloudFile(localPath: string, cloudPath: string) {
  initCloudBase()
  const cloud = getCloud()
  if (!cloud?.uploadFile) throw new Error('当前环境不支持云存储上传')
  const res = await cloud.uploadFile({cloudPath, filePath: localPath})
  return res.fileID
}

export async function getCloudTempUrl(fileID: string) {
  initCloudBase()
  const cloud = getCloud()
  if (!cloud?.getTempFileURL) return fileID
  const res = await cloud.getTempFileURL({fileList: [fileID]})
  return res.fileList?.[0]?.tempFileURL || fileID
}

export function saveLocalUser(user: AppUser | null) {
  if (user) {
    Taro.setStorageSync('luna_cloud_user', user)
  } else {
    Taro.removeStorageSync('luna_cloud_user')
  }
}

export function getLocalUser(): AppUser | null {
  return Taro.getStorageSync('luna_cloud_user') || null
}
