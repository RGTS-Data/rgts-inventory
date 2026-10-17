// 統一發票號碼（GUI）共用規則：進貨單建單（docs/receipt）、補發票（docs/invoice）、拍照解析（docs/invoice-ocr）共用。
// 前端 common.js 的 U.GUI_RE／U.normGui 要同步。
// 台灣統一發票號碼＝2 個英文字母＋8 個數字（例 ET94824929）。
export const GUI_RE = /^[A-Z]{2}\d{8}$/;

// 去空白／連字號、轉大寫（ET-94824929、et 9482 4929 都算同一號）
export const normGui = (s) => String(s ?? '').toUpperCase().replace(/[\s\-－–]/g, '');

// 採購總表「發票」欄的佔位字（不是真的發票號）：無、-、刪單…
const PLACEHOLDER = /^(無|-+|—|刪單|未開|NA|N\/A)$/i;
export const realInv = (s) => { const v = normGui(s); return v && !PLACEHOLDER.test(v) ? v : ''; };

// 格式錯誤訊息；null＝通過。空的不算錯（發票可之後補）。
export function guiError(no, noGui) {
  const v = normGui(no);
  if (!v || noGui) return null;
  if (!GUI_RE.test(v)) return `發票號碼「${no}」格式不對：統一發票是 2 個英文字母＋8 個數字（例 ET94824929）。國外廠商／淘寶／收據請勾「無統一發票」`;
  return null;
}

// 採購總表上這些採購明細填的發票號（去重、去佔位字）
export async function poInvoices(env, poLineIds) {
  const ids = [...new Set(poLineIds.filter(Boolean))];
  const out = new Map();   // invoice → [po_no …]
  for (let i = 0; i < ids.length; i += 90) {
    const c = ids.slice(i, i + 90);
    const rs = (await env.DB.prepare(
      `SELECT l.invoice_no, o.po_no FROM purchase_lines l JOIN purchase_orders o ON o.id = l.po_id WHERE l.id IN (${c.map(() => '?').join(',')})`
    ).bind(...c).all()).results || [];
    for (const r of rs) { const v = realInv(r.invoice_no); if (v) { const a = out.get(v) || []; if (!a.includes(r.po_no)) a.push(r.po_no); out.set(v, a); } }
  }
  return out;
}

// 把「填的發票」跟「採購總表的發票」對起來；回 { invoice, error, code }
//  - 採購總表沒填 → 用填的（可空）
//  - 採購總表只有一張 → 沒填就自動帶入；有填但不一樣 → 擋
//  - 採購總表有多張 → 一張進貨單只能一張發票（同正航），請分開打
//  - noGui（無統一發票）：照原樣存（不轉大寫、不去連字號），比對時才正規化
export function reconcileInvoice(typed, po, noGui = false) {
  const raw = String(typed ?? '').trim();
  const t = normGui(typed);
  const list = [...po.keys()];
  if (!list.length) return { invoice: (noGui ? raw : t) || null };
  if (list.length > 1) {
    return { error: `這些採購明細在採購總表填了 ${list.length} 張不同發票：` + list.map((v) => `${v}（${po.get(v).join('、')}）`).join('、') + ' → 一張進貨單只能一張發票，請分開打', code: 'multi_invoice' };
  }
  const p = list[0];
  if (!t) return { invoice: p, from_po: true };
  if (t !== p) return { error: `發票號碼「${t}」跟採購總表（阿國填的）「${p}」不一樣 → 請確認是哪邊打錯，改正後再存`, code: 'invoice_mismatch', po_invoice: p };
  return { invoice: t, from_po: true };
}
