Component({
  properties: {
    roomCode: { type: String, value: '' },
    status: { type: String, value: 'IN_PROGRESS' },
    statusText: { type: String, value: '' },
    roomType: { type: String, value: 'MULTI' },
    members: { type: Array, value: [] },
    timeText: { type: String, value: '' },
    durationText: { type: String, value: '' },
    myScoreText: { type: String, value: '' },
    scoreCount: { type: Number, value: -1 },
    showName: { type: Boolean, value: false },
    faded: { type: Boolean, value: false },
  },

  methods: {
    onCardTap() {
      this.triggerEvent('cardtap');
    },
  },
});
