import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Store } from '../lib/store.js';
import { createApplication } from '../server.js';
import { synchronize, DriveReader } from '../lib/drive.js';
import { parseOrderWorkbook, XLSX, SHEET } from '../lib/parser.js';
import JSZip from 'jszip';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const FOLDER = 'test-folder';
const student = { id:'student',name:'学生甲',role:'student' };
const other = { id:'other',name:'学生乙',role:'student' };
const manager = { id:'manager',name:'管理方',role:'manager' };
function sample(items = [['测试电机',4],['测试接头',10]]) {
  const value={sheetName:'Sheet1',competition:'测试项目',studentName:'测试学生',items:items.map(([name,quantity],i)=>({name,quantity,sourceRow:11+i,link:'',type:'Components',amount:'10',currency:'CNY'}))};
  return {...value,fingerprint:createHash('sha256').update(JSON.stringify(value)).digest('hex')};
}
const file=(id='file-a',modifiedTime='2026-10-14T00:00:00Z')=>({id,name:'测试订单.xlsx',modifiedTime,mimeType:XLSX,parents:[FOLDER]});
function setup() { const s=new Store(':memory:');for(const u of [student,other,manager]){s.loginUser(u.id,u.name);s.run('UPDATE users SET role=? WHERE id=?',u.role,u.id);}s.ingest(file(),sample());const o=s.list()[0];return{s,id:o.id}; }
const update=(s,id,method,body,who=manager)=>s[method](id,{version:s.detail(id).version,...body},who);
const active=(s,id)=>update(s,id,'classify',{state:'active'});

test('partial purchase, two school deliveries and different students receiving quantities complete one order',()=>{
  const {s,id}=setup();assert.equal(s.detail(id).state,'review');active(s,id);
  assert.equal(s.detail(id).status,'awaiting_order');
  const items=s.detail(id).items;
  update(s,id,'purchase',{lines:items.map(i=>({itemId:i.id,quantity:i.name==='测试电机'?4:0}))});
  assert.equal(s.detail(id).status,'partial_ordered');assert.equal(s.detail(id).items[1].unpurchased,10);
  update(s,id,'purchase',{lines:items.map(i=>({itemId:i.id,quantity:i.requested}))});
  update(s,id,'addBatch',{tracking:'TEST-1',arrived:true});let d=s.detail(id);assert.equal(d.status,'awaiting_pickup');
  update(s,id,'receive',{batchId:d.batches[0].id,lines:[{itemId:items[0].id,quantity:2},{itemId:items[1].id,quantity:10}]},student);
  d=s.detail(id);assert.equal(d.status,'partial_received');assert.equal(d.items[0].outstanding,2);assert.equal(d.receipts[0].actor_name,student.name);
  update(s,id,'addBatch',{arrived:false});d=s.detail(id);const second=d.batches[1].id;
  assert.throws(()=>update(s,id,'receive',{batchId:second,lines:[{itemId:items[0].id,quantity:2}]},other),/到学校/);
  update(s,id,'arrive',{batchId:second});
  update(s,id,'receive',{batchId:second,lines:[{itemId:items[0].id,quantity:2}]},other);
  assert.equal(s.detail(id).status,'complete');assert.equal(s.detail(id).receipts[1].actor_name,other.name);
  s.close();
});

test('roles, replay, overreceipt and transaction rollback protect quantities',()=>{
  const {s,id}=setup();active(s,id);const items=s.detail(id).items;
  assert.throws(()=>update(s,id,'purchase',{lines:[]},student),/角色/);
  assert.throws(()=>update(s,id,'addBatch',{arrived:true},student),/角色/);
  const version=s.detail(id).version;
  s.purchase(id,{version,lines:items.map(i=>({itemId:i.id,quantity:i.requested}))},manager);
  assert.throws(()=>s.purchase(id,{version,lines:[]},manager),/更新/);
  update(s,id,'addBatch',{arrived:true});const batch=s.detail(id).batches[0].id;
  const before=s.detail(id).history.length;
  assert.throws(()=>update(s,id,'receive',{batchId:batch,lines:[{itemId:items[0].id,quantity:1},{itemId:items[1].id,quantity:11}]},student),/超过/);
  assert.equal(s.detail(id).receipts.length,0);assert.equal(s.detail(id).items[0].received,0);assert.equal(s.detail(id).history.length,before);
  update(s,id,'receive',{batchId:batch,lines:[{itemId:items[0].id,quantity:4}]},student);
  assert.throws(()=>update(s,id,'receive',{batchId:batch,lines:[{itemId:items[0].id,quantity:1}]},student),/超过/);
  assert.throws(()=>update(s,id,'purchase',{lines:items.map(i=>({itemId:i.id,quantity:0}))}),/少于/);
  s.close();
});

