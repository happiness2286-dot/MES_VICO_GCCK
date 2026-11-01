import type { DatabaseSync } from 'node:sqlite';
import type {
  AppRole,
  CuttingTool,
  DeliveryLogDto,
  FaiStatus,
  HandoverSlipRow,
  MachineInfo,
  MachineStatus,
  MealConfig,
  OperationMeta,
  ProductionLogDto,
  ProductMeta,
  PurchaseOrderInfo,
  QcInspectionDto,
  ScheduleBlock,
  SystemPayrollConfig,
  WorkerDto,
} from '../../shared/types';
import { mapLegacyRoleToAppRole } from '../auth/security';
import { DEFAULT_PAYROLL_CONFIG } from '../../shared/payrollEngine';

export function getConfigMap(db: DatabaseSync): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM system_config').all() as Array<{
    key: string;
    value: string;
  }>;
  return Object.fromEntries(rows.map((r) => [String(r.key), String(r.value)]));
}

export function getPayrollConfigFromDb(db: DatabaseSync): SystemPayrollConfig {
  const cfg = getConfigMap(db);
  return {
    secondsPerShift: Number(cfg.SECONDS_PER_SHIFT) || DEFAULT_PAYROLL_CONFIG.secondsPerShift,
    secondMachineRate: Number(cfg.SECOND_MACHINE_RATE) || DEFAULT_PAYROLL_CONFIG.secondMachineRate,
    mealShift23: Number(cfg.MEAL_SHIFT_2_3) || DEFAULT_PAYROLL_CONFIG.mealShift23,
    mealOt2h: Number(cfg.MEAL_OT_2H) || DEFAULT_PAYROLL_CONFIG.mealOt2h,
    mealSunday: Number(cfg.MEAL_SUNDAY) || DEFAULT_PAYROLL_CONFIG.mealSunday,
    kpiWarningThreshold:
      Number(cfg.KPI_WARNING_THRESHOLD) || DEFAULT_PAYROLL_CONFIG.kpiWarningThreshold,
  };
}

export function getMealConfigFromDb(db: DatabaseSync): MealConfig {
  const p = getPayrollConfigFromDb(db);
  return {
    mealShift23: p.mealShift23,
    mealOt2h: p.mealOt2h,
    mealSunday: p.mealSunday,
  };
}

export function queryWorkersForViewer(
  db: DatabaseSync,
  viewerId: string | null,
  viewerRole: AppRole | null,
  includeInactive: boolean = false
): WorkerDto[] {
  const whereSql = includeInactive ? '' : 'WHERE is_active = 1';
  const rows = db
    .prepare(
      `SELECT id, name, username, role, title, salary_mode, base_salary, cost_per_sec, chat_id, is_linked, is_active
       FROM workers ${whereSql} ORDER BY rowid ASC`
    )
    .all() as Array<Record<string, any>>;

  const canSeeAllSalaries = viewerRole === 'ADMIN' || viewerRole === 'DIRECTOR';

  return rows.map((r) => {
    const id = String(r.id);
    const isSelf = viewerId !== null && id === viewerId;
    const includePrivate = canSeeAllSalaries || isSelf;
    const chatId = r.chat_id ? String(r.chat_id) : null;

    const dto: WorkerDto = {
      id,
      name: String(r.name),
      username: String(r.username),
      role: String(r.role),
      appRole: mapLegacyRoleToAppRole(String(r.role), String(r.title)),
      title: String(r.title),
      salaryMode: String(r.salary_mode),
      isLinked: Number(r.is_linked) === 1 && Boolean(chatId),
      isActive: Number(r.is_active ?? 1),
    };

    if (includePrivate) {
      dto.baseSalary = Number(r.base_salary);
      dto.costPerSec = Number(r.cost_per_sec);
      dto.chatId = chatId;
    }

    return dto;
  });
}

export function queryMachines(db: DatabaseSync): MachineInfo[] {
  const rows = db
    .prepare(
      `SELECT id, name, group_name, cost_per_hour, status, current_worker_name, current_po_id, current_nc_id, stop_reason, updated_at
       FROM machines ORDER BY id ASC`
    )
    .all() as Array<Record<string, any>>;

  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    group: String(r.group_name),
    costPerHour: Number(r.cost_per_hour),
    status: (r.status || 'IDLE') as MachineStatus,
    currentWorkerName: r.current_worker_name ? String(r.current_worker_name) : null,
    currentPoId: r.current_po_id ? String(r.current_po_id) : null,
    currentNcId: r.current_nc_id ? String(r.current_nc_id) : null,
    stopReason: r.stop_reason ? String(r.stop_reason) : null,
    updatedAt: r.updated_at ? String(r.updated_at) : null,
  }));
}

