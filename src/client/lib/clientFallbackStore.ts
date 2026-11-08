import type {
  AndonLivePayload,
  MachineStatus,
  AppRole,
  AttendanceRow,
  AuthSessionResponse,
  AuthSessionUser,
  BootstrapPayload,
  CuttingTool,
  DailyPlanRow,
  EmployeeAttSummary,
  HandoverSlipRow,
  JobTravelerDto,
  MachineInfo,
  OperationMeta,
  Payroll3PRow,
  ProductMeta,
  PurchaseOrderInfo,
  QuickSwitchProfile,
  ReportSubmitPayload,
  ReportSubmitResponse,
  WeeklyProposalItem,
  WeeklyReportData,
  WorkerDto,
  WorkerMonthlyLogAgg,
  OpLogSummary,
  ProductCostingSummary,
  TraceabilityDto,
  DeliveryLogDto,
  QcInspectionDto,
  ProductionLogDto,
} from '@shared/types';
import {
  computeMonthDows,
  computeEmployeeMonthlyStats,
  computeMonthly3PPayroll,
  DEFAULT_MEAL_CONFIG,
  getDefShiftCode,
} from '@shared/attendanceParser';
import { computeProductCosting } from '@shared/costingEngine';
import { calculateTurnPayroll, DEFAULT_PAYROLL_CONFIG } from '@shared/payrollEngine';
import { getLogEffectiveWorkDate } from '@shared/shiftDateHelper';
import { normalizeVn, removeVietnameseTones, normalizePoKey } from '@shared/vnSearch';
import { buildConsolidatedQcList } from './qcLogHelper';
import { canonicalizeCustomerName } from '@shared/customerNormalization';
import seedData from '../../../data/seed_gcck_1233.json';
import { isSupabaseConnected, pushLogToSupabase, pushDailyPlanToSupabase } from './supabaseClient';
import { getBaselineDailyPlan, mergePlanWithBaseline, calculateOpStandardPlanQty } from './baselinePlan';

export { getBaselineDailyPlan, mergePlanWithBaseline, calculateOpStandardPlanQty } from './baselinePlan';

export const GAS_WEBHOOK_URL =
  'https://script.google.com/macros/s/AKfycbx3YEacwHuxAdYb2yN1qckG4tmydnmmK4f8C_KVtQmUWmpBvJYUh_Jc1DrFZpTeM-bruQ/exec';

const LOCAL_LOGS_KEY = 'GCCK_LOCAL_CLIENT_LOGS_V2_NOV2026';
const LOCAL_ORDERS_KEY = 'GCCK_LOCAL_ORDERS_V1';
const LOCAL_DELIVERIES_KEY = 'GCCK_LOCAL_DELIVERIES_V1';
const LOCAL_PRODUCTS_KEY = 'GCCK_LOCAL_PRODUCTS_V2';

// One-time automatic purge of pre-November test logs across devices
if (typeof window !== 'undefined') {
  try {
    localStorage.removeItem('GCCK_LOCAL_CLIENT_LOGS_V1');
    localStorage.removeItem('GCCK_OUTBOX_V1');
  } catch { }
}

function initFallbackProducts(): ProductMeta[] {
  const seedProds: ProductMeta[] = (seedData.costingList || []).map((c: any) => ({
    spId: String(c.spId || ''),
    customer: String(c.customer || 'Vico - Nội bộ / Khách lẻ'),
    productName: String(c.productName || ''),
    matName: String(c.matName || ''),
    setupMinutesStd: Number(c.setupMinutesStd || 0),
    opCount: Number(c.opCount || 0),
    totalStdSeconds: Number(c.totalSec || 0),
    drawingUrl: String(c.drawingUrl || ''),
    techDocUrl: String(c.techDocUrl || ''),
    quotedPrice: Number(c.quotedPrice || 0),
    rawMaterialCost: Number(c.rawMaterialCost || 0),
    outsourceCost: Number(c.outsourceCost || 0),
  }));

  if (typeof window === 'undefined') return seedProds;
  try {
    const raw = localStorage.getItem(LOCAL_PRODUCTS_KEY);
    if (!raw) return seedProds;
    const stored = JSON.parse(raw);
    if (!Array.isArray(stored)) return seedProds;
    const map = new Map<string, ProductMeta>();
    for (const p of seedProds) {
      if (p.productName) map.set(p.productName.trim().toLowerCase(), p);
    }
    for (const p of stored) {
      if (p && p.productName) {
        map.set(p.productName.trim().toLowerCase(), p);
      }
    }
    return Array.from(map.values());
  } catch {
    return seedProds;
  }
}

export const FALLBACK_PRODUCTS: ProductMeta[] = initFallbackProducts();

export function saveFallbackProductsToStorage(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LOCAL_PRODUCTS_KEY, JSON.stringify(FALLBACK_PRODUCTS));
  } catch { }
}

export const FALLBACK_TOOLS: CuttingTool[] = (seedData.toolsList || []).map((t: any) => ({
  code: String(t.code),
  group: String(t.group || 'Tiện CNC'),
  name: String(t.name || ''),
  buyPrice: Number(t.buyPrice || 0),
  edges: Number(t.edges || 1),
  costPerEdge: Number(t.costPerEdge || 0),
  stockQty: Number(t.stockQty ?? 0),
  usedEdgesTotal: Number(t.usedEdgesTotal ?? 0),
}));

const LOCAL_OPERATIONS_KEY = 'GCCK_LOCAL_OPERATIONS_V1';
const LOCAL_MACHINES_KEY = 'GCCK_LOCAL_MACHINES_V1';
const LOCAL_WORKERS_KEY = 'GCCK_LOCAL_WORKERS_V1';

function initFallbackOperations(): OperationMeta[] {
  const seedOps: OperationMeta[] = (seedData.operations || []).map((o: any, idx: number) => {
    const pLower = String(o.productName || '').toLowerCase();
    let effectiveStdSec = Number(o.stdSeconds || 1800);
    // Chuẩn hóa định mức công nghệ Win-Win theo thực tế xưởng:
    // ISHIZUE OMEGA T406.4-1130, ISHIZUEOMEGA S457.2-1150, ISHIZUEOMEGA T457.2-1150: định mức 5 cái/ca 8h = 5760s
    if (
      pLower.includes('457.2') ||
      (pLower.includes('406.4') && pLower.includes('1130')) ||
      (pLower.includes('457') && pLower.includes('1150'))
    ) {
      effectiveStdSec = 5760;
    }

    return {
      ncId: String(o.ncId),
      spId: String(o.spId || `SP${String(idx + 1).padStart(3, '0')}`),
      customer: String(o.customer || 'Vico - Nội bộ / Khách lẻ'),
      productName: String(o.productName),
      opName: String(o.opName),
      stdSeconds: effectiveStdSec,
      stage: String(o.stage || '1'),
      stepOrder: Number(o.stepOrder || idx + 1),
      isFinalOp: Number(o.isFinalOp || (idx % 2 === 1 ? 1 : 0)),
      defaultMachine: String(o.defaultMachine || 'Máy Tiện CNC 1'),
      matName: String(o.matName || ''),
      cuttingRec: String(o.cuttingRec || ''),
      toolCode: String(o.toolCode || ''),
      toolName: String(o.toolName || ''),
      costPerEdge: Number(o.costPerEdge || 0),
      stdEdgesPerPcs: Number(o.stdEdgesPerPcs || 0),
      stdLaborCost: Number(o.stdLaborCost || 0),
      stdMachCost: Number(o.stdMachCost || 0),
      stdToolCost: Number(o.stdToolCost || 0),
      isCriticalCheck: Number(o.isCriticalCheck || 0),
      drawingUrl: o.drawingUrl ? String(o.drawingUrl) : undefined,
      setupDocUrl: o.setupDocUrl ? String(o.setupDocUrl) : undefined,
    };
  });

  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem(LOCAL_OPERATIONS_KEY);
      if (raw) {
        const stored: OperationMeta[] = JSON.parse(raw);
        if (Array.isArray(stored) && stored.length > 0) {
          const map = new Map<string, OperationMeta>();
          for (const s of seedOps) {
            map.set(s.ncId.toLowerCase(), s);
          }
          for (const st of stored) {
            if (st && st.ncId) {
              const existing = map.get(st.ncId.toLowerCase());
              if (existing) {
                map.set(st.ncId.toLowerCase(), { ...existing, ...st, spId: existing.spId });
              } else {
                map.set(st.ncId.toLowerCase(), st);
              }
            }
          }
          return Array.from(map.values());
        }
      }
    } catch {
      // ignore
    }
  }

  return seedOps;
}

export const FALLBACK_OPERATIONS: OperationMeta[] = initFallbackOperations();

export function saveFallbackOperationsToStorage(): void {
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(LOCAL_OPERATIONS_KEY, JSON.stringify(FALLBACK_OPERATIONS));
    } catch {
      // ignore
    }
  }
}

export function ensureProductExists(customer: string, productName: string, spId?: string | null): ProductMeta {
  const cleanName = (productName || '').trim();
  const cleanCust = (customer || 'Vico - Nội bộ / Khách lẻ').trim();
  const key = cleanName.toLowerCase();

  let found = FALLBACK_PRODUCTS.find((p) => p.productName.trim().toLowerCase() === key);
  if (!found && cleanName) {
    const newSpId = (spId && String(spId).trim()) || `SP${String(FALLBACK_PRODUCTS.length + 380).padStart(3, '0')}`;
    found = {
      spId: newSpId,
      customer: cleanCust,
      productName: cleanName,
      matName: 'Thép C45 / S45C',
      setupMinutesStd: 15,
      opCount: 1,
      totalStdSeconds: 1800,
      drawingUrl: '',
      techDocUrl: '',
      quotedPrice: 0,
      rawMaterialCost: 0,
      outsourceCost: 0,
    };
    FALLBACK_PRODUCTS.push(found);
    saveFallbackProductsToStorage();
  }

  if (found) {
    // Also ensure at least one operation exists for this product in FALLBACK_OPERATIONS
    const hasOp = FALLBACK_OPERATIONS.some(
      (o) => (found!.spId && o.spId === found!.spId) || o.productName.trim().toLowerCase() === key
    );
    if (!hasOp) {
      const newNcId = `NC_${found.spId}`;
      FALLBACK_OPERATIONS.push({
        ncId: newNcId,
        spId: found.spId,
        customer: cleanCust,
        productName: cleanName,
        opName: 'G/c hoàn thiện (Theo bản vẽ)',
        stdSeconds: 1800,
        stage: 'End',
        stepOrder: 1,
        isFinalOp: 1,
        defaultMachine: 'Máy Tiện CNC 1',
        matName: 'Thép C45 / S45C',
        cuttingRec: 'Tiện hoàn thiện theo dung sai bản vẽ',
        toolCode: 'T01',
        toolName: 'Mảnh tiện CNMG 120408',
        costPerEdge: 15000,
        stdEdgesPerPcs: 0.1,
        stdLaborCost: 40000,
        stdMachCost: 65000,
        stdToolCost: 2000,
        isCriticalCheck: 0,
      });
      saveFallbackOperationsToStorage();
    }
  }

  return (
    found || {
      spId: spId || 'SP_DEFAULT',
      customer: cleanCust,
      productName: cleanName || 'Sản phẩm cơ khí',
      matName: 'Thép C45 / S45C',
      setupMinutesStd: 15,
      opCount: 1,
      totalStdSeconds: 1800,
      drawingUrl: '',
      techDocUrl: '',
      quotedPrice: 0,
      rawMaterialCost: 0,
      outsourceCost: 0,
    }
  );
}

export function ensureOperationExists(
  customer: string,
  productName: string,
  opName: string,
  machineName?: string,
  spId?: string | null,
  ncId?: string | null,
  stdSeconds = 1800
): OperationMeta {
  const prod = ensureProductExists(customer, productName, spId);
  const cleanOpName = (opName || 'G/c hoàn thiện').trim();
  const cleanProd = prod.productName.trim().toLowerCase();

  let found = FALLBACK_OPERATIONS.find(
    (o) =>
      (ncId && o.ncId.toLowerCase() === ncId.toLowerCase()) ||
      (o.spId && o.spId === prod.spId && o.opName.trim().toLowerCase() === cleanOpName.toLowerCase()) ||
      (o.productName.trim().toLowerCase() === cleanProd && o.opName.trim().toLowerCase() === cleanOpName.toLowerCase()) ||
      (cleanProd.includes('crmining') && o.productName.toLowerCase().includes('crmining'))
  );

  if (found && machineName && (!found.defaultMachine || found.defaultMachine === 'Máy Tiện CNC 1')) {
    found.defaultMachine = machineName;
  }

  if (!found) {
    const finalNcId = ncId || `NC_${prod.spId || Date.now().toString(36)}`;
    found = {
      ncId: finalNcId,
      spId: prod.spId,
      customer: prod.customer,
      productName: prod.productName,
      opName: cleanOpName,
      stdSeconds,
      stage: 'End',
      stepOrder: 1,
      isFinalOp: 1,
      defaultMachine: machineName || 'Máy Phay CNC2',
      matName: prod.matName || 'Thép C45 / S45C',
      cuttingRec: 'Gia công theo yêu cầu',
      toolCode: 'T01',
      toolName: 'Dao phay / tiện tiêu chuẩn',
      costPerEdge: 0,
      stdEdgesPerPcs: 0,
      stdLaborCost: 40000,
      stdMachCost: 65000,
      stdToolCost: 0,
      isCriticalCheck: 0,
    };
    FALLBACK_OPERATIONS.unshift(found);
    saveFallbackOperationsToStorage();
  }

  return found;
}

export function updateFallbackOperation(ncId: string, patch: Partial<OperationMeta>): OperationMeta {
  const normId = ncId.toLowerCase();
  const idx = FALLBACK_OPERATIONS.findIndex((o) => o.ncId.toLowerCase() === normId);
  if (idx < 0) {
    throw new Error(`Không tìm thấy nguyên công ${ncId}`);
  }
  const current = FALLBACK_OPERATIONS[idx];
  const stdSeconds =
    patch.stdSeconds !== undefined
      ? Math.max(10, Math.round(Number(patch.stdSeconds)))
      : current.stdSeconds;
  const costPerEdge = Number(current.costPerEdge || 25000);
  const stdEdgesPerPcs = Number(((stdSeconds / 1800) * 1.0).toFixed(2));
  const stdLaborCost = Math.round(stdSeconds * 13.89);
  const stdMachCost = Math.round((stdSeconds / 3600) * 350000);
  const stdToolCost = Math.round(stdEdgesPerPcs * costPerEdge);

  const updated: OperationMeta = {
    ...current,
    ...patch,
    stdSeconds,
    stdEdgesPerPcs,
    stdLaborCost,
    stdMachCost,
    stdToolCost,
    isCriticalCheck:
      patch.isCriticalCheck !== undefined
        ? patch.isCriticalCheck
          ? 1
          : 0
        : current.isCriticalCheck,
  };
  FALLBACK_OPERATIONS[idx] = updated;
  saveFallbackOperationsToStorage();
  return updated;
}

