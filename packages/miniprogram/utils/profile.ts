import { getAccessToken } from './identity';

export const PROFILE_SETUP_PAGE = '/subpkg/profile-edit/profile-edit?mode=onboarding';

export const getStoredUserInfo = (): AppUserInfo | null => {
  const app = getApp<IAppOption>();
  const fromGlobal = app.globalData.userInfo;
  if (fromGlobal?.id) {
    return fromGlobal;
  }

  const fromStorage = wx.getStorageSync('userInfo') as AppUserInfo | undefined;
  if (fromStorage?.id) {
    return fromStorage;
  }

  return null;
};

export const saveUserInfo = (userInfo: AppUserInfo): void => {
  wx.setStorageSync('userInfo', userInfo);
  const app = getApp<IAppOption>();
  app.globalData.userInfo = userInfo;
};

export const shouldForceProfileSetup = (): boolean => {
  if (!getAccessToken()) {
    return false;
  }

  const userInfo = getStoredUserInfo();
  if (!userInfo) {
    return false;
  }

  return userInfo.profileSetupCompleted === false;
};

export const relaunchProfileSetup = (): void => {
  wx.reLaunch({
    url: PROFILE_SETUP_PAGE,
  });
};
