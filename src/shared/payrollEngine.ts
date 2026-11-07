import type {
  PayrollCalcInput,
  PayrollCalcResult,
  ShiftPriorContext,
  SystemPayrollConfig,
} from './types';
import { normalizeVn, removeVietnameseTones } from './vnSearch';

export const DEFAULT_PAYROLL_CONFIG: SystemPayrollConfig = {
  secondsPerShift: 28800,
  secondMachineRate: 0.33,
  mealShift23: 20000,
  mealOt2h: 15000,
  mealSunday: 30000,
  kpiWarningThreshold: 1.0, // Chuẩn định mức ca 100%, dưới 100% cảnh báo chưa đạt định mức
};

/**
 * Returns YYYY-MM-DD in Asia/Ho_Chi_Minh (UTC+7)
 */
export function getVietnamDateString(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const year = parts.find((p) => p.type === 'year')?.value ?? '2026';
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  const day = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

/**
 * Checks whether a YYYY-MM-DD calendar date in Vietnam is Sunday
 */
export function isVietnamSunday(dateStr: string): boolean {
  const clean = normalizeVn(dateStr);
  if (!clean) return false;

  let ymd = clean;
  if (clean.includes('T')) {
    const dt = new Date(clean);
    if (Number.isNaN(dt.getTime())) return false;
    ymd = getVietnamDateString(dt);
  }

  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const utcNoon = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return utcNoon.getUTCDay() === 0;
}

function parseHhMmToMinutes(timeStr: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(timeStr || '').trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh < 0 || hh > 24 || mm < 0 || mm >= 60) return null;
  return hh * 60 + mm;
}

function toIntervalRange(startTime: string, endTime: string): [number, number] | null {
  const s = parseHhMmToMinutes(startTime);
  const e = parseHhMmToMinutes(endTime);
  if (s === null || e === null) return null;
  if (e === s) return null;
  if (e < s) {
    return [s, e + 1440];
  }
  return [s, e];
}

/**
 * Strict half-open interval overlap [start, end) supporting overnight shifts (e.g. 22:00-06:00).
 * Touching endpoints (06:00-10:00 and 10:00-14:00) return false (sequential, no overlap).
 */
export function hasTimeOverlap(startA: string, endA: string, startB: string, endB: string): boolean {
  const rangeA = toIntervalRange(startA, endA);
  const rangeB = toIntervalRange(startB, endB);
  if (!rangeA || !rangeB) return false;

  const [a0, a1] = rangeA;
  const [b0, b1] = rangeB;
  const wraps = a1 > 1440 || b1 > 1440;

  if (!wraps) {
    return a0 < b1 && b0 < a1;
  }

  for (const offset of [-1440, 0, 1440]) {
    const sb0 = b0 + offset;
    const sb1 = b1 + offset;
    if (a0 < sb1 && sb0 < a1) return true;
  }
  return false;
}

/**
 * Continuous Marginal NG Scrap Penalty:
 * - 0 .. 10,000,000 VND @ 50%
 * - excess 10,000,000 .. 30,000,000 VND @ 40%
 * - excess > 30,000,000 VND @ 30%
 * Strictly monotonically increasing for every +1 VND.
 */
export function calculateMarginalScrapPenalty(damageValue: number): number {
  const dmg = Number(damageValue) || 0;
  if (dmg <= 0) return 0;

  const tier1 = Math.min(dmg, 10_000_000) * 0.5;
  const tier2 = Math.max(0, Math.min(dmg, 30_000_000) - 10_000_000) * 0.4;
  const tier3 = Math.max(0, dmg - 30_000_000) * 0.3;

  return Math.ceil(tier1 + tier2 + tier3);
}

export function isObjectiveStopReason(stopReason: string | undefined): boolean {
  const raw = normalizeVn(stopReason);
  if (!raw) return false;
  const ascii = removeVietnameseTones(raw).toLowerCase();
  if (ascii.includes('khong co')) return false;
  if (ascii.includes('thay dao') || ascii.includes('setup') || ascii.includes('ga dat')) return false;
  if (ascii.includes('ca nhan')) return false;
  return true;
}

export function isMonthlyAdminSalaryMode(salaryMode: string | undefined): boolean {
  const ascii = removeVietnameseTones(salaryMode || '').toLowerCase();
  return ascii.includes('hanh chinh') || ascii.includes('thang');
}

