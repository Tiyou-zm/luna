import Taro from '@tarojs/taro'

type WxPrivacySetting = {
  needAuthorization?: boolean
  privacyContractName?: string
}

function getWxApi(): any {
  return typeof wx !== 'undefined' ? wx : null
}

function isWeapp() {
  return Taro.getEnv() === Taro.ENV_TYPE.WEAPP
}

function getPrivacySetting(): Promise<WxPrivacySetting> {
  const wxApi = getWxApi()
  if (!wxApi?.getPrivacySetting) return Promise.resolve({needAuthorization: false})
  return new Promise((resolve) => {
    wxApi.getPrivacySetting({
      success: (res: WxPrivacySetting) => resolve(res || {needAuthorization: false}),
      fail: () => resolve({needAuthorization: false}),
    })
  })
}

function requirePrivacyAuthorize(): Promise<boolean> {
  const wxApi = getWxApi()
  if (!wxApi?.requirePrivacyAuthorize) return Promise.resolve(true)
  return new Promise((resolve) => {
    wxApi.requirePrivacyAuthorize({
      success: () => resolve(true),
      fail: () => resolve(false),
    })
  })
}

export async function openPrivacyContract() {
  const wxApi = getWxApi()
  if (!isWeapp() || !wxApi?.openPrivacyContract) {
    Taro.showToast({title: '请在微信小程序中查看隐私政策', icon: 'none'})
    return
  }
  wxApi.openPrivacyContract({
    fail: () => Taro.showToast({title: '暂时无法打开隐私政策', icon: 'none'}),
  })
}

export async function ensurePrivacyAuthorized(scene = '继续使用该功能'): Promise<boolean> {
  if (!isWeapp()) return true
  const setting = await getPrivacySetting()
  if (!setting.needAuthorization) return true

  const contractName = setting.privacyContractName || '用户隐私保护指引'
  const modal = await Taro.showModal({
    title: '需要隐私授权',
    content: `为${scene}，请先阅读并同意《${contractName}》。`,
    cancelText: '暂不同意',
    confirmText: '同意并继续',
  })
  if (!modal.confirm) return false

  const ok = await requirePrivacyAuthorize()
  if (!ok) {
    Taro.showToast({title: '未同意隐私授权，操作已取消', icon: 'none'})
  }
  return ok
}
