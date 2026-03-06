import { fontSizeBehavior } from '../../behaviors/font-size';
import { RequestError } from '../../utils/request';
import {
  getCurrentPoolRound,
  getPoolRound,
  poolGive,
  poolTake,
  poolTableTake,
  endPoolRound,
  PoolRoundPayload,
  PoolRoundRecord,
} from '../../utils/room';

interface RecordView extends PoolRoundRecord {
  displayTime: string;
}

Page({
  behaviors: [fontSizeBehavior],
  data: {
    roomId: 0,
    roundId: 0,
    round: null as PoolRoundPayload['round'],
    records: [] as RecordView[],
    isOwner: false,
    isSpectator: false,
    tableFeeEnabled: false,
    currentMemberId: 0,
    pointsDialogVisible: false,
    pointsDialogTitle: '',
    pointsDialogValue: '',
    pointsDialogMode: '' as 'give' | 'take' | 'table-take',
  },

  onLoad(options: Record<string, string | undefined>) {
    const roomId = Number(options.roomId || 0);
    const roundId = Number(options.roundId || 0);
    this.setData({ roomId, roundId });
    this.loadRoundData();
  },

  onShow() {
    (this as any)._applyFontSize();
    if (this.data.roomId) {
      this.loadRoundData();
    }
  },

  async loadRoundData() {
    const { roomId, roundId } = this.data;
    if (!roomId) return;

    try {
      let payload: PoolRoundPayload;
      if (roundId) {
        payload = await getPoolRound(roomId, roundId);
      } else {
        payload = await getCurrentPoolRound(roomId);
      }
      this.applyPayload(payload);
    } catch (error) {
      wx.showToast({ title: (error as RequestError).message || '加载失败', icon: 'none' });
    }
  },

  applyPayload(payload: PoolRoundPayload) {
    const records: RecordView[] = (payload.records || []).map((r) => ({
      ...r,
      displayTime: this.formatTime(r.createdAt),
    }));

    const currentMember = payload.members.find((m) => m.id === payload.currentMemberId);
    const isSpectator = currentMember ? currentMember.isSpectator : false;

    this.setData({
      round: payload.round,
      records,
      isOwner: payload.isOwner,
      isSpectator,
      tableFeeEnabled: payload.tableFeeEnabled,
      currentMemberId: payload.currentMemberId || 0,
      roundId: payload.round ? payload.round.id : 0,
    });
  },

  openGiveDialog() {
    this.setData({
      pointsDialogVisible: true,
      pointsDialogTitle: '给分到分数池',
      pointsDialogValue: '',
      pointsDialogMode: 'give',
    });
  },

  openTakeDialog() {
    this.setData({
      pointsDialogVisible: true,
      pointsDialogTitle: '从分数池取分',
      pointsDialogValue: '',
      pointsDialogMode: 'take',
    });
  },

  handleTableTake() {
    this.setData({
      pointsDialogVisible: true,
      pointsDialogTitle: '台板取分',
      pointsDialogValue: '',
      pointsDialogMode: 'table-take',
    });
  },

  closePointsDialog() {
    this.setData({ pointsDialogVisible: false, pointsDialogValue: '' });
  },

  noop() {},

  onPointsInput(e: any) {
    const rawValue = String((e.detail as { value?: string }).value || '');
    const value = rawValue.replace(/\D/g, '').slice(0, 6);
    this.setData({ pointsDialogValue: value });
  },

  async confirmPoints() {
    const points = Number(this.data.pointsDialogValue || 0);
    if (!Number.isInteger(points) || points <= 0) {
      wx.showToast({ title: '请输入有效分值', icon: 'none' });
      return;
    }

    const mode = this.data.pointsDialogMode;
    wx.showLoading({ title: '处理中...' });

    try {
      let payload: PoolRoundPayload;
      if (mode === 'give') {
        payload = await poolGive(this.data.roomId, points);
      } else if (mode === 'take') {
        payload = await poolTake(this.data.roomId, points);
      } else {
        payload = await poolTableTake(this.data.roomId, points);
      }
      this.applyPayload(payload);
      this.closePointsDialog();
      wx.showToast({ title: '操作成功', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: (error as RequestError).message || '操作失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  async handleEndRound() {
    if (!this.data.isOwner) {
      wx.showToast({ title: '只有桌主可以结束本圈', icon: 'none' });
      return;
    }

    wx.showModal({
      title: '结束本圈',
      content: '确认结束当前圈吗？结束后不能继续给分取分。',
      success: async (res: WechatMiniprogram.ShowModalSuccessCallbackResult) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '结束中...' });
        try {
          const payload = await endPoolRound(this.data.roomId, this.data.roundId);
          this.applyPayload(payload);
          wx.showToast({ title: '本圈已结束', icon: 'success' });
        } catch (error) {
          wx.showToast({ title: (error as RequestError).message || '结束失败', icon: 'none' });
        } finally {
          wx.hideLoading();
        }
      },
    });
  },

  goBack() {
    wx.navigateBack();
  },

  formatTime(dateText: string): string {
    const date = new Date(dateText);
    if (Number.isNaN(date.getTime())) return '';

    const y = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const h = date.getHours();
    const min = date.getMinutes();
    const sec = date.getSeconds();

    const p = (v: number) => (v < 10 ? '0' + v : '' + v);
    return `${y}-${p(month)}-${p(day)} ${p(h)}:${p(min)}:${p(sec)}`;
  },
});
