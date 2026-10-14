import { useState } from 'react';
import { actionLabels, Badge, fmtTime, isManager, safeLink } from '../display.jsx';

function Purchase({ order, editable, busy, onMutate }) {
  function save(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onMutate('purchase', { lines: order.items.map(item => ({ itemId: item.id, quantity: Number(form.get(item.id)) })) });
  }
  return <div className="panel">
    <div className="section-head">
      <div><span className="step">01 · 管理方</span><h2>下单数量</h2></div>
      {editable && <button className="small" disabled={busy} onClick={() =>
        onMutate('purchase', { lines: order.items.map(item => ({ itemId: item.id, quantity: item.requested })) })}>全部商品已下单</button>}
    </div>
    <form onSubmit={save}>
      <fieldset disabled={busy}>
        <div className="table-scroll"><table>
          <thead><tr><th>商品</th><th>申请</th><th>已下单总数</th><th>已验收</th><th>未下单</th><th>待验收</th></tr></thead>
          <tbody>{order.items.map(item => <tr key={item.id}>
            <td>{item.name}<div className="muted">{item.type}</div></td><td>{item.requested}</td>
            <td>{editable ? <input type="number" name={item.id} defaultValue={item.ordered}
              min={item.received} max={item.requested} step="0.001" required aria-label={`${item.name}已下单总数量`} /> :
              order.state === 'review' ? '—' : item.ordered}</td>
            <td className="checked">{order.state === 'review' ? '—' : item.received}</td>
            <td>{order.state === 'review' ? '—' : item.unpurchased}</td>
            <td>{order.state === 'review' ? '—' : item.outstanding}</td>
          </tr>)}</tbody>
        </table></div>
        {editable && <div className="actions field"><button className="primary" type="submit">保存下单数量</button>
          <span className="muted">填写累计已下单数量，个别未买的商品保持为 0。</span></div>}
      </fieldset>
    </form>
  </div>;
}

function ReceiptForm({ order, batchId, busy, onMutate, onCancel }) {
  function save(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onMutate('receive', { batchId, lines: order.items.map(item => ({
      itemId: item.id, quantity: Number(form.get('q-' + item.id)), issue: form.get('issue-' + item.id),
    })) });
  }
  return <form className="receipt-form" onSubmit={save}>
    <fieldset disabled={busy}>
      <p className="muted field">只填本次新收到、检查合格的数量。损坏或错货写在异常栏，后续补件再登记。累计不能超过已下单数量。</p>
      <div className="table-scroll"><table>
        <thead><tr><th>商品</th><th>待验收</th><th>本次合格数量</th><th>异常说明（可选）</th></tr></thead>
        <tbody>{order.items.map(item => <tr key={item.id}>
          <td>{item.name}</td><td>{item.outstanding}</td>
          <td><input type="number" name={'q-' + item.id} defaultValue="0" min="0" max={item.outstanding}
            step="0.001" required aria-label={`${item.name}本次合格数量`} /></td>
          <td><input name={'issue-' + item.id} maxLength={1000} placeholder="缺件、错货、损坏" aria-label={`${item.name}异常说明`} /></td>
        </tr>)}</tbody>
      </table></div>
      <div className="actions field"><button type="submit" className="primary">确认本次验收</button>
        <button type="button" onClick={onCancel}>取消</button></div>
    </fieldset>
  </form>;
}

