/* rgts-inventory 前端認證（classic script，掛 window.INVAuth）
 * CF Access 全站 ALLOW → tryAutoLogin() 從 /api/auth/me 拿 admin_token 存進 localStorage
 * → authedFetch 帶 X-Admin-Token。token 框保留為 script/fallback。
 * ⚠ TOKEN_KEY 全站一致 = 'inv_admin_token'。 */
(function () {
  var TOKEN_KEY = 'inv_admin_token';
  var USER_KEY = 'inv_user_email';

  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
  }
  function setToken(t) {
    try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch (e) {}
  }
  function getEmail() {
    try { return localStorage.getItem(USER_KEY) || ''; } catch (e) { return ''; }
  }
  function setEmail(e) {
    try { e ? localStorage.setItem(USER_KEY, e) : localStorage.removeItem(USER_KEY); } catch (x) {}
  }

  // CF Access 自動登入：回 { authenticated, email }。
  async function tryAutoLogin() {
    try {
      var r = await fetch('/api/auth/me?_=' + Date.now(), { credentials: 'include' });
      if (!r.ok) return { authenticated: false };
      var j = await r.json();
      if (j && j.authenticated) {
        if (j.admin_token) setToken(j.admin_token);
        if (j.email) setEmail(j.email);
        return { authenticated: true, email: j.email };
      }
    } catch (e) {}
    return { authenticated: false };
  }

  // 帶 X-Admin-Token 的 fetch
  function authedFetch(url, opts) {
    opts = opts || {};
    opts.headers = opts.headers || {};
    var t = getToken();
    if (t) opts.headers['X-Admin-Token'] = t;
    opts.credentials = 'include';
    return fetch(url, opts);
  }

  function logout() {
    setToken('');
    setEmail('');
    // CF cookie 也要清，否則會自動重登
    location.href = '/cdn-cgi/access/logout';
  }

  window.INVAuth = {
    TOKEN_KEY: TOKEN_KEY,
    getToken: getToken,
    setToken: setToken,
    getEmail: getEmail,
    tryAutoLogin: tryAutoLogin,
    authedFetch: authedFetch,
    logout: logout,
  };
})();
