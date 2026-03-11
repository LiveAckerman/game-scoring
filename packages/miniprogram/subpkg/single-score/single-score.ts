import { fontSizeBehavior } from '../../behaviors/font-size';
import { shouldUseCompactLayout } from '../../utils/layout';
import { buildRoomRealtimeUrl } from '../../utils/realtime';
import { saveActorIdentity } from '../../utils/identity';
import { RequestError } from '../../utils/request';
import {
  addRoomMember,
  addRoomScore,
  endRoom,
  getRoomByCode,
  kickRoomMember,
  RoomMember,
  RoomPayload,
  RoomScoreRecord,
} from '../../utils/room';

interface RoomScoreRecordView extends RoomScoreRecord {
  displayTime: string;
}

interface ScoreDialogMember extends RoomMember {
  isSelected: boolean;
  scoreValue: string;
}

const ROOM_CODE_LENGTH = 6;
const REALTIME_RECONNECT_BASE_MS = 1000;
const REALTIME_RECONNECT_MAX_MS = 10000;
const REALTIME_HEARTBEAT_MS = 20000;

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
    topBarTitle: '单人记分',
    roomId: 0,
    roomCode: '',
    roomStatus: 'IN_PROGRESS' as 'IN_PROGRESS' | 'ENDED',
    members: [] as RoomMember[],
    scoreRecords: [] as RoomScoreRecordView[],
    currentMemberId: 0,
    isOwner: false,
    currentMemberIsSpectator: false,
    isCompactLayout: false,

    showAddModal: false,
    newPlayerName: '',

    scoreDialogVisible: false,
    scoreDialogType: '' as '' | 'lose' | 'win',
    scoreDialogSourceId: 0,
    scoreDialogSourceName: '',
    scoreDialogTargetIds: [] as number[],
    batchScoreEnabled: true,
    scoreDialogValue: '',
    otherMembers: [] as ScoreDialogMember[],
  },

  onLoad(options: Record<string, string | undefined>) {
    this.disconnectRealtime(true);
    this.syncLayoutMode();
    const roomCode = (options.roomCode || '').replace(/\D/g, '').slice(0, ROOM_CODE_LENGTH);
    if (roomCode.length === ROOM_CODE_LENGTH) {
      this.setData({ roomCode, topBarTitle: `单人记分 · ${roomCode}` });
      this.refreshRoomState();
    }
  },

  onShow() {
    (this as any)._applyFontSize();
    this.syncLayoutMode();
    this.refreshRoomState(true);
    this.connectRealtime();
  },

  onResize() {
    this.syncLayoutMode();
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

  syncLayoutMode() {
    const isCompactLayout = shouldUseCompactLayout();
    if (isCompactLayout !== this.data.isCompactLayout) {
      this.setData({ isCompactLayout });
    }
  },

  handleActionTap(e: WechatMiniprogram.BaseEvent) {
    const action = String(e.currentTarget.dataset.action || '');

    if (action === 'add') {
      this.openAddModal();
      return;
    }

    if (action === 'end') {
      this.handleEndRoom();
    }
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
    const { roomCode } = this.data;
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
      if (!silent) {
        wx.showToast({
          title: (error as RequestError).message || '拉取房间失败',
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

  applyRoomPayload(payload: RoomPayload) {
    saveActorIdentity(payload.actor);

    const currentMemberId = payload.currentMemberId || 0;

    const sortedMembers = [...payload.room.members].sort((a, b) => {
      const rankA = a.id === currentMemberId ? 0 : 1;
      const rankB = b.id === currentMemberId ? 0 : 1;
      if (rankA !== rankB) return rankA - rankB;
      return a.id - b.id;
    });

    const scoreRecords = [...payload.room.scoreRecords]
      .reverse()
      .map((record) => ({
        ...record,
        displayTime: this.formatTime(record.createdAt),
      }));

    const currentMember = sortedMembers.find((member) => member.id === currentMemberId);

    this.setData({
      roomId: payload.room.id,
      roomCode: payload.room.roomCode,
      roomStatus: payload.room.status,
      topBarTitle: `单人记分 · ${payload.room.roomCode}`,
      members: sortedMembers,
      scoreRecords,
      currentMemberId,
      isOwner: payload.room.ownerMemberId === currentMemberId,
      currentMemberIsSpectator: Boolean(currentMember?.isSpectator),
    });
  },

  noop() {},

  openAddModal() {
    if (this.data.roomStatus !== 'IN_PROGRESS') {
      wx.showToast({ title: '房间已结束', icon: 'none' });
      return;
    }
    if (this.data.currentMemberIsSpectator) {
      wx.showToast({ title: '旁观者不能操作', icon: 'none' });
      return;
    }
    this.setData({ showAddModal: true, newPlayerName: '' });
  },

  closeAddModal() {
    this.setData({ showAddModal: false });
  },

  onNameInput(e: WechatMiniprogram.CustomEvent) {
    this.setData({ newPlayerName: (e.detail as { value?: string }).value || '' });
  },

  async confirmAddPlayer() {
    const name = this.data.newPlayerName.trim();
    if (!name) {
      wx.showToast({ title: '请输入名字', icon: 'none' });
      return;
    }

    if (!this.data.roomId) {
      wx.showToast({ title: '房间信息异常', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '添加中...' });
    try {
      const payload = await addRoomMember(this.data.roomId, name);
      this.applyRoomPayload(payload);
      this.setData({ showAddModal: false, newPlayerName: '' });
      wx.showToast({ title: '添加成功', icon: 'success' });
    } catch (error) {
      wx.showToast({
        title: (error as RequestError).message || '添加失败',
        icon: 'none',
      });
    } finally {
      wx.hideLoading();
    }
  },

  openScoreDialog(e: WechatMiniprogram.BaseEvent) {
    if (this.data.roomStatus !== 'IN_PROGRESS') {
      wx.showToast({ title: '房间已结束，不能继续记分', icon: 'none' });
      return;
    }

    if (this.data.currentMemberIsSpectator) {
      wx.showToast({ title: '旁观者不能操作', icon: 'none' });
      return;
    }

    const type = String(e.currentTarget.dataset.type || '') as 'lose' | 'win';
    const memberId = Number(e.currentTarget.dataset.memberId || 0);
    const memberName = String(e.currentTarget.dataset.memberName || '');

    if (!memberId) return;

    const otherMembers = this.data.members
      .filter((m: RoomMember) => m.id !== memberId && !m.isSpectator)
      .map((member) => ({
        ...member,
        isSelected: false,
        scoreValue: '',
      }));

    if (otherMembers.length === 0) {
      wx.showToast({ title: '至少需要2名非旁观玩家', icon: 'none' });
      return;
    }

    const scoreDialogTargetIds = otherMembers.length === 1 ? [otherMembers[0].id] : [];
    const markedMembers = otherMembers.map((member) => ({
      ...member,
      isSelected: scoreDialogTargetIds.includes(member.id),
    }));

    this.setData({
      scoreDialogVisible: true,
      scoreDialogType: type,
      scoreDialogSourceId: memberId,
      scoreDialogSourceName: memberName,
      scoreDialogTargetIds,
      batchScoreEnabled: true,
      scoreDialogValue: '',
      otherMembers: markedMembers,
    });
  },

  selectTarget(e: WechatMiniprogram.BaseEvent) {
    const targetId = Number(e.currentTarget.dataset.memberId || 0);
    if (!targetId) {
      return;
    }

    const selectedIds = this.data.scoreDialogTargetIds.includes(targetId)
      ? this.data.scoreDialogTargetIds.filter((id) => id !== targetId)
      : [...this.data.scoreDialogTargetIds, targetId];

    this.setData({
      scoreDialogTargetIds: selectedIds,
      otherMembers: this.data.otherMembers.map((member) => ({
        ...member,
        isSelected: selectedIds.includes(member.id),
      })),
    });
  },

  onBatchScoreToggle(e: WechatMiniprogram.CustomEvent) {
    const enabled = Boolean((e.detail as { value?: boolean }).value);
    this.setData({ batchScoreEnabled: enabled });
  },

  onScoreInput(e: WechatMiniprogram.CustomEvent) {
    const rawValue = String((e.detail as { value?: string }).value || '');
    const value = rawValue.replace(/\D/g, '').slice(0, 6);
    this.setData({ scoreDialogValue: value });
  },

  onTargetScoreInput(e: WechatMiniprogram.CustomEvent) {
    const targetId = Number(e.currentTarget.dataset.memberId || 0);
    const rawValue = String((e.detail as { value?: string }).value || '');
    const value = rawValue.replace(/\D/g, '').slice(0, 6);

    this.setData({
      otherMembers: this.data.otherMembers.map((member) => {
        if (member.id !== targetId) {
          return member;
        }

        return {
          ...member,
          scoreValue: value,
        };
      }),
    });
  },

  closeScoreDialog() {
    this.setData({
      scoreDialogVisible: false,
      scoreDialogType: '',
      scoreDialogSourceId: 0,
      scoreDialogSourceName: '',
      scoreDialogTargetIds: [],
      batchScoreEnabled: true,
      scoreDialogValue: '',
      otherMembers: [],
    });
  },

  async confirmScore() {
    if (!this.data.roomId) {
      wx.showToast({ title: '房间信息异常', icon: 'none' });
      return;
    }

    if (this.data.currentMemberIsSpectator) {
      wx.showToast({ title: '旁观者不能操作', icon: 'none' });
      return;
    }

    if (this.data.scoreDialogTargetIds.length === 0) {
      wx.showToast({ title: '请至少选择1个对手', icon: 'none' });
      return;
    }

    const sourceId = this.data.scoreDialogSourceId;
    const type = this.data.scoreDialogType;
    const selectedMembers = this.data.otherMembers.filter((member) => member.isSelected);
    let payload: RoomPayload | null = null;

    if (this.data.batchScoreEnabled) {
      const points = Number(this.data.scoreDialogValue || 0);
      if (!Number.isInteger(points) || points <= 0) {
        wx.showToast({ title: '请输入有效分数', icon: 'none' });
        return;
      }

      wx.showLoading({ title: '记分中...' });
      try {
        for (const targetId of this.data.scoreDialogTargetIds) {
          const fromMemberId = type === 'lose' ? sourceId : targetId;
          const toMemberId = type === 'lose' ? targetId : sourceId;
          payload = await addRoomScore(
            this.data.roomId,
            toMemberId,
            points,
            fromMemberId,
          );
        }

        if (payload) {
          this.applyRoomPayload(payload);
        }
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
      return;
    }

    for (const member of selectedMembers) {
      const points = Number(member.scoreValue || 0);
      if (!Number.isInteger(points) || points <= 0) {
        wx.showToast({ title: `请给 ${member.nickname} 输入有效分数`, icon: 'none' });
        return;
      }
    }

    wx.showLoading({ title: '记分中...' });
    try {
      for (const member of selectedMembers) {
        const targetId = member.id;
        const points = Number(member.scoreValue || 0);
        const fromMemberId = type === 'lose' ? sourceId : targetId;
        const toMemberId = type === 'lose' ? targetId : sourceId;
        payload = await addRoomScore(
          this.data.roomId,
          toMemberId,
          points,
          fromMemberId,
        );
      }

      if (payload) {
        this.applyRoomPayload(payload);
      }
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

  handleKickMember(e: WechatMiniprogram.BaseEvent) {
    if (!this.data.isOwner) {
      wx.showToast({ title: '只有房主可以踢人', icon: 'none' });
      return;
    }

    if (this.data.roomStatus !== 'IN_PROGRESS') {
      wx.showToast({ title: '房间已结束，无法踢人', icon: 'none' });
      return;
    }

    const targetMemberId = Number(e.currentTarget.dataset.memberId || 0);
    const targetMemberName = String(e.currentTarget.dataset.memberName || '');

    if (!targetMemberId) {
      return;
    }

    wx.showModal({
      title: '踢出玩家',
      content: `确认踢出 ${targetMemberName} 吗？系统会按原路退回该玩家当前持有的积分。`,
      success: async (res: WechatMiniprogram.ShowModalSuccessCallbackResult) => {
        if (!res.confirm) return;

        wx.showLoading({ title: '处理中...' });
        try {
          const payload = await kickRoomMember(this.data.roomId, targetMemberId);
          this.applyRoomPayload(payload);
          wx.showToast({ title: '已踢出', icon: 'success' });
        } catch (error) {
          wx.showToast({
            title: (error as RequestError).message || '踢人失败',
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
      wx.showToast({ title: '只有房主可以结束', icon: 'none' });
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
        if (!res.confirm) return;

        wx.showLoading({ title: '结束中...' });
        try {
          const payload = await endRoom(this.data.roomId);
          this.applyRoomPayload(payload);
          wx.showToast({ title: '房间已结束', icon: 'success' });
        } catch (error) {
          wx.showToast({
            title: (error as RequestError).message || '结束失败',
            icon: 'none',
          });
        } finally {
          wx.hideLoading();
        }
      },
    });
  },

  formatTime(dateText: string): string {
    const date = new Date(dateText);
    if (Number.isNaN(date.getTime())) return '';

    const pad = (v: number) => (v < 10 ? `0${v}` : `${v}`);
    return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
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

    const socketTask = wx.connectSocket({
      url: buildRoomRealtimeUrl(roomCode),
      timeout: 10000,
    });
    realtimeSocketTask = socketTask;

    socketTask.onOpen(() => {
      realtimeReconnectAttempt = 0;
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
  },

  handleRealtimeClose() {
    this.stopRealtimeHeartbeat();
    realtimeSocketTask = null;

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
      // ignore send errors
    }
  },

  handleRealtimeMessage(rawData: string | ArrayBuffer) {
    const message = this.parseRealtimeMessage(rawData);
    if (!message || !message.type) {
      return;
    }

    if (message.type === 'room_updated' && message.roomCode === this.data.roomCode) {
      this.handleRealtimeRoomUpdated();
    }
  },

  parseRealtimeMessage(rawData: string | ArrayBuffer) {
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
});
