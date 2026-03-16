import { getAccessToken } from './identity';
import { request } from './request';
import { saveUserInfo } from './profile';

interface LoginResult {
  token: string;
  needsProfileSetup: boolean;
  userInfo: {
    id: number;
    nickname: string;
    avatar: string;
    profileSetupCompleted: boolean;
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
            const app = getApp<IAppOption>();
            app.globalData.token = data.token;
            saveUserInfo(data.userInfo);

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
  return !!getAccessToken();
};
