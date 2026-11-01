export type AppRole = 'WORKER' | 'SHIFT_LEADER' | 'QC' | 'DIRECTOR' | 'ADMIN';
export type AuthMode = 'DEMO_QUICK' | 'STRICT_PIN';

export type MachineStatus = 'RUNNING' | 'STOPPED' | 'SETUP' | 'IDLE' | 'MAINTENANCE';

export interface AuthSessionUser {
  workerId: string;
  name: string;
  username: string;
  role: string;
  appRole: AppRole;
  title: string;
  salaryMode: string;
  baseSalary?: number;
  costPerSec?: number;
  isLinked: boolean;
  chatId?: string | null;
}

export interface QuickSwitchProfile {
  workerId: string;
  name: string;
  role: string;
  appRole: AppRole;
  title: string;
  salaryMode: string;
}

export interface AuthSessionResponse {
  authenticated: boolean;
  authMode: AuthMode;
  user: AuthSessionUser | null;
  quickSwitchProfiles: QuickSwitchProfile[];
}

export interface WorkerDto {
  id: string;
  name: string;
  username: string;
  role: string;
  appRole: AppRole;
  title: string;
  salaryMode: string;
  baseSalary?: number;
  costPerSec?: number;
  chatId?: string | null;
  isLinked: boolean;
  isActive?: number;
}

export interface MachineInfo {
  id: string;
  name: string;
  group: string;
  costPerHour: number;
  status?: MachineStatus;
  currentWorkerName?: string | null;
  currentPoId?: string | null;
  currentNcId?: string | null;
  stopReason?: string | null;
  updatedAt?: string | null;
}

export interface CuttingTool {
  code: string;
  group: string;
  name: string;
  buyPrice: number;
  edges: number;
  costPerEdge: number;
  stockQty?: number;
  usedEdgesTotal?: number;
}

export interface ProductMeta {
  spId: string;
  customer: string;
  productName: string;
  matName?: string;
  quotedPrice?: number;
  rawMaterialCost?: number;
  outsourceCost?: number;
  setupMinutesStd?: number;
  opCount?: number;
  opsSummary?: string;
  totalStdSeconds?: number;
  drawingUrl?: string;
  techDocUrl?: string;
}

export interface OperationMeta {
  ncId: string;
  spId: string;
  customer: string;
  productName: string;
  opName: string;
  stdSeconds: number;
  stage: string;
  stepOrder: number;
  isFinalOp: number;
  defaultMachine: string;
  matName: string;
  cuttingRec: string;
  toolCode: string;
  toolName: string;
  costPerEdge: number;
  stdEdgesPerPcs: number;
  stdLaborCost: number;
  stdMachCost: number;
  stdToolCost: number;
  isCriticalCheck?: number;
  drawingUrl?: string;
  setupDocUrl?: string;
}

export type FaiStatus = 'NOT_REQUIRED' | 'PENDING_FAI' | 'FAI_PASSED' | 'FAI_FAILED';

export interface PurchaseOrderInfo {
  poId: string;
  customer: string;
  contractRef?: string;
  spId: string | null;
  productName: string;
  qtyPo: number;
  dueDate: string;
  wipQty: number;
  finishedQty: number;
  deliveredQty: number;
  stockQty: number;
  remainQty: number;
  status: string;
  materialLot?: string;
  supplierName?: string;
  castDate?: string;
  priority?: number;
  note?: string;
  faiStatus?: FaiStatus;
  drawingUrl?: string;
  techDocUrl?: string;
}

export interface SystemPayrollConfig {
  secondsPerShift: number;
  secondMachineRate: number;
  mealShift23: number;
  mealOt2h: number;
  mealSunday: number;
  kpiWarningThreshold: number;
  googleDriveFolderUrl?: string;
}

export interface PriorShiftLogItem {
  machineName: string;
  startTime: string;
  endTime: string;
  mealAllowancePaid?: number;
  paidOtMinutes?: number;
  paidStopMinutes?: number;
}

export interface ShiftPriorContext {
  priorLogs?: PriorShiftLogItem[];
  mealAlreadyPaid?: boolean;
  mealPaidAmount?: number;
  paidOtMinutes?: number;
  paidStopMinutes?: number;
}

