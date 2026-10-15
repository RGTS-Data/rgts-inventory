// POST /api/docs/issue  領料單（以專案為單位；正航是「訂單轉銷貨單」代用）→ 建單即過帳扣庫存
// body: { doc_date, project_no, note, lines:[{part_no, qty, wh_code, note, kind}] }  qty 可為 0（未領列，不扣帳）
// kind='loss'＝產線損耗補料（bom-tool 當時成本會算進去、報價成本不算）
// 任何一列庫存不足 → 整張不過帳（409）。
import { requireAuth } from '../_lib/auth.js';
import { ok, err, readBody } from '../_lib/json.js';
import { createDoc, docDate, parseLines } from '../_lib/docs.js';
import { projKey } from '../_lib/projkey.js';
import { projectKnown } from '../_lib/project-known.js';
import { shippedInfo } from '../_lib/shipped.js';

export async function onRequestPost({ request, env }) {
  const { user, failed } = requireAuth(request, env);
  if (failed) return failed;
  if (!env.DB) return err('DB binding missing', 500);
  const b = await readBody(request);
  const project = projKey(b.project_no);
  // qty=0 的列＝「BOM 還需要但本次沒領」（多半無庫存），照記在單上給備料／產線看，postStmts 會跳過不扣帳（Willy 2026-10-15）
  const all = parseLines(b.lines).filter((l) => l.part_no && l.qty >= 0).map((l) => ({ ...l, wh_code: l.wh_code || 'Z' }));
  const real = all.filter((l) => l.qty > 0);
  // 領料列排前面、未領列排後面
  let lines = real.concat(all.filter((l) => l.qty === 0 && !String(l.part_no).startsWith('*')));
  if (!project) return err('專案號必填');
  if (!real.length) return err('至少要有一列（本次數量 > 0）');
  if (real.length > 80) return err('一張單最多領 80 列');
  if (lines.length > 300) return err('一張單最多 300 列（含未領列）');
  if (lines.some((l) => l.kind === 'loss' && !l.note)) return err('損耗補料要寫原因', 400, { code: 'loss_need_reason' });
  if (!(await projectKnown(env, project))) return err(`查無專案 ${project}（BOM 與專案總表都沒有）`, 404, { code: 'project_unknown' });
  // 已出貨的專案不再依 BOM 領料，只能補料：每列都要寫原因（Chris 2026-10-11）
  const sh = await shippedInfo(env, project);
  if (sh) lines = real;   // 已出貨不列未領列（BOM 需求已不能領）
  if (sh && lines.some((l) => !l.note)) {
    return err(`專案 ${project} 已出貨（${sh.ship_date || sh.status}），只能補料：每一列都要寫原因`, 409, { code: 'shipped_need_reason' });
  }
  try {
    const { docNo } = await createDoc(env, 'issue', { doc_date: docDate(b.doc_date), status: 'draft', project_no: project, note: b.note || null },
      lines, { post: true, email: user.email, project });
    return ok({ doc_no: docNo, lines: real.length, zero: lines.length - real.length });
  } catch (e) {
    if (e.code === 'insufficient') return err(e.message, 409, { code: 'insufficient' });
    throw e;
  }
}
