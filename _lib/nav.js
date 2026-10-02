/* 全站置頂列（classic script）：<script src="/_lib/nav.js"></script> 放在 <body> 最前面。
   版型比照 rgts-pmc：深色列＝系統名＋頁名＋各頁連結＋使用者。頁面的第一個 h2 會被搬進置頂列當頁名。 */
(function () {
  var L = [['/', '庫存總表'], ['/part.html', '料號查詢'], ['/receipt.html', '進貨單'], ['/issue.html', '領料單'],
    ['/transfer.html', '調撥單'], ['/docs.html', '單據查詢／核對'], ['/moves.html', '流水帳'], ['/import.html', 'Excel 匯入']];
  var p = location.pathname === '/index.html' ? '/' : location.pathname;
  var cur = (L.find(function (x) { return x[0] === p; }) || [p, document.title])[1];
  document.write('<header class="top"><h1>📦 庫存 · <span id="pgtitle">' + cur + '</span></h1>' +
    L.map(function (x) { return '<a class="nv' + (x[0] === p ? ' on' : '') + '" href="' + x[0] + '">' + x[1] + '</a>'; }).join('') +
    '<div class="spacer"></div><div class="userchip" id="userchip"></div></header>');
  function esc(s) { return String(s || '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function chip() {
    var el = document.getElementById('userchip'); if (!el || !window.INVAuth) return;
    var email = INVAuth.getEmail();
    if (!email) { el.innerHTML = ''; return; }
    el.innerHTML = '<span class="avatar">' + esc(email[0].toUpperCase()) + '</span><span>' + esc(email) + '</span><button type="button" id="btnLogout">登出</button>';
    document.getElementById('btnLogout').onclick = INVAuth.logout;
  }
  document.addEventListener('DOMContentLoaded', function () {
    // 頁內第一個 h2 的文字搬進置頂列（較完整，例「進貨單（從採購單帶入）」），h2 本身隱藏
    var h = document.querySelector('body > h2');
    if (h) { document.getElementById('pgtitle').textContent = h.textContent.trim(); h.style.display = 'none'; }
    chip();
    if (window.INVAuth) INVAuth.tryAutoLogin().then(chip);
  });
})();