export function queryTools(db: DatabaseSync): CuttingTool[] {
  const rows = db
    .prepare(
      `SELECT code, group_name, name, buy_price, edges, cost_per_edge, stock_qty, used_edges_total
       FROM cutting_tools ORDER BY code ASC`
    )
    .all() as Array<Record<string, any>>;

  return rows.map((r) => ({
    code: String(r.code),
    group: String(r.group_name),
    name: String(r.name),
    buyPrice: Number(r.buy_price),
    edges: Number(r.edges),
    costPerEdge: Number(r.cost_per_edge),
    stockQty: Number(r.stock_qty),
    usedEdgesTotal: Number(r.used_edges_total),
  }));
}

export function queryProducts(db: DatabaseSync, includeFinancials: boolean): ProductMeta[] {
  const rows = db
    .prepare(
      `SELECT p.sp_id, p.customer, p.product_name, p.mat_name, p.quoted_price, p.raw_material_cost, p.outsource_cost, p.setup_minutes_std,
              COALESCE(p.drawing_url, '') AS drawing_url, COALESCE(p.tech_doc_url, '') AS tech_doc_url,
              COUNT(o.nc_id) AS op_count, COALESCE(SUM(o.std_seconds), 0) AS total_sec
       FROM products p
       LEFT JOIN operations o ON o.sp_id = p.sp_id
       GROUP BY p.sp_id
       ORDER BY p.sp_id ASC`
    )
    .all() as Array<Record<string, any>>;

  return rows.map((r) => {
    const dto: ProductMeta = {
      spId: String(r.sp_id),
      customer: String(r.customer),
      productName: String(r.product_name),
      matName: String(r.mat_name || ''),
      setupMinutesStd: Number(r.setup_minutes_std || 0),
      opCount: Number(r.op_count || 0),
      totalStdSeconds: Number(r.total_sec || 0),
      drawingUrl: String(r.drawing_url || ''),
      techDocUrl: String(r.tech_doc_url || ''),
    };
    if (includeFinancials) {
      dto.quotedPrice = Number(r.quoted_price || 0);
      dto.rawMaterialCost = Number(r.raw_material_cost || 0);
      dto.outsourceCost = Number(r.outsource_cost || 0);
    }
    return dto;
  });
}

export function queryOperations(db: DatabaseSync): OperationMeta[] {
  const rows = db
    .prepare(
      `SELECT o.nc_id, o.sp_id, o.customer, o.product_name, o.op_name, o.std_seconds, o.stage, o.step_order, o.is_final_op,
              o.default_machine, o.mat_name, o.cutting_rec, o.tool_code, o.tool_name, o.cost_per_edge,
              o.std_edges_per_pcs, o.std_labor_cost, o.std_mach_cost, o.std_tool_cost, o.is_critical_check,
              COALESCE(o.drawing_url, p.drawing_url, '') AS drawing_url,
              COALESCE(o.setup_doc_url, p.tech_doc_url, '') AS setup_doc_url
       FROM operations o
       LEFT JOIN products p ON p.sp_id = o.sp_id
       ORDER BY o.sp_id ASC, o.step_order ASC`
    )
    .all() as Array<Record<string, any>>;

  return rows.map((r) => ({
    ncId: String(r.nc_id),
    spId: String(r.sp_id),
    customer: String(r.customer),
    productName: String(r.product_name),
    opName: String(r.op_name),
    stdSeconds: Number(r.std_seconds),
    stage: String(r.stage),
    stepOrder: Number(r.step_order),
    isFinalOp: Number(r.is_final_op),
    defaultMachine: String(r.default_machine),
    matName: String(r.mat_name || ''),
    cuttingRec: String(r.cutting_rec || ''),
    toolCode: String(r.tool_code || ''),
    toolName: String(r.tool_name || ''),
    costPerEdge: Number(r.cost_per_edge),
    stdEdgesPerPcs: Number(r.std_edges_per_pcs),
    stdLaborCost: Number(r.std_labor_cost),
    stdMachCost: Number(r.std_mach_cost),
    stdToolCost: Number(r.std_tool_cost),
    isCriticalCheck: Number(r.is_critical_check || 0),
    drawingUrl: String(r.drawing_url || ''),
    setupDocUrl: String(r.setup_doc_url || ''),
  }));
}

