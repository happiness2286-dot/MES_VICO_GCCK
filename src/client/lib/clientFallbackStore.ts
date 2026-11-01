import type {
  AndonLivePayload,
  MachineStatus,
  AppRole,
  AuthSessionResponse,
  AuthSessionUser,
  BootstrapPayload,
  CuttingTool,
  HandoverSlipRow,
  JobTravelerDto,
  MachineInfo,
  OperationMeta,
  ProductMeta,
  PurchaseOrderInfo,
  QuickSwitchProfile,
  ReportSubmitPayload,
  ReportSubmitResponse,
  WeeklyProposalItem,
  WeeklyReportData,
  WorkerDto,
} from '@shared/types';
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
  } catch {}
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
  faiStatus: p.faiStatus || 'PASSED_FAI',
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

export const FALLBACK_PROFILES: QuickSwitchProfile[] = [
  {
    workerId: 'NV00214',
    name: 'Trần Văn Quỳnh',
    role: 'CN',
    appRole: 'WORKER',
    title: 'Công nhân đứng máy CNC',
    salaryMode: 'KHOAN',
  },
  {
    workerId: 'NV00266',
    name: 'Trần Văn Dũng',
    role: 'TC',
    appRole: 'SHIFT_LEADER',
    title: 'Trưởng ca / Kiểm soát QC',
    salaryMode: 'LUONG_NGAY',
  },
  {
    workerId: 'NV00053',
    name: 'Hoàng Ngọc Hà',
    role: 'QĐ',
    appRole: 'ADMIN',
    title: 'Quản đốc xưởng',
    salaryMode: 'LUONG_NGAY',
  },
];

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

export function verifyFallbackPin(workerIdOrUsername: string, pin: string): boolean {
  const norm = workerIdOrUsername.trim().toLowerCase();
  const worker = FALLBACK_WORKERS.find(
    (w) => w.id.toLowerCase() === norm || (w.username && w.username.toLowerCase() === norm)
  );
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

export function getFallbackUser(workerId: string = 'NV00214'): AuthSessionUser {
  const w = FALLBACK_WORKERS.find((x) => x.id === workerId) || FALLBACK_WORKERS[0];
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
  return {
    authenticated: true,
    user: getFallbackUser('NV00214'),
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
