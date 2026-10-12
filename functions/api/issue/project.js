// GET /api/issue/project?project_no=  領料用：該專案現行 BOM（bom_projects.is_current=1）＋各料現有庫存＋本專案已領量
// 唯讀 bom_* / projects。BOM 需求量＝qty_total，沒填就 qty_per × 台數。劃線/總量≤0 的列不列（不用領）。
import { requireAuth } from '../_lib/auth.js';
import { ok, err } from '../_lib/json.js';
import { chunk } from '../_lib/util.js';
import { bomNeed } from '../_lib/bom-need.js';
import { openReserves } from '../_lib/reserve.js';
import { projKey } from '../_lib/projkey.js';
import { shippedInfo } from '../_lib/shipped.js';

export async function onRequestGet({ request, env }) {
  const { failed } = requireAuth(request, env);
  if (failed) return failed;
  if (!env.DB) return err('DB binding missing', 500);
  const key = projKey(new URL(request.url).searchParams.get('project_no'));
  if (!key) return err('project_no 必填');

  const { bp, need } = await bomNeed(env, key);
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
  // 母單保留（migrations/0007）：被保留給「別張母單」的量要先扣掉才是這張單能領的。
  //   本專案就是那張母單的提貨單 → 那份保留本來就是給它的，不扣（列為 reserved_mine）。
  const resv = await openReserves(env, parts);
  const rows = parts.map((p) => {
    const st = stock.get(p) || [];
    let other = 0, mine = 0; const by = [];
    for (const x of resv.get(p) || []) {
      if (x.parent_key === key || x.kids.includes(key)) mine += x.left;
      else { other += x.left; by.push(x.parent_key); }
    }
    return { ...need.get(p), stock: st, on_hand: st.reduce((s, x) => s + x.qty, 0), issued: issued.get(p) || 0,
      reserved_other: other, reserved_by: by, reserved_mine: mine };
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
  // 已出貨（專案總表有出貨日或已開發票）→ 前端鎖 BOM 需求、只允許「補料」並寫原因（Chris 2026-10-11）
  const shipped = await shippedInfo(env, key);
  return ok({ project_no: key, bom: bp || null, rows, logs, docs, shipped });
}
