-- rgts-inventory 0004：進貨先入庫、發票後補（Willy 2026-10-10 回饋；Chris 選「先入庫，發票之後補」）
-- 進貨單的「阿國核對」拆兩段：① 確認收貨 → 入庫（不再要求發票）；② 發票核對（金額相符才標記完成）。
-- 另加：發票日期（可與進貨日不同）、幣別（來自採購單）、匯率（依廠商發票輸入）。
-- APPLIED: 2026-10-10 rgts-pi-db
ALTER TABLE inv_docs ADD COLUMN invoice_date TEXT;      -- 發票日期 YYYY-MM-DD
ALTER TABLE inv_docs ADD COLUMN currency TEXT;          -- 幣別（NTD/USD/RMB…，取自採購明細，一張單一種）
ALTER TABLE inv_docs ADD COLUMN fx_rate REAL;           -- 匯率（依發票；NTD 為 1）
ALTER TABLE inv_docs ADD COLUMN inv_checked_by TEXT;    -- 發票核對（金額相符）完成者
ALTER TABLE inv_docs ADD COLUMN inv_checked_at TEXT;
ALTER TABLE inv_docs ADD COLUMN inv_check_note TEXT;