export function deleteFallbackOperation(ncId: string): void {
  const normId = ncId.toLowerCase();
  const idx = FALLBACK_OPERATIONS.findIndex((o) => o.ncId.toLowerCase() === normId);
  if (idx >= 0) {
    const deleted = FALLBACK_OPERATIONS[idx];
    FALLBACK_OPERATIONS.splice(idx, 1);
    const siblingOps = FALLBACK_OPERATIONS.filter((o) => o.spId === deleted.spId).sort(
      (a, b) => a.stepOrder - b.stepOrder
    );
    siblingOps.forEach((op, index) => {
      op.stepOrder = index + 1;
      op.isFinalOp = index === siblingOps.length - 1 ? 1 : 0;
      op.stage = String(index + 1);
    });
    saveFallbackOperationsToStorage();
  }
}

export function createFallbackOperations(data: {
  customer: string;
  productName: string;
  matName?: string;
  defaultMachine?: string;
  toolCode?: string;
  cuttingRec?: string;
  rawLines?: string;
}): { createdIds: string[]; items: OperationMeta[] } {
  const maxNum = FALLBACK_OPERATIONS.reduce((acc, o) => {
    const m = o.ncId.match(/\d+/);
    return m ? Math.max(acc, parseInt(m[0], 10)) : acc;
  }, 0);
  let nextNum = maxNum + 1;

  let prod = FALLBACK_PRODUCTS.find(
    (p) => p.productName.toLowerCase() === (data.productName || '').trim().toLowerCase()
  );
  const spId = prod ? prod.spId : `SP${String(FALLBACK_PRODUCTS.length + 1).padStart(3, '0')}`;
  if (!prod) {
    FALLBACK_PRODUCTS.push({
      spId,
      customer: data.customer || 'Vico - Nội bộ / Khách lẻ',
      productName: data.productName,
      matName: data.matName || 'Thép C45',
      quotedPrice: 0,
      rawMaterialCost: 0,
      outsourceCost: 0,
      drawingUrl: '',
      techDocUrl: '',
    });
  }

  const lines = (data.rawLines || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const createdIds: string[] = [];
  const existingSpOps = FALLBACK_OPERATIONS.filter((o) => o.spId === spId);
  let currentStep = existingSpOps.length + 1;

  if (lines.length > 0) {
    for (const line of lines) {
      const parts = line.split('|').map((p) => p.trim());
      const opName = parts[0] || 'Gia công cơ khí';
      const stdSeconds = Math.max(10, Number(parts[1]) || 1800);
      const ncId = `NC${String(nextNum++).padStart(3, '0')}`;
      const stdEdges = Number(((stdSeconds / 1800) * 1.0).toFixed(2));
      const op: OperationMeta = {
        ncId,
        spId,
        customer: data.customer || 'Vico - Nội bộ / Khách lẻ',
        productName: data.productName,
        opName,
        stdSeconds,
        stage: String(currentStep),
        stepOrder: currentStep++,
        isFinalOp: 0,
        defaultMachine: data.defaultMachine || 'Máy Tiện CNC 1',
        matName: data.matName || 'Thép C45',
        cuttingRec: data.cuttingRec || 'Vc=100m/p | f=0.15mm/v',
        toolCode: data.toolCode || 'T01',
        toolName: 'Mảnh tiện thô CNMG',
        costPerEdge: 25000,
        stdEdgesPerPcs: stdEdges,
        stdLaborCost: Math.round(stdSeconds * 13.89),
        stdMachCost: Math.round((stdSeconds / 3600) * 350000),
        stdToolCost: Math.round(stdEdges * 25000),
        isCriticalCheck: 0,
      };
      FALLBACK_OPERATIONS.push(op);
      createdIds.push(ncId);
    }
  } else {
    const ncId = `NC${String(nextNum++).padStart(3, '0')}`;
    const stdSeconds = 1800;
    const op: OperationMeta = {
      ncId,
      spId,
      customer: data.customer || 'Vico - Nội bộ / Khách lẻ',
      productName: data.productName,
      opName: 'Gia công hoàn thiện',
      stdSeconds,
      stage: String(currentStep),
      stepOrder: currentStep++,
      isFinalOp: 1,
      defaultMachine: data.defaultMachine || 'Máy Tiện CNC 1',
      matName: data.matName || 'Thép C45',
      cuttingRec: data.cuttingRec || 'Vc=100m/p | f=0.15mm/v',
      toolCode: data.toolCode || 'T01',
      toolName: 'Mảnh tiện thô CNMG',
      costPerEdge: 25000,
      stdEdgesPerPcs: 1.0,
      stdLaborCost: Math.round(stdSeconds * 13.89),
      stdMachCost: Math.round((stdSeconds / 3600) * 350000),
      stdToolCost: 25000,
      isCriticalCheck: 0,
    };
    FALLBACK_OPERATIONS.push(op);
    createdIds.push(ncId);
  }

  const allSpOps = FALLBACK_OPERATIONS.filter((o) => o.spId === spId).sort(
    (a, b) => a.stepOrder - b.stepOrder
  );
  allSpOps.forEach((op, idx) => {
    op.stepOrder = idx + 1;
    op.isFinalOp = idx === allSpOps.length - 1 ? 1 : 0;
    op.stage = String(idx + 1);
  });

  saveFallbackOperationsToStorage();
  return { createdIds, items: FALLBACK_OPERATIONS };
}

export function importFallbackOperations(
  rows: any[]
): { success: boolean; createdCount: number; items: OperationMeta[] } {
  let createdCount = 0;
  const maxNum = FALLBACK_OPERATIONS.reduce((acc, o) => {
    const m = o.ncId.match(/\d+/);
    return m ? Math.max(acc, parseInt(m[0], 10)) : acc;
  }, 0);
  let nextNum = maxNum + 1;

  for (const r of rows) {
    if (!r.productName) continue;
    const ncId = `NC${String(nextNum++).padStart(3, '0')}`;
    let prod = FALLBACK_PRODUCTS.find(
      (p) => p.productName.toLowerCase() === String(r.productName).trim().toLowerCase()
    );
    let spId = prod ? prod.spId : `SP${String(FALLBACK_PRODUCTS.length + 1).padStart(3, '0')}`;
    const stdSeconds = Math.max(10, Number(r.stdSeconds) || 1800);
    const op: OperationMeta = {
      ncId,
      spId,
      customer: String(r.customer || 'Vico - Nội bộ / Khách lẻ').trim(),
      productName: String(r.productName).trim(),
      opName: String(r.opName || 'Gia công tiện phay CNC').trim(),
      stdSeconds,
      stage: '1',
      stepOrder: 1,
      isFinalOp: 1,
      defaultMachine: String(r.defaultMachine || 'Máy Tiện CNC 1').trim(),
      matName: String(r.matName || 'Thép C45').trim(),
      cuttingRec: String(r.cuttingRec || 'Vc=100m/p | f=0.15mm/v').trim(),
      toolCode: String(r.toolCode || 'T01').trim(),
      toolName: 'Mảnh tiện thô CNMG',
      costPerEdge: 25000,
      stdEdgesPerPcs: Number(((stdSeconds / 1800) * 1.0).toFixed(2)),
      stdLaborCost: Math.round(stdSeconds * 13.89),
      stdMachCost: Math.round((stdSeconds / 3600) * 350000),
      stdToolCost: 25000,
      isCriticalCheck: 0,
    };
    FALLBACK_OPERATIONS.push(op);
    createdCount++;
  }
  saveFallbackOperationsToStorage();
  return { success: true, createdCount, items: FALLBACK_OPERATIONS };
}

function initFallbackMachines(): MachineInfo[] {
  const seedMachines: MachineInfo[] = (seedData.machines || []).map((m: any) => ({
    id: String(m.id),
    name: String(m.name),
    group: String(m.group || 'Gia công CNC'),
    costPerHour: Number(m.costPerHour || 250000),
    status: (m.status || 'IDLE') as any,
    currentWorkerName: m.currentWorkerName || null,
    currentPoId: m.currentPoId || null,
    currentNcId: m.currentNcId || null,
    stopReason: m.stopReason || null,
    updatedAt: m.updatedAt || null,
  }));

  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem(LOCAL_MACHINES_KEY);
      if (raw) {
        const stored: MachineInfo[] = JSON.parse(raw);
        if (Array.isArray(stored) && stored.length > 0) {
          const map = new Map<string, MachineInfo>();
          for (const s of seedMachines) map.set(s.id.toLowerCase(), s);
          for (const st of stored) {
            if (st && st.id) {
              const existing = map.get(st.id.toLowerCase());
              if (existing) map.set(st.id.toLowerCase(), { ...existing, ...st });
              else map.set(st.id.toLowerCase(), st);
            }
          }
          return Array.from(map.values());
        }
      }
    } catch {
      // ignore
    }
  }
  return seedMachines;
}

export const FALLBACK_MACHINES: MachineInfo[] = initFallbackMachines();

export function saveFallbackMachinesToStorage(): void {
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(LOCAL_MACHINES_KEY, JSON.stringify(FALLBACK_MACHINES));
    } catch {
      // ignore
    }
  }
}

export function saveFallbackMachine(m: Partial<MachineInfo>): MachineInfo[] {
  if (!m.id) return FALLBACK_MACHINES;
  const idx = FALLBACK_MACHINES.findIndex((x) => x.id.toLowerCase() === m.id!.toLowerCase());
  if (idx >= 0) {
    FALLBACK_MACHINES[idx] = { ...FALLBACK_MACHINES[idx], ...m } as MachineInfo;
  } else {
    FALLBACK_MACHINES.push({
      id: m.id,
      name: m.name || m.id,
      group: m.group || 'Gia công CNC',
      costPerHour: Number(m.costPerHour) || 250000,
      status: 'IDLE',
      currentWorkerName: null,
      currentPoId: null,
      currentNcId: null,
      stopReason: null,
      updatedAt: null,
    });
  }
  saveFallbackMachinesToStorage();
  return FALLBACK_MACHINES;
}

export function saveFallbackTool(
  tool: Partial<CuttingTool>
): { success: boolean; message: string; item: CuttingTool } {
  const code = (tool.code || '').trim();
  const idx = FALLBACK_TOOLS.findIndex((t) => t.code.toLowerCase() === code.toLowerCase());
  const item: CuttingTool = {
    code,
    name: tool.name || code,
    group: tool.group || 'Tiện CNC',
    buyPrice: Number(tool.buyPrice) || 0,
    edges: Number(tool.edges) || 1,
    costPerEdge:
      Number(tool.costPerEdge) ||
      Math.round((Number(tool.buyPrice) || 0) / Math.max(1, Number(tool.edges) || 1)),
    stockQty: Number(tool.stockQty) || 0,
    usedEdgesTotal: Number(tool.usedEdgesTotal) || 0,
  };
  if (idx >= 0) {
    FALLBACK_TOOLS[idx] = item;
  } else {
    FALLBACK_TOOLS.push(item);
  }
  return { success: true, message: 'Đã lưu thông tin dao cụ', item };
}

function initFallbackOrders(): PurchaseOrderInfo[] {
  const seedOrders: PurchaseOrderInfo[] = (seedData.ordersList || []).map((p: any) => {
    const norm = canonicalizeCustomerName(p.customer || 'Nội bộ');
    const qtyPo = Math.max(1, Number(p.qtyPo || 0));
    const wipQty = Math.max(0, Number(p.wipQty || 0));
    const finishedQty = Math.max(0, Number(p.finishedQty || 0));
    const deliveredQty = Math.max(0, Number(p.deliveredQty || 0));
    const stockQty = Math.max(0, Number(p.stockQty ?? (finishedQty - deliveredQty)));
    const remainQty = Math.max(0, Number(p.remainQty ?? (qtyPo - deliveredQty)));

    return {
      poId: String(p.poId),
      spId: p.spId ? String(p.spId) : null,
      customer: norm.customer,
      contractRef: p.contractRef || norm.contractRef || '',
      productName: String(p.productName),
      qtyPo,
      dueDate: String(p.dueDate || '2026-11-30'),
      wipQty,
      finishedQty,
      deliveredQty,
      stockQty,
      remainQty,
      status: String(p.status || '⏳ Đang chờ SX'),
      materialLot: p.materialLot || 'LOT-2026-VC',
      faiStatus: p.faiStatus || 'FAI_PASSED',
      note: p.note || norm.contractRef || '',
    };
  });

  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem(LOCAL_ORDERS_KEY);
      if (raw) {
        const stored: PurchaseOrderInfo[] = JSON.parse(raw);
        if (Array.isArray(stored) && stored.length > 0) {
          const map = new Map<string, PurchaseOrderInfo>();
          for (const s of seedOrders) {
            map.set(s.poId.toLowerCase(), s);
          }
          for (const st of stored) {
            if (st && st.poId) {
              const existing = map.get(st.poId.toLowerCase());
              // Auto-cap any previously over-delivered orders (e.g. 13/12, 4/3, 111/110)
              if (Number(st.deliveredQty || 0) > Number(st.qtyPo || 0)) {
                st.deliveredQty = Number(st.qtyPo || 0);
                st.stockQty = Math.max(0, Number(st.finishedQty || 0) - st.deliveredQty);
                st.remainQty = 0;
                st.status = '✅ Đã giao đủ';
              }
              if (existing) {
                map.set(st.poId.toLowerCase(), { ...existing, ...st });
              } else {
                map.set(st.poId.toLowerCase(), st);
              }
            }
          }
          return Array.from(map.values());
        }
      }
    } catch {
      // ignore
    }
  }

  return seedOrders;
}

export const FALLBACK_ORDERS: PurchaseOrderInfo[] = initFallbackOrders();

export function saveFallbackOrdersToStorage(): void {
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(LOCAL_ORDERS_KEY, JSON.stringify(FALLBACK_ORDERS));
    } catch {
      // ignore
    }
  }
}

