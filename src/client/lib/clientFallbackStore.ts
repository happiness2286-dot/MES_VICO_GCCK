import type {
  AndonLivePayload,
  MachineStatus,
  AppRole,
  AttendanceRow,
  AuthSessionResponse,
  AuthSessionUser,
  BootstrapPayload,
  CuttingTool,
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
import { removeVietnameseTones } from '@shared/vnSearch';
import seedData from '../../../data/seed_gcck_1233.json';
import { isSupabaseConnected, pushLogToSupabase } from './supabaseClient';

export const GAS_WEBHOOK_URL =
  'https://script.google.com/macros/s/AKfycbx3YEacwHuxAdYb2yN1qckG4tmydnmmK4f8C_KVtQmUWmpBvJYUh_Jc1DrFZpTeM-bruQ/exec';

const LOCAL_LOGS_KEY = 'GCCK_LOCAL_CLIENT_LOGS_V2_NOV2026';

// One-time automatic purge of pre-November test logs across devices
if (typeof window !== 'undefined') {
  try {
    localStorage.removeItem('GCCK_LOCAL_CLIENT_LOGS_V1');
    localStorage.removeItem('GCCK_OUTBOX_V1');
  } catch { }
}

export const FALLBACK_PRODUCTS: ProductMeta[] = (seedData.costingList || []).map((c: any) => ({
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

export const FALLBACK_OPERATIONS: OperationMeta[] = (seedData.operations || []).map((o: any, idx: number) => ({
  ncId: String(o.ncId),
  spId: String(o.spId || `SP${String(idx + 1).padStart(3, '0')}`),
  customer: String(o.customer || 'Vico - Nội bộ / Khách lẻ'),
  productName: String(o.productName),
  opName: String(o.opName),
  stdSeconds: Number(o.stdSeconds || 1800),
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
}));

export const FALLBACK_MACHINES: MachineInfo[] = (seedData.machines || []).map((m: any) => ({
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

export const FALLBACK_ORDERS: PurchaseOrderInfo[] = (seedData.ordersList || []).map((p: any) => ({
  poId: String(p.poId),
  spId: p.spId ? String(p.spId) : null,
  customer: String(p.customer || 'Nội bộ'),
  productName: String(p.productName),
  qtyPo: Number(p.qtyPo || 0),
  dueDate: String(p.dueDate || '2026-11-30'),
  wipQty: 0,
  finishedQty: 0,
  deliveredQty: 0,
  stockQty: 0,
  remainQty: Number(p.qtyPo || 0),
  status: String(p.status || '⏳ Đang chờ SX'),
  materialLot: p.materialLot || 'LOT-2026-VC',
  faiStatus: p.faiStatus || 'FAI_PASSED',
}));

export const FALLBACK_WORKERS: WorkerDto[] = (seedData.workers || []).map((w: any) => {
  let appRole: AppRole = 'WORKER';
  if (w.id === 'NV00053' || w.role === 'QĐ' || w.title?.includes('Quản đốc')) {
    appRole = 'ADMIN';
  } else if (w.id === 'NV00266' || w.role === 'TC' || w.title?.includes('Trưởng ca') || w.title?.includes('QC')) {
    appRole = 'SHIFT_LEADER';
  } else if (w.role === 'KT') {
    appRole = 'SHIFT_LEADER';
  }

  return {
    id: String(w.id),
    name: String(w.name),
    username: String(w.username || w.name),
    role: String(w.role || 'CN'),
    appRole,
    title: String(w.title || 'Công nhân'),
    salaryMode: String(w.salaryMode || 'KHOAN'),
    isLinked: true,
    chatId: w.chatId ? String(w.chatId) : null,
  };
});

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
    return raw ? JSON.parse(raw) : [];
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
    const existing = getClientStoredLogs();
    existing.unshift(log);
    localStorage.setItem(LOCAL_LOGS_KEY, JSON.stringify(existing.slice(0, 100)));
  } catch {
    // ignore
  }
}

export function getAllFallbackLogs(): any[] {
  const stored = getClientStoredLogs();
  const seen = new Set<string>();
  const list: any[] = [];
  for (const l of stored) {
    const key = String(l.recordUid || l.id);
    if (!seen.has(key)) {
      seen.add(key);
      list.push(l);
    }
  }
  return list;
}

const LOCAL_HANDOVERS_KEY = 'GCCK_LOCAL_HANDOVERS_V1';

export const INITIAL_HANDOVERS: HandoverSlipRow[] = [
  {
    id: 'HO-2026-001',
    handoverDate: new Date().toISOString().slice(0, 10),
    fromDept: 'PX_GIA_CONG',
    toDept: 'PX_NHIET_LUYEN',
    poId: 'PO485-01',
    spId: 'SP002',
    productName: 'ALKTOP 1342 M',
    customer: 'Win-Win - PO485',
    unit: 'Cái',
    prodQtyTransferred: 84,
    prodQtyDefect: 2,
    prodQtyMissing: 4,
    rawQtyTransferred: 90,
    rawQtyDefect: 0,
    rawQtyMissing: 0,
    note: 'Đã hoàn thành tiện NC1 + NC2, chuyển nhiệt luyện thấm cacbon',
    receiverName: 'Trần Văn Dũng',
    senderName: 'Trần Văn Quỳnh',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'HO-2026-002',
    handoverDate: new Date().toISOString().slice(0, 10),
    fromDept: 'PX_GIA_CONG',
    toDept: 'PX_HOAN_THIEN',
    poId: 'PO-2026-015',
    spId: 'SP001',
    productName: 'Pattern Drawing No 2CG00382',
    customer: 'TFG',
    unit: 'Cái',
    prodQtyTransferred: 35,
    prodQtyDefect: 1,
    prodQtyMissing: 0,
    rawQtyTransferred: 36,
    rawQtyDefect: 0,
    rawQtyMissing: 0,
    note: 'Chuyển xưởng hoàn thiện mài phẳng và cạo ba-via',
    receiverName: 'Phùng Gia Phúc',
    senderName: 'Phạm Văn Tráng',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'HO-2026-003',
    handoverDate: new Date().toISOString().slice(0, 10),
    fromDept: 'PHONG_KHVT',
    toDept: 'PX_GIA_CONG',
    poId: 'PO-2026-088',
    spId: 'SP005',
    productName: 'Thanh đập đá vôi',
    customer: 'Hùng HD - XM Hoàng Thạch',
    unit: 'Cái',
    prodQtyTransferred: 0,
    prodQtyDefect: 0,
    prodQtyMissing: 0,
    rawQtyTransferred: 20,
    rawQtyDefect: 1,
    rawQtyMissing: 0,
    note: 'Kho KHVT cấp 20 phôi đúc, phát hiện 1 phôi nứt xỉ cần đúc bù',
    receiverName: 'Trần Văn Quỳnh',
    senderName: 'Kho KHVT',
    createdAt: new Date().toISOString(),
  },
];

export function getFallbackHandovers(dateStr?: string): HandoverSlipRow[] {
  try {
    const raw = localStorage.getItem(LOCAL_HANDOVERS_KEY);
    const list: HandoverSlipRow[] = raw ? JSON.parse(raw) : INITIAL_HANDOVERS;
    if (dateStr) {
      const filtered = list.filter((h) => h.handoverDate === dateStr);
      return filtered.length > 0 ? filtered : list;
    }
    return list;
  } catch {
    return INITIAL_HANDOVERS;
  }
}

export function saveFallbackHandover(row: HandoverSlipRow): void {
  try {
    const list = getFallbackHandovers();
    list.unshift(row);
    localStorage.setItem(LOCAL_HANDOVERS_KEY, JSON.stringify(list));
  } catch {
    // ignore
  }
}

export function getFallbackBootstrap(currentUser?: AuthSessionUser | null): BootstrapPayload {
  const user = currentUser || getFallbackUser('NV00214');
  const combinedLogs = getAllFallbackLogs();

  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const vnToday = `${yyyy}-${mm}-${dd}`;

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
    ordersList: FALLBACK_ORDERS,
    schedules: [],
    machineLoads: [],
    qcInspections: [],
    recentLogs: combinedLogs,
    todayAccumulated: {},
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
    customer: op?.customer || 'Vico - Nội bộ / Khách lẻ',
    productName: op?.productName || 'Sản phẩm GCCK',
    poId: payload.poId || 'PO485-01',
    ncId: op?.ncId || payload.ncId,
    opName: op?.opName || payload.ncId || 'Gia công',
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
    customer: op?.customer || 'Vico - Nội bộ / Khách lẻ',
    product: op?.productName || 'Sản phẩm GCCK',
    po: payload.poId || 'PO485-01',
    op: op?.opName || payload.ncId || 'Gia công',
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
  const timeStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')} ${hours}:${minutes}`;

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
    poId: payload.poId || 'PO-THEO-KH',
    spId: (payload as any).spId || op?.spId || null,
    customer: (payload as any).customer || op?.customer || 'Vico - Nội bộ / Khách lẻ',
    productName: (payload as any).productName || op?.productName || 'Sản phẩm GCCK',
    ncId: payload.ncId || op?.ncId || 'NC001',
    opName: (payload as any).opName || op?.opName || payload.ncId || 'Gia công',
    stage: op?.stage || 'End',
    stepOrder: op?.stepOrder || 1,
    isFinalOp: op?.isFinalOp || 1,
    stdSeconds: op?.stdSeconds || 1800,
    okQty: Number(payload.okQty || 0),
    reworkQty: Number(payload.reworkQty || 0),
    scrapQty,
    defectType: scrapQty > 0 ? (payload.defectType || 'Không rõ lỗi') : 'Không có lỗi',
    damageValue: Number(payload.damageValue || 0),
    stopMinutes: Number(payload.stopMinutes || 0),
    stopReason: payload.stopReason || 'Không có dừng máy',
    toolCode: payload.toolCode || '',
    edgesUsed,
    selfCheckOk: 1,
    qcStatus: 'PASSED',
    pieceWage: turnIncome,
    otBonusWage: 0,
    waitWage: 0,
    mealAllowance: 0,
    scrapPenalty: 0,
    income: turnIncome,
    directPieceIncome: turnIncome,
    batchCost: turnIncome,
    kpiPct: 100,
    kpiStatus: 'Đạt 100% ĐM',
    photoUrl: payload.photoBase64 || '',
    handoverNote: (payload as any).handoverNote || '',
    materialLot: payload.materialLot || '',
    note: (payload as any).note || payload.handoverNote || '',
    isVoided: 0,
  };

  saveClientStoredLog(mockLogDto);

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
  const po =
    FALLBACK_ORDERS.find((o) => o.poId === cleanPoId) ||
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

  const product =
    FALLBACK_PRODUCTS.find((p) => p.productName === po.productName) || {
      spId: 'SP-01',
      customer: po.customer,
      productName: po.productName,
      matName: 'Thép C45',
      setupMinutesStd: 15,
      opCount: 3,
      totalStdSeconds: 5400,
      drawingUrl: '',
      techDocUrl: '',
      quotedPrice: 120000,
      rawMaterialCost: 40000,
      outsourceCost: 0,
    };

  const ops = FALLBACK_OPERATIONS.filter(
    (o) => o.productName === po.productName
  ).sort((a, b) => a.stepOrder - b.stepOrder);

  const finalOpsList = ops.length > 0 ? ops : FALLBACK_OPERATIONS.slice(0, 3);
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
        machineName: 'Máy Tiện CNC 1',
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
  const cleanPoId = (poId || '').replace(/\/traceability$/, '').trim().toLowerCase();
  const po =
    FALLBACK_ORDERS.find((o) => o.poId.toLowerCase() === cleanPoId) ||
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

  const ops = FALLBACK_OPERATIONS.filter(
    (o) => (po.spId && o.spId === po.spId) || o.productName === po.productName
  ).sort((a, b) => a.stepOrder - b.stepOrder);

  const finalOpsList = ops.length > 0 ? ops : FALLBACK_OPERATIONS.slice(0, 3);
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
    qcRecords: [
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

export function saveFallbackOrdersBatch(orders: Array<Partial<PurchaseOrderInfo>>): PurchaseOrderInfo[] {
  const created: PurchaseOrderInfo[] = [];
  for (const raw of orders) {
    const poId = String(raw.poId || '').trim();
    if (!poId) continue;
    const existingIdx = FALLBACK_ORDERS.findIndex(o => o.poId.toLowerCase() === poId.toLowerCase());
    const qtyPo = Math.max(1, Math.round(Number(raw.qtyPo) || 1));
    const newPo: PurchaseOrderInfo = {
      poId,
      spId: raw.spId ? String(raw.spId) : null,
      customer: String(raw.customer || 'Nội bộ'),
      productName: String(raw.productName || 'Chi tiết cơ khí'),
      qtyPo,
      dueDate: String(raw.dueDate || '2026-11-30'),
      wipQty: Number(raw.wipQty || 0),
      finishedQty: Number(raw.finishedQty || 0),
      deliveredQty: Number(raw.deliveredQty || 0),
      stockQty: Number(raw.stockQty || 0),
      remainQty: Math.max(0, qtyPo - Number(raw.deliveredQty || 0)),
      status: String(raw.status || '⏳ Đang chờ SX'),
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
    poStatuses: FALLBACK_ORDERS.slice(0, 10).map((po) => ({
      poId: po.poId,
      customer: po.customer,
      productName: po.productName,
      qtyPo: po.qtyPo,
      finishedQty: po.finishedQty,
      wipQty: po.remainQty,
      dueDate: po.dueDate,
      status: po.status,
      isDelayed: po.remainQty > 0 && new Date(po.dueDate) < new Date(),
    })),
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

export function getFallbackAndonLive(): AndonLivePayload {
  const now = new Date();
  const vDate = now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
  const allLogs = getAllFallbackLogs();
  const todayLogs = allLogs.filter((l) => l.workDate === vDate && !l.isVoided);
  const todayOkQty = todayLogs.reduce((acc, l) => acc + (Number(l.okQty) || 0), 0);
  const todayScrapQty = todayLogs.reduce((acc, l) => acc + (Number(l.scrapQty) || 0), 0);

  const machines = FALLBACK_MACHINES.map((m, idx) => {
    let status: MachineStatus = (m.status as MachineStatus) || 'RUNNING';
    let isLightsOut = false;
    let isBottleneck = false;
    let loadPct = 65 + ((idx * 7) % 45);

    if (idx === 3 || idx === 11) {
      status = 'STOPPED';
      loadPct = 40;
    } else if (idx === 5) {
      status = 'SETUP';
      loadPct = 80;
    } else if (idx === 7) {
      status = 'IDLE';
      loadPct = 20;
    } else if (idx === 2 || idx === 4) {
      isBottleneck = true;
      loadPct = 108;
    } else if (idx >= 18) {
      isLightsOut = true;
      loadPct = 90;
    }

    const assignedOrder = FALLBACK_ORDERS[idx % FALLBACK_ORDERS.length];
    const assignedOp = FALLBACK_OPERATIONS[idx % FALLBACK_OPERATIONS.length];

    return {
      id: m.id,
      name: m.name,
      group: m.group,
      status,
      currentWorkerName:
        status === 'RUNNING' || status === 'SETUP'
          ? m.currentWorkerName || 'Trần Văn Quỳnh'
          : null,
      currentPoId:
        status === 'RUNNING' || status === 'SETUP'
          ? m.currentPoId || assignedOrder?.poId || 'PO485-01'
          : null,
      currentNcId:
        status === 'RUNNING' || status === 'SETUP'
          ? m.currentNcId || assignedOp?.ncId || 'NC001'
          : null,
      currentProductName:
        status === 'RUNNING' || status === 'SETUP'
          ? assignedOrder?.productName || assignedOp?.productName || 'Đĩa búa'
          : null,
      currentOpName:
        status === 'RUNNING' || status === 'SETUP'
          ? assignedOp?.opName || 'Tiện CNC'
          : null,
      stopReason:
        status === 'STOPPED'
          ? m.stopReason || 'Chờ phôi thép SCM440 từ kho'
          : null,
      isLightsOut,
      loadPct,
      isBottleneck,
    };
  });

  const runningCount = machines.filter((m) => m.status === 'RUNNING').length;
  const setupCount = machines.filter((m) => m.status === 'SETUP').length;
  const stoppedCount = machines.filter((m) => m.status === 'STOPPED').length;
  const idleCount = machines.length - runningCount - setupCount - stoppedCount;
  const spindleRunPct =
    machines.length > 0 ? Math.round((runningCount / machines.length) * 100) : 0;

  const urgentOrders = FALLBACK_ORDERS.filter((po) => po.remainQty > 0)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 12)
    .map((po) => ({
      poId: po.poId,
      customer: po.customer,
      productName: po.productName,
      qtyPo: po.qtyPo,
      finishedQty: po.finishedQty,
      remainQty: po.remainQty,
      dueDate: po.dueDate,
      isOverdue: Boolean(po.dueDate && po.dueDate < vDate),
      progressPct:
        po.qtyPo > 0
          ? Math.min(100, Math.round((po.finishedQty / po.qtyPo) * 100))
          : 0,
      status: po.status,
    }));

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
  allLogs
    .filter((l) => !l.isVoided)
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

  if (workerLeaderboard.length === 0) {
    workerLeaderboard = [
      {
        rank: 1,
        workerId: 'NV00214',
        workerName: 'Trần Văn Quỳnh',
        earnedStdHours: 14.5,
        kpiPct: 112,
        okQtyTotal: 18,
      },
      {
        rank: 2,
        workerId: 'NV00215',
        workerName: 'Phạm Văn Tráng',
        earnedStdHours: 12.8,
        kpiPct: 104,
        okQtyTotal: 15,
      },
      {
        rank: 3,
        workerId: 'NV00216',
        workerName: 'Lê Minh Tuấn',
        earnedStdHours: 11.2,
        kpiPct: 98,
        okQtyTotal: 12,
      },
    ];
  }

  const alertsTicker: string[] = [
    '🔔 Phân xưởng Gia công Cơ khí Thắng Lợi — Tín hiệu giám sát sản xuất Realtime đang kết nối.',
    '🟢 18/23 máy đang chạy tải ổn định.',
    '⚠️ Máy Phay CNC 4 đang chờ cấp phôi SCM440 từ kho.',
  ];

  return {
    serverTime: now.toISOString(),
    vietnamDate: vDate,
    spindleRunPct,
    summary: {
      totalMachines: machines.length,
      runningCount,
      setupCount,
      stoppedCount,
      idleCount,
      todayOkQty: todayOkQty || 26,
      todayScrapQty: todayScrapQty || 0,
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
