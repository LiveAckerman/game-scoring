Component({
  properties: {
    visible: {
      type: Boolean,
      value: false,
    },
    title: {
      type: String,
      value: '',
    },
    showClose: {
      type: Boolean,
      value: true,
    },
    showFooter: {
      type: Boolean,
      value: false,
    },
    cancelText: {
      type: String,
      value: '取消',
    },
    confirmText: {
      type: String,
      value: '确定',
    },
    maskClosable: {
      type: Boolean,
      value: true,
    },
  },
  methods: {
    onMaskTap() {
      if (this.data.maskClosable) {
        this.triggerEvent('close');
      }
    },
    onCloseTap() {
      this.triggerEvent('close');
    },
    onCancelTap() {
      this.triggerEvent('cancel');
    },
    onConfirmTap() {
      this.triggerEvent('confirm');
    },
    stopPropagation() {
      // 阻止弹窗内容点击冒泡到遮罩层
    },
  },
});