function initFallbackWorkers(): WorkerDto[] {
  const seedWorkers: WorkerDto[] = (seedData.workers || []).map((w: any) => {
    let appRole: AppRole = 'WORKER';
    let role = String(w.role || 'CN');
    let title = String(w.title || 'Công nhân');

    if (w.id === 'NV00053') {
      // Duy nhất Quản đốc Hoàng Ngọc Hà là Quản trị viên (ADMIN)
      appRole = 'ADMIN';
      role = 'QĐ';
      title = 'Quản đốc xưởng';
    } else if (w.id === 'NV00266' || w.id === 'NV00215' || w.id === 'NV00267') {
      // Duy nhất 3 Trưởng ca: Dũng (NV00266), Tráng (NV00215), Phúc (NV00267)
      appRole = 'SHIFT_LEADER';
      role = 'TC';
      title = 'Trưởng ca';
    } else if (w.id === 'NV00214') {
      // Trần Văn Quỳnh là công nhân bình thường
      appRole = 'WORKER';
      role = 'CN';
      title = 'Công nhân phay CNC';
    } else {
      appRole = 'WORKER';
    }

    return {
      id: String(w.id),
      name: String(w.name),
      username: String(w.username || w.name),
      role,
      appRole,
      title,
      salaryMode: String(w.salaryMode || 'KHOAN'),
      baseSalary: Number(w.baseSalary || 400000),
      isActive: w.isActive !== undefined ? Number(w.isActive) : 1,
      isLinked: true,
      chatId: w.chatId ? String(w.chatId) : null,
    };
  });

  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem(LOCAL_WORKERS_KEY);
      if (raw) {
        const stored: WorkerDto[] = JSON.parse(raw);
        if (Array.isArray(stored) && stored.length > 0) {
          const map = new Map<string, WorkerDto>();
          for (const s of seedWorkers) map.set(s.id.toLowerCase(), s);
          for (const st of stored) {
            if (st && st.id) {
              const existing = map.get(st.id.toLowerCase());
              // Enforce strict roles: Hà is ADMIN, Dũng/Tráng/Phúc are SHIFT_LEADER, all others are WORKER
              let appRole: AppRole = 'WORKER';
              let role = st.role || 'CN';
              let title = st.title || 'Công nhân';
              if (st.id === 'NV00053') {
                appRole = 'ADMIN';
                role = 'QĐ';
                title = 'Quản đốc xưởng';
              } else if (['NV00266', 'NV00215', 'NV00267'].includes(st.id)) {
                appRole = 'SHIFT_LEADER';
                role = 'TC';
                title = 'Trưởng ca';
              } else if (st.id === 'NV00214') {
                appRole = 'WORKER';
                role = 'CN';
                title = 'Công nhân phay CNC';
              } else {
                appRole = 'WORKER';
              }
              const sanitized: WorkerDto = {
                ...existing,
                ...st,
                appRole,
                role,
                title,
              };
              map.set(st.id.toLowerCase(), sanitized);
            }
          }
          const finalWorkers = Array.from(map.values());
          localStorage.setItem(LOCAL_WORKERS_KEY, JSON.stringify(finalWorkers));
          return finalWorkers;
        }
      }
    } catch {
      // ignore
    }
  }

  return seedWorkers;
}

export const FALLBACK_WORKERS: WorkerDto[] = initFallbackWorkers();

export function saveFallbackWorkersToStorage(): void {
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(LOCAL_WORKERS_KEY, JSON.stringify(FALLBACK_WORKERS));
    } catch {
      // ignore
    }
  }
}

export function saveFallbackWorker(w: Partial<WorkerDto>): WorkerDto[] {
  if (!w.id) return FALLBACK_WORKERS;
  const idx = FALLBACK_WORKERS.findIndex((x) => x.id.toLowerCase() === w.id!.toLowerCase());
  let appRole: AppRole = 'WORKER';
  let role = w.role || 'CN';
  let title = w.title || 'Công nhân đứng máy CNC';
  if (w.id === 'NV00053') {
    appRole = 'ADMIN';
    role = 'QĐ';
    title = 'Quản đốc xưởng';
  } else if (['NV00266', 'NV00215', 'NV00267'].includes(w.id)) {
    appRole = 'SHIFT_LEADER';
    role = 'TC';
    title = 'Trưởng ca';
  } else if (w.id === 'NV00214') {
    appRole = 'WORKER';
    role = 'CN';
    title = 'Công nhân phay CNC';
  } else {
    appRole = 'WORKER';
  }
  const workerObj: WorkerDto = {
    id: w.id.toUpperCase(),
    name: w.name || w.id,
    username: (w.username || w.id).toLowerCase(),
    role,
    appRole,
    title,
    salaryMode: w.salaryMode || 'Khoán 1 + 0.33 máy',
    baseSalary: Number(w.baseSalary) || 400000,
    isActive: w.isActive !== undefined ? Number(w.isActive) : 1,
    isLinked: Boolean(w.chatId),
    chatId: w.chatId ? String(w.chatId) : null,
  };
  if (idx >= 0) {
    FALLBACK_WORKERS[idx] = { ...FALLBACK_WORKERS[idx], ...workerObj };
  } else {
    FALLBACK_WORKERS.push(workerObj);
  }
  saveFallbackWorkersToStorage();
  return FALLBACK_WORKERS;
}

export function toggleActiveFallbackWorker(
  workerId: string
): { success: boolean; isActive: number; message: string; workers: WorkerDto[] } {
  const idx = FALLBACK_WORKERS.findIndex((x) => x.id.toLowerCase() === workerId.toLowerCase());
  if (idx < 0) throw new Error('Không tìm thấy tài khoản nhân viên');
  const nextActive = FALLBACK_WORKERS[idx].isActive === 0 ? 1 : 0;
  FALLBACK_WORKERS[idx].isActive = nextActive;
  saveFallbackWorkersToStorage();
  return {
    success: true,
    isActive: nextActive,
    message:
      nextActive === 1
        ? `Đã mở khóa tài khoản ${FALLBACK_WORKERS[idx].name}`
        : `Đã khóa tài khoản ${FALLBACK_WORKERS[idx].name}`,
    workers: FALLBACK_WORKERS,
  };
}

export function deleteFallbackWorker(workerId: string): WorkerDto[] {
  const idx = FALLBACK_WORKERS.findIndex((x) => x.id.toLowerCase() === workerId.toLowerCase());
  if (idx >= 0) {
    FALLBACK_WORKERS.splice(idx, 1);
    saveFallbackWorkersToStorage();
  }
  return FALLBACK_WORKERS;
}

export const FALLBACK_PROFILES: QuickSwitchProfile[] = FALLBACK_WORKERS.filter(
  (w) => w.isActive !== 0
).map((w) => ({
  workerId: w.id,
  name: w.name,
  role: w.role,
  appRole: w.appRole,
  title: w.title,
  salaryMode: w.salaryMode,
}));

const CUSTOM_PINS_KEY = 'GCCK_WORKER_CUSTOM_PINS_V1';

export function getCustomPin(workerId: string): string | null {
  try {
    if (typeof window === 'undefined') return null;
    const raw = localStorage.getItem(CUSTOM_PINS_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw);
    return map[workerId.toUpperCase()] || null;
  } catch {
    return null;
  }
}

export function setCustomPin(workerId: string, newPin: string): void {
  try {
    if (typeof window === 'undefined') return;
    const raw = localStorage.getItem(CUSTOM_PINS_KEY);
    const map = raw ? JSON.parse(raw) : {};
    map[workerId.toUpperCase()] = newPin;
    localStorage.setItem(CUSTOM_PINS_KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
}

export function findFallbackWorker(query?: string | null): WorkerDto | undefined {
  if (!query) return undefined;
  const raw = query.trim();
  if (!raw) return undefined;
  const lower = raw.toLowerCase();

  // 1. Exact ID case-insensitive (e.g. NV00215, nv00215)
  let found = FALLBACK_WORKERS.find((w) => w.id.toLowerCase() === lower);
  if (found) return found;

  // 2. Exact username case-insensitive (e.g. vantrang, congthang)
  found = FALLBACK_WORKERS.find((w) => w.username && w.username.toLowerCase() === lower);
  if (found) return found;

  // 3. Name match case-insensitive
  found = FALLBACK_WORKERS.find((w) => w.name.toLowerCase() === lower);
  if (found) return found;

  // 4. Name match without Vietnamese tones
  const normSearch = removeVietnameseTones(lower);
  found = FALLBACK_WORKERS.find((w) => {
    const wNorm = removeVietnameseTones(w.name.toLowerCase());
    return wNorm === normSearch || wNorm.includes(normSearch) || normSearch.includes(wNorm);
  });
  if (found) return found;

  return undefined;
}

export function verifyFallbackPin(workerIdOrUsername: string, pin: string): boolean {
  const worker = findFallbackWorker(workerIdOrUsername);
  if (!worker) return false;

  const custom = getCustomPin(worker.id);
  if (custom) {
    return custom === pin;
  }

  if (worker.id === 'NV00053') {
    return pin === 'admin123' || pin === '1234';
  }
  return pin === '1234';
}

export function getFallbackUser(workerIdOrUsername?: string): AuthSessionUser {
  let worker: WorkerDto | undefined;
  if (workerIdOrUsername) {
    worker = findFallbackWorker(workerIdOrUsername);
  }
  if (!worker && typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem('GCCK_ACTIVE_WORKER_ID');
      if (stored) worker = findFallbackWorker(stored);
    } catch { }
  }
  const w = worker || FALLBACK_WORKERS[0];
  return {
    workerId: w.id,
    name: w.name,
    username: w.username,
    role: w.role,
    appRole: w.appRole,
    title: w.title,
    salaryMode: w.salaryMode,
    isLinked: true,
    chatId: w.chatId,
  };
}

export function getClientStoredLogs(): any[] {
  try {
    const raw = localStorage.getItem(LOCAL_LOGS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];

    // Filter out any corrupted orphan entries missing workerName & workerId
    const validLogs = parsed.filter(
      (l) => l && typeof l === 'object' && (Boolean(l.workerName) || Boolean(l.workerId))
    );
    if (validLogs.length !== parsed.length) {
      try {
        localStorage.setItem(LOCAL_LOGS_KEY, JSON.stringify(validLogs));
      } catch { }
    }

    return validLogs.map((l) => {
      const ok = Number(l.okQty || 0);
      const rework = Number(l.reworkQty || 0);
      const scrap = Number(l.scrapQty || 0);
      const totalMachined = ok + rework + scrap;
      const stopMin = Number(l.stopMinutes || 0);
      const stdSec = Number(l.stdSeconds || 1800);
      const earnedSec = totalMachined * stdSec;
      const netSec = Math.max(1, 28800 - stopMin * 60);
      const computedPct = Math.round((earnedSec / netSec) * 100);

      if (totalMachined === 0 && stopMin === 0 && l.kpiStatus === 'Đạt 100% ĐM') {
        return {
          ...l,
          kpiPct: 0,
          kpiStatus: '🚨 0% ĐM',
        };
      }

      if (l.kpiStatus === 'Đạt 100% ĐM' && computedPct < 100 && stopMin === 0) {
        return {
          ...l,
          kpiPct: computedPct,
          kpiStatus:
            computedPct < 50
              ? `🚨 RẤT THẤP (${computedPct}% ĐM)`
              : `⚠️ Chưa đạt ĐM (${computedPct}%)`,
        };
      }
      return l;
    });
  } catch {
    return [];
  }
}

export function clearAllClientStoredLogs(): void {
  try {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(LOCAL_LOGS_KEY);
      localStorage.removeItem('GCCK_LOCAL_CLIENT_LOGS_V1');
      localStorage.removeItem('GCCK_OUTBOX_V1');
      localStorage.removeItem('GCCK_HANDOVERS_V1');
    }
  } catch {
    // ignore
  }
}

export function saveClientStoredLog(log: any): void {
  try {
    if (!log || (!log.workerName && !log.workerId)) return;
    const existing = getClientStoredLogs();
    const uidKey = log.recordUid ? String(log.recordUid) : '';
    const idKey = log.id !== undefined && log.id !== null ? String(log.id) : '';
    const idx = existing.findIndex(
      (e) =>
        (uidKey && String(e.recordUid) === uidKey) ||
        (idKey && String(e.id) === idKey)
    );
    if (idx >= 0) {
      existing[idx] = { ...existing[idx], ...log };
    } else {
      existing.unshift(log);
    }
    localStorage.setItem(LOCAL_LOGS_KEY, JSON.stringify(existing.slice(0, 200)));
  } catch {
    // ignore
  }
}

export function syncClientStoredLogsWithCloud(cloudLogs: any[]): void {
  try {
    if (typeof window === 'undefined' || !Array.isArray(cloudLogs) || cloudLogs.length === 0) return;
    const existing = getClientStoredLogs();
    const cloudMap = new Map<string, any>();
    for (const c of cloudLogs) {
      if (!c || (!c.workerName && !c.workerId)) continue;
      const key = String(c.recordUid || c.id);
      cloudMap.set(key, c);
    }
    // Preserve only very recent offline logs (< 2 mins old) not yet in cloud
    const nowMs = Date.now();
    for (const loc of existing) {
      if (!loc || (!loc.workerName && !loc.workerId)) continue;
      const key = String(loc.recordUid || loc.id);
      if (!cloudMap.has(key)) {
        const createdMs = new Date(loc.createdAt || 0).getTime() || 0;
        if (nowMs - createdMs < 120000 && loc.isVoided !== 1) {
          cloudMap.set(key, loc);
        }
      }
    }
    const merged = Array.from(cloudMap.values()).sort((a, b) => {
      const tA = new Date(a.createdAt || a.workDate).getTime() || 0;
      const tB = new Date(b.createdAt || b.workDate).getTime() || 0;
      return tB - tA;
    });
    localStorage.setItem(LOCAL_LOGS_KEY, JSON.stringify(merged.slice(0, 250)));
  } catch {
    // ignore
  }
}

export function updateFallbackLog(id: string | number, patch: any): void {
  try {
    const existing = getClientStoredLogs();
    const key = String(id);
    const idx = existing.findIndex((e) => String(e.id) === key || String(e.recordUid) === key);
    if (idx >= 0) {
      existing[idx] = { ...existing[idx], ...patch };
      localStorage.setItem(LOCAL_LOGS_KEY, JSON.stringify(existing.slice(0, 200)));
    }
  } catch {
    // ignore
  }
}

export function deleteFallbackLog(id: string | number): void {
  try {
    const existing = getClientStoredLogs();
    const key = String(id);
    const filtered = existing.filter((e) => String(e.id) !== key && String(e.recordUid) !== key && e.isVoided !== 1);
    localStorage.setItem(LOCAL_LOGS_KEY, JSON.stringify(filtered.slice(0, 200)));
  } catch {
    // ignore
  }
}

export function voidFallbackLog(id: string | number): void {
  deleteFallbackLog(id);
}

export function getAllFallbackLogs(): any[] {
  const stored = getClientStoredLogs();
  const seen = new Set<string>();
  const list: any[] = [];
  for (const l of stored) {
    if (l.isVoided === 1) continue;
    const key = String(l.recordUid || l.id);
    if (!seen.has(key)) {
      seen.add(key);
      list.push(l);
    }
  }
  return list;
}

const LOCAL_HANDOVERS_KEY = 'GCCK_LOCAL_HANDOVERS_V2';

export const INITIAL_HANDOVERS: HandoverSlipRow[] = [];

