import { fontSizeBehavior } from '../../behaviors/font-size';
import {
  createRoomTag,
  deleteRoomTag,
  listRoomTags,
  RoomTag,
  TAG_COLOR_PALETTE,
  updateRoomTag,
} from '../../utils/tags';

Page({
  behaviors: [fontSizeBehavior],
  data: {
    tags: [] as RoomTag[],
    colorPalette: TAG_COLOR_PALETTE,
    editorVisible: false,
    editorMode: 'create' as 'create' | 'edit',
    editingTagId: '',
    editorName: '',
    editorColor: TAG_COLOR_PALETTE[0],
  },

  onShow() {
    (this as any)._applyFontSize();
    this.reloadTags();
  },

  goBack() {
    wx.navigateBack();
  },

  noop() {
    // Prevent tap bubbling inside the sheet.
  },

  reloadTags() {
    this.setData({ tags: listRoomTags() });
  },

  openCreateEditor() {
    this.setData({
      editorVisible: true,
      editorMode: 'create',
      editingTagId: '',
      editorName: '',
      editorColor: TAG_COLOR_PALETTE[0],
    });
  },

  openEditEditor(e: WechatMiniprogram.BaseEvent) {
    const tagId = String(e.currentTarget.dataset.tagId || '');
    const tag = this.data.tags.find((item) => item.id === tagId);
    if (!tag) {
      return;
    }

    this.setData({
      editorVisible: true,
      editorMode: 'edit',
      editingTagId: tag.id,
      editorName: tag.name,
      editorColor: tag.color,
    });
  },

  closeEditor() {
    this.setData({
      editorVisible: false,
      editingTagId: '',
      editorName: '',
      editorColor: TAG_COLOR_PALETTE[0],
    });
  },

  onEditorNameInput(e: WechatMiniprogram.CustomEvent) {
    const value = String((e.detail as { value?: string }).value || '').slice(0, 12);
    this.setData({ editorName: value });
  },

  selectColor(e: WechatMiniprogram.BaseEvent) {
    const color = String(e.currentTarget.dataset.color || '');
    if (!color) {
      return;
    }

    this.setData({ editorColor: color });
  },

  saveTag() {
    try {
      if (this.data.editorMode === 'edit') {
        updateRoomTag(this.data.editingTagId, {
          name: this.data.editorName,
          color: this.data.editorColor,
        });
      } else {
        createRoomTag(this.data.editorName, this.data.editorColor);
      }
      this.reloadTags();
      this.closeEditor();
      wx.showToast({ title: '保存成功', icon: 'success' });
    } catch (error) {
      wx.showToast({
        title: (error as Error).message || '保存失败',
        icon: 'none',
      });
    }
  },

  handleDeleteTag(e: WechatMiniprogram.BaseEvent) {
    const tagId = String(e.currentTarget.dataset.tagId || '');
    const tagName = String(e.currentTarget.dataset.tagName || '');

    if (!tagId) {
      return;
    }

    wx.showModal({
      title: '删除标签',
      content: `确认删除标签“${tagName}”吗？已绑定的房间也会一起取消。`,
      success: (res: WechatMiniprogram.ShowModalSuccessCallbackResult) => {
        if (!res.confirm) {
          return;
        }

        deleteRoomTag(tagId);
        this.reloadTags();
        wx.showToast({ title: '已删除', icon: 'success' });
      },
    });
  },
});
