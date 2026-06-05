import Taro from '@tarojs/taro'
import {callDbApi, getCloudTempUrl, getLocalUser, uploadCloudFile} from '@/client/cloudbase'
import type {FileInput, MiniProgramFileInput} from '@/utils/upload'
import {generateFileName, getMimeType} from '@/utils/upload'

export interface CosUploadedFile {
  key: string
  url: string
  name: string
  type: 'image' | 'file' | 'video'
  mime_type: string
  file_type: string
  size?: number
}

export interface CosUploadResult {
  success: boolean
  data?: CosUploadedFile
  error?: string
}

function getFileName(file: FileInput): string {
  const name = (file as File).name || (file as MiniProgramFileInput).name
  const ext = name?.split('.').pop() || 'file'
  return name || generateFileName(ext)
}

function getFileSize(file: FileInput): number | undefined {
  return (file as File).size ?? (file as MiniProgramFileInput).size
}

function classifyFile(ext: string): 'image' | 'file' | 'video' {
  const lower = ext.toLowerCase()
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'heic'].includes(lower)) return 'image'
  if (['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'm4v'].includes(lower)) return 'video'
  return 'file'
}

function safeName(name: string): string {
  const ext = name.split('.').pop() || 'file'
  const base = name.replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '-').slice(0, 48) || 'file'
  return `${base}.${ext}`
}

export async function uploadToCos(file: FileInput): Promise<CosUploadResult> {
  try {
    if (Taro.getEnv() === Taro.ENV_TYPE.WEB) {
      throw new Error('CloudBase upload only supports WeChat Mini Program in this project')
    }

    const name = getFileName(file)
    const ext = name.split('.').pop()?.toLowerCase() || 'file'
    const type = classifyFile(ext)
    const mimeType = (file as File).type || (file as MiniProgramFileInput).type || getMimeType(ext)
    const ownerId = getLocalUser()?.id || 'anonymous'
    const key = `users/${ownerId}/uploads/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName(name)}`
    const fileID = await uploadCloudFile((file as MiniProgramFileInput).tempFilePath, key)
    const url = await getCloudTempUrl(fileID)
    const uploaded: CosUploadedFile = {
      key: fileID,
      url,
      name,
      type,
      mime_type: mimeType,
      file_type: ext,
      size: getFileSize(file),
    }

    await callDbApi('recordAsset', {asset: uploaded}).catch(() => null)

    return {success: true, data: uploaded}
  } catch (error: any) {
    return {success: false, error: error.message || 'CloudBase upload failed'}
  }
}
