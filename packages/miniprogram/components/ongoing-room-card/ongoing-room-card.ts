Component({
  properties: {
    roomCode: { type: String, value: '' },
    status: { type: String, value: 'IN_PROGRESS' },
    statusText: { type: String, value: '' },
    roomType: { type: String, value: 'MULTI' },
    members: { type: Array, value: [] },
  },

  methods: {
    onCardTap() {
      this.triggerEvent('cardtap');
    },
  },
});
