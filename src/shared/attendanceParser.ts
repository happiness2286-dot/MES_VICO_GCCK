import type {
  AttendanceRow,
  EmployeeAttSummary,
  MealConfig,
  ParsedAttDay,
  Payroll3PRow,
  WorkerDto,
  WorkerMonthlyLogAgg,
} from './types';
import { isMonthlyAdminSalaryMode } from './payrollEngine';
import { removeVietnameseTones } from './vnSearch';

export const DEFAULT_MEAL_CONFIG: MealConfig = {
  mealShift23: 20000,
  mealOt2h: 15000,
  mealSunday: 30000,
};

export function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export function computeMonthDows(year: number, month: number): string[] {
  const daysInMonth = getDaysInMonth(year, month);
  const names = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  const dows: string[] = [];
  for (let d = 1; d <= 31; d++) {
    if (d > daysInMonth) {
      dows.push('-');
    } else {
      const dt = new Date(Date.UTC(year, month - 1, d, 12, 0, 0));
      dows.push(names[dt.getUTCDay()]);
    }
  }
  return dows;
}

export function getDefShiftCode(defaultShift: string | undefined): string {
  const s = removeVietnameseTones(defaultShift || '').toLowerCase();
  if (s.includes('ca 1')) return 'C1';
  if (s.includes('ca 2')) return 'C2';
  if (s.includes('ca 3')) return 'C3';
  return 'X';
}

export function parseAttendanceCell(
  raw: string,
  defaultShift: string = 'Ca 1',
  mealCfg: MealConfig = DEFAULT_MEAL_CONFIG,
  isSunday: boolean = false
): ParsedAttDay {
  const s = String(raw ?? '').trim().toUpperCase();
  const res: ParsedAttDay = {
    raw: String(raw ?? '').trim(),
    regDays: 0,
    s3Days: 0,
    ot15: 0,
    ot20: 0,
    ot30: 0,
    meal: 0,
    offDays: 0,
    pDays: 0,
    kpDays: 0,
    lateHours: 0,
    abExtra: 0,
    err: 0,
  };

  if (!s) {
    if (!isSunday) res.offDays = 1.0;
    return res;
  }

  // Standalone '0' means unpaid personal/sick leave ('O'), not 0 numeric hours
  if (s === '0' || s === 'O') {
    res.offDays = 1.0;
    res.abExtra = 1.0;
    return res;
  }

  // Positive pure numeric hours (e.g. '6.25', '8')
  if (/^\d+(\.\d+)?$/.test(s)) {
    const val = parseFloat(s);
    if (val > 0) {
      if (isSunday) {
        res.ot20 = val;
        if (val >= 8.0) res.meal = mealCfg.mealSunday;
      } else {
        res.regDays = val / 8.0;
      }
      return res;
    }
  }

  // Extract '-<hours>' late/early deductions
  const lateRegex = /-\s*(\d+(?:\.\d+)?)/g;
  let mLate: RegExpExecArray | null;
  while ((mLate = lateRegex.exec(s)) !== null) {
    res.lateHours += parseFloat(mLate[1]);
  }
  const sNoMinus = s.replace(/-\s*\d+(?:\.\d+)?/g, '');

  const parts = sNoMinus
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean);

  let baseShift = '';
  let baseDays = 0;
  let explicitOffDays = 0;

  parts.forEach((p, idx) => {
    const mOt = p.match(/^(\d+(?:\.\d+)?)(D|DEM|Đ|TK|TKD|TK3)?$|^D(\d+(?:\.\d+)?)$/);
    if (mOt && idx > 0) {
      const hrs = parseFloat(mOt[1] || mOt[3] || '0');
      const kind = mOt[2] || (mOt[3] ? 'D' : '');
      if (kind === 'D' || kind === 'DEM' || kind === 'Đ' || kind === 'TKD' || kind === 'TK3') {
        res.ot30 += hrs;
      } else if (isSunday) {
        res.ot20 += hrs;
      } else {
        res.ot15 += hrs;
      }
      return;
    }

    if (p === 'P') {
      explicitOffDays += 1.0;
      res.pDays += 1.0;
    } else if (p === 'KP') {
      explicitOffDays += 1.0;
      res.kpDays += 1.0;
    } else if (p === 'P/2') {
      explicitOffDays += 0.5;
      res.pDays += 0.5;
    } else if (p === 'KP/2') {
      explicitOffDays += 0.5;
      res.kpDays += 0.5;
    } else if (p === 'O' || p === '0') {
      explicitOffDays += 1.0;
      res.abExtra += 1.0;
    } else if (p === 'O/2' || p === '0/2') {
      explicitOffDays += 0.5;
      res.abExtra += 0.5;
    } else if (/^(X|VS|K|Đ|C1|C2|C3|C1K|C2K|C3K)(\/2)?$/.test(p)) {
      const isHalf = p.endsWith('/2');
      const dVal = isHalf ? 0.5 : 1.0;
      const bCode = p.replace('/2', '').replace(/(C1|C2|C3)K$/, '$1');
      baseShift = bCode;
      baseDays += dVal;
      if (bCode === 'C3') res.s3Days += dVal;
      if (isSunday) {
        res.ot20 += dVal * 8.0;
      } else {
        res.regDays += dVal;
      }
    } else {
      res.err = 1;
    }
  });

  // Compute offDays without double counting compound half-day codes like X/2+O/2
  if (!isSunday) {
    if (explicitOffDays > 0) {
      res.offDays = Math.min(1.0, explicitOffDays);
    } else if (baseDays > 0 && baseDays < 1.0) {
      res.offDays = Number((1.0 - baseDays).toFixed(2));
    }
  }

  // Unified Meal Allowance from MealConfig (covers C2, C3, and +2h OT on C1/X/K/VS/Đ)
  const defCode = getDefShiftCode(defaultShift);
  const effectiveShiftForMeal = baseShift === 'K' || baseShift === 'VS' ? defCode : baseShift;

  if (isSunday) {
    if (baseDays >= 1.0 || res.ot20 >= 8.0) {
      res.meal = mealCfg.mealSunday;
    }
  } else if (baseDays > 0) {
    if (
      baseShift === 'C2' ||
      baseShift === 'C3' ||
      effectiveShiftForMeal === 'C2' ||
      effectiveShiftForMeal === 'C3'
    ) {
      res.meal = mealCfg.mealShift23;
    } else if (res.ot15 + res.ot30 >= 2.0) {
      res.meal = mealCfg.mealOt2h;
    }
  }

  return res;
}

