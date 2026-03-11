import { getAccessToken, getGuestToken, saveActorIdentity } from '../../utils/identity';
import { RequestError } from '../../utils/request';
import { createRoom, getRoomHistory, joinRoom, RoomHistoryItem } from '../../utils/room';
import { fontSizeBehavior } from '../../behaviors/font-size';
import { buildInviteEntryUrl, safeDecodeInviteParam } from '../../utils/invite-entry';
import { buildRoomTagMap, RoomTag } from '../../utils/tags';

interface HomePreviewMember {
  id: number;
  nickname: string;
  avatar: string;
  avatarInitials: string;
  score: number;
  isOwner: boolean;
}

interface HomeRecentCard {
  roomId: number;
  roomCode: string;
  roomType: 'MULTI' | 'SINGLE' | 'POOL';
  status: 'IN_PROGRESS' | 'ENDED';
  statusText: string;
  timeText: string;
  durationText: string;
  myScoreText: string;
  previewMembers: HomePreviewMember[];
  tags: RoomTag[];
}

interface OngoingRoomCardView {
  roomId: number;
  roomCode: string;
  roomType: 'MULTI' | 'SINGLE' | 'POOL';
  status: 'IN_PROGRESS' | 'ENDED';
  statusText: string;
  members: HomePreviewMember[];
}

interface InputDialogOptions {
  title: string;
  tip: string;
  placeholder: string;
  confirmText: string;
  defaultValue?: string;
  required?: boolean;
}

let inputDialogResolver: ((value: string | null) => void) | null = null;
const ROOM_HISTORY_CACHE_MS = 30 * 1000;
const SHARE_PROMO_IMAGE = '/assets/images/share-promo.jpg';