export function calculateTurnPayroll(
  input: PayrollCalcInput,
  shiftContext: ShiftPriorContext = {},
  config: SystemPayrollConfig = DEFAULT_PAYROLL_CONFIG
): PayrollCalcResult {
  const okQty = Math.max(0, Number(input.okQty) || 0);
  const scrapQty = Math.max(0, Number(input.scrapQty) || 0);
  const stdSeconds = Math.max(0, Number(input.stdSeconds) || 0);
  const costPerSec = Math.max(0, Number(input.costPerSec) || 0);
  const stopMinutes = Math.max(0, Number(input.stopMinutes) || 0);
  const isSunday = input.isSunday !== undefined ? Boolean(input.isSunday) : isVietnamSunday(input.workDate);

  // 15-minute OT step quantization, clamped [0, 240]
  const clampedOt = Math.min(240, Math.max(0, Number(input.overtimeMinutes) || 0));
  const effectiveOtMinutes = Math.floor(clampedOt / 15) * 15;

  // Check overlapping dual-machine rule (1 + 0.33)
  const normMach = normalizeVn(input.machineName).toLowerCase();
  const hasOverlappingOtherMachine = (shiftContext.priorLogs || []).some((prior) => {
    const priorMach = normalizeVn(prior.machineName).toLowerCase();
    if (!priorMach || priorMach === normMach) return false;
    return hasTimeOverlap(prior.startTime, prior.endTime, input.startTime, input.endTime);
  });

  const effectiveMachineMode: 'FIRST' | 'SECOND' =
    input.machineMode === 'SECOND' || hasOverlappingOtherMachine ? 'SECOND' : 'FIRST';
  const machRate = effectiveMachineMode === 'SECOND' ? config.secondMachineRate : 1.0;

  // Shift multiplier: Sunday 2.0x, Shift 3 1.3x, else 1.0x
  const shiftAscii = removeVietnameseTones(input.shiftType || '').toLowerCase();
  const isShift3 = shiftAscii.includes('ca 3');
  const isShift2 = shiftAscii.includes('ca 2');
  const shiftMult = isSunday ? 2.0 : isShift3 ? 1.3 : 1.0;

  // Objective stop wage (excludes Thay dao / Setup & Không có dừng máy), capped to shift capacity
  const shiftMaxMinutes = Math.round((config.secondsPerShift || 28800) / 60);
  const priorPaidStop = Math.max(0, Number(shiftContext.paidStopMinutes) || 0);
  const remainingStopCap = Math.max(0, shiftMaxMinutes - priorPaidStop);
  const effectivePaidStopMinutes =
    stopMinutes > 0 && isObjectiveStopReason(input.stopReason)
      ? Math.min(stopMinutes, remainingStopCap)
      : 0;

  // Casting-defect support (50% stdSeconds)
  const defectAscii = removeVietnameseTones(input.defectType || '').toLowerCase();
  const isCastingDefect = defectAscii.includes('phoi duc') || defectAscii.includes('nguyen lieu') || defectAscii.includes('phoi');
  const supportSeconds = scrapQty > 0 && isCastingDefect ? scrapQty * stdSeconds * 0.5 : 0;
  const earnedStdSeconds = okQty * stdSeconds + supportSeconds;

  // Anti-exploit check: 0 output + 0 objective stop -> 0 OT bonus & 0 meal allowance
  const hasEffectiveWork = earnedStdSeconds > 0 || effectivePaidStopMinutes > 0;

  const priorPaidOt = Math.max(0, Number(shiftContext.paidOtMinutes) || 0);
  const unpaidOtMinutes = hasEffectiveWork ? Math.max(0, effectiveOtMinutes - priorPaidOt) : 0;

  const unitPiecePrice = Math.round(stdSeconds * machRate * shiftMult * costPerSec);
  const rawBasePieceWage = Math.round(earnedStdSeconds * machRate * shiftMult * costPerSec);
  const rawOtBonusWage =
    !isSunday && unpaidOtMinutes > 0 && machRate === 1.0
      ? Math.round(unpaidOtMinutes * 60 * 0.5 * costPerSec)
      : 0;
  const rawWaitWage =
    effectivePaidStopMinutes > 0 ? Math.round(effectivePaidStopMinutes * 60 * costPerSec) : 0;

  // Unified meal allowance with per-shift cap (workerId, workDate, shiftType)
  let eligibleShiftMeal = 0;
  if (hasEffectiveWork) {
    if (isSunday) {
      eligibleShiftMeal = config.mealSunday;
    } else if (isShift2 || isShift3) {
      eligibleShiftMeal = config.mealShift23;
    } else if (Math.max(effectiveOtMinutes, priorPaidOt) >= 120) {
      eligibleShiftMeal = config.mealOt2h;
    }
  }

  let mealAllowance = 0;
  if (eligibleShiftMeal > 0) {
    if (shiftContext.mealPaidAmount !== undefined) {
      mealAllowance = Math.max(0, eligibleShiftMeal - shiftContext.mealPaidAmount);
    } else if (shiftContext.mealAlreadyPaid) {
      mealAllowance = 0;
    } else {
      mealAllowance = eligibleShiftMeal;
    }
  }

  // Marginal subjective NG penalty
  const isSubjectiveDefect = scrapQty > 0 && !isCastingDefect && (Number(input.damageValue) || 0) > 0;
  const scrapPenalty = isSubjectiveDefect
    ? calculateMarginalScrapPenalty(Number(input.damageValue) || 0)
    : 0;

  // Salary mode separation: Hành chính (Tháng) earns 0 direct piece payout (settled in monthly 3P)
  const isMonthlyStaff = isMonthlyAdminSalaryMode(input.salaryMode);
  const basePieceWage = isMonthlyStaff ? 0 : rawBasePieceWage;
  const otBonusWage = isMonthlyStaff ? 0 : rawOtBonusWage;
  const waitWage = isMonthlyStaff ? 0 : rawWaitWage;
  const pieceWage = basePieceWage + otBonusWage;
  const directPieceIncome = pieceWage + waitWage;
  const turnTotalIncome = isMonthlyStaff
    ? Math.max(0, mealAllowance) - scrapPenalty
    : directPieceIncome + mealAllowance - scrapPenalty;

  // Elapsed net work seconds for KPI % and Machine Job Costing
  const interval = toIntervalRange(input.startTime, input.endTime);
  const windowMinutes = interval ? interval[1] - interval[0] : shiftMaxMinutes + effectiveOtMinutes;
  const netWorkSeconds = Math.max(0, windowMinutes * 60 - stopMinutes * 60);

  const kpiPct =
    netWorkSeconds > 0
      ? Math.round((earnedStdSeconds / netWorkSeconds) * 100)
      : earnedStdSeconds > 0
        ? 100
        : 0;

  const rawThr = Number(config.kpiWarningThreshold) || 1.0;
  const warnThresholdPct = Math.round(rawThr > 2 ? rawThr : rawThr * 100);
  const reworkQty = Math.max(0, Number(input.reworkQty) || 0);

  const kpiStatus =
    earnedStdSeconds === 0 && effectivePaidStopMinutes > 0
      ? `Dừng máy KQ (${effectivePaidStopMinutes}p)`
      : okQty === 0 && reworkQty > 0
        ? `🛠️ Sửa hàng (${reworkQty} SP) · 0% ĐM`
        : okQty === 0 && stopMinutes === 0
          ? '🚨 0% ĐM'
          : kpiPct < 50 && stopMinutes === 0
            ? `🚨 RẤT THẤP (${kpiPct}% ĐM)`
            : kpiPct >= 100
              ? `Đạt ${kpiPct}% ĐM`
              : kpiPct >= warnThresholdPct
                ? `Đạt ${kpiPct}% ĐM`
                : `⚠️ Chưa đạt ĐM (${kpiPct}%)`;

  // Job Costing (always includes full standard/actual labor + machine + tool + net scrap loss)
  const edgesConsumed =
    input.edgesUsed !== undefined && Number(input.edgesUsed) >= 0
      ? Number(input.edgesUsed)
      : Number((okQty * Math.max(0, Number(input.stdEdgesPerPcs) || 0)).toFixed(2));

  const costingLaborCost = rawBasePieceWage + rawOtBonusWage + rawWaitWage + mealAllowance;
  const machRunHours = netWorkSeconds > 0 ? netWorkSeconds / 3600 : earnedStdSeconds / 3600;
  const costingMachCost = Math.round(machRunHours * Math.max(0, Number(input.machineCostPerHour) || 0));
  const costingToolCost = Math.round(edgesConsumed * Math.max(0, Number(input.costPerEdge) || 0));
  const costingScrapLoss =
    scrapQty > 0 && (Number(input.damageValue) || 0) > 0
      ? Math.max(0, Math.round((Number(input.damageValue) || 0) - scrapPenalty))
      : 0;

  const batchCost = costingLaborCost + costingMachCost + costingToolCost + costingScrapLoss;

  return {
    effectiveMachineMode,
    machRate,
    shiftMult,
    isSunday,
    effectiveOtMinutes,
    unpaidOtMinutes,
    effectivePaidStopMinutes,
    isMonthlyStaff,
    unitPiecePrice,
    earnedStdSeconds,
    netWorkSeconds,
    basePieceWage,
    otBonusWage,
    waitWage,
    pieceWage,
    directPieceIncome,
    mealAllowance,
    scrapPenalty,
    turnTotalIncome,
    costingLaborCost,
    costingMachCost,
    costingToolCost,
    costingScrapLoss,
    batchCost,
    kpiPct,
    kpiStatus,
    edgesConsumed,
  };
}
