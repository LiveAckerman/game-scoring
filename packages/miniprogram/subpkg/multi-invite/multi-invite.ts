import { saveActorIdentity } from '../../utils/identity';
import { buildRoomRealtimeUrl } from '../../utils/realtime';
import { request, RequestError } from '../../utils/request';
import { fontSizeBehavior } from '../../behaviors/font-size';
import {
  addRoomScore,
  endRoom,
  getRoomByCode,
  hideRoomInviteCard,
  RoomMember,
  RoomPayload,
  RoomScoreRecord,
  transferRoomOwner,
  toggleTableFee,
  setSpectators,
  startPoolRound,
  getPoolRound,
} from '../../utils/room';

interface RoomScoreRecordView extends RoomScoreRecord {
  displayTime: string;
}

const ROOM_CODE_LENGTH = 6;
const REALTIME_RECONNECT_BASE_MS = 1000;
const REALTIME_RECONNECT_MAX_MS = 10000;
const REALTIME_HEARTBEAT_MS = 20000;
const SHARE_PROMO_IMAGE = '/assets/images/share-promo.jpg';

interface RealtimeMessage {
  type?: string;
  roomCode?: string;
}

interface RealtimeSendMessage {
  type: string;
  roomCode?: string;
}

let realtimeSocketTask: WechatMiniprogram.SocketTask | null = null;
let realtimeReconnectTimer: number | null = null;
let realtimeHeartbeatTimer: number | null = null;
let realtimeManualClose = false;
let realtimeReconnectAttempt = 0;
let realtimeRefreshing = false;
let realtimeRefreshPending = false;

