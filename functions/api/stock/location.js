// POST /api/stock/location  設定儲位：{ part_no, wh_code, location }（空字串＝清除）
// 儲位跟著「料號×倉庫」走（正航單據的「細項描述」，例 B4-03）。記下誰、何時改的。
import { requireAuth } from '../_lib/auth.js';
import { ok, err, readBody } from '../_lib/json.js';
import { nowIso, normPart } from '../_lib/util.js';

export async function onRequestPost({ request, env }) {
  const { user, failed } = requireAuth(request, env);
  if (failed) return failed;
  if (!env.DB) return err('DB binding missing', 500);
  const b = await readBody(request);
  const part = normPart(b.part_no);
  const wh = String(b.wh_code || '').trim().toUpperCase();
  const loc = String(b.location ?? '').trim().toUpperCase().slice(0, 40) || null;
  if (!part || !wh) return err('料號與倉庫必填');
  const r = await env.DB.prepare(
    `UPDATE inv_stock SET location = ?, location_by = ?, location_at = ? WHERE part_no = ? AND wh_code = ?`
  ).bind(loc, user.email, nowIso(), part, wh).run();
  if (!r.meta?.changes) return err(`庫存沒有 ${part} @${wh} 這一列`, 404);
  return ok({ part_no: part, wh_code: wh, location: loc });
}
