-- rgts-inventory 0003：儲位＋反向單（Chris 2026-10-02：儲位要加；已過帳的單用反向單沖銷，不作廢）
-- APPLIED: 2026-10-02 rgts-pi-db

-- 儲位：料號×倉庫一個儲位（正航單據的「細項描述」，例 B4-03、C4-03）。Excel 匯入不會蓋掉（除非檔案有「儲位」欄）。
ALTER TABLE inv_stock ADD COLUMN location TEXT;
ALTER TABLE inv_stock ADD COLUMN location_by TEXT;
ALTER TABLE inv_stock ADD COLUMN location_at TEXT;

-- 反向單：新單 reverses＝被沖銷的原單號；原單 reversed_by＝反向單號（一張只能沖一次）
ALTER TABLE inv_docs ADD COLUMN reverses TEXT;
ALTER TABLE inv_docs ADD COLUMN reversed_by TEXT;