export const ATTENDANCE_BONUS_GRADE_A = 250_000;
export const ATTENDANCE_BONUS_GRADE_B = 200_000;

export function computeEmployeeMonthlyStats(
  emp: AttendanceRow,
  year: number,
  month: number,
  mealCfg: MealConfig = DEFAULT_MEAL_CONFIG,
  referenceDateStr?: string
): EmployeeAttSummary {
  const daysInMonth = getDaysInMonth(year, month);
  const dows = computeMonthDows(year, month);
  const normalizedDays: string[] = [];
  for (let i = 0; i < 31; i++) {
    normalizedDays.push(i < daysInMonth ? String(emp.days?.[i] ?? '').trim() : '');
  }

  let lastFilledDay = 0;
  for (let d = daysInMonth - 1; d >= 0; d--) {
    if (normalizedDays[d] !== '') {
      lastFilledDay = d + 1;
      break;
    }
  }

  let activeDayLimit = lastFilledDay;
  if (referenceDateStr) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(referenceDateStr.trim());
    if (m) {
      const refY = Number(m[1]);
      const refM = Number(m[2]);
      const refD = Number(m[3]);
      if (year < refY || (year === refY && month < refM)) {
        activeDayLimit = daysInMonth;
      } else if (year === refY && month === refM) {
        activeDayLimit = Math.min(daysInMonth, Math.max(refD, lastFilledDay));
      } else {
        activeDayLimit = lastFilledDay;
      }
    }
  }

  let regDays = 0;
  let s3Days = 0;
  let ot15 = 0;
  let ot20 = 0;
  let ot30 = 0;
  let mealTotal = 0;
  let offDays = 0;
  let pDays = 0;
  let kpDays = 0;
  let lateHours = 0;
  let abExtra = 0;
  let errCount = 0;
  let activeWorkDaysInPeriod = 0;

  const dailyMeals: number[] = new Array(31).fill(0);
  const kpDayList: string[] = [];
  const lateDayList: string[] = [];
  const pDayList: string[] = [];

  for (let d = 0; d < daysInMonth; d++) {
    const isSun = dows[d] === 'CN';
    const code = normalizedDays[d];
    const parsed = parseAttendanceCell(code, emp.defaultShift, mealCfg, isSun);
    dailyMeals[d] = d < activeDayLimit ? parsed.meal : 0;

    if (d < activeDayLimit) {
      if (!isSun) activeWorkDaysInPeriod++;
      regDays += parsed.regDays;
      s3Days += parsed.s3Days;
      ot15 += parsed.ot15;
      ot20 += parsed.ot20;
      ot30 += parsed.ot30;
      mealTotal += parsed.meal;
      offDays += parsed.offDays;
      pDays += parsed.pDays;
      kpDays += parsed.kpDays;
      lateHours += parsed.lateHours;
      abExtra += parsed.abExtra;
      errCount += parsed.err;

      const dLabel = String(d + 1).padStart(2, '0');
      if (parsed.kpDays > 0) kpDayList.push(dLabel);
      if (parsed.lateHours > 0) lateDayList.push(dLabel);
      if (parsed.pDays > 0) pDayList.push(dLabel);
    }
  }

  regDays = Number(regDays.toFixed(3));
  s3Days = Number(s3Days.toFixed(3));
  ot15 = Number(ot15.toFixed(2));
  ot20 = Number(ot20.toFixed(2));
  ot30 = Number(ot30.toFixed(2));
  offDays = Number(offDays.toFixed(3));
  lateHours = Number(lateHours.toFixed(2));

  const totalOt = Number((ot15 + ot20 + ot30).toFixed(2));
  const hours100 = Number(Math.max(0, regDays * 8.0 - lateHours).toFixed(2));
  const abDays = Math.floor((hours100 / 8.0 + pDays + abExtra) * 100) / 100;

  // Quy tắc xếp loại A/B/C theo quy chế xưởng VICO:
  // - Công chuẩn tháng = Số ngày trong tháng trừ các ngày Chủ nhật (activeWorkDaysInPeriod).
  // - Loại A (250k): Đi làm đủ hoặc nghỉ <= 0.5 ngày (mở rộng nghỉ nửa ngày vẫn là A).
  // - Loại B (200k): Nghỉ 1 ngày (0.5 < ngày nghỉ <= 1.0 ngày).
  // - Loại C / KP (0k): Nghỉ quá 1 ngày (> 1.0 ngày) hoặc có vi phạm nghỉ Không Phép (KP).
  const totalOffDays = Number((offDays + (lateHours / 8.0)).toFixed(2));
  let grade: 'A' | 'B' | 'C (KP)' = 'B';
  if (kpDays > 0) {
    grade = 'C (KP)';
  } else if (activeWorkDaysInPeriod > 0) {
    if (totalOffDays <= 0.5 && errCount === 0) {
      grade = 'A';
    } else if (totalOffDays <= 1.0 && errCount === 0) {
      grade = 'B';
    } else {
      grade = 'C (KP)';
    }
  }

  const badges: string[] = [];
  if (kpDays > 0) badges.push(`NGHỈ KP (${kpDays} ngày: ${kpDayList.join(',')})`);
  if (totalOt >= 56) badges.push(`Tăng ca cao (${totalOt}h)`);
  if (lateHours > 0) badges.push(`Muộn/Sớm -${lateHours.toFixed(2)}h (Ngày ${lateDayList.join(',')})`);
  if (s3Days >= 5) badges.push(`Ca 3 (${s3Days} ca)`);

  // 12-month cumulative summary
  const months = new Array(12).fill(0);
  const hist = emp.yearDaysHist || [];
  for (let m = 0; m < 12; m++) {
    if (m === month - 1) {
      months[m] = Number(regDays.toFixed(1));
    } else if (m < hist.length) {
      months[m] = Number((Number(hist[m]) || 0).toFixed(1));
    }
  }
  const totalYearDays = Number(months.reduce((a, b) => a + b, 0).toFixed(1));
  const totalYearOt = Number(totalOt.toFixed(1));
  const otCapHours = 300;
  const otCapPct = Math.min(100, Math.round((totalYearOt / otCapHours) * 100));
  const annualLeaveQuota = 12;
  const usedLeaveDays = Number(pDays.toFixed(1));
  const remainingLeaveDays = Number(Math.max(0, annualLeaveQuota - usedLeaveDays).toFixed(1));

  let yearRank = 'Đạt Chuẩn A (Thưởng Chuyên Cần 250k)';
  if (kpDays > 0) {
    yearRank = 'Loại C - Vi phạm KP (Hạ thưởng)';
  } else if (regDays >= 21.0 && lateHours === 0) {
    yearRank = 'Xuất Sắc A+ (Top Chuyên Cần)';
  } else if (grade === 'B' || lateHours > 2) {
    yearRank = 'Khá B (Có đi muộn / nghỉ)';
  }

  return {
    empId: emp.empId,
    name: emp.name,
    workType: emp.workType || 'Công',
    defaultShift: emp.defaultShift || 'Ca 1',
    year,
    month,
    daysInMonth,
    activeDayLimit,
    dows,
    days: normalizedDays,
    dailyMeals,
    hours100,
    abDays,
    grade,
    regDays,
    s3Days,
    ot15,
    ot20,
    ot30,
    totalOt,
    mealTotal,
    offDays,
    pDays,
    kpDays,
    lateHours,
    errCount,
    kpDayList,
    lateDayList,
    pDayList,
    badges,
    badgeText: badges.length > 0 ? badges.join(' | ') : 'Chuẩn định mức',
    yearly: {
      months,
      totalYearDays,
      totalYearOt,
      otCapHours,
      otCapPct,
      annualLeaveQuota,
      usedLeaveDays,
      remainingLeaveDays,
      yearRank,
    },
  };
}

