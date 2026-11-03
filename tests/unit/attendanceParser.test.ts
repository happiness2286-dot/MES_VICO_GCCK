import { describe, it, expect } from 'vitest';
import {
  getDaysInMonth,
  parseAttendanceCell,
  computeEmployeeMonthlyStats,
  computeMonthly3PPayroll,
  DEFAULT_MEAL_CONFIG,
} from '../../src/shared/attendanceParser';
import type { AttendanceRow } from '../../src/shared/types';

describe('attendanceParser — Real GCCK Codes, Dynamic Month Days, Meal Unification & 3P Payroll', () => {
  it('returns exact days in month including leap/non-leap February', () => {
    expect(getDaysInMonth(2026, 2)).toBe(28);
    expect(getDaysInMonth(2024, 2)).toBe(29);
    expect(getDaysInMonth(2026, 4)).toBe(30);
    expect(getDaysInMonth(2026, 10)).toBe(31);
  });

  it('decodes all GCCK attendance codes accurately (X, x/2, 6.25, C2+2, C2/2-0.75, K+2TK, C3+2D, X/2+O/2, P, KP, 0)', () => {
    expect(parseAttendanceCell('X', 'Hành chính', DEFAULT_MEAL_CONFIG, false)).toMatchObject({
      regDays: 1,
      offDays: 0,
      meal: 0,
    });
    expect(parseAttendanceCell('x/2', 'Hành chính', DEFAULT_MEAL_CONFIG, false)).toMatchObject({
      regDays: 0.5,
      offDays: 0.5,
    });
    expect(parseAttendanceCell('6.25', 'Hành chính', DEFAULT_MEAL_CONFIG, false)).toMatchObject({
      regDays: 6.25 / 8,
    });
    expect(parseAttendanceCell('C2+2', 'Ca 2', DEFAULT_MEAL_CONFIG, false)).toMatchObject({
      regDays: 1,
      ot15: 2,
      meal: 20000,
    });
    expect(parseAttendanceCell('C2/2-0.75', 'Ca 2', DEFAULT_MEAL_CONFIG, false)).toMatchObject({
      regDays: 0.5,
      offDays: 0.5,
      lateHours: 0.75,
      meal: 20000,
    });
    expect(parseAttendanceCell('K+2TK', 'Ca 1', DEFAULT_MEAL_CONFIG, false)).toMatchObject({
      regDays: 1,
      ot15: 2,
      meal: 15000,
    });
    expect(parseAttendanceCell('VS+2', 'Ca 1', DEFAULT_MEAL_CONFIG, false)).toMatchObject({
      regDays: 1,
      ot15: 2,
      meal: 15000,
    });
    expect(parseAttendanceCell('C3+2D', 'Ca 3', DEFAULT_MEAL_CONFIG, false)).toMatchObject({
      regDays: 1,
      s3Days: 1,
      ot30: 2,
      meal: 20000,
    });
    // X/2+O/2 -> worked half day + personal leave half day -> offDays MUST be 0.5 (not double counted to 1.0)
    expect(parseAttendanceCell('X/2+O/2', 'Hành chính', DEFAULT_MEAL_CONFIG, false)).toMatchObject({
      regDays: 0.5,
      abExtra: 0.5,
      offDays: 0.5,
    });
    expect(parseAttendanceCell('P', 'Ca 1', DEFAULT_MEAL_CONFIG, false)).toMatchObject({
      pDays: 1,
      offDays: 1,
    });
    expect(parseAttendanceCell('KP', 'Ca 1', DEFAULT_MEAL_CONFIG, false)).toMatchObject({
      kpDays: 1,
      offDays: 1,
    });
    expect(parseAttendanceCell('0', 'Ca 1', DEFAULT_MEAL_CONFIG, false)).toMatchObject({
      offDays: 1,
      abExtra: 1,
    });
    expect(parseAttendanceCell('C1', 'Ca 1', DEFAULT_MEAL_CONFIG, true)).toMatchObject({
      regDays: 0,
      ot20: 8,
      meal: 30000,
    });
  });

  it('computes offDays dynamically on active days instead of subtracting hardcoded 27 early in month or in Feb', () => {
    // Early in Feb 2026 (28 days): only first 5 days recorded (Feb 1 is Sun, Feb 2..5 are Mon..Thu = 4 work days)
    const days = new Array(31).fill('');
    days[1] = 'X';
    days[2] = 'X';
    days[3] = 'X';
    days[4] = 'X';
    const emp: AttendanceRow = {
      empId: 'NV00053',
      name: 'Hoàng Ngọc Hà',
      workType: 'Công',
      defaultShift: 'Hành chính',
      yearDaysHist: [24, 0, 0, 0, 0, 0, 0, 0, 0],
      days,
    };
    const stats = computeEmployeeMonthlyStats(emp, 2026, 2, DEFAULT_MEAL_CONFIG, '2026-02-05');
    expect(stats.daysInMonth).toBe(28);
    expect(stats.regDays).toBe(4);
    expect(stats.offDays).toBe(0);
    expect(stats.grade).toBe('A');
  });

  it('computes consolidated 3P monthly payroll across piecework & monthly staff', () => {
    const days = new Array(31).fill('');
    for (let i = 0; i < 25; i++) days[i] = 'C1';
    const attSummary = computeEmployeeMonthlyStats(
      {
        empId: 'NV00214',
        name: 'Trần Văn Quỳnh',
        workType: 'Công',
        defaultShift: 'Ca 1',
        yearDaysHist: [25, 25, 25, 25, 25, 25, 25, 25, 25],
        days,
      },
      2026,
      10,
      DEFAULT_MEAL_CONFIG,
      '2026-10-25'
    );

    const rows = computeMonthly3PPayroll(
      [
        {
          id: 'NV00214',
          name: 'Trần Văn Quỳnh',
          username: 'quynh',
          role: 'CN',
          appRole: 'WORKER',
          title: 'Công nhân',
          salaryMode: 'Khoán 1 + 0.33 máy',
          baseSalary: 400000,
          costPerSec: 13.89,
          isLinked: false,
        },
      ],
      [attSummary],
      [
        {
          workerId: 'NV00214',
          logCount: 20,
          earnedStdSeconds: 180 * 3600,
          directPieceIncome: 9_500_000,
          waitWageTotal: 200_000,
          otBonusTotal: 300_000,
          logMealTotal: 150_000,
          scrapPenaltyTotal: 50_000,
        },
      ]
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].p3PerformancePay).toBe(9_500_000);
    expect(rows[0].scrapPenalty).toBe(50_000);
    expect(rows[0].netPay).toBeGreaterThan(9_500_000);
  });

  it('applies VICO rule for P2 Attendance Bonus: A (full/half-day off)=250k, B (1 day off)=200k, >1 day off=0k', () => {
    // Oct 2026: 31 days. Sundays are Oct 4, 11, 18, 25 (4 Sundays).
    // Work days (standard days) = 31 - 4 = 27 days.
    
    // Case 1: Full attendance -> Grade A -> P2 = 250k
    const fullDays = new Array(31).fill('');
    for (let i = 0; i < 31; i++) {
      const isSun = [4, 11, 18, 25].includes(i + 1);
      if (!isSun) fullDays[i] = 'C1';
    }
    const fullSummary = computeEmployeeMonthlyStats(
      { empId: 'NV01', name: 'Tho A1', workType: 'Công', defaultShift: 'Ca 1', yearDaysHist: [], days: fullDays },
      2026, 10, DEFAULT_MEAL_CONFIG, '2026-10-31'
    );
    expect(fullSummary.grade).toBe('A');

    // Case 2: Half-day off (nghỉ nửa ngày vẫn là A) -> Grade A -> P2 = 250k
    const halfDayOff = [...fullDays];
    halfDayOff[0] = 'C1/2'; // Oct 1 is Mon/Thu, worked half shift (0.5 day off)
    const halfSummary = computeEmployeeMonthlyStats(
      { empId: 'NV02', name: 'Tho A2', workType: 'Công', defaultShift: 'Ca 1', yearDaysHist: [], days: halfDayOff },
      2026, 10, DEFAULT_MEAL_CONFIG, '2026-10-31'
    );
    expect(halfSummary.grade).toBe('A');

    // Case 3: 1 day off (nghỉ 1 ngày là B) -> Grade B -> P2 = 200k
    const oneDayOff = [...fullDays];
    oneDayOff[0] = 'O'; // Oct 1 off with permission
    const oneDaySummary = computeEmployeeMonthlyStats(
      { empId: 'NV03', name: 'Tho B', workType: 'Công', defaultShift: 'Ca 1', yearDaysHist: [], days: oneDayOff },
      2026, 10, DEFAULT_MEAL_CONFIG, '2026-10-31'
    );
    expect(oneDaySummary.grade).toBe('B');

    // Case 4: > 1 day off (Quá 1 ngày là ko có gì) -> Grade C -> P2 = 0k
    const twoDaysOff = [...fullDays];
    twoDaysOff[0] = 'O';
    twoDaysOff[1] = 'O'; // 2 days off
    const twoDaysSummary = computeEmployeeMonthlyStats(
      { empId: 'NV04', name: 'Tho C', workType: 'Công', defaultShift: 'Ca 1', yearDaysHist: [], days: twoDaysOff },
      2026, 10, DEFAULT_MEAL_CONFIG, '2026-10-31'
    );
    expect(twoDaysSummary.grade).toBe('C (KP)');

    // Case 5: 1 day KP (Nghỉ không phép) -> Grade C (KP) -> P2 = 0k
    const kpDays = [...fullDays];
    kpDays[0] = 'KP';
    const kpSummary = computeEmployeeMonthlyStats(
      { empId: 'NV05', name: 'Tho KP', workType: 'Công', defaultShift: 'Ca 1', yearDaysHist: [], days: kpDays },
      2026, 10, DEFAULT_MEAL_CONFIG, '2026-10-31'
    );
    expect(kpSummary.grade).toBe('C (KP)');

    // Verify 3P Payroll P2 bonuses
    const payroll = computeMonthly3PPayroll(
      [
        { id: 'NV01', name: 'Tho A1', username: 'a1', role: 'CN', appRole: 'WORKER', title: 'Thợ', salaryMode: 'Khoán', baseSalary: 400000, costPerSec: 13.89, isLinked: false },
        { id: 'NV02', name: 'Tho A2', username: 'a2', role: 'CN', appRole: 'WORKER', title: 'Thợ', salaryMode: 'Khoán', baseSalary: 400000, costPerSec: 13.89, isLinked: false },
        { id: 'NV03', name: 'Tho B', username: 'b', role: 'CN', appRole: 'WORKER', title: 'Thợ', salaryMode: 'Khoán', baseSalary: 400000, costPerSec: 13.89, isLinked: false },
        { id: 'NV04', name: 'Tho C', username: 'c', role: 'CN', appRole: 'WORKER', title: 'Thợ', salaryMode: 'Khoán', baseSalary: 400000, costPerSec: 13.89, isLinked: false },
        { id: 'NV05', name: 'Tho KP', username: 'kp', role: 'CN', appRole: 'WORKER', title: 'Thợ', salaryMode: 'Khoán', baseSalary: 400000, costPerSec: 13.89, isLinked: false },
      ],
      [fullSummary, halfSummary, oneDaySummary, twoDaysSummary, kpSummary],
      []
    );

    expect(payroll.find((p) => p.workerId === 'NV01')?.p2PersonBonus).toBe(250_000);
    expect(payroll.find((p) => p.workerId === 'NV02')?.p2PersonBonus).toBe(250_000);
    expect(payroll.find((p) => p.workerId === 'NV03')?.p2PersonBonus).toBe(200_000);
    expect(payroll.find((p) => p.workerId === 'NV04')?.p2PersonBonus).toBe(0);
    expect(payroll.find((p) => p.workerId === 'NV05')?.p2PersonBonus).toBe(0);
  });
});