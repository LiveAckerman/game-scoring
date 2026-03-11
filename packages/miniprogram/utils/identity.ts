export interface GuestProfile {
  id: number;
  nickname: string;
  avatarInitials: string;
}

export interface ActorPayload {
  type: 'USER' | 'GUEST' | 'VIRTUAL';
  id: number;
  nickname: string;
  avatarInitials: string;
  guestToken?: string;
}

const GUEST_TOKEN_KEY = 'guestToken';
const GUEST_PROFILE_KEY = 'guestProfile';
const DEVICE_ID_KEY = 'deviceId';

const getGlobalData = (): IAppOption['globalData'] | null => {
  try {
    return getApp<IAppOption>().globalData;
  } catch (_error) {
    return null;
  }
};

export const getAccessToken = (): string => {
  const globalData = getGlobalData();
  const cached = String(globalData?.token || '').trim();
  if (cached) {
    return cached;
  }

  const stored = String(wx.getStorageSync('token') || '').trim();
  if (stored && globalData) {
    globalData.token = stored;
  }
  return stored;
};

export const getGuestToken = (): string => {
  const globalData = getGlobalData();
  const cached = String(globalData?.guestToken || '').trim();
  if (cached) {
    return cached;
  }

  const stored = String(wx.getStorageSync(GUEST_TOKEN_KEY) || '').trim();
  if (stored && globalData) {
    globalData.guestToken = stored;
  }
  return stored;
};

export const getGuestProfile = (): GuestProfile | null => {
  const globalData = getGlobalData();
  if (globalData?.guestProfile?.id && globalData.guestProfile.nickname) {
    return {
      id: globalData.guestProfile.id,
      nickname: globalData.guestProfile.nickname,
      avatarInitials: globalData.guestProfile.avatarInitials || '游客',
    };
  }

  const profile = wx.getStorageSync(GUEST_PROFILE_KEY);
  if (!profile || typeof profile !== 'object') {
    return null;
  }

  const { id, nickname, avatarInitials } = profile as GuestProfile;
  if (!id || !nickname) {
    return null;
  }

  const guestProfile = {
    id,
    nickname,
    avatarInitials: avatarInitials || '游客',
  };

  if (globalData) {
    globalData.guestProfile = guestProfile;
  }

  return guestProfile;
};

export const getDeviceId = (): string => {
  const globalData = getGlobalData();
  const cached = String(globalData?.deviceId || '').trim();
  if (cached) {
    return cached;
  }

  const stored = String(wx.getStorageSync(DEVICE_ID_KEY) || '').trim();
  if (stored) {
    if (globalData) {
      globalData.deviceId = stored;
    }
    return stored;
  }

  const nextId = `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  wx.setStorageSync(DEVICE_ID_KEY, nextId);
  if (globalData) {
    globalData.deviceId = nextId;
  }
  return nextId;
};

export const saveActorIdentity = (actor?: ActorPayload): void => {
  if (!actor || actor.type !== 'GUEST') {
    return;
  }

  if (actor.guestToken) {
    wx.setStorageSync(GUEST_TOKEN_KEY, actor.guestToken);
  }

  const guestProfile: GuestProfile = {
    id: actor.id,
    nickname: actor.nickname,
    avatarInitials: actor.avatarInitials,
  };

  wx.setStorageSync(GUEST_PROFILE_KEY, guestProfile);

  const globalData = getGlobalData();
  if (globalData) {
    if (actor.guestToken) {
      globalData.guestToken = actor.guestToken;
    }
    globalData.guestProfile = guestProfile;
  }
};

export const clearGuestIdentity = (): void => {
  wx.removeStorageSync(GUEST_TOKEN_KEY);
  wx.removeStorageSync(GUEST_PROFILE_KEY);
  const globalData = getGlobalData();
  if (globalData) {
    globalData.guestToken = '';
    globalData.guestProfile = null;
  }
};

export const promptGuestNickname = (
  title = '请输入昵称',
  placeholderText = '请输入你的名字',
): Promise<string | null> => {
  return new Promise((resolve) => {
    wx.showModal({
      title,
      editable: true,
      placeholderText,
      confirmText: '确定',
      cancelText: '取消',
      success: (result: WechatMiniprogram.ShowModalSuccessCallbackResult) => {
        if (!result.confirm) {
          resolve(null);
          return;
        }

        const rawResult = result as WechatMiniprogram.ShowModalSuccessCallbackResult & {
          content?: string;
          value?: string;
          inputValue?: string;
        };
        const content = String(
          rawResult.content ?? rawResult.value ?? rawResult.inputValue ?? '',
        ).trim();

        if (!content) {
          wx.showToast({
            title: '昵称不能为空',
            icon: 'none',
          });
          resolve(null);
          return;
        }

        resolve(content.slice(0, 64));
      },
      fail: () => resolve(null),
    });
  });
};
