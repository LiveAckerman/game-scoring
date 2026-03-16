import { getAccessToken, getDeviceId, getGuestToken } from './identity';
import { readRuntimeEnvVersion, RuntimeEnvVersion } from './runtime-env';

const API_BASE_URL_MAP: Record<RuntimeEnvVersion, string> = {
  develop: 'http://192.168.110.79:9090/api/v1',
  trial: 'https://jf.leviackerman.site/api/v1',
  release: 'https://jf.leviackerman.site/api/v1',
  unknown: 'http://192.168.110.79:9090/api/v1',
};

export const API_BASE_URL = API_BASE_URL_MAP[readRuntimeEnvVersion()];

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

export const buildRequestHeader = (
  extraHeader?: WechatMiniprogram.IAnyObject,
): WechatMiniprogram.IAnyObject => {
  const token = getAccessToken();
  const guestToken = getGuestToken();

  const header: WechatMiniprogram.IAnyObject = {
    'x-device-id': getDeviceId(),
    ...extraHeader,
  };

  if (token) {
    header.Authorization = `Bearer ${token}`;
  }

  if (guestToken) {
    header['x-guest-token'] = guestToken;
  }

  return header;
};

export const request = <T = unknown>(options: RequestOptions): Promise<T> => {
  const header = buildRequestHeader(options.header);

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
