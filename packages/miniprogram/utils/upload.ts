import { API_BASE_URL } from './request';

interface UploadOptions {
  url: string;
  filePath: string;
  name: string;
  formData?: WechatMiniprogram.IAnyObject;
}

export const uploadFile = (
  options: UploadOptions,
): Promise<WechatMiniprogram.UploadFileSuccessCallbackResult> => {
  const token = wx.getStorageSync('token');
  const header: WechatMiniprogram.IAnyObject = {};
  if (token) {
    header.Authorization = `Bearer ${token}`;
  }

  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: `${API_BASE_URL}${options.url}`,
      filePath: options.filePath,
      name: options.name,
      header,
      formData: options.formData,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res);
          return;
        }
        wx.showToast({ title: '上传失败', icon: 'none' });
        reject(new Error(`上传失败: ${res.statusCode}`));
      },
      fail: (err) => {
        wx.showToast({ title: '上传网络错误', icon: 'none' });
        reject(err);
      },
    });
  });
};
