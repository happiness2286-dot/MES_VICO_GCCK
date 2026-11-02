CREATE TABLE IF NOT EXISTS system_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS workers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'CN',
  title TEXT NOT NULL DEFAULT 'Công nhân',
  salary_mode TEXT NOT NULL DEFAULT 'Khoán 1 + 0.33 máy',
  base_salary REAL NOT NULL DEFAULT 385000,
  cost_per_sec REAL NOT NULL DEFAULT 13.37,
  pin_hash TEXT NOT NULL,
  chat_id TEXT NULL,
  is_linked INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS machines (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  group_name TEXT NOT NULL,
  cost_per_hour REAL NOT NULL DEFAULT 250000,
  status TEXT NOT NULL DEFAULT 'IDLE',
  current_worker_name TEXT NULL,
  current_po_id TEXT NULL,
  current_nc_id TEXT NULL,
  stop_reason TEXT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cutting_tools (
  code TEXT PRIMARY KEY,
  group_name TEXT NOT NULL,
  name TEXT NOT NULL,
  buy_price REAL NOT NULL DEFAULT 0,
  edges INTEGER NOT NULL DEFAULT 1,
  cost_per_edge REAL NOT NULL DEFAULT 0,
  stock_qty REAL NOT NULL DEFAULT 20,
  used_edges_total REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  sp_id TEXT PRIMARY KEY,
  customer TEXT NOT NULL,
  product_name TEXT NOT NULL,
  mat_name TEXT NOT NULL DEFAULT '',
  quoted_price REAL NOT NULL DEFAULT 0,
  raw_material_cost REAL NOT NULL DEFAULT 0,
  outsource_cost REAL NOT NULL DEFAULT 0,
  setup_minutes_std REAL NOT NULL DEFAULT 0,
  drawing_url TEXT NOT NULL DEFAULT '',
  tech_doc_url TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(customer, product_name)
);

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
  cost_per_edge REAL NOT NULL DEFAULT 0,
  std_edges_per_pcs REAL NOT NULL DEFAULT 0,
  std_labor_cost REAL NOT NULL DEFAULT 0,
  std_mach_cost REAL NOT NULL DEFAULT 0,
  std_tool_cost REAL NOT NULL DEFAULT 0,
  is_critical_check INTEGER NOT NULL DEFAULT 0,
  drawing_url TEXT NOT NULL DEFAULT '',
  setup_doc_url TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_operations_sp_id ON operations(sp_id, step_order);
CREATE INDEX IF NOT EXISTS idx_operations_machine ON operations(default_machine);

CREATE TABLE IF NOT EXISTS purchase_orders (
  po_id TEXT PRIMARY KEY,
  customer TEXT NOT NULL,
  sp_id TEXT NULL REFERENCES products(sp_id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  qty_po INTEGER NOT NULL DEFAULT 1,
  due_date TEXT NOT NULL DEFAULT '',
  wip_qty INTEGER NOT NULL DEFAULT 0,
  finished_qty INTEGER NOT NULL DEFAULT 0,
  delivered_qty INTEGER NOT NULL DEFAULT 0,
  stock_qty INTEGER NOT NULL DEFAULT 0,
  remain_qty INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT '⏳ Đang chờ SX',
  material_lot TEXT NOT NULL DEFAULT '',
  supplier_name TEXT NOT NULL DEFAULT '',
  cast_date TEXT NOT NULL DEFAULT '',
  priority INTEGER NOT NULL DEFAULT 2,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_po_sp_id ON purchase_orders(sp_id);

CREATE TABLE IF NOT EXISTS machine_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  machine_id TEXT NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  machine_name TEXT NOT NULL,
  po_id TEXT NOT NULL,
  nc_id TEXT NOT NULL,
  product_name TEXT NOT NULL DEFAULT '',
  op_name TEXT NOT NULL DEFAULT '',
  mat_name TEXT NOT NULL DEFAULT '',
  tool_code TEXT NOT NULL DEFAULT '',
  work_date TEXT NOT NULL,
  shift_type TEXT NOT NULL,
  planned_qty INTEGER NOT NULL DEFAULT 1,
  planned_hours REAL NOT NULL DEFAULT 4,
  is_lights_out INTEGER NOT NULL DEFAULT 0,
  sequence_order INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'PLANNED',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_schedules_machine_date ON machine_schedules(machine_id, work_date);

CREATE TABLE IF NOT EXISTS daily_schedule_rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_date TEXT NOT NULL,
  shift_type TEXT NOT NULL DEFAULT 'Ca 2',
  stt INTEGER NOT NULL DEFAULT 1,
  worker_name TEXT NOT NULL,
  customer TEXT NOT NULL DEFAULT '',
  sp_id TEXT DEFAULT '',
  product_name TEXT NOT NULL DEFAULT '',
  nc_id TEXT DEFAULT '',
  op_name TEXT NOT NULL DEFAULT '',
  planned_qty REAL NOT NULL DEFAULT 0,
  machine_name TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  actual_qty REAL NOT NULL DEFAULT 0,
  drawing_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'PLANNED',
  is_overtime INTEGER NOT NULL DEFAULT 0,
  overtime_hours REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_daily_sched_date_shift ON daily_schedule_rows(work_date, shift_type);

CREATE TABLE IF NOT EXISTS weekly_downtime_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  week_start TEXT NOT NULL,
  machine_name TEXT NOT NULL DEFAULT '',
  stop_minutes REAL NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_weekly_downtime_week ON weekly_downtime_notes(week_start);

CREATE TABLE IF NOT EXISTS weekly_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  week_start TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Vật tư / Dụng cụ',
  proposer TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'Bình thường',
  status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_weekly_proposals_week ON weekly_proposals(week_start);

CREATE TABLE IF NOT EXISTS production_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_uid TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  time_str TEXT NOT NULL DEFAULT '',
  work_date TEXT NOT NULL,
  shift_type TEXT NOT NULL,
  start_time TEXT NOT NULL DEFAULT '06:00',
  end_time TEXT NOT NULL DEFAULT '14:00',
  overtime_minutes INTEGER NOT NULL DEFAULT 0,
  is_sunday INTEGER NOT NULL DEFAULT 0,
  is_lights_out INTEGER NOT NULL DEFAULT 0,
  worker_id TEXT NOT NULL REFERENCES workers(id),
  worker_name TEXT NOT NULL,
  machine_id TEXT NOT NULL,
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
  damage_value REAL NOT NULL DEFAULT 0,
  stop_minutes INTEGER NOT NULL DEFAULT 0,
  stop_reason TEXT NOT NULL DEFAULT 'Không có dừng máy',
  tool_code TEXT NOT NULL DEFAULT '',
  edges_used REAL NOT NULL DEFAULT 0,
  self_check_ok INTEGER NOT NULL DEFAULT 1,
  qc_status TEXT NOT NULL DEFAULT 'PASSED',
  piece_wage REAL NOT NULL DEFAULT 0,
  ot_bonus_wage REAL NOT NULL DEFAULT 0,
  wait_wage REAL NOT NULL DEFAULT 0,
  meal_allowance REAL NOT NULL DEFAULT 0,
  scrap_penalty REAL NOT NULL DEFAULT 0,
  direct_piece_income REAL NOT NULL DEFAULT 0,
  income REAL NOT NULL DEFAULT 0,
  batch_cost REAL NOT NULL DEFAULT 0,
  kpi_pct INTEGER NOT NULL DEFAULT 100,
  kpi_status TEXT NOT NULL DEFAULT 'Đạt 100% ĐM',
  photo_url TEXT NOT NULL DEFAULT '',
  handover_note TEXT NOT NULL DEFAULT '',
  material_lot TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  is_voided INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_logs_worker_date ON production_logs(worker_id, work_date);
CREATE INDEX IF NOT EXISTS idx_logs_po ON production_logs(po_id, nc_id);
CREATE INDEX IF NOT EXISTS idx_logs_nc ON production_logs(nc_id);

CREATE TABLE IF NOT EXISTS qc_inspections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inspection_type TEXT NOT NULL DEFAULT 'FAI',
  po_id TEXT NOT NULL,
  sp_id TEXT NULL,
  nc_id TEXT NULL,
  product_name TEXT NOT NULL DEFAULT '',
  op_name TEXT NOT NULL DEFAULT '',
  machine_name TEXT NOT NULL DEFAULT '',
  operator_id TEXT NOT NULL DEFAULT '',
  inspector_id TEXT NOT NULL,
  inspector_name TEXT NOT NULL,
  result TEXT NOT NULL DEFAULT 'PASS',
  sample_size INTEGER NOT NULL DEFAULT 1,
  defect_qty INTEGER NOT NULL DEFAULT 0,
  measured_dims_json TEXT NOT NULL DEFAULT '[]',
  root_cause TEXT NOT NULL DEFAULT '',
  corrective_action TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_qc_po ON qc_inspections(po_id, inspection_type);

CREATE TABLE IF NOT EXISTS delivery_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  po_id TEXT NOT NULL REFERENCES purchase_orders(po_id) ON DELETE CASCADE,
  customer TEXT NOT NULL,
  product_name TEXT NOT NULL,
  qty_deliver INTEGER NOT NULL,
  delivered_by TEXT NOT NULL,
  delivered_at TEXT NOT NULL DEFAULT (datetime('now')),
  note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS tool_swaps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tool_code TEXT NOT NULL REFERENCES cutting_tools(code),
  worker_id TEXT NOT NULL,
  worker_name TEXT NOT NULL,
  machine_name TEXT NOT NULL,
  old_insert_returned INTEGER NOT NULL DEFAULT 1,
  qty_issued INTEGER NOT NULL DEFAULT 1,
  reason TEXT NOT NULL DEFAULT 'Mòn hết cạnh cắt chuẩn',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS attendance_monthly (
  year_month TEXT NOT NULL,
  emp_id TEXT NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  emp_name TEXT NOT NULL,
  work_type TEXT NOT NULL DEFAULT 'Công',
  default_shift TEXT NOT NULL DEFAULT 'Ca 1',
  year_days_hist_json TEXT NOT NULL DEFAULT '[0,0,0,0,0,0,0,0,0]',
  days_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (year_month, emp_id)
);

CREATE TABLE IF NOT EXISTS sync_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT NULL
);


CREATE TABLE IF NOT EXISTS handover_slips (
  id TEXT PRIMARY KEY,
  handover_date TEXT NOT NULL,
  from_dept TEXT NOT NULL DEFAULT 'PX_GIA_CONG',
  to_dept TEXT NOT NULL DEFAULT 'PX_HOAN_THIEN',
  po_id TEXT,
  sp_id TEXT,
  product_name TEXT NOT NULL,
  customer TEXT NOT NULL,
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
  is_confirmed INTEGER NOT NULL DEFAULT 0,
  confirmed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_handover_date ON handover_slips(handover_date);
