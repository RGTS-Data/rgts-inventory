// POST /api/docs/issue  領料單（以專案為單位；正航是「訂單轉銷貨單」代用）→ 建單即過帳扣庫存
// body: { doc_date, project_no, note, lines:[{part_no, qty, wh_code, note}] }
// 任何一列庫存不足 → 整張不過帳（409）。
import { requireAuth } from '../_lib/auth.js';
import { ok, err, readBody } from '../_lib/json.js';
import { createDoc, docDate, parseLines } from '../_lib/docs.js';
import { projKey } from '../_lib/projkey.js';
import { projectKnown } from '../_lib/project-known.js';

export async function onRequestPost({ request, env }) {
  const { user, failed } = requireAuth(request, env);
  if (failed) return failed;
  if (!env.DB) return err('DB binding missing', 500);
  const b = await readBody(request);
  const project = projKey(b.project_no);
  const lines = parseLines(b.lines).filter((l) => l.part_no && l.qty > 0).map((l) => ({ ...l, wh_code: l.wh_code || 'Z' }));
  if (!project) return err('專案號必填');
  if (!lines.length) return err('至少要有一列');
  if (lines.length > 80) return err('一張單最多 80 列');
  if (!(await projectKnown(env, project))) return err(`查無專案 ${project}（BOM 與專案總表都沒有）`, 404, { code: 'project_unknown' });
  try {
    const { docNo } = await createDoc(env, 'issue', { doc_date: docDate(b.doc_date), status: 'draft', project_no: project, note: b.note || null },
      lines, { post: true, email: user.email, project });
    return ok({ doc_no: docNo, lines: lines.length });
  } catch (e) {
    if (e.code === 'insufficient') return err(e.message, 409, { code: 'insufficient' });
    throw e;
  }
}