export interface PayrollCalcInput {
  workerId: string;
  salaryMode: string;
  costPerSec: number;
  workDate: string;
  shiftType: string;
  startTime: string;
  endTime: string;
  overtimeMinutes: number;
  isSunday?: boolean;
  isLightsOut?: boolean;
  machineName: string;
  machineMode: 'FIRST' | 'SECOND';
  machineCostPerHour: number;
  stdSeconds: number;
  stdEdgesPerPcs: number;
  costPerEdge: number;
  edgesUsed?: number;
  okQty: number;
  reworkQty: number;
  scrapQty: number;
  defectType?: string;
  damageValue?: number;
  stopMinutes: number;
  stopReason?: string;
}

export interface PayrollCalcResult {
  effectiveMachineMode: 'FIRST' | 'SECOND';
  machRate: number;
  shiftMult: number;
  isSunday: boolean;
  effectiveOtMinutes: number;
  unpaidOtMinutes: number;
  effectivePaidStopMinutes: number;
  isMonthlyStaff: boolean;
  unitPiecePrice: number;
  earnedStdSeconds: number;
  netWorkSeconds: number;
  basePieceWage: number;
  otBonusWage: number;
  waitWage: number;
  pieceWage: number;
  directPieceIncome: number;
  mealAllowance: number;
  scrapPenalty: number;
  turnTotalIncome: number;
  costingLaborCost: number;
  costingMachCost: number;
  costingToolCost: number;
  costingScrapLoss: number;
  batchCost: number;
  kpiPct: number;
  kpiStatus: string;
  edgesConsumed: number;
}

export interface OpLogSummary {
  ncId: string;
  okQty: number;
  reworkQty?: number;
  scrapQty?: number;
  batchCost: number;
  scrapCost?: number;
  isVoided?: number | boolean;
}

export interface OpStepCostBreakdown {
  ncId: string;
  opName: string;
  stepOrder: number;
  isFinalOp: number;
  stdSeconds: number;
  stdOpUnitCost: number;
  loggedOkQty: number;
  loggedBatchCost: number;
  effectiveUnitCost: number;
  usedStdFallback: boolean;
}

export interface ProductCostingSummary {
  spId: string;
  customer: string;
  productName: string;
  opCount: number;
  opsSummary: string;
  totalSec: number;
  totalHours: number;
  stdLabor: number;
  stdMach: number;
  stdTool: number;
  stdOverhead: number;
  rawMaterialCost: number;
  outsourceCost: number;
  totalStdCost: number;
  quotedPrice: number;
  wipQty: number;
  wipBatchCost: number;
  finishedQty: number;
  actualBatchCost: number;
  actualUnitCost: number;
  unitProfit: number;
  totalBatchProfit: number;
  marginPct: number;
  hasActual: boolean;
  stepBreakdowns: OpStepCostBreakdown[];
  drawingUrl?: string;
  techDocUrl?: string;

  // Real-world shopfloor all-in machine rate (800k/ca = 100k/h) & 8h shift quota
  allInMachineCost?: number;
  shiftQuota8h?: number;
  shiftTargetRevenue?: number;
}

export interface MealConfig {
  mealShift23: number;
  mealOt2h: number;
  mealSunday: number;
}

export interface ParsedAttDay {
  raw: string;
  regDays: number;
  s3Days: number;
  ot15: number;
  ot20: number;
  ot30: number;
  meal: number;
  offDays: number;
  pDays: number;
  kpDays: number;
  lateHours: number;
  abExtra: number;
  err: number;
}

export interface AttendanceRow {
  empId: string;
  name: string;
  workType: string;
  defaultShift: string;
  yearDaysHist: number[];
  days: string[];
}

export interface EmployeeAttSummary {
  empId: string;
  name: string;
  workType: string;
  defaultShift: string;
  year: number;
  month: number;
  daysInMonth: number;
  activeDayLimit: number;
  dows: string[];
  days: string[];
  dailyMeals: number[];
  hours100: number;
  abDays: number;
  grade: 'A' | 'B' | 'C (KP)';
  regDays: number;
  s3Days: number;
  ot15: number;
  ot20: number;
  ot30: number;
  totalOt: number;
  mealTotal: number;
  offDays: number;
  pDays: number;
  kpDays: number;
  lateHours: number;
  errCount: number;
  kpDayList: string[];
  lateDayList: string[];
  pDayList: string[];
  badges: string[];
  badgeText: string;
  yearly: {
    months: number[];
    totalYearDays: number;
    totalYearOt: number;
    otCapHours: number;
    otCapPct: number;
    annualLeaveQuota: number;
    usedLeaveDays: number;
    remainingLeaveDays: number;
    yearRank: string;
  };
}

export interface WorkerMonthlyLogAgg {
  workerId: string;
  logCount: number;
  earnedStdSeconds: number;
  directPieceIncome: number;
  waitWageTotal: number;
  otBonusTotal: number;
  logMealTotal: number;
  scrapPenaltyTotal: number;
}

