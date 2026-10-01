// GET /api/stock/list?q=&wh=&limit=  現有庫存（料號×倉庫）
import { requireAuth } from '../_lib/auth.js';
import { ok, err } from '../_lib/json.js';

export async function onRequestGet({ request, env }) {
  const { failed } = requireAuth(request, env);
  if (failed) return failed;
  if (!env.DB) return err('DB binding missing', 500);
  const u = new URL(request.url);
  const q = (u.searchParams.get('q') || '').trim();
  const wh = (u.searchParams.get('wh') || '').trim();
  const limit = Math.min(Number(u.searchParams.get('limit')) || 200, 1000);
  const where = [];
  const bind = [];
  if (q) { where.push('(part_no LIKE ? OR name LIKE ?)'); bind.push(`%${q}%`, `%${q}%`); }
  if (wh) { where.push('wh_code = ?'); bind.push(wh); }
  const sql = `SELECT part_no, wh_code, wh_name, name, unit, qty, borrow_in, borrow_out, updated_at
               FROM inv_stock ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY part_no, wh_code LIMIT ?`;
  const r = await env.DB.prepare(sql).bind(...bind, limit).all();
  return ok({ rows: r.results || [] });
}
