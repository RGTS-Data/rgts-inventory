// GET /api/auth/me
// CF Access ALLOW 路徑會注入 Cf-Access-Jwt-Assertion → 回 email + admin_token（= env.ADMIN_TOKEN）
// 前端 _lib/auth.js 拿 admin_token 存進 localStorage，之後 authedFetch 帶 X-Admin-Token。
// ⚠ 此路徑千萬別被 CF Access Bypass 蓋掉，否則拿不到 JWT → 永遠登不進。
import { cfAccessEmail } from '../_lib/cf-access.js';
import { json } from '../_lib/json.js';

export async function onRequestGet({ request, env }) {
  const email = cfAccessEmail(request);
  if (!email) {
    return json({ ok: false, authenticated: false }, 200);
  }
  return json({
    ok: true,
    authenticated: true,
    email,
    admin_token: env.ADMIN_TOKEN || null,
    is_admin: true,
  });
}
