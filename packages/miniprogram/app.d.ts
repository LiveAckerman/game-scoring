/**
 * 小程序全局类型定义
 */
interface IAppOption {
  globalData: {
    userInfo?: WechatMiniprogram.UserInfo | null,
    token?: string
  }
  userInfoReadyCallback?: WechatMiniprogram.UserInfoReadyCallback
}
