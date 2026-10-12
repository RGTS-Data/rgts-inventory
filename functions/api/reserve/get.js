// GET /api/reserve/get?project_no=  母單保留：母單 BOM 需求、保留量、提貨單已領、保留剩餘、現有庫存
import { requireAuth } from '../_lib/auth.js';
import { ok, err } from '../_lib/json.js';
import { chunk } from '../_lib/util.js';
import { projKey } from '../_lib/projkey.js';
import { bomNeed } from '../_lib/bom-need.js';
import { familyOf, issuedBy } from '../_lib/reserve.js';

export async function onRequestGet({ request, env }) {
  const { failed } = requireAuth(request, env);
  if (failed) return failed;
  if (!env.DB) return err('DB binding missing', 500);
  const key = projKey(new URL(request.url).searchParams.get('project_no'));
  if (!key) return err('project_no 必填');

  const fam = await familyOf(env, key);
  if (!fam.parent.length) return err(`專案總表查無 ${key}`, 404, { code: 'project_unknown' });
  const { bp, need } = await bomNeed(env, key);
  const res = (await env.DB.prepare(
    `SELECT part_no, qty, note, updated_by, updated_at FROM inv_reserve WHERE parent_key = ? AND released_at IS NULL`
  ).bind(key).all()).results || [];
  const resMap = new Map(res.map((r) => [r.part_no, r]));
  const parts = [...new Set([...need.keys(), ...resMap.keys()])];
  const used = await issuedBy(env, fam.kids.map((k) => k.key), new Set(parts));
  const onHand = new Map();
  for (const c of chunk(parts)) {
    for (const s of (await env.DB.prepare(
      `SELECT part_no, SUM(qty) q FROM inv_stock WHERE part_no IN (${c.map(() => '?').join(',')}) GROUP BY part_no`
    ).bind(...c).all()).results || []) onHand.set(s.part_no, Number(s.q) || 0);
  }
  const rows = parts.map((p) => {
    const n = need.get(p) || { part_no: p, name: '', spec: '', need: 0 };
    const r = resMap.get(p);
    const reserved = r ? Number(r.qty) || 0 : 0;
    const taken = used.get(p) || 0;
    return { part_no: p, name: n.name, spec: n.spec, need: n.need, reserved, taken,
      left: Math.max(0, reserved - taken), on_hand: onHand.get(p) || 0, note: r ? r.note : null };
  });
  const released = await env.DB.prepare(
    `SELECT COUNT(*) n, MAX(released_at) AS rel_at, MAX(released_by) AS rel_by FROM inv_reserve WHERE parent_key = ? AND released_at IS NOT NULL`
  ).bind(key).first();
  return ok({ project_no: key, bom: bp, kids: fam.kids, rows, released: Number(released?.n) ? released : null });
}