test('issues prevent completion and correcting receipts preserves attribution and adjusts totals',()=>{
  const {s,id}=setup();active(s,id);const items=s.detail(id).items;
  update(s,id,'purchase',{lines:items.map(i=>({itemId:i.id,quantity:i.requested}))});update(s,id,'addBatch',{arrived:true});const batch=s.detail(id).batches[0].id;
  update(s,id,'receive',{batchId:batch,lines:items.map(i=>({itemId:i.id,quantity:i.requested,issue:i===items[0]?'包装破损待核查':''}))},student);
  let d=s.detail(id);assert.equal(d.status,'issue');const receipt=d.receipts[0].id;
  assert.throws(()=>update(s,id,'voidReceipt',{receiptId:receipt,reason:'误填'},other),/自己的/);
  update(s,id,'resolveIssue',{issueId:d.issues[0].id,resolution:'检查合格，包装破损未影响物品'},other);assert.equal(s.detail(id).status,'complete');
  update(s,id,'voidReceipt',{receiptId:receipt,reason:'原数量误填，重新核对'},student);
  d=s.detail(id);assert.equal(d.items[0].received,0);assert.ok(d.receipts[0].voided_at);assert.equal(d.receipts[0].actor_id,student.id);assert.equal(d.status,'ordered');s.close();
});

test('sync deduplicates by Drive ID; edits preserve receipt progress and never silently adopt renamed purchased items',()=>{
  const {s,id}=setup();active(s,id);let d=s.detail(id);
  update(s,id,'purchase',{lines:d.items.map(i=>({itemId:i.id,quantity:i.requested}))});
  const ids=s.detail(id).items.map(i=>i.id);
  s.ingest(file(),sample());assert.equal(s.list().length,1);assert.equal(s.detail(id).items[0].ordered,4);
  const reordered=sample([['测试接头',10],['测试电机',5]]);s.ingest(file('file-a','v2'),reordered);
  assert.equal(s.detail(id).source_state,'changed');assert.equal(s.detail(id).items[0].requested,4);
  update(s,id,'acceptSource',{});d=s.detail(id);assert.equal(d.items[1].id,ids[0]);assert.equal(d.items[1].ordered,4);assert.equal(d.items[1].requested,5);
  s.ingest(file('file-a','v3'),sample([['改名电机',5],['测试接头',10]]));assert.throws(()=>update(s,id,'acceptSource',{}),/改名/);
  assert.equal(s.detail(id).items[1].ordered,4);s.close();
});

test('failed scan never marks files missing; successful removal keeps order/audit',async()=>{
  const {s,id}=setup();const reader={list:async()=>{throw new Error('Drive 读取失败 (403)');}};
  assert.equal((await synchronize(s,reader)).ok,false);assert.equal(s.detail(id).source_state,'current');
  await synchronize(s,{list:async()=>[],read:async()=>null});assert.equal(s.detail(id).source_state,'missing');assert.equal(s.detail(id).items.length,2);
  await synchronize(s,{list:async()=>[file()],read:async()=>sample()});assert.equal(s.detail(id).source_state,'current');s.close();
});

