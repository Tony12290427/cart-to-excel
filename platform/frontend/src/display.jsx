export const labels = {
  review: '待核实', active: '处理中', excluded: '非订单', archived: '历史归档',
  awaiting_order: '待下单', partial_ordered: '部分下单', ordered: '已下单 · 待到校',
  awaiting_pickup: '已到校 · 待领取', partial_received: '部分验收 · 未到齐',
  issue: '有待处理异常', complete: '已到齐', student: '学生', manager: '管理方',
  admin: '管理员', pending: '待批准', disabled: '已停用',
};

export const actionLabels = {
  import: '同步导入', source_changed: 'Drive 原表有变更',
  source_missing: '原表移出文件夹或不可访问', classification: '确认订单分类',
  purchase: '更新下单数量', batch_added: '新增到货批次', arrived_at_school: '确认到校',
  receipt: '领取并登记验收', void_receipt: '更正验收记录',
  resolve_issue: '处理异常', accept_source_changes: '确认原表变更',
};

export const isManager = user => ['manager', 'admin'].includes(user?.role);
export const isMember = user => ['student', 'manager', 'admin'].includes(user?.role);
export const safeLink = value => /^https:\/\/(docs|drive)\.google\.com\//.test(value || '') ? value : '#';
export const fmtTime = value => value ? new Date(value).toLocaleString('zh-HK', {
  timeZone: 'Asia/Hong_Kong', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
}) : '—';

export function Badge({ status }) {
  const color = status === 'complete' ? 'green' : status === 'issue' ? 'red' :
    ['review', 'awaiting_order', 'partial_ordered', 'awaiting_pickup', 'partial_received'].includes(status) ? 'amber' : '';
  return <span className={`badge ${color}`}>{labels[status] || status}</span>;
}
