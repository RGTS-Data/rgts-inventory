// 庫存「覆蓋」寫入的共用邏輯：Excel 上傳（import/stock）與 Google Sheet 同步（admin/sync-sheet）共用同一套，
// 改規則只改這支。語意：該列 qty 直接設成來源值；與舊值有差就寫一筆 import_adjust 進流水帳。
// ⚠ 來源沒出現的列「不動」（不歸零）。
import { normPart, chunk } from './util.js';

const num = (v) => {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};

// 來源列 → 乾淨列；同 (料號,倉庫) 重複時後者覆蓋前者
export function cleanRows(rows) {
  const m = new Map();
  for (const r of rows || []) {
    const part = normPart(r.part_no);
    const wh = String(r.wh_code ?? '').trim().toUpperCase();
    if (!part || !wh) continue;
    m.set(`${part}|${wh}`, {
      part, wh,
      wh_name: r.wh_name ? String(r.wh_name).trim() : null,
      name: r.name ? String(r.name).trim() : null,
      unit: r.unit ? String(r.unit).trim() : null,
      qty: num(r.qty), borrow_in: num(r.borrow_in), borrow_out: num(r.borrow_out),
    });
  }
  return [...m.values()];
}

// 舊庫存量：parts=null → 整表撈一次（同步用，省查詢次數）；否則只撈這些料號
export async function loadOld(env, parts = null) {
  const old = new Map();
  const put = (rs) => { for (const o of rs || []) old.set(`${o.part_no}|${o.wh_code}`, Number(o.qty) || 0); };
  if (!parts) {
    put((await env.DB.prepare(`SELECT part_no, wh_code, qty FROM inv_stock`).all()).results);
    return old;
  }
  for (const c of chunk([...new Set(parts)])) {
    put((await env.DB.prepare(
      `SELECT part_no, wh_code, qty FROM inv_stock WHERE part_no IN (${c.map(() => '?').join(',')})`
    ).bind(...c).all()).results);
  }
  return old;
}

// 產生寫入語句（不執行）；回 { stmts, adjusted }
export function buildStmts(env, list, old, { batch, ts, email }) {
  const stmts = [];
  let adjusted = 0;
  for (const x of list) {
    const prev = old.get(`${x.part}|${x.wh}`) ?? 0;
    stmts.push(env.DB.prepare(
      `INSERT INTO inv_stock (part_no, wh_code, wh_name, name, unit, qty, borrow_in, borrow_out, import_batch, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(part_no, wh_code) DO UPDATE SET
         wh_name=excluded.wh_name, name=excluded.name, unit=excluded.unit, qty=excluded.qty,
         borrow_in=excluded.borrow_in, borrow_out=excluded.borrow_out,
         import_batch=excluded.import_batch, updated_at=excluded.updated_at`
    ).bind(x.part, x.wh, x.wh_name, x.name, x.unit, x.qty, x.borrow_in, x.borrow_out, batch, ts));
    if (x.qty !== prev) {
      adjusted++;
      stmts.push(env.DB.prepare(
        `INSERT INTO inv_moves (ts,type,part_no,wh_code,qty_delta,qty_after,batch,note,created_by)
         VALUES (?,?,?,?,?,?,?,?,?)`
      ).bind(ts, 'import_adjust', x.part, x.wh, x.qty - prev, x.qty, batch, `覆蓋：${prev} → ${x.qty}`, email));
    }
  }
  return { stmts, adjusted };
}

// 匯入批次紀錄（同 batch 分多次送時累加列數）；dataDate＝這份資料是哪一天的庫存
export function importLogStmt(env, { batch, ts, source, rows, email, dataDate = null }) {
  return env.DB.prepare(
    `INSERT INTO inv_imports (batch, ts, source, row_count, created_by, data_date) VALUES (?,?,?,?,?,?)
     ON CONFLICT(batch) DO UPDATE SET row_count = row_count + excluded.row_count, source = excluded.source,
       data_date = COALESCE(excluded.data_date, data_date)`
  ).bind(batch, ts, source, rows, email, dataDate);
}

// 目前庫存的資料日期（最近一次成功匯入/同步所記的 data_date）
export async function latestDataDate(env) {
  const r = await env.DB.prepare(`SELECT MAX(data_date) AS d FROM inv_imports WHERE data_date IS NOT NULL AND row_count > 0`).first();
  return r?.d || null;
}

// 完整覆蓋：這批沒出現的 (料號,倉) 一律歸零（留流水帳）。
// 用在「正航存量明細表」：它只列有庫存的料 → 沒出現＝0。
export function zeroMissingStmts(env, { batch, ts, email }) {
  return [
    env.DB.prepare(
      `INSERT INTO inv_moves (ts,type,part_no,wh_code,qty_delta,qty_after,batch,note,created_by)
       SELECT ?, 'import_adjust', part_no, wh_code, -qty, 0, ?, '完整覆蓋：檔案沒有此列 → 歸零（原 ' || qty || '）', ?
       FROM inv_stock WHERE COALESCE(import_batch,'') <> ? AND qty <> 0`
    ).bind(ts, batch, email, batch),
    env.DB.prepare(
      `UPDATE inv_stock SET qty = 0, borrow_in = 0, borrow_out = 0, updated_at = ?
       WHERE COALESCE(import_batch,'') <> ? AND (qty <> 0 OR borrow_in <> 0 OR borrow_out <> 0)`
    ).bind(ts, batch),
  ];
}
