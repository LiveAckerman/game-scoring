Component({
  properties: {
    roomCode: {
      type: String,
      value: '',
    },
    codeDigits: {
      type: Array,
      value: ['', '', '', '', '', ''],
    },
    codeFocus: {
      type: Boolean,
      value: false,
    },
    roomStatus: {
      type: String,
      value: 'IN_PROGRESS',
    },
    showClose: {
      type: Boolean,
      value: false,
    },
    editable: {
      type: Boolean,
      value: true,
    },
    showJoinButton: {
      type: Boolean,
      value: true,
    },
    showCopyButton: {
      type: Boolean,
      value: true,
    },
    joinButtonText: {
      type: String,
      value: '加入房间',
    },
    copyButtonText: {
      type: String,
      value: '复制房间号',
    },
    showShareButton: {
      type: Boolean,
      value: false,
    },
    tipText: {
      type: String,
      value: '输入房间号加入，或复制房间号分享给好友',
    },
  },
  methods: {
    onFocusCode() {
      if (!this.data.editable) {
        return;
      }
      this.triggerEvent('focuscode');
    },
    onCodeInput(e: WechatMiniprogram.CustomEvent) {
      if (!this.data.editable) {
        return;
      }
      this.triggerEvent('codeinput', e.detail);
    },
    onCodeBlur(e: WechatMiniprogram.CustomEvent) {
      if (!this.data.editable) {
        return;
      }
      this.triggerEvent('codeblur', e.detail);
    },
    onJoinTap() {
      this.triggerEvent('join');
    },
    onShareTap() {
      this.triggerEvent('share');
    },
    onCloseTap() {
      this.triggerEvent('close');
    },
  },
});
