-- rgts-inventory 0001：庫存系統（共用 rgts-pi-db，全部 inv_ 前綴；絕不動別人的表）
-- APPLIED: （尚未套用，等 Chris 同意後套）

-- 現有庫存：料號 × 倉庫（期初由 Excel「庫存表」覆蓋匯入，之後由進料/領料異動）
CREATE TABLE IF NOT EXISTS inv_stock (
  part_no TEXT NOT NULL,
  wh_code TEXT NOT NULL,
  wh_name TEXT,
  name TEXT,
  unit TEXT,
  qty REAL NOT NULL DEFAULT 0,
  borrow_in REAL NOT NULL DEFAULT 0,
  borrow_out REAL NOT NULL DEFAULT 0,
  import_batch TEXT,
  updated_at TEXT,
  PRIMARY KEY (part_no, wh_code)
);

-- 異動流水帳：只增不改（更正＝再寫一筆反向），qty_delta 正=入、負=出
CREATE TABLE IF NOT EXISTS inv_moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  type TEXT NOT NULL,            -- receipt | issue | import_adjust
  part_no TEXT NOT NULL,
  wh_code TEXT NOT NULL,
  qty_delta REAL NOT NULL,
  qty_after REAL,
  project_no TEXT,               -- 領料：專案號
  po_id INTEGER,                 -- 進料：對應採購單
  po_line_id INTEGER,            -- 進料：對應 purchase_lines.id
  invoice_no TEXT,
  amount REAL,
  batch TEXT,                    -- 匯入批次
  note TEXT,
  created_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_inv_moves_part ON inv_moves(part_no);
CREATE INDEX IF NOT EXISTS idx_inv_moves_proj ON inv_moves(project_no);
CREATE INDEX IF NOT EXISTS idx_inv_moves_line ON inv_moves(po_line_id);

-- 進料門檻：阿國對完「廠商發票 vs 採購單金額」確認一致，該列才能入庫
CREATE TABLE IF NOT EXISTS inv_receipt_gate (
  po_line_id INTEGER PRIMARY KEY,
  invoice_no TEXT NOT NULL,
  invoice_amount REAL NOT NULL,
  po_amount REAL,                -- 確認當下採購單金額快照
  status TEXT NOT NULL,          -- ok | mismatch
  checked_by TEXT,
  checked_at TEXT
);

-- 匯入批次紀錄
CREATE TABLE IF NOT EXISTS inv_imports (
  batch TEXT PRIMARY KEY,
  ts TEXT,
  source TEXT,
  row_count INTEGER,
  created_by TEXT
);