/**
 * Consolidated Monthly 3P Payroll (Position P1 + Person/Attendance P2 + Performance/Piecework P3)
 */
export function computeMonthly3PPayroll(
  workers: WorkerDto[],
  attSummaries: EmployeeAttSummary[],
  logAggs: WorkerMonthlyLogAgg[]
): Payroll3PRow[] {
  const attMap = new Map(attSummaries.map((a) => [a.empId, a]));
  const logMap = new Map(logAggs.map((l) => [l.workerId, l]));

  return workers.map((w) => {
    const att = attMap.get(w.id);
    const log = logMap.get(w.id);

    const baseSalary = Math.max(0, Number(w.baseSalary) || 0);
    const costPerSec = Math.max(0, Number(w.costPerSec) || 0);
    const regDays = att?.regDays ?? 0;
    const hours100 = att?.hours100 ?? 0;
    const pDays = att?.pDays ?? 0;
    const s3Days = att?.s3Days ?? 0;
    const ot15 = att?.ot15 ?? 0;
    const ot20 = att?.ot20 ?? 0;
    const ot30 = att?.ot30 ?? 0;
    const totalOt = att?.totalOt ?? 0;
    const grade = att?.grade ?? 'B';
    const kpDays = att?.kpDays ?? 0;

    const logCount = log?.logCount ?? 0;
    const earnedStdHours = Number(((log?.earnedStdSeconds ?? 0) / 3600).toFixed(2));
    const isMonthlyStaff = isMonthlyAdminSalaryMode(w.salaryMode);

    let p1PositionPay = 0;
    let p3PerformancePay = 0;
    let note = '';

    const hourlyBase = baseSalary / 8;

    if (isMonthlyStaff) {
      // P1: Time-attendance + Paid Leave + S3 Night Diff + Sheet OT
      p1PositionPay = Math.round(
        (hours100 / 8 + pDays) * baseSalary +
          s3Days * baseSalary * 0.3 +
          (ot15 * 1.5 + ot20 * 2.0 + ot30 * 3.0) * hourlyBase
      );
      // P3: Standard-hour surplus bonus when monthly staff operates CNC above attendance hours
      const surplusHours = Math.max(0, earnedStdHours - hours100);
      p3PerformancePay = Math.round(surplusHours * 3600 * costPerSec);
      note =
        surplusHours > 0
          ? `Lương tháng HC + Thưởng vượt ${surplusHours.toFixed(1)}h ĐM`
          : 'Lương thời gian Hành chính (Tháng)';
    } else {
      // Piecework Operator (Khoán 1 + 0.33 máy)
      p1PositionPay = Math.round(pDays * baseSalary);
      if (logCount > 0) {
        p3PerformancePay = Math.round(log?.directPieceIncome ?? 0);
        note = `Khoán sản phẩm (${logCount} phiếu, ${earnedStdHours}h ĐM)`;
      } else {
        // Sheet-only historical fallback when no shopfloor piecework tickets exist yet in month
        p3PerformancePay = Math.round(
          (hours100 / 8) * baseSalary +
            s3Days * baseSalary * 0.3 +
            (ot15 * 1.5 + ot20 * 2.0 + ot30 * 3.0) * hourlyBase
        );
        note = 'Tạm tính theo công (chưa phát sinh phiếu khoán)';
      }
    }

    // P2: Attendance & Discipline Grade Bonus (A: 800k, B: 400k, C/KP: 0)
    // P2: Thưởng Chuyên Cần A/B theo quy chế xưởng VICO (A: 250k, B: 200k, Quá 1 ngày/KP: 0)
    const p2PersonBonus =
      regDays <= 0 && logCount <= 0
        ? 0
        : grade === 'A'
          ? ATTENDANCE_BONUS_GRADE_A
          : grade === 'B'
            ? ATTENDANCE_BONUS_GRADE_B
            : 0;

    // Unified meal allowance: max of Attendance sheet vs Shift logs to avoid double counting
    const mealAllowance = Math.max(att?.mealTotal ?? 0, log?.logMealTotal ?? 0);
    const scrapPenalty = Math.round(log?.scrapPenaltyTotal ?? 0);
    const grossIncome = p1PositionPay + p2PersonBonus + p3PerformancePay + mealAllowance;
    const netPay = grossIncome - scrapPenalty;

    return {
      workerId: w.id,
      name: w.name,
      role: w.role,
      title: w.title,
      salaryMode: w.salaryMode,
      baseSalary,
      costPerSec,
      regDays,
      hours100,
      totalOt,
      grade,
      kpDays,
      earnedStdHours,
      pieceworkLogCount: logCount,
      p1PositionPay,
      p2PersonBonus,
      p3PerformancePay,
      mealAllowance,
      scrapPenalty,
      grossIncome,
      netPay,
      note,
    };
  });
}
