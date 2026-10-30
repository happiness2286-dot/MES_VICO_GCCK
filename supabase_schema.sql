-- ====================================================================
-- HỆ THỐNG ĐIỀU HÀNH SẢN XUẤT CƠ KHÍ CHÍNH XÁC (MES VICO GCCK)
-- POSTGRESQL SCHEMA CHO SUPABASE CLOUD
-- ====================================================================

-- 1. BẢNG CẤU HÌNH HỆ THỐNG
CREATE TABLE IF NOT EXISTS system_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. BẢNG NHÂN SỰ & CÔNG NHÂN
CREATE TABLE IF NOT EXISTS workers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'CN',
  title TEXT NOT NULL DEFAULT 'Công nhân',
  salary_mode TEXT NOT NULL DEFAULT 'Khoán 1 + 0.33 máy',
  base_salary DOUBLE PRECISION NOT NULL DEFAULT 385000,
  cost_per_sec DOUBLE PRECISION NOT NULL DEFAULT 13.37,
  pin_hash TEXT NOT NULL,
  chat_id TEXT NULL,
  is_linked INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. BẢNG MÁY GIA CÔNG
CREATE TABLE IF NOT EXISTS machines (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  group_name TEXT NOT NULL,
  cost_per_hour DOUBLE PRECISION NOT NULL DEFAULT 100000,
  status TEXT NOT NULL DEFAULT 'IDLE',
  current_worker_name TEXT NULL,
  current_po_id TEXT NULL,
  current_nc_id TEXT NULL,
  stop_reason TEXT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. BẢNG DAO CỤ & MẢNH CHÍP
CREATE TABLE IF NOT EXISTS cutting_tools (
  code TEXT PRIMARY KEY,
  group_name TEXT NOT NULL,
  name TEXT NOT NULL,
  buy_price DOUBLE PRECISION NOT NULL DEFAULT 0,
  edges INTEGER NOT NULL DEFAULT 1,
  cost_per_edge DOUBLE PRECISION NOT NULL DEFAULT 0,
  stock_qty DOUBLE PRECISION NOT NULL DEFAULT 20,
  used_edges_total DOUBLE PRECISION NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. BẢNG SẢN PHẨM THÀNH PHẨM
CREATE TABLE IF NOT EXISTS products (
  sp_id TEXT PRIMARY KEY,
  customer TEXT NOT NULL,
  product_name TEXT NOT NULL,
  mat_name TEXT NOT NULL DEFAULT '',
  quoted_price DOUBLE PRECISION NOT NULL DEFAULT 0,
  raw_material_cost DOUBLE PRECISION NOT NULL DEFAULT 0,
  outsource_cost DOUBLE PRECISION NOT NULL DEFAULT 0,
  setup_minutes_std DOUBLE PRECISION NOT NULL DEFAULT 0,
  drawing_url TEXT NOT NULL DEFAULT '',
  tech_doc_url TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(customer, product_name)
);

-- 6. BẢNG NGUYÊN CÔNG (CÔNG ĐOẠN GIA CÔNG)
CREATE TABLE IF NOT EXISTS operations (
  nc_id TEXT PRIMARY KEY,
  sp_id TEXT NOT NULL REFERENCES products(sp_id) ON DELETE CASCADE,
  customer TEXT NOT NULL,
  product_name TEXT NOT NULL,
  op_name TEXT NOT NULL,
  std_seconds INTEGER NOT NULL DEFAULT 1800,
  stage TEXT NOT NULL DEFAULT 'End',
  step_order INTEGER NOT NULL DEFAULT 1,
  is_final_op INTEGER NOT NULL DEFAULT 1,
  default_machine TEXT NOT NULL,
  mat_name TEXT NOT NULL DEFAULT '',
  cutting_rec TEXT NOT NULL DEFAULT '',
  tool_code TEXT NOT NULL DEFAULT '',
  tool_name TEXT NOT NULL DEFAULT '',
  cost_per_edge DOUBLE PRECISION NOT NULL DEFAULT 0,
  std_edges_per_pcs DOUBLE PRECISION NOT NULL DEFAULT 0,
  std_labor_cost DOUBLE PRECISION NOT NULL DEFAULT 0,
  std_mach_cost DOUBLE PRECISION NOT NULL DEFAULT 0,
  std_tool_cost DOUBLE PRECISION NOT NULL DEFAULT 0,
  is_critical_check INTEGER NOT NULL DEFAULT 0,
  drawing_url TEXT NOT NULL DEFAULT '',
  setup_doc_url TEXT NOT NULL DEFAULT ''
);

-- 7. BẢNG NHẬT KÝ SẢN LƯỢNG (REALTIME LOGS)
CREATE TABLE IF NOT EXISTS production_logs (
  id BIGSERIAL PRIMARY KEY,
  record_uid TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  time_str TEXT NOT NULL DEFAULT '',
  work_date TEXT NOT NULL,
  shift_type TEXT NOT NULL DEFAULT 'Ca 1 (Sáng 06h-14h)',
  start_time TEXT NOT NULL DEFAULT '07:30',
  end_time TEXT NOT NULL DEFAULT '16:30',
  overtime_minutes INTEGER NOT NULL DEFAULT 0,
  is_sunday INTEGER NOT NULL DEFAULT 0,
  is_lights_out INTEGER NOT NULL DEFAULT 0,
  worker_id TEXT NOT NULL,
  worker_name TEXT NOT NULL,
  machine_id TEXT NOT NULL DEFAULT 'M01',
  machine_name TEXT NOT NULL,
  machine_mode TEXT NOT NULL DEFAULT 'FIRST',
  po_id TEXT NOT NULL DEFAULT 'PO-THEO-KH',
  sp_id TEXT NULL,
  customer TEXT NOT NULL DEFAULT '',
  product_name TEXT NOT NULL DEFAULT '',
  nc_id TEXT NOT NULL,
  op_name TEXT NOT NULL DEFAULT '',
  stage TEXT NOT NULL DEFAULT 'End',
  step_order INTEGER NOT NULL DEFAULT 1,
  is_final_op INTEGER NOT NULL DEFAULT 1,
  std_seconds INTEGER NOT NULL DEFAULT 0,
  ok_qty INTEGER NOT NULL DEFAULT 0,
  rework_qty INTEGER NOT NULL DEFAULT 0,
  scrap_qty INTEGER NOT NULL DEFAULT 0,
  defect_type TEXT NOT NULL DEFAULT '',
  damage_value DOUBLE PRECISION NOT NULL DEFAULT 0,
  stop_minutes INTEGER NOT NULL DEFAULT 0,
  stop_reason TEXT NOT NULL DEFAULT 'Không có dừng máy',
  tool_code TEXT NOT NULL DEFAULT '',
  edges_used DOUBLE PRECISION NOT NULL DEFAULT 0,
  self_check_ok INTEGER NOT NULL DEFAULT 1,
  qc_status TEXT NOT NULL DEFAULT 'PASSED',
  piece_wage DOUBLE PRECISION NOT NULL DEFAULT 0,
  ot_bonus_wage DOUBLE PRECISION NOT NULL DEFAULT 0,
  wait_wage DOUBLE PRECISION NOT NULL DEFAULT 0,
  meal_allowance DOUBLE PRECISION NOT NULL DEFAULT 0,
  scrap_penalty DOUBLE PRECISION NOT NULL DEFAULT 0,
  direct_piece_income DOUBLE PRECISION NOT NULL DEFAULT 0,
  income DOUBLE PRECISION NOT NULL DEFAULT 0,
  batch_cost DOUBLE PRECISION NOT NULL DEFAULT 0,
  kpi_pct INTEGER NOT NULL DEFAULT 100,
  kpi_status TEXT NOT NULL DEFAULT 'Đạt 100% ĐM',
  photo_url TEXT NOT NULL DEFAULT '',
  handover_note TEXT NOT NULL DEFAULT '',
  material_lot TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  is_voided INTEGER NOT NULL DEFAULT 0
);

-- 8. BẢNG SỔ BÀN GIAO CÔNG ĐOẠN (BM.GC.01.02)
CREATE TABLE IF NOT EXISTS handover_slips (
  id TEXT PRIMARY KEY,
  handover_date TEXT NOT NULL,
  from_dept TEXT NOT NULL DEFAULT 'PX_GIA_CONG',
  to_dept TEXT NOT NULL DEFAULT 'PX_HOAN_THIEN',
  po_id TEXT NOT NULL DEFAULT 'PO-THEO-KH',
  sp_id TEXT NULL,
  product_name TEXT NOT NULL,
  customer TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT 'Cái',
  prod_qty_transferred INTEGER NOT NULL DEFAULT 0,
  prod_qty_defect INTEGER NOT NULL DEFAULT 0,
  prod_qty_missing INTEGER NOT NULL DEFAULT 0,
  raw_qty_transferred INTEGER NOT NULL DEFAULT 0,
  raw_qty_defect INTEGER NOT NULL DEFAULT 0,
  raw_qty_missing INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  receiver_name TEXT NOT NULL DEFAULT '',
  sender_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. BẬT BẢO MẬT ROW LEVEL SECURITY (CHO PHÉP ANONYMOUS ĐỌC/GHI VỚI API KEY)
ALTER TABLE system_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE machines ENABLE ROW LEVEL SECURITY;
ALTER TABLE cutting_tools ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE handover_slips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon read all" ON system_config FOR SELECT TO anon USING (true);
CREATE POLICY "Allow anon read all" ON workers FOR SELECT TO anon USING (true);
CREATE POLICY "Allow anon read all" ON machines FOR SELECT TO anon USING (true);
CREATE POLICY "Allow anon read all" ON cutting_tools FOR SELECT TO anon USING (true);
CREATE POLICY "Allow anon read all" ON products FOR SELECT TO anon USING (true);
CREATE POLICY "Allow anon read all" ON operations FOR SELECT TO anon USING (true);

CREATE POLICY "Allow anon all on logs" ON production_logs FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon all on handovers" ON handover_slips FOR ALL TO anon USING (true) WITH CHECK (true);

-- 10. KÍCH HOẠT TÍNH NĂNG REALTIME (ĐỒNG BỘ TỨC THÌ QUA WEBSOCKET)
ALTER PUBLICATION supabase_realtime ADD TABLE production_logs;
ALTER PUBLICATION supabase_realtime ADD TABLE handover_slips;
ALTER PUBLICATION supabase_realtime ADD TABLE machines;

