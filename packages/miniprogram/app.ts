// app.ts
App<IAppOption>({
  globalData: {
    userInfo: null,
    token: ''
  },
  onLaunch() {
    // 展示本地存储能力
    const logs: number[] = wx.getStorageSync('logs') || []
    logs.unshift(Date.now())
    wx.setStorageSync('logs', logs)

    // 尝试从本地加载 token
    const token = wx.getStorageSync('token')
    if (token) {
      this.globalData.token = token
    }
  },
})
