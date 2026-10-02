// POST /api/import/finish  Excel 匯入收尾：{ batch, zero_missing }
// zero_missing=true → 這批沒出現的 (料號,倉) 全部歸零（正航存量明細表只列有庫存的料）。
// 安全檢查：這批至少要寫進 100 列才准歸零（防止只送了一小段就把整個庫存清空）。
import { requireAuth } from '../_lib/auth.js';
import { ok, err, readBody } from '../_lib/json.js';
import { nowIso } from '../_lib/util.js';
import { zeroMissingStmts } from '../_lib/stock-upsert.js';

export async function onRequestPost({ request, env }) {
  const { user, failed } = requireAuth(request, env);
  if (failed) return failed;
  if (!env.DB) return err('DB binding missing', 500);
  const b = await readBody(request);
  const batch = String(b.batch || '').trim();
  if (!batch) return err('batch required');
  const imp = await env.DB.prepare(`SELECT row_count FROM inv_imports WHERE batch = ?`).bind(batch).first();
  if (!imp) return err('找不到這批匯入', 404);
  if (!b.zero_missing) return ok({ zeroed: 0 });
  if ((Number(imp.row_count) || 0) < 100) return err(`這批只有 ${imp.row_count} 列，不執行「歸零」（防誤清整個庫存）`, 422);
  const n = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM inv_stock WHERE COALESCE(import_batch,'') <> ? AND (qty <> 0 OR borrow_in <> 0 OR borrow_out <> 0)`
  ).bind(batch).first();
  await env.DB.batch(zeroMissingStmts(env, { batch, ts: nowIso(), email: user.email }));
  return ok({ zeroed: Number(n?.n) || 0 });
}
