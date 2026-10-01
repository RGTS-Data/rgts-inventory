// GET /api/admin/last-sync  最近 5 次匯入/同步紀錄（含失敗），首頁顯示用
import { requireAuth } from '../_lib/auth.js';
import { ok, err } from '../_lib/json.js';

export async function onRequestGet({ request, env }) {
  const { failed } = requireAuth(request, env);
  if (failed) return failed;
  if (!env.DB) return err('DB binding missing', 500);
  const r = await env.DB.prepare(`SELECT batch, ts, source, row_count, created_by FROM inv_imports ORDER BY ts DESC LIMIT 5`).all();
  return ok({ rows: r.results || [] });
}
