// POST /api/issue/post  領料扣帳（以專案號為單位，Chris 2026-10-01）
// body: { project_no, part_no, qty, wh_code='Z', note }
// 不可扣成負數（庫存不足 409）。扣帳＝inv_stock 減量 ＋ inv_moves 寫一筆 issue，兩句同一個 D1 batch（原子）。
import { requireAuth } from '../_lib/auth.js';
import { ok, err, readBody } from '../_lib/json.js';
import { nowIso, normPart } from '../_lib/util.js';
import { projKey, mainNo } from '../_lib/projkey.js';

export async function onRequestPost({ request, env }) {
  const { user, failed } = requireAuth(request, env);
  if (failed) return failed;
  if (!env.DB) return err('DB binding missing', 500);
  const b = await readBody(request);
  const project = projKey(b.project_no);   // 統一存 BOM 寫法（3509-5），見 _lib/projkey.js
  const part = normPart(b.part_no);
  const qty = Number(b.qty);
  const wh = String(b.wh_code || 'Z').trim().toUpperCase();
  if (!project || !part || !(qty > 0)) return err('project_no / part_no / qty(>0) 必填');

  // 專案必須存在：BOM 現行版有這個專案號，或專案總表（3509(5) 寫法）正規化後對得上（唯讀查）
  const inBom = await env.DB.prepare(
    `SELECT 1 AS x FROM bom_projects WHERE UPPER(project_no) = ? AND is_current = 1 LIMIT 1`
  ).bind(project).first();
  let known = !!inBom;
  if (!known) {
    const cand = (await env.DB.prepare(`SELECT project_no FROM projects WHERE project_no LIKE ? LIMIT 200`)
      .bind(`%${mainNo(project)}%`).all()).results || [];
    known = cand.some((x) => projKey(x.project_no) === project);
  }
  if (!known) return err(`查無專案 ${project}（BOM 與專案總表都沒有）`, 404, { code: 'project_unknown' });

  const ts = nowIso();
  // 先寫流水帳（只有庫存夠才寫得進去），再扣庫存（同條件）；兩句同批原子執行
  const res = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO inv_moves (ts,type,part_no,wh_code,qty_delta,qty_after,project_no,note,created_by)
       SELECT ?,?,?,?,?, qty - ?, ?,?,? FROM inv_stock WHERE part_no=? AND wh_code=? AND qty >= ?`
    ).bind(ts, 'issue', part, wh, -qty, qty, project, b.note ? String(b.note) : null, user.email, part, wh, qty),
    env.DB.prepare(
      `UPDATE inv_stock SET qty = qty - ?, updated_at = ? WHERE part_no=? AND wh_code=? AND qty >= ?`
    ).bind(qty, ts, part, wh, qty),
  ]);
  if (!res[1].meta.changes) {
    const s = await env.DB.prepare(`SELECT qty FROM inv_stock WHERE part_no=? AND wh_code=?`).bind(part, wh).first();
    return err(`庫存不足：${part} @${wh} 現有 ${s ? s.qty : 0}、要領 ${qty}`, 409, { code: 'insufficient', on_hand: s ? s.qty : 0 });
  }
  return ok({ project_no: project, part_no: part, wh_code: wh, issued: qty });
}
