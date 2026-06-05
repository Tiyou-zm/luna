declare const wx: {
  cloud?: {
    init: (options: {env: string; traceUser?: boolean}) => void
    callFunction: <T = unknown>(options: {
      name: string
      data?: Record<string, unknown>
      success?: (res: {result: T}) => void
      fail?: (error: unknown) => void
    }) => Promise<{result: T}>
    uploadFile: (options: {
      cloudPath: string
      filePath: string
      success?: (res: {fileID: string}) => void
      fail?: (error: unknown) => void
    }) => Promise<{fileID: string}>
    getTempFileURL?: (options: {
      fileList: string[]
    }) => Promise<{fileList: Array<{fileID: string; tempFileURL: string; status: number}>}>
  }
}
