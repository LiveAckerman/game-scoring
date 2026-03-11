import {
  getAccessToken,
  getGuestToken,
  promptGuestNickname,
  saveActorIdentity,
} from '../../utils/identity';
import { fontSizeBehavior } from '../../behaviors/font-size';
import { RequestError } from '../../utils/request';
import {
  getRoomByCode,
  getRoomInvitePreview,
  joinRoom,
  RoomInvitePreviewMember,
  RoomStatus,
  RoomType,
} from '../../utils/room';
import { buildRoomPageUrl, safeDecodeInviteParam } from '../../utils/invite-entry';

const ROOM_CODE_LENGTH = 6;

interface InviteMemberView {
  id: number;
  nickname: string;
  avatar: string;
  avatarInitials: string;
  isOwner: boolean;
}

Page({
  behaviors: [fontSizeBehavior],
  data: {
    roomCode: '',
    roomName: '好友牌桌',
    roomType: 'MULTI' as RoomType,
    roomTypeText: '多人记分',
    roomTypeClass: 'type-multi',
    roomStatus: 'IN_PROGRESS' as RoomStatus,
    roomStatusText: '进行中',
    inviterName: '好友',
    inviterInitials: '友',
    previewMembers: [] as InviteMemberView[],
    displayMemberCount: 0,
    extraMemberCount: 0,
    primaryActionText: '确认加入',
    primaryActionDisabled: false,
    roomExists: true,
    alreadyJoined: false,
    loading: true,
    joining: false,
    loadErrorText: '',
  },

  onLoad(options: Record<string, string | undefined>) {
    const roomCode = String(options.roomCode || '').replace(/\D/g, '').slice(0, ROOM_CODE_LENGTH);
    const inviterName = safeDecodeInviteParam(options.inviterName) || '好友';
    const roomName = safeDecodeInviteParam(options.roomName) || (roomCode ? `桌号 ${roomCode}` : '好友牌桌');
    const roomTypeRaw = String(options.roomType || '').trim();
    const roomType = roomTypeRaw === 'SINGLE' || roomTypeRaw === 'POOL' || roomTypeRaw === 'MULTI'
      ? roomTypeRaw
      : 'MULTI';

    this.setData(this.buildInviteState({
      roomCode,
      inviterName,
      inviterInitials: this.buildInitials(inviterName),
      roomName,
      roomType: roomType as RoomType,
      loading: true,
      roomExists: true,
      alreadyJoined: false,
      loadErrorText: '',
    }));

    void this.loadInviteInfo();
  },

  async loadInviteInfo() {
    const roomCode = this.data.roomCode;
    if (!/^\d{6}$/.test(roomCode)) {
      this.setData(this.buildInviteState({
        loading: false,
        roomExists: false,
        loadErrorText: '邀请链接缺少有效房间号',
      }));
      return;
    }

    try {
      const previewPayload = await getRoomInvitePreview(roomCode);
      this.applyInvitePreview(previewPayload.room);
    } catch (error) {
      const requestError = error as RequestError;
      this.setData(this.buildInviteState({
        loading: false,
        roomExists: false,
        loadErrorText: requestError.message || '邀请信息加载失败',
      }));
      return;
    }

    if (!getAccessToken() && !getGuestToken()) {
      this.setData(this.buildInviteState({ loading: false }));
      return;
    }

    try {
      const payload = await getRoomByCode(roomCode);
      this.applyInvitePreview(payload.room, true);
    } catch (error) {
      const requestError = error as RequestError;
      if (requestError.statusCode !== 401 && requestError.statusCode !== 403) {
        this.setData(this.buildInviteState({ loading: false }));
        return;
      }
    }

    this.setData(this.buildInviteState({ loading: false }));
  },

  applyInvitePreview(
    room: {
      roomCode: string;
      roomName: string;
      roomType: RoomType;
      status: RoomStatus;
      members: Array<RoomInvitePreviewMember | any>;
      memberCount?: number;
    },
    alreadyJoined = false,
  ) {
    const visibleMembers = (room.members || [])
      .filter((member) => !(member.actorType === 'VIRTUAL' && member.nickname === '台板'))
      .filter((member) => !member.isSpectator)
      .map((member) => ({
        id: member.id,
        nickname: member.nickname,
        avatar: member.avatar,
        avatarInitials: member.avatarInitials,
        isOwner: Boolean(member.isOwner),
      }));

    const previewMembers = visibleMembers.slice(0, 5);
    const displayMemberCount = visibleMembers.length || Number(room.memberCount || 0);
    const extraMemberCount = Math.max(displayMemberCount - previewMembers.length, 0);

    this.setData(this.buildInviteState({
      roomExists: true,
      alreadyJoined,
      roomCode: room.roomCode,
      roomName: room.roomName || `桌号 ${room.roomCode}`,
      roomType: room.roomType,
      roomStatus: room.status,
      previewMembers,
      displayMemberCount,
      extraMemberCount,
      loadErrorText: '',
    }));
  },

  buildInviteState(overrides: Record<string, unknown>) {
    const nextState = {
      ...this.data,
      ...overrides,
    } as {
      roomType: RoomType;
      roomStatus: RoomStatus;
      inviterName: string;
      alreadyJoined: boolean;
      roomExists: boolean;
      joining: boolean;
    };

    let primaryActionText = '确认加入';
    let primaryActionDisabled = false;

    if (!nextState.roomExists) {
      primaryActionText = '邀请已失效';
      primaryActionDisabled = true;
    } else if (nextState.roomStatus === 'ENDED' && !nextState.alreadyJoined) {
      primaryActionText = '房间已结束';
      primaryActionDisabled = true;
    } else if (nextState.alreadyJoined) {
      primaryActionText = nextState.roomStatus === 'ENDED' ? '查看房间' : '进入房间';
    } else if (nextState.joining) {
      primaryActionText = '加入中...';
    }

    return {
      ...overrides,
      roomTypeText: this.getRoomTypeText(nextState.roomType),
      roomTypeClass: this.getRoomTypeClass(nextState.roomType),
      roomStatusText: nextState.roomStatus === 'ENDED' ? '已结束' : '进行中',
      inviterInitials: this.buildInitials(nextState.inviterName),
      primaryActionText,
      primaryActionDisabled,
    };
  },

  getRoomTypeText(roomType: RoomType) {
    if (roomType === 'SINGLE') {
      return '单人记分';
    }
    if (roomType === 'POOL') {
      return '分数池';
    }
    return '多人记分';
  },

  getRoomTypeClass(roomType: RoomType) {
    if (roomType === 'SINGLE') {
      return 'type-single';
    }
    if (roomType === 'POOL') {
      return 'type-pool';
    }
    return 'type-multi';
  },

  buildInitials(value: string) {
    const normalized = String(value || '').trim();
    if (!normalized) {
      return '友';
    }
    return normalized.slice(0, 1).toUpperCase();
  },

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack();
      return;
    }
    wx.switchTab({ url: '/pages/home/home' });
  },

  async handleConfirmJoin() {
    if (this.data.primaryActionDisabled || this.data.joining) {
      return;
    }

    if (this.data.alreadyJoined) {
      wx.redirectTo({
        url: buildRoomPageUrl(this.data.roomCode, this.data.roomType),
      });
      return;
    }

    let guestNickname: string | undefined;
    if (!getAccessToken() && !getGuestToken()) {
      const inputNickname = await promptGuestNickname('游客昵称', '请输入昵称后加入房间');
      if (!inputNickname) {
        wx.showToast({ title: '已取消加入房间', icon: 'none' });
        return;
      }
      guestNickname = inputNickname;
    }

    this.setData(this.buildInviteState({ joining: true }));
    wx.showLoading({ title: '加入中...' });
    let redirected = false;

    try {
      const payload = await joinRoom(this.data.roomCode, guestNickname);
      saveActorIdentity(payload.actor);
      redirected = true;
      wx.redirectTo({
        url: buildRoomPageUrl(payload.room.roomCode, payload.room.roomType),
      });
    } catch (error) {
      const requestError = error as RequestError;
      wx.showToast({
        title: requestError.message || '加入房间失败',
        icon: 'none',
      });
    } finally {
      wx.hideLoading();
      if (!redirected) {
        this.setData(this.buildInviteState({ joining: false }));
      }
    }
  },
});
