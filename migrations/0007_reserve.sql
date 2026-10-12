-- rgts-inventory 0007：母單保留（Chris 2026-10-12，WERO「一次下 N 台、分批提貨」）
-- 母單（projects 那列，提貨單用 projects.parent_id 掛上來，rgts-pi schema/46）先把料保留下來；
-- 提貨單照自己的 BOM 領料時，算「母單保留還剩多少」。
--
-- 保留剩餘＝qty − 所有提貨單（parent_id 指到母單）已領的同料號數量。
--   不在領料時去扣這張表 → 反向單（沖銷）也會自動算回來，不會兩邊對不上。
-- 換規格被換下來的料：母單結束時按「釋放」，保留就關掉、回到一般庫存。
-- APPLIED: 2026-10-12 rgts-pi-db

CREATE TABLE IF NOT EXISTS inv_reserve (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_key TEXT NOT NULL,          -- 母單專案號（projKey 正規化，例 2165-2）
  part_no TEXT NOT NULL,
  qty REAL NOT NULL,                 -- 保留量（不扣，見上）
  note TEXT,
  created_by TEXT, created_at TEXT,
  updated_by TEXT, updated_at TEXT,
  released_by TEXT, released_at TEXT -- 有值＝已釋放，不再算保留
);
CREATE INDEX IF NOT EXISTS idx_inv_reserve_parent ON inv_reserve(parent_key);
CREATE INDEX IF NOT EXISTS idx_inv_reserve_part ON inv_reserve(part_no);
