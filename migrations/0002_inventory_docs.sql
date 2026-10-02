-- rgts-inventory 0002：單據化（照 Willy 2026-10-02 正航日常作業畫面：進貨單／領料單(銷貨單代用)／調撥單）
-- APPLIED: （尚未套用）

-- 單據表頭
CREATE TABLE IF NOT EXISTS inv_docs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_no TEXT NOT NULL UNIQUE,     -- RC/IS/TR + YYYYMMDD + 3 碼流水
  doc_type TEXT NOT NULL,          -- receipt 進貨 | issue 領料 | transfer 調撥
  doc_date TEXT NOT NULL,          -- 單據日期 YYYY-MM-DD
  status TEXT NOT NULL,            -- pending 待核對（進貨）| posted 已過帳 | rejected 退回 | void 作廢
  vendor TEXT,                     -- 進貨：廠商
  invoice_no TEXT,                 -- 進貨：發票號碼（表頭，同正航）
  invoice_amount REAL,             -- 進貨：發票未稅金額
  project_no TEXT,                 -- 領料／調撥：所屬專案（BOM 寫法 3509-5）
  note TEXT,
  created_by TEXT, created_at TEXT,
  checked_by TEXT, checked_at TEXT, check_note TEXT,   -- 進貨門檻：阿國核對
  posted_by TEXT, posted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_inv_docs_type ON inv_docs(doc_type, status);
CREATE INDEX IF NOT EXISTS idx_inv_docs_proj ON inv_docs(project_no);

-- 單據明細
CREATE TABLE IF NOT EXISTS inv_doc_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id INTEGER NOT NULL,
  seq INTEGER,
  part_no TEXT,                    -- 備註列（*控卡*1 這種）part_no 以 * 開頭、不動庫存
  name TEXT,
  qty REAL NOT NULL,
  wh_code TEXT,                    -- 進貨=入庫倉；領料=出庫倉；調撥=撥出倉
  to_wh TEXT,                      -- 調撥=撥入倉
  po_line_id INTEGER, po_no TEXT,  -- 進貨：來源採購明細
  unit_price REAL, amount REAL,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_inv_doc_lines_doc ON inv_doc_lines(doc_id);
CREATE INDEX IF NOT EXISTS idx_inv_doc_lines_part ON inv_doc_lines(part_no);
CREATE INDEX IF NOT EXISTS idx_inv_doc_lines_po ON inv_doc_lines(po_line_id);

-- 流水帳掛單據
ALTER TABLE inv_moves ADD COLUMN doc_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_inv_moves_doc ON inv_moves(doc_id);

-- 匯入的「資料日期」：防止舊資料（例 Sheet 分頁 260629）蓋掉新資料（例 10/02 存量明細表）
ALTER TABLE inv_imports ADD COLUMN data_date TEXT;

-- 原子性守門：扣帳後若有任何一列變負數，往這張表插 NULL → NOT NULL 失敗 → 整個 D1 batch 回滾
CREATE TABLE IF NOT EXISTS inv_guard (ok INTEGER NOT NULL);
