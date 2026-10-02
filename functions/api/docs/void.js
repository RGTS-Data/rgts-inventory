// POST /api/docs/void  作廢「尚未過帳」的進貨單（待核對／退回）。已過帳的單不能作廢（帳已動，要另開反向單）。
import { requireAuth } from '../_lib/auth.js';
import { ok, err, readBody } from '../_lib/json.js';
import { nowIso } from '../_lib/util.js';

export async function onRequestPost({ request, env }) {
  const { user, failed } = requireAuth(request, env);
  if (failed) return failed;
  const b = await readBody(request);
  const d = await env.DB.prepare(`SELECT id, status FROM inv_docs WHERE doc_no = ?`).bind(String(b.doc_no || '')).first();
  if (!d) return err('找不到單據', 404);
  if (!['pending', 'rejected'].includes(d.status)) return err('只能作廢「待核對／退回」的單；已過帳不能作廢', 409);
  await env.DB.prepare(`UPDATE inv_docs SET status='void', check_note=COALESCE(check_note,'')||? WHERE id=?`)
    .bind(` [作廢 ${user.email} ${nowIso().slice(0, 16)}]`, d.id).run();
  return ok({ status: 'void' });
}
