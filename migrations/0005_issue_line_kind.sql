-- rgts-inventory 0005：領料明細加「類型」—— 產線損耗改由庫存系統記（Chris 2026-10-11）
-- kind='loss' ＝ 產線損耗補料：bom-tool 的「當時成本」會把它攤進每台成本，「報價成本」不算。
-- NULL ＝ 一般領料（依 BOM）。漏開／開錯不在這裡記 → PM 去 /pm 改 BOM。
-- 反向單沖銷會連 kind 一起複製（數量為負）→ 損耗淨額＝同專案 kind='loss' 已過帳列的數量加總。
-- APPLIED: 2026-10-11 rgts-pi-db
ALTER TABLE inv_doc_lines ADD COLUMN kind TEXT;
