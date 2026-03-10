/**
 * 小程序全局类型定义
 */
interface AppUserInfo {
  id: number;
  nickname: string;
  avatar: string;
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
    fontSizeLevel?: 'small' | 'medium' | 'large';
  };
  userInfoReadyCallback?: WechatMiniprogram.UserInfoReadyCallback;
  registerUpdateManager?: () => void;
}
