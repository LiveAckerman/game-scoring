import { fontSizeBehavior } from '../../behaviors/font-size';
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

const ROOM_CODE_LENGTH = 6;

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

    showAddModal: false,
    newPlayerName: '',

    scoreDialogVisible: false,
    scoreDialogType: '' as '' | 'lose' | 'win',
    scoreDialogSourceId: 0,
    scoreDialogSourceName: '',
    scoreDialogTargetId: 0,
    scoreDialogValue: '',
    otherMembers: [] as RoomMember[],
  },

  onLoad(options: Record<string, string | undefined>) {
    const roomCode = (options.roomCode || '').replace(/\D/g, '').slice(0, ROOM_CODE_LENGTH);
    if (roomCode.length === ROOM_CODE_LENGTH) {
      this.setData({ roomCode, topBarTitle: `单人记分 · ${roomCode}` });
      this.refreshRoomState();
    }
  },

  onPullDownRefresh() {
    this.refreshRoomState(true);
  },

  handleActionTap(e: WechatMiniprogram.BaseEvent) {
    const action = String(e.currentTarget.dataset.action || '');

    if (action === 'add') {
      this.openAddModal();
      return;
    }

    if (action === 'detail') {
      wx.showToast({ title: '明细已展示在下方列表', icon: 'none' });
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

    this.setData({
      roomId: payload.room.id,
      roomCode: payload.room.roomCode,
      roomStatus: payload.room.status,
      topBarTitle: `单人记分 · ${payload.room.roomCode}`,
      members: sortedMembers,
      scoreRecords,
      currentMemberId,
      isOwner: payload.room.ownerMemberId === currentMemberId,
    });
  },

  noop() {},

  openAddModal() {
    if (this.data.roomStatus !== 'IN_PROGRESS') {
      wx.showToast({ title: '房间已结束', icon: 'none' });
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

    const type = String(e.currentTarget.dataset.type || '') as 'lose' | 'win';
    const memberId = Number(e.currentTarget.dataset.memberId || 0);
    const memberName = String(e.currentTarget.dataset.memberName || '');

    if (!memberId) return;

    if (this.data.members.length < 2) {
      wx.showToast({ title: '至少需要2名玩家', icon: 'none' });
      return;
    }

    const otherMembers = this.data.members.filter((m: RoomMember) => m.id !== memberId);

    this.setData({
      scoreDialogVisible: true,
      scoreDialogType: type,
      scoreDialogSourceId: memberId,
      scoreDialogSourceName: memberName,
      scoreDialogTargetId: otherMembers.length === 1 ? otherMembers[0].id : 0,
      scoreDialogValue: '',
      otherMembers,
    });
  },

  selectTarget(e: WechatMiniprogram.BaseEvent) {
    const targetId = Number(e.currentTarget.dataset.memberId || 0);
    this.setData({ scoreDialogTargetId: targetId });
  },

  onScoreInput(e: WechatMiniprogram.CustomEvent) {
    const rawValue = String((e.detail as { value?: string }).value || '');
    const value = rawValue.replace(/\D/g, '').slice(0, 6);
    this.setData({ scoreDialogValue: value });
  },

  closeScoreDialog() {
    this.setData({
      scoreDialogVisible: false,
      scoreDialogType: '',
      scoreDialogSourceId: 0,
      scoreDialogSourceName: '',
      scoreDialogTargetId: 0,
      scoreDialogValue: '',
      otherMembers: [],
    });
  },

  async confirmScore() {
    if (!this.data.roomId) {
      wx.showToast({ title: '房间信息异常', icon: 'none' });
      return;
    }

    const points = Number(this.data.scoreDialogValue || 0);
    if (!Number.isInteger(points) || points <= 0) {
      wx.showToast({ title: '请输入有效分数', icon: 'none' });
      return;
    }

    if (!this.data.scoreDialogTargetId) {
      wx.showToast({ title: '请选择对手', icon: 'none' });
      return;
    }

    const sourceId = this.data.scoreDialogSourceId;
    const targetId = this.data.scoreDialogTargetId;
    const type = this.data.scoreDialogType;

    let fromMemberId: number;
    let toMemberId: number;

    if (type === 'lose') {
      fromMemberId = sourceId;
      toMemberId = targetId;
    } else {
      fromMemberId = targetId;
      toMemberId = sourceId;
    }

    wx.showLoading({ title: '记分中...' });
    try {
      const payload = await addRoomScore(
        this.data.roomId,
        toMemberId,
        points,
        fromMemberId,
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
});