export function queryPurchaseOrders(db: DatabaseSync): PurchaseOrderInfo[] {
  const faiRows = db
    .prepare(
      `SELECT po_id, result FROM qc_inspections WHERE inspection_type = 'FAI' ORDER BY id DESC`
    )
    .all() as Array<{ po_id: string; result: string }>;

  const faiMap = new Map<string, string>();
  for (const f of faiRows) {
    if (!faiMap.has(String(f.po_id))) {
      faiMap.set(String(f.po_id), String(f.result));
    }
  }

  const rows = db
    .prepare(
      `SELECT po.po_id, po.customer, po.sp_id, po.product_name, po.qty_po, po.due_date, po.wip_qty, po.finished_qty,
              po.delivered_qty, po.stock_qty, po.remain_qty, po.status, po.material_lot, po.supplier_name, po.cast_date, po.priority, po.note,
              COALESCE(p.drawing_url, '') AS drawing_url,
              COALESCE(p.tech_doc_url, '') AS tech_doc_url
       FROM purchase_orders po
       LEFT JOIN products p ON (p.sp_id = po.sp_id OR (po.sp_id IS NULL AND p.customer = po.customer AND p.product_name = po.product_name))
       ORDER BY po.rowid ASC`
    )
    .all() as Array<Record<string, any>>;

  return rows.map((r) => {
    const poId = String(r.po_id);
    const qtyPo = Number(r.qty_po);
    const faiRes = faiMap.get(poId);
    let faiStatus: FaiStatus = 'NOT_REQUIRED';
    if (qtyPo >= 5) {
      if (faiRes === 'PASS' || faiRes === 'CONCESSION') faiStatus = 'FAI_PASSED';
      else if (faiRes === 'SCRAP' || faiRes === 'REWORK') faiStatus = 'FAI_FAILED';
      else faiStatus = 'PENDING_FAI';
    }

    return {
      poId,
      customer: String(r.customer),
      spId: r.sp_id ? String(r.sp_id) : null,
      productName: String(r.product_name),
      qtyPo,
      dueDate: String(r.due_date || ''),
      wipQty: Number(r.wip_qty),
      finishedQty: Number(r.finished_qty),
      deliveredQty: Number(r.delivered_qty),
      stockQty: Number(r.stock_qty),
      remainQty: Number(r.remain_qty),
      status: String(r.status),
      materialLot: String(r.material_lot || ''),
      supplierName: String(r.supplier_name || ''),
      castDate: String(r.cast_date || ''),
      priority: Number(r.priority || 2),
      note: String(r.note || ''),
      faiStatus,
      drawingUrl: String(r.drawing_url || ''),
      techDocUrl: String(r.tech_doc_url || ''),
    };
  });
}

export function querySchedules(db: DatabaseSync, workDate?: string): ScheduleBlock[] {
  const rows = (
    workDate
      ? db
          .prepare(
            `SELECT * FROM machine_schedules WHERE work_date = ? ORDER BY machine_id ASC, sequence_order ASC`
          )
          .all(workDate)
      : db
          .prepare(
            `SELECT * FROM machine_schedules ORDER BY work_date DESC, machine_id ASC, sequence_order ASC`
          )
          .all()
  ) as Array<Record<string, any>>;

  return rows.map((r) => ({
    id: Number(r.id),
    machineId: String(r.machine_id),
    machineName: String(r.machine_name),
    poId: String(r.po_id),
    ncId: String(r.nc_id),
    productName: String(r.product_name || ''),
    opName: String(r.op_name || ''),
    matName: String(r.mat_name || ''),
    toolCode: String(r.tool_code || ''),
    workDate: String(r.work_date),
    shiftType: String(r.shift_type),
    plannedQty: Number(r.planned_qty),
    plannedHours: Number(r.planned_hours),
    isLightsOut: Number(r.is_lights_out || 0),
    sequenceOrder: Number(r.sequence_order || 1),
    status: String(r.status || 'PLANNED'),
    note: String(r.note || ''),
  }));
}