export interface Payroll3PRow {
  workerId: string;
  name: string;
  role: string;
  title: string;
  salaryMode: string;
  baseSalary: number;
  costPerSec: number;
  regDays: number;
  hours100: number;
  totalOt: number;
  grade: 'A' | 'B' | 'C (KP)';
  kpDays: number;
  earnedStdHours: number;
  pieceworkLogCount: number;
  p1PositionPay: number;
  p2PersonBonus: number;
  p3PerformancePay: number;
  mealAllowance: number;
  scrapPenalty: number;
  grossIncome: number;
  netPay: number;
  note: string;
}

export interface ScheduleBlock {
  id: number;
  machineId: string;
  machineName: string;
  poId: string;
  ncId: string;
  productName?: string;
  opName?: string;
  matName?: string;
  toolCode?: string;
  workDate: string;
  shiftType: string;
  plannedQty: number;
  plannedHours: number;
  isLightsOut: number;
  sequenceOrder: number;
  status: string;
  note?: string;
}

export interface DailyPlanRow {
  id?: number;
  workDate: string;
  shiftType: string;
  stt: number;
  workerName: string;
  customer: string;
  spId?: string;
  productName: string;
  ncId?: string;
  opName: string;
  plannedQty: number;
  machineName: string;
  note?: string;
  actualQty?: number;
  drawingUrl?: string;
  status?: string;
}

export interface WeeklyProposalItem {
  id: number;
  weekStart: string;
  category: string;
  proposer: string;
  content: string;
  priority: string;
  status: string;
  createdAt: string;
}

export interface WeeklyReportData {
  weekStart: string;
  weekEnd: string;
  weekLabel: string;
  summary: {
    totalPlannedQty: number;
    totalActualQty: number;
    completionPct: number;
    totalPoActive: number;
    completedPoCount: number;
    delayedPoCount: number;
  };
  customerStats: Array<{
    customer: string;
    productCount: number;
    plannedQty: number;
    actualQty: number;
    completionPct: number;
    poCount: number;
  }>;
  poStatuses: Array<{
    poId: string;
    customer: string;
    productName: string;
    qtyPo: number;
    finishedQty: number;
    wipQty: number;
    dueDate: string;
    status: string;
    isDelayed: boolean;
  }>;
  workerLaborStats: Array<{
    workerId: string;
    workerName: string;
    standardShifts: number;
    otHours: number;
    sundayHours: number;
    offDays: number;
    pDays: number;
    totalConvertedShifts: number;
    actualCompletedPieces: number;
  }>;
  downtimeIncidents: Array<{
    id: string;
    machineName: string;
    stopMinutes: number;
    reason: string;
    date: string;
    workerName?: string;
  }>;
  customIncidentNotes: string[];
  proposals: WeeklyProposalItem[];
  nextWeekForecast: {
    duePos: Array<{
      poId: string;
      customer: string;
      productName: string;
      remainQty: number;
      dueDate: string;
      requiredHours: number;
      defaultMachine: string;
    }>;
    carryoverBacklogQty: number;
    carryoverHours: number;
    totalRequiredHours: number;
    machineCapacityHours: number;
    overloadCapacityHours: number;
    isOverloaded: boolean;
    outsourceRecommendations: Array<{
      poId: string;
      customer: string;
      productName: string;
      suggestedOutsourceQty: number;
      reason: string;
      estimatedOutsourceCost: number;
    }>;
  };
}

export interface LoadCalcOptions {
  capacityHours?: number;
}

export interface SmedMaterialCluster {
  materialGroup: string;
  jobCount: number;
  totalHours: number;
  poIds: string[];
}

export type MachineLoadLevel = 'IDLE' | 'NORMAL' | 'WARNING' | 'BOTTLENECK';

export interface MachineLoadSummary {
  machineId: string;
  machineName: string;
  group: string;
  status: MachineStatus;
  capacityHours: number;
  openPoHours: number;
  scheduledHours: number;
  lightsOutHours: number;
  totalDemandHours: number;
  loadPct: number;
  loadLevel: MachineLoadLevel;
  isWarning: boolean;
  isBottleneck: boolean;
  jobCount: number;
  smedClusters: SmedMaterialCluster[];
  smedSuggestion: string | null;
  suggestLightsOut: boolean;
  lightsOutReason: string | null;
  alternativeMachines: string[];
}