function Batches({ order, active, manager, busy, onMutate }) {
  const [openReceipts, setOpenReceipts] = useState(new Set());
  const toggle = id => setOpenReceipts(previous => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  function addBatch(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onMutate('batches', { tracking: form.get('tracking'), note: form.get('note'), arrived: form.get('arrived') === 'on' });
  }
  return <div className="panel">
    <div className="section-head"><div><span className="step">02 · 管理方确认到校 / 学生逐项验收</span><h2>到货批次</h2></div></div>
    {!order.batches.length && <p className="muted">尚未登记到货批次。通常整单集运一次；分批到货时新增一批。</p>}
    {order.batches.map((batch, index) => <div className="batch" key={batch.id}>
      <div className="batch-head">
        <div><strong>第 {index + 1} 批 {batch.tracking && `· ${batch.tracking}`}</strong>
          <div className="muted">{batch.arrived_at ? `到校 ${fmtTime(batch.arrived_at)}` : '尚未确认到校'}
            {batch.claimed_at && ` · ${batch.claimed_name} 已领取 ${fmtTime(batch.claimed_at)}`}</div>
        </div>
        {active && (batch.arrived_at ?
          <button className="small primary" disabled={busy} aria-expanded={openReceipts.has(batch.id)} onClick={() => toggle(batch.id)}>
            {batch.claimed_at ? '补充验收' : '领取并验收'}</button> : manager &&
          <button className="small primary" disabled={busy} onClick={() => onMutate('arrive', { batchId: batch.id })}>确认送到学校</button>)}
      </div>
      {batch.note && <p className="muted">{batch.note}</p>}
      {active && openReceipts.has(batch.id) && <ReceiptForm order={order} batchId={batch.id} busy={busy}
        onMutate={onMutate} onCancel={() => toggle(batch.id)} />}
    </div>)}
    {active && manager && <details open={!order.batches.length}>
      <summary>新增一批快递</summary>
      <form onSubmit={addBatch}><fieldset disabled={busy}>
        <label className="field"><span>快递单号（可选）</span><input className="full" name="tracking" maxLength={150} placeholder="没有单号也可以登记" /></label>
        <label className="field"><span>备注 / 收货位置（可选）</span><input className="full" name="note" maxLength={1000} placeholder="例如：已送到学校收货点" /></label>
        <label className="field"><input type="checkbox" name="arrived" /> 这批已经送到学校</label>
        <button className="primary" type="submit">新增到货批次</button>
      </fieldset></form>
    </details>}
  </div>;
}

export default function OrderDetail({ order, user, demo, busy, onMutate }) {
  const manager = isManager(user);
  const active = order.state === 'active' && order.source_state === 'current';
  function resolveIssue(issueId) {
    const resolution = window.prompt('填写处理结果。缺少的数量仍须另行验收。');
    if (resolution?.trim()) onMutate('resolve-issue', { issueId, resolution });
  }
  function voidReceipt(receiptId) {
    const reason = window.prompt('请输入更正原因。原记录会保留，数量从累计验收中扣除。');
    if (reason?.trim()) onMutate('void-receipt', { receiptId, reason });
  }
  return <>
    <div className="panel">
      <div className="detail-head"><h2>{order.title}</h2><p className="muted">{order.competition}{order.student_name && ` · ${order.student_name}`}</p>
        <div className="actions"><Badge status={order.status} />
          {!demo && <a href={safeLink(order.url)} target="_blank" rel="noopener noreferrer">打开 Drive 原表 ↗</a>}
        </div>
      </div>
      {order.source_state === 'changed' ? <div className="alert">
        <strong>Drive 原表发生变更</strong><p>进度已保留。管理方核对商品和数量后才能继续。</p>
        <details><summary>查看新商品清单</summary>{order.pendingSource?.items.map((item, index) => <p key={index}>{item.name} × {item.quantity}</p>)}</details>
        {manager && <button disabled={busy} onClick={() => onMutate('accept-source')}>核对后应用变更</button>}
      </div> : order.source_state !== 'current' && <div className="alert red">
        {order.import_error || '原表移出了同步文件夹或失去读取权限。已有记录保留，待恢复读取。'}
      </div>}
      {order.state === 'review' && <div className="alert">这份表尚未确认纳入。历史已完成订单可以归档，预算表可以排除。</div>}
      {manager && <div className="actions">
        {order.state !== 'active' && order.source_state === 'current' && <button className="primary" disabled={busy}
          onClick={() => onMutate('classify', { state: 'active' })}>确认纳入订单</button>}
        <button className="small" disabled={busy} onClick={() => onMutate('classify', { state: 'archived' })}>历史归档</button>
        <button className="small" disabled={busy} onClick={() => onMutate('classify', { state: 'excluded' })}>排除非订单</button>
      </div>}
    </div>
    <Purchase order={order} editable={active && manager} busy={busy} onMutate={onMutate} />
    <Batches order={order} active={active} manager={manager} busy={busy} onMutate={onMutate} />
    {!!order.issues.length && <div className="panel"><h2>缺件 / 错货 / 损坏跟进</h2>
      {order.issues.map(issue => <div className="issue" key={issue.id}><strong>{issue.item_name}</strong><p>{issue.description}</p>
        {issue.resolved_at ? <p className="muted">已处理：{issue.resolution} · {issue.resolved_name}</p> : active &&
          <button className="small" disabled={busy} onClick={() => resolveIssue(issue.id)}>记录处理结果</button>}
      </div>)}
    </div>}
    <div className="panel"><span className="step">03 · 留存实际操作人</span><h2>验收记录</h2>
      {order.receipts.length ? order.receipts.map(receipt => <div className="history" key={receipt.id}>
        <strong>{receipt.actor_name}</strong> · {fmtTime(receipt.created_at)}{receipt.voided_at && <> · <b className="danger">已更正</b></>}
        <p>{receipt.lines.filter(line => line.quantity > 0).map(line => `${line.name} × ${line.quantity}`).join('；') || '本次登记了异常'}</p>
        {receipt.voided_at ? <span>更正原因：{receipt.void_reason}</span> : active && (manager || receipt.actor_id === user.id) &&
          <button className="small" disabled={busy} onClick={() => voidReceipt(receipt.id)}>更正这条记录</button>}
      </div>) : <p className="muted">尚未验收。到校后，团队学生均可领取并逐项登记。</p>}
      <details><summary>完整操作历史</summary>{order.history.map(event => <div className="history" key={event.id}>
        {actionLabels[event.action] || event.action}<span>{event.actor_name} · {fmtTime(event.created_at)}</span>
      </div>)}</details>
    </div>
  </>;
}
