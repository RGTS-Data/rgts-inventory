// 專案現行 BOM 的需求量（料號 → 需求）。領料單與母單保留共用，別各寫一份。
// 需求量＝qty_total，沒填就 qty_per × 台數；劃線／總量≤0／分隔列不算。
import { normPart } from './util.js';

export async function bomNeed(env, key) {
  const bp = await env.DB.prepare(
    `SELECT id, project_no, model, units, customer, status FROM bom_projects
     WHERE UPPER(project_no) = ? AND is_current = 1 ORDER BY id DESC LIMIT 1`
  ).bind(key).first();
  const items = bp ? ((await env.DB.prepare(
    `SELECT seq, part_no, name, spec, qty_per, qty_total, is_spare, note FROM bom_items
     WHERE project_id = ? AND COALESCE(is_struck,0) = 0 AND COALESCE(part_no,'') <> '' ORDER BY seq`
  ).bind(bp.id).all()).results || []) : [];
  const need = new Map();
  for (const it of items) {
    const p = normPart(it.part_no);
    if (!/[A-Z0-9]/.test(p)) continue;                      // 分隔列/佔位不是料
    const units = Number(bp.units) || 0;
    const q = Number(it.qty_total) > 0 ? Number(it.qty_total) : (Number(it.qty_per) || 0) * units;
    if (!(q > 0)) continue;
    const cur = need.get(p) || { part_no: p, name: it.name, spec: it.spec, need: 0, spare: 0 };
    cur.need += q; if (it.is_spare) cur.spare += q;
    need.set(p, cur);
  }
  return { bp: bp || null, need };
}
