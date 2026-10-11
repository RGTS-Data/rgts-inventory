-- rgts-inventory 0006：委外調撥的治具聲明（Chris 2026-10-09：委外貼合／加工常忘記帶治具 → 系統擋）
-- 撥入倉是委外倉（O）或廠商重工倉（R）的調撥單，過帳前一定要選：
--   sent   治具已隨附（jig_note 必填：治具名稱／數量）
--   vendor 廠商自備
--   none   不需治具（jig_note 必填：原因）
-- 其他單別、反向單、上線前的舊單＝NULL（沒有這一關）。
-- APPLIED: 2026-10-09 rgts-pi-db（Chris 要求做在 rgts-inventory）

ALTER TABLE inv_docs ADD COLUMN jig TEXT;
ALTER TABLE inv_docs ADD COLUMN jig_note TEXT;
