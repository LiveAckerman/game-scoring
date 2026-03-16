/**
 * 小程序全局类型定义
 */
interface AppUserInfo {
  id: number;
  nickname: string;
  avatar: string;
  profileSetupCompleted: boolean;
  gender: number;
  title: string;
  totalGames: number;
  wins: number;
}

interface AppGuestProfile {
  id: number;
  nickname: string;
  avatarInitials: string;
}

interface IAppOption {
  globalData: {
    userInfo?: AppUserInfo | null;
    guestProfile?: AppGuestProfile | null;
    token?: string;
    guestToken?: string;
    deviceId?: string;
    fontSizeLevel?: 'small' | 'medium' | 'large';
    statusBarHeight?: number;
  };
  userInfoReadyCallback?: WechatMiniprogram.UserInfoReadyCallback;
  registerUpdateManager?: () => void;
}
