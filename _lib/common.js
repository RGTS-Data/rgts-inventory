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
  // 委外調撥的治具聲明（後端 functions/api/_lib/docs.js 的 JIG_WH／JIG_OPTS 要同步）
  U.JIG_WH = ['O', 'R'];   // O＝(-)委外倉、R＝廠商重工倉
  U.JIG = { sent: '治具已隨附', vendor: '廠商自備', none: '不需治具' };
  U.TYPE = { receipt: '進貨單', issue: '領料單', transfer: '調撥單' };
  U.STATUS = { pending: '<span class="tag wait">待確認收貨</span>', posted: '<span class="tag ok">已過帳</span>', rejected: '<span class="tag bad">退回</span>', void: '<span class="tag muted">作廢</span>' };
  U.MOVE = { receipt: '進料', issue: '領料', transfer_out: '調出', transfer_in: '調入', import_adjust: '匯入覆蓋' };
  // 建單成功訊息＋「列印／匯出」連結（Willy 2026-10-15：三種單都要能列印、匯出）
  U.docMsg = function (text, docNo) {
    var m = U.$('msg'); if (!m) return;
    var q = encodeURIComponent(docNo);
    m.className = 'msg good';
    m.innerHTML = U.esc(text) + '　<a class="pn" href="/print.html?doc=' + q + '" target="_blank">🖨 列印</a>　' +
      '<a class="pn" href="/print.html?doc=' + q + '&auto=xlsx" target="_blank">📊 匯出 Excel</a>';
  };
  window.U = U;

  // 數量欄（input.q）鍵盤操作：↓／Enter＝下一列、↑＝上一列，跳過去自動全選（直接打字就覆蓋）。
  // Willy 2026-10-15：「數量欄位需要能用鍵盤操作直接往下」。只在同一個 tbody 內移動，disabled 的跳過。
  // ⚠ 全選只在鍵盤跳格時做；別掛在 focus 上（滑鼠點進去馬上打字，非同步 select 會吃掉第一個字）。
  document.addEventListener('keydown', function (e) {
    var t = e.target;
    if (!t || t.tagName !== 'INPUT' || !t.classList.contains('q') || e.isComposing) return;
    var dir = e.key === 'ArrowDown' || (e.key === 'Enter' && !e.shiftKey) ? 1 : e.key === 'ArrowUp' || (e.key === 'Enter' && e.shiftKey) ? -1 : 0;
    if (!dir) return;
    var box = t.closest('tbody') || document;
    var list = Array.prototype.filter.call(box.querySelectorAll('input.q'), function (x) { return !x.disabled && x.offsetParent !== null; });
    var i = list.indexOf(t), nx = list[i + dir];
    e.preventDefault();
    if (!nx) return;
    // 先觸發 change（各頁靠 change 事件記數量），再移焦點
    t.dispatchEvent(new Event('change', { bubbles: true }));
    nx = Array.prototype.filter.call(box.querySelectorAll('input.q'), function (x) { return !x.disabled && x.offsetParent !== null; })[i + dir] || nx;
    nx.focus(); nx.select();
  });
})();
