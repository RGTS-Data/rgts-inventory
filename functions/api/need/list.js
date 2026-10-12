// GET /api/need/list?until=YYYY-MM-DD  進貨需求（給阿國：要進多少）
// 需求＝PMC 有填「預排出貨日」的未出貨專案 × 現行 BOM（減掉本專案已領量）
// 可用＝原料倉 Z 的庫存（委外倉 O 只列參考：委外回來常變加工品、料號不同，Chris 2026-10-12）
// 在途＝採購總表「進貨日＝未到貨」、沒作廢的列，扣掉已過帳進貨量；按料號合計、不分專案（併單量拆不開）
// 建議進貨＝需求 − 原料倉 − 在途（<0 → 0）。全部唯讀：projects / pmc_project_meta / bom_* / purchase_* / inv_*。
import { requireAuth } from '../_lib/auth.js';
import { ok, err } from '../_lib/json.js';
import { chunk, normPart } from '../_lib/util.js';
import { projKey } from '../_lib/projkey.js';
import { receivedMap } from '../_lib/receipt-qty.js';

// 預排出貨日 → YYYY-MM-DD（取第一批）。支援 2027/01/10、11/20、7/31×8, 8/7×4。
// 沒寫年份：取今年；若已過去 60 天以上當成明年。解析不了回 ''（不會被日期篩選擋掉）。
function shipDate(s, today) {
  const t = String(s || '').split(/[,，]/)[0].trim();
  let m = t.match(/(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = t.match(/(\d{1,2})[\/\-.](\d{1,2})/);
  if (!m) return '';
  let y = Number(today.slice(0, 4));
  let d = `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  if ((Date.parse(today) - Date.parse(d)) / 86400e3 > 60) d = `${y + 1}${d.slice(4)}`;
  return d;
}

export async function onRequestGet({ request, env }) {
  const { failed } = requireAuth(request, env);
  if (failed) return failed;
  if (!env.DB) return err('DB binding missing', 500);
  const until = (new URL(request.url).searchParams.get('until') || '').trim();
  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);

  // 1) 有預排出貨日的未出貨專案（projects 一個專案號可能多列 → 依 projKey 合併）
  const pr = (await env.DB.prepare(
    `SELECT p.project_no, p.model_name, p.customer_abbr, p.qty, m.planned_ship, m.prepped
     FROM projects p JOIN pmc_project_meta m ON m.project_no = p.project_no
     WHERE p.status = 'pending' AND TRIM(COALESCE(m.planned_ship,'')) <> ''`
  ).all()).results || [];
  const projs = new Map();
  for (const r of pr) {
    const key = projKey(r.project_no);
    if (!key || projs.has(key)) continue;
    const ship = shipDate(r.planned_ship, today);
    if (until && ship && ship > until) continue;
    projs.set(key, { key, project_no: r.project_no, model: r.model_name, customer: r.customer_abbr,
      planned_ship: r.planned_ship, ship, prepped: !!r.prepped, bom: false });
  }
  const keys = [...projs.keys()];

  // 2) 現行 BOM（專案號完全對得上才算；對不到的列給阿國看，不拿主號 BOM 去猜）
  const bomOf = new Map();
  for (const c of chunk(keys)) {
    for (const b of (await env.DB.prepare(
      `SELECT id, UPPER(project_no) k, units FROM bom_projects WHERE is_current = 1 AND UPPER(project_no) IN (${c.map(() => '?').join(',')}) ORDER BY id`
    ).bind(...c).all()).results || []) bomOf.set(b.k, b);   // 同號多份取 id 最大
  }

  // 3) BOM 需求（規則同 issue/project.js：劃線/總量≤0/分隔列不算；總量沒填 → 單量×台數）
  const need = new Map();          // `${key}|${part}` → qty
  const info = new Map();          // part → { name, spec }
  const byId = new Map([...bomOf.values()].map((b) => [b.id, b]));
  for (const c of chunk([...byId.keys()])) {
    for (const it of (await env.DB.prepare(
      `SELECT project_id, part_no, name, spec, qty_per, qty_total FROM bom_items
       WHERE project_id IN (${c.map(() => '?').join(',')}) AND COALESCE(is_struck,0) = 0 AND COALESCE(part_no,'') <> ''`
    ).bind(...c).all()).results || []) {
      const p = normPart(it.part_no);
      if (!/[A-Z0-9]/.test(p)) continue;
      const b = byId.get(it.project_id);
      const q = Number(it.qty_total) > 0 ? Number(it.qty_total) : (Number(it.qty_per) || 0) * (Number(b.units) || 0);
      if (!(q > 0)) continue;
      const k = `${b.k}|${p}`;
      need.set(k, (need.get(k) || 0) + q);
      if (!info.has(p)) info.set(p, { name: it.name || '', spec: it.spec || '' });
      projs.get(b.k).bom = true;
    }
  }

  // 4) 已領量（本專案已過帳的領料，含反向單）→ 剩餘需求
  const issued = new Map();
  const bomKeys = keys.filter((k) => projs.get(k).bom);
  for (const c of chunk(bomKeys)) {
    for (const m of (await env.DB.prepare(
      `SELECT project_no, part_no, -SUM(qty_delta) q FROM inv_moves WHERE type = 'issue' AND project_no IN (${c.map(() => '?').join(',')}) GROUP BY project_no, part_no`
    ).bind(...c).all()).results || []) issued.set(`${m.project_no}|${m.part_no}`, Number(m.q) || 0);
  }
  const parts = new Map();         // part → { need, projects[] }
  for (const [k, q] of need) {
    const [key, p] = k.split('|');
    const rest = q - (issued.get(k) || 0);
    if (!(rest > 0)) continue;
    const pj = projs.get(key);
    const cur = parts.get(p) || { need: 0, projects: [] };
    cur.need += rest;
    cur.projects.push({ key, qty: rest, ship: pj.ship, planned_ship: pj.planned_ship, prepped: pj.prepped });
    parts.set(p, cur);
  }
  const plist = [...parts.keys()];

  // 5) 庫存：Z＝可用；O＝參考
  const stock = new Map();
  for (const c of chunk(plist)) {
    for (const s of (await env.DB.prepare(
      `SELECT part_no, wh_code, SUM(qty) q FROM inv_stock WHERE part_no IN (${c.map(() => '?').join(',')}) AND wh_code IN ('Z','O') GROUP BY part_no, wh_code`
    ).bind(...c).all()).results || []) {
      const a = stock.get(s.part_no) || { z: 0, o: 0 };
      if (s.wh_code === 'Z') a.z = Number(s.q) || 0; else a.o = Number(s.q) || 0;
      stock.set(s.part_no, a);
    }
  }

  // 6) 在途採購（只認「未到貨」：刪單／有進貨日期／作廢列都不算）
  const open = (await env.DB.prepare(
    `SELECT l.id, l.part_no, l.qty, l.vendor_eta, o.po_no, o.vendor FROM purchase_lines l
     JOIN purchase_orders o ON o.id = l.po_id
     LEFT JOIN purchase_line_voids v ON v.line_id = l.id
     WHERE TRIM(COALESCE(l.arrival_date,'')) = '未到貨' AND v.line_id IS NULL AND COALESCE(l.part_no,'') <> ''`
  ).all()).results || [];
  const want = new Set(plist);
  const mine = open.filter((x) => want.has(normPart(x.part_no)));
  const recv = await receivedMap(env, mine.map((x) => x.id));
  const onOrder = new Map();
  for (const x of mine) {
    const rest = (Number(x.qty) || 0) - (recv.get(x.id)?.posted || 0);
    if (!(rest > 0)) continue;
    const p = normPart(x.part_no);
    const a = onOrder.get(p) || { qty: 0, pos: [] };
    a.qty += rest;
    a.pos.push({ po_no: x.po_no, vendor: x.vendor, qty: rest, eta: x.vendor_eta || '' });
    onOrder.set(p, a);
  }

  // 7) 組結果
  const rows = plist.map((p) => {
    const n = parts.get(p), s = stock.get(p) || { z: 0, o: 0 }, oo = onOrder.get(p) || { qty: 0, pos: [] };
    n.projects.sort((a, b) => (a.ship || '9999').localeCompare(b.ship || '9999'));
    const buy = n.need - s.z - oo.qty;
    return { part_no: p, ...info.get(p), need: n.need, stock_z: s.z, stock_o: s.o, on_order: oo.qty,
      buy: buy > 0 ? buy : 0, first_ship: n.projects[0]?.ship || '', projects: n.projects, pos: oo.pos };
  }).sort((a, b) => (b.buy > 0) - (a.buy > 0) || (a.first_ship || '9999').localeCompare(b.first_ship || '9999'));
  const noBom = keys.filter((k) => !projs.get(k).bom).map((k) => projs.get(k))
    .sort((a, b) => (a.ship || '9999').localeCompare(b.ship || '9999'));
  return ok({ today, until, project_count: keys.length, rows, no_bom: noBom });
}
