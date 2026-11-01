import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import type { DatabaseSync } from 'node:sqlite';
import type {
  AttendanceRow,
  OpLogSummary,
  WorkerMonthlyLogAgg,
} from '../../shared/types';
import { withTransaction } from '../db/connection';
import { canonicalizeCustomerName, derivePoStatus } from '../db/seed';
import {
  getConfigMap,
  getMealConfigFromDb,
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
  queryWorkersForViewer,
  deleteHandoverSlip,
  insertHandoverSlip,
  queryHandoverSlips,
} from '../db/queries';
import { hashPin, requireRoles } from '../auth/security';
import { computeProductCosting } from '../../shared/costingEngine';
import { calculateTurnPayroll, isVietnamSunday } from '../../shared/payrollEngine';
import {
  computeEmployeeMonthlyStats,
  computeMonthDows,
  computeMonthly3PPayroll,
  getDefShiftCode,
  parseAttendanceCell,
  DEFAULT_MEAL_CONFIG,
} from '../../shared/attendanceParser';
import { computeMachineLoads } from '../../shared/loadBalancing';
import { normalizeVn } from '../../shared/vnSearch';
import { flushPendingOutbox, listOutboxItems } from '../adapters/syncAdapters';

export function createAdminRoutes(db: DatabaseSync): Router {
  const router = Router();

  function recomputeProductStepOrders(spId: string): void {
    const ops = db
      .prepare(`SELECT nc_id FROM operations WHERE sp_id = ? ORDER BY step_order ASC, rowid ASC`)
      .all(spId) as Array<{ nc_id: string }>;
    const total = ops.length;
    const upd = db.prepare(
      `UPDATE operations SET step_order = ?, is_final_op = ?, stage = ? WHERE nc_id = ?`
    );
    ops.forEach((o, idx) => {
      const step = idx + 1;
      const isFinal = idx === total - 1 ? 1 : 0;
      const stg = isFinal === 1 ? 'End' : String(step);
      upd.run(step, isFinal, stg, o.nc_id);
    });
  }

  function ensureProductId(customer: string, productName: string, matName: string = ''): string {
    const normCust = canonicalizeCustomerName(customer).customer;
    const normProd = normalizeVn(productName);
    const existing = db
      .prepare(`SELECT sp_id FROM products WHERE customer = ? AND product_name = ?`)
      .get(normCust, normProd) as { sp_id: string } | undefined;
    if (existing) return String(existing.sp_id);

    const maxRow = db
      .prepare(`SELECT COUNT(*) AS cnt FROM products`)
      .get() as { cnt: number };
    let nextNum = Number(maxRow.cnt) + 1;
    let spId = `SP${String(nextNum).padStart(3, '0')}`;
    while (db.prepare('SELECT 1 FROM products WHERE sp_id = ?').get(spId)) {
      nextNum++;
      spId = `SP${String(nextNum).padStart(3, '0')}`;
    }

    db.prepare(
      `INSERT INTO products (sp_id, customer, product_name, mat_name, quoted_price, raw_material_cost, outsource_cost)
       VALUES (?, ?, ?, ?, 0, 0, 0)`
    ).run(spId, normCust, normProd, normalizeVn(matName));

    return spId;
  }

  function nextNcId(): string {
    const rows = db.prepare(`SELECT nc_id FROM operations`).all() as Array<{ nc_id: string }>;
    let maxNum = 627;
    for (const r of rows) {
      const m = /^NC(\d+)$/i.exec(String(r.nc_id));
      if (m && Number(m[1]) > maxNum) maxNum = Number(m[1]);
    }
    return `NC${String(maxNum + 1).padStart(3, '0')}`;
  }

  // ==================== ORDERS & DELIVERY ====================
  router.get('/orders', requireRoles('SHIFT_LEADER', 'QC', 'DIRECTOR', 'ADMIN'), (_req, res) => {
    res.json({ items: queryPurchaseOrders(db), deliveries: queryDeliveries(db) });
  });

  router.post('/orders', requireRoles('SHIFT_LEADER', 'DIRECTOR', 'ADMIN'), (req, res) => {
    // 1. Multi-item batch or Excel import
    const rawItems: any[] = Array.isArray(req.body?.items)
      ? req.body.items
      : Array.isArray(req.body?.excelRows)
        ? req.body.excelRows
        : null;

    if (rawItems && rawItems.length > 0) {
      const insStmt = db.prepare(
        `INSERT OR REPLACE INTO purchase_orders (
          po_id, customer, sp_id, product_name, qty_po, due_date,
          wip_qty, finished_qty, delivered_qty, stock_qty, remain_qty,
          status, material_lot, supplier_name, cast_date, priority, note
        ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?, '⏳ Đang chờ SX', ?, ?, ?, 2, ?)`
      );

      const findSp = db.prepare(`SELECT sp_id FROM products WHERE product_name = ? LIMIT 1`);
      const insertedList: any[] = [];

      try {
        db.exec('BEGIN TRANSACTION');
        for (const item of rawItems) {
          const poId = normalizeVn(item.poId || '');
          if (!poId) continue;
          const { customer } = canonicalizeCustomerName(item.customer || req.body?.customer || 'Nội bộ');
          const productName = normalizeVn(item.productName || '');
          if (!productName) continue;
          const qtyPo = Math.max(1, Math.round(Number(item.qtyPo) || 1));
          const dueDate = normalizeVn(item.dueDate || req.body?.dueDate || '2026-11-30');
          const materialLot = normalizeVn(item.materialLot || req.body?.materialLot || `LOT-VICO-${Date.now().toString().slice(-4)}`);
          const supplierName = normalizeVn(item.supplierName || req.body?.supplierName || 'Xưởng Đúc VICO Thắng Lợi');
          const castDate = normalizeVn(item.castDate || req.body?.castDate || '2026-11-01');
          const note = normalizeVn(item.note || req.body?.note || '');

          let spId = normalizeVn(item.spId || '') || null;
          if (!spId) {
            const prodRow = findSp.get(productName) as { sp_id: string } | undefined;
            spId = prodRow ? String(prodRow.sp_id) : null;
          }

          insStmt.run(poId, customer, spId, productName, qtyPo, dueDate, qtyPo, materialLot, supplierName, castDate, note);
          insertedList.push({ poId, customer, productName, qtyPo });
        }
        db.exec('COMMIT');
      } catch (txErr) {
        db.exec('ROLLBACK');
        throw txErr;
      }

      res.status(201).json({
        success: true,
        count: insertedList.length,
        importedCount: insertedList.length,
        message: `Đã nạp thành công ${insertedList.length} danh mục đơn hàng PO.`
      });
      return;
    }

    const poId = normalizeVn(req.body?.poId || '');
    const { customer } = canonicalizeCustomerName(req.body?.customer || 'Win-Win');
    const productName = normalizeVn(req.body?.productName || '');
    const qtyPo = Math.max(1, Math.round(Number(req.body?.qtyPo) || 1));
    const dueDate = normalizeVn(req.body?.dueDate || '2026-11-30');
    const materialLot = normalizeVn(req.body?.materialLot || `LOT-VICO-${Date.now().toString().slice(-4)}`);
    const supplierName = normalizeVn(req.body?.supplierName || 'Xưởng Đúc VICO Thắng Lợi');
    const castDate = normalizeVn(req.body?.castDate || '2026-10-20');
    const note = normalizeVn(req.body?.note || '');

    if (!poId || !productName) {
      res.status(400).json({ error: 'Vui lòng nhập Mã PO và chọn Sản phẩm.' });
      return;
    }

    const dup = db.prepare('SELECT 1 FROM purchase_orders WHERE po_id = ?').get(poId);
    if (dup) {
      res.status(409).json({ error: `Mã PO ${poId} đã tồn tại.` });
      return;
    }

    let spId = normalizeVn(req.body?.spId || '') || null;
    if (!spId) {
      const prodRow = db
        .prepare(`SELECT sp_id FROM products WHERE product_name = ? LIMIT 1`)
        .get(productName) as { sp_id: string } | undefined;
      spId = prodRow ? String(prodRow.sp_id) : null;
    }

    db.prepare(
      `INSERT INTO purchase_orders (
        po_id, customer, sp_id, product_name, qty_po, due_date,
        wip_qty, finished_qty, delivered_qty, stock_qty, remain_qty,
        status, material_lot, supplier_name, cast_date, priority, note
      ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?, '⏳ Đang chờ SX', ?, ?, ?, 2, ?)`
    ).run(poId, customer, spId, productName, qtyPo, dueDate, qtyPo, materialLot, supplierName, castDate, note);

    const created = queryPurchaseOrders(db).find((p) => p.poId === poId);
    res.status(201).json({ success: true, item: created });
  });

  router.patch('/orders/:poId', requireRoles('SHIFT_LEADER', 'DIRECTOR', 'ADMIN'), (req, res) => {
    const poId = normalizeVn(req.params.poId);
    const existing = db
      .prepare('SELECT * FROM purchase_orders WHERE po_id = ?')
      .get(poId) as Record<string, any> | undefined;
    if (!existing) {
      res.status(404).json({ error: `Không tìm thấy PO ${poId}` });
      return;
    }

    const qtyPo =
      req.body?.qtyPo !== undefined
        ? Math.max(1, Math.round(Number(req.body.qtyPo)))
        : Number(existing.qty_po);
    const dueDate =
      req.body?.dueDate !== undefined ? normalizeVn(req.body.dueDate) : String(existing.due_date);
    const materialLot =
      req.body?.materialLot !== undefined
        ? normalizeVn(req.body.materialLot)
        : String(existing.material_lot);
    const supplierName =
      req.body?.supplierName !== undefined
        ? normalizeVn(req.body.supplierName)
        : String(existing.supplier_name);
    const priority =
      req.body?.priority !== undefined ? Number(req.body.priority) : Number(existing.priority);
    const note = req.body?.note !== undefined ? normalizeVn(req.body.note) : String(existing.note);

    const fin =
      req.body?.finishedQty !== undefined
        ? Math.max(0, Number(req.body.finishedQty) || 0)
        : Number(existing.finished_qty);
    const del =
      req.body?.deliveredQty !== undefined
        ? Math.max(0, Number(req.body.deliveredQty) || 0)
        : Number(existing.delivered_qty);
    const wip =
      req.body?.wipQty !== undefined
        ? Math.max(0, Number(req.body.wipQty) || 0)
        : Number(existing.wip_qty);

    const stock = Math.max(0, fin - del);
    const remain = Math.max(0, qtyPo - del);
    const status = derivePoStatus(qtyPo, wip, fin, del);

    db.prepare(
      `UPDATE purchase_orders
       SET qty_po = ?, due_date = ?, material_lot = ?, supplier_name = ?, priority = ?, note = ?,
           finished_qty = ?, wip_qty = ?, delivered_qty = ?, stock_qty = ?, remain_qty = ?, status = ?
       WHERE po_id = ?`
    ).run(qtyPo, dueDate, materialLot, supplierName, priority, note, fin, wip, del, stock, remain, status, poId);

    const updated = queryPurchaseOrders(db).find((p) => p.poId === poId);
    res.json({ success: true, item: updated });
  });

  router.post('/orders/:poId/deliver', requireRoles('SHIFT_LEADER', 'DIRECTOR', 'ADMIN'), (req, res) => {
    const poId = normalizeVn(req.params.poId);
    const qtyDeliver = Math.max(1, Math.round(Number(req.body?.qtyDeliver) || 0));
    const note = normalizeVn(req.body?.note || '');
    const viewer = req.authUser!;

    try {
      const updated = withTransaction(db, () => {
        const po = db
          .prepare('SELECT * FROM purchase_orders WHERE po_id = ?')
          .get(poId) as Record<string, any> | undefined;
        if (!po) throw new Error(`Không tìm thấy PO ${poId}`);

        const qtyPo = Number(po.qty_po);
        const fin = Number(po.finished_qty);
        const wip = Number(po.wip_qty);
        const newDel = Number(po.delivered_qty) + qtyDeliver;
        const newStock = Math.max(0, fin - newDel);
        const newRemain = Math.max(0, qtyPo - newDel);
        const newStatus = derivePoStatus(qtyPo, wip, fin, newDel);

        db.prepare(
          `UPDATE purchase_orders
           SET delivered_qty = ?, stock_qty = ?, remain_qty = ?, status = ?
           WHERE po_id = ?`
        ).run(newDel, newStock, newRemain, newStatus, poId);

        db.prepare(
          `INSERT INTO delivery_logs (po_id, customer, product_name, qty_deliver, delivered_by, note)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).run(poId, String(po.customer), String(po.product_name), qtyDeliver, viewer.name, note);

        return queryPurchaseOrders(db).find((p) => p.poId === poId);
      });

      res.status(201).json({
        success: true,
        message: `Đã xuất kho giao ${qtyDeliver} SP cho đơn ${poId}.`,
        item: updated,
      });
    } catch (err: any) {
      res.status(400).json({ error: String(err?.message || err) });
    }
  });

  // ==================== SCHEDULES & MACHINE BALANCING ====================
  router.get('/schedules', requireRoles('SHIFT_LEADER', 'QC', 'DIRECTOR', 'ADMIN'), (req, res) => {
    const workDate = req.query.workDate ? normalizeVn(String(req.query.workDate)) : undefined;
    const machines = queryMachines(db);
    const orders = queryPurchaseOrders(db);
    const ops = queryOperations(db);
    const schedules = querySchedules(db, workDate);
    const loads = computeMachineLoads(machines, orders, ops, schedules);
    res.json({ schedules, loads });
  });

  router.post('/schedules', requireRoles('SHIFT_LEADER', 'DIRECTOR', 'ADMIN'), (req, res) => {
    const machineId = normalizeVn(req.body?.machineId || 'M02');
    const mach = db.prepare('SELECT id, name FROM machines WHERE id = ?').get(machineId) as
      | { id: string; name: string }
      | undefined;
    if (!mach) {
      res.status(404).json({ error: `Không tìm thấy máy ${machineId}` });
      return;
    }

    const poId = normalizeVn(req.body?.poId || 'PO-THEO-KH');
    const ncId = normalizeVn(req.body?.ncId || 'NC001');
    const opRow = db.prepare('SELECT * FROM operations WHERE nc_id = ?').get(ncId) as
      | Record<string, any>
      | undefined;

    const workDate = normalizeVn(req.body?.workDate || '2026-10-26');
    const shiftType = normalizeVn(req.body?.shiftType || 'Ca 1 (Sáng 06h-14h)');
    const plannedQty = Math.max(1, Math.round(Number(req.body?.plannedQty) || 1));
    const plannedHours = Math.max(0.25, Number(req.body?.plannedHours) || 4);
    const isLightsOut = req.body?.isLightsOut ? 1 : 0;
    const sequenceOrder = Math.max(1, Math.round(Number(req.body?.sequenceOrder) || 1));
    const note = normalizeVn(req.body?.note || '');

    const r = db
      .prepare(
        `INSERT INTO machine_schedules (
          machine_id, machine_name, po_id, nc_id, product_name, op_name, mat_name, tool_code,
          work_date, shift_type, planned_qty, planned_hours, is_lights_out, sequence_order, status, note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PLANNED', ?)`
      )
      .run(
        mach.id,
        mach.name,
        poId,
        ncId,
        normalizeVn(req.body?.productName || opRow?.product_name || ''),
        normalizeVn(req.body?.opName || opRow?.op_name || ''),
        normalizeVn(req.body?.matName || opRow?.mat_name || ''),
        normalizeVn(req.body?.toolCode || opRow?.tool_code || ''),
        workDate,
        shiftType,
        plannedQty,
        plannedHours,
        isLightsOut,
        sequenceOrder,
        note
      );

    res.status(201).json({
      success: true,
      id: Number(r.lastInsertRowid),
      schedules: querySchedules(db),
    });
  });

  router.patch('/schedules/:id', requireRoles('SHIFT_LEADER', 'DIRECTOR', 'ADMIN'), (req, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM machine_schedules WHERE id = ?').get(id) as
      | Record<string, any>
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Không tìm thấy lịch máy.' });
      return;
    }

    let machId = String(existing.machine_id);
    let machName = String(existing.machine_name);
    if (req.body?.machineId) {
      const m = db
        .prepare('SELECT id, name FROM machines WHERE id = ?')
        .get(normalizeVn(req.body.machineId)) as { id: string; name: string } | undefined;
      if (m) {
        machId = m.id;
        machName = m.name;
      }
    }

    const shiftType =
      req.body?.shiftType !== undefined ? normalizeVn(req.body.shiftType) : String(existing.shift_type);
    const plannedQty =
      req.body?.plannedQty !== undefined ? Number(req.body.plannedQty) : Number(existing.planned_qty);
    const plannedHours =
      req.body?.plannedHours !== undefined
        ? Number(req.body.plannedHours)
        : Number(existing.planned_hours);
    const isLightsOut =
      req.body?.isLightsOut !== undefined
        ? req.body.isLightsOut
          ? 1
          : 0
        : Number(existing.is_lights_out);
    const status =
      req.body?.status !== undefined ? normalizeVn(req.body.status) : String(existing.status);

    db.prepare(
      `UPDATE machine_schedules
       SET machine_id = ?, machine_name = ?, shift_type = ?, planned_qty = ?, planned_hours = ?,
           is_lights_out = ?, status = ?
       WHERE id = ?`
    ).run(machId, machName, shiftType, plannedQty, plannedHours, isLightsOut, status, id);

    res.json({ success: true, schedules: querySchedules(db) });
  });

  router.delete('/schedules/:id', requireRoles('SHIFT_LEADER', 'DIRECTOR', 'ADMIN'), (req, res) => {
    db.prepare('DELETE FROM machine_schedules WHERE id = ?').run(Number(req.params.id));
    res.json({ success: true });
  });

  router.post(
    '/operations/:ncId/assign-machine',
    requireRoles('SHIFT_LEADER', 'DIRECTOR', 'ADMIN'),
    (req, res) => {
      const ncId = normalizeVn(req.params.ncId);
      const targetMachine = normalizeVn(req.body?.machineName || '');
      const mach = db
        .prepare('SELECT id, name, cost_per_hour FROM machines WHERE LOWER(name) = LOWER(?) OR id = ?')
        .get(targetMachine, targetMachine) as
        | { id: string; name: string; cost_per_hour: number }
        | undefined;

      if (!mach) {
        res.status(404).json({ error: `Không tìm thấy máy ${targetMachine}` });
        return;
      }

      const op = db.prepare('SELECT std_seconds FROM operations WHERE nc_id = ?').get(ncId) as
        | { std_seconds: number }
        | undefined;
      if (!op) {
        res.status(404).json({ error: `Không tìm thấy nguyên công ${ncId}` });
        return;
      }

      const newStdMachCost = Math.round((Number(op.std_seconds) / 3600) * Number(mach.cost_per_hour));
      db.prepare(`UPDATE operations SET default_machine = ?, std_mach_cost = ? WHERE nc_id = ?`).run(
        mach.name,
        newStdMachCost,
        ncId
      );

      res.json({
        success: true,
        message: `Đã điều chuyển ${ncId} sang máy ${mach.name}.`,
        machineName: mach.name,
      });
    }
  );

  // ==================== LOGS & QC ====================
  router.get('/logs', requireRoles('SHIFT_LEADER', 'QC', 'DIRECTOR', 'ADMIN'), (req, res) => {
    const viewer = req.authUser!;
    const includeVoided = req.query.includeVoided === '1';
    const items = queryLogs(db, viewer.workerId, viewer.appRole, 1000, includeVoided);
    res.json({ items });
  });

  router.patch('/logs/:id', requireRoles('SHIFT_LEADER', 'ADMIN'), (req, res) => {
    const id = Number(req.params.id);
    const viewer = req.authUser!;

    try {
      const updated = withTransaction(db, () => {
        const log = db
          .prepare('SELECT * FROM production_logs WHERE id = ?')
          .get(id) as Record<string, any> | undefined;
        if (!log) throw new Error('Không tìm thấy nhật ký sản xuất.');

        const okQty =
          req.body?.okQty !== undefined
            ? Math.max(0, Math.round(Number(req.body.okQty)))
            : Number(log.ok_qty);
        const reworkQty =
          req.body?.reworkQty !== undefined
            ? Math.max(0, Math.round(Number(req.body.reworkQty)))
            : Number(log.rework_qty);
        const scrapQty =
          req.body?.scrapQty !== undefined
            ? Math.max(0, Math.round(Number(req.body.scrapQty)))
            : Number(log.scrap_qty);
        const isVoided =
          req.body?.isVoided !== undefined ? (req.body.isVoided ? 1 : 0) : Number(log.is_voided);
        const qcStatus =
          req.body?.qcStatus !== undefined ? normalizeVn(req.body.qcStatus) : String(log.qc_status);

        const prevEffectiveFinalOk =
          Number(log.is_voided) === 0 && Number(log.is_final_op) === 1 ? Number(log.ok_qty) : 0;
        const nextEffectiveFinalOk =
          isVoided === 0 && Number(log.is_final_op) === 1 ? okQty : 0;
        const deltaFinalOk = nextEffectiveFinalOk - prevEffectiveFinalOk;

        const poId = String(log.po_id);
        let prevLoggedWip = 0;
        if (poId && poId !== 'PO-THEO-KH') {
          const prevWipRow = db
            .prepare(
              `SELECT COALESCE(MAX(step_ok), 0) AS max_up_ok
               FROM (
                 SELECT SUM(ok_qty) AS step_ok
                 FROM production_logs
                 WHERE po_id = ? AND is_final_op = 0 AND is_voided = 0
                 GROUP BY nc_id
               )`
            )
            .get(poId) as { max_up_ok: number } | undefined;
          prevLoggedWip = Number(prevWipRow?.max_up_ok || 0);
        }

        const qtyChanged =
          okQty !== Number(log.ok_qty) ||
          reworkQty !== Number(log.rework_qty) ||
          scrapQty !== Number(log.scrap_qty) ||
          (isVoided === 0 && Number(log.is_voided) === 1);

        if (isVoided === 0 && qtyChanged) {
          const wRow = db
            .prepare('SELECT salary_mode, cost_per_sec FROM workers WHERE id = ?')
            .get(String(log.worker_id)) as Record<string, any> | undefined;
          const opRow = db
            .prepare('SELECT * FROM operations WHERE nc_id = ?')
            .get(String(log.nc_id)) as Record<string, any> | undefined;
          const machRow = db
            .prepare('SELECT cost_per_hour FROM machines WHERE id = ? OR LOWER(name) = LOWER(?)')
            .get(String(log.machine_id || ''), String(log.machine_name || '')) as
            | Record<string, any>
            | undefined;
          const toolCode = String(log.tool_code || opRow?.tool_code || '');
          const toolRow = toolCode
            ? (db.prepare('SELECT cost_per_edge FROM cutting_tools WHERE code = ?').get(toolCode) as
                | Record<string, any>
                | undefined)
            : undefined;

          const siblingRows = db
            .prepare(
              `SELECT machine_name, shift_type, start_time, end_time, meal_allowance, overtime_minutes, stop_minutes
               FROM production_logs
               WHERE worker_id = ? AND work_date = ? AND is_voided = 0 AND id != ?`
            )
            .all(String(log.worker_id), String(log.work_date), id) as Array<Record<string, any>>;

          const normShift = normalizeVn(String(log.shift_type || '')).toLowerCase();
          let mealPaidAmount = 0;
          let paidOtMinutes = 0;
          let paidStopMinutes = 0;
          for (const r of siblingRows) {
            if (normalizeVn(r.shift_type).toLowerCase() === normShift) {
              mealPaidAmount += Number(r.meal_allowance || 0);
              paidOtMinutes = Math.max(paidOtMinutes, Number(r.overtime_minutes || 0));
              paidStopMinutes += Number(r.stop_minutes || 0);
            }
          }

          const priorCtx = {
            priorLogs: siblingRows.map((r) => ({
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

          const prevScrap = Number(log.scrap_qty || 0);
          const nextDamageVal =
            scrapQty === 0
              ? 0
              : prevScrap > 0
                ? Math.round((Number(log.damage_value || 0) / prevScrap) * scrapQty)
                : scrapQty *
                  Math.max(
                    50000,
                    Number(opRow?.std_labor_cost || 0) +
                      Number(opRow?.std_mach_cost || 0) +
                      Number(opRow?.std_tool_cost || 0)
                  );

          const workDateStr = String(log.work_date);
          const recalc = calculateTurnPayroll(
            {
              workerId: String(log.worker_id),
              salaryMode: String(wRow?.salary_mode || 'Khoán 1 + 0.33 máy'),
              costPerSec: Number(wRow?.cost_per_sec ?? 13.89),
              workDate: workDateStr,
              shiftType: String(log.shift_type || 'Ca 1 (Sáng 06h-14h)'),
              startTime: String(log.start_time || '06:00'),
              endTime: String(log.end_time || '14:00'),
              overtimeMinutes: Number(log.overtime_minutes || 0),
              isSunday: isVietnamSunday(workDateStr),
              isLightsOut: Boolean(log.is_lights_out),
              machineName: String(log.machine_name),
              machineMode: log.machine_mode === 'SECOND' ? 'SECOND' : 'FIRST',
              machineCostPerHour: Number(machRow?.cost_per_hour || 250000),
              stdSeconds: Number(opRow?.std_seconds ?? log.std_seconds ?? 0),
              stdEdgesPerPcs: Number(opRow?.std_edges_per_pcs || 0),
              costPerEdge: Number(toolRow?.cost_per_edge ?? opRow?.cost_per_edge ?? 0),
              okQty,
              reworkQty,
              scrapQty,
              defectType: String(log.defect_type || ''),
              damageValue: nextDamageVal,
              stopMinutes: Number(log.stop_minutes || 0),
              stopReason: String(log.stop_reason || 'Không có dừng máy'),
            },
            priorCtx,
            getPayrollConfigFromDb(db)
          );

          db.prepare(
            `UPDATE production_logs
             SET ok_qty = ?, rework_qty = ?, scrap_qty = ?, damage_value = ?, is_voided = ?, qc_status = ?,
                 edges_used = ?, piece_wage = ?, ot_bonus_wage = ?, wait_wage = ?, meal_allowance = ?,
                 scrap_penalty = ?, direct_piece_income = ?, income = ?, batch_cost = ?, kpi_pct = ?, kpi_status = ?
             WHERE id = ?`
          ).run(
            okQty,
            reworkQty,
            scrapQty,
            nextDamageVal,
            isVoided,
            qcStatus,
            recalc.edgesConsumed,
            recalc.basePieceWage,
            recalc.otBonusWage,
            recalc.waitWage,
            recalc.mealAllowance,
            recalc.scrapPenalty,
            recalc.directPieceIncome,
            recalc.turnTotalIncome,
            recalc.batchCost,
            recalc.kpiPct,
            recalc.kpiStatus,
            id
          );
        } else {
          db.prepare(
            `UPDATE production_logs
             SET ok_qty = ?, rework_qty = ?, scrap_qty = ?, is_voided = ?, qc_status = ?
             WHERE id = ?`
          ).run(okQty, reworkQty, scrapQty, isVoided, qcStatus, id);
        }

        if (poId && poId !== 'PO-THEO-KH') {
          const po = db
            .prepare('SELECT * FROM purchase_orders WHERE po_id = ?')
            .get(poId) as Record<string, any> | undefined;
          if (po) {
            const nextWipRow = db
              .prepare(
                `SELECT COALESCE(MAX(step_ok), 0) AS max_up_ok
                 FROM (
                   SELECT SUM(ok_qty) AS step_ok
                   FROM production_logs
                   WHERE po_id = ? AND is_final_op = 0 AND is_voided = 0
                   GROUP BY nc_id
                 )`
              )
              .get(poId) as { max_up_ok: number } | undefined;
            const nextLoggedWip = Number(nextWipRow?.max_up_ok || 0);
            const baselineSeededWip = Math.max(0, Number(po.wip_qty) - prevLoggedWip);

            const qtyPo = Number(po.qty_po);
            const del = Number(po.delivered_qty);
            const newFin = Math.max(0, Number(po.finished_qty) + deltaFinalOk);
            const newWip = Math.min(qtyPo, Math.max(baselineSeededWip, nextLoggedWip));
            const newStock = Math.max(0, newFin - del);
            const newRemain = Math.max(0, qtyPo - del);
            const newStatus = derivePoStatus(qtyPo, newWip, newFin, del);
            db.prepare(
              `UPDATE purchase_orders
               SET wip_qty = ?, finished_qty = ?, stock_qty = ?, remain_qty = ?, status = ?
               WHERE po_id = ?`
            ).run(newWip, newFin, newStock, newRemain, newStatus, poId);
          }
        }

        const refreshed = db
          .prepare('SELECT * FROM production_logs WHERE id = ?')
          .get(id) as Record<string, any>;
        return mapLogRowToDto(refreshed, viewer.workerId, viewer.appRole);
      });

      res.json({ success: true, item: updated });
    } catch (err: any) {
      res.status(400).json({ error: String(err?.message || err) });
    }
  });

  router.get('/qc', requireRoles('SHIFT_LEADER', 'QC', 'DIRECTOR', 'ADMIN'), (req, res) => {
    const poId = req.query.poId ? normalizeVn(String(req.query.poId)) : undefined;
    res.json({ items: queryQcInspections(db, poId) });
  });

  router.post('/qc', requireRoles('SHIFT_LEADER', 'QC', 'DIRECTOR', 'ADMIN'), (req, res) => {
    const viewer = req.authUser!;
    const inspectionType = normalizeVn(req.body?.inspectionType || 'FAI');
    const poId = normalizeVn(req.body?.poId || '');
    const ncId = normalizeVn(req.body?.ncId || '') || null;
    const result = normalizeVn(req.body?.result || 'PASS');

    if (!poId) {
      res.status(400).json({ error: 'Vui lòng chọn mã PO kiểm tra QC.' });
      return;
    }

    const po = db.prepare('SELECT sp_id, product_name FROM purchase_orders WHERE po_id = ?').get(poId) as
      | { sp_id: string | null; product_name: string }
      | undefined;
    const op = ncId
      ? (db.prepare('SELECT op_name, default_machine FROM operations WHERE nc_id = ?').get(ncId) as
          | { op_name: string; default_machine: string }
          | undefined)
      : undefined;

    const dims = Array.isArray(req.body?.measuredDims)
      ? JSON.stringify(req.body.measuredDims)
      : String(req.body?.measuredDimsJson || '[]');

    const r = db
      .prepare(
        `INSERT INTO qc_inspections (
          inspection_type, po_id, sp_id, nc_id, product_name, op_name, machine_name,
          operator_id, inspector_id, inspector_name, result, sample_size, defect_qty,
          measured_dims_json, root_cause, corrective_action
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        inspectionType,
        poId,
        po?.sp_id ?? null,
        ncId,
        normalizeVn(req.body?.productName || po?.product_name || ''),
        normalizeVn(req.body?.opName || op?.op_name || ''),
        normalizeVn(req.body?.machineName || op?.default_machine || ''),
        normalizeVn(req.body?.operatorId || ''),
        viewer.workerId,
        viewer.name,
        result,
        Math.max(1, Number(req.body?.sampleSize) || 1),
        Math.max(0, Number(req.body?.defectQty) || 0),
        dims,
        normalizeVn(req.body?.rootCause || ''),
        normalizeVn(req.body?.correctiveAction || '')
      );

    // If FAI passed, clear PENDING_QC logs on that PO
    if (inspectionType === 'FAI' && (result === 'PASS' || result === 'CONCESSION')) {
      db.prepare(
        `UPDATE production_logs SET qc_status = 'PASSED' WHERE po_id = ? AND qc_status = 'PENDING_QC'`
      ).run(poId);
    }

    const created = queryQcInspections(db).find((q) => q.id === Number(r.lastInsertRowid));
    res.status(201).json({ success: true, item: created });
  });

  // ==================== COSTING & PNL (STRICT ADMIN / DIRECTOR ONLY) ====================
  function buildAllCostingSummaries() {
    const products = queryProducts(db, true);
    const ops = queryOperations(db);
    const logRows = db
      .prepare(
        `SELECT nc_id, ok_qty, rework_qty, scrap_qty, batch_cost, is_voided
         FROM production_logs WHERE is_voided = 0`
      )
      .all() as Array<Record<string, any>>;

    const opsBySp = new Map<string, typeof ops>();
    for (const o of ops) {
      const list = opsBySp.get(o.spId) || [];
      list.push(o);
      opsBySp.set(o.spId, list);
    }

    const logsByNc = new Map<string, OpLogSummary[]>();
    for (const l of logRows) {
      const nc = String(l.nc_id);
      const list = logsByNc.get(nc) || [];
      list.push({
        ncId: nc,
        okQty: Number(l.ok_qty || 0),
        reworkQty: Number(l.rework_qty || 0),
        scrapQty: Number(l.scrap_qty || 0),
        batchCost: Number(l.batch_cost || 0),
        isVoided: Number(l.is_voided || 0),
      });
      logsByNc.set(nc, list);
    }

    return products.map((p) => {
      const pOps = opsBySp.get(p.spId) || [];
      const pLogs = pOps.flatMap((o) => logsByNc.get(o.ncId) || []);
      return computeProductCosting(p, pOps, pLogs);
    });
  }

  router.get('/costing', requireRoles('DIRECTOR', 'ADMIN'), (_req, res) => {
    const items = buildAllCostingSummaries();
    const profitCount = items.filter((i) => i.unitProfit >= 0).length;
    const lossCount = items.filter((i) => i.unitProfit < 0).length;
    const totalNetProfit = items.reduce(
      (sum, i) => sum + (i.hasActual ? i.totalBatchProfit : 0),
      0
    );

    res.json({
      items,
      summary: {
        totalProducts: items.length,
        profitCount,
        lossCount,
        totalNetProfit,
      },
    });
  });

  router.patch('/costing/:spId', requireRoles('DIRECTOR', 'ADMIN'), (req, res) => {
    const spId = normalizeVn(req.params.spId);
    const prod = db.prepare('SELECT * FROM products WHERE sp_id = ?').get(spId) as
      | Record<string, any>
      | undefined;
    if (!prod) {
      res.status(404).json({ error: `Không tìm thấy sản phẩm ${spId}` });
      return;
    }

    const quotedPrice =
      req.body?.quotedPrice !== undefined
        ? Math.max(0, Number(req.body.quotedPrice) || 0)
        : Number(prod.quoted_price);
    const rawMaterialCost =
      req.body?.rawMaterialCost !== undefined
        ? Math.max(0, Number(req.body.rawMaterialCost) || 0)
        : Number(prod.raw_material_cost);
    const outsourceCost =
      req.body?.outsourceCost !== undefined
        ? Math.max(0, Number(req.body.outsourceCost) || 0)
        : Number(prod.outsource_cost);
    const drawingUrl =
      req.body?.drawingUrl !== undefined
        ? String(req.body.drawingUrl || '').trim()
        : String(prod.drawing_url || '');
    const techDocUrl =
      req.body?.techDocUrl !== undefined
        ? String(req.body.techDocUrl || '').trim()
        : String(prod.tech_doc_url || '');

    db.prepare(
      `UPDATE products SET quoted_price = ?, raw_material_cost = ?, outsource_cost = ?, drawing_url = ?, tech_doc_url = ? WHERE sp_id = ?`
    ).run(quotedPrice, rawMaterialCost, outsourceCost, drawingUrl, techDocUrl, spId);

    const updatedItem = buildAllCostingSummaries().find((c) => c.spId === spId);
    res.json({ success: true, item: updatedItem });
  });

  // ==================== ATTENDANCE & 3P PAYROLL ====================
  function ensureMonthAttendanceRows(yearMonth: string): AttendanceRow[] {
    const [yStr, mStr] = yearMonth.split('-');
    const year = Number(yStr) || 2026;
    const month = Number(mStr) || 10;

    let rows = db
      .prepare(
        `SELECT year_month, emp_id, emp_name, work_type, default_shift, year_days_hist_json, days_json
         FROM attendance_monthly WHERE year_month = ? ORDER BY rowid ASC`
      )
      .all(yearMonth) as Array<Record<string, any>>;

    if (rows.length === 0) {
      const baseRows = db
        .prepare(
          `SELECT emp_id, emp_name, work_type, default_shift, year_days_hist_json
           FROM attendance_monthly WHERE year_month = '2026-10' ORDER BY rowid ASC`
        )
        .all() as Array<Record<string, any>>;

      const dows = computeMonthDows(year, month);
      const ins = db.prepare(
        `INSERT OR IGNORE INTO attendance_monthly (year_month, emp_id, emp_name, work_type, default_shift, year_days_hist_json, days_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );

      withTransaction(db, () => {
        if (baseRows.length > 0) {
          for (const b of baseRows) {
            const rawHist: number[] =
              year === 2026 ? JSON.parse(String(b.year_days_hist_json || '[]')) : [];
            const hist12 = new Array(12).fill(0);
            if (year === 2026) {
              for (let i = 0; i < Math.min(9, rawHist.length); i++) {
                hist12[i] = Number(rawHist[i] || 0);
              }
            }
            const targetDays =
              year === 2026 && month >= 1 && month <= 9 ? Number(hist12[month - 1] || 0) : 0;
            const defCode = getDefShiftCode(String(b.default_shift));
            const days: string[] = [];
            let count = 0;
            for (let d = 0; d < 31; d++) {
              if (targetDays > 0 && dows[d] !== '-' && dows[d] !== 'CN' && count < targetDays) {
                count++;
                days.push(defCode);
              } else {
                days.push('');
              }
            }
            ins.run(
              yearMonth,
              String(b.emp_id),
              String(b.emp_name),
              String(b.work_type || 'Công'),
              String(b.default_shift || 'Ca 1'),
              JSON.stringify(hist12),
              JSON.stringify(days)
            );
          }
        } else {
          const workers = db.prepare('SELECT id, name, salary_mode FROM workers WHERE is_active = 1').all() as Array<
            Record<string, any>
          >;
          for (const w of workers) {
            const defShift = String(w.salary_mode).includes('Hành chính') ? 'Hành chính' : 'Ca 1';
            ins.run(
              yearMonth,
              String(w.id),
              String(w.name),
              'Công',
              defShift,
              JSON.stringify(new Array(12).fill(0)),
              JSON.stringify(new Array(31).fill(''))
            );
          }
        }
      });

      rows = db
        .prepare(
          `SELECT year_month, emp_id, emp_name, work_type, default_shift, year_days_hist_json, days_json
           FROM attendance_monthly WHERE year_month = ? ORDER BY rowid ASC`
        )
        .all(yearMonth) as Array<Record<string, any>>;
    }

    // Dynamically aggregate regDays from all other saved months of the same year in attendance_monthly
    const mealCfg = getMealConfigFromDb(db);
    const siblingYearRows = db
      .prepare(
        `SELECT year_month, emp_id, emp_name, work_type, default_shift, days_json
         FROM attendance_monthly
         WHERE year_month LIKE ? AND year_month != ?`
      )
      .all(`${year}-%`, yearMonth) as Array<Record<string, any>>;

    const dynamicMonthDaysByEmp = new Map<string, Map<number, number>>();
    for (const sRow of siblingYearRows) {
      const sibYm = String(sRow.year_month);
      const sibMonth = Number(sibYm.split('-')[1]);
      if (!sibMonth || sibMonth < 1 || sibMonth > 12) continue;
      const empId = String(sRow.emp_id);
      const sibSummary = computeEmployeeMonthlyStats(
        {
          empId,
          name: String(sRow.emp_name || ''),
          workType: String(sRow.work_type || 'Công'),
          defaultShift: String(sRow.default_shift || 'Ca 1'),
          yearDaysHist: [],
          days: JSON.parse(String(sRow.days_json || '[]')),
        },
        year,
        sibMonth,
        mealCfg
      );
      let empMonths = dynamicMonthDaysByEmp.get(empId);
      if (!empMonths) {
        empMonths = new Map<number, number>();
        dynamicMonthDaysByEmp.set(empId, empMonths);
      }
      empMonths.set(sibMonth, sibSummary.regDays);
    }

    return rows.map((r) => {
      const empId = String(r.emp_id);
      const storedHist: number[] =
        year === 2026 ? JSON.parse(String(r.year_days_hist_json || '[]')) : [];
      const mergedHist = new Array(12).fill(0);
      if (year === 2026) {
        for (let mIdx = 0; mIdx < Math.min(12, storedHist.length); mIdx++) {
          mergedHist[mIdx] = Number(storedHist[mIdx] || 0);
        }
      }
      const empDynamic = dynamicMonthDaysByEmp.get(empId);
      if (empDynamic) {
        for (const [mNum, regDaysVal] of empDynamic.entries()) {
          mergedHist[mNum - 1] = regDaysVal;
        }
      }

      return {
        empId,
        name: String(r.emp_name),
        workType: String(r.work_type || 'Công'),
        defaultShift: String(r.default_shift || 'Ca 1'),
        yearDaysHist: mergedHist,
        days: JSON.parse(String(r.days_json || '[]')),
      };
    });
  }

  router.get('/attendance/:yearMonth', requireRoles('SHIFT_LEADER', 'DIRECTOR', 'ADMIN'), (req, res) => {
    const ym = normalizeVn(req.params.yearMonth);
    const [yStr, mStr] = ym.split('-');
    const year = Number(yStr) || 2026;
    const month = Number(mStr) || 10;
    const mealCfg = getMealConfigFromDb(db);

    const rawRows = ensureMonthAttendanceRows(ym);
    const employees = rawRows.map((emp) => computeEmployeeMonthlyStats(emp, year, month, mealCfg));

    res.json({
      yearMonth: ym,
      year,
      month,
      dows: computeMonthDows(year, month),
      mealConfig: mealCfg,
      employees,
    });
  });

  router.put(
    '/attendance/:yearMonth/cell',
    requireRoles('SHIFT_LEADER', 'DIRECTOR', 'ADMIN'),
    (req, res) => {
      const ym = normalizeVn(req.params.yearMonth);
      const empId = normalizeVn(req.body?.empId || '');
      const dayIndex = Number(req.body?.dayIndex);
      const value = normalizeVn(String(req.body?.value ?? ''));
      const defaultShift = req.body?.defaultShift ? normalizeVn(req.body.defaultShift) : undefined;

      ensureMonthAttendanceRows(ym);
      const row = db
        .prepare(
          `SELECT days_json, default_shift FROM attendance_monthly WHERE year_month = ? AND emp_id = ?`
        )
        .get(ym, empId) as { days_json: string; default_shift: string } | undefined;

      if (!row) {
        res.status(404).json({ error: `Không tìm thấy bảng công của ${empId}` });
        return;
      }

      const days: string[] = JSON.parse(row.days_json || '[]');
      while (days.length < 31) days.push('');
      if (!Number.isNaN(dayIndex) && dayIndex >= 0 && dayIndex < 31) {
        days[dayIndex] = value;
      }

      db.prepare(
        `UPDATE attendance_monthly
         SET days_json = ?, default_shift = ?, updated_at = datetime('now')
         WHERE year_month = ? AND emp_id = ?`
      ).run(JSON.stringify(days), defaultShift ?? row.default_shift, ym, empId);

      const [yStr, mStr] = ym.split('-');
      const updatedRows = ensureMonthAttendanceRows(ym);
      const updatedEmp = updatedRows.find((e) => e.empId === empId)!;
      const summary = computeEmployeeMonthlyStats(
        updatedEmp,
        Number(yStr) || 2026,
        Number(mStr) || 10,
        getMealConfigFromDb(db)
      );

      res.json({ success: true, employee: summary });
    }
  );

  router.post(
    '/attendance/:yearMonth/batch',
    requireRoles('SHIFT_LEADER', 'DIRECTOR', 'ADMIN'),
    (req, res) => {
      const ym = normalizeVn(req.params.yearMonth);
      const [yStr, mStr] = ym.split('-');
      const year = Number(yStr) || 2026;
      const month = Number(mStr) || 10;
      const dows = computeMonthDows(year, month);

      const mode = normalizeVn(req.body?.mode || 'DEFAULT_SHIFT');
      const fromDay = Math.max(1, Math.min(31, Number(req.body?.fromDay) || 1));
      const toDay = Math.max(fromDay, Math.min(31, Number(req.body?.toDay) || 25));
      const rawVal = normalizeVn(String(req.body?.value ?? '')).toUpperCase();
      const selectedDows: string[] = Array.isArray(req.body?.selectedDows)
        ? req.body.selectedDows
        : ['T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
      const empIds: string[] = Array.isArray(req.body?.empIds) ? req.body.empIds : [];
      const fillEmptyWithDef = Boolean(req.body?.fillEmptyWithDef ?? true);
      const overwrite = Boolean(req.body?.overwrite ?? false);

      const rows = ensureMonthAttendanceRows(ym);
      let changedCells = 0;

      withTransaction(db, () => {
        const upd = db.prepare(
          `UPDATE attendance_monthly SET days_json = ?, updated_at = datetime('now')
           WHERE year_month = ? AND emp_id = ?`
        );

        for (const emp of rows) {
          if (empIds.length > 0 && !empIds.includes(emp.empId)) continue;
          const defCode = getDefShiftCode(emp.defaultShift);
          const days = [...emp.days];
          while (days.length < 31) days.push('');

          for (let d = fromDay; d <= toDay; d++) {
            const dow = dows[d - 1];
            if (dow === '-' || !selectedDows.includes(dow)) continue;
            const cur = String(days[d - 1] || '').trim().toUpperCase();

            if (mode === 'OT_FIXED') {
              if (cur === 'P' || cur === 'KP' || cur === 'O' || cur === '0') continue;
              const otPart = rawVal.startsWith('+') ? rawVal : `+${rawVal || '2'}`;
              if (!cur) {
                if (fillEmptyWithDef) {
                  days[d - 1] = `${defCode}${otPart}`;
                  changedCells++;
                }
              } else {
                const mLate = cur.match(/-\s*\d+(?:\.\d+)?/);
                const baseOnly =
                  cur.split('+')[0].replace(/-\s*\d+(?:\.\d+)?/g, '').trim() || defCode;
                days[d - 1] = `${baseOnly}${otPart}${mLate ? mLate[0].replace(/\s+/g, '') : ''}`;
                changedCells++;
              }
            } else if (mode === 'DEFAULT_SHIFT') {
              if (!cur || overwrite) {
                days[d - 1] = defCode;
                changedCells++;
              }
            } else if (mode === 'LONG_LEAVE') {
              if (!cur || overwrite) {
                days[d - 1] = rawVal || 'P';
                changedCells++;
              }
            } else if (mode === 'RESIGN') {
              days[d - 1] = '';
              changedCells++;
            }
          }

          upd.run(JSON.stringify(days), ym, emp.empId);
        }
      });

      const refreshed = ensureMonthAttendanceRows(ym).map((e) =>
        computeEmployeeMonthlyStats(e, year, month, getMealConfigFromDb(db))
      );

      res.json({ success: true, changedCells, employees: refreshed });
    }
  );

  router.get('/payroll/:yearMonth', requireRoles('DIRECTOR', 'ADMIN'), (req, res) => {
    const rawParam = normalizeVn(req.params.yearMonth);
    const ym =
      rawParam.toLowerCase() === '3p'
        ? normalizeVn(String(req.query.month || '2026-10'))
        : rawParam;
    const [yStr, mStr] = ym.split('-');
    const year = Number(yStr) || 2026;
    const month = Number(mStr) || 10;

    const workers = queryWorkersForViewer(db, req.authUser!.workerId, 'ADMIN');
    const attRows = ensureMonthAttendanceRows(ym);
    const attSummaries = attRows.map((e) =>
      computeEmployeeMonthlyStats(e, year, month, getMealConfigFromDb(db))
    );

    const logAggRows = db
      .prepare(
        `SELECT worker_id,
                COUNT(*) AS log_count,
                COALESCE(SUM(ok_qty * std_seconds), 0) AS earned_sec,
                COALESCE(SUM(direct_piece_income), 0) AS direct_piece,
                COALESCE(SUM(wait_wage), 0) AS wait_total,
                COALESCE(SUM(ot_bonus_wage), 0) AS ot_bonus_total,
                COALESCE(SUM(meal_allowance), 0) AS meal_total,
                COALESCE(SUM(scrap_penalty), 0) AS pen_total
         FROM production_logs
         WHERE substr(work_date, 1, 7) = ? AND is_voided = 0
         GROUP BY worker_id`
      )
      .all(ym) as Array<Record<string, any>>;

    const logAggs: WorkerMonthlyLogAgg[] = logAggRows.map((r) => ({
      workerId: String(r.worker_id),
      logCount: Number(r.log_count),
      earnedStdSeconds: Number(r.earned_sec),
      directPieceIncome: Number(r.direct_piece),
      waitWageTotal: Number(r.wait_total),
      otBonusTotal: Number(r.ot_bonus_total),
      logMealTotal: Number(r.meal_total),
      scrapPenaltyTotal: Number(r.pen_total),
    }));

    const rows = computeMonthly3PPayroll(workers, attSummaries, logAggs);
    res.json({
      yearMonth: ym,
      rows,
      totalNetPay: rows.reduce((s, r) => s + r.netPay, 0),
    });
  });

  // ==================== MASTER DATA & EXCEL IMPORT ====================
  router.get(
    '/master/operations',
    requireRoles('SHIFT_LEADER', 'QC', 'DIRECTOR', 'ADMIN'),
    (_req, res) => {
      res.json({ items: queryOperations(db) });
    }
  );

  router.post(
    '/master/operations',
    requireRoles('SHIFT_LEADER', 'DIRECTOR', 'ADMIN'),
    (req, res) => {
      const customer = canonicalizeCustomerName(req.body?.customer || 'Vico - Nội bộ / Khách lẻ').customer;
      const productName = normalizeVn(req.body?.productName || '');

      if (!productName) {
        res.status(400).json({ error: 'Vui lòng nhập Tên sản phẩm.' });
        return;
      }

      const rawLines: string = String(req.body?.rawLines || '').trim();
      const itemsToCreate: Array<{
        opName: string;
        stdSeconds: number;
        defaultMachine: string;
        toolCode: string;
        matName: string;
        cuttingRec: string;
      }> = [];

      if (rawLines) {
        for (const line of rawLines.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const parts = trimmed.split('|').map((s) => normalizeVn(s));
          itemsToCreate.push({
            opName: parts[0] || 'Gia công cơ khí',
            stdSeconds: Math.max(60, Number(parts[1]) || 1800),
            defaultMachine: normalizeVn(req.body?.defaultMachine || 'Máy Tiện CNC 1'),
            toolCode: normalizeVn(req.body?.toolCode || 'T01'),
            matName: normalizeVn(req.body?.matName || 'Thép cơ khí chế tạo'),
            cuttingRec: normalizeVn(req.body?.cuttingRec || 'Vc=100m/p | f=0.15mm/v'),
          });
        }
      } else {
        itemsToCreate.push({
          opName: normalizeVn(req.body?.opName || 'Gia công CNC'),
          stdSeconds: Math.max(60, Number(req.body?.stdSeconds) || 1800),
          defaultMachine: normalizeVn(req.body?.defaultMachine || 'Máy Tiện CNC 1'),
          toolCode: normalizeVn(req.body?.toolCode || 'T01'),
          matName: normalizeVn(req.body?.matName || 'Thép cơ khí chế tạo'),
          cuttingRec: normalizeVn(req.body?.cuttingRec || 'Vc=100m/p | f=0.15mm/v'),
        });
      }

      const createdIds: string[] = [];
      withTransaction(db, () => {
        const spId = ensureProductId(customer, productName, itemsToCreate[0]?.matName || '');
        for (const item of itemsToCreate) {
          const ncId = nextNcId();
          const mach = db
            .prepare('SELECT name, cost_per_hour FROM machines WHERE LOWER(name) = LOWER(?)')
            .get(item.defaultMachine) as { name: string; cost_per_hour: number } | undefined;
          const tool = db
            .prepare('SELECT code, name, cost_per_edge FROM cutting_tools WHERE code = ?')
            .get(item.toolCode) as { code: string; name: string; cost_per_edge: number } | undefined;

          const stdLaborCost = Math.round(item.stdSeconds * 13.89);
          const stdMachCost = Math.round((item.stdSeconds / 3600) * Number(mach?.cost_per_hour || 350000));
          const costPerEdge = Number(tool?.cost_per_edge || 25000);
          const stdEdges = Number(((item.stdSeconds / 1800) * 1.0).toFixed(2));
          const stdToolCost = Math.round(stdEdges * costPerEdge);

          db.prepare(
            `INSERT INTO operations (
              nc_id, sp_id, customer, product_name, op_name, std_seconds, stage, step_order, is_final_op,
              default_machine, mat_name, cutting_rec, tool_code, tool_name, cost_per_edge,
              std_edges_per_pcs, std_labor_cost, std_mach_cost, std_tool_cost, is_critical_check
            ) VALUES (?, ?, ?, ?, ?, ?, 'End', 999, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
          ).run(
            ncId,
            spId,
            customer,
            productName,
            item.opName,
            item.stdSeconds,
            mach?.name || item.defaultMachine,
            item.matName,
            item.cuttingRec,
            tool?.code || item.toolCode,
            tool?.name || '',
            costPerEdge,
            stdEdges,
            stdLaborCost,
            stdMachCost,
            stdToolCost
          );
          createdIds.push(ncId);
        }
        recomputeProductStepOrders(spId);
      });

      res.status(201).json({ success: true, createdIds, items: queryOperations(db) });
    }
  );

  router.patch(
    '/master/operations/:ncId',
    requireRoles('SHIFT_LEADER', 'DIRECTOR', 'ADMIN'),
    (req, res) => {
      const ncId = normalizeVn(req.params.ncId);
      const op = db.prepare('SELECT * FROM operations WHERE nc_id = ?').get(ncId) as
        | Record<string, any>
        | undefined;
      if (!op) {
        res.status(404).json({ error: `Không tìm thấy ${ncId}` });
        return;
      }

      const opName = req.body?.opName !== undefined ? normalizeVn(req.body.opName) : String(op.op_name);
      const stdSeconds =
        req.body?.stdSeconds !== undefined
          ? Math.max(10, Math.round(Number(req.body.stdSeconds)))
          : Number(op.std_seconds);
      const defaultMachine =
        req.body?.defaultMachine !== undefined
          ? normalizeVn(req.body.defaultMachine)
          : String(op.default_machine);
      const cuttingRec =
        req.body?.cuttingRec !== undefined ? normalizeVn(req.body.cuttingRec) : String(op.cutting_rec);
      const isCriticalCheck =
        req.body?.isCriticalCheck !== undefined
          ? req.body.isCriticalCheck
            ? 1
            : 0
          : Number(op.is_critical_check);

      const mach = db
        .prepare('SELECT cost_per_hour FROM machines WHERE LOWER(name) = LOWER(?)')
        .get(defaultMachine) as { cost_per_hour: number } | undefined;
      const tool = op.tool_code
        ? (db
            .prepare('SELECT cost_per_edge FROM cutting_tools WHERE code = ?')
            .get(String(op.tool_code)) as { cost_per_edge: number } | undefined)
        : undefined;

      const prevStdSec = Number(op.std_seconds || 0);
      const prevStdEdges = Number(op.std_edges_per_pcs || 0);
      const stdEdgesPerPcs =
        prevStdSec > 0 && prevStdEdges > 0
          ? Number(((stdSeconds / prevStdSec) * prevStdEdges).toFixed(2))
          : Number(((stdSeconds / 1800) * 1.0).toFixed(2));
      const costPerEdge = Number(tool?.cost_per_edge ?? op.cost_per_edge ?? 25000);
      const stdToolCost = Math.round(stdEdgesPerPcs * costPerEdge);

      const stdLaborCost = Math.round(stdSeconds * 13.89);
      const stdMachCost = Math.round(
        (stdSeconds / 3600) * Number(mach?.cost_per_hour || 350000)
      );

      const drawingUrl =
        req.body?.drawingUrl !== undefined
          ? String(req.body.drawingUrl || '').trim()
          : String(op.drawing_url || '');
      const setupDocUrl =
        req.body?.setupDocUrl !== undefined
          ? String(req.body.setupDocUrl || '').trim()
          : String(op.setup_doc_url || '');

      db.prepare(
        `UPDATE operations
         SET op_name = ?, std_seconds = ?, default_machine = ?, cutting_rec = ?,
             std_edges_per_pcs = ?, std_labor_cost = ?, std_mach_cost = ?, std_tool_cost = ?, is_critical_check = ?,
             drawing_url = ?, setup_doc_url = ?
         WHERE nc_id = ?`
      ).run(
        opName,
        stdSeconds,
        defaultMachine,
        cuttingRec,
        stdEdgesPerPcs,
        stdLaborCost,
        stdMachCost,
        stdToolCost,
        isCriticalCheck,
        drawingUrl,
        setupDocUrl,
        ncId
      );

      res.json({
        success: true,
        item: queryOperations(db).find((o) => o.ncId === ncId),
      });
    }
  );

  router.delete('/master/operations/:ncId', requireRoles('DIRECTOR', 'ADMIN'), (req, res) => {
    const ncId = normalizeVn(req.params.ncId);
    const op = db.prepare('SELECT sp_id FROM operations WHERE nc_id = ?').get(ncId) as
      | { sp_id: string }
      | undefined;
    if (!op) {
      res.status(404).json({ error: `Không tìm thấy ${ncId}` });
      return;
    }

    withTransaction(db, () => {
      db.prepare('DELETE FROM operations WHERE nc_id = ?').run(ncId);
      recomputeProductStepOrders(String(op.sp_id));
    });

    res.json({ success: true });
  });

  // Safe Excel (.xlsx) importer powered by exceljs
  router.post(
    '/master/operations/import-xlsx',
    requireRoles('SHIFT_LEADER', 'DIRECTOR', 'ADMIN'),
    async (req, res) => {
      try {
        interface ParsedImportRow {
          customer: string;
          productName: string;
          opName: string;
          stdSeconds: number;
          defaultMachine: string;
          toolCode: string;
        }

        const parsedRows: ParsedImportRow[] = [];

        if (Array.isArray(req.body?.excelRows)) {
          for (const r of req.body.excelRows) {
            const pName = normalizeVn(r.productName || r.TenSanPham || '');
            if (!pName) continue;
            parsedRows.push({
              customer: normalizeVn(r.customer || r.KhachHang || 'Vico - Nội bộ / Khách lẻ'),
              productName: pName,
              opName: normalizeVn(r.opName || r.TenNguyenCong || 'Gia công'),
              stdSeconds: Math.max(60, Number(r.stdSeconds || r.DinhMucGiay || 1800)),
              defaultMachine: normalizeVn(r.machine || r.defaultMachine || r.MayMacDinh || 'Máy Tiện CNC 1'),
              toolCode: normalizeVn(r.toolCode || r.MaDaoCu || 'T01'),
            });
          }
        } else if (req.body?.xlsxBase64) {
          const cleanB64 = String(req.body.xlsxBase64).replace(/^data:.*?;base64,/, '');
          const wb = new ExcelJS.Workbook();
          await wb.xlsx.load(Buffer.from(cleanB64, 'base64') as any);
          const ws = wb.worksheets[0];
          if (!ws) {
            res.status(400).json({ error: 'File Excel không có sheet dữ liệu.' });
            return;
          }

          const headers: string[] = [];
          ws.getRow(1).eachCell((cell, colNumber) => {
            headers[colNumber] = normalizeVn(String(cell.value ?? ''));
          });

          ws.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return;
            const obj: Record<string, string> = {};
            row.eachCell((cell, colNumber) => {
              const key = headers[colNumber] || `col_${colNumber}`;
              obj[key] = normalizeVn(String(cell.value ?? ''));
            });

            const productName =
              obj.TenSanPham || obj['Tên Sản Phẩm'] || obj.Product || obj.col_2 || '';
            if (!productName) return;

            parsedRows.push({
              customer:
                obj.KhachHang || obj['Khách hàng'] || obj.Customer || obj.col_1 || 'Vico - Nội bộ / Khách lẻ',
              productName,
              opName:
                obj.TenNguyenCong || obj['Tên Nguyên Công'] || obj.Operation || obj.col_3 || 'Gia công',
              stdSeconds: Math.max(
                60,
                Number(obj.DinhMucGiay || obj['Định mức giây (s)'] || obj.Seconds || obj.col_4 || 1800)
              ),
              defaultMachine:
                obj.MayMacDinh || obj['Máy mặc định'] || obj.col_6 || 'Máy Tiện CNC 1',
              toolCode: obj.MaDaoCu || obj['Mã Dao'] || obj.col_7 || 'T01',
            });
          });
        }

        if (parsedRows.length === 0) {
          res.status(400).json({ error: 'Không tìm thấy dòng nguyên công hợp lệ trong file Excel.' });
          return;
        }

        const touchedSpIds = new Set<string>();
        withTransaction(db, () => {
          for (const r of parsedRows) {
            const cust = canonicalizeCustomerName(r.customer).customer;
            const spId = ensureProductId(cust, r.productName, 'Thép cơ khí chế tạo');
            touchedSpIds.add(spId);

            const ncId = nextNcId();
            const mach = db
              .prepare('SELECT name, cost_per_hour FROM machines WHERE LOWER(name) = LOWER(?)')
              .get(r.defaultMachine) as { name: string; cost_per_hour: number } | undefined;
            const tool = db
              .prepare('SELECT code, name, cost_per_edge FROM cutting_tools WHERE code = ?')
              .get(r.toolCode) as { code: string; name: string; cost_per_edge: number } | undefined;

            const stdLaborCost = Math.round(r.stdSeconds * 13.89);
            const stdMachCost = Math.round(
              (r.stdSeconds / 3600) * Number(mach?.cost_per_hour || 350000)
            );
            const costPerEdge = Number(tool?.cost_per_edge || 25000);
            const stdEdges = Number(((r.stdSeconds / 1800) * 1.0).toFixed(2));
            const stdToolCost = Math.round(stdEdges * costPerEdge);

            db.prepare(
              `INSERT INTO operations (
                nc_id, sp_id, customer, product_name, op_name, std_seconds, stage, step_order, is_final_op,
                default_machine, mat_name, cutting_rec, tool_code, tool_name, cost_per_edge,
                std_edges_per_pcs, std_labor_cost, std_mach_cost, std_tool_cost, is_critical_check
              ) VALUES (?, ?, ?, ?, ?, ?, 'End', 999, 1, ?, 'Thép cơ khí chế tạo', 'Vc=100m/p', ?, ?, ?, ?, ?, ?, ?, 0)`
            ).run(
              ncId,
              spId,
              cust,
              r.productName,
              r.opName,
              r.stdSeconds,
              mach?.name || r.defaultMachine,
              tool?.code || r.toolCode,
              tool?.name || '',
              costPerEdge,
              stdEdges,
              stdLaborCost,
              stdMachCost,
              stdToolCost
            );
          }

          for (const spId of touchedSpIds) {
            recomputeProductStepOrders(spId);
          }
        });

        res.status(201).json({
          success: true,
          importedCount: parsedRows.length,
          message: `Đã nạp thành công ${parsedRows.length} nguyên công từ Excel (.xlsx).`,
        });
      } catch (err: any) {
        res.status(400).json({ error: `Lỗi đọc file Excel: ${String(err?.message || err)}` });
      }
    }
  );

  router.post('/master/machines', requireRoles('DIRECTOR', 'ADMIN'), (req, res) => {
    const name = normalizeVn(req.body?.name || '');
    const group = normalizeVn(req.body?.group || 'Gia công CNC');
    const costPerHour = Math.max(50000, Number(req.body?.costPerHour) || 250000);

    if (!name) {
      res.status(400).json({ error: 'Vui lòng nhập tên máy.' });
      return;
    }

    const cnt = (db.prepare('SELECT COUNT(*) AS c FROM machines').get() as { c: number }).c;
    const id = normalizeVn(req.body?.id || `M${String(Number(cnt) + 1).padStart(2, '0')}`);

    db.prepare(
      `INSERT INTO machines (id, name, group_name, cost_per_hour, status) VALUES (?, ?, ?, ?, 'IDLE')`
    ).run(id, name, group, costPerHour);

    res.status(201).json({ success: true, items: queryMachines(db) });
  });

  router.patch('/master/machines/:id', requireRoles('SHIFT_LEADER', 'DIRECTOR', 'ADMIN'), (req, res) => {
    const id = normalizeVn(req.params.id);
    const m = db.prepare('SELECT * FROM machines WHERE id = ?').get(id) as
      | Record<string, any>
      | undefined;
    if (!m) {
      res.status(404).json({ error: `Không tìm thấy máy ${id}` });
      return;
    }

    const status = req.body?.status !== undefined ? normalizeVn(req.body.status) : String(m.status);
    const costPerHour =
      req.body?.costPerHour !== undefined ? Number(req.body.costPerHour) : Number(m.cost_per_hour);
    const stopReason =
      req.body?.stopReason !== undefined
        ? normalizeVn(req.body.stopReason) || null
        : m.stop_reason;

    db.prepare(
      `UPDATE machines SET status = ?, cost_per_hour = ?, stop_reason = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(status, costPerHour, stopReason, id);

    res.json({ success: true, items: queryMachines(db) });
  });

  router.post('/master/workers', requireRoles('ADMIN'), (req, res) => {
    const id = normalizeVn(req.body?.id || req.body?.empIdOrUser || '');
    const name = normalizeVn(req.body?.name || req.body?.fullName || '');
    const role = normalizeVn(req.body?.role || 'CN');
    const title = normalizeVn(
      req.body?.title ||
        (role === 'QĐ' ? 'Quản đốc' : role === 'TC' ? 'Trưởng ca' : role === 'KT' ? 'Kỹ thuật / QC' : 'Công nhân')
    );
    const salaryMode = normalizeVn(req.body?.salaryMode || 'Khoán 1 + 0.33 máy');
    const baseSalary = Math.max(100000, Number(req.body?.baseSalary) || 385000);
    const costPerSec = Number((baseSalary / 28800).toFixed(2));
    const rawChat = normalizeVn(req.body?.chatId || '');
    const validChat = rawChat && !rawChat.startsWith('CHAT_ID_') ? rawChat : null;
    const rawPin = normalizeVn(req.body?.pin || '');

    if (!id || !name) {
      res.status(400).json({ error: 'Vui lòng nhập Mã nhân viên và Họ tên.' });
      return;
    }

    const existing = db.prepare('SELECT id, pin_hash FROM workers WHERE id = ?').get(id) as
      | { id: string; pin_hash: string }
      | undefined;

    if (existing) {
      const nextPinHash = rawPin ? hashPin(rawPin) : existing.pin_hash;
      db.prepare(
        `UPDATE workers
         SET name = ?, role = ?, title = ?, salary_mode = ?, base_salary = ?, cost_per_sec = ?,
             pin_hash = ?, chat_id = ?, is_linked = ?
         WHERE id = ?`
      ).run(name, role, title, salaryMode, baseSalary, costPerSec, nextPinHash, validChat, validChat ? 1 : 0, id);
    } else {
      db.prepare(
        `INSERT INTO workers (
          id, name, username, role, title, salary_mode, base_salary, cost_per_sec, pin_hash, chat_id, is_linked, is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
      ).run(
        id,
        name,
        normalizeVn(req.body?.username || id.toLowerCase()),
        role,
        title,
        salaryMode,
        baseSalary,
        costPerSec,
        hashPin(rawPin || '1234'),
        validChat,
        validChat ? 1 : 0
      );
    }

    res.status(existing ? 200 : 201).json({
      success: true,
      workers: queryWorkersForViewer(db, req.authUser!.workerId, 'ADMIN', true),
    });
  });

  router.post('/master/workers/:id/reset-pin', requireRoles('ADMIN'), (req, res) => {
    const id = normalizeVn(req.params.id);
    const pin = String(req.body?.pin || '1234').trim();
    if (!pin) {
      res.status(400).json({ error: 'Mã PIN không được để trống.' });
      return;
    }
    const worker = db.prepare('SELECT id FROM workers WHERE id = ?').get(id);
    if (!worker) {
      res.status(404).json({ error: `Không tìm thấy nhân sự ${id}.` });
      return;
    }
    db.prepare('UPDATE workers SET pin_hash = ? WHERE id = ?').run(hashPin(pin), id);
    res.json({
      success: true,
      message: `Đã đặt lại mã PIN cho nhân sự ${id} về "${pin}".`,
      workers: queryWorkersForViewer(db, req.authUser!.workerId, 'ADMIN', true),
    });
  });

  router.post('/master/workers/:id/toggle-active', requireRoles('ADMIN'), (req, res) => {
    const id = normalizeVn(req.params.id);
    if (id === 'NV00053') {
      res.status(400).json({ error: 'Không thể khóa tài khoản Quản trị viên tối cao NV00053.' });
      return;
    }
    const row = db.prepare('SELECT id, is_active FROM workers WHERE id = ?').get(id) as
      | { id: string; is_active: number }
      | undefined;
    if (!row) {
      res.status(404).json({ error: `Không tìm thấy nhân sự ${id}.` });
      return;
    }
    const nextActive = row.is_active === 1 ? 0 : 1;
    db.prepare('UPDATE workers SET is_active = ? WHERE id = ?').run(nextActive, id);
    res.json({
      success: true,
      isActive: nextActive,
      message: nextActive === 1 ? `Đã mở khóa tài khoản ${id}.` : `Đã tạm khóa tài khoản ${id}.`,
      workers: queryWorkersForViewer(db, req.authUser!.workerId, 'ADMIN', true),
    });
  });

  router.delete('/master/workers/:id', requireRoles('ADMIN'), (req, res) => {
    const id = normalizeVn(req.params.id);
    if (id === 'NV00053') {
      res.status(400).json({ error: 'Không thể xóa tài khoản Quản trị viên gốc NV00053.' });
      return;
    }
    const row = db.prepare('SELECT id FROM workers WHERE id = ?').get(id);
    if (!row) {
      res.status(404).json({ error: `Không tìm thấy nhân sự ${id}.` });
      return;
    }
    const logsCount = (db.prepare('SELECT COUNT(*) as c FROM production_logs WHERE worker_id = ?').get(id) as any)?.c || 0;
    if (logsCount > 0) {
      // Có dữ liệu nhật ký ca -> Chuyển sang trạng thái khóa để bảo toàn lịch sử truy xuất
      db.prepare('UPDATE workers SET is_active = 0 WHERE id = ?').run(id);
      res.json({
        success: true,
        message: `Nhân sự có ${logsCount} bản ghi nhật ký — Đã chuyển sang trạng thái Tạm Khóa để bảo toàn lịch sử sản xuất.`,
        workers: queryWorkersForViewer(db, req.authUser!.workerId, 'ADMIN', true),
      });
    } else {
      db.prepare('DELETE FROM workers WHERE id = ?').run(id);
      res.json({
        success: true,
        message: `Đã xóa tài khoản nhân sự ${id} thành công.`,
        workers: queryWorkersForViewer(db, req.authUser!.workerId, 'ADMIN', true),
      });
    }
  });

  router.post('/admin/reset-production-data', requireRoles('ADMIN'), (_req, res) => {
    db.exec('DELETE FROM production_logs;');
    db.exec('DELETE FROM qc_inspections;');
    db.exec('DELETE FROM delivery_logs;');
    db.exec('DELETE FROM tool_swaps;');
    db.exec('DELETE FROM sync_outbox;');
    db.exec('DELETE FROM handover_slips;');
    db.exec("UPDATE purchase_orders SET finished_qty = 0, status = 'PENDING';");
    db.exec("UPDATE machines SET status = 'IDLE', current_worker_name = NULL, current_po_id = NULL, current_nc_id = NULL, stop_reason = NULL;");
    res.json({
      success: true,
      message: 'Đã xóa sạch dữ liệu nhật ký sản xuất về mới tinh cho Tháng 11.',
    });
  });

  // ==================== SYSTEM CONFIG & OUTBOX SYNC ====================
  router.get('/config', requireRoles('ADMIN'), (_req, res) => {
    const cfg = getConfigMap(db);
    delete cfg.SESSION_HMAC_SECRET;
    res.json({ config: cfg });
  });

  router.put('/config', requireRoles('ADMIN'), (req, res) => {
    const allowedKeys = [
      'AUTH_MODE',
      'TELEGRAM_BOT_TOKEN',
      'TELEGRAM_BOT_USERNAME',
      'MANAGER_CHAT_ID',
      'WEB_APP_URL',
      'GAS_SYNC_ENABLED',
      'SECONDS_PER_SHIFT',
      'SECOND_MACHINE_RATE',
      'MEAL_SHIFT_2_3',
      'MEAL_OT_2H',
      'MEAL_SUNDAY',
      'KPI_WARNING_THRESHOLD',
    ];

    const upsert = db.prepare(
      `INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES (?, ?, datetime('now'))`
    );

    withTransaction(db, () => {
      for (const k of allowedKeys) {
        if (req.body?.[k] !== undefined) {
          upsert.run(k, normalizeVn(String(req.body[k])));
        }
      }
    });

    const cfg = getConfigMap(db);
    delete cfg.SESSION_HMAC_SECRET;
    res.json({ success: true, config: cfg });
  });

  router.get('/sync/outbox', requireRoles('ADMIN'), (_req, res) => {
    res.json({ items: listOutboxItems(db, 60) });
  });

  router.post('/sync/flush', requireRoles('ADMIN'), async (_req, res) => {
    const result = await flushPendingOutbox(db, 30);
    res.json({ success: true, ...result, items: listOutboxItems(db, 60) });
  });

  // ==================== DAILY DISPATCH SCHEDULE (FORM VICO GCCK.QT.01.BM01) ====================
  router.get('/schedules/daily-dates', (req, res) => {
    const rows = db
      .prepare(
        `SELECT work_date, COUNT(*) as row_count, COUNT(DISTINCT worker_name) as worker_count
         FROM daily_schedule_rows
         GROUP BY work_date
         ORDER BY work_date DESC`
      )
      .all() as Array<{ work_date: string; row_count: number; worker_count: number }>;
    res.json({
      success: true,
      dates: rows.map((r) => ({
        workDate: String(r.work_date),
        rowCount: Number(r.row_count || 0),
        workerCount: Number(r.worker_count || 0),
      })),
    });
  });

  router.post('/schedules/daily/copy', requireRoles('DIRECTOR', 'ADMIN', 'SHIFT_LEADER'), (req, res) => {
    const sourceDate = String(req.body?.sourceDate || '').trim();
    const targetDate = String(req.body?.targetDate || '').trim();
    const resetQty = Boolean(req.body?.resetQty);

    if (!sourceDate || !targetDate) {
      res.status(400).json({ error: 'Vui lòng cung cấp ngày nguồn và ngày đích.' });
      return;
    }

    const existingRows = db
      .prepare('SELECT * FROM daily_schedule_rows WHERE work_date = ? ORDER BY shift_type ASC, stt ASC, id ASC')
      .all(sourceDate) as Array<Record<string, any>>;

    if (existingRows.length === 0) {
      res.status(404).json({ error: `Không tìm thấy kế hoạch ngày nguồn: ${sourceDate}` });
      return;
    }

    withTransaction(db, () => {
      db.prepare('DELETE FROM daily_schedule_rows WHERE work_date = ?').run(targetDate);
      const ins = db.prepare(`
        INSERT INTO daily_schedule_rows (
          work_date, shift_type, stt, worker_name, customer, sp_id, product_name, nc_id, op_name,
          planned_qty, machine_name, note, actual_qty, drawing_url, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (let idx = 0; idx < existingRows.length; idx++) {
        const r = existingRows[idx];
        ins.run(
          targetDate,
          String(r.shift_type || 'Ca 2'),
          Number(r.stt || idx + 1),
          String(r.worker_name || ''),
          String(r.customer || ''),
          String(r.sp_id || ''),
          String(r.product_name || ''),
          String(r.nc_id || ''),
          String(r.op_name || ''),
          resetQty ? 0 : Number(r.planned_qty || 0),
          String(r.machine_name || ''),
          String(r.note || ''),
          0,
          String(r.drawing_url || ''),
          'PLANNED'
        );
      }
    });

    res.json({ success: true, targetDate, rowCount: existingRows.length });
  });

  router.delete('/schedules/daily', requireRoles('DIRECTOR', 'ADMIN', 'SHIFT_LEADER'), (req, res) => {
    const workDate = String(req.query.date || '').trim();
    if (!workDate) {
      res.status(400).json({ error: 'Thiếu ngày cần xóa.' });
      return;
    }
    db.prepare('DELETE FROM daily_schedule_rows WHERE work_date = ?').run(workDate);
    res.json({ success: true, workDate });
  });

  router.get('/schedules/daily', (req, res) => {
    const workDate = String(req.query.date || '2026-10-21');
    const shiftType = req.query.shift ? String(req.query.shift) : undefined;

    let querySql = `
      SELECT id, work_date, shift_type, stt, worker_name, customer, sp_id, product_name, nc_id, op_name,
             planned_qty, machine_name, note, actual_qty, drawing_url, status
      FROM daily_schedule_rows
      WHERE work_date = ?
    `;
    const params: any[] = [workDate];

    if (shiftType) {
      querySql += ` AND shift_type = ?`;
      params.push(shiftType);
    }
    querySql += ` ORDER BY shift_type ASC, stt ASC, id ASC`;

    const rows = db.prepare(querySql).all(...params) as Array<Record<string, any>>;

    res.json({
      success: true,
      workDate,
      rows: rows.map((r) => ({
        id: Number(r.id),
        workDate: String(r.work_date),
        shiftType: String(r.shift_type),
        stt: Number(r.stt),
        workerName: String(r.worker_name),
        customer: String(r.customer || ''),
        spId: String(r.sp_id || ''),
        productName: String(r.product_name || ''),
        ncId: String(r.nc_id || ''),
        opName: String(r.op_name || ''),
        plannedQty: Number(r.planned_qty || 0),
        machineName: String(r.machine_name || ''),
        note: String(r.note || ''),
        actualQty: Number(r.actual_qty || 0),
        drawingUrl: String(r.drawing_url || ''),
        status: String(r.status || 'PLANNED'),
      })),
    });
  });

  router.post('/schedules/daily', requireRoles('DIRECTOR', 'ADMIN', 'SHIFT_LEADER'), (req, res) => {
    const workDate = String(req.body.workDate || req.body.date || '2026-10-21');
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];

    withTransaction(db, () => {
      db.prepare('DELETE FROM daily_schedule_rows WHERE work_date = ?').run(workDate);

      const ins = db.prepare(`
        INSERT INTO daily_schedule_rows (
          work_date, shift_type, stt, worker_name, customer, sp_id, product_name, nc_id, op_name,
          planned_qty, machine_name, note, actual_qty, drawing_url, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (let idx = 0; idx < rows.length; idx++) {
        const r = rows[idx];
        ins.run(
          workDate,
          String(r.shiftType || 'Ca 2'),
          Number(r.stt || idx + 1),
          String(r.workerName || '').trim(),
          String(r.customer || '').trim(),
          String(r.spId || '').trim(),
          String(r.productName || '').trim(),
          String(r.ncId || '').trim(),
          String(r.opName || '').trim(),
          Number(r.plannedQty || 0),
          String(r.machineName || '').trim(),
          String(r.note || '').trim(),
          Number(r.actualQty || 0),
          String(r.drawingUrl || '').trim(),
          String(r.status || 'PLANNED')
        );
      }
    });

    res.json({ success: true, count: rows.length, workDate });
  });

  // ==================== WEEKLY PRODUCTION REPORT & CAPACITY FORECAST (THU -> WED) ====================
  router.get('/reports/weekly', (req, res) => {
    const weekStart = String(req.query.weekStart || '2026-10-15');
    const startDt = new Date(weekStart);
    const endDt = new Date(startDt.getTime() + 6 * 24 * 3600 * 1000);
    const weekEnd = endDt.toISOString().slice(0, 10);

    const weekLabel = `Tuần làm việc (${weekStart.slice(8, 10)}/${weekStart.slice(5, 7)} - ${weekEnd.slice(8, 10)}/${weekEnd.slice(5, 7)}/${weekEnd.slice(0, 4)})`;

    const logRows = db.prepare(`
      SELECT l.*, o.customer, o.product_name, o.std_seconds, o.default_machine
      FROM production_logs l
      LEFT JOIN operations o ON o.nc_id = l.nc_id
      WHERE l.work_date >= ? AND l.work_date <= ? AND l.is_voided = 0
    `).all(weekStart, weekEnd) as Array<Record<string, any>>;

    const schedRows = db.prepare(`
      SELECT * FROM daily_schedule_rows
      WHERE work_date >= ? AND work_date <= ?
    `).all(weekStart, weekEnd) as Array<Record<string, any>>;

    const totalPlannedQty = schedRows.reduce((sum, r) => sum + Number(r.planned_qty || 0), 0);
    const totalActualQty = logRows.reduce((sum, r) => sum + Number(r.ok_qty || 0), 0);
    const completionPct = totalPlannedQty > 0 ? Math.round((totalActualQty / totalPlannedQty) * 100) : 100;

    const custMap = new Map<string, { productCount: number; plannedQty: number; actualQty: number; poCount: number; products: Set<string> }>();
    for (const s of schedRows) {
      const c = String(s.customer || 'Khác');
      const item = custMap.get(c) || { productCount: 0, plannedQty: 0, actualQty: 0, poCount: 0, products: new Set() };
      item.plannedQty += Number(s.planned_qty || 0);
      if (s.product_name) item.products.add(String(s.product_name));
      custMap.set(c, item);
    }
    for (const l of logRows) {
      const c = String(l.customer || 'Khác');
      const item = custMap.get(c) || { productCount: 0, plannedQty: 0, actualQty: 0, poCount: 0, products: new Set() };
      item.actualQty += Number(l.ok_qty || 0);
      if (l.product_name) item.products.add(String(l.product_name));
      custMap.set(c, item);
    }
    const customerStats = Array.from(custMap.entries()).map(([customer, data]) => ({
      customer,
      productCount: data.products.size || 1,
      plannedQty: data.plannedQty,
      actualQty: data.actualQty,
      completionPct: data.plannedQty > 0 ? Math.round((data.actualQty / data.plannedQty) * 100) : 100,
      poCount: data.poCount,
    }));

    const allPos = queryPurchaseOrders(db);
    const activePos = allPos.filter((p) => p.status !== '✅ Đã hoàn thành' && p.status !== 'COMPLETED');
    const delayedPos = allPos.filter((p) => p.dueDate && p.dueDate <= weekEnd && p.remainQty > 0);
    const completedPos = allPos.filter((p) => p.finishedQty >= p.qtyPo);

    const poStatuses = allPos.slice(0, 15).map((p) => ({
      poId: p.poId,
      customer: p.customer,
      productName: p.productName,
      qtyPo: p.qtyPo,
      finishedQty: p.finishedQty,
      wipQty: p.wipQty,
      dueDate: p.dueDate,
      status: p.status,
      isDelayed: Boolean(p.dueDate && p.dueDate <= weekEnd && p.remainQty > 0),
    }));

    const logsByWorker = new Map<string, Array<Record<string, any>>>();
    for (const l of logRows) {
      const name = String(l.worker_name);
      const list = logsByWorker.get(name) || [];
      list.push(l);
      logsByWorker.set(name, list);
    }

    // Build the 7 calendar dates in this week
    const weekDates: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(startDt.getTime() + i * 24 * 3600 * 1000);
      weekDates.push(d.toISOString().slice(0, 10));
    }

    // Load monthly attendance sheets for months in this week
    const monthAttMap = new Map<string, AttendanceRow[]>();
    for (const dStr of weekDates) {
      const ym = dStr.slice(0, 7);
      if (!monthAttMap.has(ym)) {
        monthAttMap.set(ym, ensureMonthAttendanceRows(ym));
      }
    }

    const startYm = weekStart.slice(0, 7);
    const attList = monthAttMap.get(startYm) || ensureMonthAttendanceRows(startYm);

    // Filter only production workers / shopfloor employees (work_type = 'Công' or matching active workers)
    const activeStaff = attList.filter((e) => e.workType === 'Công' || e.empId.startsWith('NV00'));

    const workerLaborStats = activeStaff.map((emp) => {
      let standardShifts = 0;
      let otHours = 0;
      let sundayHours = 0;
      let offDays = 0;
      let pDays = 0;

      for (const dStr of weekDates) {
        const ym = dStr.slice(0, 7);
        const dayNum = Number(dStr.slice(8, 10));
        const dayIdx = dayNum - 1;
        const isSun = isVietnamSunday(dStr);

        const currentMonthRows = monthAttMap.get(ym) || [];
        const empInMonth = currentMonthRows.find((e) => e.empId === emp.empId) || emp;
        const code = empInMonth.days ? empInMonth.days[dayIdx] || '' : '';
        const parsed = parseAttendanceCell(code, empInMonth.defaultShift, DEFAULT_MEAL_CONFIG, isSun);

        standardShifts += parsed.regDays;
        otHours += parsed.ot15;
        sundayHours += parsed.ot20;
        offDays += parsed.offDays;
        pDays += parsed.pDays;
      }

      const wLogs = logsByWorker.get(emp.name) || [];
      const actualCompletedPieces = wLogs.reduce((sum, l) => sum + Number(l.ok_qty || 0), 0);
      const totalConvertedShifts =
        Math.round((standardShifts + (otHours / 8) * 1.5 + (sundayHours / 8) * 2.0) * 10) / 10;

      return {
        workerId: emp.empId,
        workerName: emp.name,
        standardShifts: Math.round(standardShifts * 10) / 10,
        otHours: Math.round(otHours * 10) / 10,
        sundayHours: Math.round(sundayHours * 10) / 10,
        offDays: Math.round(offDays * 10) / 10,
        pDays: Math.round(pDays * 10) / 10,
        totalConvertedShifts,
        actualCompletedPieces,
      };
    });

    const stoppageLogs = logRows.filter((l) => Number(l.stop_minutes || 0) > 0);
    const downtimeIncidents = stoppageLogs.map((l) => ({
      id: String(l.id),
      machineName: String(l.machine_name),
      stopMinutes: Number(l.stop_minutes),
      reason: String(l.stop_reason || 'Dừng kỹ thuật / Chờ phôi'),
      date: String(l.work_date),
      workerName: String(l.worker_name || ''),
    }));

    const customNotesRows = db.prepare(`SELECT * FROM weekly_downtime_notes WHERE week_start = ?`).all(weekStart) as Array<Record<string, any>>;
    const customIncidentNotes = customNotesRows.map((r) => `${r.machine_name ? `[${r.machine_name}] ` : ''}${r.reason || ''} ${r.note || ''}`.trim());

    const nextStart = new Date(endDt.getTime() + 24 * 3600 * 1000).toISOString().slice(0, 10);
    const nextEnd = new Date(endDt.getTime() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);

    const dueNextWeekPos = allPos.filter((p) => p.remainQty > 0 && p.dueDate >= nextStart && p.dueDate <= nextEnd);
    const carryoverBacklog = allPos.filter((p) => p.remainQty > 0 && (!p.dueDate || p.dueDate < nextStart));

    const carryoverBacklogQty = carryoverBacklog.reduce((sum, p) => sum + p.remainQty, 0);
    const carryoverHours = Math.round(carryoverBacklogQty * 0.75 * 10) / 10;

    let totalRequiredHours = carryoverHours;
    const duePosFormatted = dueNextWeekPos.map((p) => {
      const estHours = Math.round(p.remainQty * 0.8 * 10) / 10;
      totalRequiredHours += estHours;
      return {
        poId: p.poId,
        customer: p.customer,
        productName: p.productName,
        remainQty: p.remainQty,
        dueDate: p.dueDate,
        requiredHours: estHours,
        defaultMachine: p.productName.toLowerCase().includes('tiện') ? 'Máy tiện T630' : 'Máy phay CNC',
      };
    });

    const machines = queryMachines(db);
    const machineCapacityHours = machines.length * 48;
    const overloadCapacityHours = Math.max(0, totalRequiredHours - machineCapacityHours);
    const isOverloaded = totalRequiredHours > machineCapacityHours || carryoverBacklogQty > 80;

    const outsourceRecommendations: Array<{
      poId: string;
      customer: string;
      productName: string;
      suggestedOutsourceQty: number;
      reason: string;
      estimatedOutsourceCost: number;
    }> = [];

    if (isOverloaded || carryoverBacklog.length > 0) {
      for (const b of carryoverBacklog.slice(0, 4)) {
        const outsourceQty = Math.ceil(b.remainQty * 0.5);
        outsourceRecommendations.push({
          poId: b.poId,
          customer: b.customer,
          productName: b.productName,
          suggestedOutsourceQty: outsourceQty,
          reason: `Vượt khung tải máy xưởng: Bù số thiếu đọng tuần trước (${b.remainQty} SP), đề xuất chuyển gia công phay/nhiệt luyện ngoài`,
          estimatedOutsourceCost: outsourceQty * 120000,
        });
      }
    }

    const proposalsRows = db
      .prepare(`SELECT * FROM weekly_proposals WHERE week_start = ? ORDER BY id DESC`)
      .all(weekStart) as Array<Record<string, any>>;

    const proposals = proposalsRows.map((r) => ({
      id: Number(r.id),
      weekStart: String(r.week_start),
      category: String(r.category || 'Vật tư / Dụng cụ'),
      proposer: String(r.proposer || ''),
      content: String(r.content || ''),
      priority: String(r.priority || 'Bình thường'),
      status: String(r.status || 'PENDING'),
      createdAt: String(r.created_at || ''),
    }));

    res.json({
      weekStart,
      weekEnd,
      weekLabel,
      summary: {
        totalPlannedQty,
        totalActualQty,
        completionPct,
        totalPoActive: activePos.length,
        completedPoCount: completedPos.length,
        delayedPoCount: delayedPos.length,
      },
      customerStats,
      poStatuses,
      workerLaborStats,
      downtimeIncidents,
      customIncidentNotes,
      proposals,
      nextWeekForecast: {
        duePos: duePosFormatted,
        carryoverBacklogQty,
        carryoverHours,
        totalRequiredHours: Math.round(totalRequiredHours * 10) / 10,
        machineCapacityHours,
        overloadCapacityHours: Math.round(overloadCapacityHours * 10) / 10,
        isOverloaded,
        outsourceRecommendations,
      },
    });
  });

  router.post('/reports/weekly/incidents', requireRoles('DIRECTOR', 'ADMIN', 'SHIFT_LEADER'), (req, res) => {
    const weekStart = String(req.body.weekStart || '2026-10-15');
    const machineName = String(req.body.machineName || '').trim();
    const stopMinutes = Number(req.body.stopMinutes || 0);
    const reason = String(req.body.reason || '').trim();
    const note = String(req.body.note || '').trim();

    db.prepare(`
      INSERT INTO weekly_downtime_notes (week_start, machine_name, stop_minutes, reason, note)
      VALUES (?, ?, ?, ?, ?)
    `).run(weekStart, machineName, stopMinutes, reason, note);

    res.json({ success: true });
  });

  router.post('/reports/weekly/proposals', requireRoles('DIRECTOR', 'ADMIN', 'SHIFT_LEADER'), (req, res) => {
    const weekStart = String(req.body.weekStart || '2026-10-15');
    const category = String(req.body.category || 'Vật tư & Dụng cụ cắt').trim();
    const proposer = String(req.body.proposer || '').trim();
    const content = String(req.body.content || '').trim();
    const priority = String(req.body.priority || 'Bình thường').trim();

    if (!content) {
      res.status(400).json({ error: 'Nội dung đề xuất / kiến nghị không được để trống.' });
      return;
    }

    const r = db
      .prepare(`
        INSERT INTO weekly_proposals (week_start, category, proposer, content, priority, status)
        VALUES (?, ?, ?, ?, ?, 'PENDING')
      `)
      .run(weekStart, category, proposer, content, priority);

    res.json({ success: true, id: Number(r.lastInsertRowid) });
  });

  router.delete('/reports/weekly/proposals/:id', requireRoles('DIRECTOR', 'ADMIN', 'SHIFT_LEADER'), (req, res) => {
    const id = Number(req.params.id);
    db.prepare('DELETE FROM weekly_proposals WHERE id = ?').run(id);
    res.json({ success: true, id });
  });

  router.patch('/reports/weekly/proposals/:id', requireRoles('DIRECTOR', 'ADMIN', 'SHIFT_LEADER'), (req, res) => {
    const id = Number(req.params.id);
    const status = String(req.body.status || 'APPROVED');
    db.prepare('UPDATE weekly_proposals SET status = ? WHERE id = ?').run(status, id);
    res.json({ success: true, id, status });
  });


  // ==================== SỔ CHUYỂN GIAO CÔNG ĐOẠN GIA CÔNG (FORM BM.GC.01.02) ====================
  router.get('/handovers', requireRoles('SHIFT_LEADER', 'QC', 'DIRECTOR', 'ADMIN'), (req, res) => {
    const dateStr = req.query.date ? String(req.query.date) : undefined;
    const items = queryHandoverSlips(db, dateStr);
    res.json(items);
  });

  router.post('/handovers', requireRoles('SHIFT_LEADER', 'QC', 'DIRECTOR', 'ADMIN'), (req, res) => {
    const payload = req.body?.item || req.body;
    if (!payload.productName) {
      res.status(400).json({ error: 'Tên sản phẩm không được để trống.' });
      return;
    }
    const id = payload.id && !payload.id.startsWith('empty-')
      ? payload.id
      : `HO-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    const row = {
      id,
      handoverDate: String(payload.handoverDate || new Date().toISOString().slice(0, 10)),
      fromDept: payload.fromDept || 'PX_GIA_CONG',
      toDept: payload.toDept || 'PX_HOAN_THIEN',
      poId: payload.poId || undefined,
      spId: payload.spId || undefined,
      productName: String(payload.productName).trim(),
      customer: String(payload.customer || '').trim(),
      unit: String(payload.unit || 'Cái').trim(),
      prodQtyTransferred: Number(payload.prodQtyTransferred || 0),
      prodQtyDefect: Number(payload.prodQtyDefect || 0),
      prodQtyMissing: Number(payload.prodQtyMissing || 0),
      rawQtyTransferred: Number(payload.rawQtyTransferred || 0),
      rawQtyDefect: Number(payload.rawQtyDefect || 0),
      rawQtyMissing: Number(payload.rawQtyMissing || 0),
      note: String(payload.note || '').trim(),
      receiverName: String(payload.receiverName || '').trim(),
      senderName: String(payload.senderName || '').trim(),
      isConfirmed: Boolean(payload.isConfirmed),
      confirmedAt: payload.confirmedAt ? String(payload.confirmedAt) : undefined,
      createdAt: payload.createdAt || new Date().toISOString(),
    };

    insertHandoverSlip(db, row);
    res.status(201).json({ success: true, item: row });
  });

  router.post('/handovers/auto-generate', requireRoles('SHIFT_LEADER', 'DIRECTOR', 'ADMIN'), (req, res) => {
    const dateStr = String(req.body.date || new Date().toISOString().slice(0, 10));

    // 1. Get plan rows for that date
    const planRows = db.prepare(`
      SELECT product_name, customer,
             SUM(COALESCE(qty_ca1, 0) + COALESCE(qty_ca2, 0) + COALESCE(qty_ca3, 0) + COALESCE(qty_hanh_chinh, 0)) AS plan_qty
      FROM daily_schedule_rows
      WHERE work_date = ? AND product_name IS NOT NULL AND TRIM(product_name) != ''
      GROUP BY product_name, customer
    `).all(dateStr) as Array<{ product_name: string; customer: string; plan_qty: number }>;

    // 2. Get production logs for that date
    const logRows = db.prepare(`
      SELECT product_name, customer,
             SUM(ok_qty) AS ok_qty,
             SUM(rework_qty) AS rework_qty,
             SUM(scrap_qty) AS scrap_qty
      FROM production_logs
      WHERE work_date = ? AND is_voided = 0 AND product_name IS NOT NULL AND TRIM(product_name) != ''
      GROUP BY product_name, customer
    `).all(dateStr) as Array<{ product_name: string; customer: string; ok_qty: number; rework_qty: number; scrap_qty: number }>;

    const logsMap = new Map<string, { okQty: number; reworkQty: number; scrapQty: number }>();
    for (const l of logRows) {
      const key = `${l.product_name.trim()}___${(l.customer || '').trim()}`;
      logsMap.set(key, {
        okQty: Number(l.ok_qty || 0),
        reworkQty: Number(l.rework_qty || 0),
        scrapQty: Number(l.scrap_qty || 0),
      });
    }

    // 3. Existing handovers for that date
    const existingHandovers = queryHandoverSlips(db, dateStr);
    const existingNames = new Set(existingHandovers.map((h) => h.productName.trim()));

    let indexCount = existingHandovers.length;
    let addedCount = 0;

    for (const p of planRows) {
      const pName = p.product_name.trim();
      if (!pName || existingNames.has(pName)) continue;

      indexCount++;
      addedCount++;
      const key = `${pName}___${(p.customer || '').trim()}`;
      const actualLog = logsMap.get(key) || { okQty: 0, reworkQty: 0, scrapQty: 0 };
      const planQty = Number(p.plan_qty || 0);
      const actualOk = actualLog.okQty;
      const defect = actualLog.scrapQty;
      const missing = Math.max(0, planQty - actualOk);

      const row = {
        id: `HO-${dateStr.replace(/-/g, '')}-${String(indexCount).padStart(2, '0')}`,
        handoverDate: dateStr,
        fromDept: 'PX_GIA_CONG' as const,
        toDept: 'PX_HOAN_THIEN' as const,
        productName: pName,
        customer: (p.customer || '').trim(),
        unit: 'Cái',
        prodQtyTransferred: actualOk > 0 ? actualOk : planQty,
        prodQtyDefect: defect,
        prodQtyMissing: missing,
        rawQtyTransferred: planQty,
        rawQtyDefect: 0,
        rawQtyMissing: 0,
        note: `Từ Kế hoạch ${dateStr}: Giao ${planQty} SP | Báo cáo ${actualOk} SP`,
        senderName: 'PX Gia Công',
        receiverName: 'PX Hoàn Thiện',
        isConfirmed: false,
        createdAt: new Date().toISOString(),
      };

      insertHandoverSlip(db, row);
    }

    const finalItems = queryHandoverSlips(db, dateStr);
    res.json({ success: true, addedCount, items: finalItems });
  });

  router.patch('/handovers/:id', requireRoles('SHIFT_LEADER', 'QC', 'DIRECTOR', 'ADMIN'), (req, res) => {
    const id = String(req.params.id);
    const existing = queryHandoverSlips(db).find((h) => h.id === id);
    if (!existing) {
      res.status(404).json({ error: `Không tìm thấy phiếu chuyển giao ${id}` });
      return;
    }

    const isConfirming = req.body.isConfirmed !== undefined ? Boolean(req.body.isConfirmed) : existing.isConfirmed;
    const confirmedAt = isConfirming
      ? req.body.confirmedAt || new Date().toISOString()
      : undefined;

    const updated = {
      ...existing,
      ...req.body,
      isConfirmed: isConfirming,
      confirmedAt,
    };

    insertHandoverSlip(db, updated);
    res.json({ success: true, item: updated });
  });

  router.delete('/handovers/:id', requireRoles('SHIFT_LEADER', 'DIRECTOR', 'ADMIN'), (req, res) => {
    const id = String(req.params.id);
    deleteHandoverSlip(db, id);
    res.json({ success: true, id });
  });

  // ==================== SAO LƯU & PHỤC HỒI CƠ SỞ DỮ LIỆU (.SQLITE) ====================
  router.get('/system/backup', (req, res) => {
    try {
      // Force WAL checkpoint so data in WAL is merged into the main db file
      try {
        db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
      } catch (walErr) {
        console.warn('wal_checkpoint error:', walErr);
      }

      const dbPath = process.env.GCCK_DB_PATH ?? path.resolve(process.cwd(), 'data', 'gcck_mes.sqlite');
      if (!fs.existsSync(dbPath)) {
        res.status(404).json({ error: 'Không tìm thấy file CSDL SQLite để sao lưu.' });
        return;
      }

      const now = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const filename = `gcck_mes_backup_${now}.sqlite`;
      res.download(dbPath, filename);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Lỗi tạo bản sao lưu CSDL.' });
    }
  });

  return router;
}
