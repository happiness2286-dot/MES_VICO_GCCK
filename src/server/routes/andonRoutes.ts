import { Router } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import type { AndonLivePayload } from '../../shared/types';
import {
  queryMachines,
  queryOperations,
  queryPurchaseOrders,
  querySchedules,
} from '../db/queries';
import { computeMachineLoads } from '../../shared/loadBalancing';
import { getVietnamDateString } from '../../shared/payrollEngine';

export function createAndonRoutes(db: DatabaseSync): Router {
  const router = Router();

  router.get('/andon/live', (req, res) => {
    const vietnamDate = getVietnamDateString();
    const machines = queryMachines(db);
    const orders = queryPurchaseOrders(db);
    const operations = queryOperations(db);
    const schedules = querySchedules(db);
    const loads = computeMachineLoads(machines, orders, operations, schedules);

    const loadById = new Map(loads.map((l) => [l.machineId, l]));
    const lightsOutSet = new Set(
      schedules.filter((s) => s.isLightsOut === 1).map((s) => s.machineId)
    );

    // 1. Determine shift: explicit query or auto-detected by VN clock
    const reqShift = String(req.query.shift || '').trim();
    const now = new Date();
    const vnHourStr = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Ho_Chi_Minh',
      hour: 'numeric',
      hour12: false,
    }).format(now);
    const currentHour = parseInt(vnHourStr, 10);
    const autoShift = currentHour >= 6 && currentHour < 14 ? 'Ca 1' : currentHour >= 14 && currentHour < 22 ? 'Ca 2' : 'Ca 3';
    const currentShift = ['Ca 1', 'Ca 2', 'Ca 3'].includes(reqShift) ? reqShift : autoShift;

    // 2. Query daily_schedule_rows for today (or latest available date in DB)
    let planDate = vietnamDate;
    let planRows = db.prepare(`
      SELECT * FROM daily_schedule_rows WHERE work_date = ?
    `).all(vietnamDate) as Array<Record<string, any>>;

    if (planRows.length === 0) {
      const latestMeta = db.prepare(`
        SELECT work_date FROM daily_schedule_rows ORDER BY work_date DESC LIMIT 1
      `).get() as { work_date?: string } | undefined;
      if (latestMeta?.work_date) {
        planDate = String(latestMeta.work_date);
        planRows = db.prepare(`
          SELECT * FROM daily_schedule_rows WHERE work_date = ?
        `).all(planDate) as Array<Record<string, any>>;
      }
    }

    // 3. Filter rows strictly for currentShift
    const shiftPlanRows = planRows.filter((r) => String(r.shift_type) === currentShift);

    // 4. Map workers to count of distinct machines in this shift (+0.33 allowance)
    const workerMachines = new Map<string, Set<string>>();
    for (const r of shiftPlanRows) {
      const wName = String(r.worker_name || '').trim();
      const mName = String(r.machine_name || '').trim();
      if (wName && mName) {
        let set = workerMachines.get(wName);
        if (!set) {
          set = new Set<string>();
          workerMachines.set(wName, set);
        }
        set.add(mName.toLowerCase());
      }
    }

    // 5. Index plan rows by machine name (normalized)
    const normMach = (s: string) => s.toLowerCase().replace(/[\s\-_]/g, '');
    const planByMach = new Map<string, Array<Record<string, any>>>();
    for (const r of shiftPlanRows) {
      const mName = String(r.machine_name || '').trim();
      if (mName) {
        const key = normMach(mName);
        let list = planByMach.get(key);
        if (!list) {
          list = [];
          planByMach.set(key, list);
        }
        list.push(r);
      }
    }

    // 6. Build live machine models
    let runningCount = 0;
    let setupCount = 0;
    let stoppedCount = 0;
    let idleCount = 0;
    let overtimeCount = 0;

    const mappedMachines = machines.map((m) => {
      const l = loadById.get(m.id);
      const isLightsOutMach = lightsOutSet.has(m.id) || m.group.toLowerCase().includes('cắt dây');
      const isStopped = m.status === 'STOPPED';

      const assignedRows = planByMach.get(normMach(m.name)) || planByMach.get(normMach(m.id)) || [];
      const primaryRow = assignedRows[0];

      let status: 'RUNNING' | 'SETUP' | 'STOPPED' | 'IDLE' | 'MAINTENANCE' = 'IDLE';
      let workerName: string | null = null;
      let poId: string | null = null;
      let ncId: string | null = null;
      let productName: string | null = null;
      let opName: string | null = null;
      let isDual = false;
      let isOt = false;
      let otHours = 0;

      if (isStopped) {
        status = 'STOPPED';
        stoppedCount++;
        if (primaryRow) {
          workerName = String(primaryRow.worker_name || '');
          poId = String(primaryRow.sp_id || '');
          productName = String(primaryRow.product_name || '');
          opName = String(primaryRow.op_name || '');
        }
      } else if (primaryRow) {
        workerName = String(primaryRow.worker_name || '');
        poId = String(primaryRow.sp_id || '');
        productName = String(primaryRow.product_name || '');
        opName = String(primaryRow.op_name || '');
        ncId = String(primaryRow.nc_id || '');

        const machCount = workerMachines.get(workerName)?.size || 0;
        isDual = machCount >= 2;

        const rowOt = assignedRows.find((r) => r.is_overtime);
        if (rowOt) {
          isOt = true;
          otHours = Number(rowOt.overtime_hours || 2);
          overtimeCount++;
        }

        if (currentShift === 'Ca 3' && isLightsOutMach) {
          status = 'RUNNING';
        } else {
          status = m.status === 'RUNNING' ? 'RUNNING' : 'SETUP';
        }

        if (status === 'RUNNING') runningCount++;
        else setupCount++;
      } else {
        status = 'IDLE';
        idleCount++;
      }

      return {
        id: m.id,
        name: m.name,
        group: m.group,
        status,
        currentWorkerName: workerName,
        currentPoId: poId,
        currentNcId: ncId,
        currentProductName: productName,
        currentOpName: opName,
        stopReason: m.stopReason ?? null,
        isLightsOut: isLightsOutMach,
        loadPct: l?.loadPct ?? 0,
        isBottleneck: l?.isBottleneck ?? false,
        isDualMachine: isDual,
        isOvertime: isOt,
        overtimeHours: otHours,
        shiftType: currentShift,
      };
    });

    const spindleRunPct =
      machines.length > 0 ? Math.round(((runningCount + setupCount) / machines.length) * 100) : 0;

    const todayAgg = db
      .prepare(
        `SELECT COALESCE(SUM(ok_qty), 0) AS ok_sum, COALESCE(SUM(scrap_qty), 0) AS ng_sum
         FROM production_logs WHERE work_date = ? AND is_voided = 0`
      )
      .get(vietnamDate) as { ok_sum: number; ng_sum: number };

    // Urgent & Overdue Open POs (ZERO financial prices!)
    const urgentOrders = orders
      .filter((po) => po.remainQty > 0)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.priority! - b.priority!)
      .slice(0, 12)
      .map((po) => ({
        poId: po.poId,
        customer: po.customer,
        productName: po.productName,
        qtyPo: po.qtyPo,
        finishedQty: po.finishedQty,
        remainQty: po.remainQty,
        dueDate: po.dueDate,
        isOverdue: Boolean(po.dueDate && po.dueDate < vietnamDate),
        progressPct: po.qtyPo > 0 ? Math.min(100, Math.round((po.finishedQty / po.qtyPo) * 100)) : 0,
        status: po.status,
      }));

    // Worker Standard-Hour Leaderboard (ZERO VND salary leak!)
    const leaderRows = db
      .prepare(
        `SELECT worker_id, worker_name,
                COALESCE(SUM(ok_qty * std_seconds), 0) AS earned_sec,
                COALESCE(SUM(ok_qty), 0) AS ok_total,
                ROUND(AVG(kpi_pct), 0) AS avg_kpi
         FROM production_logs
         WHERE is_voided = 0
         GROUP BY worker_id
         ORDER BY earned_sec DESC
         LIMIT 10`
      )
      .all() as Array<Record<string, any>>;

    const workerLeaderboard = leaderRows.map((r, i) => ({
      rank: i + 1,
      workerId: String(r.worker_id),
      workerName: String(r.worker_name),
      earnedStdHours: Number((Number(r.earned_sec || 0) / 3600).toFixed(1)),
      kpiPct: Number(r.avg_kpi || 100),
      okQtyTotal: Number(r.ok_total || 0),
    }));

    const alertsTicker: string[] = [];
    alertsTicker.push(`🔔 CA LÀM VIỆC HIỆN TẠI: ${currentShift.toUpperCase()} — Kế hoạch ngày ${planDate.split('-').reverse().join('/')}`);
    for (const m of machines) {
      if (m.status === 'STOPPED') {
        alertsTicker.push(`🚨 DỪNG MÁY: ${m.name} (${m.stopReason || 'Kiểm tra kỹ thuật'})`);
      }
    }
    for (const l of loads) {
      if (l.isBottleneck) {
        alertsTicker.push(
          `🔥 CỔ CHAI TẢI ${l.loadPct}%: ${l.machineName} — gợi ý san tải sang ${l.alternativeMachines[0] || 'Ca 3 Lights-out'}`
        );
      }
    }
    for (const po of urgentOrders.slice(0, 4)) {
      if (po.isOverdue) {
        alertsTicker.push(
          `⏰ ĐƠN QUÁ HẠN: ${po.poId} (${po.productName}) còn thiếu ${po.remainQty} SP`
        );
      }
    }
    if (alertsTicker.length === 1) {
      alertsTicker.push('✅ Xưởng GCCK Thắng Lợi vận hành ổn định — Tuân thủ tự kiểm ★ và 5S cuối ca.');
    }

    // 7. Build 13 personnel live status for the shift
    const CREW_13 = [
      { workerId: 'NV00053', name: 'Hoàng Ngọc Hà', role: 'QĐ', title: 'Quản đốc xưởng' },
      { workerId: 'NV00214', name: 'Trần Văn Quỳnh', role: 'Thợ', title: 'Công nhân phay CNC' },
      { workerId: 'NV00215', name: 'Phạm Văn Tráng', role: 'TC', title: 'Trưởng Ca (Tổ Tráng)' },
      { workerId: 'NV00218', name: 'Nguyễn Trung Đông', role: 'Thợ', title: 'Thợ tiện CNC (Tổ Tráng)' },
      { workerId: 'NV00219', name: 'Phùng Công Thắng', role: 'Thợ', title: 'Thợ tiện đứng (Tổ Tráng)' },
      { workerId: 'NV00266', name: 'Trần Văn Dũng', role: 'TC', title: 'Trưởng Ca (Tổ Dũng)' },
      { workerId: 'NV00216', name: 'Nguyễn Văn Thanh', role: 'Thợ', title: 'Thợ tiện/cắt dây (Tổ Dũng)' },
      { workerId: 'NV00283', name: 'Vũ Tiến Thuận', role: 'Thợ', title: 'Thợ tiện FUJI (Tổ Dũng)' },
      { workerId: 'NV00267', name: 'Phùng Gia Phúc', role: 'TC', title: 'Trưởng Ca (Tổ Phúc)' },
      { workerId: 'NV00265', name: 'Phạm Văn Sam', role: 'Thợ', title: 'Thợ tiện/cắt dây (Tổ Phúc)' },
      { workerId: 'NV00279', name: 'Đinh Văn Nhận', role: 'Thợ', title: 'Thợ tiện CNC (Tổ Phúc)' },
      { workerId: 'NV00261', name: 'Đặng Ngọc Long', role: 'Thợ', title: 'Thợ phay (Cố định Ca 2)' },
      { workerId: 'NV00282', name: 'Phùng Đình Hùng', role: 'Thợ', title: 'Thợ tiện OKUMA (Luân chuyển)' },
    ];

    const findWorkerShiftInPlan = (name: string): string | null => {
      const row = planRows.find((r) => String(r.worker_name || '').trim().toLowerCase() === name.toLowerCase());
      return row ? String(row.shift_type) : null;
    };

    const trangShift = findWorkerShiftInPlan('Phạm Văn Tráng') || findWorkerShiftInPlan('Nguyễn Trung Đông') || findWorkerShiftInPlan('Phùng Công Thắng') || 'Ca 1';
    const dungShift = findWorkerShiftInPlan('Trần Văn Dũng') || findWorkerShiftInPlan('Nguyễn Văn Thanh') || findWorkerShiftInPlan('Vũ Tiến Thuận') || 'Ca 2';
    const phucShift = findWorkerShiftInPlan('Phùng Gia Phúc') || findWorkerShiftInPlan('Phạm Văn Sam') || findWorkerShiftInPlan('Đinh Văn Nhận') || 'Ca 3';

    const getAssignedShift = (wId: string, wName: string): 'Ca 1' | 'Ca 2' | 'Ca 3' | 'Hành chính' | 'Luân chuyển' => {
      if (wId === 'NV00053') return 'Hành chính';
      if (wId === 'NV00261') return 'Ca 2';
      if (wId === 'NV00282') return 'Luân chuyển';
      if (['Phạm Văn Tráng', 'Nguyễn Trung Đông', 'Phùng Công Thắng'].includes(wName)) return trangShift as any;
      if (['Trần Văn Dũng', 'Nguyễn Văn Thanh', 'Vũ Tiến Thuận'].includes(wName)) return dungShift as any;
      if (['Phùng Gia Phúc', 'Phạm Văn Sam', 'Đinh Văn Nhận'].includes(wName)) return phucShift as any;
      return (findWorkerShiftInPlan(wName) || 'Ca 1') as any;
    };

    const workersStatus = CREW_13.map((w) => {
      const assignedShift = getAssignedShift(w.workerId, w.name);
      const isSupervisor = w.workerId === 'NV00053';
      const isShiftActive = !isSupervisor && (assignedShift === currentShift || (assignedShift === 'Luân chuyển' && Boolean(findWorkerShiftInPlan(w.name) === currentShift)));
      const rowsForWorker = shiftPlanRows.filter((r) => String(r.worker_name || '').trim().toLowerCase() === w.name.toLowerCase());

      let status: 'ACTIVE' | 'OFF' | 'OVERTIME' | 'OFF_SHIFT' | 'SUPERVISOR' = 'OFF_SHIFT';
      let statusLabel = `💤 Nghỉ ca (${assignedShift})`;
      let primaryMachine: string | null = null;
      let secondaryMachine: string | null = null;
      let productName: string | null = null;
      let opName: string | null = null;
      let plannedQty = 0;
      let note = '';

      if (isSupervisor) {
        status = 'SUPERVISOR';
        statusLabel = '👔 Chỉ đạo 3 ca (Không đứng máy)';
      } else if (isShiftActive) {
        if (rowsForWorker.length > 0) {
          const firstRow = rowsForWorker[0];
          primaryMachine = String(firstRow.machine_name || '');
          productName = String(firstRow.product_name || '');
          opName = String(firstRow.op_name || '');
          plannedQty = Number(firstRow.planned_qty || 0);
          note = String(firstRow.note || '');

          if (rowsForWorker.length > 1) {
            const secondRow = rowsForWorker[1];
            secondaryMachine = String(secondRow.machine_name || '');
          }

          const hasOt = rowsForWorker.some((r) => r.is_overtime || (r.note && /tăng ca|ot/i.test(r.note)));
          if (hasOt) {
            status = 'OVERTIME';
            statusLabel = '🔥 Tăng ca';
          } else {
            status = 'ACTIVE';
            statusLabel = '🟢 Đang làm việc';
          }
        } else {
          status = 'OFF';
          statusLabel = '⚪ Báo nghỉ / Chưa gán máy';
        }
      }

      return {
        workerId: w.workerId,
        name: w.name,
        role: w.role,
        title: w.title,
        assignedShift,
        isCurrentShiftActive: isShiftActive,
        status,
        statusLabel,
        primaryMachine,
        secondaryMachine,
        productName,
        opName,
        plannedQty,
        note,
      };
    });

    const payload: AndonLivePayload = {
      workersStatus,
      serverTime: new Date().toISOString(),
      vietnamDate,
      spindleRunPct,
      summary: {
        totalMachines: machines.length,
        runningCount,
        setupCount,
        stoppedCount,
        idleCount,
        todayOkQty: Number(todayAgg.ok_sum || 0),
        todayScrapQty: Number(todayAgg.ng_sum || 0),
        overtimeCount,
      },
      machines: mappedMachines,
      urgentOrders,
      workerLeaderboard,
      alertsTicker,
    };

    res.json(payload);
  });

  return router;
}
