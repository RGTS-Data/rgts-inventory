// 母單保留（migrations/0007）。母單／提貨單關聯讀 rgts-pi 的 projects.parent_id（唯讀）。
// 保留剩餘＝保留量 − 所有提貨單已領的同料號量（從 inv_moves 算，沖銷會自動算回來）。
import { projKey, mainNo } from './projkey.js';
import { chunk } from './util.js';

// 母單 key → { parent: [projects 列], kids: [提貨單 projKey] }
export async function familyOf(env, parentKey) {
  const main = mainNo(parentKey);
  if (!main) return { parent: [], kids: [] };
  const rows = (await env.DB.prepare(
    `SELECT id, project_no FROM projects WHERE project_no LIKE ? AND status != 'cancelled'`
  ).bind(main + '%').all()).results || [];
  const parent = rows.filter((r) => projKey(r.project_no) === parentKey);
  if (!parent.length) return { parent, kids: [] };
  const ids = parent.map((r) => r.id);
  const kids = (await env.DB.prepare(
    `SELECT project_no, qty, status FROM projects WHERE parent_id IN (${ids.map(() => '?').join(',')}) AND status != 'cancelled'`
  ).bind(...ids).all()).results || [];
  return { parent, kids: kids.map((k) => ({ ...k, key: projKey(k.project_no) })) };
}

// 提貨單們已領量（料號 → 量）
export async function issuedBy(env, keys, parts = null) {
  const out = new Map();
  if (!keys.length) return out;
  for (const c of chunk(keys, 40)) {
    let sql = `SELECT part_no, -SUM(qty_delta) q FROM inv_moves WHERE type='issue' AND project_no IN (${c.map(() => '?').join(',')})`;
    const bind = [...c];
    sql += ' GROUP BY part_no';
    for (const r of (await env.DB.prepare(sql).bind(...bind).all()).results || []) {
      if (parts && !parts.has(r.part_no)) continue;
      out.set(r.part_no, (out.get(r.part_no) || 0) + (Number(r.q) || 0));
    }
  }
  return out;
}

// 這些料號目前「還被保留著」的量，依母單分開：part → [{parent_key, left}]
// 給領料單用：看要領的料是不是被別張母單保留了。
export async function openReserves(env, parts) {
  const out = new Map();
  if (!parts.length) return out;
  const rows = [];
  for (const c of chunk(parts)) {
    rows.push(...((await env.DB.prepare(
      `SELECT parent_key, part_no, qty FROM inv_reserve WHERE released_at IS NULL AND part_no IN (${c.map(() => '?').join(',')})`
    ).bind(...c).all()).results || []));
  }
  const byParent = new Map();
  for (const r of rows) (byParent.get(r.parent_key) || byParent.set(r.parent_key, []).get(r.parent_key)).push(r);
  for (const [pk, list] of byParent) {
    const fam = await familyOf(env, pk);
    const used = await issuedBy(env, fam.kids.map((k) => k.key), new Set(list.map((r) => r.part_no)));
    for (const r of list) {
      const left = Math.max(0, (Number(r.qty) || 0) - (used.get(r.part_no) || 0));
      if (left <= 0) continue;
      (out.get(r.part_no) || out.set(r.part_no, []).get(r.part_no)).push({ parent_key: pk, kids: fam.kids.map((k) => k.key), left });
    }
  }
  return out;
}
