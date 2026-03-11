Component({
  properties: {
    title: {
      type: String,
      value: '记分明细',
    },
    emptyText: {
      type: String,
      value: '暂无记分记录',
    },
    normalActionText: {
      type: String,
      value: '给了',
    },
    records: {
      type: Array,
      value: [],
    },
  },
});
