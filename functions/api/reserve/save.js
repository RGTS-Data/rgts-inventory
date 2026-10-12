// POST /api/reserve/save  母單保留：設定保留量（每料一列，qty 0＝刪掉這料的保留）
// body: { project_no, lines:[{part_no, qty, note}] }
import { requireAuth } from '../_lib/auth.js';
import { ok, err, readBody } from '../_lib/json.js';
import { nowIso, normPart } from '../_lib/util.js';
import { projKey } from '../_lib/projkey.js';
import { familyOf } from '../_lib/reserve.js';

export async function onRequestPost({ request, env }) {
  const { user, failed } = requireAuth(request, env);
  if (failed) return failed;
  if (!env.DB) return err('DB binding missing', 500);
  const b = await readBody(request);
  const key = projKey(b.project_no);
  if (!key) return err('專案號必填');
  const lines = (Array.isArray(b.lines) ? b.lines : []).map((l) => ({
    part_no: normPart(l.part_no), qty: Number(String(l.qty ?? '').replace(/,/g, '')), note: l.note ? String(l.note).trim().slice(0, 200) : null,
  })).filter((l) => /[A-Z0-9]/.test(l.part_no));
  if (!lines.length) return err('至少要有一列');
  if (lines.some((l) => !Number.isFinite(l.qty) || l.qty < 0)) return err('保留量要是 0 以上的數字');
  const fam = await familyOf(env, key);
  if (!fam.parent.length) return err(`專案總表查無 ${key}`, 404, { code: 'project_unknown' });
  const ts = nowIso();
  const S = [];
  for (const l of lines) {
    // 同母單同料只留一筆未釋放的：先刪再寫（qty 0＝只刪）
    S.push(env.DB.prepare(`DELETE FROM inv_reserve WHERE parent_key = ? AND part_no = ? AND released_at IS NULL`).bind(key, l.part_no));
    if (l.qty > 0) S.push(env.DB.prepare(
      `INSERT INTO inv_reserve (parent_key, part_no, qty, note, created_by, created_at, updated_by, updated_at) VALUES (?,?,?,?,?,?,?,?)`
    ).bind(key, l.part_no, l.qty, l.note, user.email, ts, user.email, ts));
  }
  await env.DB.batch(S);
  return ok({ project_no: key, saved: lines.length });
}
