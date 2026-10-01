/* rgts-inventory 極簡（自 rgts-rma 移植） .xlsx 產生器（classic script，掛 window.INVXlsx）
 *
 * 為什麼自己寫：本 repo 是 Cloudflare Pages 純靜態、沒有 package.json，
 * 不能 bundle npm；又不想相依 CDN（離線/擋外連就掛）。
 * .xlsx = ZIP + 幾支 XML，用「不壓縮(store)」寫 ZIP 就好，Excel 照樣開。
 *
 * 用法：
 *   INVXlsx.download('檔名.xlsx', {
 *     sheet: 'RMA report',
 *     rows: [['RMA No.','Model',...], ['RMA2Y6...','PFS-12WN',...]],   // 第一列＝表頭
 *     widths: [8, 12, 10, ...],                        // 選填，字元寬
 *     boldRows: [0, 5, 9],                             // 選填，要粗體的列索引（表頭/小計）
 *     textCols: [2, 3],                                // 選填，強制當文字的欄（序號/單號別被轉成數字）
 *     wrapCols: [6, 7, 8]                              // 選填，自動換行的欄（檢測紀錄那種長文字）
 *   });
 *
 * 型別：數字（含可轉數字的字串）寫成數值格，其餘走 inlineStr（不用 sharedStrings，簡單且不會錯）。
 * 附帶：表頭凍結（凍第一列）＋自動篩選。
 */
