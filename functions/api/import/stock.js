// POST /api/import/stock  期初庫存匯入（Excel「庫存表」，前端 SheetJS 解析後分批送）
// body: { batch, source, rows:[{part_no,wh_code,wh_name,name,unit,qty,borrow_in,borrow_out}] }
// 語意＝「覆蓋」（Chris 2026-10-01：先用覆蓋，直到 Willy 全轉線上作業）：
//   該列 qty 直接設成 Excel 值；與舊值有差就寫一筆 import_adjust 進流水帳（帳不會憑空變，留痕）。
// ⚠ Excel 沒出現的列「不動」（不歸零）；要歸零另走 import/finish 且需明確確認。
import { requireAuth } from '../_lib/auth.js';
import { ok, err, readBody } from '../_lib/json.js';
import { nowIso, normPart, chunk } from '../_lib/util.js';

const num = (v) => {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};

export async function onRequestPost({ request, env }) {
  const { user, failed } = requireAuth(request, env);
  if (failed) return failed;
  if (!env.DB) return err('DB binding missing', 500);
  const b = await readBody(request);
  const batch = String(b.batch || '').trim();
  const rows = Array.isArray(b.rows) ? b.rows : [];
  if (!batch) return err('batch required');
  if (!rows.length) return err('rows empty');
  if (rows.length > 80) return err('一次最多 80 列（D1 batch 上限），請分批');

  // 同批內同 (料號,倉庫) 重複 → 後者覆蓋前者
  const clean = new Map();
  for (const r of rows) {
    const part = normPart(r.part_no);
    const wh = String(r.wh_code ?? '').trim().toUpperCase();
    if (!part || !wh) continue;
    clean.set(`${part}|${wh}`, {
      part, wh,
      wh_name: r.wh_name ? String(r.wh_name).trim() : null,
      name: r.name ? String(r.name).trim() : null,
      unit: r.unit ? String(r.unit).trim() : null,
      qty: num(r.qty), borrow_in: num(r.borrow_in), borrow_out: num(r.borrow_out),
    });
  }
  const list = [...clean.values()];
  if (!list.length) return err('沒有有效列（料號與倉庫編號必填）');

  // 取舊值（算差額）
  const old = new Map();
  for (const part of chunk([...new Set(list.map((x) => x.part))])) {
    const q = `SELECT part_no, wh_code, qty FROM inv_stock WHERE part_no IN (${part.map(() => '?').join(',')})`;
    const r = await env.DB.prepare(q).bind(...part).all();
    for (const o of r.results || []) old.set(`${o.part_no}|${o.wh_code}`, Number(o.qty) || 0);
  }

  const ts = nowIso();
  const stmts = [];
  let adjusted = 0;
  for (const x of list) {
    const prev = old.get(`${x.part}|${x.wh}`) ?? 0;
    stmts.push(
      env.DB.prepare(
        `INSERT INTO inv_stock (part_no, wh_code, wh_name, name, unit, qty, borrow_in, borrow_out, import_batch, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(part_no, wh_code) DO UPDATE SET
           wh_name=excluded.wh_name, name=excluded.name, unit=excluded.unit, qty=excluded.qty,
           borrow_in=excluded.borrow_in, borrow_out=excluded.borrow_out,
           import_batch=excluded.import_batch, updated_at=excluded.updated_at`
      ).bind(x.part, x.wh, x.wh_name, x.name, x.unit, x.qty, x.borrow_in, x.borrow_out, batch, ts)
    );
    if (x.qty !== prev) {
      adjusted++;
      stmts.push(
        env.DB.prepare(
          `INSERT INTO inv_moves (ts,type,part_no,wh_code,qty_delta,qty_after,batch,note,created_by)
           VALUES (?,?,?,?,?,?,?,?,?)`
        ).bind(ts, 'import_adjust', x.part, x.wh, x.qty - prev, x.qty, batch, `Excel 覆蓋：${prev} → ${x.qty}`, user.email)
      );
    }
  }
  stmts.push(
    env.DB.prepare(
      `INSERT INTO inv_imports (batch, ts, source, row_count, created_by) VALUES (?,?,?,?,?)
       ON CONFLICT(batch) DO UPDATE SET row_count = row_count + excluded.row_count`
    ).bind(batch, ts, String(b.source || ''), list.length, user.email)
  );
  await env.DB.batch(stmts);
  return ok({ batch, upserted: list.length, adjusted });
}
