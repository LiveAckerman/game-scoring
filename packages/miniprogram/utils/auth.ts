import { request } from './request';

export const login = () => {
  return new Promise((resolve, reject) => {
    wx.login({
      success: async (res) => {
        if (res.code) {
          try {
            const data = await request({
              url: '/auth/wx-login',
              method: 'POST',
              data: { code: res.code }
            });

            // 存储 Token 和用户信息
            wx.setStorageSync('token', data.token);
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
      fail: (err) => {
        reject(err);
      }
    });
  });
};

export const checkLogin = () => {
  return !!wx.getStorageSync('token');
};
