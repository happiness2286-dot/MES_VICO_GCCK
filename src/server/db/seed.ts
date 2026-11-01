import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { withTransaction } from './connection';
import { hashPin } from '../auth/security';
import { normalizeVn, removeVietnameseTones } from '../../shared/vnSearch';
import { getVietnamDateString } from '../../shared/payrollEngine';

import { canonicalizeCustomerName, type CanonicalCustomerResult } from '../../shared/customerNormalization';
export { canonicalizeCustomerName, type CanonicalCustomerResult };

export function derivePoStatus(
  qtyPo: number,
  wipQty: number,
  finishedQty: number,
  deliveredQty: number
): string {
  if (qtyPo > 0 && deliveredQty >= qtyPo) return '✅ Đã giao đủ';
  if (qtyPo > 0 && finishedQty >= qtyPo) return '📦 Chờ giao hàng';
  if (finishedQty > 0 || wipQty > 0) return '⚙️ Đang gia công';
  return '⏳ Đang chờ SX';
}

export function seedIfEmpty(db: DatabaseSync, customSeedJsonPath?: string): boolean {
  const countRow = db.prepare('SELECT COUNT(*) as cnt FROM workers').get() as { cnt: number };
  if (Number(countRow.cnt) > 0) {
    return false;
  }

  const seedPath =
    customSeedJsonPath ?? path.resolve(process.cwd(), 'data', 'seed_gcck_1233.json');
  const rawJson = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  const todayVn = getVietnamDateString();

  withTransaction(db, () => {
    // 1. System Config
    const upsertCfg = db.prepare(
      'INSERT OR REPLACE INTO system_config (key, value) VALUES (?, ?)'
    );
    const rawCfg = rawJson.config || {};
    const cleanCfgVal = (v: unknown) => {
      const s = normalizeVn(String(v ?? ''));
      return s.startsWith('DIEN_') ? '' : s;
    };

    const configEntries: Array<[string, string]> = [
      ['AUTH_MODE', 'DEMO_QUICK'],
      ['SESSION_HMAC_SECRET', randomBytes(32).toString('hex')],
      ['TELEGRAM_BOT_TOKEN', cleanCfgVal(rawCfg.TELEGRAM_BOT_TOKEN)],
      ['TELEGRAM_BOT_USERNAME', cleanCfgVal(rawCfg.TELEGRAM_BOT_USERNAME)],
      ['MANAGER_CHAT_ID', cleanCfgVal(rawCfg.MANAGER_CHAT_ID)],
      ['WEB_APP_URL', normalizeVn(rawCfg.WEB_APP_URL || '')],
      ['DRIVE_FOLDER_NAME', normalizeVn(rawCfg.DRIVE_FOLDER_NAME || 'VICO_GCCK_ANH_SAN_PHAM_2027')],
      ['SECONDS_PER_SHIFT', String(rawCfg.SECONDS_PER_SHIFT || 28800)],
      ['SECOND_MACHINE_RATE', String(rawCfg.SECOND_MACHINE_RATE || 0.33)],
      ['MEAL_SHIFT_2_3', String(rawCfg.MEAL_ALLOWANCE_SHIFT_2_3 || 20000)],
      ['MEAL_OT_2H', '15000'],
      ['MEAL_SUNDAY', '30000'],
      ['KPI_WARNING_THRESHOLD', String(rawCfg.KPI_WARNING_THRESHOLD || 0.85)],
    ];
    for (const [k, v] of configEntries) {
      upsertCfg.run(k, v);
    }

    // 2. 16 Workers (scrypt hashed PINs, clean fake CHAT_ID_NV...)
    const insWorker = db.prepare(`
      INSERT INTO workers (
        id, name, username, role, title, salary_mode, base_salary, cost_per_sec,
        pin_hash, chat_id, is_linked, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);
    for (const w of rawJson.workers || []) {
      const id = normalizeVn(w.id);
      const rawChat = normalizeVn(w.chatId || '');
      const validChat =
        rawChat && !rawChat.startsWith('CHAT_ID_') && !rawChat.startsWith('DIEN_')
          ? rawChat
          : null;
      const pinPlain = normalizeVn(w.pin || '1234') || '1234';

      insWorker.run(
        id,
        normalizeVn(w.name),
        normalizeVn(w.username || id.toLowerCase()),
        normalizeVn(w.role || 'CN'),
        normalizeVn(w.title || 'Công nhân'),
        normalizeVn(w.salaryMode || 'Khoán 1 + 0.33 máy'),
        Number(w.baseSalary) || 385000,
        Number(w.costPerSec) || 13.37,
        hashPin(pinPlain),
        validChat,
        validChat && w.isLinked ? 1 : 0
      );
    }

    // 3. 23+ Machines (plus any missing machine referenced in operations or recentLogs)
    const insMachine = db.prepare(`
      INSERT INTO machines (
        id, name, group_name, cost_per_hour, status, current_worker_name, current_po_id, current_nc_id, stop_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const machineByName = new Map<string, { id: string; name: string }>();
    let mCounter = 0;

    const initialStatuses: Array<{
      status: string;
      worker: string | null;
      po: string | null;
      nc: string | null;
      stopReason: string | null;
    }> = [
      { status: 'RUNNING', worker: 'Trần Văn Quỳnh', po: 'PO485-01', nc: 'NC088', stopReason: null },
      { status: 'RUNNING', worker: 'Phùng Công Thắng', po: 'PO486-01', nc: 'NC090', stopReason: null },
      { status: 'RUNNING', worker: 'Phạm Văn Sam', po: 'PO487-01', nc: 'NC069', stopReason: null },
      { status: 'SETUP', worker: 'Trần Văn Dũng', po: 'PO488-01', nc: 'NC070', stopReason: 'Thay dao / Setup' },
      { status: 'RUNNING', worker: 'Hoàng Ngọc Hà', po: 'PO-THEO-KH', nc: 'NC158', stopReason: null },
      { status: 'IDLE', worker: null, po: null, nc: null, stopReason: null },
      { status: 'RUNNING', worker: 'Vũ Tiến Thuận', po: 'PO480-02', nc: 'NC112', stopReason: null },
      { status: 'RUNNING', worker: 'Phạm Văn Tráng', po: 'PO481-01', nc: 'NC114', stopReason: null },
      { status: 'RUNNING', worker: 'Nguyễn Trung Đông', po: 'DH-388', nc: 'NC622', stopReason: null },
      { status: 'STOPPED', worker: 'Đinh Văn Nhận', po: 'PO475-01', nc: 'NC120', stopReason: 'Chờ phôi / Chờ cẩu' },
    ];

    for (const m of rawJson.machines || []) {
      mCounter++;
      const id = normalizeVn(m.id) || `M${String(mCounter).padStart(2, '0')}`;
      const name = normalizeVn(m.name);
      const groupName = normalizeVn(m.group || 'Gia công cơ khí');
      const liveMeta = initialStatuses[(mCounter - 1) % initialStatuses.length];

      insMachine.run(
        id,
        name,
        groupName,
        Number(m.costPerHour) || 250000,
        mCounter <= 14 ? liveMeta.status : 'IDLE',
        mCounter <= 14 ? liveMeta.worker : null,
        mCounter <= 14 ? liveMeta.po : null,
        mCounter <= 14 ? liveMeta.nc : null,
        mCounter <= 14 ? liveMeta.stopReason : null
      );
      machineByName.set(name.toLowerCase(), { id, name });
    }

    const ensureMachine = (rawName: string) => {
      const name = normalizeVn(rawName);
      if (!name) return { id: 'M02', name: 'Máy Tiện CNC 1' };
      const existing = machineByName.get(name.toLowerCase());
      if (existing) return existing;
      mCounter++;
      const id = `M${String(mCounter).padStart(2, '0')}`;
      insMachine.run(id, name, 'Nhóm bổ sung', 250000, 'IDLE', null, null, null, null);
      const entry = { id, name };
      machineByName.set(name.toLowerCase(), entry);
      return entry;
    };

    for (const o of rawJson.operations || []) {
      if (o.defaultMachine) ensureMachine(o.defaultMachine);
    }
    for (const l of rawJson.recentLogs || []) {
      if (l.machineName) ensureMachine(l.machineName);
    }

    // 4. 63 Cutting Tools
    const insTool = db.prepare(`
      INSERT INTO cutting_tools (
        code, group_name, name, buy_price, edges, cost_per_edge, stock_qty, used_edges_total
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0)
    `);
    for (let i = 0; i < (rawJson.toolsList || []).length; i++) {
      const t = rawJson.toolsList[i];
      insTool.run(
        normalizeVn(t.code),
        normalizeVn(t.group || 'Dao cụ'),
        normalizeVn(t.name),
        Number(t.buyPrice) || 0,
        Math.max(1, Number(t.edges) || 1),
        Number(t.costPerEdge) || 0,
        15 + (i % 12)
      );
    }

    // 5. 334 Products & 627 Operations (step_order = 1..K, unique is_final_op = 1 at step K)
    const insProd = db.prepare(`
      INSERT INTO products (
        sp_id, customer, product_name, mat_name, quoted_price, raw_material_cost, outsource_cost, setup_minutes_std
      ) VALUES (?, ?, ?, ?, ?, 0, 0, 15)
    `);

    const prodByCustAndName = new Map<string, { spId: string; customer: string; productName: string }>();
    const prodByCompactName = new Map<string, { spId: string; customer: string; productName: string }>();
    const prodBySpId = new Map<string, { spId: string; customer: string; productName: string }>();

    // Group raw operations by customer||productName first so we know matName for product
    const rawOpsGrouped = new Map<string, any[]>();
    for (const o of rawJson.operations || []) {
      const cust = canonicalizeCustomerName(o.customer).customer;
      const pName = normalizeVn(o.productName);
      const key = `${cust}||${pName}`;
      const list = rawOpsGrouped.get(key) || [];
      list.push({ ...o, _normCust: cust, _normProd: pName });
      rawOpsGrouped.set(key, list);
    }

    for (const c of rawJson.costingList || []) {
      const spId = normalizeVn(c.spId);
      const cust = canonicalizeCustomerName(c.customer).customer;
      const pName = normalizeVn(c.productName);
      const key = `${cust}||${pName}`;
      const opsForProd = rawOpsGrouped.get(key) || [];
      const matName = normalizeVn(opsForProd[0]?.matName || 'Thép cơ khí chế tạo');

      insProd.run(spId, cust, pName, matName, Number(c.quotedPrice) || 0);

      const meta = { spId, customer: cust, productName: pName };
      prodByCustAndName.set(key, meta);
      prodBySpId.set(spId, meta);
      const compact = pName.replace(/\s+/g, '').toUpperCase();
      if (!prodByCompactName.has(compact)) {
        prodByCompactName.set(compact, meta);
      }
    }

    const insOp = db.prepare(`
      INSERT INTO operations (
        nc_id, sp_id, customer, product_name, op_name, std_seconds, stage, step_order, is_final_op,
        default_machine, mat_name, cutting_rec, tool_code, tool_name, cost_per_edge,
        std_edges_per_pcs, std_labor_cost, std_mach_cost, std_tool_cost, is_critical_check
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const opMetaByNcId = new Map<
      string,
      {
        ncId: string;
        spId: string;
        customer: string;
        productName: string;
        opName: string;
        stage: string;
        stepOrder: number;
        isFinalOp: number;
        stdSeconds: number;
      }
    >();
    const firstOpBySpId = new Map<string, { ncId: string; opName: string; defaultMachine: string; matName: string; toolCode: string; stdSeconds: number }>();

    for (const [key, opsList] of rawOpsGrouped.entries()) {
      const prodMeta = prodByCustAndName.get(key);
      if (!prodMeta) continue;

      const totalSteps = opsList.length;
      opsList.forEach((o, idx) => {
        const stepOrder = idx + 1;
        const isFinalOp = idx === totalSteps - 1 ? 1 : 0;
        const stage = isFinalOp === 1 ? 'End' : String(stepOrder);
        const mach = ensureMachine(o.defaultMachine || 'Máy Tiện CNC 1');
        const opName = normalizeVn(o.opName);
        const opAscii = removeVietnameseTones(opName).toLowerCase();
        const isCritical =
          isFinalOp === 1 ||
          opAscii.includes('tinh') ||
          opAscii.includes('doa') ||
          opAscii.includes('con') ||
          opAscii.includes('ren')
            ? 1
            : 0;

        const ncId = normalizeVn(o.ncId);
        const matName = normalizeVn(o.matName || '');
        const toolCode = normalizeVn(o.toolCode || '');
        const stdSec = Math.max(0, Math.round(Number(o.stdSeconds) || 0));

        insOp.run(
          ncId,
          prodMeta.spId,
          prodMeta.customer,
          prodMeta.productName,
          opName,
          stdSec,
          stage,
          stepOrder,
          isFinalOp,
          mach.name,
          matName,
          normalizeVn(o.cuttingRec || ''),
          toolCode,
          normalizeVn(o.toolName || ''),
          Number(o.costPerEdge) || 0,
          Number(o.stdEdgesPerPcs) || 0,
          Number(o.stdLaborCost) || 0,
          Number(o.stdMachCost) || 0,
          Number(o.stdToolCost) || 0,
          isCritical
        );

        opMetaByNcId.set(ncId, {
          ncId,
          spId: prodMeta.spId,
          customer: prodMeta.customer,
          productName: prodMeta.productName,
          opName,
          stage,
          stepOrder,
          isFinalOp,
          stdSeconds: stdSec,
        });

        if (idx === 0) {
          firstOpBySpId.set(prodMeta.spId, {
            ncId,
            opName,
            defaultMachine: mach.name,
            matName,
            toolCode,
            stdSeconds: stdSec,
          });
        }
      });
    }

    // 6. 189 Purchase Orders (customer normalization, 13 ALKTOP space-fix, numeric status fix, remainQty fix)
    const insPo = db.prepare(`
      INSERT INTO purchase_orders (
        po_id, customer, sp_id, product_name, qty_po, due_date,
        wip_qty, finished_qty, delivered_qty, stock_qty, remain_qty,
        status, material_lot, supplier_name, cast_date, priority, note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const seededPoList: Array<{
      poId: string;
      spId: string | null;
      productName: string;
      qtyPo: number;
      remainQty: number;
    }> = [];

    for (let idx = 0; idx < (rawJson.ordersList || []).length; idx++) {
      const p = rawJson.ordersList[idx];
      const poId = normalizeVn(p.poId);
      const { customer, contractRef } = canonicalizeCustomerName(p.customer);
      const rawProdName = normalizeVn(p.productName);
      const compactProd = rawProdName.replace(/\s+/g, '').toUpperCase();

      const matchedProd =
        (p.spId && prodBySpId.get(normalizeVn(p.spId))) ||
        prodByCustAndName.get(`${customer}||${rawProdName}`) ||
        prodByCompactName.get(compactProd) ||
        prodByCompactName.get(compactProd.replace(/^ALKTOP(?:II|2)/i, 'ALKTOP')) ||
        null;

      const canonicalProdName = matchedProd ? matchedProd.productName : rawProdName;
      const spId = matchedProd ? matchedProd.spId : (p.spId ? normalizeVn(p.spId) : null);

      const qtyPo = Math.max(1, Math.round(Number(p.qtyPo) || 1));
      const rawWip = Math.max(0, Math.round(Number(p.wipQty) || 0));
      const rawFin = Math.max(0, Math.round(Number(p.finishedQty) || 0));
      let deliveredQty = Math.max(0, Math.round(Number(p.deliveredQty) || 0));

      // Recover shifted deliveredQty on rows where numeric value overwrote status
      const rawStatusStr = normalizeVn(String(p.status ?? ''));
      const numericStatus = rawStatusStr !== '' && !Number.isNaN(Number(rawStatusStr)) ? Number(rawStatusStr) : NaN;
      if (!Number.isNaN(numericStatus) && deliveredQty === 0 && numericStatus > 0 && numericStatus <= qtyPo) {
        deliveredQty = Math.round(numericStatus);
      }
      deliveredQty = Math.min(qtyPo, deliveredQty);

      const finishedQty = Math.max(deliveredQty, Math.min(qtyPo, rawFin));
      const wipQty = Math.min(qtyPo, Math.max(0, rawWip));
      const stockQty = Math.max(0, finishedQty - deliveredQty);
      const remainQty = Math.max(0, qtyPo - deliveredQty);
      const status = derivePoStatus(qtyPo, wipQty, finishedQty, deliveredQty);

      const dueDate = normalizeVn(p.dueDate || '2026-11-15');
      const lotStr = `LOT-VICO-2610-${String((idx % 45) + 1).padStart(3, '0')}`;
      const supplier = customer === 'Win-Win' || customer === 'TFG' ? 'Xưởng Đúc VICO Thắng Lợi' : 'Phôi Đúc / Rèn Nội Bộ';
      const castDate = '2026-10-10';
      const priority = remainQty > 0 && dueDate <= '2026-10-30' ? 1 : 2;
      const note = contractRef ? `HĐ/Ref: ${contractRef}` : '';

      insPo.run(
        poId,
        customer,
        spId,
        canonicalProdName,
        qtyPo,
        dueDate,
        wipQty,
        finishedQty,
        deliveredQty,
        stockQty,
        remainQty,
        status,
        lotStr,
        supplier,
        castDate,
        priority,
        note
      );

      seededPoList.push({ poId, spId, productName: canonicalProdName, qtyPo, remainQty });
    }

    // 7. 16 Attendance Monthly sheets (2026-10)
    const insAtt = db.prepare(`
      INSERT INTO attendance_monthly (
        year_month, emp_id, emp_name, work_type, default_shift, year_days_hist_json, days_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const a of rawJson.attendanceList || []) {
      const days: string[] = [];
      for (let d = 0; d < 31; d++) {
        days.push(normalizeVn(a.days?.[d] || ''));
      }
      const hist = Array.isArray(a.yearDaysHist) ? a.yearDaysHist.map((n: any) => Number(n) || 0) : new Array(9).fill(0);
      insAtt.run(
        '2026-10',
        normalizeVn(a.empId),
        normalizeVn(a.name),
        normalizeVn(a.workType || 'Công'),
        normalizeVn(a.defaultShift || 'Ca 1'),
        JSON.stringify(hist),
        JSON.stringify(days)
      );
    }

    // 8. Seed original recentLogs with normalized step_order & is_final_op (fixes SP095!)
    const insLog = db.prepare(`
      INSERT INTO production_logs (
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
        ?, 0, 0, ?, ?,
        ?, ?, 'FIRST', ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, '', 0, ?, 'Không có dừng máy',
        '', 0, 1, 'PASSED',
        0, 0, 0, 0, 0,
        0, ?, ?, ?, ?,
        '', ?, 'LOT-VICO-2610-001', ?, 0
      )
    `);

    for (let i = 0; i < (rawJson.recentLogs || []).length; i++) {
      const l = rawJson.recentLogs[i];
      const ncId = normalizeVn(l.ncId);
      const opMeta = opMetaByNcId.get(ncId);
      const mach = ensureMachine(l.machineName || 'Máy tiện FUJI');
      const kpiMatch = /(\d+)%/.exec(String(l.kpiStatus || '100%'));
      const kpiPct = kpiMatch ? Number(kpiMatch[1]) : 100;
      const poMatch = /\[PO:\s*([^\]]+)\]/.exec(String(l.note || ''));
      const poId = poMatch ? normalizeVn(poMatch[1]) : 'PO-THEO-KH';

      insLog.run(
        `SEED-LOG-${i + 1}-${ncId}`,
        normalizeVn(l.timeStr || '26/10 14:00'),
        normalizeVn(l.workDate || '2026-10-26'),
        normalizeVn(l.shift || 'Ca 1 (Sáng 06h-14h)'),
        '06:00',
        '14:00',
        0,
        normalizeVn(l.workerId || 'NV00053'),
        normalizeVn(l.workerName || 'Hoàng Ngọc Hà'),
        mach.id,
        mach.name,
        poId,
        opMeta?.spId ?? null,
        opMeta?.customer ?? canonicalizeCustomerName(l.customer).customer,
        opMeta?.productName ?? normalizeVn(l.productName),
        ncId,
        opMeta?.opName ?? normalizeVn(l.opName),
        opMeta?.stage ?? 'End',
        opMeta?.stepOrder ?? 1,
        opMeta?.isFinalOp ?? 1,
        opMeta?.stdSeconds ?? 3600,
        Number(l.okQty) || 0,
        Number(l.reworkQty) || 0,
        Number(l.scrapQty) || 0,
        Number(l.stopMinutes) || 0,
        0, // NV00053 is Hành chính (Tháng) -> direct per-turn income = 0
        Number(l.batchCost) || 0,
        kpiPct,
        normalizeVn(l.kpiStatus || 'Đạt 100% ĐM'),
        i === 0 ? 'Gá kẹp chuẩn đồng tâm <0.02mm, chú ý phoi cuốn ở lỗ định vị.' : 'Dao phay mặt mới thay cạnh số 2, chạy êm.',
        normalizeVn(l.note || '')
      );
    }

    // 9. Seed 14 live machine_schedules blocks (bottlenecks + SMED + Lights-out night runs)
    const insSched = db.prepare(`
      INSERT INTO machine_schedules (
        machine_id, machine_name, po_id, nc_id, product_name, op_name, mat_name, tool_code,
        work_date, shift_type, planned_qty, planned_hours, is_lights_out, sequence_order, status, note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const openLinkedPos = seededPoList.filter((p) => p.spId && p.remainQty > 0);
    const sampleScheduleMachines = [
      'Máy Tiện CNC 1',
      'Máy Tiện CNC 1',
      'Máy Tiện CNC 1',
      'Máy Tiện CNC 2',
      'Máy tiện OKUMA',
      'Máy tiện FUJI',
      'Máy tiện đứng T1516',
      'Máy Phay CNC1',
      'Máy Phay CNC1',
      'Máy Phay CNC2',
      'Máy phay OKK1',
      'Máy Cắt Dây DK7745 - 1',
      'Máy Cắt Dây DK7745 - 2',
      'Máy Khoan cần Yoshida',
    ];

    sampleScheduleMachines.forEach((mName, idx) => {
      const mach = ensureMachine(mName);
      const po = openLinkedPos[idx % Math.max(1, openLinkedPos.length)] || {
        poId: 'PO485-01',
        spId: 'SP058',
        productName: 'ALKTOP 1342 M',
        qtyPo: 90,
      };
      const opInfo = (po.spId && firstOpBySpId.get(po.spId)) || {
        ncId: 'NC001',
        opName: 'Gia công CNC',
        matName: 'Thép SKD11',
        toolCode: 'T01',
        stdSeconds: 2700,
      };
      const isLightsOut = idx === 2 || idx === 8 || idx === 11 ? 1 : 0;
      const shiftType = isLightsOut
        ? 'Ca 3 (Đêm 22h-06h)'
        : idx % 2 === 0
          ? 'Ca 1 (Sáng 06h-14h)'
          : 'Ca 2 (Chiều 14h-22h)';
      const plannedHours = isLightsOut ? 7.5 : 8.0;
      const plannedQty = Math.max(2, Math.round((plannedHours * 3600) / Math.max(600, opInfo.stdSeconds)));

      insSched.run(
        mach.id,
        mach.name,
        po.poId,
        opInfo.ncId,
        po.productName,
        opInfo.opName,
        opInfo.matName,
        opInfo.toolCode,
        todayVn,
        shiftType,
        plannedQty,
        plannedHours,
        isLightsOut,
        (idx % 3) + 1,
        idx < 6 ? 'RUNNING' : 'PLANNED',
        isLightsOut ? '🌙 Chạy tự động Lights-out ban đêm (phôi lớn chu kỳ dài)' : 'Kế hoạch điều độ Lean SMED'
      );
    });

    // 10. Seed 5 FAI QC Inspections (First Article Inspection)
    const insQc = db.prepare(`
      INSERT INTO qc_inspections (
        inspection_type, po_id, sp_id, nc_id, product_name, op_name, machine_name,
        operator_id, inspector_id, inspector_name, result, sample_size, defect_qty,
        measured_dims_json, root_cause, corrective_action
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (let q = 0; q < 5; q++) {
      const po = openLinkedPos[q] || {
        poId: `PO485-0${q + 1}`,
        spId: 'SP058',
        productName: 'ALKTOP 1342 M',
      };
      const opInfo = (po.spId && firstOpBySpId.get(po.spId)) || {
        ncId: 'NC001',
        opName: 'Tiện tinh CNC',
        defaultMachine: 'Máy Tiện CNC 1',
      };
      insQc.run(
        'FAI',
        po.poId,
        po.spId,
        opInfo.ncId,
        po.productName,
        opInfo.opName,
        opInfo.defaultMachine,
        'NV00214',
        'NV00266',
        'Trần Văn Dũng',
        q === 4 ? 'CONCESSION' : 'PASS',
        1,
        0,
        JSON.stringify([
          { dim: 'Đường kính lỗ chính', spec: 'Φ120 H7 (+0.035/0)', measured: '120.018', ok: true },
          { dim: 'Độ nhám bề mặt', spec: 'Ra 1.6', measured: 'Ra 1.2', ok: true },
        ]),
        '',
        q === 4 ? 'Theo dõi mòn mảnh dao sau 10 chi tiết' : 'Đạt chuẩn chi tiết đầu tiên (FAI), cho phép chạy loạt'
      );
    }
  });

  return true;
}
