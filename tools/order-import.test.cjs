const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const JSZip = require('jszip');
const importer = require('../order-import.js');
const root = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const {fixture,environment,png}=require('./order-import-fixture.cjs');

for (const inline of [false,true]) test(`reads original items, totals as unit prices, currencies and metadata (${inline ? 'inline' : 'shared'} strings)`, async () => {
  const h = environment();
  try {
    const order = await importer.readWorkbook(await fixture({ inline }), h.env);
    assert.equal(order.competition, 'Import TEST'); assert.equal(order.student, 'Fictional Student');
    assert.equal(order.items.length, 2);
    assert.deepEqual(order.items.map(item => [item.name,item.quantity,item.price,item.currency,item.location]), [['Test Motor',4,25,'CNY','Online'],['Test Cable',3,20,'HKD','Shop']]);
    assert.equal(order.items[1].category, 'Custom category');
    assert.equal(order.layout.end, 40);
    assert.equal(order.hasSignature, false);
  } finally { h.dom.window.close(); }
});

for (const signatureImage of ['oneCell', 'twoCell', 'absolute', 'offset']) test(`keeps an externally inserted ${signatureImage} picture signature without re-signing`, async () => {
  const h = environment();
  try {
    const bytes = await fixture({signatureImage, renameSheet:true}), order = await importer.readWorkbook(bytes, h.env);
    assert.equal(order.hasSignature, true);
    const items = order.items.map(item => ({...item, importId:item.id})); items[0].quantity = 5;
    const snapshot = {items, competition:order.competition, student:order.student};
    const blob = await importer.updateWorkbook({bytes, order}, snapshot, h.env);
    const saved = await blob.arrayBuffer(), parsed = await importer.readWorkbook(saved, h.env);
    assert.equal(parsed.hasSignature, true); assert.equal(parsed.items[0].quantity, 5);
    assert.equal(parsed.items[0].status, 'Pending Approval');
    const before = await JSZip.loadAsync(bytes), after = await JSZip.loadAsync(saved);
    const retained = Object.keys(before.files).filter(name => !before.files[name].dir &&
      (/^xl\/(drawings|media)\//.test(name) || /\/worksheets\/_rels\//.test(name) || name === '[Content_Types].xml'));
    for (const name of retained) assert.deepEqual(await after.file(name).async('nodebuffer'), await before.file(name).async('nodebuffer'), name);
    assert.equal(Object.keys(after.files).filter(name => /order-edit-signature/.test(name)).length, 0);
    const again = await importer.updateWorkbook({bytes:saved,order:parsed}, {...snapshot,items:parsed.items.map(item=>({...item,importId:item.id})),signature:{dataUrl:null}}, h.env);
    assert.equal((await importer.readWorkbook(await again.arrayBuffer(), h.env)).hasSignature, true);
  } finally { h.dom.window.close(); }
});

for (const signatureImage of [undefined, 'outside', 'missing', 'external', 'zeroSize']) test(`requires a signature when no usable signature-area image exists: ${signatureImage}`, async () => {
  const h = environment();
  try {
    const bytes = await fixture({signatureImage}), order = await importer.readWorkbook(bytes, h.env);
    assert.equal(order.hasSignature, false);
    // The writer rechecks the workbook instead of trusting a cached UI flag.
    await assert.rejects(importer.updateWorkbook({bytes,order:{...order,hasSignature:true}}, {
      items:order.items.map(item=>({...item,importId:item.id})),competition:order.competition,student:order.student,
    }, h.env), /No signature image/);
  } finally { h.dom.window.close(); }
});

test('a supplied new signature replaces a manually inserted picture and preserves header images', async () => {
  const h = environment();
  try {
    const bytes = await fixture({signatureImage:'twoCell'}), order = await importer.readWorkbook(bytes, h.env);
    const blob = await importer.updateWorkbook({bytes,order}, {items:order.items.map(item=>({...item,importId:item.id})),competition:order.competition,student:order.student,signature:{dataUrl:png,aspect:4}}, h.env);
    const after = await JSZip.loadAsync(await blob.arrayBuffer()), before = await JSZip.loadAsync(bytes);
    const drawing = await after.file('xl/drawings/drawing1.xml').async('string');
    assert.doesNotMatch(drawing, /Picture 42/); assert.equal((drawing.match(/name="signature.png"/g)||[]).length,1);
    assert.equal(after.file('xl/media/manual-picture.png'),null);
    for (const name of ['xl/media/image1.png','xl/media/image2.png']) assert.deepEqual(await after.file(name).async('nodebuffer'),await before.file(name).async('nodebuffer'));
    assert.equal((await importer.readWorkbook(await blob.arrayBuffer(),h.env)).hasSignature,true);
  } finally { h.dom.window.close(); }
});

test('edit/add/delete roundtrip preserves original file parts, unchanged approvals/dates and a single new signature', async () => {
  const h = environment();
  try {
    const bytes = await fixture({ renameSheet: true }), order = await importer.readWorkbook(bytes, h.env);
    const items = order.items.map(item => ({ ...item, importId: item.id })); items[0].quantity = 5;
    items.push({ id:3,name:'New Bracket',spec:'M3',quantity:2,price:3,currency:'USD',category:'Others',location:'Online',link:'' });
    const signature = { dataUrl: png, aspect: 4 };
    const blob = await importer.updateWorkbook({ bytes, order }, { items,competition:order.competition,student:order.student,signature }, h.env);
    const saved = Buffer.from(await blob.arrayBuffer()), parsed = await importer.readWorkbook(saved, h.env);
    assert.deepEqual(parsed.items.map(item => [item.quantity,item.amount,item.currency,item.status]), [[5,125,'CNY','Pending Approval'],[3,60,'HKD','Approved'],[2,6,'USD','Pending Approval']]);
    assert.equal(parsed.items[1].date, '46001'); assert.equal(parsed.items[1].dateType, 'n');
    const zip = await JSZip.loadAsync(saved);
    assert.equal(await zip.file('customXml/preserve.xml').async('string'), '<test>Keep this original data</test>');
    assert.match(await zip.file('xl/workbook.xml').async('string'), /fullCalcOnLoad="1"/);
    const drawing = await zip.file('xl/drawings/drawing1.xml').async('string');
    assert.equal((drawing.match(/name="signature.png"/g)||[]).length, 1);
    const again = await importer.updateWorkbook({bytes:saved,order:parsed}, {items:parsed.items.slice(0,1).map(item=>({...item,importId:item.id})),competition:parsed.competition,student:parsed.student,signature}, h.env);
    const final = await JSZip.loadAsync(await again.arrayBuffer());
    assert.equal(Object.keys(final.files).filter(name=>/^xl\/media\/order-edit-signature-/.test(name)).length, 1);
    assert.equal((await importer.readWorkbook(await again.arrayBuffer(), h.env)).items.length, 1);
  } finally { h.dom.window.close(); }
});

for (const options of [{invalidQuantity:true},{multipleCurrencies:true},{extraRows:true},{entity:true}]) test(`rejects invalid or lossy imports: ${JSON.stringify(options)}`, async () => {
  const h = environment(); try { await assert.rejects(importer.readWorkbook(await fixture(options),h.env)); } finally { h.dom.window.close(); }
});

test('changing competition/student requires approval again and XML inflation is bounded', async () => {
  const h=environment();try{
    const bytes=await fixture(),order=await importer.readWorkbook(bytes,h.env);
    const blob=await importer.updateWorkbook({bytes,order},{items:order.items.map(item=>({...item,importId:item.id})),competition:'Changed project',student:order.student,signature:{dataUrl:png,aspect:4}},h.env);
    const changed=await importer.readWorkbook(await blob.arrayBuffer(),h.env);
    assert.deepEqual(changed.items.map(item=>item.status),['Pending Approval','Pending Approval']);
    const zip=await JSZip.loadAsync(bytes);
    zip.file('xl/sharedStrings.xml','<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>'+'x'.repeat(9*1024*1024)+'</t></si></sst>');
    await assert.rejects(importer.readWorkbook(await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}),h.env),/8 MB/);
  }finally{h.dom.window.close();}
});

