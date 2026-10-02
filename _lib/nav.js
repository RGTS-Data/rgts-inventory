/* 全站導覽列（classic script）：<script src="/_lib/nav.js"></script> 放在 <body> 最前面 */
(function () {
  var L = [['/', '庫存總表'], ['/part.html', '料號查詢'], ['/receipt.html', '進貨單'], ['/issue.html', '領料單'],
    ['/transfer.html', '調撥單'], ['/docs.html', '單據查詢／核對'], ['/moves.html', '流水帳'], ['/import.html', 'Excel 匯入']];
  var p = location.pathname === '/index.html' ? '/' : location.pathname;
  var h = '<nav style="display:flex;flex-wrap:wrap;gap:2px;margin:-4px 0 10px;border-bottom:1px solid #ddd;font:14px system-ui,sans-serif">' +
    L.map(function (x) {
      var on = x[0] === p;
      return '<a href="' + x[0] + '" style="padding:6px 12px;text-decoration:none;' +
        (on ? 'border-bottom:2px solid #2563eb;color:#2563eb;font-weight:bold' : 'color:#444') + '">' + x[1] + '</a>';
    }).join('') + '</nav>';
  document.write(h);
})();
