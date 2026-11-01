import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import type { Express } from 'express';
import { createApp } from '../../src/server/app';
import * as authRoutesModule from '../../src/server/routes/authRoutes';

describe('SQLite WAL Seeder, RBAC Security & Atomic MES REST API', () => {
  let tmpDir: string;
  let dbPath: string;
  let app: Express;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gcck-mes-test-'));
    dbPath = path.join(tmpDir, 'test_gcck.sqlite');
    app = createApp(dbPath);
  });

  afterAll(() => {
    try {
      app?.locals?.db?.close?.();
    } catch {
      // ignore if already closed
    }
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore Windows WAL cleanup lock in temp dir
    }
  });

  it('blocks unauthenticated access to sensitive /costing while serving public /andon/live safely', async () => {
    const costRes = await request(app).get('/api/v1/costing');
    expect(costRes.status).toBe(401);

    const andonRes = await request(app).get('/api/v1/andon/live');
    expect(andonRes.status).toBe(200);
    expect(andonRes.body.machines.length).toBeGreaterThanOrEqual(23);
    const jsonStr = JSON.stringify(andonRes.body);
    expect(jsonStr).not.toContain('pinHash');
    expect(jsonStr).not.toContain('quotedPrice');
    expect(jsonStr).not.toContain('baseSalary');
  });

  it('enforces Zero-Leakage DTOs for Worker on /bootstrap and returns 403 on /costing', async () => {
    const agent = request.agent(app);
    const sw = await agent.post('/api/v1/auth/quick-switch').send({ workerId: 'NV00214' });
    expect(sw.status).toBe(200);
    expect(sw.body.user.workerId).toBe('NV00214');
    expect(sw.body.user.appRole).toBe('WORKER');

    const boot = await agent.get('/api/v1/bootstrap');
    expect(boot.status).toBe(200);

    // 13 active workers loaded (after removing 3 former staff)
    expect(boot.body.workers).toHaveLength(13);
    const selfWorker = boot.body.workers.find((w: any) => w.id === 'NV00214');
    const otherWorker = boot.body.workers.find((w: any) => w.id === 'NV00053');
    expect(selfWorker.costPerSec).toBeCloseTo(13.89, 2);
    expect(selfWorker.pinHash).toBeUndefined();
    expect(selfWorker.chatId).toBeDefined();
    expect(otherWorker.baseSalary).toBeUndefined();
    expect(otherWorker.costPerSec).toBeUndefined();
    expect(otherWorker.pinHash).toBeUndefined();

    // Bot token & product quotedPrice stripped for Worker
    expect(boot.body.config.TELEGRAM_BOT_TOKEN).toBeUndefined();
    expect(boot.body.products).toHaveLength(334);
    expect(boot.body.products[0].quotedPrice).toBeUndefined();

    // Machines >= 23 including FUJI & OKK1, Tools = 63, Operations = 627, POs = 189
    expect(boot.body.machines.length).toBeGreaterThanOrEqual(23);
    expect(boot.body.machines.some((m: any) => m.name === 'Máy tiện FUJI')).toBe(true);
    expect(boot.body.machines.some((m: any) => m.name === 'Máy phay OKK1')).toBe(true);
    expect(boot.body.toolsList).toHaveLength(118);
    expect(boot.body.operations).toHaveLength(627);
    expect(boot.body.ordersList).toHaveLength(189);
    expect(boot.body.schedules.length).toBeGreaterThanOrEqual(14);
    expect(boot.body.qcInspections.length).toBeGreaterThanOrEqual(5);

    // Every product has NFC normalized name and exactly ONE final op (isFinalOp === 1)
    const nfdFixed = boot.body.products.find((p: any) => p.productName.includes('Căn Xe goong hồi bi NLLT'));
    expect(nfdFixed).toBeDefined();

    const finalOpsCountBySp = new Map<string, number>();
    for (const op of boot.body.operations) {
      if (op.isFinalOp === 1) {
        finalOpsCountBySp.set(op.spId, (finalOpsCountBySp.get(op.spId) || 0) + 1);
      }
    }
    expect(finalOpsCountBySp.size).toBe(334);
    for (const [, cnt] of finalOpsCountBySp) {
      expect(cnt).toBe(1);
    }

    // ALKTOP POs linked & all POs have clean status + 0 <= remainQty <= qtyPo
    const alktopPo = boot.body.ordersList.find((p: any) => p.productName && p.productName.includes('1130'));
    expect(alktopPo).toBeDefined();
    expect(alktopPo.spId).toBe('SP041');
    for (const po of boot.body.ordersList) {
      expect(po.remainQty).toBeGreaterThanOrEqual(0);
      expect(po.remainQty).toBeLessThanOrEqual(po.qtyPo);
      expect(Number.isNaN(Number(po.status))).toBe(true); // status is text, never '4' or '50'
    }

    // Worker forbidden from /costing
    const workerCostRes = await agent.get('/api/v1/costing');
    expect(workerCostRes.status).toBe(403);
  });

  it('provides full Costing (with SP095 finishedQty === 0 fix), Attendance & 3P Payroll to Admin', async () => {
    const adminAgent = request.agent(app);
    const sw = await adminAgent.post('/api/v1/auth/quick-switch').send({ workerId: 'NV00053' });
    expect(sw.status).toBe(200);
    expect(sw.body.user.appRole).toBe('ADMIN');

    const costRes = await adminAgent.get('/api/v1/costing');
    expect(costRes.status).toBe(200);
    expect(costRes.body.items).toHaveLength(334);

    const sp095 = costRes.body.items.find((c: any) => c.spId === 'SP095');
    expect(sp095).toBeDefined();
    expect(sp095.finishedQty).toBe(0);
    expect(sp095.hasActual).toBe(false);
    expect(sp095.wipQty).toBe(8);

    // Update costing rawMaterialCost & outsourceCost
    const patchCost = await adminAgent
      .patch('/api/v1/costing/SP095')
      .send({ rawMaterialCost: 200000, outsourceCost: 100000, quotedPrice: 4100000 });
    expect(patchCost.status).toBe(200);
    expect(patchCost.body.item.rawMaterialCost).toBe(200000);
    expect(patchCost.body.item.quotedPrice).toBe(4100000);

    // Attendance & 3P Payroll
    const attRes = await adminAgent.get('/api/v1/attendance/2026-10');
    expect(attRes.status).toBe(200);
    expect(attRes.body.employees).toHaveLength(13);

    const cellRes = await adminAgent
      .put('/api/v1/attendance/2026-10/cell')
      .send({ empId: 'NV00214', dayIndex: 25, value: 'C1+2' });
    expect(cellRes.status).toBe(200);

    const payRes = await adminAgent.get('/api/v1/payroll/2026-10');
    expect(payRes.status).toBe(200);
    expect(payRes.body.rows).toHaveLength(13);
  });

  it('processes POST /reports atomically: ignores client-tampered rate, deduplicates recordUid, caps shift meal, and updates PO finishedQty on final op', async () => {
    const workerAgent = request.agent(app);
    await workerAgent.post('/api/v1/auth/quick-switch').send({ workerId: 'NV00214' });

    // Create a clean test PO on SP001 (NC001 step 1, NC003 final op step 2)
    const adminAgent = request.agent(app);
    await adminAgent.post('/api/v1/auth/quick-switch').send({ workerId: 'NV00053' });
    const createPo = await adminAgent.post('/api/v1/orders').send({
      poId: 'PO-TEST-900',
      customer: 'TFG',
      spId: 'SP001',
      productName: 'Pattern Drawing No 2CG00382',
      qtyPo: 10,
      dueDate: '2026-11-15',
    });
    expect(createPo.status).toBe(201);

    // Submit 1st report on Shift 2 for final op NC003 with tampered workerCostPerSec
    const r1 = await workerAgent.post('/api/v1/reports').send({
      recordUid: 'UID-TEST-001',
      workDate: '2026-10-28',
      shiftType: 'Ca 2 (Chiều 14h-22h)',
      startTime: '14:00',
      endTime: '18:00',
      overtimeMinutes: 0,
      machineName: 'Máy tiện FUJI',
      machineMode: 'FIRST',
      poId: 'PO-TEST-900',
      ncId: 'NC003',
      okQty: 3,
      reworkQty: 0,
      scrapQty: 0,
      stopMinutes: 0,
      selfCheckOk: true,
      workerCostPerSec: 999999, // Tamper attempt!
    });

    expect(r1.status).toBe(201);
    expect(r1.body.deduplicated).toBe(false);
    // Server must use NV00214's real costPerSec (~13.89), NOT 999999
    expect(r1.body.payroll.mealAllowance).toBe(20000);
    expect(r1.body.payroll.directPieceIncome).toBeLessThan(500_000);

    // Duplicate submission with same recordUid -> idempotent return, no double count
    const r1Dup = await workerAgent.post('/api/v1/reports').send({
      recordUid: 'UID-TEST-001',
      workDate: '2026-10-28',
      shiftType: 'Ca 2 (Chiều 14h-22h)',
      startTime: '14:00',
      endTime: '18:00',
      machineName: 'Máy tiện FUJI',
      poId: 'PO-TEST-900',
      ncId: 'NC003',
      okQty: 3,
    });
    expect(r1Dup.status).toBe(200);
    expect(r1Dup.body.deduplicated).toBe(true);

    // 2nd distinct report in same Shift 2 -> mealAllowance MUST be 0 (per-shift cap)
    const r2 = await workerAgent.post('/api/v1/reports').send({
      recordUid: 'UID-TEST-002',
      workDate: '2026-10-28',
      shiftType: 'Ca 2 (Chiều 14h-22h)',
      startTime: '18:00',
      endTime: '22:00',
      machineName: 'Máy tiện FUJI',
      poId: 'PO-TEST-900',
      ncId: 'NC003',
      okQty: 2,
      selfCheckOk: true,
    });
    expect(r2.status).toBe(201);
    expect(r2.body.payroll.mealAllowance).toBe(0);

    // Check PO finishedQty === 3 + 2 === 5 (not 8 from duplicate!)
    const trav = await workerAgent.get('/api/v1/orders/PO-TEST-900/traveler');
    expect(trav.status).toBe(200);
    expect(trav.body.po.finishedQty).toBe(5);
    expect(trav.body.operations.some((o: any) => o.qrPayload === 'GCCK|PO-TEST-900|NC003')).toBe(true);

    // Tool 1-for-1 swap
    const swapRes = await workerAgent
      .post('/api/v1/master/tools/swap')
      .send({ toolCode: 'T01', machineName: 'Máy tiện FUJI', oldInsertReturned: true, qtyIssued: 2 });
    expect(swapRes.status).toBe(201);

    // Deliver 4 pcs on PO-TEST-900 -> remainQty = 10 - 4 = 6, stockQty = 5 - 4 = 1
    const deliv = await adminAgent.post('/api/v1/orders/PO-TEST-900/deliver').send({ qtyDeliver: 4 });
    expect(deliv.status).toBe(201);
    expect(deliv.body.item.deliveredQty).toBe(4);
    expect(deliv.body.item.stockQty).toBe(1);
    expect(deliv.body.item.remainQty).toBe(6);

    // Traceability check
    const trace = await adminAgent.get('/api/v1/orders/PO-TEST-900/traceability');
    expect(trace.status).toBe(200);
    expect(trace.body.deliveries).toHaveLength(1);

    // QC FAI record & Log void recalculates PO finishedQty
    const qcRes = await adminAgent.post('/api/v1/qc').send({
      inspectionType: 'FAI',
      poId: 'PO-TEST-900',
      ncId: 'NC001',
      result: 'PASS',
      sampleSize: 1,
    });
    expect(qcRes.status).toBe(201);

    const voidLog = await adminAgent
      .patch(`/api/v1/logs/${r2.body.log.id}`)
      .send({ isVoided: true });
    expect(voidLog.status).toBe(200);
    const travAfterVoid = await adminAgent.get('/api/v1/orders/PO-TEST-900/traveler');
    expect(travAfterVoid.body.po.finishedQty).toBe(3);

    // Reassign machine & Attendance batch
    const assignRes = await adminAgent
      .post('/api/v1/operations/NC001/assign-machine')
      .send({ machineName: 'Máy Tiện CNC 2' });
    expect(assignRes.status).toBe(200);

    const batchAtt = await adminAgent.post('/api/v1/attendance/2026-10/batch').send({
      mode: 'OT_FIXED',
      fromDay: 26,
      toDay: 27,
      value: '+2',
      selectedDows: ['T2', 'T3'],
      empIds: ['NV00214'],
      fillEmptyWithDef: true,
    });
    expect(batchAtt.status).toBe(200);
    expect(batchAtt.body.changedCells).toBeGreaterThan(0);
  });

  it('blocks client-tampered isSunday: true on a Wednesday in both /reports/preview and /reports [QA-SEC-01]', async () => {
    const workerAgent = request.agent(app);
    await workerAgent.post('/api/v1/auth/quick-switch').send({ workerId: 'NV00214' });

    // 2026-10-28 is a Wednesday — client attempts to tamper isSunday: true for 2.0x wage + Sunday meal
    const previewRes = await workerAgent.post('/api/v1/reports/preview').send({
      workDate: '2026-10-28',
      isSunday: true,
      shiftType: 'Ca 1 (Sáng 06h-14h)',
      startTime: '06:00',
      endTime: '10:00',
      machineName: 'Máy tiện FUJI',
      poId: 'PO-TEST-900',
      ncId: 'NC001',
      okQty: 2,
    });
    expect(previewRes.status).toBe(200);
    expect(previewRes.body.payroll.isSunday).toBe(false);
    expect(previewRes.body.payroll.shiftMult).toBe(1.0);
    expect(previewRes.body.payroll.mealAllowance).toBe(0);

    const submitRes = await workerAgent.post('/api/v1/reports').send({
      recordUid: 'UID-WED-TAMPER-01',
      workDate: '2026-10-28',
      isSunday: true,
      shiftType: 'Ca 1 (Sáng 06h-14h)',
      startTime: '06:00',
      endTime: '10:00',
      machineName: 'Máy tiện FUJI',
      poId: 'PO-TEST-900',
      ncId: 'NC001',
      okQty: 2,
      selfCheckOk: true,
    });
    expect(submitRes.status).toBe(201);
    expect(submitRes.body.payroll.isSunday).toBe(false);
    expect(submitRes.body.payroll.shiftMult).toBe(1.0);
    expect(submitRes.body.log.isSunday).toBe(0);
  });

  it('recalculates full payroll, batchCost, wipQty and finishedQty on PATCH /api/v1/logs/:id [Critic Major #1 & QA-BIZ-01]', async () => {
    const adminAgent = request.agent(app);
    await adminAgent.post('/api/v1/auth/quick-switch').send({ workerId: 'NV00053' });

    const workerAgent = request.agent(app);
    await workerAgent.post('/api/v1/auth/quick-switch').send({ workerId: 'NV00214' });

    const createPo = await adminAgent.post('/api/v1/orders').send({
      poId: 'PO-TEST-901',
      customer: 'TFG',
      spId: 'SP001',
      productName: 'Pattern Drawing No 2CG00382',
      qtyPo: 10,
      dueDate: '2026-11-20',
    });
    expect(createPo.status).toBe(201);

    // 1. Upstream op NC001 (isFinalOp = 0) with okQty = 4
    const upRes = await workerAgent.post('/api/v1/reports').send({
      recordUid: 'UID-901-UP-1',
      workDate: '2026-10-29',
      shiftType: 'Ca 1 (Sáng 06h-14h)',
      startTime: '06:00',
      endTime: '10:00',
      machineName: 'Máy tiện FUJI',
      poId: 'PO-TEST-901',
      ncId: 'NC001',
      okQty: 4,
      selfCheckOk: true,
    });
    expect(upRes.status).toBe(201);
    const origUpIncome = upRes.body.log.income;
    const origUpBatchCost = upRes.body.payroll.batchCost;
    expect(origUpBatchCost).toBeGreaterThan(0);

    let trav = await adminAgent.get('/api/v1/orders/PO-TEST-901/traveler');
    expect(trav.body.po.wipQty).toBe(4);
    expect(trav.body.po.finishedQty).toBe(0);

    // Edit upstream okQty from 4 -> 2: income, batchCost & PO wipQty must decrease
    const patchUp = await adminAgent
      .patch(`/api/v1/logs/${upRes.body.log.id}`)
      .send({ okQty: 2 });
    expect(patchUp.status).toBe(200);
    expect(patchUp.body.item.okQty).toBe(2);
    expect(patchUp.body.item.income).toBeLessThan(origUpIncome);
    expect(patchUp.body.item.batchCost).toBeLessThan(origUpBatchCost);

    trav = await adminAgent.get('/api/v1/orders/PO-TEST-901/traveler');
    expect(trav.body.po.wipQty).toBe(2);

    // 2. Final op NC003 (isFinalOp = 1) with okQty = 3
    const finRes = await workerAgent.post('/api/v1/reports').send({
      recordUid: 'UID-901-FIN-1',
      workDate: '2026-10-29',
      shiftType: 'Ca 1 (Sáng 06h-14h)',
      startTime: '10:00',
      endTime: '14:00',
      machineName: 'Máy tiện FUJI',
      poId: 'PO-TEST-901',
      ncId: 'NC003',
      okQty: 3,
      selfCheckOk: true,
    });
    expect(finRes.status).toBe(201);
    const origFinIncome = finRes.body.log.income;
    const origFinBatchCost = finRes.body.payroll.batchCost;
    expect(origFinBatchCost).toBeGreaterThan(0);

    // Edit final okQty from 3 -> 1: income & batchCost must decrease proportionally
    const patchFin = await adminAgent
      .patch(`/api/v1/logs/${finRes.body.log.id}`)
      .send({ okQty: 1 });
    expect(patchFin.status).toBe(200);
    expect(patchFin.body.item.okQty).toBe(1);
    expect(patchFin.body.item.income).toBeCloseTo(origFinIncome / 3, -1);
    expect(patchFin.body.item.batchCost).toBeLessThan(origFinBatchCost);

    trav = await adminAgent.get('/api/v1/orders/PO-TEST-901/traveler');
    expect(trav.body.po.finishedQty).toBe(1);

    // Void upstream log -> PO wipQty must drop back to 0
    const voidUp = await adminAgent
      .patch(`/api/v1/logs/${upRes.body.log.id}`)
      .send({ isVoided: true });
    expect(voidUp.status).toBe(200);
    trav = await adminAgent.get('/api/v1/orders/PO-TEST-901/traveler');
    expect(trav.body.po.wipQty).toBe(0);
  });

  it('preserves T10 cumulative attendance in 2026-11, isolates 2027, updates stdToolCost on op edit, and returns 404 on unknown /api routes', async () => {
    const adminAgent = request.agent(app);
    await adminAgent.post('/api/v1/auth/quick-switch').send({ workerId: 'NV00053' });

    const attOct = await adminAgent.get('/api/v1/attendance/2026-10');
    expect(attOct.status).toBe(200);
    const nv214Oct = attOct.body.employees.find((e: any) => e.empId === 'NV00214');
    expect(nv214Oct.regDays).toBeGreaterThan(0);

    const attNov = await adminAgent.get('/api/v1/attendance/2026-11');
    expect(attNov.status).toBe(200);
    const nv214Nov = attNov.body.employees.find((e: any) => e.empId === 'NV00214');
    expect(nv214Nov.yearly.months).toHaveLength(12);
    // Index 9 is T10 -> must preserve NV00214's October regDays (> 0), NOT reset to 0.0!
    expect(nv214Nov.yearly.months[9]).toBeCloseTo(Number(nv214Oct.regDays.toFixed(1)), 1);

    // 2027-01 must NOT copy 2026 T1..T9 historical days
    const attJan27 = await adminAgent.get('/api/v1/attendance/2027-01');
    expect(attJan27.status).toBe(200);
    const nv214Jan27 = attJan27.body.employees.find((e: any) => e.empId === 'NV00214');
    expect(nv214Jan27.yearly.months.slice(1, 9).every((v: number) => v === 0)).toBe(true);

    // PATCH /master/operations/:ncId recalculates stdEdgesPerPcs and stdToolCost
    const opsBefore = await adminAgent.get('/api/v1/master/operations');
    const nc001Before = opsBefore.body.items.find((o: any) => o.ncId === 'NC001');
    const origSec = nc001Before.stdSeconds;
    const origToolCost = nc001Before.stdToolCost;

    const patchOp = await adminAgent
      .patch('/api/v1/master/operations/NC001')
      .send({ stdSeconds: origSec * 2 });
    expect(patchOp.status).toBe(200);
    expect(patchOp.body.item.stdToolCost).toBeGreaterThan(origToolCost);

    // Restore original stdSeconds
    await adminAgent.patch('/api/v1/master/operations/NC001').send({ stdSeconds: origSec });

    // Unknown /api/* route returns JSON 404
    const notFoundApi = await adminAgent.get('/api/v1/unknown-endpoint-xyz');
    expect(notFoundApi.status).toBe(404);
    expect(notFoundApi.body.error).toBe('API endpoint not found');
  });

  it('imports operations from Excel (.xlsx) via exceljs, locks /bootstrap in Strict PIN Mode, and rate-limits PIN brute force [QA-SEC-02 & QA-SEC-03]', async () => {
    const adminAgent = request.agent(app);
    await adminAgent.post('/api/v1/auth/quick-switch').send({ workerId: 'NV00053' });

    // Generate a real .xlsx buffer using exceljs
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('MAU_NAP_NGUYEN_CONG');
    ws.addRow(['KhachHang', 'TenSanPham', 'TenNguyenCong', 'DinhMucGiay', 'BuocCongDoan', 'MayMacDinh', 'MaDaoCu']);
    ws.addRow(['TFG', 'Bích thép thử nghiệm XLSX', 'NC1: Tiện thô', 1800, '1', 'Máy tiện FUJI', 'T01']);
    ws.addRow(['TFG', 'Bích thép thử nghiệm XLSX', 'NC2: Tiện tinh', 2400, 'End', 'Máy tiện FUJI', 'T03']);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());

    const impRes = await adminAgent
      .post('/api/v1/master/operations/import-xlsx')
      .send({ xlsxBase64: buf.toString('base64') });
    expect(impRes.status).toBe(201);
    expect(impRes.body.importedCount).toBe(2);

    // Enable STRICT_PIN mode -> quick-switch disabled (403), unauthenticated /bootstrap locked (401), /auth/session keeps quickSwitchProfiles
    const cfgRes = await adminAgent.put('/api/v1/config').send({ AUTH_MODE: 'STRICT_PIN' });
    expect(cfgRes.status).toBe(200);

    const freshAgent = request.agent(app);
    const blockedSwitch = await freshAgent.post('/api/v1/auth/quick-switch').send({ workerId: 'NV00214' });
    expect(blockedSwitch.status).toBe(403);

    const lockedBoot = await freshAgent.get('/api/v1/bootstrap');
    expect(lockedBoot.status).toBe(401);

    const sessRes = await freshAgent.get('/api/v1/auth/session');
    expect(sessRes.status).toBe(200);
    expect(sessRes.body.authMode).toBe('STRICT_PIN');
    expect(sessRes.body.quickSwitchProfiles.length).toBeGreaterThanOrEqual(13);
    expect(JSON.stringify(sessRes.body.quickSwitchProfiles)).not.toContain('baseSalary');
    expect(JSON.stringify(sessRes.body.quickSwitchProfiles)).not.toContain('pinHash');

    // Brute-force rate limiter: > 5 wrong PIN attempts within 5 minutes -> 429
    expect(typeof (authRoutesModule as any).resetLoginRateLimiter).toBe('function');
    (authRoutesModule as any).resetLoginRateLimiter();

    for (let i = 0; i < 5; i++) {
      const wrongAttempt = await freshAgent
        .post('/api/v1/auth/login')
        .send({ workerId: 'NV00214', pin: '9999' });
      expect(wrongAttempt.status).toBe(401);
    }

    const sixthAttempt = await freshAgent
      .post('/api/v1/auth/login')
      .send({ workerId: 'NV00214', pin: '9999' });
    expect(sixthAttempt.status).toBe(429);
    expect(sixthAttempt.body.error).toContain('Tạm khóa đăng nhập 5 phút do nhập sai PIN quá 5 lần');

    // Reset rate limiter for test & verify valid login clears/unlocks /bootstrap
    (authRoutesModule as any).resetLoginRateLimiter();

    const okPin = await freshAgent.post('/api/v1/auth/login').send({ workerId: 'NV00053', pin: 'admin123' });
    expect(okPin.status).toBe(200);
    expect(okPin.body.user.workerId).toBe('NV00053');

    const unlockedBoot = await freshAgent.get('/api/v1/bootstrap');
    expect(unlockedBoot.status).toBe(200);

    await adminAgent.put('/api/v1/config').send({ AUTH_MODE: 'DEMO_QUICK' });
  });
});