Page({
  behaviors: [fontSizeBehavior],
  data: {
    topBarTitle: '桌号：------',
    roomId: 0,
    roomCode: '',
    roomStatus: 'IN_PROGRESS' as 'IN_PROGRESS' | 'ENDED',
    codeDigits: ['', '', '', '', '', ''],
    codeFocus: false,
    members: [] as RoomMember[],
    scoreRecords: [] as RoomScoreRecordView[],
    currentMemberId: 0,
    isOwner: false,
    inviteCardHiddenBySelf: false,
    showInlineInviteCard: false,
    invitePopupVisible: false,
    loading: false,
    realtimeConnected: false,
    scoreDialogVisible: false,
    scoreTargetMemberId: 0,
    scoreTargetName: '',
    scoreValue: '',
    isPoolMode: false,
    tableFeeEnabled: false,
    activePoolRound: null as { id: number; roundNumber: number; poolBalance: number; status: string } | null,
    poolRounds: [] as any[],
    poolStatsMembers: [] as any[],
    spectatorDialogVisible: false,
    spectatorCandidates: [] as any[],
    roomType: 'MULTI' as string,
  },

  onLoad(options: Record<string, string | undefined>) {
    this.enableShareMenus();
    this.disconnectRealtime(true);
    const roomCode = (options.roomCode || '').replace(/\D/g, '').slice(0, ROOM_CODE_LENGTH);
    if (roomCode.length === ROOM_CODE_LENGTH) {
      this.setRoomCode(roomCode);
      this.refreshRoomState();
    }
  },

  onShow() {
    (this as any)._applyFontSize();
    this.refreshRoomState(true);
    this.connectRealtime();
  },

  onHide() {
    this.disconnectRealtime(true);
  },

  onUnload() {
    this.disconnectRealtime(true);
  },

  onPullDownRefresh() {
    this.refreshRoomState(true);
  },

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack();
      return;
    }
    wx.switchTab({ url: '/pages/home/home' });
  },

  async refreshRoomState(silent = false) {
    const roomCode = this.data.roomCode;
    if (roomCode.length !== ROOM_CODE_LENGTH) {
      wx.stopPullDownRefresh();
      return;
    }

    if (!silent) {
      wx.showLoading({ title: '加载中...' });
    }

    try {
      const payload = await getRoomByCode(roomCode);
      this.applyRoomPayload(payload);
    } catch (error) {
      const requestError = error as RequestError;
      if (!silent) {
        wx.showToast({
          title: requestError.message || '拉取房间失败',
          icon: 'none',
        });
      }
    } finally {
      if (!silent) {
        wx.hideLoading();
      }
      wx.stopPullDownRefresh();
    }
  },

  onActionTap(e: WechatMiniprogram.BaseEvent) {
    const action = String(e.currentTarget.dataset.action || '');

    if (action === 'invite') {
      this.openInvitePopup();
      return;
    }

    if (action === 'detail') {
      wx.showToast({ title: '明细已展示在下方列表', icon: 'none' });
      return;
    }

    if (action === 'end') {
      this.handleEndRoom();
      return;
    }

    if (action === 'manage') {
      this.openSpectatorDialog();
      return;
    }

    wx.showToast({ title: `${action} 功能开发中`, icon: 'none' });
  },

  openInvitePopup() {
    this.setData({
      invitePopupVisible: true,
      codeFocus: false,
    });
  },

  closeInvitePopup() {
    this.setData({
      invitePopupVisible: false,
      codeFocus: false,
    });
  },

  async handleInlineInviteCardClose() {
    if (!this.data.roomId) {
      this.setData({ showInlineInviteCard: false });
      return;
    }

    wx.showLoading({ title: '处理中...' });
    try {
      const payload = await hideRoomInviteCard(this.data.roomId);
      this.applyRoomPayload(payload);
    } catch (error) {
      wx.showToast({
        title: (error as RequestError).message || '关闭失败',
        icon: 'none',
      });
    } finally {
      wx.hideLoading();
    }
  },

  handleShareInvite() {
    const roomCode = this.data.roomCode;
    if (roomCode.length !== ROOM_CODE_LENGTH) {
      wx.showToast({ title: '房间号为空，无法分享', icon: 'none' });
      return;
    }

    wx.setClipboardData({
      data: roomCode,
      success: () => {
        wx.showToast({ title: `已复制房间号 ${roomCode}，可微信分享`, icon: 'none' });
      },
    });
  },

  enableShareMenus() {
    wx.showShareMenu({
      withShareTicket: true,
      menus: ['shareAppMessage', 'shareTimeline'],
    });
  },

  openScoreDialog(e: WechatMiniprogram.BaseEvent) {
    if (this.data.roomStatus !== 'IN_PROGRESS') {
      wx.showToast({ title: '房间已结束，不能继续记分', icon: 'none' });
      return;
    }

    const targetMemberId = Number(e.currentTarget.dataset.memberId || 0);
    const targetMemberName = String(e.currentTarget.dataset.memberName || '');

    if (!targetMemberId || targetMemberId === this.data.currentMemberId) {
      wx.showToast({ title: '请选择其他玩家', icon: 'none' });
      return;
    }

    this.setData({
      scoreDialogVisible: true,
      scoreTargetMemberId: targetMemberId,
      scoreTargetName: targetMemberName,
      scoreValue: '',
    });
  },

  closeScoreDialog() {
    this.setData({
      scoreDialogVisible: false,
      scoreTargetMemberId: 0,
      scoreTargetName: '',
      scoreValue: '',
    });
  },

  noop() {
    // 用于阻止弹窗内部点击事件冒泡
  },

  onScoreInput(e: WechatMiniprogram.CustomEvent) {
    const rawValue = String((e.detail as { value?: string }).value || '');
    const value = rawValue.replace(/\D/g, '').slice(0, 6);
    this.setData({ scoreValue: value });
  },

  async confirmScore() {
    if (!this.data.roomId) {
      wx.showToast({ title: '房间信息异常', icon: 'none' });
      return;
    }

    const points = Number(this.data.scoreValue || 0);
    if (!Number.isInteger(points) || points <= 0) {
      wx.showToast({ title: '请输入有效分数', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '记分中...' });
    try {
      const payload = await addRoomScore(
        this.data.roomId,
        this.data.scoreTargetMemberId,
        points,
      );
      this.applyRoomPayload(payload);
      this.closeScoreDialog();
      wx.showToast({ title: '记分成功', icon: 'success' });
    } catch (error) {
      wx.showToast({
        title: (error as RequestError).message || '记分失败',
        icon: 'none',
      });
    } finally {
      wx.hideLoading();
    }
  },

  handleTransferOwner(e: WechatMiniprogram.BaseEvent) {
    if (!this.data.isOwner) {
      wx.showToast({ title: '只有桌主可以转移桌主', icon: 'none' });
      return;
    }

    if (this.data.roomStatus !== 'IN_PROGRESS') {
      wx.showToast({ title: '房间已结束，无法转移桌主', icon: 'none' });
      return;
    }

    const targetMemberId = Number(e.currentTarget.dataset.memberId || 0);
    const targetMemberName = String(e.currentTarget.dataset.memberName || '');

    if (!targetMemberId) {
      return;
    }

    wx.showModal({
      title: '转移桌主',
      content: `确认将桌主转移给 ${targetMemberName} 吗？`,
      success: async (res: WechatMiniprogram.ShowModalSuccessCallbackResult) => {
        if (!res.confirm) {
          return;
        }

        wx.showLoading({ title: '转移中...' });
        try {
          const payload = await transferRoomOwner(this.data.roomId, targetMemberId);
          this.applyRoomPayload(payload);
          wx.showToast({ title: '转移成功', icon: 'success' });
        } catch (error) {
          wx.showToast({
            title: (error as RequestError).message || '转移失败',
            icon: 'none',
          });
        } finally {
          wx.hideLoading();
        }
      },
    });
  },

  handleEndRoom() {
    if (!this.data.isOwner) {
      wx.showToast({ title: '只有桌主可以结束房间', icon: 'none' });
      return;
    }

    if (this.data.roomStatus === 'ENDED') {
      wx.showToast({ title: '房间已结束', icon: 'none' });
      return;
    }

    wx.showModal({
      title: '结束房间',
      content: '结束后将不能继续记分，是否继续？',
      success: async (res: WechatMiniprogram.ShowModalSuccessCallbackResult) => {
        if (!res.confirm) {
          return;
        }

        wx.showLoading({ title: '结束中...' });
        try {
          const payload = await endRoom(this.data.roomId);
          this.applyRoomPayload(payload);
          wx.showToast({ title: '房间已结束', icon: 'success' });
        } catch (error) {
          wx.showToast({
            title: (error as RequestError).message || '结束房间失败',
            icon: 'none',
          });
        } finally {
          wx.hideLoading();
        }
      },
    });
  },

  setRoomCode(roomCode: string) {
    const normalized = roomCode.replace(/\D/g, '').slice(0, ROOM_CODE_LENGTH);
    const codeDigits = Array.from({ length: ROOM_CODE_LENGTH }, (_, index) => {
      return normalized[index] || '';
    });

    this.setData({
      roomCode: normalized,
      codeDigits,
      topBarTitle: `桌号：${normalized || '------'}`,
    });
  },

  applyRoomPayload(payload: RoomPayload) {
    saveActorIdentity(payload.actor);

    const currentMemberId = payload.currentMemberId || 0;
    const isPoolMode = payload.room.roomType === 'POOL';
    const sortedMembers = this.sortMembersForView(
      payload.room.members,
      currentMemberId,
      payload.room.ownerMemberId || 0,
    );

    const scoreRecords = [...payload.room.scoreRecords]
      .reverse()
      .map((record) => ({
        ...record,
        displayTime: this.formatTime(record.createdAt),
      }));

    const currentMember = sortedMembers.find(
      (member) => member.id === currentMemberId,
    );
    const inviteCardHiddenBySelf = currentMember
      ? Boolean(currentMember.inviteCardHidden)
      : false;
    const showInlineInviteCard =
      !isPoolMode && sortedMembers.length === 1 && !inviteCardHiddenBySelf;

    this.setData({
      roomId: payload.room.id,
      roomCode: payload.room.roomCode,
      roomStatus: payload.room.status,
      roomType: payload.room.roomType,
      topBarTitle: `桌号：${payload.room.roomCode}`,
      codeDigits: Array.from({ length: ROOM_CODE_LENGTH }, (_, index) => {
        return payload.room.roomCode[index] || '';
      }),
      members: sortedMembers,
      scoreRecords,
      currentMemberId,
      isOwner: payload.room.ownerMemberId === currentMemberId,
      inviteCardHiddenBySelf,
      showInlineInviteCard,
      isPoolMode,
      tableFeeEnabled: payload.room.tableFeeEnabled || false,
      activePoolRound: (payload.room as any).activePoolRound || null,
    });

    if (isPoolMode) {
      this.loadPoolRounds();
    }
  },

  sortMembersForView(
    members: RoomMember[],
    currentMemberId: number,
    ownerMemberId: number,
  ): RoomMember[] {
    return members
      .map((member, index) => ({
        member,
        index,
      }))
      .sort((left, right) => {
        const leftRank = this.getMemberDisplayRank(
          left.member.id,
          currentMemberId,
          ownerMemberId,
        );
        const rightRank = this.getMemberDisplayRank(
          right.member.id,
          currentMemberId,
          ownerMemberId,
        );

        if (leftRank !== rightRank) {
          return leftRank - rightRank;
        }

        return left.index - right.index;
      })
      .map((item) => item.member);
  },

  getMemberDisplayRank(
    memberId: number,
    currentMemberId: number,
    ownerMemberId: number,
  ): number {
    if (memberId === currentMemberId) {
      return 0;
    }

    if (memberId === ownerMemberId) {
      return 1;
    }

    return 2;
  },

  connectRealtime() {
    const roomCode = this.data.roomCode;
    if (roomCode.length !== ROOM_CODE_LENGTH) {
      return;
    }

    if (realtimeSocketTask) {
      return;
    }

    this.clearRealtimeReconnectTimer();
    realtimeManualClose = false;

    const socketUrl = buildRoomRealtimeUrl(roomCode);
    const socketTask = wx.connectSocket({
      url: socketUrl,
      timeout: 10000,
    });
    realtimeSocketTask = socketTask;

    socketTask.onOpen(() => {
      realtimeReconnectAttempt = 0;
      this.setData({ realtimeConnected: true });
      this.startRealtimeHeartbeat();
      this.sendRealtimeMessage({
        type: 'subscribe',
        roomCode,
      });
    });

    socketTask.onMessage((event: WechatMiniprogram.SocketTaskOnMessageListenerResult) => {
      this.handleRealtimeMessage(event.data);
    });

    socketTask.onClose(() => {
      this.handleRealtimeClose();
    });

    socketTask.onError(() => {
      this.handleRealtimeClose();
    });
  },

  disconnectRealtime(manualClose = true) {
    realtimeManualClose = manualClose;
    this.clearRealtimeReconnectTimer();
    this.stopRealtimeHeartbeat();

    if (realtimeSocketTask) {
      try {
        realtimeSocketTask.close({
          code: 1000,
          reason: 'page_closed',
        });
      } catch (error) {
        // ignore close errors
      }
      realtimeSocketTask = null;
    }

    if (manualClose) {
      realtimeReconnectAttempt = 0;
      realtimeRefreshing = false;
      realtimeRefreshPending = false;
    }

    this.setData({ realtimeConnected: false });
  },

  handleRealtimeClose() {
    this.stopRealtimeHeartbeat();
    realtimeSocketTask = null;
    this.setData({ realtimeConnected: false });

    if (realtimeManualClose) {
      return;
    }

    this.scheduleRealtimeReconnect();
  },

  scheduleRealtimeReconnect() {
    if (realtimeReconnectTimer !== null) {
      return;
    }

    const roomCode = this.data.roomCode;
    if (roomCode.length !== ROOM_CODE_LENGTH) {
      return;
    }

    const waitMs = Math.min(
      REALTIME_RECONNECT_MAX_MS,
      REALTIME_RECONNECT_BASE_MS * (2 ** realtimeReconnectAttempt),
    );
    realtimeReconnectAttempt += 1;

    realtimeReconnectTimer = setTimeout(() => {
      realtimeReconnectTimer = null;
      this.connectRealtime();
    }, waitMs) as unknown as number;
  },

  clearRealtimeReconnectTimer() {
    if (realtimeReconnectTimer !== null) {
      clearTimeout(realtimeReconnectTimer);
      realtimeReconnectTimer = null;
    }
  },

  startRealtimeHeartbeat() {
    this.stopRealtimeHeartbeat();
    realtimeHeartbeatTimer = setInterval(() => {
      this.sendRealtimeMessage({ type: 'ping' });
    }, REALTIME_HEARTBEAT_MS) as unknown as number;
  },

  stopRealtimeHeartbeat() {
    if (realtimeHeartbeatTimer !== null) {
      clearInterval(realtimeHeartbeatTimer);
      realtimeHeartbeatTimer = null;
    }
  },

  sendRealtimeMessage(message: RealtimeSendMessage) {
    if (!realtimeSocketTask) {
      return;
    }

    try {
      realtimeSocketTask.send({
        data: JSON.stringify(message),
      });
    } catch (error) {
      // ignore send errors, reconnect handler will recover
    }
  },

  handleRealtimeMessage(rawData: string | ArrayBuffer) {
    const message = this.parseRealtimeMessage(rawData);
    if (!message || !message.type) {
      return;
    }

    if (message.type === 'room_updated' && message.roomCode === this.data.roomCode) {
      this.handleRealtimeRoomUpdated();
      return;
    }
  },

  parseRealtimeMessage(rawData: string | ArrayBuffer): RealtimeMessage | null {
    let messageText = '';
    if (typeof rawData === 'string') {
      messageText = rawData;
    } else {
      try {
        messageText = String.fromCharCode.apply(null, Array.from(new Uint8Array(rawData)));
      } catch (error) {
        return null;
      }
    }

    try {
      return JSON.parse(messageText) as RealtimeMessage;
    } catch (error) {
      return null;
    }
  },

  handleRealtimeRoomUpdated() {
    if (realtimeRefreshing) {
      realtimeRefreshPending = true;
      return;
    }

    realtimeRefreshing = true;
    this.refreshRoomState(true)
      .catch(() => {
        // 失败时保持静默，下一个实时事件或重连会继续尝试
      })
      .finally(() => {
        realtimeRefreshing = false;
        if (realtimeRefreshPending) {
          realtimeRefreshPending = false;
          this.handleRealtimeRoomUpdated();
        }
      });
  },

  // ───────── 分数池功能 ─────────

  async handleStartPoolRound() {
    if (!this.data.isOwner) {
      wx.showToast({ title: '只有桌主可以开启新圈', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '开启中...' });
    try {
      const payload = await startPoolRound(this.data.roomId);
      wx.hideLoading();
      if (payload.round) {
        this.setData({
          activePoolRound: {
            id: payload.round.id,
            roundNumber: payload.round.roundNumber,
            poolBalance: payload.round.poolBalance,
            status: payload.round.status,
          },
        });
        wx.navigateTo({
          url: `/subpkg/pool-record/pool-record?roomId=${this.data.roomId}&roundId=${payload.round.id}`,
        });
      }
    } catch (error) {
      wx.hideLoading();
      wx.showToast({ title: (error as RequestError).message || '开启失败', icon: 'none' });
    }
  },

  goToPoolRecord() {
    const round = this.data.activePoolRound;
    if (!round) return;
    wx.navigateTo({
      url: `/subpkg/pool-record/pool-record?roomId=${this.data.roomId}&roundId=${round.id}`,
    });
  },

  async handleToggleTableFee() {
    if (!this.data.isOwner) {
      wx.showToast({ title: '只有桌主可以操作台板', icon: 'none' });
      return;
    }
    const newEnabled = !this.data.tableFeeEnabled;
    wx.showLoading({ title: '处理中...' });
    try {
      const payload = await toggleTableFee(this.data.roomId, newEnabled);
      this.applyRoomPayload(payload);
    } catch (error) {
      wx.showToast({ title: (error as RequestError).message || '操作失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  async loadPoolRounds() {
    if (!this.data.roomId) return;
    try {
      const res = await request<{ rounds: any[] }>({
        url: `/rooms/${this.data.roomId}/pool/rounds`,
        method: 'GET',
      });

      const members = this.data.members;
      const activeMemberIds = members.filter((m: any) => !m.isSpectator).map((m: any) => m.id);
      const poolStatsMembers = members
        .filter((m: any) => activeMemberIds.indexOf(m.id) >= 0)
        .map((m: any) => {
          const totalRounds = res.rounds.length;
          const wonRounds = res.rounds.filter((rd: any) => {
            const sc = rd.memberScores.find((s: any) => s.memberId === m.id);
            return sc && sc.score > 0;
          }).length;
          return {
            id: m.id,
            nickname: m.nickname,
            avatar: m.avatar,
            avatarInitials: m.avatarInitials,
            actorType: m.actorType || 'USER',
            winRate: totalRounds > 0 ? Math.round((wonRounds / totalRounds) * 100) + '%' : '0%',
          };
        });

      const poolRounds = res.rounds.map((rd: any) => {
        const memberScoreMap: Record<number, number> = {};
        rd.memberScores.forEach((s: any) => {
          memberScoreMap[s.memberId] = s.score;
        });
        const createdAt = new Date(rd.createdAt);
        const h = createdAt.getHours();
        const min = createdAt.getMinutes();
        const sec = createdAt.getSeconds();
        const timeText = `${h < 10 ? '0' + h : h}:${min < 10 ? '0' + min : min}:${sec < 10 ? '0' + sec : sec}`;
        return {
          id: rd.id,
          roundNumber: rd.roundNumber,
          poolBalance: rd.poolBalance,
          status: rd.status,
          timeText,
          memberScoreMap,
        };
      });

      this.setData({ poolRounds, poolStatsMembers });
    } catch (error) {
      // silent
    }
  },

  // ───────── 旁观者功能 ─────────

  openSpectatorDialog() {
    if (!this.data.isOwner) {
      wx.showToast({ title: '只有桌主可以管理旁观者', icon: 'none' });
      return;
    }
    const candidates = this.data.members.map((m: any) => ({
      id: m.id,
      nickname: m.nickname,
      avatar: m.avatar,
      avatarInitials: m.avatarInitials,
      actorType: m.actorType || 'USER',
      isSpectatorSelected: Boolean(m.isSpectator),
      isOwner: m.isOwner,
    }));

    this.setData({
      spectatorDialogVisible: true,
      spectatorCandidates: candidates,
    });
  },

  closeSpectatorDialog() {
    this.setData({ spectatorDialogVisible: false });
  },

  toggleSpectatorCandidate(e: any) {
    const memberId = Number(e.currentTarget.dataset.memberId || 0);
    const candidates = this.data.spectatorCandidates.map((c: any) => {
      if (c.id === memberId && !c.isOwner) {
        return { ...c, isSpectatorSelected: !c.isSpectatorSelected };
      }
      return c;
    });
    this.setData({ spectatorCandidates: candidates });
  },

  async confirmSpectators() {
    const spectatorIds = this.data.spectatorCandidates
      .filter((c: any) => c.isSpectatorSelected)
      .map((c: any) => c.id);

    wx.showLoading({ title: '设置中...' });
    try {
      const payload = await setSpectators(this.data.roomId, spectatorIds);
      this.applyRoomPayload(payload);
      this.closeSpectatorDialog();
      wx.showToast({ title: '设置成功', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: (error as RequestError).message || '设置失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  formatTime(dateText: string): string {
    const date = new Date(dateText);
    if (Number.isNaN(date.getTime())) {
      return '';
    }

    const formatTwoDigits = (value: number): string => {
      if (value < 10) {
        return `0${value}`;
      }
      return `${value}`;
    };

    const month = formatTwoDigits(date.getMonth() + 1);
    const day = formatTwoDigits(date.getDate());
    const hour = formatTwoDigits(date.getHours());
    const minute = formatTwoDigits(date.getMinutes());

    return `${month}-${day} ${hour}:${minute}`;
  },

  onShareAppMessage() {
    const roomCode = this.data.roomCode;
    if (/^\d{6}$/.test(roomCode)) {
      return {
        title: `邀请你加入桌号 ${roomCode}`,
        path: `/pages/home/home?roomCode=${roomCode}`,
        imageUrl: SHARE_PROMO_IMAGE,
      };
    }

    return {
      title: '欢乐记分馆',
      path: '/pages/home/home',
      imageUrl: SHARE_PROMO_IMAGE,
    };
  },

  onShareTimeline() {
    const roomCode = this.data.roomCode;
    if (/^\d{6}$/.test(roomCode)) {
      return {
        title: `邀请你加入桌号 ${roomCode}`,
        query: `roomCode=${roomCode}`,
        imageUrl: SHARE_PROMO_IMAGE,
      };
    }

    return {
      title: '欢乐记分馆',
      query: '',
      imageUrl: SHARE_PROMO_IMAGE,
    };
  },
});
