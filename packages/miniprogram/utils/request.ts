import { getDeviceId } from './identity';

// export const API_BASE_URL = 'https://jf.leviackerman.site/api/v1';
export const API_BASE_URL = 'http://192.168.110.79:9090/api/v1';

interface RequestOptions {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  data?: unknown;
  header?: WechatMiniprogram.IAnyObject;
}

export interface RequestError {
  statusCode: number;
  message: string;
  data?: unknown;
}

export const request = <T = unknown>(options: RequestOptions): Promise<T> => {
  const token = wx.getStorageSync('token');
  const guestToken = wx.getStorageSync('guestToken');

  const header: WechatMiniprogram.IAnyObject = {
    'x-device-id': getDeviceId(),
    ...options.header,
  };

  if (token) {
    header.Authorization = `Bearer ${token}`;
  }

  if (guestToken) {
    header['x-guest-token'] = guestToken;
  }

  return new Promise((resolve, reject) => {
    wx.request({
      url: `${API_BASE_URL}${options.url}`,
      method: options.method || 'GET',
      data: options.data,
      header,
      success: (res: WechatMiniprogram.RequestSuccessCallbackResult) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data as T);
          return;
        }

        const responseData = res.data as { message?: string | string[] } | undefined;
        const message = Array.isArray(responseData?.message)
          ? responseData?.message[0]
          : responseData?.message || '请求失败';

        const error: RequestError = {
          statusCode: res.statusCode,
          message,
          data: res.data,
        };

        if (res.statusCode !== 401) {
          wx.showToast({
            title: message,
            icon: 'none',
          });
        }

        reject(error);
      },
      fail: () => {
        const error: RequestError = {
          statusCode: 0,
          message: '网络请求失败',
        };

        wx.showToast({
          title: error.message,
          icon: 'none',
        });

        reject(error);
      },
    });
  });
};