(function () {
  // ---------- CRC32（ZIP 需要） ----------
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  var enc = function (s) { return new TextEncoder().encode(s); };

  // ---------- ZIP（store，不壓縮） ----------
  function zip(files) {
    var chunks = [], central = [], offset = 0;
    files.forEach(function (f) {
      var name = enc(f.name), data = enc(f.data), crc = crc32(data);
      var lf = new DataView(new ArrayBuffer(30));
      lf.setUint32(0, 0x04034b50, true);   // local file header
      lf.setUint16(4, 20, true);           // version needed
      lf.setUint16(6, 0x0800, true);       // flag: UTF-8 檔名
      lf.setUint16(8, 0, true);            // method 0 = store
      lf.setUint16(10, 0, true); lf.setUint16(12, 0, true); // time/date
      lf.setUint32(14, crc, true);
      lf.setUint32(18, data.length, true);
      lf.setUint32(22, data.length, true);
      lf.setUint16(26, name.length, true);
      lf.setUint16(28, 0, true);
      chunks.push(new Uint8Array(lf.buffer), name, data);

      var cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true);   // central directory header
      cd.setUint16(4, 20, true); cd.setUint16(6, 20, true);
      cd.setUint16(8, 0x0800, true);
      cd.setUint16(10, 0, true);
      cd.setUint16(12, 0, true); cd.setUint16(14, 0, true);
      cd.setUint32(16, crc, true);
      cd.setUint32(20, data.length, true);
      cd.setUint32(24, data.length, true);
      cd.setUint16(28, name.length, true);
      cd.setUint16(30, 0, true); cd.setUint16(32, 0, true);
      cd.setUint16(34, 0, true); cd.setUint16(36, 0, true);
      cd.setUint32(38, 0, true);
      cd.setUint32(42, offset, true);
      central.push(new Uint8Array(cd.buffer), name);
      offset += 30 + name.length + data.length;
    });
    var cdSize = central.reduce(function (s, a) { return s + a.length; }, 0);
    var end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, offset, true);
    return new Blob(chunks.concat(central, [new Uint8Array(end.buffer)]), {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
  }

  // ---------- XML ----------
  var esc = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');   // XML 不允許的控制字元
  };
  function colName(n) {                                 // 0 → A, 26 → AA
    var s = '';
    for (n = n + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s;
    return s;
  }
  // 只有「乾淨的數字」才寫成數值格：避免 3491(2)、8/14、R2026… 被 Excel 亂轉
  function isNum(v) {
    if (typeof v === 'number') return isFinite(v);
    if (typeof v !== 'string') return false;
    return /^-?\d+(\.\d+)?$/.test(v.trim()) && v.trim() !== '';
  }

  function sheetXml(rows, widths, boldSet, textSet, wrapSet) {
    var cols = '';
    if (widths && widths.length) {
      cols = '<cols>' + widths.map(function (w, i) {
        return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>';
      }).join('') + '</cols>';
    }
    var body = rows.map(function (r, ri) {
      var cells = r.map(function (v, ci) {
        var ref = colName(ci) + (ri + 1);
        // 0=一般 1=粗體 2=自動換行 3=粗體+換行
        var si = (boldSet[ri] ? 1 : 0) + ((wrapSet[ci] && !boldSet[ri]) ? 2 : 0);
        var style = si ? ' s="' + si + '"' : '';
        if (v === null || v === undefined || v === '') return '<c r="' + ref + '"' + style + '/>';
        // textCols：序號 / 單號這種「長得像數字但必須是文字」的欄，轉數字會掉前導 0、也會右對齊
        if (!textSet[ci] && isNum(v)) return '<c r="' + ref + '"' + style + '><v>' + Number(v) + '</v></c>';
        return '<c r="' + ref + '"' + style + ' t="inlineStr"><is><t xml:space="preserve">' + esc(v) + '</t></is></c>';
      }).join('');
      return '<row r="' + (ri + 1) + '">' + cells + '</row>';
    }).join('');
    var lastCol = colName(Math.max(0, (rows[0] || []).length - 1));
    var dim = 'A1:' + lastCol + Math.max(1, rows.length);
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<dimension ref="' + dim + '"/>' +
      '<sheetViews><sheetView workbookViewId="0">' +
      '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
      '</sheetView></sheetViews>' +
      '<sheetFormatPr defaultRowHeight="15"/>' + cols +
      '<sheetData>' + body + '</sheetData>' +
      (rows.length > 1 ? '<autoFilter ref="A1:' + lastCol + rows.length + '"/>' : '') +
      '</worksheet>';
  }

  var STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="2"><fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    // Excel 預設垂直靠下（看起來字都黏在格子底部）→ 全部設 vertical="center"。
    // 水平不指定，保留 Excel 慣例：文字靠左、數字靠右。
    '<cellXfs count="4">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1">' +
      '<alignment vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1">' +
      '<alignment vertical="center"/></xf>' +
    // s=2 長文字欄：自動換行 + 靠上，不然檢測紀錄會被截在一行看不到
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1">' +
      '<alignment vertical="top" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1">' +
      '<alignment vertical="top" wrapText="1"/></xf>' +
    '</cellXfs>' +
    // 少了 cellStyles(Normal) 有些讀取器會抱怨「no default style」，補上比較保險
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  function build(opts) {
    var rows = opts.rows || [];
    var name = String(opts.sheet || 'Sheet1').replace(/[\\\/\?\*\[\]:]/g, '-').slice(0, 31) || 'Sheet1';
    var boldSet = {}, textSet = {}, wrapSet = {};
    (opts.boldRows || [0]).forEach(function (i) { boldSet[i] = 1; });
    (opts.textCols || []).forEach(function (i) { textSet[i] = 1; });
    (opts.wrapCols || []).forEach(function (i) { wrapSet[i] = 1; });
    return zip([
      { name: '[Content_Types].xml', data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        '</Types>' },
      { name: '_rels/.rels', data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>' },
      { name: 'xl/workbook.xml', data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets><sheet name="' + esc(name) + '" sheetId="1" r:id="rId1"/></sheets></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '</Relationships>' },
      { name: 'xl/styles.xml', data: STYLES },
      { name: 'xl/worksheets/sheet1.xml', data: sheetXml(rows, opts.widths, boldSet, textSet, wrapSet) }
    ]);
  }

  function download(filename, opts) {
    var blob = build(opts);
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  window.INVXlsx = { build: build, download: download };
})();