test('orders, source identity and quantities persist after database close/reopen',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'order-platform-test-')),filename=path.join(dir,'db.sqlite');
  let s=new Store(filename);
  try{
    s.loginUser(manager.id,manager.name);s.run("UPDATE users SET role='manager' WHERE id=?",manager.id);
    s.ingest(file(),sample());const id=s.list()[0].id;active(s,id);
    update(s,id,'purchase',{lines:s.detail(id).items.map(i=>({itemId:i.id,quantity:i.requested}))});
    s.close();s=new Store(filename);const d=s.detail(id);
    assert.equal(d.drive_id,'file-a');assert.equal(d.items[0].ordered,4);assert.equal(d.status,'ordered');assert.equal(d.history[0].actor_id,manager.id);
  }finally{s.close();rmSync(dir,{recursive:true,force:true});}
});

async function workbook({inline=false,quantityValue='4',name='电机 & 接头',header=true,entity=false,lateItem=false}={}) {
  const zip=new JSZip(), encode=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;');
  zip.file('xl/workbook.xml','<workbook><sheets><sheet name="Sheet1" r:id="rId1"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>');
  const strings=['Item Name','QTY','Link','Type',name,'Components'];
  if(!inline)zip.file('xl/sharedStrings.xml','<sst>'+strings.map(v=>'<si><t>'+encode(v)+'</t></si>').join('')+'</sst>');
  const cell=(ref,n)=>inline?`<c r="${ref}" t="inlineStr"><is><t>${encode(strings[n])}</t></is></c>`:`<c r="${ref}" t="s"><v>${n}</v></c>`;
  zip.file('xl/worksheets/sheet1.xml',(entity?'<!DOCTYPE worksheet [<!ENTITY attack "test">]>':'')+'<worksheet><sheetData>'+ (header?`<row r="9">${cell('C9',0)}${cell('F9',1)}${cell('E9',2)}${cell('G9',3)}</row>`:'')+`<row r="11">${cell('C11',4)}<c r="F11"><v>${quantityValue}</v></c>${cell('G11',5)}</row>`+(lateItem?`<row r="150">${cell('C150',4)}<c r="F150"><v>1</v></c>${cell('G150',5)}</row>`:'')+'</sheetData></worksheet>');
  return zip.generateAsync({type:'nodebuffer'});
}
test('parser handles XLSX shared strings and native export inline strings; rejects missing quantity, entities and non-orders',async()=>{
  for(const inline of [false,true]){const p=await parseOrderWorkbook(await workbook({inline}));assert.equal(p.items[0].name,'电机 & 接头');assert.equal(p.items[0].quantity,4);}
  assert.equal(await parseOrderWorkbook(await workbook({header:false})),null);
  await assert.rejects(parseOrderWorkbook(await workbook({quantityValue:''})),/缺失/);
  await assert.rejects(parseOrderWorkbook(await workbook({quantityValue:'-2'})),/数量/);
  await assert.rejects(parseOrderWorkbook(await workbook({entity:true})),/实体/);
  const late=await parseOrderWorkbook(await workbook({lateItem:true}));assert.equal(late.items.length,2);assert.equal(late.items[1].sourceRow,150);
  const brand=await parseOrderWorkbook(await workbook({name:'TOTAL工具钳'}));assert.equal(brand.items[0].name,'TOTAL工具钳');
});

test('human-facing Drive links do not force a service-account browser identity',()=>{
  const s=new Store(':memory:');s.ingest({...file(),webViewLink:'https://docs.google.com/spreadsheets/d/file-a/edit?ouid=service-account-id&authuser=1'},sample());
  assert.equal(s.list()[0].url,'https://docs.google.com/spreadsheets/d/file-a/edit');s.close();
});

