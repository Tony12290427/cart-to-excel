(function(root) {
  'use strict';
  var NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  var REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  var PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
  var XDR = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing';
  var DRAW = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  var MAX_BYTES = 5 * 1024 * 1024, MAX_XML = 8 * 1024 * 1024;
  function nodes(parent, name) { return Array.from(parent.getElementsByTagNameNS('*', name)); }
  function one(parent, name) { return nodes(parent, name)[0]; }
  function value(parent, name) { var n = one(parent, name); return n ? n.textContent : ''; }
  function label(text) { return String(text || '').toLowerCase().replace(/[\s._():：-]/g, ''); }
  function path(base, target) {
    var parts = (target[0] === '/' ? target.slice(1) : base.slice(0, base.lastIndexOf('/') + 1) + target).split('/');
    var out = [];
    parts.forEach(function(part) { if (part === '..') out.pop(); else if (part && part !== '.') out.push(part); });
    return out.join('/');
  }
  function relPath(file) { var split = file.lastIndexOf('/'); return file.slice(0, split + 1) + '_rels/' + file.slice(split + 1) + '.rels'; }
  function parse(text, env) {
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('This workbook contains unsupported XML declarations.');
    var doc = new env.DOMParser().parseFromString(text, 'application/xml');
    if (one(doc, 'parsererror')) throw new Error('The workbook XML is invalid.');
    return doc;
  }
  async function readXML(zip, filename, env, budget) {
    var file = zip.file(filename);
    if (!file) throw new Error('The workbook is missing ' + filename + '.');
    var chunks = [], length = 0;
    await new Promise(function(resolve, reject) {
      var stream = file.internalStream('uint8array'), failed = false;
      stream.on('data', function(chunk) {
        if (failed) return;
        budget.bytes += chunk.byteLength; length += chunk.byteLength;
        if (budget.bytes > MAX_XML) { failed = true; stream.pause(); reject(new Error('The workbook XML exceeds the 8 MB limit.')); }
        else chunks.push(chunk);
      }).on('error', reject).on('end', resolve).resume();
    });
    var bytes = new Uint8Array(length), offset = 0;
    chunks.forEach(function(chunk) { bytes.set(chunk, offset); offset += chunk.byteLength; });
    return parse(new env.TextDecoder().decode(bytes), env);
  }
  function numeric(text, name, positive) {
    var cleaned = String(text).trim().replace(/,/g, '').replace(/^(CNY|RMB|HKD|USD|HK\$|US\$|[¥￥$])\s*/i, '');
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(cleaned)) throw new Error(name + ' is missing or invalid.');
    var n = Number(cleaned);
    if (!Number.isFinite(n) || n < (positive ? 0.001 : 0) || n > 1000000000) throw new Error(name + ' is out of range.');
    return n;
  }
  function displayName(item) { return item.spec ? item.name + ' (' + item.spec + ')' : item.name; }
  function unchanged(item, original) {
    return original && displayName(item) === original.name && item.quantity === original.quantity && item.price === original.price
      && (item.currency || 'CNY') === original.currency && item.category === original.category
      && item.link === original.link && item.location === original.location;
  }

  // Excel, Google Sheets and this page use different picture names/IDs. Locate
  // pictures by their position in the standard student's signature area instead.
  function signatureAnchors(draw, sheet) {
    var format = one(sheet, 'sheetFormatPr');
    var defaultHeight = Number(format && format.getAttribute('defaultRowHeight')) || 15;
    var defaultWidth = Number(format && format.getAttribute('defaultColWidth')) || 8.43;
    var rows = nodes(sheet, 'row'), cols = nodes(sheet, 'col'), y = [0], x = [0];
    for (var r = 1; r <= 74; r++) {
      var row = rows.find(function(n) { return Number(n.getAttribute('r')) === r; });
      var height = row && row.hasAttribute('ht') ? Number(row.getAttribute('ht')) : defaultHeight;
      y.push(y[r - 1] + (row && row.getAttribute('hidden') === '1' ? 0 : height * 12700));
    }
    for (var c = 1; c <= 12; c++) {
      var col = cols.find(function(n) { return c >= Number(n.getAttribute('min')) && c <= Number(n.getAttribute('max')); });
      var width = col && col.hasAttribute('width') ? Number(col.getAttribute('width')) : defaultWidth;
      var pixels = width < 1 ? Math.floor(width * 12 + 0.5) : Math.floor(width * 7 + 5);
      x.push(x[c - 1] + (col && col.getAttribute('hidden') === '1' ? 0 : pixels * 9525));
    }
    function marker(from, axis) {
      var index = value(from, axis === x ? 'col' : 'row');
      if (!/^\d+$/.test(index) || Number(index) >= axis.length) return NaN;
      return axis[Number(index)] + Number(value(from, axis === x ? 'colOff' : 'rowOff') || 0);
    }
    return Array.from(draw.documentElement.children).filter(function(anchor) {
      if (!one(anchor, 'pic')) return false;
      var from = one(anchor, 'from'), to = one(anchor, 'to');
      var pos = Array.from(anchor.children).find(function(n) { return n.localName === 'pos'; });
      var ext = Array.from(anchor.children).find(function(n) { return n.localName === 'ext'; });
      var left = from ? marker(from, x) : pos ? Number(pos.getAttribute('x')) : NaN;
      var top = from ? marker(from, y) : pos ? Number(pos.getAttribute('y')) : NaN;
      var right = to ? marker(to, x) : ext ? left + Number(ext.getAttribute('cx')) : NaN;
      var bottom = to ? marker(to, y) : ext ? top + Number(ext.getAttribute('cy')) : NaN;
      var centerX = (left + right) / 2, centerY = (top + bottom) / 2;
      // G69:K73 includes a margin around H70, but excludes the name/date and
      // header logos. Ignore empty template pictures and off-sheet drawings.
      return right > left && bottom > top && centerX >= x[6] && centerX < x[11]
        && centerY >= y[68] && centerY < y[73];
    });
  }

  async function hasExistingSignature(zip, sheet, sheetPath, env, budget) {
    var drawing = one(sheet, 'drawing');
    if (!drawing || !zip.file(relPath(sheetPath))) return false;
    var rels = await readXML(zip, relPath(sheetPath), env, budget);
    var relation = nodes(rels, 'Relationship').find(function(r) {
      return r.getAttribute('Id') === drawing.getAttributeNS(REL, 'id') && /\/drawing$/.test(r.getAttribute('Type') || '')
        && r.getAttribute('TargetMode') !== 'External';
    });
    if (!relation) return false;
    var drawingPath = path(sheetPath, relation.getAttribute('Target') || '');
    if (!/^xl\/drawings\/[^/]+\.xml$/.test(drawingPath) || !zip.file(drawingPath) || !zip.file(relPath(drawingPath))) return false;
    var draw = await readXML(zip, drawingPath, env, budget);
    var drawRels = await readXML(zip, relPath(drawingPath), env, budget);
    return signatureAnchors(draw, sheet).some(function(anchor) {
      return nodes(anchor, 'blip').some(function(blip) {
        var image = nodes(drawRels, 'Relationship').find(function(r) {
          return r.getAttribute('Id') === blip.getAttributeNS(REL, 'embed') && /\/image$/.test(r.getAttribute('Type') || '')
            && r.getAttribute('TargetMode') !== 'External';
        });
        var imagePath = image && path(drawingPath, image.getAttribute('Target') || '');
        return !!(imagePath && /^xl\/media\/[^/]+$/.test(imagePath) && zip.file(imagePath));
      });
    });
  }

  async function readWorkbook(bytes, runtime) {
    var env = runtime || root;
    if ((bytes.byteLength || bytes.length) > MAX_BYTES) throw new Error('Order forms must be 5 MB or smaller.');
    var zip;
    try { zip = await env.JSZip.loadAsync(bytes); } catch (error) { throw new Error('Could not read this Excel workbook. Choose an .xlsx order form.'); }
    var budget = { bytes: 0 };
    var book = await readXML(zip, 'xl/workbook.xml', env, budget);
    var rels = await readXML(zip, 'xl/_rels/workbook.xml.rels', env, budget);
    var relationships = new Map(nodes(rels, 'Relationship').filter(function(r) { return r.getAttribute('TargetMode') !== 'External'; })
      .map(function(r) { return [r.getAttribute('Id'), r.getAttribute('Target')]; }));
    var strings = zip.file('xl/sharedStrings.xml') ? nodes(await readXML(zip, 'xl/sharedStrings.xml', env, budget), 'si')
      .map(function(si) { return nodes(si, 't').map(function(t) { return t.textContent; }).join(''); }) : [];
    var sheets = nodes(book, 'sheet');
    if (sheets.length > 20) throw new Error('This workbook has too many worksheets.');
    var results = [];
    for (var sheet of sheets) {
      if (['hidden', 'veryHidden'].indexOf(sheet.getAttribute('state')) !== -1) continue;
      var target = relationships.get(sheet.getAttributeNS(REL, 'id'));
      if (!target) continue;
      var sheetPath = path('xl/workbook.xml', target);
      if (!/^xl\/worksheets\/[^/]+\.xml$/.test(sheetPath)) continue;
      var doc = await readXML(zip, sheetPath, env, budget), cells = new Map(), cellTypes = new Map();
      nodes(doc, 'c').forEach(function(c) {
        var type = c.getAttribute('t');
        var text = type === 's' ? strings[Number(value(c, 'v'))] : type === 'inlineStr' ?
          nodes(c, 't').map(function(t) { return t.textContent; }).join('') : value(c, 'v');
        cells.set(c.getAttribute('r'), text == null ? '' : String(text).trim());
        cellTypes.set(c.getAttribute('r'), type || 'n');
      });
      var get = function(col, row) { return cells.get(col + row) || ''; };
      var cols = null, header = 0;
      for (var row = 1; row <= 20; row++) {
        var found = {};
        cells.forEach(function(text, ref) {
          var m = /^([A-Z]+)(\d+)$/.exec(ref);
          if (!m || Number(m[2]) !== row) return;
          var key = label(text);
          if (key === 'itemname') found.name = m[1];
          if (key === 'qty' || key === 'quantity') found.qty = m[1];
          if (key === 'link') found.link = m[1];
          if (key === 'type') found.category = m[1];
          if (key === 'location') found.location = m[1];
        });
        if (found.name && found.qty && found.link && found.category) { cols = found; header = row; break; }
      }
      if (!cols) continue;
      var currencies = {};
      cells.forEach(function(text, ref) {
        var m = /^([A-Z]+)(\d+)$/.exec(ref), key = text.toUpperCase();
        if (m && Number(m[2]) === header + 1 && ['CNY', 'HKD', 'USD'].indexOf(key) !== -1) currencies[key] = m[1];
      });
      if (!currencies.CNY || !currencies.HKD || !currencies.USD || !cols.location)
        throw new Error('Use the standard order form with Location and CNY / HKD / USD amount columns.');
      var links = new Map();
      if (zip.file(relPath(sheetPath))) {
        nodes(await readXML(zip, relPath(sheetPath), env, budget), 'Relationship').forEach(function(r) {
          if (/\/hyperlink$/.test(r.getAttribute('Type') || '') && /^https?:\/\//i.test(r.getAttribute('Target') || '')) links.set(r.getAttribute('Id'), r.getAttribute('Target'));
        });
      }
      var hyperlinks = new Map(nodes(doc, 'hyperlink').map(function(h) { return [h.getAttribute('ref'), links.get(h.getAttributeNS(REL, 'id'))]; }));
      var rows = Array.from(new Set(Array.from(cells.keys()).filter(function(ref) { return /^[A-Z]+\d+$/.test(ref); })
        .map(function(ref) { return Number(ref.replace(/^[A-Z]+/, '')); }))).filter(function(r) { return r > header + 1; }).sort(function(a,b) { return a-b; });
      var items = [], footer = null;
      for (var r of rows) {
        var name = get(cols.name, r), qty = get(cols.qty, r);
        var footerName = label(name), footerType = label(get(cols.category, r));
        if (/^(total|totalamount|totalcost|subtotal|studentname|nameofstudent|signofstudent|approvedby|總計|合計)$/.test(footerName)
            || /^(ee|mech|sw)partssubtotal$/.test(footerType)) { if (!footer) footer = r; continue; }
        if (!name && !qty) continue;
        if (footer) { if (name && qty && Number(qty) > 0) throw new Error('There are extra item rows after the totals. Review the original form.'); continue; }
        var quantity = numeric(qty, 'Quantity at row ' + r, true);
        if (!name || name.length > 2000 || quantity > 1000000 || Math.abs(quantity * 1000 - Math.round(quantity * 1000)) > 1e-6)
          throw new Error('Item name or quantity at row ' + r + ' is invalid. Quantities allow up to three decimals.');
        var amounts = Object.keys(currencies).map(function(currency) {
          var text = get(currencies[currency], r);
          return { currency: currency, amount: text ? numeric(text, currency + ' amount at row ' + r, false) : null };
        });
        var positive = amounts.filter(function(a) { return a.amount > 0; });
        if (positive.length > 1) throw new Error('Row ' + r + ' has amounts in several currencies. Review it in Drive first.');
        var amount = positive[0] || amounts.find(function(a) { return a.amount !== null; });
        var link = hyperlinks.get(cols.link + r) || get(cols.link, r);
        items.push({ id: items.length + 1, name: name, spec: '', quantity: quantity,
          price: amount ? amount.amount / quantity : null, currency: amount ? amount.currency : 'CNY',
          amount: amount ? amount.amount : null, category: get(cols.category, r) || 'Others',
          location: get(cols.location, r) || 'Online', link: /^https?:\/\//i.test(link) ? link : '',
          date: get('B', r), dateType: cellTypes.get('B' + r), status: get('K', r), sourceRow: r, confidence: !!amount });
        if (items.length > 30 || r > header + 31) throw new Error('This order exceeds the 30-row editor. Open it in Drive; no items were imported or truncated.');
      }
      if (!items.length) continue;
      results.push({ items: items, competition: get('C', 3), student: get('H', 66),
        hasSignature: await hasExistingSignature(zip, doc, sheetPath, env, budget),
        layout: { sheetPath: sheetPath, start: header + 2, end: Math.min(header + 31, footer ? footer - 1 : header + 31), cols: cols, currencies: currencies } });
    }
    if (!results.length) throw new Error('No standard order-form items were found in this workbook.');
    if (results.length !== 1) throw new Error('Several worksheets contain orders. Import a workbook with one order form.');
    return results[0];
  }

  async function updateWorkbook(context, snapshot, runtime) {
    var env = runtime || root, layout = context.order.layout;
    if (snapshot.items.length > layout.end - layout.start + 1) throw new Error('The original form has no room for these items. Keep within its item rows.');
    var zip = await env.JSZip.loadAsync(context.bytes), budget = { bytes: 0 };
    var doc = await readXML(zip, layout.sheetPath, env, budget), sheetData = one(doc, 'sheetData');
    var serializer = new env.XMLSerializer();
    var templateRow = nodes(sheetData, 'row').find(function(row) { return Number(row.getAttribute('r')) === layout.start; });
    function cell(ref, text, number) {
      var r = Number(ref.replace(/^[A-Z]+/, '')), col = ref.replace(/\d+$/, '');
      var row = nodes(sheetData, 'row').find(function(n) { return Number(n.getAttribute('r')) === r; });
      if (!row) {
        row = doc.createElementNS(NS, 'row'); row.setAttribute('r', r);
        var after = nodes(sheetData, 'row').find(function(n) { return Number(n.getAttribute('r')) > r; });
        sheetData.insertBefore(row, after || null);
      }
      var old = Array.from(row.children).find(function(n) { return n.localName === 'c' && n.getAttribute('r') === ref; });
      var c = doc.createElementNS(NS, 'c'); c.setAttribute('r', ref);
      var style = old || (templateRow && Array.from(templateRow.children).find(function(n) { return n.getAttribute('r') === col + layout.start; }));
      if (style && style.hasAttribute('s')) c.setAttribute('s', style.getAttribute('s'));
      if (text !== '' && text !== null && text !== undefined) {
        if (number) { var v = doc.createElementNS(NS, 'v'); v.textContent = String(text); c.appendChild(v); }
        else { c.setAttribute('t', 'inlineStr'); var is = doc.createElementNS(NS, 'is'), t = doc.createElementNS(NS, 't'); t.textContent = String(text); t.setAttribute('xml:space', 'preserve'); is.appendChild(t); c.appendChild(is); }
      }
      if (old) row.replaceChild(c, old);
      else {
        var colNum = function(s) { return s.split('').reduce(function(n,ch) { return n*26 + ch.charCodeAt(0)-64; }, 0); };
        var next = Array.from(row.children).find(function(n) { return n.localName === 'c' && colNum(n.getAttribute('r').replace(/\d+$/, '')) > colNum(col); });
        row.insertBefore(c, next || null);
      }
    }
    var today = new Date(), date = (today.getMonth()+1) + '/' + today.getDate() + '/' + today.getFullYear();
    for (var r = layout.start; r <= layout.end; r++) {
      var item = snapshot.items[r - layout.start], original = item && context.order.items.find(function(old) { return old.id === item.importId; });
      var same = item && snapshot.competition === context.order.competition && snapshot.student === context.order.student && unchanged(item, original);
      cell('A' + r, item ? r - layout.start + 1 : '', true);
      cell('B' + r, item ? same ? original.date : date : '', !!(same && original.dateType === 'n'));
      cell(layout.cols.name + r, item ? displayName(item) : '');
      cell(layout.cols.location + r, item ? item.location || 'Online' : '');
      cell(layout.cols.link + r, item ? item.link || '' : '');
      cell(layout.cols.qty + r, item ? item.quantity : '', true);
      cell(layout.cols.category + r, item ? item.category || 'Others' : '');
      Object.keys(layout.currencies).forEach(function(currency) {
        var amount = '';
        if (item) amount = (item.currency || 'CNY') === currency ?
          same && original.amount !== null ? original.amount : Math.round((item.price || 0) * item.quantity * 100) / 100 : 0;
        cell(layout.currencies[currency] + r, amount, true);
      });
      cell('K' + r, item ? same ? original.status : 'Pending Approval' : '');
    }
    nodes(doc, 'hyperlink').forEach(function(h) {
      var ref = h.getAttribute('ref'), m = /^([A-Z]+)(\d+)$/.exec(ref || '');
      if (m && m[1] === layout.cols.link && Number(m[2]) >= layout.start && Number(m[2]) <= layout.end) h.remove();
    });
    cell('C3', snapshot.competition); cell('H66', snapshot.student); cell('H74', date);
    nodes(doc, 'c').forEach(function(c) { if (one(c, 'f')) nodes(c, 'v').forEach(function(v) { v.remove(); }); });
    if (snapshot.signature && snapshot.signature.dataUrl) {
      await stampSignature(zip, doc, layout.sheetPath, snapshot.signature, env, budget);
    } else if (!await hasExistingSignature(zip, doc, layout.sheetPath, env, budget)) {
      throw new Error('No signature image was found in the student signature area. Sign or upload a signature before saving.');
    }
    zip.file(layout.sheetPath, serializer.serializeToString(doc));
    var book = await readXML(zip, 'xl/workbook.xml', env, budget), calc = one(book, 'calcPr');
    if (!calc) { calc = book.createElementNS(NS, 'calcPr'); book.documentElement.appendChild(calc); }
    calc.setAttribute('fullCalcOnLoad', '1'); calc.setAttribute('forceFullCalc', '1');
    zip.file('xl/workbook.xml', serializer.serializeToString(book));
    return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  }

  async function stampSignature(zip, sheet, sheetPath, signature, env, budget) {
    if (!signature || !/^data:image\/png;base64,/.test(signature.dataUrl || '')) throw new Error('Sign the edited form before saving.');
    var serialize = function(doc) { return new env.XMLSerializer().serializeToString(doc); };
    var sheetRelsPath = relPath(sheetPath);
    var rels = zip.file(sheetRelsPath) ? await readXML(zip, sheetRelsPath, env, budget) : parse('<Relationships xmlns="' + PKG + '"/>', env);
    var drawing = one(sheet, 'drawing'), relation = drawing && nodes(rels, 'Relationship').find(function(r) { return r.getAttribute('Id') === drawing.getAttributeNS(REL, 'id'); });
    var drawingPath;
    if (relation) drawingPath = path(sheetPath, relation.getAttribute('Target'));
    else {
      var n = 1; while (zip.file('xl/drawings/order-edit-' + n + '.xml')) n++;
      drawingPath = 'xl/drawings/order-edit-' + n + '.xml';
      var id = 'rIdOrderEdit' + n;
      while (nodes(rels, 'Relationship').some(function(r) { return r.getAttribute('Id') === id; })) id += 'x';
      relation = rels.createElementNS(PKG, 'Relationship'); relation.setAttribute('Id', id); relation.setAttribute('Type', REL + '/drawing'); relation.setAttribute('Target', '../drawings/order-edit-' + n + '.xml'); rels.documentElement.appendChild(relation);
      drawing = sheet.createElementNS(NS, 'drawing'); drawing.setAttributeNS(REL, 'r:id', id); sheet.documentElement.appendChild(drawing);
    }
    if (!/^xl\/drawings\/[^/]+\.xml$/.test(drawingPath)) throw new Error('This form uses an unsupported drawing layout.');
    var draw = zip.file(drawingPath) ? await readXML(zip, drawingPath, env, budget) : parse('<xdr:wsDr xmlns:xdr="' + XDR + '" xmlns:a="' + DRAW + '" xmlns:r="' + REL + '"/>', env);
    var drawingRelsPath = relPath(drawingPath), drawRels = zip.file(drawingRelsPath) ? await readXML(zip, drawingRelsPath, env, budget) : parse('<Relationships xmlns="' + PKG + '"/>', env);
    signatureAnchors(draw, sheet).forEach(function(anchor) { anchor.remove(); });
    var usedImages = new Set(nodes(draw, 'blip').map(function(blip) { return blip.getAttributeNS(REL, 'embed'); }));
    var unused = nodes(drawRels, 'Relationship').filter(function(r) { return /\/image$/.test(r.getAttribute('Type') || '') && !usedImages.has(r.getAttribute('Id')); });
    for (var image of unused) {
      var oldPath = path(drawingPath, image.getAttribute('Target')), elsewhere = false;
      if (/^xl\/media\//.test(oldPath)) {
        for (var filename of Object.keys(zip.files).filter(function(name) { return name !== drawingRelsPath && /\/_rels\/[^/]+\.rels$/.test(name); })) {
          var other = await readXML(zip, filename, env, budget);
          var owner = filename.replace('/_rels/', '/').replace(/\.rels$/, '');
          if (nodes(other, 'Relationship').some(function(r) { return path(owner, r.getAttribute('Target') || '') === oldPath; })) { elsewhere = true; break; }
        }
        if (!elsewhere) zip.remove(oldPath);
      }
      image.remove();
    }
    var imageIndex = 1; while (zip.file('xl/media/order-edit-signature-' + imageIndex + '.png')) imageIndex++;
    var imageName = 'order-edit-signature-' + imageIndex + '.png', imageId = 'rIdOrderSignature' + imageIndex;
    while (nodes(drawRels, 'Relationship').some(function(r) { return r.getAttribute('Id') === imageId; })) imageId += 'x';
    zip.file('xl/media/' + imageName, signature.dataUrl.split(',')[1], { base64: true });
    var imageRel = drawRels.createElementNS(PKG, 'Relationship'); imageRel.setAttribute('Id', imageId); imageRel.setAttribute('Type', REL + '/image'); imageRel.setAttribute('Target', '../media/' + imageName); drawRels.documentElement.appendChild(imageRel);
    var aspect = Number(signature.aspect) || 4, height = 0.55, width = height * aspect;
    if (width > 3.4) { width = 3.4; height = width / aspect; }
    var pictureId = Math.max(1000, ...nodes(draw, 'cNvPr').map(function(pic) { return Number(pic.getAttribute('id')) || 0; })) + 1;
    var anchorXML = '<xdr:oneCellAnchor xmlns:xdr="' + XDR + '" xmlns:a="' + DRAW + '" xmlns:r="' + REL + '"><xdr:from><xdr:col>7</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>69</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="' + Math.round(width*914400) + '" cy="' + Math.round(height*914400) + '"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="' + pictureId + '" name="signature.png"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="' + imageId + '"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>';
    draw.documentElement.appendChild(draw.importNode(parse(anchorXML, env).documentElement, true));
    var types = await readXML(zip, '[Content_Types].xml', env, budget), CT = types.documentElement.namespaceURI;
    if (!nodes(types, 'Default').some(function(n) { return n.getAttribute('Extension') === 'png'; })) {
      var png = types.createElementNS(CT, 'Default'); png.setAttribute('Extension', 'png'); png.setAttribute('ContentType', 'image/png'); types.documentElement.appendChild(png);
    }
    if (!nodes(types, 'Override').some(function(n) { return n.getAttribute('PartName') === '/' + drawingPath; })) {
      var override = types.createElementNS(CT, 'Override'); override.setAttribute('PartName', '/' + drawingPath); override.setAttribute('ContentType', 'application/vnd.openxmlformats-officedocument.drawing+xml'); types.documentElement.appendChild(override);
    }
    zip.file('[Content_Types].xml', serialize(types)); zip.file(sheetRelsPath, serialize(rels));
    zip.file(drawingPath, serialize(draw)); zip.file(drawingRelsPath, serialize(drawRels));
  }

  var api = { readWorkbook: readWorkbook, updateWorkbook: updateWorkbook };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OrderFormImport = api;
})(typeof window !== 'undefined' ? window : globalThis);
