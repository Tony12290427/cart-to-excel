const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const safeLink = v => /^https:\/\/(docs|drive)\.google\.com\//.test(v) ? v : '#';
const labels = { review:'待核实', active:'处理中', excluded:'非订单', archived:'历史归档', awaiting_order:'待下单', partial_ordered:'部分下单', ordered:'已下单 · 待到校', awaiting_pickup:'已到校 · 待领取', partial_received:'部分验收 · 未到齐', issue:'有待处理异常', complete:'已到齐', student:'学生', manager:'管理方', admin:'管理员', pending:'待批准', disabled:'已停用' };
const actions = { import:'同步导入', source_changed:'Drive 原表有变更', source_missing:'原表移出文件夹或不可访问', classification:'确认订单分类', purchase:'更新下单数量', batch_added:'新增到货批次', arrived_at_school:'确认到校', receipt:'领取并登记验收', void_receipt:'更正验收记录', resolve_issue:'处理异常', accept_source_changes:'确认原表变更' };
let config, me, csrf, orders = [], selected, filter = 'all', search = '', current, busy = false, noticeTimer;
const manager = () => ['manager', 'admin'].includes(me?.role);
const fmtTime = t => t ? new Date(t).toLocaleString('zh-HK', { timeZone:'Asia/Hong_Kong', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—';
const badge = status => `<span class="badge ${status==='complete'?'green':status==='issue'?'red':['review','awaiting_order','partial_ordered','awaiting_pickup','partial_received'].includes(status)?'amber':''}">${esc(labels[status] || status)}</span>`;
function toast(message, error=false) { const n=$('#notice'); n.textContent=message; n.className=error?'error':''; n.hidden=false; clearTimeout(noticeTimer); noticeTimer=setTimeout(()=>{n.hidden=true;},6000); }
async function api(path, data) {
  const r = await fetch('/api/' + path, { method:data===undefined?'GET':'POST', credentials:'same-origin', headers:data===undefined?{}:{'Content-Type':'application/json','X-CSRF-Token':csrf || ''}, body:data===undefined?undefined:JSON.stringify(data) });
  const b = await r.json(); if (!r.ok) { const e = new Error(b.error || '请求失败'); e.status=r.status; throw e; } return b;
}
async function action(fn) {
  if (busy) return; busy=true;
  document.querySelectorAll('button').forEach(b=>{b.disabled=true;});
  try { await fn(); } catch(e) { toast(e.message,true); if(e.status===401){me=null;login();}else if(me) await load().catch(()=>{}); }
  finally { busy=false; document.querySelectorAll('button').forEach(b=>{b.disabled=false;}); }
}
function account() { $('#account').innerHTML=me?`<span>${esc(me.name)} · ${esc(labels[me.role])}</span><button class="small" data-action="logout">${config.demo?'切换演示身份':'退出'}</button>`:''; }
function login() {
  account();
  $('#app').innerHTML=`<section class="login"><h1>把订单与到货进度放在一起</h1><p class="muted">管理方确认下单和到校，学生逐项核对收到的数量。每次操作记录实际账号和时间。</p>${config.demo?`<p class="alert">本机演示使用虚构订单，身份切换只用于验收流程。</p><div class="demo-chooser">${config.demoUsers.map(u=>`<button data-action="demo-login" data-user="${esc(u.id)}">${esc(u.name)}</button>`).join('')}</div>`:config.clientId?'<div id="google-signin"></div>':'<p class="alert">需要先配置平台 Google 登录客户端。请按 platform/README.md 操作。</p>'}</section>`;
  if (!config.demo && config.clientId) {
    const init=()=>{ google.accounts.id.initialize({client_id:config.clientId,callback:response=>action(async()=>{const r=await api('login',{credential:response.credential});me=r.user;csrf=r.csrf;await load();})});google.accounts.id.renderButton($('#google-signin'),{theme:'outline',size:'large',text:'signin_with'}); };
    if(window.google?.accounts?.id)init();else{const script=document.createElement('script');script.src='https://accounts.google.com/gsi/client';script.onload=init;script.onerror=()=>toast('Google 登录组件加载失败',true);document.head.append(script);}
  }
}
function pending() { account();$('#app').innerHTML=`<section class="login"><h1>${me.role==='disabled'?'账号已停用':'等待加入团队'}</h1><p>请让平台管理员批准你的账号，之后可以查看订单并登记验收。</p><p class="muted">若你是首位平台管理员，在后台按配置说明使用下面的 Google 账号 ID 完成首次管理员设置，再点击重新检查。</p><code>${esc(me.id)}</code><div class="actions"><button data-action="refresh">重新检查</button></div></section>`; }
async function load() {
  if(!me){login();return;} account(); if(!['student','manager','admin'].includes(me.role)){pending();return;}
  const r=await api('orders'); orders=r.orders;
  if(selected && !orders.some(o=>o.id===selected))selected=null;
  render(r.sync);
  if(selected){current=await api('orders/'+selected);renderDetail();}
}
const needsPurchase=o=>o.state==='active'&&o.items.some(i=>i.unpurchased>0);
const needsPickup=o=>o.state==='active'&&o.batches.some(b=>b.arrived_at&&!b.claimed_at);
const needsCheck=o=>o.state==='active'&&(o.items.some(i=>i.outstanding>0)||o.issues.some(i=>!i.resolved_at));
const needsReview=o=>o.state==='review'||(o.state==='active'&&o.source_state!=='current');
function visible(o) { if(filter==='purchase'&&!needsPurchase(o))return false;if(filter==='pickup'&&!needsPickup(o))return false;if(filter==='check'&&!needsCheck(o))return false;if(filter==='review'&&!needsReview(o))return false;return (o.title+' '+o.competition+' '+o.student_name).toLowerCase().includes(search.toLowerCase()); }
function render(sync) {
  const cards=[['purchase','待下单 / 未全部下单',orders.filter(needsPurchase).length],['pickup','已到校 · 待领取',orders.filter(needsPickup).length],['check','已下单 · 未验收齐全',orders.filter(needsCheck).length],['review','原表 / 历史订单待核实',orders.filter(needsReview).length]];
  $('#app').innerHTML=`<div class="page-head"><div><h1>团队订单</h1><p class="muted">下单、到校和验收分别确认。缺少的商品继续留在待办里。</p></div><div class="actions">${me.role==='admin'?'<button data-action="members">成员与角色</button>':''}<button data-action="refresh">刷新进度</button>${manager()?'<button class="primary" data-action="sync">立即同步 Drive</button>':''}</div></div>
    <div class="sync-info">${config.demo?'虚构 Drive 同步演示':`每 ${config.syncIntervalSeconds} 秒自动检查 Drive`}${sync?.running?` · 正在同步 ${sync.processed || 0} / ${sync.scanned || '…'}`:sync?.finishedAt?' · 最近同步 '+fmtTime(sync.finishedAt):' · 尚未完成同步'}${sync?.ok===false?` · <strong class="danger">${esc(sync.error || '部分表格读取失败，请查看待核实列表')}</strong>`:''}</div>
    <div class="metrics">${cards.map(([key,title,count])=>`<button class="metric ${filter===key?'active':''}" data-action="filter" data-filter="${key}"><strong>${count}</strong><span>${title}</span></button>`).join('')}</div>
    <div class="workspace"><aside><div class="filter-bar"><button class="small" data-action="filter" data-filter="all">全部</button><input id="search" type="search" placeholder="搜索订单 / 项目 / 姓名" value="${esc(search)}" aria-label="搜索订单"></div><div class="order-list" id="order-list"></div></aside><section id="detail"><div class="panel empty">选择一份订单，查看下单、到校和验收记录。</div></section></div>`;
  renderList();
}
function renderList() { $('#order-list').innerHTML=orders.filter(visible).map(o=>`<button class="order-card ${o.id===selected?'selected':''}" data-action="select" data-id="${o.id}"><strong>${esc(o.title)}</strong>${badge(o.status)}${o.source_state!=='current'?'<span class="badge red">原表待核实</span>':''}<div class="meta-line muted"><span>${esc(o.student_name || '提交人未填写')}</span><span>${o.items.length} 项</span></div></button>`).join('') || '<p class="empty">此分类暂无订单。</p>'; }
function renderDetail() {
  const o=current; if(!o || !$('#detail'))return;
  const active=o.state==='active'&&o.source_state==='current';
  const warnings=o.source_state==='changed'?`<div class="alert"><strong>Drive 原表发生变更</strong><p>进度已保留。管理方核对商品和数量后才能继续。</p><details><summary>查看新商品清单</summary>${o.pendingSource?.items.map(i=>`<p>${esc(i.name)} × ${i.quantity}</p>`).join('') || ''}</details>${manager()?'<button data-action="accept-source">核对后应用变更</button>':''}</div>`:o.source_state!=='current'?`<div class="alert red">${esc(o.import_error || '原表移出了同步文件夹或失去读取权限。已有记录保留，待恢复读取。')}</div>`:'';
  $('#detail').innerHTML=`<div class="panel"><div class="detail-head"><h2>${esc(o.title)}</h2><p class="muted">${esc(o.competition)}${o.student_name?' · '+esc(o.student_name):''}</p><div class="actions">${badge(o.status)}${!config.demo?`<a href="${esc(safeLink(o.url))}" target="_blank" rel="noopener">打开 Drive 原表 ↗</a>`:''}</div></div>${warnings}
    ${o.state==='review'?`<div class="alert">这份表尚未确认纳入。历史已完成订单可以归档，预算表可以排除。</div>`:''}
    ${manager()?`<div class="actions">${o.state!=='active'&&o.source_state==='current'?'<button class="primary" data-action="classify" data-state="active">确认纳入订单</button>':''}<button class="small" data-action="classify" data-state="archived">历史归档</button><button class="small" data-action="classify" data-state="excluded">排除非订单</button></div>`:''}
    </div><div class="panel"><div class="section-head"><div><span class="step">01 · 管理方</span><h2>下单数量</h2></div>${active&&manager()?'<button class="small" data-action="purchase-all">全部商品已下单</button>':''}</div>
    <form id="purchase-form"><div class="table-scroll"><table><thead><tr><th>商品</th><th>申请</th><th>已下单总数</th><th>已验收</th><th>未下单</th><th>待验收</th></tr></thead><tbody>${o.items.map(i=>`<tr><td>${esc(i.name)}<div class="muted">${esc(i.type)}</div></td><td>${i.requested}</td><td>${active&&manager()?`<input type="number" name="${i.id}" value="${i.ordered}" min="${i.received}" max="${i.requested}" step="0.001" aria-label="${esc(i.name)}已下单总数量">`:o.state==='review'?'—':i.ordered}</td><td class="checked">${o.state==='review'?'—':i.received}</td><td>${o.state==='review'?'—':i.unpurchased}</td><td>${o.state==='review'?'—':i.outstanding}</td></tr>`).join('')}</tbody></table></div>${active&&manager()?'<div class="actions field"><button class="primary" type="submit">保存下单数量</button><span class="muted">填写累计已下单数量，个别未买的商品保持为 0。</span></div>':''}</form></div>
    <div class="panel"><div class="section-head"><div><span class="step">02 · 管理方确认到校 / 学生逐项验收</span><h2>到货批次</h2></div></div>
    ${!o.batches.length?'<p class="muted">尚未登记到货批次。通常整单集运一次；分批到货时新增一批。</p>':''}
    ${o.batches.map((b,index)=>`<div class="batch"><div class="batch-head"><div><strong>第 ${index+1} 批 ${b.tracking?'· '+esc(b.tracking):''}</strong><div class="muted">${b.arrived_at?'到校 '+fmtTime(b.arrived_at):'尚未确认到校'}${b.claimed_at?' · '+esc(b.claimed_name)+' 已领取 '+fmtTime(b.claimed_at):''}</div></div>${active?(b.arrived_at?'<button class="small primary" data-action="receipt-form" data-batch="'+b.id+'">'+(b.claimed_at?'补充验收':'领取并验收')+'</button>':manager()?'<button class="small primary" data-action="arrive" data-batch="'+b.id+'">确认送到学校</button>':''):''}</div>${b.note?'<p class="muted">'+esc(b.note)+'</p>':''}<div id="receipt-${b.id}"></div></div>`).join('')}
    ${active&&manager()?`<details ${!o.batches.length?'open':''}><summary>新增一批快递</summary><form id="batch-form"><label class="field"><span>快递单号（可选）</span><input class="full" name="tracking" maxlength="150" placeholder="没有单号也可以登记"></label><label class="field"><span>备注 / 收货位置（可选）</span><input class="full" name="note" maxlength="1000" placeholder="例如：已送到学校收货点"></label><label class="field"><input type="checkbox" name="arrived"> 这批已经送到学校</label><button class="primary" type="submit">新增到货批次</button></form></details>`:''}</div>
    ${o.issues.length?`<div class="panel"><h2>缺件 / 错货 / 损坏跟进</h2>${o.issues.map(i=>`<div class="issue"><strong>${esc(i.item_name)}</strong><p>${esc(i.description)}</p>${i.resolved_at?`<p class="muted">已处理：${esc(i.resolution)} · ${esc(i.resolved_name)}</p>`:active?'<button class="small" data-action="resolve-issue" data-issue="'+i.id+'">记录处理结果</button>':''}</div>`).join('')}</div>`:''}
    <div class="panel"><span class="step">03 · 留存实际操作人</span><h2>验收记录</h2>${o.receipts.length?o.receipts.map(r=>`<div class="history"><strong>${esc(r.actor_name)}</strong> · ${fmtTime(r.created_at)}${r.voided_at?' · <b class="danger">已更正</b>':''}<p>${r.lines.filter(l=>l.quantity>0).map(l=>esc(l.name)+' × '+l.quantity).join('；')||'本次登记了异常'}</p>${r.voided_at?'<span>更正原因：'+esc(r.void_reason)+'</span>':active&&(manager()||r.actor_id===me.id)?'<button class="small" data-action="void-receipt" data-receipt="'+r.id+'">更正这条记录</button>':''}</div>`).join(''):'<p class="muted">尚未验收。到校后，团队学生均可领取并逐项登记。</p>'}
    <details><summary>完整操作历史</summary>${o.history.map(e=>`<div class="history">${esc(actions[e.action]||e.action)}<span>${esc(e.actor_name)} · ${fmtTime(e.created_at)}</span></div>`).join('')}</details></div>`;
}
function receiptForm(batchId) {
  const o=current;
  $('#receipt-'+batchId).innerHTML=`<form class="receipt-form" data-batch="${batchId}"><p class="muted field">只填本次新收到、检查合格的数量。损坏或错货写在异常栏，后续补件再登记。累计不能超过已下单数量。</p><div class="table-scroll"><table><thead><tr><th>商品</th><th>待验收</th><th>本次合格数量</th><th>异常说明（可选）</th></tr></thead><tbody>${o.items.map(i=>`<tr><td>${esc(i.name)}</td><td>${i.outstanding}</td><td><input type="number" name="q-${i.id}" value="0" min="0" max="${i.outstanding}" step="0.001" aria-label="${esc(i.name)}本次合格数量"></td><td><input name="issue-${i.id}" maxlength="1000" placeholder="缺件、错货、损坏" aria-label="${esc(i.name)}异常说明"></td></tr>`).join('')}</tbody></table></div><div class="actions field"><button type="submit" class="primary">确认本次验收</button><button type="button" data-action="cancel-receipt" data-batch="${batchId}">取消</button></div></form>`;
}
async function mutate(actionName, data={}) { current=await api('orders/'+current.id+'/'+actionName,{version:current.version,...data});toast('已保存，操作人和时间已记录');await load(); }
document.addEventListener('click', event => {
  const b=event.target.closest('button[data-action]');if(!b)return;
  const a=b.dataset.action;
  if(a==='filter'){filter=b.dataset.filter;load().catch(e=>toast(e.message,true));return;}
  if(a==='receipt-form'){receiptForm(b.dataset.batch);return;}
  if(a==='cancel-receipt'){$('#receipt-'+b.dataset.batch).replaceChildren();return;}
  action(async()=>{
    if(a==='demo-login'){const r=await api('demo-login',{userId:b.dataset.user});me=r.user;csrf=r.csrf;await load();}
    if(a==='logout'){await api('logout',{});me=null;csrf=null;selected=null;current=null;login();}
    if(a==='refresh'){const r=await api('me');me=r.user;csrf=r.csrf;await load();}
    if(a==='sync'){const r=await api('sync',{});toast(r.ok?'同步完成':r.error||'部分文件读取失败',!r.ok);await load();}
    if(a==='select'){selected=b.dataset.id;current=await api('orders/'+selected);renderList();renderDetail();}
    if(a==='classify')await mutate('classify',{state:b.dataset.state});
    if(a==='purchase-all')await mutate('purchase',{lines:current.items.map(i=>({itemId:i.id,quantity:i.requested}))});
    if(a==='arrive')await mutate('arrive',{batchId:b.dataset.batch});
    if(a==='accept-source')await mutate('accept-source');
    if(a==='void-receipt'){const reason=prompt('请输入更正原因。原记录会保留，数量从累计验收中扣除。');if(reason)await mutate('void-receipt',{receiptId:b.dataset.receipt,reason});}
    if(a==='resolve-issue'){const resolution=prompt('填写处理结果。缺少的数量仍须另行验收。');if(resolution)await mutate('resolve-issue',{issueId:b.dataset.issue,resolution});}
    if(a==='members'){
      const users=await api('members');$('#detail').innerHTML=`<div class="panel"><h2>团队成员与角色</h2><p class="muted">登录者先等待批准。学生均可验收；管理方可记录下单和到校；管理员可分配角色。</p>${users.map(u=>`<form class="member-row" data-user="${esc(u.id)}"><div><strong>${esc(u.name)}</strong><div class="muted">${esc(labels[u.role])}</div></div>${u.id!==me.id?`<div class="actions"><select name="role" aria-label="${esc(u.name)}角色">${['pending','student','manager','admin','disabled'].map(r=>`<option value="${r}" ${u.role===r?'selected':''}>${esc(labels[r])}</option>`).join('')}</select><button type="submit">保存角色</button></div>`:'<span class="badge green">当前管理员</span>'}</form>`).join('')}</div>`;
    }
  });
});
document.addEventListener('input',event=>{if(event.target.id==='search'){search=event.target.value;renderList();}});
document.addEventListener('submit',event=>{
  const form=event.target;event.preventDefault();const f=new FormData(form);
  action(async()=>{
    if(form.id==='purchase-form')await mutate('purchase',{lines:current.items.map(i=>({itemId:i.id,quantity:Number(f.get(i.id))}))});
    if(form.id==='batch-form')await mutate('batches',{tracking:f.get('tracking'),note:f.get('note'),arrived:f.get('arrived')==='on'});
    if(form.classList.contains('receipt-form'))await mutate('receive',{batchId:form.dataset.batch,lines:current.items.map(i=>({itemId:i.id,quantity:Number(f.get('q-'+i.id)),issue:f.get('issue-'+i.id)}))});
    if(form.classList.contains('member-row')){await api('members',{userId:form.dataset.user,role:f.get('role')});toast('成员角色已更新');await load();}
  });
});
try { config=await api('config');if(config.demo){$('#mode-banner').hidden=false;$('#mode-banner').textContent='本机演示 · 虚构订单与身份 · 尚未连接实际 Drive';}try{const r=await api('me');me=r.user;csrf=r.csrf;}catch(e){if(e.status!==401)throw e;}await load(); }
catch(e){$('#app').innerHTML='<section class="login"><h1>平台暂时无法连接</h1><p>'+esc(e.message)+'</p></section>';}
