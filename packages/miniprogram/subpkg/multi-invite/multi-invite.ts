import {
  getAccessToken,
  getGuestToken,
  promptGuestNickname,
  saveActorIdentity,
} from '../../utils/identity';
import { buildRoomRealtimeUrl } from '../../utils/realtime';
import { API_BASE_URL, buildRequestHeader, request, RequestError } from '../../utils/request';
import { fontSizeBehavior } from '../../behaviors/font-size';
import { shouldUseCompactLayout } from '../../utils/layout';
import {
  addRoomScore,
  endRoom,
  getRoomByCode,
  hideRoomInviteCard,
  joinRoom,
  kickRoomMember,
  leaveRoom,
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

interface ScoreNotifyVoiceOption {
  name: string;
  value: string;
}

let realtimeSocketTask: WechatMiniprogram.SocketTask | null = null;
let realtimeReconnectTimer: number | null = null;
let realtimeHeartbeatTimer: number | null = null;
let realtimeManualClose = false;
let realtimeReconnectAttempt = 0;
let realtimeRefreshing = false;
let realtimeRefreshPending = false;
let roomEntryLoading = false;
let scoreNotifyAudioContext: WechatMiniprogram.InnerAudioContext | null = null;
let scoreNotifyQueue: RoomScoreRecordView[] = [];
let scoreNotifyPlaying = false;
let scoreNotifyInitialized = false;
let scoreNotifyLastSeenRecordId = 0;
let scoreNotifyCurrentTempFilePath = '';
let scoreNotifyPreviewAudioContext: WechatMiniprogram.InnerAudioContext | null = null;
let scoreNotifyPreviewing = false;
let scoreNotifyPreviewTempFilePath = '';

const SCORE_NOTIFY_MUTE_KEY = 'multiInviteScoreNotifyMuted';
const SCORE_NOTIFY_VOICE_KEY = 'multiInviteScoreNotifyVoice';
const DEFAULT_SCORE_NOTIFY_VOICE = 'zh-CN-XiaoxiaoNeural';
const SCORE_NOTIFY_VOICE_OPTIONS: ScoreNotifyVoiceOption[] = [
  { name: '女声 粤语', value: 'zh-HK-HiuMaanNeural' },
  { name: '男声 粤语', value: 'zh-HK-WanLungNeural' },
  { name: '女声', value: 'zh-CN-XiaoxiaoNeural' },
  { name: '男声', value: 'zh-CN-YunhaoNeural' },
];

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
    currentMemberIsSpectator: false,
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
    memberActionDialogVisible: false,
    memberActionTargetId: 0,
    memberActionTargetName: '',
    memberActionType: 'transfer' as 'transfer' | 'kick',
    scoreNotifyDialogVisible: false,
    scoreNotifyVoiceOptions: SCORE_NOTIFY_VOICE_OPTIONS,
    roomType: 'MULTI' as string,
    isCompactLayout: false,
    poolStatsTableWidth: 690,
    ttsMuted: true,
    ttsVoice: DEFAULT_SCORE_NOTIFY_VOICE,
    ttsVoiceLabel: '女声',
  },

  onLoad(options: Record<string, string | undefined>) {
    this.enableShareMenus();
    this.disconnectRealtime(true);
    this.initScoreNotifyAudio();
    this.syncLayoutMode();
    const roomCode = (options.roomCode || '').replace(/\D/g, '').slice(0, ROOM_CODE_LENGTH);
    if (roomCode.length === ROOM_CODE_LENGTH) {
      this.setRoomCode(roomCode);
      this.loadEntryRoom(roomCode);
    }
  },

  onShow() {
    (this as any)._applyFontSize();
    this.initScoreNotifyAudio();
    this.syncLayoutMode();
    if (!roomEntryLoading) {
      this.refreshRoomState(true);
    }
    this.connectRealtime();
  },

  onResize() {
    this.syncLayoutMode();
  },

  onHide() {
    this.resetScoreNotifyState();
    this.disconnectRealtime(true);
  },

  onUnload() {
    this.destroyScoreNotifyAudio();
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

  getScoreNotifyVoiceOption(value?: string): ScoreNotifyVoiceOption {
    return SCORE_NOTIFY_VOICE_OPTIONS.find((item) => item.value === value)
      || SCORE_NOTIFY_VOICE_OPTIONS[2];
  },

  getStoredScoreNotifyMuted(): boolean {
    const storedValue = wx.getStorageSync(SCORE_NOTIFY_MUTE_KEY);

    if (storedValue === '' || typeof storedValue === 'undefined') {
      return true;
    }

    if (typeof storedValue === 'string') {
      const normalizedValue = storedValue.trim().toLowerCase();
      if (!normalizedValue) {
        return true;
      }
      return normalizedValue !== '0' && normalizedValue !== 'false';
    }

    return Boolean(storedValue);
  },

  setStoredScoreNotifyMuted(muted: boolean) {
    wx.setStorageSync(SCORE_NOTIFY_MUTE_KEY, muted ? '1' : '0');
  },

  initScoreNotifyAudio() {
    const ttsMuted = this.getStoredScoreNotifyMuted();
    const storedVoice = String(wx.getStorageSync(SCORE_NOTIFY_VOICE_KEY) || '').trim();
    const voiceOption = this.getScoreNotifyVoiceOption(storedVoice);

    if (
      ttsMuted !== this.data.ttsMuted ||
      voiceOption.value !== this.data.ttsVoice ||
      voiceOption.name !== this.data.ttsVoiceLabel
    ) {
      this.setData({
        ttsMuted,
        ttsVoice: voiceOption.value,
        ttsVoiceLabel: voiceOption.name,
      });
    }

    if (!scoreNotifyAudioContext) {
      scoreNotifyAudioContext = wx.createInnerAudioContext();
      scoreNotifyAudioContext.autoplay = false;
      scoreNotifyAudioContext.onEnded(() => {
        this.finishScoreNotifyPlayback();
        void this.playNextScoreNotifyAudio();
      });
      scoreNotifyAudioContext.onError(() => {
        this.finishScoreNotifyPlayback();
        void this.playNextScoreNotifyAudio();
      });
    }

    if (!scoreNotifyPreviewAudioContext) {
      scoreNotifyPreviewAudioContext = wx.createInnerAudioContext();
      scoreNotifyPreviewAudioContext.autoplay = false;
      scoreNotifyPreviewAudioContext.onEnded(() => {
        this.finishScoreNotifyPreview();
        void this.playNextScoreNotifyAudio();
      });
      scoreNotifyPreviewAudioContext.onError(() => {
        this.finishScoreNotifyPreview();
        void this.playNextScoreNotifyAudio();
      });
    }

    scoreNotifyQueue = [];
    scoreNotifyPlaying = false;
    scoreNotifyInitialized = false;
    scoreNotifyLastSeenRecordId = 0;
    scoreNotifyCurrentTempFilePath = '';
    scoreNotifyPreviewing = false;
    scoreNotifyPreviewTempFilePath = '';
  },

  destroyScoreNotifyAudio() {
    this.stopScoreNotifyPlayback(true);
    this.stopScoreNotifyPreview(false);
    if (scoreNotifyAudioContext) {
      scoreNotifyAudioContext.destroy();
      scoreNotifyAudioContext = null;
    }
    if (scoreNotifyPreviewAudioContext) {
      scoreNotifyPreviewAudioContext.destroy();
      scoreNotifyPreviewAudioContext = null;
    }
  },

  resetScoreNotifyState() {
    this.stopScoreNotifyPlayback(true);
    this.stopScoreNotifyPreview(false);
    scoreNotifyInitialized = false;
    scoreNotifyLastSeenRecordId = 0;
    if (this.data.scoreNotifyDialogVisible) {
      this.setData({ scoreNotifyDialogVisible: false });
    }
  },

  setScoreNotifyMuted(nextMuted: boolean, toastTitle?: string) {
    this.setStoredScoreNotifyMuted(nextMuted);
    this.setData({ ttsMuted: nextMuted });

    if (nextMuted) {
      this.stopScoreNotifyPlayback(true);
    } else {
      void this.playNextScoreNotifyAudio();
    }

    if (toastTitle) {
      wx.showToast({ title: toastTitle, icon: 'none' });
    }
  },

  openScoreNotifyDialog() {
    this.setData({ scoreNotifyDialogVisible: true });
  },

  closeScoreNotifyDialog() {
    this.stopScoreNotifyPreview();
    this.setData({ scoreNotifyDialogVisible: false });
  },

  selectScoreNotifyVoice(e: WechatMiniprogram.BaseEvent) {
    const voice = String(e.currentTarget.dataset.voice || '').trim();
    const option = this.getScoreNotifyVoiceOption(voice);

    if (option.value === this.data.ttsVoice) {
      return;
    }

    wx.setStorageSync(SCORE_NOTIFY_VOICE_KEY, option.value);
    this.setData({
      ttsVoice: option.value,
      ttsVoiceLabel: option.name,
    });
  },

  async previewScoreNotifyVoice(e: WechatMiniprogram.BaseEvent) {
    const voice = String(e.currentTarget.dataset.voice || '').trim();
    const option = this.getScoreNotifyVoiceOption(voice);

    if (!this.data.roomId) {
      wx.showToast({ title: '房间信息异常', icon: 'none' });
      return;
    }

    if (scoreNotifyPlaying) {
      wx.showToast({ title: '当前正在播报，请稍后试听', icon: 'none' });
      return;
    }

    if (!scoreNotifyPreviewAudioContext) {
      this.initScoreNotifyAudio();
    }

    this.stopScoreNotifyPreview(false);
    scoreNotifyPreviewing = true;
    wx.showLoading({ title: '试听生成中...' });

    try {
      const tempFilePath = await this.downloadScoreNotifyPreviewAudio(option.value);
      scoreNotifyPreviewTempFilePath = tempFilePath;
      if (!scoreNotifyPreviewAudioContext) {
        throw new Error('preview_audio_context_missing');
      }
      scoreNotifyPreviewAudioContext.src = tempFilePath;
      scoreNotifyPreviewAudioContext.play();
    } catch (_error) {
      this.finishScoreNotifyPreview();
      wx.showToast({ title: '试听失败，请稍后重试', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  confirmScoreNotifyDialog() {
    const nextMuted = !this.data.ttsMuted;
    this.stopScoreNotifyPreview(false);
    this.setScoreNotifyMuted(
      nextMuted,
      nextMuted ? '已关闭语音播报' : '已开启语音播报',
    );
    this.setData({ scoreNotifyDialogVisible: false });
  },

  handleScoreRecordNotifications(
    currentMemberId: number,
    scoreRecords: RoomScoreRecordView[],
  ) {
    const latestRecordId = scoreRecords.reduce((maxId, record) => {
      return record.id > maxId ? record.id : maxId;
    }, 0);

    if (!scoreNotifyInitialized) {
      scoreNotifyInitialized = true;
      scoreNotifyLastSeenRecordId = latestRecordId;
      return;
    }

    const newRecords = scoreRecords
      .filter((record) => record.id > scoreNotifyLastSeenRecordId)
      .sort((left, right) => left.id - right.id);
    scoreNotifyLastSeenRecordId = latestRecordId;

    if (this.data.ttsMuted || newRecords.length === 0) {
      return;
    }

    const targetRecords = newRecords.filter((record) => {
      return (
        record.toMemberId === currentMemberId &&
        (record.recordType === 'NORMAL' || record.recordType === 'KICK_REFUND')
      );
    });

    if (targetRecords.length === 0) {
      return;
    }

    scoreNotifyQueue.push(...targetRecords);
    void this.playNextScoreNotifyAudio();
  },

  async playNextScoreNotifyAudio() {
    if (scoreNotifyPlaying || scoreNotifyPreviewing || this.data.ttsMuted) {
      return;
    }

    const nextRecord = scoreNotifyQueue.shift();
    if (!nextRecord || !this.data.roomId || !scoreNotifyAudioContext) {
      return;
    }

    scoreNotifyPlaying = true;

    try {
      const tempFilePath = await this.downloadScoreNotifyAudio(nextRecord.id);
      scoreNotifyCurrentTempFilePath = tempFilePath;
      scoreNotifyAudioContext.src = tempFilePath;
      scoreNotifyAudioContext.play();
    } catch (_error) {
      this.finishScoreNotifyPlayback();
      void this.playNextScoreNotifyAudio();
    }
  },

  finishScoreNotifyPlayback() {
    scoreNotifyPlaying = false;

    if (scoreNotifyCurrentTempFilePath) {
      const tempFilePath = scoreNotifyCurrentTempFilePath;
      scoreNotifyCurrentTempFilePath = '';
      try {
        wx.getFileSystemManager().unlink({
          filePath: tempFilePath,
          fail: () => undefined,
        });
      } catch (_error) {
        // ignore cleanup errors
      }
    }
  },

  finishScoreNotifyPreview() {
    scoreNotifyPreviewing = false;

    if (scoreNotifyPreviewTempFilePath) {
      const tempFilePath = scoreNotifyPreviewTempFilePath;
      scoreNotifyPreviewTempFilePath = '';
      try {
        wx.getFileSystemManager().unlink({
          filePath: tempFilePath,
          fail: () => undefined,
        });
      } catch (_error) {
        // ignore cleanup errors
      }
    }
  },

  stopScoreNotifyPlayback(clearQueue = false) {
    if (clearQueue) {
      scoreNotifyQueue = [];
    }

    if (scoreNotifyAudioContext) {
      try {
        scoreNotifyAudioContext.stop();
      } catch (_error) {
        // ignore stop errors
      }
    }

    this.finishScoreNotifyPlayback();
  },

  stopScoreNotifyPreview(resumePlayback = true) {
    const wasPreviewing = scoreNotifyPreviewing;

    if (scoreNotifyPreviewAudioContext) {
      try {
        scoreNotifyPreviewAudioContext.stop();
      } catch (_error) {
        // ignore stop errors
      }
    }

    this.finishScoreNotifyPreview();

    if (resumePlayback && wasPreviewing) {
      void this.playNextScoreNotifyAudio();
    }
  },

  downloadScoreNotifyAudio(recordId: number): Promise<string> {
    const roomId = this.data.roomId;
    if (!roomId) {
      return Promise.reject(new Error('room_id_missing'));
    }
    const voice = encodeURIComponent(this.data.ttsVoice || DEFAULT_SCORE_NOTIFY_VOICE);

    return new Promise((resolve, reject) => {
      wx.downloadFile({
        url: `${API_BASE_URL}/rooms/${roomId}/score-records/${recordId}/audio?voice=${voice}`,
        header: buildRequestHeader(),
        success: (res) => {
          if (
            res.statusCode >= 200 &&
            res.statusCode < 300 &&
            res.tempFilePath
          ) {
            resolve(res.tempFilePath);
            return;
          }

          reject(new Error(`download_failed_${res.statusCode}`));
        },
        fail: reject,
      });
    });
  },

  downloadScoreNotifyPreviewAudio(voice: string): Promise<string> {
    const roomId = this.data.roomId;
    if (!roomId) {
      return Promise.reject(new Error('room_id_missing'));
    }
    const encodedVoice = encodeURIComponent(voice || DEFAULT_SCORE_NOTIFY_VOICE);

    return new Promise((resolve, reject) => {
      wx.downloadFile({
        url: `${API_BASE_URL}/rooms/${roomId}/score-notify-preview/audio?voice=${encodedVoice}`,
        header: buildRequestHeader(),
        success: (res) => {
          if (
            res.statusCode >= 200 &&
            res.statusCode < 300 &&
            res.tempFilePath
          ) {
            resolve(res.tempFilePath);
            return;
          }

          reject(new Error(`preview_download_failed_${res.statusCode}`));
        },
        fail: reject,
      });
    });
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

  async loadEntryRoom(roomCode: string) {
    roomEntryLoading = true;
    wx.showLoading({ title: '加载中...' });

    try {
      try {
        const payload = await getRoomByCode(roomCode);
        this.applyRoomPayload(payload);
        return;
      } catch (error) {
        const requestError = error as RequestError;
        if (!this.shouldAutoJoinEntry(requestError)) {
          wx.showToast({
            title: requestError.message || '拉取房间失败',
            icon: 'none',
          });
          return;
        }
      }

      await this.joinRoomFromShare(roomCode);
    } finally {
      wx.hideLoading();
      roomEntryLoading = false;
    }
  },

  shouldAutoJoinEntry(error: RequestError): boolean {
    return error.statusCode === 401 || error.statusCode === 403;
  },

  async joinRoomFromShare(roomCode: string) {
    let guestNickname: string | undefined;

    if (!getAccessToken() && !getGuestToken()) {
      wx.hideLoading();
      const inputNickname = await promptGuestNickname('游客昵称', '请输入昵称后加入房间');
      if (!inputNickname) {
        wx.showToast({ title: '已取消加入房间', icon: 'none' });
        return;
      }
      guestNickname = inputNickname;
      wx.showLoading({ title: '加入中...' });
    }

    const payload = await joinRoom(roomCode, guestNickname);
    this.applyRoomPayload(payload);
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

    if (action === 'leave') {
      this.handleLeaveRoom();
      return;
    }

    if (action === 'manage') {
      this.openSpectatorDialog();
      return;
    }

    if (action === 'mute') {
      this.openScoreNotifyDialog();
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

    if (this.data.currentMemberIsSpectator) {
      wx.showToast({ title: '旁观者不能操作', icon: 'none' });
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

    if (this.data.currentMemberIsSpectator) {
      wx.showToast({ title: '旁观者不能操作', icon: 'none' });
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

  openMemberActionDialog(e: WechatMiniprogram.BaseEvent) {
    if (!this.data.isOwner) {
      wx.showToast({ title: '只有桌主可以操作成员', icon: 'none' });
      return;
    }

    if (this.data.roomStatus !== 'IN_PROGRESS') {
      wx.showToast({ title: '房间已结束，无法操作成员', icon: 'none' });
      return;
    }

    const targetMemberId = Number(e.currentTarget.dataset.memberId || 0);
    const targetMemberName = String(e.currentTarget.dataset.memberName || '');

    if (!targetMemberId) {
      return;
    }

    this.setData({
      memberActionDialogVisible: true,
      memberActionTargetId: targetMemberId,
      memberActionTargetName: targetMemberName,
      memberActionType: 'transfer',
    });
  },

  closeMemberActionDialog() {
    this.setData({
      memberActionDialogVisible: false,
      memberActionTargetId: 0,
      memberActionTargetName: '',
      memberActionType: 'transfer',
    });
  },

  selectMemberAction(e: WechatMiniprogram.BaseEvent) {
    const actionType = String(e.currentTarget.dataset.actionType || '') as 'transfer' | 'kick';
    if (actionType !== 'transfer' && actionType !== 'kick') {
      return;
    }
    this.setData({ memberActionType: actionType });
  },

  async confirmMemberAction() {
    if (!this.data.isOwner) {
      wx.showToast({ title: '只有桌主可以操作成员', icon: 'none' });
      return;
    }

    if (this.data.roomStatus !== 'IN_PROGRESS') {
      wx.showToast({ title: '房间已结束，无法操作成员', icon: 'none' });
      return;
    }

    const targetMemberId = this.data.memberActionTargetId;
    if (!targetMemberId) {
      return;
    }

    const isTransfer = this.data.memberActionType === 'transfer';

    wx.showLoading({ title: isTransfer ? '转移中...' : '处理中...' });
    try {
      const payload = isTransfer
        ? await transferRoomOwner(this.data.roomId, targetMemberId)
        : await kickRoomMember(this.data.roomId, targetMemberId);
      this.applyRoomPayload(payload);
      this.closeMemberActionDialog();
      wx.showToast({ title: isTransfer ? '转移成功' : '已踢出', icon: 'success' });
    } catch (error) {
      wx.showToast({
        title: (error as RequestError).message || (isTransfer ? '转移失败' : '踢人失败'),
        icon: 'none',
      });
    } finally {
      wx.hideLoading();
    }
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

  handleLeaveRoom() {
    if (this.data.isOwner) {
      wx.showToast({ title: '桌主请使用结束按钮', icon: 'none' });
      return;
    }

    wx.showModal({
      title: '退出房间',
      content: '退出后将离开当前房间，是否继续？',
      success: async (res: WechatMiniprogram.ShowModalSuccessCallbackResult) => {
        if (!res.confirm) {
          return;
        }

        wx.showLoading({ title: '退出中...' });
        try {
          await leaveRoom(this.data.roomId);
          this.disconnectRealtime(true);
          wx.hideLoading();
          wx.showToast({ title: '已退出房间', icon: 'success' });
          setTimeout(() => {
            wx.switchTab({ url: '/pages/home/home' });
          }, 300);
        } catch (error) {
          wx.hideLoading();
          wx.showToast({
            title: (error as RequestError).message || '退出房间失败',
            icon: 'none',
          });
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

    this.handleScoreRecordNotifications(currentMemberId, scoreRecords);

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
      currentMemberIsSpectator: Boolean(currentMember?.isSpectator),
      inviteCardHiddenBySelf,
      showInlineInviteCard,
      isPoolMode,
      tableFeeEnabled: payload.room.tableFeeEnabled || false,
      activePoolRound: (payload.room as any).activePoolRound || null,
    });

    if (isPoolMode) {
      this.loadPoolRounds();
    } else {
      this.setData({
        poolRounds: [],
        poolStatsMembers: [],
        poolStatsTableWidth: 690,
      });
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

  goToRoundDetail(e: any) {
    const roundId = Number(e.currentTarget.dataset.roundId || 0);
    if (!roundId) return;
    wx.navigateTo({
      url: `/subpkg/pool-record/pool-record?roomId=${this.data.roomId}&roundId=${roundId}`,
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

      this.setData({
        poolRounds,
        poolStatsMembers,
        poolStatsTableWidth: Math.max(690, 170 + poolStatsMembers.length * 112),
      });
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
        path: `/pages/home/home?roomCode=${roomCode}&shareSource=app-message`,
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
        query: `roomCode=${roomCode}&shareSource=timeline`,
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
