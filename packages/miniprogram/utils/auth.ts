import { request } from './request';
import { clearGuestIdentity } from './identity';

interface LoginResult {
  token: string;
  userInfo: {
    id: number;
    nickname: string;
    avatar: string;
    gender: number;
    title: string;
    totalGames: number;
    wins: number;
  };
}

export const login = () => {
  return new Promise<LoginResult>((resolve, reject) => {
    wx.login({
      success: async (res: WechatMiniprogram.LoginSuccessCallbackResult) => {
        if (res.code) {
          try {
            const data = await request<LoginResult>({
              url: '/auth/wx-login',
              method: 'POST',
              data: { code: res.code }
            });

            // 存储 Token 和用户信息
            wx.setStorageSync('token', data.token);
            clearGuestIdentity();
            const app = getApp<IAppOption>();
            app.globalData.token = data.token;
            app.globalData.userInfo = data.userInfo;

            resolve(data);
          } catch (err) {
            reject(err);
          }
        } else {
          reject(res.errMsg);
        }
      },
      fail: (err: WechatMiniprogram.GeneralCallbackResult) => {
        reject(err);
      }
    });
  });
};

export const checkLogin = () => {
  return !!wx.getStorageSync('token');
};
