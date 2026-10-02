// GET /api/issue/project?project_no=  領料用：該專案現行 BOM（bom_projects.is_current=1）＋各料現有庫存＋本專案已領量
// 唯讀 bom_* / projects。BOM 需求量＝qty_total，沒填就 qty_per × 台數。劃線/總量≤0 的列不列（不用領）。
import { requireAuth } from '../_lib/auth.js';
import { ok, err } from '../_lib/json.js';
import { chunk, normPart } from '../_lib/util.js';
import { projKey } from '../_lib/projkey.js';

export async function onRequestGet({ request, env }) {
  const { failed } = requireAuth(request, env);
  if (failed) return failed;
  if (!env.DB) return err('DB binding missing', 500);
  const key = projKey(new URL(request.url).searchParams.get('project_no'));
  if (!key) return err('project_no 必填');

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
  const parts = [...need.keys()];
  const stock = new Map(), issued = new Map();
  for (const c of chunk(parts)) {
    const ph = c.map(() => '?').join(',');
    for (const s of (await env.DB.prepare(
      `SELECT part_no, wh_code, qty, location FROM inv_stock WHERE part_no IN (${ph}) AND qty <> 0`
    ).bind(...c).all()).results || []) {
      const a = stock.get(s.part_no) || []; a.push({ wh: s.wh_code, qty: Number(s.qty), loc: s.location || '' }); stock.set(s.part_no, a);
    }
    for (const m of (await env.DB.prepare(
      `SELECT part_no, -SUM(qty_delta) q FROM inv_moves WHERE type='issue' AND project_no = ? AND part_no IN (${ph}) GROUP BY part_no`
    ).bind(key, ...c).all()).results || []) issued.set(m.part_no, Number(m.q) || 0);
  }
  const rows = parts.map((p) => {
    const st = stock.get(p) || [];
    return { ...need.get(p), stock: st, on_hand: st.reduce((s, x) => s + x.qty, 0), issued: issued.get(p) || 0 };
  });
  // BOM 異動紀錄（bom-tool 的 bom_logs，唯讀）＋本專案庫存單據
  const logs = bp ? ((await env.DB.prepare(
    `SELECT ts, actor, action, field, old_value, new_value, summary FROM bom_logs
     WHERE project_id IN (SELECT id FROM bom_projects WHERE UPPER(project_no) = ?) ORDER BY id DESC LIMIT 100`
  ).bind(key).all()).results || []) : [];
  const docs = (await env.DB.prepare(
    `SELECT doc_no, doc_type, doc_date, status, created_by, reverses, reversed_by, (SELECT COUNT(*) FROM inv_doc_lines l WHERE l.doc_id = d.id) AS line_count
     FROM inv_docs d WHERE project_no = ? ORDER BY id DESC LIMIT 100`
  ).bind(key).all()).results || [];
  return ok({ project_no: key, bom: bp || null, rows, logs, docs });
}
