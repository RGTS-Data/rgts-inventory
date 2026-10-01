// Cloudflare Access JWT 解析（只 decode，不做簽章驗證 —— 信任 CF Access 已在邊緣驗過）。
// 與 bom-tool / rgts-rma 同一套慣例：ALLOW 路徑才會注入 Cf-Access-Jwt-Assertion。
function b64urlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  try {
    return atob(s);
  } catch {
    return '';
  }
}

// 回傳 email（沒有就 null）
export function cfAccessEmail(request) {
  const jwt =
    request.headers.get('Cf-Access-Jwt-Assertion') ||
    request.headers.get('cf-access-jwt-assertion');
  if (!jwt) return null;
  const parts = jwt.split('.');
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(b64urlDecode(parts[1]));
    return payload.email || payload.identity || null;
  } catch {
    return null;
  }
}