async function browserPage(options = {}) {
  const bytes = await fixture(options), dom = new JSDOM(page, { url:'https://cart-to-excel.vercel.app',runScripts:'outside-only',pretendToBeVisual:true });
  const w = dom.window, writes = [], source = { id:'existing-order',name:'Original TEST order.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',version:'7',modifiedTime:'2026-10-23T00:00:00Z',capabilities:{canEdit:!options.readOnly} };
  let authorizations = 0;
  w.Blob = Blob; w.TextDecoder = TextDecoder;
  w.JSZip = { loadAsync:data=>JSZip.loadAsync(Buffer.from(data)) };
  w.alert = message=>{ throw new Error(message); }; w.confirm=()=>!options.cancel;
  w.HTMLCanvasElement.prototype.getContext=()=>new Proxy({}, {get:(target,name)=>name==='getImageData'?()=>({data:new Uint8ClampedArray(4)}):()=>{}});
  w.HTMLCanvasElement.prototype.toDataURL=()=>png; w.Element.prototype.scrollIntoView=()=>{};
  w.ORDER_FORM_DRIVE_CONFIG={clientId:'client',apiKey:'key',projectNumber:'123',folderId:'team-folder'};
  w.OrderFormDrive={isConfigured:()=>true,createClient:()=>({
    ready:async()=>{},authorize:()=>{authorizations++;return Promise.resolve();},clearAccount(){},
    importFile:async()=>({bytes,source}),
    updateFile:async(s,blob)=>{writes.push({source:s,blob});if(options.conflict)throw Object.assign(new Error('The original file changed. Re-import it.'),{code:'source_changed'});return{...source,version:'8',modifiedTime:'2026-10-23T00:01:00Z'};},
  })};
  w.eval(fs.readFileSync(path.join(root,'order-import.js'),'utf8'));
  const scripts=[...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match=>match[1]).join('\n');
  w.eval(scripts+`\nwindow.testState=()=>({items,importedOrder,signatureDataUrl});window.testSign=()=>{signatureDataUrl='${png}';updateSummary();};`);
  const until=async(check)=>{for(let i=0;i<100&&!check();i++)await new Promise(resolve=>setTimeout(resolve,5));assert.ok(check(),w.document.getElementById('import-status').textContent);};
  await until(()=>!w.document.getElementById('btn-import-drive').disabled);
  return{w,dom,writes,until,authCount:()=>authorizations};
}

