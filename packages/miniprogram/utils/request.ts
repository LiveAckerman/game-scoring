const BASE_URL = 'http://localhost:8040/api'; // 实际开发时请替换为真实后端地址

interface RequestOptions {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  data?: any;
  header?: any;
}

export const request = <T = any>(options: RequestOptions): Promise<T> => {
  const token = wx.getStorageSync('token');
  const header = {
    ...options.header,
    'Authorization': token ? `Bearer ${token}` : ''
  };

  return new Promise((resolve, reject) => {
    wx.request({
      url: `${BASE_URL}${options.url}`,
      method: options.method || 'GET',
      data: options.data,
      header,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data as T);
        } else if (res.statusCode === 401) {
          // Token 过期或未登录，跳转登录页
          wx.removeStorageSync('token');
          wx.navigateTo({ url: '/pages/login/login' });
          reject(res);
        } else {
          wx.showToast({
            title: (res.data as any)?.message || '请求失败',
            icon: 'none'
          });
          reject(res);
        }
      },
      fail: (err) => {
        wx.showToast({
          title: '网络请求失败',
          icon: 'none'
        });
        reject(err);
      }
    });
  });
};