export function syncOrdersWithHandovers(): void {
  try {
    const handovers = getFallbackHandovers();
    const allLogs = getAllFallbackLogs();
    let changed = false;

    // Group POs by product (linking by spId or normalized productName)
    const productGroups: PurchaseOrderInfo[][] = [];
    for (const po of FALLBACK_ORDERS) {
      const pName = (po.productName || '').trim().toLowerCase();
      const pSp = (po.spId || '').trim().toUpperCase();

      let matchedGroup = productGroups.find((g) =>
        g.some(
          (item) =>
            (pSp && item.spId && item.spId.trim().toUpperCase() === pSp) ||
            (pName && item.productName.trim().toLowerCase() === pName)
        )
      );

      if (matchedGroup) {
        matchedGroup.push(po);
      } else {
        productGroups.push([po]);
      }
    }

    // Process each product group with FIFO Waterfall allocation (Ưu tiên ngày gần nhất, thừa tự vào đơn tiếp, đơn cuối nhận tồn kho)
    for (const group of productGroups) {
      const groupPoNorms = new Set<string>();
      const groupSpIds = new Set<string>();
      const groupNames = new Set<string>();

      for (const o of group) {
        if (o.poId) groupPoNorms.add(normalizePoKey(o.poId));
        if (o.spId) groupSpIds.add(o.spId.trim().toUpperCase());
        if (o.productName) groupNames.add(o.productName.trim().toLowerCase());
      }

      // Collect all logs matching this product group
      const matchingLogs = allLogs.filter((l) => {
        if (l.isVoided) return false;
        const lPo = (l.poId || '').trim();
        if (lPo && groupPoNorms.has(normalizePoKey(lPo))) return true;
        const lSp = (l.spId || '').trim().toUpperCase();
        if (lSp && groupSpIds.has(lSp)) return true;
        const lProd = (l.productName || '').trim().toLowerCase();
        if (lProd && groupNames.has(lProd)) return true;
        return false;
      });

      // Total finished quantity produced across all logs for final/completed ops
      const logFinTotal = matchingLogs.reduce((sum, l) => {
        const isFinal =
          l.isFinalOp === 1 ||
          l.stage === 'End' ||
          String(l.opName || '').toLowerCase().includes('hoàn thiện') ||
          String(l.opName || '').toLowerCase().includes('end') ||
          String(l.opName || '').toLowerCase().includes('g/c') ||
          String(l.opName || '').toLowerCase().includes('tiện') ||
          String(l.opName || '').toLowerCase().includes('phay');
        return isFinal ? sum + (Number(l.okQty) || 0) : sum;
      }, 0);

      // Total handovers
      const relatedHandovers = (handovers || []).filter((h) => {
        const hPo = (h.poId || '').trim();
        if (hPo && groupPoNorms.has(normalizePoKey(hPo))) return true;
        const hProd = (h.productName || '').trim().toLowerCase();
        return Boolean(hProd && groupNames.has(hProd));
      });
      const hovFinTotal = relatedHandovers.reduce((s, h) => s + (Number(h.prodQtyTransferred) || 0), 0);
      const hovRawTotal = relatedHandovers.reduce((s, h) => s + (Number(h.rawQtyTransferred) || 0), 0);

      const manualFinTotal = group.reduce((s, o) => s + Number((o as any).initialFinishedQty || 0), 0);
      const manualRawTotal = group.reduce((s, o) => s + Number((o as any).initialWipQty || 0), 0);

      let poolFin = Math.max(manualFinTotal + logFinTotal, hovFinTotal, logFinTotal);
      let poolRaw = Math.max(hovRawTotal, manualRawTotal);

      // Separate closed vs open orders
      const closedOrders: PurchaseOrderInfo[] = [];
      const openOrders: PurchaseOrderInfo[] = [];

      for (const po of group) {
        const isClosed = Number(po.deliveredQty || 0) >= po.qtyPo || po.status === '✅ Đã giao đủ';
        if (isClosed) {
          closedOrders.push(po);
        } else {
          openOrders.push(po);
        }
      }

      // 1. Maintain closed orders (delivered)
      for (const cPo of closedOrders) {
        const delivered = Number(cPo.deliveredQty || 0);
        if (cPo.finishedQty !== delivered) {
          cPo.finishedQty = delivered;
          changed = true;
        }
        if (cPo.wipQty !== 0) {
          cPo.wipQty = 0;
          changed = true;
        }
        if (cPo.stockQty !== 0) {
          cPo.stockQty = 0;
          changed = true;
        }
        if (cPo.remainQty !== 0) {
          cPo.remainQty = 0;
          changed = true;
        }
        if (cPo.status !== '✅ Đã giao đủ') {
          cPo.status = '✅ Đã giao đủ';
          changed = true;
        }
        poolFin = Math.max(0, poolFin - delivered);
      }

      // 2. Waterfall Rollover for Open Orders:
      // Sắp xếp ưu tiên các đơn hàng có ngày gần nhất (dueDate ASC)
      if (openOrders.length > 0) {
        openOrders.sort((a, b) => {
          const dateA = a.dueDate ? a.dueDate.trim() : '9999-12-31';
          const dateB = b.dueDate ? b.dueDate.trim() : '9999-12-31';
          const cmp = dateA.localeCompare(dateB);
          if (cmp !== 0) return cmp;
          return a.poId.localeCompare(b.poId);
        });

        for (let i = 0; i < openOrders.length; i++) {
          const po = openOrders[i];
          const isLastOrder = i === openOrders.length - 1;
          const delivered = Number(po.deliveredQty || 0);
          const needed = Math.max(0, po.qtyPo - delivered);

          // Phân bổ Finished Qty (Sản lượng hoàn thiện):
          let allocFin = 0;
          if (!isLastOrder) {
            // Đơn hàng chưa phải cuối: nhận tối đa đến đủ số lượng đặt của đơn
            allocFin = Math.min(poolFin, needed);
            poolFin -= allocFin; // Thừa đơn thì tự vào các đơn tiếp theo!
          } else {
            // Đơn cuối cùng: không có đơn tiếp thì tính cho hàng tồn của đơn cuối!
            allocFin = poolFin;
            poolFin = 0;
          }

          const targetFin = delivered + allocFin;
          if (po.finishedQty !== targetFin) {
            po.finishedQty = targetFin;
            changed = true;
          }

          // Phân bổ Phôi WIP:
          const neededRaw = Math.max(0, po.qtyPo - targetFin);
          let allocRaw = 0;
          if (!isLastOrder) {
            allocRaw = Math.min(poolRaw, neededRaw);
            poolRaw -= allocRaw;
          } else {
            allocRaw = poolRaw;
            poolRaw = 0;
          }
          if (po.wipQty !== allocRaw) {
            po.wipQty = allocRaw;
            changed = true;
          }

          // Tính tồn kho & số còn lại:
          const targetStock = Math.max(0, po.finishedQty - delivered);
          const targetRemain = Math.max(0, po.qtyPo - delivered);
          if (po.stockQty !== targetStock) {
            po.stockQty = targetStock;
            changed = true;
          }
          if (po.remainQty !== targetRemain) {
            po.remainQty = targetRemain;
            changed = true;
          }

          if (targetFin > 0 && po.faiStatus !== 'FAI_PASSED') {
            po.faiStatus = 'FAI_PASSED';
            changed = true;
          }

          // Trạng thái đơn:
          let targetStatus = '⏳ Đang chờ SX';
          if (delivered >= po.qtyPo) {
            targetStatus = '✅ Đã giao đủ';
          } else if (po.finishedQty >= po.qtyPo) {
            targetStatus = '📦 Xong CK - Chờ giao';
          } else if (po.wipQty > 0 || po.finishedQty > 0) {
            targetStatus = '⚙️ Đang gia công';
          }
          if (po.status !== targetStatus) {
            po.status = targetStatus;
            changed = true;
          }
        }
      } else if (closedOrders.length > 0 && poolFin > 0) {
        // Nếu tất cả các đơn đều đã giao đủ mà xưởng vẫn gia công thêm:
        // Đơn cuối cùng giữ số lượng thừa làm hàng tồn kho
        const lastPo = closedOrders[closedOrders.length - 1];
        const delivered = Number(lastPo.deliveredQty || 0);
        const targetFin = delivered + poolFin;
        if (lastPo.finishedQty !== targetFin) {
          lastPo.finishedQty = targetFin;
          lastPo.stockQty = poolFin;
          lastPo.status = '📦 Xong CK - Chờ giao';
          changed = true;
        }
      }
    }

    if (changed) {
      saveFallbackOrdersToStorage();
    }
  } catch (err) {
    console.warn('syncOrdersWithHandovers error:', err);
  }
}

export function getFallbackHandovers(dateStr?: string): HandoverSlipRow[] {
  try {
    // Clear old sample cache if present
    localStorage.removeItem('GCCK_LOCAL_HANDOVERS_V1');
    const raw = localStorage.getItem(LOCAL_HANDOVERS_KEY);
    const list: HandoverSlipRow[] = raw ? JSON.parse(raw) : INITIAL_HANDOVERS;
    if (dateStr) {
      return list.filter((h) => h.handoverDate === dateStr);
    }
    return list;
  } catch {
    return [];
  }
}

export function clearAllFallbackHandovers(): void {
  try {
    localStorage.removeItem(LOCAL_HANDOVERS_KEY);
    localStorage.removeItem('GCCK_LOCAL_HANDOVERS_V1');
  } catch {
    // ignore
  }
}

export function saveFallbackHandover(row: HandoverSlipRow): void {
  try {
    const list = getFallbackHandovers();
    const cleanPoId = (row.poId || '').trim().toLowerCase();
    const cleanProdName = (row.productName || '').trim().toLowerCase();

    const matchingPo = FALLBACK_ORDERS.find(
      (o) => cleanPoId ? o.poId.toLowerCase() === cleanPoId : (cleanProdName && o.productName.trim().toLowerCase() === cleanProdName)
    );

    // Calculate prior transfers from other slips for the same PO/product
    const otherSlips = list.filter((h) => {
      if (h.id === row.id) return false;
      const hPo = (h.poId || '').trim().toLowerCase();
      if (cleanPoId && hPo) {
        return hPo === cleanPoId;
      }
      return Boolean(cleanProdName && (h.productName || '').trim().toLowerCase() === cleanProdName);
    });

    const priorProdTransferred = otherSlips.reduce((sum, h) => sum + (Number(h.prodQtyTransferred) || 0), 0);
    const priorRawTransferred = otherSlips.reduce((sum, h) => sum + (Number(h.rawQtyTransferred) || 0), 0);
    const cumulativeProdTransferred = priorProdTransferred + (Number(row.prodQtyTransferred) || 0);
    const cumulativeRawTransferred = priorRawTransferred + (Number(row.rawQtyTransferred) || 0);

    // Auto-calculate missing quantities based on matching PO and cumulative transfers
    if (matchingPo && matchingPo.qtyPo > 0) {
      if (!row.prodQtyMissing || row.prodQtyMissing <= 0 || row.prodQtyMissing === (matchingPo.qtyPo - (Number(row.prodQtyTransferred) || 0))) {
        row.prodQtyMissing = Math.max(0, matchingPo.qtyPo - cumulativeProdTransferred - (Number(row.prodQtyDefect) || 0));
      }
      if (!row.rawQtyMissing || row.rawQtyMissing <= 0 || row.rawQtyMissing === (matchingPo.qtyPo - (Number(row.rawQtyTransferred) || 0))) {
        row.rawQtyMissing = Math.max(0, matchingPo.qtyPo - cumulativeRawTransferred - (Number(row.rawQtyDefect) || 0));
      }
    }

    const idx = list.findIndex((h) => h.id === row.id);
    if (idx >= 0) {
      list[idx] = row;
    } else {
      list.unshift(row);
    }
    localStorage.setItem(LOCAL_HANDOVERS_KEY, JSON.stringify(list));

    // Synchronize received phôi and finished BTP to matching PO
    if (matchingPo) {
      matchingPo.wipQty = Math.max(Number(matchingPo.wipQty || 0), cumulativeRawTransferred, Number(row.rawQtyTransferred || 0));
      matchingPo.finishedQty = cumulativeProdTransferred;
      matchingPo.stockQty = Math.max(0, (matchingPo.finishedQty || 0) - (matchingPo.deliveredQty || 0));
      matchingPo.remainQty = Math.max(0, matchingPo.qtyPo - (matchingPo.deliveredQty || 0));
      if (matchingPo.deliveredQty >= matchingPo.qtyPo) {
        matchingPo.status = '✅ Đã giao đủ';
      } else if (matchingPo.finishedQty >= matchingPo.qtyPo) {
        matchingPo.status = '📦 Xong CK - Chờ giao';
      } else if ((matchingPo.wipQty || 0) > 0 || (matchingPo.finishedQty || 0) > 0) {
        matchingPo.status = '⚙️ Đang gia công';
      }
      saveFallbackOrdersToStorage();
    }
  } catch {
    // ignore
  }
}

export function updateFallbackHandover(
  id: string,
  patch: Partial<HandoverSlipRow>
): HandoverSlipRow | null {
  try {
    const list = getFallbackHandovers();
    const idx = list.findIndex((h) => String(h.id) === String(id));
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...patch };
      localStorage.setItem(LOCAL_HANDOVERS_KEY, JSON.stringify(list));
      return list[idx];
    }
    return null;
  } catch {
    return null;
  }
}

export function deleteFallbackHandover(id: string): void {
  try {
    const list = getFallbackHandovers().filter((h) => h.id !== id);
    localStorage.setItem(LOCAL_HANDOVERS_KEY, JSON.stringify(list));
    syncOrdersWithHandovers();
  } catch {
    // ignore
  }
}

export function getFallbackBootstrap(currentUser?: AuthSessionUser | null): BootstrapPayload {
  // Ensure every order has a registered product and default operation in bootstrap
  for (const po of FALLBACK_ORDERS) {
    if (po.productName) {
      ensureProductExists(po.customer, po.productName, po.spId);
    }
  }
  syncOrdersWithHandovers();
  const user = currentUser || getFallbackUser('NV00214');
  const combinedLogs = getAllFallbackLogs();

  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const vnToday = `${yyyy}-${mm}-${dd}`;

  const todayAccumulated: Record<string, number> = {};
  for (const log of combinedLogs) {
    if (!log.isVoided && log.workerId) {
      const effDate = getLogEffectiveWorkDate(log);
      if (effDate === vnToday) {
        const inc = Number((log as any).income ?? (log as any).batchCost ?? (log as any).turnTotalIncome ?? 0);
        todayAccumulated[log.workerId] = (todayAccumulated[log.workerId] || 0) + inc;
      }
    }
  }

  return {
    user,
    authMode: 'DEMO_QUICK',
    vietnamToday: vnToday,
    isSundayToday: now.getDay() === 0,
    workers: FALLBACK_WORKERS,
    machines: FALLBACK_MACHINES,
    toolsList: FALLBACK_TOOLS,
    products: FALLBACK_PRODUCTS,
    operations: FALLBACK_OPERATIONS,
    ordersList: [...FALLBACK_ORDERS],
    schedules: [],
    machineLoads: [],
    qcInspections: buildConsolidatedQcList([], combinedLogs),
    recentLogs: combinedLogs,
    todayAccumulated,
    opDoneMap: {},
    kpiSummary: {
      totalOk: 0,
      totalRework: 0,
      totalScrap: 0,
      totalStopMinutes: 0,
      runningMachines: 0,
      bottleneckMachines: 0,
      openOrders: FALLBACK_ORDERS.length,
      overdueOrders: 0,
    },
    shiftHandoverAlerts: [],
    config: {
      WEB_APP_URL: GAS_WEBHOOK_URL,
      MANAGER_CHAT_ID: '5422717407',
      SECONDS_PER_SHIFT: '28800',
      SECOND_MACHINE_RATE: '0.33',
      MEAL_SHIFT_2_3: '25000',
      MEAL_OT_2H: '25000',
      MEAL_SUNDAY: '50000',
      KPI_WARNING_THRESHOLD: '95',
    },
  };
}