test('page imports, renders hostile text safely, adds/edits rows and updates only the selected original',async()=>{
  const h=await browserPage({hostile:true});try{
    h.w.document.getElementById('btn-import-drive').click();assert.equal(h.authCount(),1);
    await h.until(()=>h.w.testState().items.length===2);
    assert.equal(h.w.document.querySelector('.edit-table img'),null);
    assert.equal(h.w.document.getElementById('input-competition').value,'Import TEST');
    assert.equal(h.w.testState().signatureDataUrl,null);
    assert.equal(h.w.document.getElementById('btn-drive-update').disabled,true);
    h.w.document.getElementById('btn-add-item').click();
    const row=h.w.document.querySelectorAll('.edit-table tbody tr')[2];
    for(const[field,val]of [['displayName','New Item'],['quantity','2'],['price','4']]){const input=row.querySelector(`[data-field="${field}"]`);input.value=val;input.dispatchEvent(new h.w.Event('input'));}
    h.w.testSign();h.w.document.getElementById('btn-drive-update').click();
    await h.until(()=>h.w.testState().importedOrder?.source.version==='8');
    assert.equal(h.writes.length,1);assert.equal(h.writes[0].source.id,'existing-order');
    const env=environment();try{const order=await importer.readWorkbook(await h.writes[0].blob.arrayBuffer(),env.env);assert.equal(order.items[2].amount,8);}finally{env.dom.window.close();}
    assert.match(h.w.document.getElementById('drive-status').textContent,/Updated original/);
  }finally{h.dom.window.close();}
});

test('page updates an original with its own picture signature, and clearing the optional pad keeps it',async()=>{
  const h=await browserPage({signatureImage:'twoCell'});try{
    h.w.document.getElementById('btn-import-drive').click();await h.until(()=>h.w.testState().items.length===2);
    assert.equal(h.w.testState().signatureDataUrl,null);
    assert.equal(h.w.document.getElementById('btn-drive-update').disabled,false);
    assert.equal(h.w.document.getElementById('btn-export').disabled,false);
    assert.equal(h.w.document.getElementById('signature-required').hidden,true);
    assert.match(h.w.document.getElementById('existing-signature-note').textContent,/无需重新签名/);
    h.w.testSign();assert.match(h.w.document.getElementById('existing-signature-note').textContent,/will replace/);
    h.w.document.getElementById('btn-sign-clear').click();
    assert.equal(h.w.testState().signatureDataUrl,null);
    assert.equal(h.w.document.getElementById('btn-drive-update').disabled,false);
    h.w.document.getElementById('btn-drive-update').click();
    await h.until(()=>h.w.testState().importedOrder?.source.version==='8');
    assert.equal(h.writes.length,1);assert.equal(h.writes[0].source.id,'existing-order');
    const zip=await JSZip.loadAsync(await h.writes[0].blob.arrayBuffer());
    assert.match(await zip.file('xl/drawings/drawing1.xml').async('string'),/Picture 42/);
    assert.equal(Object.keys(zip.files).filter(name=>/order-edit-signature/.test(name)).length,0);
    h.w.clearAll();
    assert.equal(h.w.document.getElementById('existing-signature-note').hidden,true);
    assert.equal(h.w.document.getElementById('signature-required').hidden,false);
    assert.ok(h.w.missingRequiredFields().includes('Signature'));
  }finally{h.dom.window.close();}
});

test('import replacement cancel preserves the draft; readonly and conflicting originals cannot be overwritten',async()=>{
  const cancelled=await browserPage({cancel:true});try{
    cancelled.w.document.getElementById('input-competition').value='Keep my draft';cancelled.w.testSign();
    cancelled.w.document.getElementById('btn-import-drive').click();await cancelled.until(()=>!cancelled.w.document.getElementById('btn-import-drive').disabled);
    assert.equal(cancelled.w.testState().importedOrder,null);assert.equal(cancelled.w.document.getElementById('input-competition').value,'Keep my draft');assert.ok(cancelled.w.testState().signatureDataUrl);
  }finally{cancelled.dom.window.close();}
  for(const options of [{readOnly:true},{conflict:true}]){
    const h=await browserPage(options);try{
      h.w.document.getElementById('btn-import-drive').click();await h.until(()=>h.w.testState().items.length===2);h.w.testSign();
      if(options.readOnly){assert.equal(h.w.document.getElementById('btn-drive-update').disabled,true);assert.equal(h.writes.length,0);}
      else{h.w.document.getElementById('btn-drive-update').click();await h.until(()=>h.w.testState().importedOrder.needsReload);assert.equal(h.w.document.getElementById('btn-drive-update').disabled,true);assert.equal(h.writes.length,1);}
    }finally{h.dom.window.close();}
  }
});