Page({
  behaviors: [fontSizeBehavior],
  data: {
    creatingRoom: false,
    historyLoading: false,
    recentRooms: [] as HomeRecentCard[],
    joinDialogVisible: false,
    joinRoomCode: '',
    joinCodeDigits: ['', '', '', '', '', ''],
    joinCodeFocus: false,
    joiningRoom: false,
    autoJoinTriedCode: '',
    ongoingDialogVisible: false,
    ongoingRooms: [] as OngoingRoomCardView[],
    ongoingReachedLimit: false,
    pendingGuestNickname: '',
    pendingRoomType: 'MULTI' as 'MULTI' | 'SINGLE' | 'POOL',
    inputDialogVisible: false,
    inputDialogTitle: '',
    inputDialogTip: '',
    inputDialogPlaceholder: '',
    inputDialogConfirmText: '确定',
    inputDialogValue: '',
    inputDialogRequired: false,
  },

  onLoad(options: Record<string, string | undefined>) {
    this.enableShareMenus();
    this.handleShareRoomEntry(options);
  },

  onShow() {
    (this as any)._applyFontSize();
    this.loadRecentRooms({ useCache: true });
  },

  onHide() {
    this.resolveInputDialog(null);
  },

  async loadRecentRooms(options: { force?: boolean; useCache?: boolean } = {}) {
    const page = this as any;
    if (!getAccessToken() && !getGuestToken()) {
      page._recentRoomsLoadedAt = 0;
      page._recentRoomsHasLoaded = false;
      page._recentRoomsPromise = null;
      if (this.data.recentRooms.length > 0) {
        this.setData({ recentRooms: [] });
      }
      return;
    }

    const canUseCache = options.useCache
      && page._recentRoomsHasLoaded
      && Date.now() - Number(page._recentRoomsLoadedAt || 0) < ROOM_HISTORY_CACHE_MS;
    if (!options.force && canUseCache) {
      return;
    }

    if (page._recentRoomsPromise) {
      return page._recentRoomsPromise;
    }

    if (!this.data.historyLoading) {
      this.setData({ historyLoading: true });
    }

    page._recentRoomsPromise = (async () => {
      try {
        const payload = await getRoomHistory({ page: 1, pageSize: 5, status: 'ALL' });
        const tagMap = buildRoomTagMap(payload.items.map((item) => item.roomCode));
        const recentRooms = payload.items.map((item) => this.mapRoomToCard(item, tagMap[item.roomCode] || []));
        this.setData({ recentRooms });
        page._recentRoomsHasLoaded = true;
        page._recentRoomsLoadedAt = Date.now();
      } catch (error) {
        const requestError = error as RequestError;
        if (requestError.statusCode !== 401) {
          wx.showToast({
            title: requestError.message || '加载最近记录失败',
            icon: 'none',
          });
        }
        page._recentRoomsHasLoaded = false;
        page._recentRoomsLoadedAt = 0;
        this.setData({ recentRooms: [] });
      } finally {
        page._recentRoomsPromise = null;
        if (this.data.historyLoading) {
          this.setData({ historyLoading: false });
        }
      }
    })();

    return page._recentRoomsPromise;
  },

  async startMultiMode() {
    if (this.data.creatingRoom) {
      return;
    }

    const hasIdentity = Boolean(getAccessToken() || getGuestToken());
    let guestNickname: string | undefined;

    if (!hasIdentity) {
      const inputNickname = await this.openInputDialog({
        title: '游客昵称',
        tip: '创建房间前，请先输入昵称',
        placeholder: '请输入昵称',
        confirmText: '继续',
        required: true,
      });
      if (!inputNickname) {
        return;
      }
      guestNickname = inputNickname;
    }

    const hasOngoing = await this.checkOngoingRooms('MULTI', guestNickname);
    if (hasOngoing) {
      return;
    }

    await this.createNewRoom(guestNickname);
  },

  openJoinDialog() {
    this.setData({
      joinDialogVisible: true,
      joinRoomCode: '',
      joinCodeDigits: ['', '', '', '', '', ''],
      joinCodeFocus: true,
      autoJoinTriedCode: '',
    });
  },

  closeJoinDialog() {
    this.setData({
      joinDialogVisible: false,
      joinCodeFocus: false,
      autoJoinTriedCode: '',
    });
  },

  focusJoinCodeInput() {
    this.setData({ joinCodeFocus: true });
  },

  onJoinCodeInput(e: WechatMiniprogram.CustomEvent) {
    const value = String((e.detail as { value?: string }).value || '')
      .replace(/\D/g, '')
      .slice(0, 6);
    const codeDigits = Array.from({ length: 6 }, (_, index) => value[index] || '');
    this.setData({
      joinRoomCode: value,
      joinCodeDigits: codeDigits,
      joinCodeFocus: value.length < 6,
      autoJoinTriedCode: value.length < 6 ? '' : this.data.autoJoinTriedCode,
    }, () => {
      if (value.length !== 6) {
        return;
      }

      if (this.data.joiningRoom) {
        return;
      }

      if (this.data.autoJoinTriedCode === value) {
        return;
      }

      this.setData({ autoJoinTriedCode: value });
      this.attemptJoinRoom(value, 'auto');
    });
  },

  onJoinCodeBlur() {
    this.setData({ joinCodeFocus: false });
  },

  async confirmJoinRoom() {
    await this.attemptJoinRoom(this.data.joinRoomCode, 'manual');
  },

  async attemptJoinRoom(roomCodeRaw: string, trigger: 'manual' | 'auto') {
    if (this.data.joiningRoom) {
      return;
    }

    const roomCode = String(roomCodeRaw || '').replace(/\D/g, '').slice(0, 6);
    if (roomCode.length !== 6) {
      if (trigger === 'manual') {
        wx.showToast({ title: '请输入6位房间号', icon: 'none' });
        this.setData({ joinCodeFocus: true });
      }
      return;
    }

    let guestNickname: string | undefined;
    if (!getAccessToken() && !getGuestToken()) {
      const inputNickname = await this.openInputDialog({
        title: '游客昵称',
        tip: '加入房间前，请先输入昵称',
        placeholder: '请输入昵称',
        confirmText: '继续',
        required: true,
      });
      if (!inputNickname) {
        if (trigger === 'manual') {
          wx.showToast({ title: '已取消加入', icon: 'none' });
        }
        return;
      }
      guestNickname = inputNickname;
    }

    this.setData({ joiningRoom: true });
    wx.showLoading({ title: '加入中...' });
    try {
      const payload = await joinRoom(roomCode, guestNickname);
      saveActorIdentity(payload.actor);
      this.closeJoinDialog();
      wx.navigateTo({
        url: `/subpkg/multi-invite/multi-invite?roomCode=${payload.room.roomCode}`,
      });
    } catch (error) {
      const requestError = error as RequestError;
      wx.showToast({
        title: requestError.message || '加入房间失败',
        icon: 'none',
      });
    } finally {
      wx.hideLoading();
      this.setData({ joiningRoom: false });
    }
  },

  handleShareRoomEntry(options: Record<string, string | undefined>) {
    const shareRoomCode = String(options.roomCode || '').replace(/\D/g, '').slice(0, 6);
    if (!/^\d{6}$/.test(shareRoomCode)) {
      return;
    }

    const roomType = String(options.roomType || '').trim();
    const normalizedRoomType = roomType === 'SINGLE' || roomType === 'POOL' || roomType === 'MULTI'
      ? roomType
      : 'MULTI';

    wx.navigateTo({
      url: buildInviteEntryUrl({
        roomCode: shareRoomCode,
        inviterName: safeDecodeInviteParam(options.inviterName),
        roomName: safeDecodeInviteParam(options.roomName),
        roomType: normalizedRoomType as 'MULTI' | 'SINGLE' | 'POOL',
        shareSource: options.shareSource,
      }),
    });
  },

  enableShareMenus() {
    wx.showShareMenu({
      withShareTicket: true,
      menus: ['shareAppMessage', 'shareTimeline'],
    });
  },

  onShareAppMessage() {
    return {
      title: '欢乐记分馆',
      path: '/pages/home/home',
      imageUrl: SHARE_PROMO_IMAGE,
    };
  },

  onShareTimeline() {
    return {
      title: '欢乐记分馆',
      query: '',
      imageUrl: SHARE_PROMO_IMAGE,
    };
  },

  closeOngoingDialog() {
    this.setData({
      ongoingDialogVisible: false,
      ongoingRooms: [],
      ongoingReachedLimit: false,
      pendingGuestNickname: '',
      pendingRoomType: 'MULTI',
    });
  },

  async handleCreateNewRoomFromDialog() {
    const guestNickname = this.data.pendingGuestNickname || undefined;
    const roomType = this.data.pendingRoomType;
    this.closeOngoingDialog();

    if (roomType === 'SINGLE') {
      await this.doCreateSingleRoom(guestNickname);
    } else if (roomType === 'POOL') {
      await this.doCreatePoolRoom(guestNickname);
    } else {
      await this.createNewRoom(guestNickname);
    }
  },

  enterOngoingRoom(e: WechatMiniprogram.BaseEvent) {
    const roomCode = String(e.currentTarget.dataset.roomCode || '');
    const roomType = String(e.currentTarget.dataset.roomType || 'MULTI');
    if (!roomCode) {
      return;
    }

    this.closeOngoingDialog();

    let page: string;
    if (roomType === 'SINGLE') {
      page = `/subpkg/single-score/single-score?roomCode=${roomCode}`;
    } else {
      page = `/subpkg/multi-invite/multi-invite?roomCode=${roomCode}`;
    }
    wx.navigateTo({ url: page });
  },

  async createNewRoom(guestNickname?: string) {
    const inputRoomName = await this.openInputDialog({
      title: '房间名称',
      tip: '可选填写房间名称，不填将使用默认名称',
      placeholder: '请输入房间名称（可选）',
      confirmText: '创建房间',
      required: false,
    });
    if (inputRoomName === null) {
      return;
    }

    const roomName = inputRoomName.trim();

    this.setData({ creatingRoom: true });
    wx.showLoading({ title: '创建房间中...' });

    try {
      const payload = await createRoom(guestNickname, roomName || undefined);
      saveActorIdentity(payload.actor);
      wx.navigateTo({
        url: `/subpkg/multi-invite/multi-invite?roomCode=${payload.room.roomCode}`,
      });
    } catch (error) {
      wx.showToast({
        title: (error as RequestError).message || '创建房间失败',
        icon: 'none',
      });
    } finally {
      wx.hideLoading();
      this.setData({ creatingRoom: false });
    }
  },

  openInputDialog(options: InputDialogOptions): Promise<string | null> {
    if (inputDialogResolver) {
      inputDialogResolver(null);
      inputDialogResolver = null;
    }

    this.setData({
      inputDialogVisible: true,
      inputDialogTitle: options.title,
      inputDialogTip: options.tip,
      inputDialogPlaceholder: options.placeholder,
      inputDialogConfirmText: options.confirmText,
      inputDialogValue: options.defaultValue || '',
      inputDialogRequired: Boolean(options.required),
    });

    return new Promise((resolve) => {
      inputDialogResolver = resolve;
    });
  },

  onInputDialogInput(e: WechatMiniprogram.CustomEvent) {
    const value = String((e.detail as { value?: string }).value || '').slice(0, 64);
    this.setData({ inputDialogValue: value });
  },

  cancelInputDialog() {
    this.resolveInputDialog(null);
  },

  confirmInputDialog() {
    const value = String(this.data.inputDialogValue || '').trim();
    if (this.data.inputDialogRequired && !value) {
      wx.showToast({ title: '请输入内容', icon: 'none' });
      return;
    }

    this.resolveInputDialog(value);
  },

  resolveInputDialog(value: string | null) {
    const resolver = inputDialogResolver;
    inputDialogResolver = null;

    this.setData({
      inputDialogVisible: false,
      inputDialogTitle: '',
      inputDialogTip: '',
      inputDialogPlaceholder: '',
      inputDialogConfirmText: '确定',
      inputDialogValue: '',
      inputDialogRequired: false,
    });

    if (resolver) {
      resolver(value);
    }
  },

  async startSingleMode() {
    if (this.data.creatingRoom) {
      return;
    }

    const hasIdentity = Boolean(getAccessToken() || getGuestToken());
    let guestNickname: string | undefined;

    if (!hasIdentity) {
      const inputNickname = await this.openInputDialog({
        title: '游客昵称',
        tip: '创建房间前，请先输入昵称',
        placeholder: '请输入昵称',
        confirmText: '继续',
        required: true,
      });
      if (!inputNickname) {
        return;
      }
      guestNickname = inputNickname;
    }

    const hasOngoing = await this.checkOngoingRooms('SINGLE', guestNickname);
    if (hasOngoing) {
      return;
    }

    await this.doCreateSingleRoom(guestNickname);
  },

  async doCreateSingleRoom(guestNickname?: string) {
    this.setData({ creatingRoom: true });
    wx.showLoading({ title: '创建房间中...' });

    try {
      const payload = await createRoom(guestNickname, '单人记分', 'SINGLE');
      saveActorIdentity(payload.actor);
      wx.navigateTo({
        url: `/subpkg/single-score/single-score?roomCode=${payload.room.roomCode}`,
      });
    } catch (error) {
      wx.showToast({
        title: (error as RequestError).message || '创建房间失败',
        icon: 'none',
      });
    } finally {
      wx.hideLoading();
      this.setData({ creatingRoom: false });
    }
  },

  async startPoolMode() {
    if (this.data.creatingRoom) {
      return;
    }

    const hasIdentity = Boolean(getAccessToken() || getGuestToken());
    let guestNickname: string | undefined;

    if (!hasIdentity) {
      const inputNickname = await this.openInputDialog({
        title: '游客昵称',
        tip: '创建分数池房间前，请先输入昵称',
        placeholder: '请输入昵称',
        confirmText: '继续',
        required: true,
      });
      if (!inputNickname) {
        return;
      }
      guestNickname = inputNickname;
    }

    const hasOngoing = await this.checkOngoingRooms('POOL', guestNickname);
    if (hasOngoing) {
      return;
    }

    await this.doCreatePoolRoom(guestNickname);
  },

  async doCreatePoolRoom(guestNickname?: string) {
    this.setData({ creatingRoom: true });
    wx.showLoading({ title: '创建房间中...' });

    try {
      const payload = await createRoom(guestNickname, '分数池', 'POOL');
      saveActorIdentity(payload.actor);
      wx.navigateTo({
        url: `/subpkg/multi-invite/multi-invite?roomCode=${payload.room.roomCode}`,
      });
    } catch (error) {
      wx.showToast({
        title: (error as RequestError).message || '创建房间失败',
        icon: 'none',
      });
    } finally {
      wx.hideLoading();
      this.setData({ creatingRoom: false });
    }
  },

  async checkOngoingRooms(
    roomType: 'MULTI' | 'SINGLE' | 'POOL',
    guestNickname?: string,
  ): Promise<boolean> {
    const hasIdentity = Boolean(getAccessToken() || getGuestToken());
    if (!hasIdentity) {
      return false;
    }

    wx.showLoading({ title: '检查进行中对局...' });
    try {
      const payload = await getRoomHistory({
        page: 1,
        pageSize: 3,
        status: 'IN_PROGRESS',
        roomType,
      });

      if (payload.items.length > 0) {
        this.setData({
          ongoingDialogVisible: true,
          ongoingRooms: payload.items.map((item) => this.mapOngoingRoomCard(item)),
          ongoingReachedLimit: payload.pagination.total >= 3,
          pendingGuestNickname: guestNickname || '',
          pendingRoomType: roomType,
        });
        return true;
      }
    } catch (error) {
      const requestError = error as RequestError;
      if (requestError.statusCode !== 401) {
        wx.showToast({
          title: requestError.message || '检查进行中对局失败',
          icon: 'none',
        });
      }
    } finally {
      wx.hideLoading();
    }
    return false;
  },

  viewAllRecords() {
    wx.switchTab({ url: '/pages/records/records' });
  },

  openRecentRoom(e: WechatMiniprogram.BaseEvent) {
    const roomCode = String(e.currentTarget.dataset.roomCode || '');
    const roomType = String(e.currentTarget.dataset.roomType || 'MULTI');

    if (!roomCode) {
      return;
    }

    let page: string;
    if (roomType === 'SINGLE') {
      page = `/subpkg/single-score/single-score?roomCode=${roomCode}`;
    } else {
      page = `/subpkg/multi-invite/multi-invite?roomCode=${roomCode}`;
    }

    wx.navigateTo({ url: page });
  },

  mapRoomToCard(item: RoomHistoryItem, tags: RoomTag[]): HomeRecentCard {
    const startedDate = new Date(item.startedAt);
    const month = startedDate.getMonth() + 1;
    const day = startedDate.getDate();
    const hour = startedDate.getHours();
    const minute = startedDate.getMinutes();

    const timeText = `${month}月${day}日 ${this.pad2(hour)}:${this.pad2(minute)}`;

    return {
      roomId: item.roomId,
      roomCode: item.roomCode,
      roomType: item.roomType || 'MULTI',
      status: item.status,
      statusText: item.status === 'IN_PROGRESS' ? '进行中' : '已结束',
      timeText,
      durationText: `${item.durationMinutes} 分钟`,
      myScoreText: `${item.myScore > 0 ? '+' : ''}${item.myScore}`,
      previewMembers: item.members.map((member) => ({
        id: member.id,
        nickname: member.nickname,
        avatar: member.avatar,
        avatarInitials: member.avatarInitials,
        score: member.score,
        isOwner: member.isOwner,
      })),
      tags,
    };
  },

  mapOngoingRoomCard(item: RoomHistoryItem): OngoingRoomCardView {
    return {
      roomId: item.roomId,
      roomCode: item.roomCode,
      roomType: item.roomType || 'MULTI',
      status: item.status,
      statusText: item.status === 'IN_PROGRESS' ? '进行中' : '已结束',
      members: item.members.map((member) => ({
        id: member.id,
        nickname: member.nickname,
        avatar: member.avatar,
        avatarInitials: member.avatarInitials,
        score: member.score,
        isOwner: member.isOwner,
      })),
    };
  },

  pad2(value: number): string {
    if (value < 10) {
      return `0${value}`;
    }
    return `${value}`;
  },
});