export function getFallbackSession(): AuthSessionResponse {
  let rememberedId: string | null = null;
  if (typeof window !== 'undefined') {
    try {
      rememberedId = localStorage.getItem('GCCK_ACTIVE_WORKER_ID');
    } catch { }
  }
  const worker = rememberedId ? findFallbackWorker(rememberedId) : null;
  const user = worker ? getFallbackUser(worker.id) : null;
  return {
    authenticated: Boolean(user),
    user: user,
    authMode: 'DEMO_QUICK',
    quickSwitchProfiles: FALLBACK_PROFILES,
  };
}

export async function submitDirectToGoogleAppsScript(
  payload: ReportSubmitPayload
): Promise<ReportSubmitResponse> {
  const recordUid = payload.recordUid || `GCCK-${Date.now()}`;
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const todayStr = `${yyyy}-${mm}-${dd}`;

  const worker = FALLBACK_WORKERS.find((w) => w.id === payload.workerId) || {
    name: 'Công nhân GCCK',
    role: 'Thợ chính',
    costPerSec: 14.24,
    chatId: '',
  };
  const op = FALLBACK_OPERATIONS.find((o) => o.ncId === payload.ncId);
  const machName = payload.machineName || 'Máy Tiện CNC 1';

  const scrapQty = Number(payload.scrapQty || 0);
  const edgesUsed = Number(payload.edgesUsed || 0);
  const unitWage = Math.round(Number(op?.stdLaborCost) || 35000);
  const turnIncome = (payload.okQty || 0) * unitWage;

  const effectiveCust = payload.customer || op?.customer || 'Vico - Nội bộ / Khách lẻ';
  const effectiveProd = payload.productName || op?.productName || 'Sản phẩm GCCK';
  const effectiveOpName = payload.opName || op?.opName || payload.ncId || 'Gia công';
  const effectivePoId = payload.poId || 'PO-THEO-KH';

  const fullPayload: Record<string, any> = {
    workDate: payload.workDate || todayStr,
    shiftType: payload.shiftType || 'Ca 1 (Sáng 06h-14h)',
    startTime: payload.startTime || '06:00',
    endTime: payload.endTime || '14:00',
    overtimeMinutes: String(payload.overtimeMinutes || '0'),
    isSunday: Boolean(payload.isSunday),
    workerId: payload.workerId,
    workerName: worker.name,
    workerRole: (worker as any).role || 'Thợ chính',
    workerCostPerSec: (worker as any).costPerSec || 14.24,
    workerChatId: (worker as any).chatId || '',
    machineMode: payload.machineMode || 'Chạy 1 máy',
    machineName: machName,
    machineCostPerHour: 250000,
    customer: effectiveCust,
    productName: effectiveProd,
    poId: effectivePoId,
    ncId: op?.ncId || payload.ncId,
    opName: effectiveOpName,
    stage: op?.stage || 'End',
    stdSeconds: op?.stdSeconds || 1800,
    cuttingRec: op?.cuttingRec || '',
    toolCode: payload.toolCode || op?.toolCode || '',
    toolName: (payload as any).toolName || op?.toolName || '',
    costPerEdge: 0,
    stdEdgesPerPcs: 0,
    edgesUsed,
    okQty: Number(payload.okQty || 0),
    reworkQty: Number(payload.reworkQty || 0),
    scrapQty,
    defectType: scrapQty > 0 ? (payload.defectType || 'Không rõ lỗi') : 'Không có lỗi',
    damageValue: Number(payload.damageValue || 0),
    stopMinutes: Number(payload.stopMinutes || 0),
    stopReason: payload.stopReason || 'Không có dừng máy',
    handoverNote: (payload as any).handoverNote || '',
    photoBase64: payload.photoBase64 || '',
  };

  const gasBody: Record<string, any> = {
    action: 'submitDailyReport',
    payload: fullPayload,
    report: fullPayload,
    data: fullPayload,
    // Direct fields for backward compatibility with pure formula GAS
    record_id: recordUid,
    recordUid,
    date: payload.workDate || todayStr,
    worker: worker.name,
    worker_id: payload.workerId,
    customer: effectiveCust,
    product: effectiveProd,
    po: effectivePoId,
    op: effectiveOpName,
    machine: machName,
    qty_dat: Number(payload.okQty || 0),
    qty_xuly: Number(payload.reworkQty || 0),
    qty_huy: scrapQty,
    responsibility: scrapQty > 0 ? (payload.defectType || 'Không rõ lỗi') : 'Không có lỗi',
    material: payload.toolCode || '',
    qty_material: edgesUsed,
    downtime_min: Number(payload.stopMinutes || 0),
    downtime_note: payload.stopReason || '',
    photos: payload.photoBase64 ? [payload.photoBase64] : [],
    shift: payload.shiftType || 'Ca 1',
  };

  try {
    await fetch(GAS_WEBHOOK_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(gasBody),
    });
  } catch (gasErr) {
    console.warn('Direct GAS sync warning (stored offline):', gasErr);
  }

  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const wDate = payload.workDate || todayStr;
  const [wY, wM, wD] = wDate.slice(0, 10).split('-');
  const timeStr = (wD && wM)
    ? `${wD}/${wM} ${hours}:${minutes}`
    : `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')} ${hours}:${minutes}`;

  const stdSeconds = Number(op?.stdSeconds || 1800);
  const costPerSec = Number((worker as any).costPerSec || 13.37);
  const okQty = Number(payload.okQty || 0);
  const reworkQty = Number(payload.reworkQty || 0);
  const stopMinutes = Number(payload.stopMinutes || 0);

  const calcPayroll = calculateTurnPayroll(
    {
      workerId: payload.workerId || 'NV_GCCK',
      salaryMode: (worker as any).salaryMode || 'Khoán 1 + 0.33 máy',
      costPerSec,
      workDate: payload.workDate || todayStr,
      shiftType: payload.shiftType || 'Ca 1 (Sáng 06h-14h)',
      startTime: payload.startTime || '07:30',
      endTime: payload.endTime || '16:30',
      overtimeMinutes: Number(payload.overtimeMinutes || 0),
      isSunday: Boolean(payload.isSunday),
      isLightsOut: Boolean(payload.isLightsOut),
      machineName: machName,
      machineMode: payload.machineMode || 'FIRST',
      machineCostPerHour: 250000,
      stdSeconds,
      stdEdgesPerPcs: Number(op?.stdEdgesPerPcs || 0),
      costPerEdge: Number(op?.costPerEdge || 0),
      edgesUsed,
      okQty,
      reworkQty,
      scrapQty,
      defectType: scrapQty > 0 ? (payload.defectType || '') : '',
      damageValue: Number(payload.damageValue || 0),
      stopMinutes,
      stopReason: payload.stopReason || 'Không có dừng máy',
    },
    {},
    DEFAULT_PAYROLL_CONFIG
  );

  const mockLogDto: any = {
    id: Date.now(),
    recordUid,
    createdAt: new Date().toISOString(),
    timeStr,
    workDate: payload.workDate || todayStr,
    shiftType: payload.shiftType || 'Ca 1 (Sáng 06h-14h)',
    startTime: payload.startTime || '07:30',
    endTime: payload.endTime || '16:30',
    overtimeMinutes: Number(payload.overtimeMinutes || 0),
    isSunday: payload.isSunday ? 1 : 0,
    isLightsOut: payload.isLightsOut ? 1 : 0,
    workerId: payload.workerId,
    workerName: worker.name || (payload as any).workerName || 'Công nhân GCCK',
    machineId: (payload as any).machineId || 'M01',
    machineName: machName,
    machineMode: payload.machineMode || 'FIRST',
    poId: effectivePoId,
    spId: (payload as any).spId || op?.spId || null,
    customer: effectiveCust,
    productName: effectiveProd,
    ncId: payload.ncId || op?.ncId || 'NC001',
    opName: effectiveOpName,
    stage: op?.stage || 'End',
    stepOrder: op?.stepOrder || 1,
    isFinalOp: op?.isFinalOp || 1,
    stdSeconds,
    okQty,
    reworkQty,
    scrapQty,
    defectType: scrapQty > 0 ? (payload.defectType || 'Không rõ lỗi') : 'Không có lỗi',
    damageValue: Number(payload.damageValue || 0),
    stopMinutes,
    stopReason: payload.stopReason || 'Không có dừng máy',
    toolCode: payload.toolCode || '',
    edgesUsed,
    selfCheckOk: 1,
    qcStatus: 'PASSED',
    pieceWage: calcPayroll.pieceWage,
    otBonusWage: calcPayroll.otBonusWage,
    waitWage: calcPayroll.waitWage,
    mealAllowance: calcPayroll.mealAllowance,
    scrapPenalty: calcPayroll.scrapPenalty,
    income: calcPayroll.turnTotalIncome,
    directPieceIncome: calcPayroll.directPieceIncome,
    batchCost: calcPayroll.batchCost,
    kpiPct: calcPayroll.kpiPct,
    kpiStatus: calcPayroll.kpiStatus,
    photoUrl: payload.photoBase64 || '',
    handoverNote: (payload as any).handoverNote || '',
    materialLot: payload.materialLot || '',
    note: (payload as any).note || payload.handoverNote || '',
    isVoided: 0,
  };

  saveClientStoredLog(mockLogDto);
  syncOrdersWithHandovers();

  // Sync to Supabase Cloud if configured
  let cloudSynced = false;
  if (isSupabaseConnected()) {
    try {
      cloudSynced = await pushLogToSupabase(mockLogDto);
    } catch (sbErr) {
      console.warn('Supabase push error:', sbErr);
    }
  }

  // Broadcast event across UI components
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('gcck:report-submitted', { detail: mockLogDto }));
  }

  const successMessage = cloudSynced
    ? '✅ Đã lưu và đồng bộ tức thì lên Supabase Cloud (Quản lý thấy ngay)!'
    : isSupabaseConnected()
      ? 'Đã lưu vào bộ nhớ máy (Đang thử kết nối lại Supabase Cloud).'
      : '⚠️ Đã lưu vào bộ nhớ điện thoại này. Chưa đồng bộ về Quản lý do chưa kết nối Supabase Cloud!';

  const warnings = !cloudSynced && !isSupabaseConnected()
    ? ['⚠️ Máy này chưa kết nối Supabase Cloud. Hãy quét mã QR kết nối từ Quản đốc hoặc mở Wi-Fi xưởng để đồng bộ.']
    : [];

  return {
    success: true,
    deduplicated: false,
    message: successMessage,
    warnings,
    log: mockLogDto,
    payroll: {
      effectiveMachineMode: 'FIRST',
      machRate: 1,
      shiftMult: 1,
      isSunday: false,
      effectiveOtMinutes: Number(payload.overtimeMinutes || 0),
      unpaidOtMinutes: 0,
      effectivePaidStopMinutes: Number(payload.stopMinutes || 0),
      isMonthlyStaff: false,
      unitPiecePrice: unitWage,
      earnedStdSeconds: (payload.okQty || 0) * (op?.stdSeconds || 1800),
      netWorkSeconds: 28800,
      basePieceWage: turnIncome,
      otBonusWage: 0,
      waitWage: 0,
      pieceWage: turnIncome,
      directPieceIncome: turnIncome,
      mealAllowance: 0,
      scrapPenalty: 0,
      turnTotalIncome: turnIncome,
      costingLaborCost: turnIncome,
      costingMachCost: 0,
      costingToolCost: 0,
      costingScrapLoss: 0,
      batchCost: turnIncome,
      kpiPct: 100,
      kpiStatus: 'DAT_MUC',
      edgesConsumed: edgesUsed,
    },
    todayTotalIncome: turnIncome,
  };
}

export function getFallbackTraveler(poId: string): JobTravelerDto {
  const cleanPoId = poId.replace(/\/traveler$/, '').trim();
  const cleanUpper = cleanPoId.toUpperCase();
  const po =
    FALLBACK_ORDERS.find((o) => o.poId.toUpperCase() === cleanUpper) ||
    FALLBACK_ORDERS.find(
      (o) =>
        o.poId.toUpperCase().replace(/^P0/, 'PO') ===
        cleanUpper.replace(/^P0/, 'PO')
    ) ||
    FALLBACK_ORDERS[0] || {
      poId: cleanPoId || 'PO485-01',
      customer: 'Vico - Nội bộ / Khách lẻ',
      productName: 'ALKTOP 1342 M',
      qtyPo: 20,
      finishedQty: 18,
      remainQty: 2,
      dueDate: '2026-11-05',
      status: 'Đang gia công',
      materialLot: 'LÔ-2026-09A',
      faiStatus: 'FAI_PASSED',
    };

  const normPoProd = normalizeVn(po.productName).replace(/[^A-Z0-9]/gi, '').toUpperCase();
  const product =
    (po.spId ? FALLBACK_PRODUCTS.find((p) => p.spId === po.spId) : null) ||
    FALLBACK_PRODUCTS.find(
      (p) =>
        normalizeVn(p.productName).replace(/[^A-Z0-9]/gi, '').toUpperCase() === normPoProd
    ) ||
    FALLBACK_PRODUCTS.find((p) => p.productName.toUpperCase() === po.productName.toUpperCase()) || {
      spId: po.spId || 'SP-01',
      customer: po.customer,
      productName: po.productName,
      matName: 'Thép C45',
      setupMinutesStd: 15,
      opCount: 1,
      totalStdSeconds: 3600,
      drawingUrl: '',
      techDocUrl: '',
      quotedPrice: 120000,
      rawMaterialCost: 40000,
      outsourceCost: 0,
    };

  const targetSpId = po.spId || product.spId;
  let ops: OperationMeta[] = [];
  if (targetSpId) {
    ops = FALLBACK_OPERATIONS.filter((o) => o.spId === targetSpId).sort((a, b) => a.stepOrder - b.stepOrder);
  }
  if (ops.length === 0) {
    ops = FALLBACK_OPERATIONS.filter(
      (o) =>
        normalizeVn(o.productName).replace(/[^A-Z0-9]/gi, '').toUpperCase() === normPoProd
    ).sort((a, b) => a.stepOrder - b.stepOrder);
  }
  if (ops.length === 0) {
    ops = FALLBACK_OPERATIONS.filter((o) => {
      const normOp = normalizeVn(o.productName).replace(/[^A-Z0-9]/gi, '').toUpperCase();
      return normOp === normPoProd || normOp.includes(normPoProd) || normPoProd.includes(normOp);
    }).sort((a, b) => a.stepOrder - b.stepOrder);
  }

  // Fallback ONLY to a dedicated single-step operation for this exact PO/product, NEVER slice(0, 3) from another customer!
  const finalOpsList: OperationMeta[] = ops.length > 0 ? ops : [
    {
      ncId: `NC-${po.poId}-01`,
      spId: targetSpId || 'SP-UNKNOWN',
      customer: po.customer,
      productName: po.productName,
      opName: 'Gia công tiện hoàn thiện CNC',
      stdSeconds: product.totalStdSeconds || 3600,
      stage: 'End',
      stepOrder: 1,
      isFinalOp: 1,
      defaultMachine: 'Máy Tiện CNC 1',
      matName: product.matName || 'Thép cơ khí C45',
      cuttingRec: 'Tiện CNC tiêu chuẩn',
      toolCode: 'T01',
      toolName: 'Mảnh tiện CNC hợp kim',
      costPerEdge: 25000,
      stdEdgesPerPcs: 0.1,
      stdLaborCost: 48000,
      stdMachCost: 39000,
      stdToolCost: 5000,
    },
  ];

  const mappedOps = finalOpsList.map((op, idx) => ({
    ...op,
    stepOrder: idx + 1,
    qrPayload: `GCCK|${po.poId}|${op.ncId}`,
    doneOkQty: Math.floor(po.finishedQty * 0.9),
    faiPassed: true,
  }));

  return {
    po,
    product,
    operations: mappedOps,
    faiRecords: [
      {
        id: 1,
        inspectionType: 'FAI',
        poId: po.poId,
        spId: product?.spId || 'SP-01',
        ncId: mappedOps[0]?.ncId || 'NC098',
        productName: po.productName,
        opName: mappedOps[0]?.opName || 'Gia công',
        machineName: mappedOps[0]?.defaultMachine || 'Máy Tiện CNC 1',
        operatorId: 'NV00214',
        inspectorId: 'NV00266',
        inspectorName: 'Trần Văn Dũng (KCS)',
        result: 'PASS',
        sampleSize: 1,
        defectQty: 0,
        measuredDimsJson: JSON.stringify({ 'Kích thước chính': 45.02, 'Độ nhám': 1.6 }),
        rootCause: '',
        correctiveAction: 'Đạt dung sai bản vẽ ISO 2768-m. Cho phép gia công hàng loạt.',
        createdAt: new Date().toISOString(),
      },
    ],
    printedAt: new Date().toISOString(),
  };
}