test('Drive reader follows pagination, reads only configured folder, exports native files, enforces readonly scopes and download errors',async()=>{
  const calls=[],bytes=await workbook();
  const fetchImpl=async(url,opts)=>{calls.push({url:new URL(url),headers:opts.headers});
    if(new URL(url).pathname.endsWith('/files'))return Response.json(new URL(url).searchParams.has('pageToken')?{files:[{...file('native'),mimeType:SHEET}]}:{files:[file()],nextPageToken:'page-two'});
    return new Response(bytes);
  };
  const reader=new DriveReader({folderId:FOLDER,authClient:{getAccessToken:async()=>({token:'fake-test-token'})},fetchImpl});
  const files=await reader.list();assert.equal(files.length,2);assert.equal(calls[0].url.searchParams.get('q'),"'test-folder' in parents and trashed = false");assert.equal(calls[1].url.searchParams.get('pageToken'),'page-two');
  assert.equal((await reader.read(files[0])).items.length,1);await reader.read(files[1]);assert.ok(calls.at(-1).url.pathname.endsWith('/export'));
  assert.equal(calls.at(-1).url.searchParams.get('mimeType'),XLSX);
  await assert.rejects(reader.read({...file(),parents:['wrong-folder']}),/不在/);
  const denied=new DriveReader({folderId:FOLDER,authClient:{getAccessToken:async()=>({token:'fake'})},fetchImpl:async()=>new Response('',{status:403})});
  await assert.rejects(denied.list(),/403/);
});

test('HTTP authentication, CSRF, pending membership and production/demo separation',async()=>{
  const s=new Store(':memory:');let port;
  // Start on a chosen OS port; origin is fixed after binding for requests.
  const socket=(await import('node:net')).createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));port=socket.address().port;await new Promise(r=>socket.close(r));
  const origin=`http://127.0.0.1:${port}`;
  const app=await createApplication({store:s,host:'127.0.0.1',origin,demo:false,bootstrap:'admin-sub',autoSync:false,verifyToken:async(c)=>({id:c,name:c})});await app.start(port);
  try{
    const send=(p,body,headers={})=>fetch(origin+'/api/'+p,{method:body===undefined?'GET':'POST',headers:body===undefined?headers:{'Content-Type':'application/json',Origin:origin,...headers},body:body===undefined?undefined:JSON.stringify(body)});
    assert.equal((await send('orders')).status,401);
    const login=await send('login',{credential:'new-student'}), auth=await login.json(), cookie=login.headers.get('set-cookie').split(';')[0];
    assert.equal(auth.user.role,'pending');assert.equal((await send('orders',undefined,{Cookie:cookie})).status,403);
    assert.equal((await send('demo-login',{userId:'demo-admin'})).status,404);
    const adminRes=await send('login',{credential:'admin-sub'}),admin=await adminRes.json(),ac=adminRes.headers.get('set-cookie').split(';')[0];
    assert.equal((await send('members',{userId:'new-student',role:'student'},{Cookie:ac})).status,403);
    assert.equal((await send('members',{userId:'new-student',role:'student'},{Cookie:ac,'X-CSRF-Token':admin.csrf,Origin:'https://evil.example'})).status,403);
    assert.equal((await send('members',{userId:'new-student',role:'student'},{Cookie:ac,'X-CSRF-Token':admin.csrf})).status,200);
    assert.equal((await send('me',undefined,{Cookie:cookie})).status,401); // promotion revokes old sessions
    assert.equal((await send('orders',undefined,{Cookie:ac})).status,200);
  }finally{await app.close();s.close();}
  await assert.rejects(createApplication({demo:true,host:'0.0.0.0',store:new Store(':memory:')}),/本机/);
  await assert.rejects(createApplication({demo:true,production:true,store:new Store(':memory:')}),/本机/);
});

test('background timer discovers a later file without browser activity and does not duplicate it',async()=>{
  const store=new Store(':memory:');let scans=0;
  const reader={list:async()=>++scans===1?[]:[file('automatic-new-file')],read:async()=>sample()};
  const app=await createApplication({store,reader,host:'127.0.0.1',origin:'http://127.0.0.1:8787',intervalSeconds:0.02});
  await app.start(0);
  try{
    const until=Date.now()+2000;
    while((scans<3||store.list().length!==1)&&Date.now()<until)await new Promise(r=>setTimeout(r,10));
    assert.ok(scans>=3);assert.equal(store.list().length,1);assert.equal(store.list()[0].drive_id,'automatic-new-file');
    assert.equal(store.list()[0].state,'review');
  }finally{await app.close();store.close();}
});