export function mapLogRowToDto(
  r: Record<string, any>,
  viewerId: string | null,
  viewerRole: AppRole | null
): ProductionLogDto {
  const canSeeAllFinancials = viewerRole === 'ADMIN' || viewerRole === 'DIRECTOR';
  const isOwn = viewerId !== null && String(r.worker_id) === viewerId;
  const showWage = canSeeAllFinancials || isOwn;

  return {
    id: Number(r.id),
    recordUid: String(r.record_uid),
    createdAt: String(r.created_at),
    timeStr: String(r.time_str || ''),
    workDate: String(r.work_date),
    shiftType: String(r.shift_type),
    startTime: String(r.start_time || '06:00'),
    endTime: String(r.end_time || '14:00'),
    overtimeMinutes: Number(r.overtime_minutes || 0),
    isSunday: Number(r.is_sunday || 0),
    isLightsOut: Number(r.is_lights_out || 0),
    workerId: String(r.worker_id),
    workerName: String(r.worker_name),
    machineId: String(r.machine_id),
    machineName: String(r.machine_name),
    machineMode: (r.machine_mode === 'SECOND' ? 'SECOND' : 'FIRST') as 'FIRST' | 'SECOND',
    poId: String(r.po_id || 'PO-THEO-KH'),
    spId: r.sp_id ? String(r.sp_id) : null,
    customer: String(r.customer || ''),
    productName: String(r.product_name || ''),
    ncId: String(r.nc_id),
    opName: String(r.op_name || ''),
    stage: String(r.stage || 'End'),
    stepOrder: Number(r.step_order || 1),
    isFinalOp: Number(r.is_final_op || 0),
    stdSeconds: Number(r.std_seconds || 0),
    okQty: Number(r.ok_qty || 0),
    reworkQty: Number(r.rework_qty || 0),
    scrapQty: Number(r.scrap_qty || 0),
    defectType: String(r.defect_type || ''),
    damageValue: canSeeAllFinancials || isOwn ? Number(r.damage_value || 0) : 0,
    stopMinutes: Number(r.stop_minutes || 0),
    stopReason: String(r.stop_reason || ''),
    toolCode: String(r.tool_code || ''),
    edgesUsed: Number(r.edges_used || 0),
    selfCheckOk: Number(r.self_check_ok ?? 1),
    qcStatus: (r.qc_status || 'PASSED') as ProductionLogDto['qcStatus'],
    pieceWage: showWage ? Number(r.piece_wage || 0) : 0,
    otBonusWage: showWage ? Number(r.ot_bonus_wage || 0) : 0,
    waitWage: showWage ? Number(r.wait_wage || 0) : 0,
    mealAllowance: showWage ? Number(r.meal_allowance || 0) : 0,
    scrapPenalty: showWage ? Number(r.scrap_penalty || 0) : 0,
    directPieceIncome: showWage ? Number(r.direct_piece_income || 0) : 0,
    income: showWage ? Number(r.income || 0) : 0,
    batchCost: canSeeAllFinancials ? Number(r.batch_cost || 0) : 0,
    kpiPct: Number(r.kpi_pct || 100),
    kpiStatus: String(r.kpi_status || ''),
    photoUrl: String(r.photo_url || ''),
    handoverNote: String(r.handover_note || ''),
    materialLot: String(r.material_lot || ''),
    isVoided: Number(r.is_voided || 0),
    note: String(r.note || ''),
  };
}

export function queryLogs(
  db: DatabaseSync,
  viewerId: string | null,
  viewerRole: AppRole | null,
  limit: number = 200,
  includeVoided: boolean = false
): ProductionLogDto[] {
  const sql = includeVoided
    ? `SELECT * FROM production_logs ORDER BY id DESC LIMIT ?`
    : `SELECT * FROM production_logs WHERE is_voided = 0 ORDER BY id DESC LIMIT ?`;

  const rows = db.prepare(sql).all(limit) as Array<Record<string, any>>;
  return rows.map((r) => mapLogRowToDto(r, viewerId, viewerRole));
}

export function queryQcInspections(db: DatabaseSync, poId?: string): QcInspectionDto[] {
  const rows = (
    poId
      ? db.prepare(`SELECT * FROM qc_inspections WHERE po_id = ? ORDER BY id DESC`).all(poId)
      : db.prepare(`SELECT * FROM qc_inspections ORDER BY id DESC LIMIT 200`).all()
  ) as Array<Record<string, any>>;

  return rows.map((r) => ({
    id: Number(r.id),
    inspectionType: (r.inspection_type || 'FAI') as QcInspectionDto['inspectionType'],
    poId: String(r.po_id),
    spId: r.sp_id ? String(r.sp_id) : null,
    ncId: r.nc_id ? String(r.nc_id) : null,
    productName: String(r.product_name || ''),
    opName: String(r.op_name || ''),
    machineName: String(r.machine_name || ''),
    operatorId: String(r.operator_id || ''),
    inspectorId: String(r.inspector_id || ''),
    inspectorName: String(r.inspector_name || ''),
    result: (r.result || 'PASS') as QcInspectionDto['result'],
    sampleSize: Number(r.sample_size || 1),
    defectQty: Number(r.defect_qty || 0),
    measuredDimsJson: String(r.measured_dims_json || '[]'),
    rootCause: String(r.root_cause || ''),
    correctiveAction: String(r.corrective_action || ''),
    createdAt: String(r.created_at),
  }));
}

