-- rgts-inventory 0008：發票防錯（Chris 2026-10-17「做一跟二」）
-- ① 只打一次：採購總表（阿國）已填發票 → 進貨單自動帶入，不一致擋下
-- ② 格式檢查：台灣統一發票＝2 英文＋8 數字；國外廠商／淘寶／收據勾「無統一發票」才放行
-- no_gui＝這張進貨單沒有統一發票（發票號碼欄可自由填或留空，不做格式檢查）
-- APPLIED: 2026-10-17 rgts-pi-db
ALTER TABLE inv_docs ADD COLUMN no_gui INTEGER DEFAULT 0;