export function getFallbackTraceability(poId: string): TraceabilityDto {
  const cleanPoId = (poId || '').replace(/\/traceability$/, '').trim().toUpperCase();
  const po =
    FALLBACK_ORDERS.find((o) => o.poId.toUpperCase() === cleanPoId) ||
    FALLBACK_ORDERS.find(
      (o) =>
        o.poId.toUpperCase().replace(/^P0/, 'PO') ===
        cleanPoId.replace(/^P0/, 'PO')
    ) ||
    FALLBACK_ORDERS[0] || {
      poId: poId.trim() || 'PO485-01',
      customer: 'Win-Win - PO485',
      productName: 'ALKTOP 1342 M',
      qtyPo: 20,
      finishedQty: 18,
      remainQty: 2,
      dueDate: '2026-11-05',
      status: 'Đang gia công',
      materialLot: 'LOT-2026-VC',
      supplierName: 'Xưởng Đúc VICO Thắng Lợi',
      castDate: '2026-10-10',
      note: '',
      faiStatus: 'FAI_PASSED',
    };

  const normPoProd = normalizeVn(po.productName).replace(/[^A-Z0-9]/gi, '').toUpperCase();
  const product =
    (po.spId ? FALLBACK_PRODUCTS.find((p) => p.spId === po.spId) : null) ||
    FALLBACK_PRODUCTS.find(
      (p) =>
        normalizeVn(p.productName).replace(/[^A-Z0-9]/gi, '').toUpperCase() === normPoProd
    ) ||
    FALLBACK_PRODUCTS.find((p) => p.productName.toUpperCase() === po.productName.toUpperCase());

  const targetSpId = po.spId || product?.spId;
  let ops: OperationMeta[] = [];
  if (targetSpId) {
    ops = FALLBACK_OPERATIONS.filter((o) => o.spId === targetSpId).sort((a, b) => a.stepOrder - b.stepOrder);
  }
  if (ops.length === 0) {
    ops = FALLBACK_OPERATIONS.filter(
      (o) =>
        normalizeVn(o.productName).replace(/[^A-Z0-9]/gi, '').toUpperCase() === normPoProd
    ).sort((a, b) => a.stepOrder - b.stepOrder);
  }
  if (ops.length === 0) {
    ops = FALLBACK_OPERATIONS.filter((o) => {
      const normOp = normalizeVn(o.productName).replace(/[^A-Z0-9]/gi, '').toUpperCase();
      return normOp === normPoProd || normOp.includes(normPoProd) || normPoProd.includes(normOp);
    }).sort((a, b) => a.stepOrder - b.stepOrder);
  }

  const finalOpsList: OperationMeta[] = ops.length > 0 ? ops : [
    {
      ncId: `NC-${po.poId}-01`,
      spId: targetSpId || 'SP-UNKNOWN',
      customer: po.customer,
      productName: po.productName,
      opName: 'Gia công tiện hoàn thiện CNC',
      stdSeconds: product?.totalStdSeconds || 3600,
      stage: 'End',
      stepOrder: 1,
      isFinalOp: 1,
      defaultMachine: 'Máy Tiện CNC 1',
      matName: product?.matName || 'Thép cơ khí C45',
      cuttingRec: 'Tiện CNC tiêu chuẩn',
      toolCode: 'T01',
      toolName: 'Mảnh tiện CNC hợp kim',
      costPerEdge: 25000,
      stdEdgesPerPcs: 0.1,
      stdLaborCost: 48000,
      stdMachCost: 39000,
      stdToolCost: 5000,
    },
  ];

  const allLogs = getAllFallbackLogs().filter(
    (l) => !l.isVoided && String(l.poId).toLowerCase() === po.poId.toLowerCase()
  );

  const operationsTimeline = finalOpsList.map((op, idx) => {
    const stepLogs = allLogs.filter((l) => l.ncId === op.ncId);
    return {
      stepOrder: op.stepOrder || idx + 1,
      ncId: op.ncId,
      opName: op.opName,
      isFinalOp: op.isFinalOp ?? 0,
      totalOk: stepLogs.reduce((s, l) => s + (Number(l.okQty) || 0), 0),
      totalRework: stepLogs.reduce((s, l) => s + (Number(l.reworkQty) || 0), 0),
      totalScrap: stepLogs.reduce((s, l) => s + (Number(l.scrapQty) || 0), 0),
      logs: stepLogs,
    };
  });

  return {
    po,
    materialInfo: {
      materialLot: po.materialLot || 'LOT-2026-VC',
      supplierName: po.supplierName || 'Xưởng Đúc VICO Thắng Lợi',
      castDate: po.castDate || '2026-10-10',
      matName: finalOpsList[0]?.matName || 'Thép cơ khí chế tạo',
    },
    operationsTimeline,
    qcRecords: buildConsolidatedQcList([], allLogs).length > 0
      ? buildConsolidatedQcList([], allLogs)
      : [
          {
            id: 1,
            inspectionType: 'FAI',
            poId: po.poId,
            spId: po.spId || 'SP-01',
            ncId: finalOpsList[0]?.ncId || 'NC098',
            productName: po.productName,
            opName: finalOpsList[0]?.opName || 'Gia công',
            machineName: 'Máy Tiện CNC 1',
            operatorId: 'NV00214',
            inspectorId: 'NV00266',
            inspectorName: 'Trần Văn Dũng (KCS)',
            result: 'PASS',
            sampleSize: 1,
            defectQty: 0,
            measuredDimsJson: JSON.stringify({ 'Kích thước chính': 45.02 }),
            rootCause: '',
            correctiveAction: 'Đạt yêu cầu kỹ thuật FAI.',
            createdAt: new Date().toISOString(),
          },
        ],
    deliveries: [],
  };
}

export function getFallbackDeliveries(): DeliveryLogDto[] {
  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem(LOCAL_DELIVERIES_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch { }
  }
  return [];
}

export function saveFallbackDelivery(delivery: DeliveryLogDto): void {
  const current = getFallbackDeliveries();
  current.unshift(delivery);
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(LOCAL_DELIVERIES_KEY, JSON.stringify(current));
    } catch { }
  }
}

export function updateFallbackOrder(poId: string, updates: Partial<PurchaseOrderInfo>): PurchaseOrderInfo | null {
  const po = FALLBACK_ORDERS.find((o) => o.poId.toLowerCase() === poId.toLowerCase());
  if (!po) return null;

  if (updates.qtyPo !== undefined) po.qtyPo = Math.max(1, Number(updates.qtyPo) || 1);
  if (updates.dueDate !== undefined) po.dueDate = String(updates.dueDate);
  if (updates.materialLot !== undefined) po.materialLot = String(updates.materialLot);
  if (updates.supplierName !== undefined) po.supplierName = String(updates.supplierName);
  if (updates.priority !== undefined) po.priority = Number(updates.priority);
  if (updates.note !== undefined) po.note = String(updates.note);
  if (updates.finishedQty !== undefined) po.finishedQty = Math.max(0, Number(updates.finishedQty) || 0);
  if (updates.wipQty !== undefined) po.wipQty = Math.max(0, Number(updates.wipQty) || 0);
  if (updates.deliveredQty !== undefined) po.deliveredQty = Math.max(0, Number(updates.deliveredQty) || 0);

  po.stockQty = Math.max(0, (po.finishedQty || 0) - (po.deliveredQty || 0));
  po.remainQty = Math.max(0, po.qtyPo - (po.deliveredQty || 0));

  if (po.deliveredQty >= po.qtyPo) {
    po.status = '✅ Đã giao đủ';
  } else if (po.finishedQty >= po.qtyPo) {
    po.status = '📦 Xong CK - Chờ giao';
  } else if ((po.wipQty || 0) > 0 || (po.finishedQty || 0) > 0) {
    po.status = '⚙️ Đang gia công';
  } else {
    po.status = '⏳ Đang chờ SX';
  }

  saveFallbackOrdersToStorage();
  return po;
}

export function deliverFallbackOrder(
  poId: string,
  qtyDeliver: number,
  note?: string
): { success: boolean; item?: PurchaseOrderInfo; message?: string } {
  const po = FALLBACK_ORDERS.find((o) => o.poId.toLowerCase() === poId.toLowerCase());
  if (!po) return { success: false, message: `Không tìm thấy PO ${poId}` };

  if (po.remainQty <= 0 || po.deliveredQty >= po.qtyPo) {
    return {
      success: false,
      item: po,
      message: `Đơn hàng ${po.poId} đã giao đủ toàn bộ (${po.deliveredQty}/${po.qtyPo} SP). Không cần xuất giao thêm!`,
    };
  }

  const maxCanDeliver = Math.max(0, po.remainQty);
  const qty = Math.min(maxCanDeliver, Math.max(1, Math.round(qtyDeliver)));
  po.deliveredQty = Math.min(po.qtyPo, (po.deliveredQty || 0) + qty);
  po.stockQty = Math.max(0, (po.finishedQty || 0) - po.deliveredQty);
  po.remainQty = Math.max(0, po.qtyPo - po.deliveredQty);

  if (po.deliveredQty >= po.qtyPo) {
    po.status = '✅ Đã giao đủ';
  } else if (po.finishedQty >= po.qtyPo) {
    po.status = '📦 Xong CK - Chờ giao';
  } else if ((po.wipQty || 0) > 0 || (po.finishedQty || 0) > 0) {
    po.status = '⚙️ Đang gia công';
  } else {
    po.status = '⏳ Đang chờ SX';
  }

  saveFallbackOrdersToStorage();

  const newDelivery: DeliveryLogDto = {
    id: Date.now(),
    poId: po.poId,
    customer: po.customer,
    productName: po.productName,
    qtyDeliver: qty,
    deliveredAt: new Date().toISOString(),
    deliveredBy: 'Quản đốc / Admin',
    note: note || '',
  };
  saveFallbackDelivery(newDelivery);

  return { success: true, item: po, message: `Đã xuất giao ${qty} SP cho ${po.poId}.` };
}

export function saveFallbackOrdersBatch(orders: Array<Partial<PurchaseOrderInfo>>): PurchaseOrderInfo[] {
  const created: PurchaseOrderInfo[] = [];
  for (const raw of orders) {
    const poId = String(raw.poId || '').trim();
    if (!poId) continue;
    const existingIdx = FALLBACK_ORDERS.findIndex(o => o.poId.toLowerCase() === poId.toLowerCase());
    const qtyPo = Math.max(1, Math.round(Number(raw.qtyPo) || 1));
    const wipQty = Math.max(0, Number(raw.wipQty || 0));
    const finishedQty = Math.max(0, Number(raw.finishedQty || 0));
    const deliveredQty = Math.max(0, Number(raw.deliveredQty || 0));
    const stockQty = Math.max(0, Number(raw.stockQty ?? (finishedQty - deliveredQty)));
    const remainQty = Math.max(0, Number(raw.remainQty ?? (qtyPo - deliveredQty)));

    let status = String(raw.status || '');
    if (!status || status.includes('Đang chờ SX')) {
      if (deliveredQty >= qtyPo) {
        status = '✅ Đã giao đủ';
      } else if (finishedQty >= qtyPo) {
        status = '📦 Xong CK - Chờ giao';
      } else if (wipQty > 0 || finishedQty > 0) {
        status = '⚙️ Đang gia công';
      } else {
        status = '⏳ Đang chờ SX';
      }
    }

    const prodMeta = ensureProductExists(
      String(raw.customer || 'Nội bộ'),
      String(raw.productName || 'Chi tiết cơ khí'),
      raw.spId
    );

    const newPo: PurchaseOrderInfo = {
      poId,
      spId: raw.spId ? String(raw.spId) : prodMeta.spId,
      customer: String(raw.customer || prodMeta.customer || 'Nội bộ'),
      productName: String(raw.productName || prodMeta.productName || 'Chi tiết cơ khí'),
      qtyPo,
      dueDate: String(raw.dueDate || '2026-11-30'),
      wipQty,
      finishedQty,
      deliveredQty,
      stockQty,
      remainQty,
      status,
      materialLot: raw.materialLot || `LOT-VICO-${Date.now().toString().slice(-4)}`,
      supplierName: raw.supplierName || 'Xưởng Đúc VICO Thắng Lợi',
      castDate: raw.castDate || '2026-11-01',
      note: raw.note || '',
      faiStatus: raw.faiStatus || 'FAI_PASSED',
    };
    if (existingIdx >= 0) {
      FALLBACK_ORDERS[existingIdx] = { ...FALLBACK_ORDERS[existingIdx], ...newPo };
      created.push(FALLBACK_ORDERS[existingIdx]);
    } else {
      FALLBACK_ORDERS.unshift(newPo);
      created.push(newPo);
    }
  }
  saveFallbackOrdersToStorage();
  return created;
}