export function queryDeliveries(db: DatabaseSync, poId?: string): DeliveryLogDto[] {
  const rows = (
    poId
      ? db.prepare(`SELECT * FROM delivery_logs WHERE po_id = ? ORDER BY id DESC`).all(poId)
      : db.prepare(`SELECT * FROM delivery_logs ORDER BY id DESC LIMIT 100`).all()
  ) as Array<Record<string, any>>;

  return rows.map((r) => ({
    id: Number(r.id),
    poId: String(r.po_id),
    customer: String(r.customer),
    productName: String(r.product_name),
    qtyDeliver: Number(r.qty_deliver),
    deliveredBy: String(r.delivered_by),
    deliveredAt: String(r.delivered_at),
    note: String(r.note || ''),
  }));
}

export function queryHandoverSlips(db: DatabaseSync, dateStr?: string): HandoverSlipRow[] {
  const rows = (
    dateStr
      ? db.prepare('SELECT * FROM handover_slips WHERE handover_date = ? ORDER BY created_at DESC, id ASC').all(dateStr)
      : db.prepare('SELECT * FROM handover_slips ORDER BY handover_date DESC, created_at DESC LIMIT 200').all()
  ) as Array<Record<string, any>>;

  return rows.map((r) => ({
    id: String(r.id),
    handoverDate: String(r.handover_date),
    fromDept: r.from_dept as any,
    toDept: r.to_dept as any,
    poId: r.po_id ? String(r.po_id) : undefined,
    spId: r.sp_id ? String(r.sp_id) : undefined,
    productName: String(r.product_name),
    customer: String(r.customer),
    unit: String(r.unit || 'Cái'),
    prodQtyTransferred: Number(r.prod_qty_transferred || 0),
    prodQtyDefect: Number(r.prod_qty_defect || 0),
    prodQtyMissing: Number(r.prod_qty_missing || 0),
    rawQtyTransferred: Number(r.raw_qty_transferred || 0),
    rawQtyDefect: Number(r.raw_qty_defect || 0),
    rawQtyMissing: Number(r.raw_qty_missing || 0),
    note: String(r.note || ''),
    receiverName: String(r.receiver_name || ''),
    senderName: String(r.sender_name || ''),
    isConfirmed: Boolean(r.is_confirmed),
    confirmedAt: r.confirmed_at ? String(r.confirmed_at) : undefined,
    createdAt: String(r.created_at || ''),
  }));
}

export function insertHandoverSlip(db: DatabaseSync, row: HandoverSlipRow): void {
  db.prepare(`
    INSERT INTO handover_slips (
      id, handover_date, from_dept, to_dept, po_id, sp_id,
      product_name, customer, unit,
      prod_qty_transferred, prod_qty_defect, prod_qty_missing,
      raw_qty_transferred, raw_qty_defect, raw_qty_missing,
      note, receiver_name, sender_name, is_confirmed, confirmed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      handover_date = excluded.handover_date,
      from_dept = excluded.from_dept,
      to_dept = excluded.to_dept,
      po_id = excluded.po_id,
      sp_id = excluded.sp_id,
      product_name = excluded.product_name,
      customer = excluded.customer,
      unit = excluded.unit,
      prod_qty_transferred = excluded.prod_qty_transferred,
      prod_qty_defect = excluded.prod_qty_defect,
      prod_qty_missing = excluded.prod_qty_missing,
      raw_qty_transferred = excluded.raw_qty_transferred,
      raw_qty_defect = excluded.raw_qty_defect,
      raw_qty_missing = excluded.raw_qty_missing,
      note = excluded.note,
      receiver_name = excluded.receiver_name,
      sender_name = excluded.sender_name,
      is_confirmed = excluded.is_confirmed,
      confirmed_at = excluded.confirmed_at
  `).run(
    row.id, row.handoverDate, row.fromDept, row.toDept, row.poId || null, row.spId || null,
    row.productName, row.customer, row.unit || 'Cái',
    row.prodQtyTransferred || 0, row.prodQtyDefect || 0, row.prodQtyMissing || 0,
    row.rawQtyTransferred || 0, row.rawQtyDefect || 0, row.rawQtyMissing || 0,
    row.note || '', row.receiverName || '', row.senderName || '',
    row.isConfirmed ? 1 : 0, row.confirmedAt || null
  );
}

export function deleteHandoverSlip(db: DatabaseSync, id: string): void {
  db.prepare('DELETE FROM handover_slips WHERE id = ?').run(id);
}
