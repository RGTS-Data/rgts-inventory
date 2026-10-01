// 認證：CF Access JWT（瀏覽器）或 X-Admin-Token / Bearer（script）二擇一。
// 與 rgts-rma / bom-tool 同模型。
import { cfAccessEmail } from './cf-access.js';

// 讀取請求帶的 admin token（header 或 Bearer）
function tokenFromRequest(request) {
  const h = request.headers.get('X-Admin-Token') || request.headers.get('x-admin-token');
  if (h) return h;
  const auth = request.headers.get('Authorization') || request.headers.get('authorization');
  if (auth && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();
  return null;
}

// 成功回 { email }；失敗回 null。CF JWT 優先（人免 token），否則比對 env.ADMIN_TOKEN。
export function authUser(request, env) {
  const email = cfAccessEmail(request);
  if (email) return { email, via: 'cf-access' };
  const tok = tokenFromRequest(request);
  if (tok && env.ADMIN_TOKEN && tok === env.ADMIN_TOKEN) {
    return { email: 'token', via: 'admin-token' };
  }
  return null;
}

// 需要登入才放行；未過回 401 Response（呼叫端 return 它）。
export function requireAuth(request, env) {
  const u = authUser(request, env);
  if (!u) {
    return {
      user: null,
      failed: new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      }),
    };
  }
  return { user: u, failed: null };
}