export function getFallbackWeeklyReport(weekStart?: string): WeeklyReportData {
  const wStart = weekStart || '2026-10-15';
  const startDt = new Date(wStart);
  const endDt = new Date(startDt.getTime() + 6 * 24 * 3600 * 1000);
  const weekEnd = endDt.toISOString().slice(0, 10);
  const weekLabel = `Tuần làm việc (${wStart.slice(8, 10)}/${wStart.slice(5, 7)} - ${weekEnd.slice(8, 10)}/${weekEnd.slice(5, 7)}/${weekEnd.slice(0, 4)})`;

  return {
    weekStart: wStart,
    weekEnd,
    weekLabel,
    summary: {
      totalPlannedQty: 240,
      totalActualQty: 228,
      completionPct: 95,
      totalPoActive: FALLBACK_ORDERS.length,
      completedPoCount: 8,
      delayedPoCount: 1,
    },
    customerStats: [
      {
        customer: 'Taniguchi',
        productCount: 12,
        plannedQty: 120,
        actualQty: 118,
        completionPct: 98,
        poCount: 6,
      },
      {
        customer: 'Hạ Long',
        productCount: 8,
        plannedQty: 80,
        actualQty: 74,
        completionPct: 92,
        poCount: 4,
      },
      {
        customer: 'Vico - Nội bộ / Khách lẻ',
        productCount: 14,
        plannedQty: 40,
        actualQty: 36,
        completionPct: 90,
        poCount: 5,
      },
    ],
    poStatuses: FALLBACK_ORDERS.map((po) => {
      const isCompleted = Number(po.finishedQty || 0) >= Number(po.qtyPo || 0);
      const isDelayed = !isCompleted && Boolean(po.dueDate && new Date(po.dueDate) < new Date());
      return {
        poId: po.poId,
        customer: po.customer,
        productName: po.productName,
        qtyPo: po.qtyPo,
        finishedQty: po.finishedQty,
        wipQty: po.remainQty,
        dueDate: po.dueDate,
        status: po.status,
        isDelayed,
      };
    }),
    workerLaborStats: FALLBACK_WORKERS.slice(0, 10).map((w, idx) => ({
      workerId: w.id,
      workerName: w.name,
      standardShifts: 6,
      otHours: idx % 2 === 0 ? 4 : 0,
      sundayHours: 0,
      offDays: 0,
      pDays: 0,
      totalConvertedShifts: 6 + (idx % 2 === 0 ? 0.5 : 0),
      actualCompletedPieces: 25 + idx * 3,
    })),
    downtimeIncidents: [
      {
        id: 'INC-01',
        machineName: 'Máy tiện FUJI',
        stopMinutes: 45,
        reason: 'Thay mảnh hợp kim CNC do mòn đầu dao',
        date: wStart,
        workerName: 'Trần Văn Quỳnh',
      },
    ],
    customIncidentNotes: ['Bảo dưỡng định kỳ trục chính máy phay Moriseiki hoàn tất trong ca sáng'],
    proposals: [
      {
        id: 1,
        weekStart: wStart,
        category: 'Dao cụ & Thiết bị',
        proposer: 'Hoàng Ngọc Hà (Quản đốc)',
        content: 'Bổ sung thêm 20 mảnh chíp tiện WNMG080408 cho máy Tiện CNC 1 để chạy đơn hàng Taniguchi',
        priority: 'CAO',
        status: 'PENDING',
        createdAt: new Date().toISOString(),
      },
    ],
    nextWeekForecast: {
      duePos: FALLBACK_ORDERS.slice(0, 4).map((po) => ({
        poId: po.poId,
        customer: po.customer,
        productName: po.productName,
        remainQty: po.remainQty,
        dueDate: po.dueDate,
        requiredHours: Math.round((po.remainQty * 1800) / 3600),
        defaultMachine: 'Máy Tiện CNC 1',
      })),
      carryoverBacklogQty: 12,
      carryoverHours: 6,
      totalRequiredHours: 42,
      machineCapacityHours: 120,
      overloadCapacityHours: 0,
      isOverloaded: false,
      outsourceRecommendations: [],
    },
  };
}

const LOCAL_DAILY_PLAN_PREFIX = 'GCCK_DAILY_SCHEDULE_V2_';
const LOCAL_DAILY_DATES_KEY = 'GCCK_DAILY_DATES_V2';

export function getFallbackDailyDates(): Array<{ workDate: string; rowCount: number; workerCount: number }> {
  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem(LOCAL_DAILY_DATES_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // ignore
    }
  }
  const now = new Date();
  const vDate = now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
  return [
    { workDate: vDate, rowCount: 19, workerCount: 11 },
  ];
}

export function saveFallbackDailyPlan(workDate: string, rows: DailyPlanRow[]): void {
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(LOCAL_DAILY_PLAN_PREFIX + workDate, JSON.stringify(rows));
      const dates = getFallbackDailyDates();
      const existingIdx = dates.findIndex((d) => d.workDate === workDate);
      const workerSet = new Set(rows.map((r) => r.workerName).filter(Boolean));
      const entry = { workDate, rowCount: rows.length, workerCount: workerSet.size };
      if (existingIdx >= 0) dates[existingIdx] = entry;
      else dates.unshift(entry);
      dates.sort((a, b) => b.workDate.localeCompare(a.workDate));
      localStorage.setItem(LOCAL_DAILY_DATES_KEY, JSON.stringify(dates));
    } catch {
      // ignore
    }
  }
}

export function deleteFallbackDailyPlan(workDate: string): void {
  if (typeof window !== 'undefined') {
    try {
      localStorage.removeItem(LOCAL_DAILY_PLAN_PREFIX + workDate);
      const dates = getFallbackDailyDates().filter((d) => d.workDate !== workDate);
      localStorage.setItem(LOCAL_DAILY_DATES_KEY, JSON.stringify(dates));
    } catch {
      // ignore
    }
  }
}

export function copyFallbackDailyPlan(
  sourceDate: string,
  targetDate: string,
  resetQty?: boolean
): { success: boolean; targetDate: string; rowCount: number } {
  const sourceRows = getFallbackDailyPlan(sourceDate);
  const newRows = sourceRows.map((r, idx) => ({
    ...r,
    id: undefined,
    workDate: targetDate,
    plannedQty: resetQty ? 0 : r.plannedQty,
    actualQty: 0,
    stt: idx + 1,
    status: 'PLANNED',
  }));
  saveFallbackDailyPlan(targetDate, newRows);
  if (isSupabaseConnected()) {
    void pushDailyPlanToSupabase(targetDate, newRows);
  }
  return { success: true, targetDate, rowCount: newRows.length };
}

/**
 * Đảo ca theo vòng lặp 1 tuần của nhà máy:
 * - Ca 1 -> Ca 3 (Ca sáng đổi xuống Ca đêm)
 * - Ca 2 -> Ca 1 (Ca chiều đổi lên Ca sáng)
 * - Ca 3 -> Ca 2 (Ca đêm đổi lên Ca chiều)
 * - Đặng Ngọc Long cố định Ca 2 (không đảo ca)
 * - Hoàng Ngọc Hà (Quản đốc) chỉ đạo 3 ca (không đứng máy)
 */
export function rotateDailyPlanWeek(rows: DailyPlanRow[]): DailyPlanRow[] {
  return rows.map((r) => {
    // Đặng Ngọc Long cố định Ca 2 theo yêu cầu nhà máy
    if ((r.workerName || '').includes('Long')) {
      return { ...r, shiftType: 'Ca 2' };
    }
    // Quản đốc Hoàng Ngọc Hà không trực tiếp đứng máy
    if ((r.workerName || '').includes('Hà')) {
      return r;
    }
    let newShift = r.shiftType;
    if (r.shiftType === 'Ca 1') newShift = 'Ca 3';
    else if (r.shiftType === 'Ca 2') newShift = 'Ca 1';
    else if (r.shiftType === 'Ca 3') newShift = 'Ca 2';
    return { ...r, shiftType: newShift };
  });
}

export function getFallbackDailyPlan(workDate: string, shiftType?: string): DailyPlanRow[] {
  if (typeof window !== 'undefined') {
    try {
      let raw = localStorage.getItem(LOCAL_DAILY_PLAN_PREFIX + workDate);
      if (!raw) {
        raw = localStorage.getItem('GCCK_DAILY_SCHEDULE_' + workDate);
      }
      if (raw) {
        const rows: DailyPlanRow[] = JSON.parse(raw);
        if (Array.isArray(rows) && rows.length > 0) {
          // Safeguard: if stored rows is missing workers, automatically merge with baseline roster
          const merged = mergePlanWithBaseline(rows, workDate);
          if (merged.length !== rows.length) {
            localStorage.setItem(LOCAL_DAILY_PLAN_PREFIX + workDate, JSON.stringify(merged));
          }
          return shiftType ? merged.filter((r) => r.shiftType === shiftType) : merged;
        }
      }
    } catch {
      // ignore
    }
  }

  const baseline = getBaselineDailyPlan(workDate);
  return shiftType ? baseline.filter((r) => r.shiftType === shiftType) : baseline;
}

export function getFallbackAndonLive(requestedShift?: string): AndonLivePayload {
  const now = new Date();
  const vDate = now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
  const allLogs = getAllFallbackLogs();
  const todayLogs = allLogs.filter((l) => l.workDate === vDate && !l.isVoided);
  const todayOkQty = todayLogs.reduce((acc, l) => acc + (Number(l.okQty) || 0), 0);
  const todayScrapQty = todayLogs.reduce((acc, l) => acc + (Number(l.scrapQty) || 0), 0);

  // Determine current active shift (Ca 1: 06-14, Ca 2: 14-22, Ca 3: 22-06)
  const hour = now.getHours();
  const autoShift = hour >= 6 && hour < 14 ? 'Ca 1' : hour >= 14 && hour < 22 ? 'Ca 2' : 'Ca 3';
  const currentShift =
    requestedShift && ['Ca 1', 'Ca 2', 'Ca 3'].includes(requestedShift)
      ? requestedShift
      : autoShift;

  // Load Daily Plan for today
  let planRows = getFallbackDailyPlan(vDate);
  if (planRows.length === 0) {
    const selectedDate = typeof window !== 'undefined' ? localStorage.getItem('GCCK_SELECTED_PLAN_DATE') : null;
    if (selectedDate) planRows = getFallbackDailyPlan(selectedDate);
  }
  if (planRows.length === 0) {
    const dates = getFallbackDailyDates();
    if (dates.length > 0) planRows = getFallbackDailyPlan(dates[0].workDate);
  }

  // Filter STRICTLY for currentShift (only include rows planned for this shift):
  // CRITICAL: NEVER fall back to all shifts! Each shift strictly displays its own workers and machines.
  const shiftPlanRows = planRows.filter((r) => r.shiftType === currentShift);
  const activePlanRows = shiftPlanRows;

  // Track workers assigned to 2 or more machines in this shift (+0.33)
  const machinesByWorker = new Map<string, Set<string>>();
  for (const r of activePlanRows) {
    const wName = (r.workerName || '').trim();
    const mName = (r.machineName || '').trim();
    if (wName && mName) {
      let mSet = machinesByWorker.get(wName);
      if (!mSet) {
        mSet = new Set<string>();
        machinesByWorker.set(wName, mSet);
      }
      mSet.add(mName.toLowerCase());
    }
  }

  // Group plan rows by machine
  const planByMachine = new Map<string, DailyPlanRow[]>();
  for (const r of activePlanRows) {
    const mName = (r.machineName || '').trim().toLowerCase();
    if (mName) {
      let list = planByMachine.get(mName);
      if (!list) {
        list = [];
        planByMachine.set(mName, list);
      }
      list.push(r);
    }
  }

  // Check today's real production logs per machine FOR THIS SHIFT ONLY
  const latestLogByMachine = new Map<string, any>();
  for (const l of todayLogs) {
    if (l.shiftType === currentShift) {
      const mName = String(l.machineName || l.machineId || '').trim().toLowerCase();
      if (mName && !latestLogByMachine.has(mName)) {
        latestLogByMachine.set(mName, l);
      }
    }
  }

  const machines = FALLBACK_MACHINES.map((m) => {
    const mKey = m.name.trim().toLowerCase();
    const planRowsForMachine = planByMachine.get(mKey) || [];
    const recentActivity = latestLogByMachine.get(mKey);

    let status: MachineStatus = (m.status as MachineStatus) || 'IDLE';
    let currentWorkerName: string | null = null;
    let currentPoId: string | null = null;
    let currentNcId: string | null = null;
    let currentProductName: string | null = null;
    let currentOpName: string | null = null;
    let stopReason: string | null = m.stopReason || null;
    let isLightsOut = currentShift === 'Ca 3';
    let isBottleneck = false;
    let loadPct = 0;
    let isDualMachine = false;
    let isOvertime = false;
    let overtimeHours = 0;

    // Check if machine is broken / maintenance
    if (m.status === 'STOPPED' || m.status === 'MAINTENANCE' || m.stopReason) {
      status = 'STOPPED';
      stopReason = m.stopReason || 'Chờ sửa chữa / Bảo trì kỹ thuật';
      loadPct = 0;
    } else if (planRowsForMachine.length > 0) {
      // Machine has active planned work for this shift!
      const topRow = planRowsForMachine[0];
      currentWorkerName = (topRow.workerName || '').trim() || null;
      currentPoId = topRow.spId || (topRow.note?.match(/PO\d+-\d+/i)?.[0]) || 'PO471-1';
      currentNcId = topRow.ncId || null;
      currentProductName = topRow.productName || null;
      currentOpName = topRow.opName || null;

      // Check if machine/worker has overtime
      for (const r of planRowsForMachine) {
        if (r.isOvertime || (r.note && /tăng ca|ot/i.test(r.note))) {
          isOvertime = true;
          overtimeHours = r.overtimeHours || 2;
          break;
        }
      }

      // Check if worker runs >= 2 machines
      if (currentWorkerName) {
        const workerMachineCount = machinesByWorker.get(currentWorkerName)?.size || 1;
        isDualMachine = workerMachineCount >= 2;
      }

      // Calculate Tải KH % based on planned hours
      const opMeta = FALLBACK_OPERATIONS.find((o) => o.ncId === topRow.ncId);
      const stdSec = opMeta?.stdSeconds || 1800;
      const totalPlannedSec = planRowsForMachine.reduce(
        (sum, r) => sum + Math.max(1, Number(r.plannedQty || 0)) * stdSec,
        0
      );

      // Wire cut runs 24/24 (86400s), standard shift is 8h (28800s)
      const isWireCut = m.name.toLowerCase().includes('cắt dây');
      const capacitySec = isWireCut ? 24 * 3600 : 8 * 3600;
      loadPct = Math.round((totalPlannedSec / capacitySec) * 100);
      if (loadPct === 0 && topRow.plannedQty > 0) loadPct = 80;
      if (loadPct > 100) isBottleneck = true;

      // Status: running if logged today, otherwise setup for shift
      if (recentActivity) {
        status = 'RUNNING';
        if (recentActivity.workerName) currentWorkerName = recentActivity.workerName;
      } else {
        status = 'SETUP';
      }
    } else {
      // Machine has NO planned work for this shift -> BÁO NGHỈ
      status = 'IDLE';
      currentWorkerName = null;
      currentPoId = null;
      currentNcId = null;
      currentProductName = null;
      currentOpName = null;
      stopReason = null;
      loadPct = 0;
      isDualMachine = false;
      isOvertime = false;
      overtimeHours = 0;
    }

    return {
      id: m.id,
      name: m.name,
      group: m.group,
      status: status as MachineStatus,
      currentWorkerName,
      currentPoId,
      currentNcId,
      currentProductName,
      currentOpName,
      stopReason,
      isLightsOut,
      loadPct,
      isBottleneck,
      isDualMachine,
      isOvertime,
      overtimeHours,
      shiftType: currentShift,
    };
  });

  const runningCount = machines.filter((m) => m.status === 'RUNNING').length;
  const setupCount = machines.filter((m) => m.status === 'SETUP').length;
  const stoppedCount = machines.filter(
    (m) => m.status === 'STOPPED' || (m.status as string) === 'MAINTENANCE'
  ).length;
  const idleCount = machines.length - runningCount - setupCount - stoppedCount;
  const overtimeCount = machines.filter((m) => m.isOvertime).length;
  const spindleRunPct =
    machines.length > 0 ? Math.round(((runningCount + setupCount) / machines.length) * 100) : 0;

  // Urgent Orders: ONLY orders that still need production (finishedQty < qtyPo)
  const urgentOrders = FALLBACK_ORDERS.filter(
    (po) => Number(po.finishedQty || 0) < Number(po.qtyPo || 0)
  )
    .sort((a, b) => {
      const aDue = a.dueDate || '9999-99-99';
      const bDue = b.dueDate || '9999-99-99';
      return aDue.localeCompare(bDue);
    })
    .slice(0, 12)
    .map((po) => {
      const isOverdue = Boolean(
        po.dueDate && po.dueDate < vDate && Number(po.finishedQty || 0) < Number(po.qtyPo || 0)
      );
      const progressPct =
        po.qtyPo > 0
          ? Math.min(
              100,
              Math.round((Number(po.finishedQty || 0) / Number(po.qtyPo || 1)) * 100)
            )
          : 0;
      return {
        poId: po.poId,
        customer: po.customer,
        productName: po.productName,
        qtyPo: po.qtyPo,
        finishedQty: po.finishedQty,
        remainQty: Math.max(0, Number(po.qtyPo || 0) - Number(po.finishedQty || 0)),
        dueDate: po.dueDate,
        isOverdue,
        progressPct,
        status: po.status,
      };
    });

  // Worker Leaderboard: Prioritize active logs with production
  const targetLogs = todayLogs.length > 0 ? todayLogs : allLogs;
  const workerStatsMap = new Map<
    string,
    {
      workerId: string;
      workerName: string;
      earnedSec: number;
      okQty: number;
      kpis: number[];
    }
  >();

  targetLogs
    .filter((l) => !l.isVoided && Number(l.okQty || 0) > 0)
    .forEach((l) => {
      const wId = l.workerId || 'NV00214';
      const entry = workerStatsMap.get(wId) || {
        workerId: wId,
        workerName: l.workerName || 'Công nhân',
        earnedSec: 0,
        okQty: 0,
        kpis: [] as number[],
      };
      entry.earnedSec += (Number(l.okQty) || 0) * (Number(l.stdSeconds) || 1800);
      entry.okQty += Number(l.okQty) || 0;
      if (l.kpiPct) entry.kpis.push(Number(l.kpiPct));
      workerStatsMap.set(wId, entry);
    });

  let workerLeaderboard = Array.from(workerStatsMap.values())
    .sort((a, b) => b.earnedSec - a.earnedSec)
    .slice(0, 10)
    .map((w, idx) => ({
      rank: idx + 1,
      workerId: w.workerId,
      workerName: w.workerName,
      earnedStdHours: Number((w.earnedSec / 3600).toFixed(1)),
      kpiPct: w.kpis.length
        ? Math.round(w.kpis.reduce((a, b) => a + b, 0) / w.kpis.length)
        : 100,
      okQtyTotal: w.okQty,
    }));

  const alertsTicker: string[] = [];
  if (overtimeCount > 0) {
    const otWorkers = Array.from(
      new Set(
        machines
          .filter((m) => m.isOvertime && m.currentWorkerName)
          .map((m) => m.currentWorkerName)
      )
    ).join(', ');
    alertsTicker.push(`🔥 TĂNG CA (OT): Đang có ${overtimeCount} vị trí máy chạy tăng ca (Thợ: ${otWorkers})`);
  }
  for (const m of machines) {
    if (m.status === 'STOPPED') {
      alertsTicker.push(`🚨 SỰ CỐ / DỪNG MÁY: ${m.name} (${m.stopReason || 'Kiểm tra kỹ thuật'})`);
    }
  }
  for (const po of urgentOrders.slice(0, 4)) {
    if (po.isOverdue) {
      alertsTicker.push(
        `⏰ ĐƠN QUÁ HẠN: ${po.poId} (${po.productName}) còn thiếu ${po.remainQty} SP`
      );
    }
  }
  if (alertsTicker.length === 0) {
    alertsTicker.push(
      `✅ Kế hoạch ${currentShift} xưởng GCCK Thắng Lợi — Máy cắt dây DK7745 chạy 24/24 — Tuân thủ tự kiểm ★ & 5S cuối ca.`
    );
  }

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
    const row = planRows.find((r) => (r.workerName || '').trim().toLowerCase() === name.toLowerCase());
    return row ? row.shiftType : null;
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
    const rowsForWorker = shiftPlanRows.filter((r) => (r.workerName || '').trim().toLowerCase() === w.name.toLowerCase());

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
        primaryMachine = firstRow.machineName || '';
        productName = firstRow.productName || '';
        opName = firstRow.opName || '';
        plannedQty = firstRow.plannedQty || 0;
        note = firstRow.note || '';

        if (rowsForWorker.length > 1) {
          const secondRow = rowsForWorker[1];
          secondaryMachine = secondRow.machineName || '';
        }

        const hasOt = rowsForWorker.some((r) => r.isOvertime || (r.note && /tăng ca|ot/i.test(r.note)));
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

  return {
    workersStatus,
    serverTime: now.toISOString(),
    vietnamDate: vDate,
    spindleRunPct,
    summary: {
      totalMachines: machines.length,
      runningCount,
      setupCount,
      stoppedCount,
      idleCount,
      overtimeCount,
      todayOkQty,
      todayScrapQty,
    },
    machines,
    urgentOrders,
    workerLeaderboard,
    alertsTicker,
  };
}

