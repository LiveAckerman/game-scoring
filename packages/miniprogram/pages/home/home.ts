import { getAccessToken, getGuestToken, saveActorIdentity } from '../../utils/identity';
import { RequestError } from '../../utils/request';
import { createRoom, getRoomHistory, joinRoom, RoomHistoryItem } from '../../utils/room';

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
  status: 'IN_PROGRESS' | 'ENDED';
  statusText: string;
  timeText: string;
  durationText: string;
  myScoreText: string;
  previewMembers: HomePreviewMember[];
}

interface OngoingRoomOption {
  roomCode: string;
  memberCount: number;
  durationMinutes: number;
  timeText: string;
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

Page({
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
    ongoingRooms: [] as OngoingRoomOption[],
    pendingGuestNickname: '',
    inputDialogVisible: false,
    inputDialogTitle: '',
    inputDialogTip: '',
    inputDialogPlaceholder: '',
    inputDialogConfirmText: '确定',
    inputDialogValue: '',
    inputDialogRequired: false,
  },

  onShow() {
    this.loadRecentRooms();
  },

  onHide() {
    this.resolveInputDialog(null);
  },

  async loadRecentRooms() {
    if (!getAccessToken() && !getGuestToken()) {
      this.setData({ recentRooms: [] });
      return;
    }

    this.setData({ historyLoading: true });

    try {
      const payload = await getRoomHistory({ page: 1, pageSize: 5, status: 'ALL' });
      const recentRooms = payload.items.map((item) => this.mapRoomToCard(item));
      this.setData({ recentRooms });
    } catch (error) {
      const requestError = error as RequestError;
      if (requestError.statusCode !== 401) {
        wx.showToast({
          title: requestError.message || '加载最近记录失败',
          icon: 'none',
        });
      }
      this.setData({ recentRooms: [] });
    } finally {
      this.setData({ historyLoading: false });
    }
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

    if (hasIdentity) {
      wx.showLoading({ title: '检查进行中对局...' });
      try {
        const payload = await getRoomHistory({
          page: 1,
          pageSize: 20,
          status: 'IN_PROGRESS',
        });

        if (payload.items.length > 0) {
          this.setData({
            ongoingDialogVisible: true,
            ongoingRooms: payload.items.map((item) => this.mapOngoingRoom(item)),
            pendingGuestNickname: guestNickname || '',
          });
          return;
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
      if (requestError.statusCode === 401) {
        wx.showToast({
          title: requestError.message || '加入房间失败',
          icon: 'none',
        });
      }
    } finally {
      wx.hideLoading();
      this.setData({ joiningRoom: false });
    }
  },

  closeOngoingDialog() {
    this.setData({
      ongoingDialogVisible: false,
      ongoingRooms: [],
      pendingGuestNickname: '',
    });
  },

  async handleCreateNewRoomFromDialog() {
    const guestNickname = this.data.pendingGuestNickname || undefined;
    this.closeOngoingDialog();
    await this.createNewRoom(guestNickname);
  },

  enterOngoingRoom(e: WechatMiniprogram.BaseEvent) {
    const roomCode = String(e.currentTarget.dataset.roomCode || '');
    if (!roomCode) {
      return;
    }

    this.closeOngoingDialog();
    wx.navigateTo({
      url: `/subpkg/multi-invite/multi-invite?roomCode=${roomCode}`,
    });
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

  startSingleMode() {
    wx.showToast({ title: '单人记分功能开发中', icon: 'none' });
  },

  startPoolMode() {
    wx.showToast({ title: '分数池功能开发中', icon: 'none' });
  },

  viewAllRecords() {
    wx.switchTab({ url: '/pages/records/records' });
  },

  openRecentRoom(e: WechatMiniprogram.BaseEvent) {
    const roomCode = String(e.currentTarget.dataset.roomCode || '');

    if (!roomCode) {
      return;
    }

    wx.navigateTo({
      url: `/subpkg/multi-invite/multi-invite?roomCode=${roomCode}`,
    });
  },

  mapRoomToCard(item: RoomHistoryItem): HomeRecentCard {
    const startedDate = new Date(item.startedAt);
    const month = startedDate.getMonth() + 1;
    const day = startedDate.getDate();
    const hour = startedDate.getHours();
    const minute = startedDate.getMinutes();

    const timeText = `${month}月${day}日 ${this.pad2(hour)}:${this.pad2(minute)}`;

    return {
      roomId: item.roomId,
      roomCode: item.roomCode,
      status: item.status,
      statusText: item.status === 'IN_PROGRESS' ? '进行中' : '已结束',
      timeText,
      durationText: `${item.durationMinutes} 分钟`,
      myScoreText: `${item.myScore > 0 ? '+' : ''}${item.myScore}`,
      previewMembers: item.members.slice(0, 2).map((member) => ({
        id: member.id,
        nickname: member.nickname,
        avatar: member.avatar,
        avatarInitials: member.avatarInitials,
        score: member.score,
        isOwner: member.isOwner,
      })),
    };
  },

  mapOngoingRoom(item: RoomHistoryItem): OngoingRoomOption {
    const startedDate = new Date(item.startedAt);
    const month = startedDate.getMonth() + 1;
    const day = startedDate.getDate();
    const hour = startedDate.getHours();
    const minute = startedDate.getMinutes();

    return {
      roomCode: item.roomCode,
      memberCount: item.memberCount,
      durationMinutes: item.durationMinutes,
      timeText: `${month}月${day}日 ${this.pad2(hour)}:${this.pad2(minute)}`,
    };
  },

  pad2(value: number): string {
    if (value < 10) {
      return `0${value}`;
    }
    return `${value}`;
  },
});
