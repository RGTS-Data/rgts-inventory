// GET /api/moves/list?part=&project=&type=&limit=  異動流水帳（唯讀）
import { requireAuth } from '../_lib/auth.js';
import { ok, err } from '../_lib/json.js';
import { projKey } from '../_lib/projkey.js';

export async function onRequestGet({ request, env }) {
  const { failed } = requireAuth(request, env);
  if (failed) return failed;
  if (!env.DB) return err('DB binding missing', 500);
  const u = new URL(request.url);
  const where = [], bind = [];
  for (const [k, col] of [['part', 'part_no'], ['project', 'project_no'], ['type', 'type']]) {
    const v = (u.searchParams.get(k) || '').trim();
    if (v) { where.push(`${col} = ?`); bind.push(k === 'part' ? v.toUpperCase() : k === 'project' ? projKey(v) : v); }
  }
  const limit = Math.min(Number(u.searchParams.get('limit')) || 200, 1000);
  const r = await env.DB.prepare(
    `SELECT * FROM inv_moves ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`
  ).bind(...bind, limit).all();
  return ok({ rows: r.results || [] });
}