export interface ProductionLogDto {
  id: number;
  recordUid: string;
  createdAt: string;
  timeStr: string;
  workDate: string;
  shiftType: string;
  startTime: string;
  endTime: string;
  overtimeMinutes: number;
  isSunday: number;
  isLightsOut: number;
  workerId: string;
  workerName: string;
  machineId: string;
  machineName: string;
  machineMode: 'FIRST' | 'SECOND';
  poId: string;
  spId: string | null;
  customer: string;
  productName: string;
  ncId: string;
  opName: string;
  stage: string;
  stepOrder: number;
  isFinalOp: number;
  stdSeconds: number;
  okQty: number;
  reworkQty: number;
  scrapQty: number;
  defectType: string;
  damageValue: number;
  stopMinutes: number;
  stopReason: string;
  toolCode: string;
  edgesUsed: number;
  selfCheckOk: number;
  qcStatus: 'PASSED' | 'PENDING_QC' | 'NG_HOLD';
  pieceWage: number;
  otBonusWage: number;
  waitWage: number;
  mealAllowance: number;
  scrapPenalty: number;
  income: number;
  directPieceIncome: number;
  batchCost: number;
  kpiPct: number;
  kpiStatus: string;
  photoUrl: string;
  handoverNote: string;
  materialLot: string;
  isVoided: number;
  note: string;
}

export interface QcInspectionDto {
  id: number;
  inspectionType: 'FAI' | 'IPQC' | 'OQC' | 'NG_REVIEW';
  poId: string;
  spId: string | null;
  ncId: string | null;
  productName?: string;
  opName?: string;
  machineName: string;
  operatorId: string;
  inspectorId: string;
  inspectorName: string;
  result: 'PASS' | 'CONCESSION' | 'REWORK' | 'SCRAP' | 'PENDING';
  sampleSize: number;
  defectQty: number;
  measuredDimsJson: string;
  rootCause: string;
  correctiveAction: string;
  createdAt: string;
}

export interface DeliveryLogDto {
  id: number;
  poId: string;
  customer: string;
  productName: string;
  qtyDeliver: number;
  deliveredBy: string;
  deliveredAt: string;
  note: string;
}

export interface ShiftHandoverAlert {
  id: number;
  machineName: string;
  workerName: string;
  workDate: string;
  shiftType: string;
  poId: string;
  productName: string;
  opName: string;
  handoverNote: string;
  createdAt: string;
}

export interface ReportSubmitPayload {
  recordUid?: string;
  workDate?: string;
  shiftType: string;
  startTime: string;
  endTime: string;
  overtimeMinutes?: number;
  isSunday?: boolean;
  isLightsOut?: boolean;
  workerId?: string;
  machineName: string;
  machineMode?: 'FIRST' | 'SECOND';
  poId?: string;
  ncId: string;
  toolCode?: string;
  edgesUsed?: number;
  isEdgesDirty?: boolean;
  okQty: number;
  reworkQty?: number;
  scrapQty?: number;
  defectType?: string;
  damageValue?: number;
  stopMinutes?: number;
  stopReason?: string;
  selfCheckOk?: boolean;
  materialLot?: string;
  handoverNote?: string;
  photoBase64?: string;
  workerCostPerSec?: number; // Ignored by server (anti-tamper)
}

export interface ReportSubmitResponse {
  success: boolean;
  deduplicated: boolean;
  message: string;
  warnings: string[];
  log: ProductionLogDto;
  payroll: PayrollCalcResult;
  todayTotalIncome: number;
}

export interface BootstrapPayload {
  user: AuthSessionUser | null;
  authMode: AuthMode;
  vietnamToday: string;
  isSundayToday: boolean;
  workers: WorkerDto[];
  machines: MachineInfo[];
  toolsList: CuttingTool[];
  products: ProductMeta[];
  operations: OperationMeta[];
  ordersList: PurchaseOrderInfo[];
  schedules: ScheduleBlock[];
  machineLoads: MachineLoadSummary[];
  qcInspections: QcInspectionDto[];
  recentLogs: ProductionLogDto[];
  todayAccumulated: Record<string, number>;
  opDoneMap: Record<string, number>;
  kpiSummary: {
    totalOk: number;
    totalRework: number;
    totalScrap: number;
    totalStopMinutes: number;
    runningMachines: number;
    bottleneckMachines: number;
    openOrders: number;
    overdueOrders: number;
  };
  shiftHandoverAlerts: ShiftHandoverAlert[];
  config: Record<string, string | number>;
}

