// POST /api/docs/transfer  調撥單（委外加工發料／送修／重工／借出 → 調動倉別）→ 建單即過帳
// body: { doc_date, project_no(選填，正航的「自定欄一」), note, lines:[{part_no, qty, wh_code(撥出), to_wh(撥入), note}] }
// part_no 以 * 開頭（例 *控卡*1、*治具*1）＝備註列，照記但不動庫存（同正航單據寫法）。
import { requireAuth } from '../_lib/auth.js';
import { ok, err, readBody } from '../_lib/json.js';
import { createDoc, docDate, parseLines } from '../_lib/docs.js';
import { projKey } from '../_lib/projkey.js';

export async function onRequestPost({ request, env }) {
  const { user, failed } = requireAuth(request, env);
  if (failed) return failed;
  if (!env.DB) return err('DB binding missing', 500);
  const b = await readBody(request);
  const lines = parseLines(b.lines).filter((l) => l.part_no && l.qty > 0);
  if (!lines.length) return err('至少要有一列');
  if (lines.length > 80) return err('一張單最多 80 列');
  for (const l of lines) {
    if (l.part_no.startsWith('*')) continue;
    if (!l.wh_code || !l.to_wh) return err(`${l.part_no}：撥出倉、撥入倉都要填`);
    if (l.wh_code === l.to_wh) return err(`${l.part_no}：撥出倉與撥入倉相同`);
  }
  const project = b.project_no ? projKey(b.project_no) : null;
  try {
    const { docNo } = await createDoc(env, 'transfer', { doc_date: docDate(b.doc_date), status: 'draft', project_no: project, note: b.note || null },
      lines, { post: true, email: user.email, project });
    return ok({ doc_no: docNo, lines: lines.length });
  } catch (e) {
    if (e.code === 'insufficient') return err(e.message, 409, { code: 'insufficient' });
    throw e;
  }
}
