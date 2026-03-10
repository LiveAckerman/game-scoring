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

export const getAccessToken = (): string => {
  return wx.getStorageSync('token') || '';
};

export const getGuestToken = (): string => {
  return wx.getStorageSync(GUEST_TOKEN_KEY) || '';
};

export const getGuestProfile = (): GuestProfile | null => {
  const profile = wx.getStorageSync(GUEST_PROFILE_KEY);
  if (!profile || typeof profile !== 'object') {
    return null;
  }

  const { id, nickname, avatarInitials } = profile as GuestProfile;
  if (!id || !nickname) {
    return null;
  }

  return {
    id,
    nickname,
    avatarInitials: avatarInitials || '游客',
  };
};

export const getDeviceId = (): string => {
  const cached = String(wx.getStorageSync(DEVICE_ID_KEY) || '').trim();
  if (cached) {
    return cached;
  }

  const nextId = `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  wx.setStorageSync(DEVICE_ID_KEY, nextId);
  return nextId;
};

export const saveActorIdentity = (actor?: ActorPayload): void => {
  if (!actor || actor.type !== 'GUEST') {
    return;
  }

  if (actor.guestToken) {
    wx.setStorageSync(GUEST_TOKEN_KEY, actor.guestToken);
  }

  wx.setStorageSync(GUEST_PROFILE_KEY, {
    id: actor.id,
    nickname: actor.nickname,
    avatarInitials: actor.avatarInitials,
  } as GuestProfile);
};

export const clearGuestIdentity = (): void => {
  wx.removeStorageSync(GUEST_TOKEN_KEY);
  wx.removeStorageSync(GUEST_PROFILE_KEY);
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
