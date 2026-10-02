/* 頁面共用小工具（classic script，掛 window.U） */
(function () {
  var U = {};
  U.$ = function (i) { return document.getElementById(i); };
  U.esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  U.num = function (v) { var n = Number(String(v == null ? '' : v).replace(/,/g, '')); return isFinite(n) ? n : 0; };
  U.fmt = function (n) { return (Math.round(U.num(n) * 1e6) / 1e6).toLocaleString('en-US', { maximumFractionDigits: 4 }); };
  U.today = function () { return new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10); };
  U.api = async function (u, body) {
    var r = await INVAuth.authedFetch(u, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
    var d = {}; try { d = await r.json(); } catch (e) {}
    if (!r.ok || !d.ok) { var x = new Error(d.error || ('HTTP ' + r.status)); x.code = d.code; x.data = d; throw x; }
    return d;
  };
  U.msg = function (t, cls) { var m = U.$('msg'); if (!m) return; m.className = 'msg ' + (cls || ''); m.textContent = t; };
  U.WH = ['Z', 'O', 'RD', 'R', 'HR', '00R', '00M'];
  U.whSel = function (attr, sel, extra) {
    var list = U.WH.concat(extra || []).filter(function (v, i, a) { return v && a.indexOf(v) === i; });
    return '<select ' + attr + '>' + list.map(function (w) { return '<option' + (w === sel ? ' selected' : '') + '>' + U.esc(w) + '</option>'; }).join('') + '</select>';
  };
  U.TYPE = { receipt: '進貨單', issue: '領料單', transfer: '調撥單' };
  U.STATUS = { pending: '<span class="tag wait">待核對</span>', posted: '<span class="tag ok">已過帳</span>', rejected: '<span class="tag bad">退回</span>', void: '<span class="tag muted">作廢</span>' };
  U.MOVE = { receipt: '進料', issue: '領料', transfer_out: '調出', transfer_in: '調入', import_adjust: '匯入覆蓋' };
  window.U = U;
})();