export function getFallbackAttendance(ym: string) {
  const [yStr, mStr] = ym.split('-');
  const year = Number(yStr) || 2026;
  const month = Number(mStr) || 10;
  const key = `GCCK_ATTENDANCE_V2_${ym}`;

  let rawList: AttendanceRow[] = [];
  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem(key);
      if (stored) {
        rawList = JSON.parse(stored);
      }
    } catch { }
  }

  if (!rawList || rawList.length === 0) {
    if (ym === '2026-10') {
      rawList = (seedData.attendanceList || []).map((e: any) => ({
        empId: String(e.empId),
        name: String(e.name),
        workType: String(e.workType || 'Công'),
        defaultShift: String(e.defaultShift || 'Ca 1'),
        yearDaysHist: Array.isArray(e.yearDaysHist) ? [...e.yearDaysHist] : new Array(12).fill(0),
        days: Array.isArray(e.days) ? [...e.days] : new Array(31).fill(''),
      }));
    } else {
      rawList = FALLBACK_WORKERS.filter((w) => w.isActive !== 0).map((w) => {
        const defShift = String(w.salaryMode || '').includes('Hành chính') ? 'Hành chính' : 'Ca 1';
        return {
          empId: w.id,
          name: w.name,
          workType: 'Công',
          defaultShift: defShift,
          yearDaysHist: new Array(12).fill(0),
          days: new Array(31).fill(''),
        };
      });
    }
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(key, JSON.stringify(rawList));
      } catch { }
    }
  }

  const dows = computeMonthDows(year, month);
  const employees: EmployeeAttSummary[] = rawList.map((emp) =>
    computeEmployeeMonthlyStats(emp, year, month, DEFAULT_MEAL_CONFIG)
  );

  return {
    yearMonth: ym,
    year,
    month,
    dows,
    mealConfig: DEFAULT_MEAL_CONFIG,
    employees,
  };
}

export function saveFallbackAttendanceCell(
  ym: string,
  empId: string,
  dayIndex: number,
  value: string,
  defaultShift?: string
) {
  const [yStr, mStr] = ym.split('-');
  const year = Number(yStr) || 2026;
  const month = Number(mStr) || 10;
  const key = `GCCK_ATTENDANCE_V2_${ym}`;

  getFallbackAttendance(ym); // Ensure populated
  let rawList: AttendanceRow[] = [];
  try {
    const stored = localStorage.getItem(key);
    if (stored) rawList = JSON.parse(stored);
  } catch { }

  const targetIdx = rawList.findIndex((r) => r.empId === empId);
  let updatedRow: AttendanceRow;
  if (targetIdx >= 0) {
    const r = rawList[targetIdx];
    const days = [...(r.days || [])];
    while (days.length < 31) days.push('');
    if (dayIndex >= 0 && dayIndex < 31) {
      days[dayIndex] = value;
    }
    if (defaultShift) {
      r.defaultShift = defaultShift;
    }
    r.days = days;
    rawList[targetIdx] = r;
    updatedRow = r;
  } else {
    const days = new Array(31).fill('');
    if (dayIndex >= 0 && dayIndex < 31) days[dayIndex] = value;
    updatedRow = {
      empId,
      name: empId,
      workType: 'Công',
      defaultShift: defaultShift || 'Ca 1',
      yearDaysHist: new Array(12).fill(0),
      days,
    };
    rawList.push(updatedRow);
  }

  try {
    localStorage.setItem(key, JSON.stringify(rawList));
  } catch { }

  const summary = computeEmployeeMonthlyStats(updatedRow, year, month, DEFAULT_MEAL_CONFIG);
  return { success: true, employee: summary };
}

export function batchFallbackAttendance(ym: string, payload: any) {
  const [yStr, mStr] = ym.split('-');
  const year = Number(yStr) || 2026;
  const month = Number(mStr) || 10;
  const dows = computeMonthDows(year, month);
  const key = `GCCK_ATTENDANCE_V2_${ym}`;

  const mode = String(payload?.mode || 'DEFAULT_SHIFT');
  const fromDay = Math.max(1, Math.min(31, Number(payload?.fromDay) || 1));
  const toDay = Math.max(fromDay, Math.min(31, Number(payload?.toDay) || 25));
  const rawVal = String(payload?.value ?? '').toUpperCase();
  const selectedDows: string[] = Array.isArray(payload?.selectedDows)
    ? payload.selectedDows
    : ['T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  const empIds: string[] = Array.isArray(payload?.empIds) ? payload.empIds : [];
  const fillEmptyWithDef = Boolean(payload?.fillEmptyWithDef ?? true);
  const overwrite = Boolean(payload?.overwrite ?? false);

  getFallbackAttendance(ym); // Ensure loaded
  let rawList: AttendanceRow[] = [];
  try {
    const stored = localStorage.getItem(key);
    if (stored) rawList = JSON.parse(stored);
  } catch { }

  let changedCells = 0;
  for (const emp of rawList) {
    if (empIds.length > 0 && !empIds.includes(emp.empId)) continue;
    const defCode = getDefShiftCode(emp.defaultShift);
    const days = [...(emp.days || [])];
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
    emp.days = days;
  }

  try {
    localStorage.setItem(key, JSON.stringify(rawList));
  } catch { }

  const refreshed = rawList.map((e) =>
    computeEmployeeMonthlyStats(e, year, month, DEFAULT_MEAL_CONFIG)
  );

  return { success: true, changedCells, employees: refreshed };
}

export function getFallbackPayroll(ym: string) {
  const attRes = getFallbackAttendance(ym);
  const allLogs = getAllFallbackLogs();

  const logMap = new Map<string, WorkerMonthlyLogAgg>();
  for (const l of allLogs) {
    if (l.isVoided) continue;
    if (l.workDate && !l.workDate.startsWith(ym)) continue;
    const wId = l.workerId || '';
    if (!wId) continue;
    let agg = logMap.get(wId);
    if (!agg) {
      agg = {
        workerId: wId,
        logCount: 0,
        earnedStdSeconds: 0,
        directPieceIncome: 0,
        waitWageTotal: 0,
        otBonusTotal: 0,
        logMealTotal: 0,
        scrapPenaltyTotal: 0,
      };
      logMap.set(wId, agg);
    }
    agg.logCount++;
    agg.earnedStdSeconds += (Number(l.okQty) || 0) * (Number(l.stdSeconds) || 1800);
    agg.directPieceIncome += Number(l.directPieceIncome) || 0;
    agg.waitWageTotal += Number(l.waitWage) || 0;
    agg.otBonusTotal += Number(l.otBonusWage) || 0;
    agg.logMealTotal += Number(l.mealAllowance) || 0;
    agg.scrapPenaltyTotal += Number(l.scrapPenalty) || 0;
  }

  const logAggs = Array.from(logMap.values());
  const rows = computeMonthly3PPayroll(FALLBACK_WORKERS, attRes.employees, logAggs);
  const totalNetPay = rows.reduce((acc, r) => acc + (r.netPay || 0), 0);

  return {
    yearMonth: ym,
    rows,
    totalNetPay,
  };
}

export function getFallbackCosting(): {
  items: ProductCostingSummary[];
  summary: {
    totalProducts: number;
    profitCount: number;
    lossCount: number;
    totalNetProfit: number;
  };
} {
  const opsBySp = new Map<string, OperationMeta[]>();
  for (const o of FALLBACK_OPERATIONS) {
    const list = opsBySp.get(o.spId) || [];
    list.push(o);
    opsBySp.set(o.spId, list);
  }

  const logs = getAllFallbackLogs();
  const logsByNc = new Map<string, OpLogSummary[]>();
  for (const l of logs) {
    if (l.isVoided) continue;
    const nc = l.ncId;
    if (!nc) continue;
    const list = logsByNc.get(nc) || [];
    list.push({
      ncId: nc,
      okQty: Number(l.okQty || 0),
      reworkQty: Number(l.reworkQty || 0),
      scrapQty: Number(l.scrapQty || 0),
      batchCost: Number(l.batchCost || 0),
      isVoided: 0,
    });
    logsByNc.set(nc, list);
  }

  const items = FALLBACK_PRODUCTS.map((p) => {
    const pOps = opsBySp.get(p.spId) || [];
    const pLogs = pOps.flatMap((o) => logsByNc.get(o.ncId) || []);
    return computeProductCosting(p, pOps, pLogs);
  });

  const profitCount = items.filter((i) => i.unitProfit >= 0).length;
  const lossCount = items.filter((i) => i.unitProfit < 0).length;
  const totalNetProfit = items.reduce(
    (sum, i) => sum + (i.hasActual ? i.totalBatchProfit : 0),
    0
  );

  return {
    items,
    summary: {
      totalProducts: items.length,
      profitCount,
      lossCount,
      totalNetProfit,
    },
  };
}
