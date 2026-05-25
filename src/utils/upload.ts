import Taro from "@tarojs/taro";
import { supabase } from "@/client/supabase";

/**
 * MIME type mappings for common file extensions
 */
export const MIME_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  zip: 'application/zip',
  rar: 'application/x-rar-compressed',
  '7z': 'application/x-7z-compressed',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  avi: 'video/x-msvideo',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  json: 'application/json',
  xml: 'application/xml',
  csv: 'text/csv'
} as const

/**
 * File input type for WeChat MiniProgram
 */
export interface MiniProgramFileInput {
  name: string
  type: string
  size: number
  tempFilePath: string
}


/**
 * Options for selecting media files
 */
export interface SelectMediaOptions {
  /** Maximum number of files to select */
  count?: number
  /** Media types to select */
  mediaType?: ('image' | 'video' | 'mix')[]
  /** Source type for file selection */
  sourceType?: ('album' | 'camera')[]
  /** Maximum video duration in seconds (MiniProgram only) */
  maxDuration?: number
  /** Camera mode (MiniProgram only) */
  camera?: 'back' | 'front'
}

/**
 * Options for selecting message files
 */
export interface SelectMessageFileOptions {
  /** Maximum number of files to select */
  count?: number
  /** File type filter */
  type?: 'all' | 'video' | 'image' | 'file'
  /** File extensions to allow */
  extension?: string[]
}

/** File upload configuration options */
export interface FileInputOptions {
  bucket: string
  userId?: string
}

/** Supported file data types */
export type FileBody =
  | ArrayBuffer
  | ArrayBufferView
  | Buffer
  | File
  | string

/** File input type (MiniProgram or Web) */
export type FileInput = MiniProgramFileInput | File


/**
 * Generate unique storage file name
 */
export function generateFileName(ext: string): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 8)
  return `${timestamp}-${random}.${ext}`
}

/**
 * Get MIME type for a file extension
 */
export function getMimeType(ext: string): string {
  return MIME_TYPES[ext.toLowerCase()] || 'application/octet-stream'
}

/**
 * Upload file to Supabase Storage
 * Supports both Web (File) and WeChat MiniProgram (tempFilePath) environments
 */
export async function uploadToSupabase(
  file: FileInput,
  options: FileInputOptions
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const { bucket, userId  } = options

    // Generate storage path
    const ext = file?.name?.split('.')?.pop() || 'file'
    const storageName = `${userId || 'public'}/${generateFileName(ext)}`

    // Prepare file body based on environment
    const fileBody: FileBody = Taro.getEnv() === Taro.ENV_TYPE.WEB ? (file as File)
      : (file as MiniProgramFileInput).tempFilePath

    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(storageName, fileBody, { contentType: file.type, upsert: false })

    if (error) {
      throw error
    }

    return { success: true, data }
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Upload failed'
    }
  }
}

/**
 * Select media files (images/videos) from device
 */
export async function selectMediaFiles(
  options: SelectMediaOptions = {}
): Promise<(MiniProgramFileInput | File)[]> {
  const {
    count = 1,
    mediaType = ['image', 'video'],
    sourceType = ['album', 'camera'],
    maxDuration,
    camera = 'back'
  } = options

  try {
    const result = await Taro.chooseMedia({
      count,
      mediaType,
      sourceType,
      maxDuration,
      camera
    })

    if (!result.tempFiles?.length) {
      return []
    }

    return result.tempFiles.map((file: any) => {
      // Web environment: return File object directly
      if (Taro.getEnv() === Taro.ENV_TYPE.WEB) {
        return file.originalFileObj as File
      }

      // MiniProgram environment: construct file metadata
      const tempFilePath = file.tempFilePath
      const ext = tempFilePath.split('.').pop() || 'unknown'
      const name = generateFileName(ext)
      const type = getMimeType(ext)

      return {
        name,
        type,
        size: file.size,
        tempFilePath
      } as MiniProgramFileInput
    })
  } catch (error: any) {
    console.error('Failed to select media files:', error)
    return []
  }
}

/**
 * Select a message file (document) from WeChat chat or local storage
 */
export async function selectMessageFile(
  options: SelectMessageFileOptions = {}
): Promise<MiniProgramFileInput | File | null> {
  const {
    count = 1,
    type = 'file',
    extension = ['pdf']
  } = options

  try {
    // Web environment: use native file input
    if (Taro.getEnv() === Taro.ENV_TYPE.WEB) {
      return new Promise<File | null>((resolve) => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = extension.map(ext => `.${ext}`).join(',')
        input.onchange = (e: Event) => {
          const target = e.target as HTMLInputElement
          const selectedFile = target.files?.[0]
          input.remove()
          resolve(selectedFile || null)
        }
        // Handle user cancellation
        input.oncancel = () => {
          input.remove()
          resolve(null)
        }
        input.click()
      })
    }

    // MiniProgram environment: use chooseMessageFile API
    const result = await Taro.chooseMessageFile({
      count,
      type,
      extension
    })
    if (!result.tempFiles?.length) {
      return null
    }
    const file = result.tempFiles[0]
    const ext = file.name?.split('.').pop() || extension[0]
    return {
      name: file.name,
      type: getMimeType(ext),
      size: file.size,
      tempFilePath: file.path
    } as MiniProgramFileInput
  } catch (error: any) {
    console.error('Failed to select message file:', error)
    return null
  }
}
