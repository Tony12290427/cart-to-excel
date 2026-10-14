import { Badge, fmtTime, isManager } from '../display.jsx';

const needsPurchase = order => order.state === 'active' && order.items.some(item => item.unpurchased > 0);
const needsPickup = order => order.state === 'active' && order.batches.some(batch => batch.arrived_at && !batch.claimed_at);
const needsCheck = order => order.state === 'active' && (order.items.some(item => item.outstanding > 0) || order.issues.some(issue => !issue.resolved_at));
const needsReview = order => order.state === 'review' || (order.state === 'active' && order.source_state !== 'current');
const categories = [
  ['purchase', '待下单 / 未全部下单', needsPurchase],
  ['pickup', '已到校 · 待领取', needsPickup],
  ['check', '已下单 · 未验收齐全', needsCheck],
  ['review', '原表 / 历史订单待核实', needsReview],
];

export default function Orders({ config, user, orders, sync, selected, filter, search, busy,
  onFilter, onSearch, onSelect, onRefresh, onSync, onMembers, children }) {
  const predicate = categories.find(([key]) => key === filter)?.[2];
  const query = search.toLowerCase();
  const visible = orders.filter(order => (!predicate || predicate(order)) &&
    `${order.title} ${order.competition} ${order.student_name}`.toLowerCase().includes(query));
  return <>
    <div className="page-head">
      <div><h1>团队订单</h1><p className="muted">下单、到校和验收分别确认。缺少的商品继续留在待办里。</p></div>
      <div className="actions">
        {user.role === 'admin' && <button disabled={busy} onClick={onMembers}>成员与角色</button>}
        <button disabled={busy} onClick={onRefresh}>刷新进度</button>
        {isManager(user) && <button className="primary" disabled={busy} onClick={onSync}>立即同步 Drive</button>}
      </div>
    </div>
    <div className="sync-info">
      {config.demo ? '虚构 Drive 同步演示' : `每 ${config.syncIntervalSeconds} 秒自动检查 Drive`}
      {sync?.running ? ` · 正在同步 ${sync.processed || 0} / ${sync.scanned || '…'}` :
        sync?.finishedAt ? ` · 最近同步 ${fmtTime(sync.finishedAt)}` : ' · 尚未完成同步'}
      {sync?.ok === false && <> · <strong className="danger">{sync.error || '部分表格读取失败，请查看待核实列表'}</strong></>}
    </div>
    <div className="metrics">{categories.map(([key, title, matches]) =>
      <button key={key} className={`metric ${filter === key ? 'active' : ''}`} aria-pressed={filter === key}
        disabled={busy} onClick={() => onFilter(key)}>
        <strong>{orders.filter(matches).length}</strong><span>{title}</span>
      </button>
    )}</div>
    <div className="workspace">
      <aside>
        <div className="filter-bar">
          <button className="small" disabled={busy} aria-pressed={filter === 'all'} onClick={() => onFilter('all')}>全部</button>
          <input type="search" placeholder="搜索订单 / 项目 / 姓名" aria-label="搜索订单" value={search} onChange={event => onSearch(event.target.value)} />
        </div>
        <div className="order-list">{visible.length ? visible.map(order =>
          <button key={order.id} className={`order-card ${order.id === selected ? 'selected' : ''}`}
            aria-pressed={order.id === selected} disabled={busy} onClick={() => onSelect(order.id)}>
            <strong>{order.title}</strong><Badge status={order.status} />
            {order.source_state !== 'current' && <span className="badge red">原表待核实</span>}
            <div className="meta-line muted"><span>{order.student_name || '提交人未填写'}</span><span>{order.items.length} 项</span></div>
          </button>
        ) : <p className="empty">此分类暂无订单。</p>}</div>
      </aside>
      <section id="detail" aria-label="订单详情">{children}</section>
    </div>
  </>;
}
