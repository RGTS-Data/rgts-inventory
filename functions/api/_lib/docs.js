// 單據共用：取號、過帳（寫流水帳＋改庫存）、線上作業是否已開始。
// 過帳一律「單一 D1 batch」：任何一列扣成負數 → inv_guard 的 NOT NULL 失敗 → 整批回滾，不會只扣一半。
import { nowIso } from './util.js';

export const DOC_PREFIX = { receipt: 'RC', issue: 'IS', transfer: 'TR' };
export const DOC_LABEL = { receipt: '進貨單', issue: '領料單', transfer: '調撥單' };
export const ONLINE_TYPES = ['receipt', 'issue', 'transfer_out', 'transfer_in'];

// 日期一律 YYYY-MM-DD；空的用台灣今天
export function docDate(s) {
  const v = String(s || '').trim().replace(/\//g, '-');
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  return new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
}

// 下一個單號：前綴＋YYYYMMDD＋3 碼流水（取 MAX，不靠「最新一列」）
export async function nextDocNo(env, type, date) {
  const base = DOC_PREFIX[type] + date.replace(/-/g, '');
  const r = await env.DB.prepare(
    `SELECT MAX(CAST(substr(doc_no, ?) AS INTEGER)) AS m FROM inv_docs WHERE doc_no LIKE ?`
  ).bind(base.length + 1, base + '%').first();
  return base + String((Number(r?.m) || 0) + 1).padStart(3, '0');
}

// 是否已開始線上進出（之後覆蓋同步／匯入要擋）
export async function onlineStarted(env) {
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS n, MIN(ts) AS first_ts FROM inv_moves WHERE type IN (${ONLINE_TYPES.map(() => '?').join(',')})`
  ).bind(...ONLINE_TYPES).first();
  return { n: Number(r?.n) || 0, first_ts: r?.first_ts || null };
}

const isMemo = (l) => !l.part_no || String(l.part_no).startsWith('*');

// 過帳語句（不執行）。docRef＝取得 doc id 的 SQL 片段與參數（建單同批時用 doc_no 子查詢）
export function postStmts(env, { type, docNo, project, invoiceNo, email, lines }) {
  const ts = nowIso();
  const DOC = `(SELECT id FROM inv_docs WHERE doc_no = ?)`;
  const S = [];
  const qtyOf = `(SELECT qty FROM inv_stock WHERE part_no = ? AND wh_code = ?)`;
  const ensure = (part, wh, name) => env.DB.prepare(
    `INSERT INTO inv_stock (part_no, wh_code, name, qty, updated_at) VALUES (?,?,?,0,?) ON CONFLICT(part_no, wh_code) DO NOTHING`
  ).bind(part, wh, name || null, ts);
  const add = (part, wh, delta) => env.DB.prepare(
    `UPDATE inv_stock SET qty = qty + ?, updated_at = ? WHERE part_no = ? AND wh_code = ?`
  ).bind(delta, ts, part, wh);
  const move = (mtype, l, wh, delta) => env.DB.prepare(
    `INSERT INTO inv_moves (ts,type,part_no,wh_code,qty_delta,qty_after,project_no,po_line_id,invoice_no,amount,note,created_by,doc_id)
     VALUES (?,?,?,?,?,${qtyOf},?,?,?,?,?,?,${DOC})`
  ).bind(ts, mtype, l.part_no, wh, delta, l.part_no, wh, project || null, l.po_line_id || null,
    invoiceNo || null, l.amount ?? null, l.note || null, email, docNo);

  for (const l of lines) {
    if (isMemo(l)) continue;
    if (type === 'receipt') {
      S.push(ensure(l.part_no, l.wh_code, l.name), add(l.part_no, l.wh_code, l.qty), move('receipt', l, l.wh_code, l.qty));
    } else if (type === 'issue') {
      S.push(ensure(l.part_no, l.wh_code, l.name), add(l.part_no, l.wh_code, -l.qty), move('issue', l, l.wh_code, -l.qty));
    } else if (type === 'transfer') {
      S.push(ensure(l.part_no, l.wh_code, l.name), add(l.part_no, l.wh_code, -l.qty), move('transfer_out', l, l.wh_code, -l.qty));
      S.push(ensure(l.part_no, l.to_wh, l.name), add(l.part_no, l.to_wh, l.qty), move('transfer_in', l, l.to_wh, l.qty));
    }
  }
  if (type !== 'receipt') {
    // 守門：本單碰到的出庫列只要有負數 → 插 NULL 觸發 NOT NULL → 整批回滾
    S.push(env.DB.prepare(
      `INSERT INTO inv_guard (ok) SELECT NULL WHERE EXISTS (
         SELECT 1 FROM inv_doc_lines l JOIN inv_stock s ON s.part_no = l.part_no AND s.wh_code = l.wh_code
         WHERE l.doc_id = ${DOC} AND s.qty < -0.000001)`
    ).bind(docNo));
  }
  S.push(env.DB.prepare(`UPDATE inv_docs SET status='posted', posted_by=?, posted_at=? WHERE doc_no = ?`).bind(email, ts, docNo));
  return S;
}

// 建單語句：表頭＋明細
export function createStmts(env, h, lines) {
  const S = [env.DB.prepare(
    `INSERT INTO inv_docs (doc_no, doc_type, doc_date, status, vendor, invoice_no, invoice_amount, project_no, note, created_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(h.doc_no, h.doc_type, h.doc_date, h.status, h.vendor ?? null, h.invoice_no ?? null, h.invoice_amount ?? null,
    h.project_no ?? null, h.note ?? null, h.email, nowIso())];
  lines.forEach((l, i) => S.push(env.DB.prepare(
    `INSERT INTO inv_doc_lines (doc_id, seq, part_no, name, qty, wh_code, to_wh, po_line_id, po_no, unit_price, amount, note)
     VALUES ((SELECT id FROM inv_docs WHERE doc_no = ?),?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(h.doc_no, i + 1, l.part_no || null, l.name || null, l.qty, l.wh_code || null, l.to_wh || null,
    l.po_line_id || null, l.po_no || null, l.unit_price ?? null, l.amount ?? null, l.note || null)));
  return S;
}

// 取號＋寫入，撞到 UNIQUE（兩人同時開單）就重取號重試
export async function createDoc(env, type, h, lines, { post = false, email, project, invoiceNo } = {}) {
  for (let i = 0; i < 4; i++) {
    const docNo = await nextDocNo(env, type, h.doc_date);
    const stmts = createStmts(env, { ...h, doc_no: docNo, doc_type: type, email }, lines);
    if (post) stmts.push(...postStmts(env, { type, docNo, project, invoiceNo, email, lines }));
    try {
      await env.DB.batch(stmts);
      return { docNo };
    } catch (e) {
      const m = String(e && e.message);
      if (/UNIQUE/i.test(m) && /doc_no/i.test(m)) continue;
      if (/NOT NULL/i.test(m) && /inv_guard/i.test(m)) {
        const er = new Error('庫存不足，整張單未過帳（請看各列現有庫存）'); er.code = 'insufficient'; throw er;
      }
      throw e;
    }
  }
  throw new Error('取號衝突，請重試');
}

export const parseLines = (arr) => (Array.isArray(arr) ? arr : []).map((l) => ({
  part_no: String(l.part_no ?? '').trim().toUpperCase().startsWith('*') ? String(l.part_no).trim() : String(l.part_no ?? '').trim().toUpperCase(),
  name: l.name ? String(l.name).trim() : null,
  qty: Number(String(l.qty ?? '').replace(/,/g, '')),
  wh_code: String(l.wh_code ?? '').trim().toUpperCase() || null,
  to_wh: String(l.to_wh ?? '').trim().toUpperCase() || null,
  po_line_id: Number(l.po_line_id) || null,
  note: l.note ? String(l.note).trim() : null,
}));