export interface JobTravelerDto {
  po: PurchaseOrderInfo;
  product: ProductMeta | null;
  operations: Array<
    OperationMeta & {
      qrPayload: string;
      doneOkQty: number;
      faiPassed: boolean;
    }
  >;
  faiRecords: QcInspectionDto[];
  printedAt: string;
}

export interface TraceabilityDto {
  po: PurchaseOrderInfo;
  materialInfo: {
    materialLot: string;
    supplierName: string;
    castDate: string;
    matName: string;
  };
  operationsTimeline: Array<{
    stepOrder: number;
    ncId: string;
    opName: string;
    isFinalOp: number;
    totalOk: number;
    totalRework: number;
    totalScrap: number;
    logs: ProductionLogDto[];
  }>;
  qcRecords: QcInspectionDto[];
  deliveries: DeliveryLogDto[];
}

export type HandoverDept =
  | 'PX_GIA_CONG'
  | 'PX_HOAN_THIEN'
  | 'PX_NHIET_LUYEN'
  | 'PHONG_KHVT';

export interface HandoverSlipRow {
  id: string;
  handoverDate: string;
  fromDept: HandoverDept;
  toDept: HandoverDept;
  poId?: string;
  spId?: string;
  productName: string;
  customer: string;
  unit: string;
  prodQtyTransferred: number;
  prodQtyDefect: number;
  prodQtyMissing: number;
  rawQtyTransferred: number;
  rawQtyDefect: number;
  rawQtyMissing: number;
  note?: string;
  receiverName?: string;
  senderName?: string;
  isConfirmed?: boolean;
  confirmedAt?: string;
  createdAt: string;
}

export interface AndonLivePayload {
  serverTime: string;
  vietnamDate: string;
  spindleRunPct: number;
  summary: {
    totalMachines: number;
    runningCount: number;
    setupCount: number;
    stoppedCount: number;
    idleCount: number;
    todayOkQty: number;
    todayScrapQty: number;
  };
  machines: Array<{
    id: string;
    name: string;
    group: string;
    status: MachineStatus;
    currentWorkerName: string | null;
    currentPoId: string | null;
    currentNcId: string | null;
    currentProductName: string | null;
    currentOpName: string | null;
    stopReason: string | null;
    isLightsOut: boolean;
    loadPct: number;
    isBottleneck: boolean;
  }>;
  urgentOrders: Array<{
    poId: string;
    customer: string;
    productName: string;
    qtyPo: number;
    finishedQty: number;
    remainQty: number;
    dueDate: string;
    isOverdue: boolean;
    progressPct: number;
    status: string;
  }>;
  workerLeaderboard: Array<{
    rank: number;
    workerId: string;
    workerName: string;
    earnedStdHours: number;
    kpiPct: number;
    okQtyTotal: number;
  }>;
  alertsTicker: string[];
}

export interface SyncOutboxItem {
  id: number;
  channel: 'GAS_WEBHOOK' | 'TELEGRAM';
  eventType: string;
  payloadJson: string;
  status: 'PENDING' | 'SENT' | 'SKIPPED' | 'FAILED';
  attempts: number;
  lastError: string | null;
  createdAt: string;
  sentAt: string | null;
}

// ==================== DAILY QUALITY REPORT (FORM BM.KTCN.04.03) ====================
export interface DailyQualityReportItem {
  id: string;
  orderNumber: number; // TT: 1, 2, ...
  productName: string; // Tên Sản Phẩm
  customer: string; // Khách Hàng
  steelGrade: string; // Mác Thép
  assessedQty: number; // Số lượng Đánh giá
  okQty: number; // Đạt - Số lượng
  okPct: number; // Đạt - %
  reworkQty: number; // Xử lý - Số lượng
  reworkPct: number; // Xử lý - %
  reworkReason: string; // Xử lý - Tình trạng lỗi
  scrapQty: number; // Hỏng - Số lượng
  scrapPct: number; // Hỏng - %
  scrapReason: string; // Hỏng - Tình trạng hỏng
  note: string; // Ghi chú
}

export interface DailyQualityReportData {
  reportDate: string; // YYYY-MM-DD
  reportCode: string; // BM.KTCN.04.03
  issueNo: string; // 01
  effectiveDate: string; // 28/03/2026
  workshop: string; // GIA CÔNG CƠ KHÍ
  companyName: string; // CÔNG TY TNHH THẮNG LỢI
  items: DailyQualityReportItem[];
  preparedBy: string; // Người Lập Biểu
  qcBy: string; // Tổ Trưởng / QC
  approvedBy: string; // Quản Đốc Phân Xưởng
}
