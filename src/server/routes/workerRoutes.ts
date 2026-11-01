import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type {
  AuthMode,
  BootstrapPayload,
  JobTravelerDto,
  ReportSubmitPayload,
  ShiftHandoverAlert,
  ShiftPriorContext,
  TraceabilityDto,
} from '../../shared/types';
import { withTransaction } from '../db/connection';
import { derivePoStatus } from '../db/seed';
import {
  getConfigMap,
  getPayrollConfigFromDb,
  mapLogRowToDto,
  queryDeliveries,
  queryLogs,
  queryMachines,
  queryOperations,
  queryProducts,
  queryPurchaseOrders,
  queryQcInspections,
  querySchedules,
  queryTools,
  queryWorkersForViewer,
} from '../db/queries';
import { requireAuth } from '../auth/security';
import {
  calculateTurnPayroll,
  getVietnamDateString,
  isVietnamSunday,
} from '../../shared/payrollEngine';
import { computeMachineLoads } from '../../shared/loadBalancing';
import { getDefShiftCode } from '../../shared/attendanceParser';
import { normalizeVn, removeVietnameseTones } from '../../shared/vnSearch';
import { enqueueOutboxEvent, flushPendingOutbox } from '../adapters/syncAdapters';

export function createWorkerRoutes(db: DatabaseSync, uploadsDir: string): Router {
  const router = Router();

  function buildShiftPriorContext(
    workerId: string,
    workDate: string,
    shiftType: string
  ): ShiftPriorContext {
    const dayRows = db
      .prepare(
        `SELECT machine_name, shift_type, start_time, end_time, meal_allowance, overtime_minutes, stop_minutes
         FROM production_logs
         WHERE worker_id = ? AND work_date = ? AND is_voided = 0`
      )
      .all(workerId, workDate) as Array<Record<string, any>>;

    let mealPaidAmount = 0;
    let paidOtMinutes = 0;
    let paidStopMinutes = 0;

    const normShift = normalizeVn(shiftType).toLowerCase();
    for (const r of dayRows) {
      if (normalizeVn(r.shift_type).toLowerCase() === normShift) {
        mealPaidAmount += Number(r.meal_allowance || 0);
        paidOtMinutes = Math.max(paidOtMinutes, Number(r.overtime_minutes || 0));
        paidStopMinutes += Number(r.stop_minutes || 0);
      }
    }

    return {
      priorLogs: dayRows.map((r) => ({
        machineName: String(r.machine_name),
        startTime: String(r.start_time || '06:00'),
        endTime: String(r.end_time || '14:00'),
        mealAllowancePaid: Number(r.meal_allowance || 0),
        paidOtMinutes: Number(r.overtime_minutes || 0),
        paidStopMinutes: Number(r.stop_minutes || 0),
      })),
      mealAlreadyPaid: mealPaidAmount > 0,
      mealPaidAmount,
      paidOtMinutes,
      paidStopMinutes,
    };
  }

  function evaluateQualityWarnings(
    poId: string,
    spId: string | null,
    stepOrder: number,
    okQty: number,
    selfCheckOk: boolean,
    isCriticalCheck: number
  ): { warnings: string[]; qcStatus: 'PASSED' | 'PENDING_QC' } {
    const warnings: string[] = [];
    let qcStatus: 'PASSED' | 'PENDING_QC' = 'PASSED';

    if (poId && poId !== 'PO-THEO-KH') {
      const poRow = db
        .prepare('SELECT qty_po FROM purchase_orders WHERE po_id = ?')
        .get(poId) as { qty_po: number } | undefined;

      if (poRow && Number(poRow.qty_po) >= 5) {
        const fai = db
          .prepare(
            `SELECT result FROM qc_inspections
             WHERE po_id = ? AND inspection_type = 'FAI' AND result IN ('PASS', 'CONCESSION')
             LIMIT 1`
          )
          .get(poId);
        if (!fai) {
          warnings.push(
            `Lệnh ${poId} (SL ${poRow.qty_po} >= 5) chưa có biên bản duyệt mẫu đầu FAI — đánh dấu Chờ QC hậu kiểm.`
          );
          qcStatus = 'PENDING_QC';
        }
      }

      if (spId && stepOrder > 1 && okQty > 0) {
        const prevStepOp = db
          .prepare(`SELECT nc_id, op_name FROM operations WHERE sp_id = ? AND step_order = ?`)
          .get(spId, stepOrder - 1) as { nc_id: string; op_name: string } | undefined;

        if (prevStepOp) {
          const prevDone = db
            .prepare(
              `SELECT COALESCE(SUM(ok_qty), 0) AS total_ok FROM production_logs
               WHERE po_id = ? AND nc_id = ? AND is_voided = 0`
            )
            .get(poId, prevStepOp.nc_id) as { total_ok: number };
          const curDone = db
            .prepare(
              `SELECT COALESCE(SUM(ok_qty), 0) AS total_ok FROM production_logs
               WHERE po_id = ? AND step_order = ? AND is_voided = 0`
            )
            .get(poId, stepOrder) as { total_ok: number };

          if (Number((Number(curDone.total_ok) + okQty).toFixed(4)) > Number(Number(prevDone.total_ok).toFixed(4))) {
            warnings.push(
              `Cảnh báo luồng WIP: Tổng SL bước ${stepOrder} (${Number(curDone.total_ok) + okQty}) vượt SL đã ghi nhận ở bước ${stepOrder - 1} (${prevDone.total_ok}).`
            );
            qcStatus = 'PENDING_QC';
          }
        }
      }
    }

    if (isCriticalCheck === 1 && !selfCheckOk) {
      warnings.push('Nguyên công có dấu ★ tự kiểm kích thước quan trọng nhưng chưa tích xác nhận.');
      qcStatus = 'PENDING_QC';
    }

    return { warnings, qcStatus };
  }

  router.get('/bootstrap', (req, res) => {
    const viewer = req.authUser ?? null;
    const viewerId = viewer?.workerId ?? null;
    const viewerRole = viewer?.appRole ?? null;
    const canSeeFinancials = viewerRole === 'ADMIN' || viewerRole === 'DIRECTOR';

    const cfgRaw = getConfigMap(db);
    const authMode: AuthMode = cfgRaw.AUTH_MODE === 'STRICT_PIN' ? 'STRICT_PIN' : 'DEMO_QUICK';
    if (authMode === 'STRICT_PIN' && !viewer) {
      res.status(401).json({
        error: 'Chế độ Strict PIN đang bật. Vui lòng đăng nhập bằng mã PIN cá nhân.',
      });
      return;
    }

    const vietnamToday = getVietnamDateString();
    const isSundayToday = isVietnamSunday(vietnamToday);

    const safeConfig: Record<string, string | number> = {
      AUTH_MODE: authMode,
      TELEGRAM_BOT_USERNAME: cfgRaw.TELEGRAM_BOT_USERNAME || '',
      SECONDS_PER_SHIFT: Number(cfgRaw.SECONDS_PER_SHIFT || 28800),
      SECOND_MACHINE_RATE: Number(cfgRaw.SECOND_MACHINE_RATE || 0.33),
      MEAL_SHIFT_2_3: Number(cfgRaw.MEAL_SHIFT_2_3 || 20000),
      MEAL_OT_2H: Number(cfgRaw.MEAL_OT_2H || 15000),
      MEAL_SUNDAY: Number(cfgRaw.MEAL_SUNDAY || 30000),
      KPI_WARNING_THRESHOLD: Number(cfgRaw.KPI_WARNING_THRESHOLD || 0.85),
    };

    if (viewerRole === 'ADMIN') {
      safeConfig.WEB_APP_URL = cfgRaw.WEB_APP_URL || '';
      safeConfig.MANAGER_CHAT_ID = cfgRaw.MANAGER_CHAT_ID || '';
      safeConfig.TELEGRAM_BOT_TOKEN = cfgRaw.TELEGRAM_BOT_TOKEN || '';
      safeConfig.GAS_SYNC_ENABLED = cfgRaw.GAS_SYNC_ENABLED || '0';
    }

    const workers = queryWorkersForViewer(db, viewerId, viewerRole);
    const machines = queryMachines(db);
    const toolsList = queryTools(db);
    const products = queryProducts(db, canSeeFinancials);
    const operations = queryOperations(db);
    const ordersList = queryPurchaseOrders(db);
    const schedules = querySchedules(db);
    const machineLoads = computeMachineLoads(machines, ordersList, operations, schedules);
    const qcInspections = queryQcInspections(db);
    const recentLogs = queryLogs(db, viewerId, viewerRole, 120, false);

    // opDoneMap across all non-voided logs
    const opDoneRows = db
      .prepare(
        `SELECT nc_id, COALESCE(SUM(ok_qty), 0) AS done_qty
         FROM production_logs WHERE is_voided = 0 GROUP BY nc_id`
      )
      .all() as Array<{ nc_id: string; done_qty: number }>;
    const opDoneMap: Record<string, number> = {};
    for (const r of opDoneRows) {
      opDoneMap[String(r.nc_id)] = Number(r.done_qty);
    }

    // todayAccumulated (strictly scoped: Worker sees ONLY own today income; Admin sees all)
    const todayRows = db
      .prepare(
        `SELECT worker_id, COALESCE(SUM(income), 0) AS total_inc
         FROM production_logs WHERE work_date = ? AND is_voided = 0 GROUP BY worker_id`
      )
      .all(vietnamToday) as Array<{ worker_id: string; total_inc: number }>;
    const todayAccumulated: Record<string, number> = {};
    for (const r of todayRows) {
      const wid = String(r.worker_id);
      if (canSeeFinancials || (viewerId && wid === viewerId)) {
        todayAccumulated[wid] = Number(r.total_inc);
      }
    }

    // KPI summary
    const kpiRow = db
      .prepare(
        `SELECT COALESCE(SUM(ok_qty), 0) AS tot_ok,
                COALESCE(SUM(rework_qty), 0) AS tot_rw,
                COALESCE(SUM(scrap_qty), 0) AS tot_ng,
                COALESCE(SUM(stop_minutes), 0) AS tot_stop
         FROM production_logs WHERE is_voided = 0`
      )
      .get() as Record<string, any>;

    const handoverRows = db
      .prepare(
        `SELECT id, machine_name, worker_name, work_date, shift_type, po_id, product_name, op_name, handover_note, created_at
         FROM production_logs
         WHERE is_voided = 0 AND handover_note != ''
         ORDER BY id DESC LIMIT 15`
      )
      .all() as Array<Record<string, any>>;

    const shiftHandoverAlerts: ShiftHandoverAlert[] = handoverRows.map((h) => ({
      id: Number(h.id),
      machineName: String(h.machine_name),
      workerName: String(h.worker_name),
      workDate: String(h.work_date),
      shiftType: String(h.shift_type),
      poId: String(h.po_id),
      productName: String(h.product_name),
      opName: String(h.op_name),
      handoverNote: String(h.handover_note),
      createdAt: String(h.created_at),
    }));

    const payload: BootstrapPayload = {
      user: viewer,
      authMode,
      vietnamToday,
      isSundayToday,
      workers,
      machines,
      toolsList,
      products,
      operations,
      ordersList,
      schedules,
      machineLoads,
      qcInspections,
      recentLogs,
      todayAccumulated,
      opDoneMap,
      kpiSummary: {
        totalOk: Number(kpiRow.tot_ok || 0),
        totalRework: Number(kpiRow.tot_rw || 0),
        totalScrap: Number(kpiRow.tot_ng || 0),
        totalStopMinutes: Number(kpiRow.tot_stop || 0),
        runningMachines: machines.filter((m) => m.status === 'RUNNING').length,
        bottleneckMachines: machineLoads.filter((m) => m.isBottleneck).length,
        openOrders: ordersList.filter((o) => o.remainQty > 0).length,
        overdueOrders: ordersList.filter((o) => o.remainQty > 0 && o.dueDate < vietnamToday).length,
      },
      shiftHandoverAlerts,
      config: safeConfig,
    };

    res.json(payload);
  });

  router.post('/reports/preview', requireAuth, (req, res) => {
    const body = (req.body || {}) as Partial<ReportSubmitPayload>;
    const viewer = req.authUser!;
    const targetWorkerId =
      viewer.appRole === 'ADMIN' || viewer.appRole === 'SHIFT_LEADER'
        ? normalizeVn(body.workerId || viewer.workerId)
        : viewer.workerId;

    const wRow = db
      .prepare('SELECT id, salary_mode, cost_per_sec FROM workers WHERE id = ?')
      .get(targetWorkerId) as Record<string, any> | undefined;
    if (!wRow) {
      res.status(404).json({ error: 'Không tìm thấy nhân sự.' });
      return;
    }

    const ncId = normalizeVn(body.ncId || 'NC_STOP');
    const opRow = db
      .prepare('SELECT * FROM operations WHERE nc_id = ?')
      .get(ncId) as Record<string, any> | undefined;

    const machineName = normalizeVn(body.machineName || opRow?.default_machine || 'Máy Tiện CNC 1');
    const machRow = db
      .prepare('SELECT * FROM machines WHERE LOWER(name) = LOWER(?)')
      .get(machineName) as Record<string, any> | undefined;

    const toolCode = normalizeVn(body.toolCode || opRow?.tool_code || '');
    const toolRow = toolCode
      ? (db.prepare('SELECT * FROM cutting_tools WHERE code = ?').get(toolCode) as
          | Record<string, any>
          | undefined)
      : undefined;

    const workDate = normalizeVn(body.workDate || '') || getVietnamDateString();
    const isSunday = isVietnamSunday(workDate);
    const shiftType = normalizeVn(body.shiftType || 'Ca 1 (Sáng 06h-14h)');
    const priorCtx = buildShiftPriorContext(targetWorkerId, workDate, shiftType);
    const payrollCfg = getPayrollConfigFromDb(db);

    const payroll = calculateTurnPayroll(
      {
        workerId: targetWorkerId,
        salaryMode: String(wRow.salary_mode),
        costPerSec: Number(wRow.cost_per_sec),
        workDate,
        shiftType,
        startTime: normalizeVn(body.startTime || '06:00'),
        endTime: normalizeVn(body.endTime || '14:00'),
        overtimeMinutes: Number(body.overtimeMinutes || 0),
        isSunday,
        isLightsOut: Boolean(body.isLightsOut),
        machineName,
        machineMode: body.machineMode === 'SECOND' ? 'SECOND' : 'FIRST',
        machineCostPerHour: Number(machRow?.cost_per_hour || 250000),
        stdSeconds: Number(opRow?.std_seconds || 0),
        stdEdgesPerPcs: Number(opRow?.std_edges_per_pcs || 0),
        costPerEdge: Number(toolRow?.cost_per_edge ?? opRow?.cost_per_edge ?? 0),
        edgesUsed: body.isEdgesDirty ? Number(body.edgesUsed) : undefined,
        okQty: Number(body.okQty || 0),
        reworkQty: Number(body.reworkQty || 0),
        scrapQty: Number(body.scrapQty || 0),
        defectType: normalizeVn(body.defectType || ''),
        damageValue: Number(body.damageValue || 0),
        stopMinutes: Number(body.stopMinutes || 0),
        stopReason: normalizeVn(body.stopReason || 'Không có dừng máy'),
      },
      priorCtx,
      payrollCfg
    );

    const { warnings } = evaluateQualityWarnings(
      normalizeVn(body.poId || 'PO-THEO-KH'),
      opRow?.sp_id ? String(opRow.sp_id) : null,
      Number(opRow?.step_order || 1),
      Number(body.okQty || 0),
      body.selfCheckOk !== false,
      Number(opRow?.is_critical_check || 0)
    );

    res.json({ payroll, warnings });
  });

  router.post('/reports', requireAuth, (req, res) => {
    const body = (req.body || {}) as ReportSubmitPayload;
    const viewer = req.authUser!;

    const targetWorkerId =
      viewer.appRole === 'ADMIN' || viewer.appRole === 'SHIFT_LEADER'
        ? normalizeVn(body.workerId || viewer.workerId)
        : viewer.workerId;

    const workDate = normalizeVn(body.workDate || '') || getVietnamDateString();
    const recordUid =
      normalizeVn(body.recordUid || '') ||
      `GCCK-${workDate.replace(/-/g, '')}-${randomUUID().slice(0, 8).toUpperCase()}`;

    const okQty = Math.max(0, Math.round(Number(body.okQty) || 0));
    const reworkQty = Math.max(0, Math.round(Number(body.reworkQty) || 0));
    const scrapQty = Math.max(0, Math.round(Number(body.scrapQty) || 0));
    const stopMinutes = Math.max(0, Math.round(Number(body.stopMinutes) || 0));

    if (okQty === 0 && reworkQty === 0 && scrapQty === 0 && stopMinutes === 0) {
      res.status(400).json({ error: 'Vui lòng nhập số lượng sản phẩm hoặc số phút dừng máy.' });
      return;
    }

    // Save optional photo outside DB lock if present
    let savedPhotoUrl = '';
    if (body.photoBase64 && String(body.photoBase64).startsWith('data:image/')) {
      const m = /^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/.exec(String(body.photoBase64));
      if (m) {
        const ext = m[1].includes('png') ? 'png' : m[1].includes('webp') ? 'webp' : 'jpg';
        const safeFile = `${recordUid.replace(/[^a-zA-Z0-9_-]/g, '_')}.${ext}`;
        fs.mkdirSync(uploadsDir, { recursive: true });
        fs.writeFileSync(path.join(uploadsDir, safeFile), Buffer.from(m[2], 'base64'));
        savedPhotoUrl = `/uploads/${safeFile}`;
      }
    }

    try {
      const txResult = withTransaction(db, () => {
        // 1. Idempotency check on recordUid
        const existingLog = db
          .prepare('SELECT * FROM production_logs WHERE record_uid = ?')
          .get(recordUid) as Record<string, any> | undefined;

        if (existingLog) {
          const todaySum = db
            .prepare(
              `SELECT COALESCE(SUM(income), 0) AS tot FROM production_logs
               WHERE worker_id = ? AND work_date = ? AND is_voided = 0`
            )
            .get(String(existingLog.worker_id), String(existingLog.work_date)) as { tot: number };

          return {
            deduplicated: true,
            warnings: [] as string[],
            logDto: mapLogRowToDto(existingLog, viewer.workerId, viewer.appRole),
            payroll: {
              effectiveMachineMode: existingLog.machine_mode,
              machRate: existingLog.machine_mode === 'SECOND' ? 0.33 : 1,
              shiftMult: 1,
              isSunday: Boolean(existingLog.is_sunday),
              effectiveOtMinutes: Number(existingLog.overtime_minutes),
              unpaidOtMinutes: 0,
              effectivePaidStopMinutes: Number(existingLog.stop_minutes),
              isMonthlyStaff: false,
              unitPiecePrice: 0,
              earnedStdSeconds: Number(existingLog.ok_qty) * Number(existingLog.std_seconds),
              netWorkSeconds: 28800,
              basePieceWage: Number(existingLog.piece_wage),
              otBonusWage: Number(existingLog.ot_bonus_wage),
              waitWage: Number(existingLog.wait_wage),
              pieceWage: Number(existingLog.piece_wage) + Number(existingLog.ot_bonus_wage),
              directPieceIncome: Number(existingLog.direct_piece_income),
              mealAllowance: Number(existingLog.meal_allowance),
              scrapPenalty: Number(existingLog.scrap_penalty),
              turnTotalIncome: Number(existingLog.income),
              costingLaborCost: 0,
              costingMachCost: 0,
              costingToolCost: 0,
              costingScrapLoss: 0,
              batchCost: Number(existingLog.batch_cost),
              kpiPct: Number(existingLog.kpi_pct),
              kpiStatus: String(existingLog.kpi_status),
              edgesConsumed: Number(existingLog.edges_used),
            },
            todayTotalIncome: Number(todaySum.tot || 0),
          };
        }

        // 2. Load authoritative Worker, Operation, Machine, Tool from DB (anti-tamper!)
        const wRow = db
          .prepare('SELECT * FROM workers WHERE id = ? AND is_active = 1')
          .get(targetWorkerId) as Record<string, any> | undefined;
        if (!wRow) {
          throw new Error(`Không tìm thấy nhân sự ${targetWorkerId}`);
        }

        const ncId = normalizeVn(body.ncId || 'NC_STOP');
        const opRow = db
          .prepare('SELECT * FROM operations WHERE nc_id = ?')
          .get(ncId) as Record<string, any> | undefined;

        if (!opRow && ncId !== 'NC_STOP' && stopMinutes === 0) {
          throw new Error(`Không tìm thấy nguyên công ${ncId}`);
        }

        const machineName = normalizeVn(
          body.machineName || opRow?.default_machine || 'Máy Tiện CNC 1'
        );
        let machRow = db
          .prepare('SELECT * FROM machines WHERE LOWER(name) = LOWER(?)')
          .get(machineName) as Record<string, any> | undefined;
        if (!machRow) {
          machRow = db.prepare('SELECT * FROM machines ORDER BY id ASC LIMIT 1').get() as Record<
            string,
            any
          >;
        }

        const toolCode = normalizeVn(body.toolCode || opRow?.tool_code || '');
        const toolRow = toolCode
          ? (db.prepare('SELECT * FROM cutting_tools WHERE code = ?').get(toolCode) as
              | Record<string, any>
              | undefined)
          : undefined;

        const shiftType = normalizeVn(body.shiftType || 'Ca 1 (Sáng 06h-14h)');
        const startTime = normalizeVn(body.startTime || '06:00');
        const endTime = normalizeVn(body.endTime || '14:00');
        const poId = normalizeVn(body.poId || 'PO-THEO-KH') || 'PO-THEO-KH';

        // 3. Server-side payroll & job costing calculation (always compute isSunday server-side!)
        const isSunday = isVietnamSunday(workDate);
        const priorCtx = buildShiftPriorContext(targetWorkerId, workDate, shiftType);
        const payrollCfg = getPayrollConfigFromDb(db);

        const payroll = calculateTurnPayroll(
          {
            workerId: targetWorkerId,
            salaryMode: String(wRow.salary_mode),
            costPerSec: Number(wRow.cost_per_sec),
            workDate,
            shiftType,
            startTime,
            endTime,
            overtimeMinutes: Number(body.overtimeMinutes || 0),
            isSunday,
            isLightsOut: Boolean(body.isLightsOut),
            machineName: String(machRow.name),
            machineMode: body.machineMode === 'SECOND' ? 'SECOND' : 'FIRST',
            machineCostPerHour: Number(machRow.cost_per_hour || 250000),
            stdSeconds: Number(opRow?.std_seconds || 0),
            stdEdgesPerPcs: Number(opRow?.std_edges_per_pcs || 0),
            costPerEdge: Number(toolRow?.cost_per_edge ?? opRow?.cost_per_edge ?? 0),
            edgesUsed:
              body.isEdgesDirty && body.edgesUsed !== undefined
                ? Number(body.edgesUsed)
                : undefined,
            okQty,
            reworkQty,
            scrapQty,
            defectType: normalizeVn(body.defectType || ''),
            damageValue: Number(body.damageValue || 0),
            stopMinutes,
            stopReason: normalizeVn(body.stopReason || 'Không có dừng máy'),
          },
          priorCtx,
          payrollCfg
        );

        const spId = opRow?.sp_id ? String(opRow.sp_id) : null;
        const stepOrder = Number(opRow?.step_order || 1);
        const isFinalOp = opRow ? Number(opRow.is_final_op) : 0;
        const selfCheckOk = body.selfCheckOk !== false;

        const { warnings, qcStatus: baseQcStatus } = evaluateQualityWarnings(
          poId,
          spId,
          stepOrder,
          okQty,
          selfCheckOk,
          Number(opRow?.is_critical_check || 0)
        );
        const qcStatus = scrapQty > 0 ? 'NG_HOLD' : baseQcStatus;

        const nowDt = new Date();
        const vnFormatter = new Intl.DateTimeFormat('en-GB', {
          timeZone: 'Asia/Ho_Chi_Minh',
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        });
        const timeStr = vnFormatter.format(nowDt).replace(',', '');
        const handoverNote = normalizeVn(body.handoverNote || '');
        const materialLot = normalizeVn(body.materialLot || '');
        const noteParts = [`[PO: ${poId}]`, `[Ca: ${startTime}-${endTime}]`];
        if (handoverNote) noteParts.push(handoverNote);

        // 4. Insert production_logs
        const insRes = db
          .prepare(
            `INSERT INTO production_logs (
              record_uid, time_str, work_date, shift_type, start_time, end_time,
              overtime_minutes, is_sunday, is_lights_out, worker_id, worker_name,
              machine_id, machine_name, machine_mode, po_id, sp_id, customer, product_name,
              nc_id, op_name, stage, step_order, is_final_op, std_seconds,
              ok_qty, rework_qty, scrap_qty, defect_type, damage_value, stop_minutes, stop_reason,
              tool_code, edges_used, self_check_ok, qc_status,
              piece_wage, ot_bonus_wage, wait_wage, meal_allowance, scrap_penalty,
              direct_piece_income, income, batch_cost, kpi_pct, kpi_status,
              photo_url, handover_note, material_lot, note, is_voided
            ) VALUES (
              ?, ?, ?, ?, ?, ?,
              ?, ?, ?, ?, ?,
              ?, ?, ?, ?, ?, ?, ?,
              ?, ?, ?, ?, ?, ?,
              ?, ?, ?, ?, ?, ?, ?,
              ?, ?, ?, ?,
              ?, ?, ?, ?, ?,
              ?, ?, ?, ?, ?,
              ?, ?, ?, ?, 0
            )`
          )
          .run(
            recordUid,
            timeStr,
            workDate,
            shiftType,
            startTime,
            endTime,
            payroll.effectiveOtMinutes,
            payroll.isSunday ? 1 : 0,
            body.isLightsOut ? 1 : 0,
            targetWorkerId,
            String(wRow.name),
            String(machRow.id),
            String(machRow.name),
            payroll.effectiveMachineMode,
            poId,
            spId,
            String(opRow?.customer || 'Nội bộ'),
            String(opRow?.product_name || 'Dừng máy / Chờ phôi'),
            ncId,
            String(opRow?.op_name || 'Tính 100% lương CB'),
            String(opRow?.stage || '1'),
            stepOrder,
            isFinalOp,
            Number(opRow?.std_seconds || 0),
            okQty,
            reworkQty,
            scrapQty,
            normalizeVn(body.defectType || ''),
            Number(body.damageValue || 0),
            stopMinutes,
            normalizeVn(body.stopReason || 'Không có dừng máy'),
            toolCode,
            payroll.edgesConsumed,
            selfCheckOk ? 1 : 0,
            qcStatus,
            payroll.basePieceWage,
            payroll.otBonusWage,
            payroll.waitWage,
            payroll.mealAllowance,
            payroll.scrapPenalty,
            payroll.directPieceIncome,
            payroll.turnTotalIncome,
            payroll.batchCost,
            payroll.kpiPct,
            payroll.kpiStatus,
            savedPhotoUrl,
            handoverNote,
            materialLot,
            noteParts.join(' ')
          );

        const insertedId = Number(insRes.lastInsertRowid);

        // 5. Update Purchase Order progress (finished_qty ONLY increments when isFinalOp === 1!)
        if (poId && poId !== 'PO-THEO-KH') {
          const poRow = db
            .prepare('SELECT * FROM purchase_orders WHERE po_id = ?')
            .get(poId) as Record<string, any> | undefined;

          if (poRow && poRow.sp_id && spId && String(poRow.sp_id) !== spId) {
            throw new Error(
              `Nguyên công ${ncId} (${spId}) không thuộc sản phẩm của Lệnh SX ${poId} (${poRow.sp_id}).`
            );
          }

          if (poRow && okQty > 0) {
            const qtyPo = Number(poRow.qty_po);
            const deliveredQty = Number(poRow.delivered_qty);
            const newFinished =
              isFinalOp === 1
                ? Number(poRow.finished_qty) + okQty
                : Number(poRow.finished_qty);
            const newWip =
              isFinalOp === 0
                ? Math.max(Number(poRow.wip_qty), okQty)
                : Math.max(0, Number(poRow.wip_qty));
            const newStock = Math.max(0, newFinished - deliveredQty);
            const newRemain = Math.max(0, qtyPo - deliveredQty);
            const newStatus = derivePoStatus(qtyPo, newWip, newFinished, deliveredQty);

            db.prepare(
              `UPDATE purchase_orders
               SET wip_qty = ?, finished_qty = ?, stock_qty = ?, remain_qty = ?, status = ?,
                   material_lot = CASE WHEN ? != '' THEN ? ELSE material_lot END
               WHERE po_id = ?`
            ).run(newWip, newFinished, newStock, newRemain, newStatus, materialLot, materialLot, poId);
          }
        }

        // 6. Update Cutting Tool edge usage
        if (toolCode && payroll.edgesConsumed > 0) {
          db.prepare(
            `UPDATE cutting_tools
             SET used_edges_total = used_edges_total + ?, updated_at = datetime('now')
             WHERE code = ?`
          ).run(payroll.edgesConsumed, toolCode);
        }

        // 7. Update Machine live status
        const nextMachStatus =
          stopMinutes > 0 && okQty === 0
            ? removeVietnameseTones(body.stopReason || '')
                .toLowerCase()
                .includes('setup')
              ? 'SETUP'
              : 'STOPPED'
            : 'RUNNING';

        db.prepare(
          `UPDATE machines
           SET status = ?, current_worker_name = ?, current_po_id = ?, current_nc_id = ?,
               stop_reason = ?, updated_at = datetime('now')
           WHERE id = ?`
        ).run(
          nextMachStatus,
          String(wRow.name),
          poId,
          ncId,
          stopMinutes > 0 ? normalizeVn(body.stopReason || '') : null,
          String(machRow.id)
        );

        // 8. Auto-mark Attendance Monthly cell if currently empty
        const ym = workDate.slice(0, 7);
        const dayNum = Number(workDate.slice(8, 10));
        if (dayNum >= 1 && dayNum <= 31) {
          const attRow = db
            .prepare(`SELECT days_json, default_shift FROM attendance_monthly WHERE year_month = ? AND emp_id = ?`)
            .get(ym, targetWorkerId) as { days_json: string; default_shift: string } | undefined;

          if (attRow) {
            const daysArr: string[] = JSON.parse(attRow.days_json || '[]');
            while (daysArr.length < 31) daysArr.push('');
            if (!daysArr[dayNum - 1]) {
              const sCode = getDefShiftCode(shiftType || attRow.default_shift);
              const otHrs = Math.round((payroll.effectiveOtMinutes / 60) * 100) / 100;
              daysArr[dayNum - 1] = otHrs > 0 ? `${sCode}+${otHrs}` : sCode;
              db.prepare(
                `UPDATE attendance_monthly SET days_json = ?, updated_at = datetime('now')
                 WHERE year_month = ? AND emp_id = ?`
              ).run(JSON.stringify(daysArr), ym, targetWorkerId);
            }
          }
        }

        // 9. Enqueue async Outbox events (Telegram & Google Apps Script Webhook)
        enqueueOutboxEvent(db, 'GAS_WEBHOOK', 'REPORT_SUBMITTED', {
          record_id: recordUid,
          recordUid,
          date: workDate,
          worker: String(wRow.name),
          worker_id: targetWorkerId,
          shift: shiftType,
          machine: String(machRow.name),
          customer: String(opRow?.customer || 'Nội bộ'),
          product: String(opRow?.product_name || ''),
          po: poId,
          op: String(opRow?.op_name || ncId),
          qty_dat: okQty,
          qty_xuly: reworkQty,
          qty_huy: scrapQty,
          responsibility: scrapQty > 0 ? (body.defectType || 'Không rõ') : 'Không có lỗi',
          material: toolCode || '',
          qty_material: payroll.edgesConsumed || 0,
          downtime_min: stopMinutes || 0,
          downtime_note: body.stopReason || '',
          photos: body.photoBase64 ? [body.photoBase64] : [],
          income: payroll.turnTotalIncome,
        });

        if (wRow.chat_id || scrapQty > 0) {
          enqueueOutboxEvent(db, 'TELEGRAM', 'WORKER_RECEIPT', {
            chatId: wRow.chat_id || '',
            text: `✅ [${recordUid}] ${wRow.name} | ${machRow.name} | ${ncId}: ${okQty} OK / ${scrapQty} NG | Thu nhập ca: ${payroll.turnTotalIncome.toLocaleString('vi-VN')}đ`,
          });
        }

        const savedRow = db
          .prepare('SELECT * FROM production_logs WHERE id = ?')
          .get(insertedId) as Record<string, any>;

        const todaySum = db
          .prepare(
            `SELECT COALESCE(SUM(income), 0) AS tot FROM production_logs
             WHERE worker_id = ? AND work_date = ? AND is_voided = 0`
          )
          .get(targetWorkerId, workDate) as { tot: number };

        return {
          deduplicated: false,
          warnings,
          logDto: mapLogRowToDto(savedRow, viewer.workerId, viewer.appRole),
          payroll,
          todayTotalIncome: Number(todaySum.tot || 0),
        };
      });

      res.status(txResult.deduplicated ? 200 : 201).json({
        success: true,
        deduplicated: txResult.deduplicated,
        message: txResult.deduplicated
          ? `Phiếu ${recordUid} đã được ghi nhận trước đó (chống trùng lặp).`
          : `Đã ghi nhận sản lượng thành công (${recordUid}).`,
        warnings: txResult.warnings,
        log: txResult.logDto,
        payroll: txResult.payroll,
        todayTotalIncome: txResult.todayTotalIncome,
      });

      // Tự động kích hoạt đồng bộ tức thì lên Google Sheet & Telegram
      void flushPendingOutbox(db, 10).catch(() => {});
    } catch (err: any) {
      res.status(400).json({ error: String(err?.message || err) });
    }
  });

  // 1-for-1 Cutting Tool Swap (accessible to Worker / ShiftLeader / Admin)
  router.post('/master/tools/swap', requireAuth, (req, res) => {
    const viewer = req.authUser!;
    const toolCode = normalizeVn(req.body?.toolCode || '');
    const machineName = normalizeVn(req.body?.machineName || 'Máy xưởng CK');
    const oldInsertReturned = req.body?.oldInsertReturned !== false;
    const qtyIssued = Math.max(1, Math.round(Number(req.body?.qtyIssued) || 1));
    const reason = normalizeVn(req.body?.reason || 'Mòn hết cạnh cắt chuẩn');

    if (!toolCode) {
      res.status(400).json({ error: 'Vui lòng chọn mã dao cụ cần cấp phát.' });
      return;
    }
    if (!oldInsertReturned && viewer.appRole === 'WORKER') {
      res.status(400).json({
        error: 'Quy tắc 1-đổi-1: Phải thu hồi mảnh chíp mòn/vỡ cũ (hoặc có xác nhận Tổ trưởng) trước khi nhận chíp mới.',
      });
      return;
    }

    try {
      const updatedTool = withTransaction(db, () => {
        const t = db
          .prepare('SELECT * FROM cutting_tools WHERE code = ?')
          .get(toolCode) as Record<string, any> | undefined;
        if (!t) throw new Error(`Không tìm thấy mã dao cụ ${toolCode}`);

        const nextStock = Math.max(0, Number(t.stock_qty) - qtyIssued);
        db.prepare(
          `UPDATE cutting_tools SET stock_qty = ?, updated_at = datetime('now') WHERE code = ?`
        ).run(nextStock, toolCode);

        db.prepare(
          `INSERT INTO tool_swaps (tool_code, worker_id, worker_name, machine_name, old_insert_returned, qty_issued, reason)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(
          toolCode,
          viewer.workerId,
          viewer.name,
          machineName,
          oldInsertReturned ? 1 : 0,
          qtyIssued,
          reason
        );

        return db.prepare('SELECT * FROM cutting_tools WHERE code = ?').get(toolCode) as Record<
          string,
          any
        >;
      });

      res.status(201).json({
        success: true,
        message: `Đã cấp 1-đổi-1 ${qtyIssued} mảnh [${toolCode}] (Tồn kho còn: ${updatedTool.stock_qty}).`,
        tool: {
          code: String(updatedTool.code),
          stockQty: Number(updatedTool.stock_qty),
        },
      });
    } catch (err: any) {
      res.status(400).json({ error: String(err?.message || err) });
    }
  });

  // Job Traveler QR Print Data
  router.get('/orders/:poId/traveler', (req, res) => {
    const poId = normalizeVn(req.params.poId);
    const allPos = queryPurchaseOrders(db);
    const po = allPos.find((p) => p.poId.toLowerCase() === poId.toLowerCase());
    if (!po) {
      res.status(404).json({ error: `Không tìm thấy Lệnh SX / PO: ${poId}` });
      return;
    }

    const canSeeFinancials =
      req.authUser?.appRole === 'ADMIN' || req.authUser?.appRole === 'DIRECTOR';
    const allProds = queryProducts(db, canSeeFinancials);
    const product = po.spId ? allProds.find((p) => p.spId === po.spId) ?? null : null;

    const allOps = queryOperations(db);
    const prodOps = po.spId
      ? allOps.filter((o) => o.spId === po.spId)
      : allOps.filter(
          (o) =>
            normalizeVn(o.productName).replace(/\s+/g, '').toUpperCase() ===
            normalizeVn(po.productName).replace(/\s+/g, '').toUpperCase()
        );

    const faiRecords = queryQcInspections(db, po.poId).filter((q) => q.inspectionType === 'FAI');
    const faiPassedSet = new Set(
      faiRecords
        .filter((f) => f.result === 'PASS' || f.result === 'CONCESSION')
        .map((f) => f.ncId || '')
    );

    const doneRows = db
      .prepare(
        `SELECT nc_id, COALESCE(SUM(ok_qty), 0) AS done_ok
         FROM production_logs WHERE po_id = ? AND is_voided = 0 GROUP BY nc_id`
      )
      .all(po.poId) as Array<{ nc_id: string; done_ok: number }>;
    const doneMap = new Map(doneRows.map((d) => [String(d.nc_id), Number(d.done_ok)]));

    const dto: JobTravelerDto = {
      po,
      product,
      operations: prodOps.map((op) => ({
        ...op,
        qrPayload: `GCCK|${po.poId}|${op.ncId}`,
        doneOkQty: doneMap.get(op.ncId) ?? 0,
        faiPassed: faiPassedSet.has(op.ncId) || po.faiStatus === 'FAI_PASSED',
      })),
      faiRecords,
      printedAt: new Date().toISOString(),
    };

    res.json(dto);
  });

  // 100% Lot & Operation Traceability
  router.get('/orders/:poId/traceability', requireAuth, (req, res) => {
    const poId = normalizeVn(req.params.poId);
    const allPos = queryPurchaseOrders(db);
    const po = allPos.find((p) => p.poId.toLowerCase() === poId.toLowerCase());
    if (!po) {
      res.status(404).json({ error: `Không tìm thấy PO ${poId}` });
      return;
    }

    const viewer = req.authUser!;
    const allOps = queryOperations(db);
    const prodOps = po.spId ? allOps.filter((o) => o.spId === po.spId) : [];

    const poLogsRaw = db
      .prepare(`SELECT * FROM production_logs WHERE po_id = ? AND is_voided = 0 ORDER BY id ASC`)
      .all(po.poId) as Array<Record<string, any>>;
    const poLogs = poLogsRaw.map((r) => mapLogRowToDto(r, viewer.workerId, viewer.appRole));

    const operationsTimeline = prodOps.map((op) => {
      const stepLogs = poLogs.filter((l) => l.ncId === op.ncId);
      return {
        stepOrder: op.stepOrder,
        ncId: op.ncId,
        opName: op.opName,
        isFinalOp: op.isFinalOp,
        totalOk: stepLogs.reduce((s, l) => s + l.okQty, 0),
        totalRework: stepLogs.reduce((s, l) => s + l.reworkQty, 0),
        totalScrap: stepLogs.reduce((s, l) => s + l.scrapQty, 0),
        logs: stepLogs,
      };
    });

    const dto: TraceabilityDto = {
      po,
      materialInfo: {
        materialLot: po.materialLot || 'LOT-VICO-2610-001',
        supplierName: po.supplierName || 'Xưởng Đúc VICO Thắng Lợi',
        castDate: po.castDate || '2026-10-10',
        matName: prodOps[0]?.matName || 'Thép cơ khí chế tạo',
      },
      operationsTimeline,
      qcRecords: queryQcInspections(db, po.poId),
      deliveries: queryDeliveries(db, po.poId),
    };

    res.json(dto);
  });

  return router;
}
