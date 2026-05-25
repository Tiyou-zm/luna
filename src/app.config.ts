const pages = [
  'pages/chat/index',
  'pages/features/index',
  'pages/service/index',
  'pages/profile/index',
  'pages/login/index',
  'pages/pricing/index',
  'pages/orders/index',
  'pages/materials/index',
  'pages/monitor/index',
  'pages/account-security/index',
  'pages/settings/index',
  'pages/about/index',
  'pages/compute-recharge/index',
  'pages/admin-finance/index',
  'pages/usage-records/index',
  'pages/package-create/index',
  'pages/package-result/index',
]

export default defineAppConfig({
  pages,
  tabBar: {
    color: '#888888',
    selectedColor: '#6C5CE7',
    backgroundColor: '#FFFFFF',
    borderStyle: 'black',
    list: [
      {
        pagePath: 'pages/chat/index',
        text: '工作台',
        iconPath: './assets/icons/chat_unselected.png',
        selectedIconPath: './assets/icons/chat_selected.png'
      },
      {
        pagePath: 'pages/features/index',
        text: '功能',
        iconPath: './assets/icons/features_unselected.png',
        selectedIconPath: './assets/icons/features_selected.png'
      },
      {
        pagePath: 'pages/service/index',
        text: '客服',
        iconPath: './assets/icons/service_unselected.png',
        selectedIconPath: './assets/icons/service_selected.png'
      },
      {
        pagePath: 'pages/profile/index',
        text: '我的',
        iconPath: './assets/icons/profile_unselected.png',
        selectedIconPath: './assets/icons/profile_selected.png'
      }
    ]
  },
  window: {
    backgroundTextStyle: 'dark',
    navigationBarBackgroundColor: '#6C5CE7',
    navigationBarTitleText: 'Luna AI',
    navigationBarTextStyle: 'white'
  }
})
