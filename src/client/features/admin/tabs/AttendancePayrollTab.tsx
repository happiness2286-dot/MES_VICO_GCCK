import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Award,
  BookOpen,
  Calendar,
  CheckSquare,
  Clock,
  CloudUpload,
  Download,
  Flame,
  Gem,
  Lock,
  Moon,
  RefreshCw,
  Search,
  ShieldAlert,
  Umbrella,
  Zap,
} from 'lucide-react';
import type {
  EmployeeAttSummary,
  MealConfig,
  Payroll3PRow,
} from '@shared/types';
import {
  computeEmployeeMonthlyStats,
  computeMonthDows,
  DEFAULT_MEAL_CONFIG,
  getDaysInMonth,
} from '@shared/attendanceParser';
import { matchesSearch } from '@shared/vnSearch';
import { apiClient } from '@client/lib/apiClient';
import {
  downloadAttendanceExcel,
  downloadPayroll3PExcel,
} from '@client/lib/excelService';
import { formatNumber, formatVnd } from '@client/lib/formatters';
import {
  Badge,
  Button,
  Card,
  useToast,
} from '@client/components/ui/IndustrialPrimitives';
import { useAuth } from '@client/context/AuthContext';
import type { AdminTabCommonProps } from '../types';

type RadarFilter =
  | 'ALL'
  | 'TOP_WORK'
  | 'TOP_OT'
  | 'HAS_KP'
  | 'HAS_LATE'
  | 'TOP_OFF'
  | 'TOP_S3';

type AttSubTab = 1 | 2 | 3 | 4 | 5 | 6;
type BatchMode = 'OT_FIXED' | 'DEFAULT_SHIFT' | 'LONG_LEAVE' | 'RESIGN';

interface AttendanceApiResponse {
  yearMonth: string;
  year: number;
  month: number;
  dows: string[];
  mealConfig: MealConfig;
  employees: EmployeeAttSummary[];
}

interface PayrollApiResponse {
  yearMonth: string;
  rows: Payroll3PRow[];
  totalNetPay: number;
}

// ==================== MEMOIZED ATTENDANCE DAY CELL ====================
interface DayCellProps {
  empId: string;
  dayIndex: number;
  value: string;
  isSunday: boolean;
  disabled: boolean;
  radarFilter: RadarFilter;
  onCellChange: (empId: string, dayIndex: number, nextValue: string) => void;
}

function computeCellClass(val: string, isSunday: boolean, radarFilter: RadarFilter): string {
  const s = val.trim().toUpperCase();
  const isOt = s.includes('+') || /\d+\s*G\b/.test(s);
  const isLateOrEarly = s.includes('-') || s === 'M' || s === 'S' || /\b[MS]\d/.test(s);
  const isNightS3 = s.includes('C3') || s.includes('ĐÊM') || s.includes('DEM');
  const isLeave =
    s === 'P' ||
    s === 'P/2' ||
    s === 'L' ||
    s === 'PO' ||
    s === 'O' ||
    s === '0' ||
    s === 'O/2';

  let highlight = '';
  if (radarFilter === 'HAS_KP' && s.includes('KP')) {
    highlight = 'ring-2 ring-rose-500 scale-105 z-10';
  } else if (radarFilter === 'HAS_LATE' && isLateOrEarly) {
    highlight = 'ring-2 ring-orange-500 scale-105 z-10';
  } else if (radarFilter === 'TOP_OT' && (isOt || (isSunday && s !== ''))) {
    highlight = 'ring-2 ring-blue-500 z-10';
  } else if (radarFilter === 'TOP_S3' && isNightS3) {
    highlight = 'ring-2 ring-indigo-500 z-10';
  }

  if (!s) {
    return `${
      isSunday
        ? 'border-rose-200 bg-rose-50/40 text-slate-600'
        : 'border-slate-200 bg-white text-slate-800'
    } ${highlight}`;
  }
  if (s.includes('KP')) {
    return `border-rose-700 bg-rose-600 font-black text-white shadow-sm ${highlight}`;
  }
  if (isLateOrEarly) {
    return `border-orange-200 bg-orange-50 font-semibold text-orange-800 ${highlight}`;
  }
  if (isLeave) {
    return `border-amber-200 bg-amber-50 font-semibold text-amber-800 ${highlight}`;
  }
  if (isOt) {
    return `border-blue-200 bg-blue-50 font-bold text-blue-800 ${highlight}`;
  }
  if (isNightS3) {
    return `border-indigo-200 bg-indigo-50 font-bold text-indigo-800 ${highlight}`;
  }
  if (isSunday) {
    return `border-blue-200 bg-blue-50 font-bold text-blue-800 ${highlight}`;
  }
  return `border-slate-200 bg-white font-semibold text-slate-800 ${highlight}`;
}

const AttendanceDayCell = memo(function AttendanceDayCell({
  empId,
  dayIndex,
  value,
  isSunday,
  disabled,
  radarFilter,
  onCellChange,
}: DayCellProps) {
  if (disabled) {
    return (
      <td className="border-b border-r border-slate-200 bg-slate-100 px-1 py-1 text-center text-[11px] text-slate-500">
        —
      </td>
    );
  }

  return (
    <td
      className={`border-b border-r border-slate-200 p-1 text-center ${
        isSunday ? 'bg-rose-50/30' : ''
      }`}
    >
      <input
        type="text"
        value={value}
        onChange={(e) => onCellChange(empId, dayIndex, e.target.value)}
        aria-label={`Chấm công ${empId} ngày ${dayIndex + 1}`}
        className={`font-mono-num relative h-7 w-[50px] rounded border px-1 text-center text-[11px] transition-shadow focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20 ${computeCellClass(
          value,
          isSunday,
          radarFilter
        )}`}
      />
    </td>
  );
});

export function AttendancePayrollTab({ deepLink }: AdminTabCommonProps) {
  const toast = useToast();
  const { user, authMode, quickSwitch, openPinModal } = useAuth();

  const canAccessAttendance =
    user?.appRole === 'ADMIN' ||
    user?.appRole === 'DIRECTOR' ||
    user?.appRole === 'SHIFT_LEADER';
  const canAccessPayroll3P = user?.appRole === 'ADMIN' || user?.appRole === 'DIRECTOR';

  const [year, setYear] = useState(() => {
    const vnDate = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
    return Number(vnDate.slice(0, 4)) || 2026;
  });
  const [month, setMonth] = useState(() => {
    const vnDate = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
    return Number(vnDate.slice(5, 7)) || 11;
  });
  const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
  const daysInMonth = useMemo(() => getDaysInMonth(year, month), [year, month]);

  const [dows, setDows] = useState<string[]>(() => {
    const vnDate = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
    return computeMonthDows(Number(vnDate.slice(0, 4)) || 2026, Number(vnDate.slice(5, 7)) || 11);
  });
  const [mealConfig, setMealConfig] = useState<MealConfig>(DEFAULT_MEAL_CONFIG);
  const [employees, setEmployees] = useState<EmployeeAttSummary[]>([]);
  const [histMap, setHistMap] = useState<Record<string, number[]>>({});
  const [loadingAtt, setLoadingAtt] = useState(false);

  const [activeSubTab, setActiveSubTab] = useState<AttSubTab>(1);
  const [radarFilter, setRadarFilter] = useState<RadarFilter>('ALL');
  const [searchQuery, setSearchQuery] = useState(deepLink?.attendanceSearch || '');
  const [dirtyCount, setDirtyCount] = useState(0);
  const [syncingManual, setSyncingManual] = useState(false);

  // Batch Fill State (Tab 4)
  const [batchMode, setBatchMode] = useState<BatchMode>('OT_FIXED');
  const [batchFromDay, setBatchFromDay] = useState(1);
  const [batchToDay, setBatchToDay] = useState(25);
  const [batchValue, setBatchValue] = useState('+2');
  const [batchDows, setBatchDows] = useState<string[]>(['T2', 'T3', 'T4', 'T5', 'T6', 'T7']);
  const [batchFillEmpty, setBatchFillEmpty] = useState(true);
  const [batchOverwrite, setBatchOverwrite] = useState(true);
  const [selectedEmpIds, setSelectedEmpIds] = useState<string[]>([]);
  const [applyingBatch, setApplyingBatch] = useState(false);

  // 3P Payroll State (Tab 6)
  const [payrollRows, setPayrollRows] = useState<Payroll3PRow[]>([]);
  const [totalNetPay, setTotalNetPay] = useState(0);
  const [loadingPayroll, setLoadingPayroll] = useState(false);

  // Debounce timers map for cell PUT requests
  const pendingTimersRef = useRef<
    Map<
      string,
      {
        timer: ReturnType<typeof setTimeout>;
        yearMonth: string;
        empId: string;
        dayIndex: number;
        value: string;
        defaultShift?: string;
      }
    >
  >(new Map());

  useEffect(() => {
    if (deepLink?.attendanceSearch !== undefined) {
      setSearchQuery(deepLink.attendanceSearch);
    }
  }, [deepLink?.attendanceSearch]);

  const fetchAttendance = useCallback(
    async (ym: string) => {
      if (!canAccessAttendance) return;
      setLoadingAtt(true);
      try {
        const res = await apiClient.get<AttendanceApiResponse>(`/attendance/${ym}`);
        setDows(res.dows || computeMonthDows(res.year, res.month));
        setMealConfig(res.mealConfig || DEFAULT_MEAL_CONFIG);
        setEmployees(res.employees || []);
        const nextHist: Record<string, number[]> = {};
        for (const e of res.employees || []) {
          nextHist[e.empId] = e.yearly?.months ? [...e.yearly.months] : [];
        }
        setHistMap(nextHist);
        setSelectedEmpIds((prev) =>
          prev.length > 0 ? prev : (res.employees || []).map((e) => e.empId)
        );
      } catch (err: any) {
        toast.error(err?.message || 'Không thể tải dữ liệu chấm công tháng.');
      } finally {
        setLoadingAtt(false);
      }
    },
    [canAccessAttendance, toast]
  );

  const fetchPayroll3P = useCallback(
    async (ym: string) => {
      if (!canAccessPayroll3P) return;
      setLoadingPayroll(true);
      try {
        const res = await apiClient.get<PayrollApiResponse>(`/payroll/${ym}`);
        setPayrollRows(res.rows || []);
        setTotalNetPay(res.totalNetPay || 0);
      } catch (err: any) {
        toast.error(err?.message || 'Không thể tải bảng chốt lương 3P.');
      } finally {
        setLoadingPayroll(false);
      }
    },
    [canAccessPayroll3P, toast]
  );

  useEffect(() => {
    void fetchAttendance(yearMonth);
    if (activeSubTab === 6) {
      void fetchPayroll3P(yearMonth);
    }
  }, [yearMonth, fetchAttendance, fetchPayroll3P]);

  useEffect(() => {
    if (activeSubTab === 6) {
      void fetchPayroll3P(yearMonth);
    }
  }, [activeSubTab, yearMonth, fetchPayroll3P]);

  const flushPendingCellSaves = async () => {
    const entries = [...pendingTimersRef.current.values()];
    pendingTimersRef.current.clear();
    for (const item of entries) {
      clearTimeout(item.timer);
      await apiClient.put(`/attendance/${item.yearMonth}/cell`, {
        empId: item.empId,
        dayIndex: item.dayIndex,
        value: item.value,
        defaultShift: item.defaultShift,
      });
    }
    setDirtyCount(0);
  };

  const handleManualSyncSave = async () => {
    setSyncingManual(true);
    try {
      await flushPendingCellSaves();
      await fetchAttendance(yearMonth);
      if (canAccessPayroll3P) await fetchPayroll3P(yearMonth);
      toast.success(`Đã lưu & đồng bộ bảng công tháng ${yearMonth} thành công.`);
    } catch (err: any) {
      toast.error(err?.message || 'Lỗi lưu đồng bộ bảng công.');
    } finally {
      setSyncingManual(false);
    }
  };

  const handleCellChange = useCallback(
    (empId: string, dayIndex: number, rawNextValue: string) => {
      const cleanVal = rawNextValue;
      setEmployees((prev) =>
        prev.map((emp) => {
          if (emp.empId !== empId) return emp;
          const nextDays = [...emp.days];
          nextDays[dayIndex] = cleanVal;
          return computeEmployeeMonthlyStats(
            {
              empId: emp.empId,
              name: emp.name,
              workType: emp.workType,
              defaultShift: emp.defaultShift,
              yearDaysHist: histMap[emp.empId] || emp.yearly.months,
              days: nextDays,
            },
            year,
            month,
            mealConfig
          );
        })
      );

      const targetYm = yearMonth;
      const mapKey = `${targetYm}_${empId}_${dayIndex}`;
      const existing = pendingTimersRef.current.get(mapKey);
      if (existing) clearTimeout(existing.timer);

      const timer = setTimeout(() => {
        pendingTimersRef.current.delete(mapKey);
        setDirtyCount(pendingTimersRef.current.size);
        void apiClient
          .put(`/attendance/${targetYm}/cell`, {
            empId,
            dayIndex,
            value: cleanVal.trim(),
          })
          .catch((err) => {
            toast.error(err?.message || `Lỗi lưu ô công ${empId}`);
          });
      }, 420);

      pendingTimersRef.current.set(mapKey, {
        timer,
        yearMonth: targetYm,
        empId,
        dayIndex,
        value: cleanVal.trim(),
      });
      setDirtyCount(pendingTimersRef.current.size);
    },
    [year, month, yearMonth, mealConfig, histMap, toast]
  );

  const handleDefaultShiftChange = async (emp: EmployeeAttSummary, nextShift: string) => {
    setEmployees((prev) =>
      prev.map((e) =>
        e.empId === emp.empId
          ? computeEmployeeMonthlyStats(
              {
                empId: e.empId,
                name: e.name,
                workType: e.workType,
                defaultShift: nextShift,
                yearDaysHist: histMap[e.empId] || e.yearly.months,
                days: e.days,
              },
              year,
              month,
              mealConfig
            )
          : e
      )
    );
    try {
      await apiClient.put(`/attendance/${yearMonth}/cell`, {
        empId: emp.empId,
        dayIndex: 0,
        value: emp.days[0] || '',
        defaultShift: nextShift,
      });
      toast.info(`Đã đổi ca mặc định của ${emp.name} ➔ ${nextShift}.`);
    } catch (err: any) {
      toast.error(err?.message || 'Không thể cập nhật ca mặc định.');
    }
  };

  // ==================== 6 RADAR STATS ====================
  const radarStats = useMemo(() => {
    let maxReg = 0;
    let maxOt = 0;
    let maxOff = 0;
    let maxS3 = 0;
    for (const e of employees) {
      if (e.regDays > maxReg) maxReg = e.regDays;
      if (e.totalOt > maxOt) maxOt = e.totalOt;
      if (e.offDays > maxOff) maxOff = e.offDays;
      if (e.s3Days > maxS3) maxS3 = e.s3Days;
    }

    const topWorkList = employees.filter(
      (e) => e.regDays === maxReg && maxReg > 0 && e.kpDays === 0
    );
    const topOtList = employees.filter((e) => e.totalOt === maxOt && maxOt > 0);
    const kpList = employees.filter((e) => e.kpDays > 0);
    const lateList = employees.filter((e) => e.lateHours > 0);
    const topOffList = employees.filter((e) => e.offDays === maxOff && maxOff > 0);
    const topS3List = employees.filter((e) => e.s3Days > 0);

    return {
      maxReg,
      maxOt,
      maxOff,
      maxS3,
      topWorkList,
      topOtList,
      kpList,
      lateList,
      topOffList,
      topS3List,
    };
  }, [employees]);

  const filteredEmployees = useMemo(() => {
    const list = employees.filter((e) => {
      if (radarFilter === 'HAS_KP' && e.kpDays <= 0) return false;
      if (radarFilter === 'HAS_LATE' && e.lateHours <= 0) return false;
      if (radarFilter === 'TOP_S3' && e.s3Days <= 0) return false;

      if (!searchQuery.trim()) return true;
      return matchesSearch(
        `${e.empId} ${e.name} ${e.defaultShift} ${e.badgeText}`,
        searchQuery
      );
    });

    if (radarFilter === 'TOP_WORK') {
      list.sort((a, b) => b.hours100 - a.hours100 || b.regDays - a.regDays);
    } else if (radarFilter === 'TOP_OT') {
      list.sort((a, b) => b.totalOt - a.totalOt);
    } else if (radarFilter === 'HAS_LATE') {
      list.sort((a, b) => b.lateHours - a.lateHours);
    } else if (radarFilter === 'TOP_OFF') {
      list.sort((a, b) => b.offDays - a.offDays);
    } else if (radarFilter === 'TOP_S3') {
      list.sort((a, b) => b.s3Days - a.s3Days);
    }

    return list;
  }, [employees, radarFilter, searchQuery]);

  // Batch preview cell count
  const batchPreviewCount = useMemo(() => {
    const fDay = Math.max(1, Math.min(daysInMonth, batchFromDay));
    const tDay = Math.max(fDay, Math.min(daysInMonth, batchToDay));
    let daysMatched = 0;
    for (let d = fDay; d <= tDay; d++) {
      if (batchDows.includes(dows[d - 1])) daysMatched++;
    }
    return daysMatched * selectedEmpIds.length;
  }, [batchFromDay, batchToDay, daysInMonth, batchDows, dows, selectedEmpIds]);

  const handleApplyBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedEmpIds.length === 0) {
      toast.warning('Vui lòng chọn ít nhất 1 nhân sự để chấm hàng loạt.');
      return;
    }
    setApplyingBatch(true);
    try {
      const res = await apiClient.post<{
        success: boolean;
        changedCells: number;
        employees: EmployeeAttSummary[];
      }>(`/attendance/${yearMonth}/batch`, {
        mode: batchMode,
        fromDay: batchFromDay,
        toDay: Math.min(daysInMonth, batchToDay),
        value: batchValue,
        selectedDows: batchDows,
        empIds: selectedEmpIds,
        fillEmptyWithDef: batchFillEmpty,
        overwrite: batchOverwrite,
      });
      setEmployees(res.employees || []);
      toast.success(`Đã chấm hàng loạt cho ${res.changedCells} ô công!`);
      setActiveSubTab(1);
    } catch (err: any) {
      toast.error(err?.message || 'Lỗi áp dụng chấm công hàng loạt.');
    } finally {
      setApplyingBatch(false);
    }
  };

  if (!canAccessAttendance) {
    return (
      <Card className="border-amber-200 bg-amber-50/60 p-6 text-center">
        <Lock className="mx-auto h-10 w-10 text-amber-600" />
        <h3 className="mt-3 text-base font-extrabold text-slate-900">
          Phân Hệ Chấm Công &amp; Lương 3P Yêu Cầu Quyền Trưởng Ca Hoặc Quản Đốc
        </h3>
        <p className="mt-1 text-xs text-slate-600">
          Vai trò hiện tại ({user?.title || 'Chưa xác thực'}) không được phép chỉnh sửa bảng công
          nhân sự.
        </p>
        <div className="mt-4 flex justify-center gap-2">
          {authMode === 'DEMO_QUICK' ? (
            <Button
              variant="primary"
              onClick={() => void quickSwitch({ workerId: 'NV00053' })}
            >
              Chuyển nhanh Quản Đốc (NV00053)
            </Button>
          ) : null}
          <Button variant="secondary" onClick={() => openPinModal('NV00053')}>
            Nhập PIN Quản Đốc
          </Button>
        </div>
      </Card>
    );
  }

  // Summary totals for Tab 2
  const tab2Totals = filteredEmployees.reduce(
    (acc, e) => ({
      hours100: acc.hours100 + e.hours100,
      abDays: acc.abDays + e.abDays,
      regDays: acc.regDays + e.regDays,
      s3Days: acc.s3Days + e.s3Days,
      ot15: acc.ot15 + e.ot15,
      ot20: acc.ot20 + e.ot20,
      ot30: acc.ot30 + e.ot30,
      mealTotal: acc.mealTotal + e.mealTotal,
      offDays: acc.offDays + e.offDays,
      lateHours: acc.lateHours + e.lateHours,
      errCount: acc.errCount + e.errCount,
    }),
    {
      hours100: 0,
      abDays: 0,
      regDays: 0,
      s3Days: 0,
      ot15: 0,
      ot20: 0,
      ot30: 0,
      mealTotal: 0,
      offDays: 0,
      lateHours: 0,
      errCount: 0,
    }
  );

  return (
    <div className="space-y-4">
      {/* ==================== TOP HEADER & MONTH/YEAR CONTROLS ==================== */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Calendar className="h-5 w-5 text-blue-600" />
              <h2 className="text-base font-extrabold uppercase tracking-wide text-slate-900">
                Bảng Chấm Công Thông Minh 31 Ngày, Radar 1-Click &amp; Chốt Lương KPI 3P
              </h2>
              <Badge variant="info">
                Tháng {String(month).padStart(2, '0')}/{year}: {daysInMonth} ngày
              </Badge>
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              Tự động nhận công &amp; giờ tăng ca từ phiếu công nhân. Đầy đủ 6 bảng nghiệp vụ &amp;
              Xuất Excel 4 Sheet chuẩn kế toán nhà máy.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="font-mono-num h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-bold text-slate-800 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
            >
              <option value={2025}>Năm 2025</option>
              <option value={2026}>Năm 2026</option>
              <option value={2027}>Năm 2027</option>
            </select>

            <select
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              className="font-mono-num h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-bold text-blue-700 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
            >
              {Array.from({ length: 12 }, (_, idx) => idx + 1).map((m) => (
                <option key={m} value={m}>
                  Tháng {String(m).padStart(2, '0')}
                </option>
              ))}
            </select>

            <Button
              variant="primary"
              size="sm"
              disabled={syncingManual}
              onClick={() => void handleManualSyncSave()}
            >
              <CloudUpload className="h-4 w-4" />
              💾 Lưu Đồng Bộ {dirtyCount > 0 ? `(${dirtyCount})` : ''}
            </Button>

            <Button
              variant="success"
              size="sm"
              onClick={() =>
                void downloadAttendanceExcel({ yearMonth, dows, employees }).then(() =>
                  toast.success(`Đã xuất Excel đủ 4 Bảng Chấm Công (${yearMonth})!`)
                )
              }
            >
              <Download className="h-4 w-4" />
              📥 Xuất Excel Chấm Công (Đủ 4 Bảng)
            </Button>
          </div>
        </div>

        {/* ==================== 6 RADAR CARDS ==================== */}
        <div className="mt-4 grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6">
          {(
            [
              {
                key: 'TOP_WORK' as RadarFilter,
                title: '🏆 Chuyên cần cao',
                val: `${radarStats.maxReg.toFixed(1)} công`,
                sub:
                  radarStats.topWorkList
                    .slice(0, 2)
                    .map((e) => e.name)
                    .join(', ') || 'Chưa phát sinh',
                border: 'border-slate-200 border-l-4 border-l-emerald-500',
                activeStyle: 'ring-2 ring-emerald-500 bg-emerald-50/70',
                icon: Award,
                color: 'text-emerald-700',
              },
              {
                key: 'TOP_OT' as RadarFilter,
                title: '⚡ Top Tăng ca',
                val: `${radarStats.maxOt.toFixed(1)} giờ OT`,
                sub:
                  radarStats.topOtList
                    .slice(0, 2)
                    .map((e) => `${e.name} (${e.totalOt}h)`)
                    .join(', ') || '0h OT',
                border: 'border-slate-200 border-l-4 border-l-blue-600',
                activeStyle: 'ring-2 ring-blue-500 bg-blue-50/70',
                icon: Flame,
                color: 'text-blue-700',
              },
              {
                key: 'HAS_KP' as RadarFilter,
                title: '🚨 Có nghỉ KP',
                val:
                  radarStats.kpList.length > 0
                    ? `${radarStats.kpList.length} NV vi phạm`
                    : '0 vi phạm (Tốt)',
                sub:
                  radarStats.kpList
                    .map((e) => `${e.name} (Ng.${e.kpDayList.join(',')})`)
                    .join('; ') || '100% đúng nội quy',
                border: 'border-slate-200 border-l-4 border-l-rose-500',
                activeStyle: 'ring-2 ring-rose-500 bg-rose-50/70',
                icon: ShieldAlert,
                color: 'text-rose-700',
              },
              {
                key: 'HAS_LATE' as RadarFilter,
                title: '⏰ Đi muộn / Về sớm',
                val: `${radarStats.lateList.length} NV bị trừ giờ`,
                sub:
                  radarStats.lateList
                    .slice(0, 2)
                    .map((e) => `${e.name} (-${e.lateHours}h)`)
                    .join(', ') || 'Không ai đi muộn',
                border: 'border-slate-200 border-l-4 border-l-amber-500',
                activeStyle: 'ring-2 ring-amber-500 bg-amber-50/70',
                icon: Clock,
                color: 'text-amber-700',
              },
              {
                key: 'TOP_OFF' as RadarFilter,
                title: '🏖️ Nghỉ nhiều',
                val: `${radarStats.maxOff.toFixed(1)} ngày nghỉ`,
                sub:
                  radarStats.topOffList
                    .slice(0, 2)
                    .map((e) => e.name)
                    .join(', ') || 'Trong ngưỡng chuẩn',
                border: 'border-slate-200 border-l-4 border-l-slate-500',
                activeStyle: 'ring-2 ring-slate-500 bg-slate-100',
                icon: Umbrella,
                color: 'text-slate-700',
              },
              {
                key: 'TOP_S3' as RadarFilter,
                title: '🌙 Chuyên Ca 3 Đêm',
                val: `${radarStats.maxS3.toFixed(1)} ca đêm`,
                sub: `${radarStats.topS3List.length} NV có chạy Ca 3`,
                border: 'border-slate-200 border-l-4 border-l-indigo-500',
                activeStyle: 'ring-2 ring-indigo-500 bg-indigo-50/70',
                icon: Moon,
                color: 'text-indigo-700',
              },
            ] as const
          ).map((card) => {
            const active = radarFilter === card.key;
            const Icon = card.icon;
            return (
              <button
                key={card.key}
                type="button"
                onClick={() => setRadarFilter((prev) => (prev === card.key ? 'ALL' : card.key))}
                className={`flex flex-col justify-between rounded-xl border p-2.5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-card ${
                  card.border
                } ${active ? card.activeStyle : 'bg-white hover:bg-slate-50/60'}`}
              >
                <div className="flex w-full items-center justify-between gap-1">
                  <span className={`text-[11px] font-extrabold ${card.color}`}>{card.title}</span>
                  <Icon className={`h-3.5 w-3.5 shrink-0 ${card.color}`} />
                </div>
                <div className={`font-mono-num mt-1.5 text-sm font-bold ${card.color}`}>
                  {card.val}
                </div>
                <div className="mt-0.5 truncate text-[11px] font-medium text-slate-800">
                  {card.sub}
                </div>
              </button>
            );
          })}
        </div>

        {/* Search & Clear Radar Filter */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="relative min-w-[260px] flex-1 sm:max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm nhanh Họ tên, Mã NV (NV00214), Ca mặc định..."
              className="h-9 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
            />
          </div>

          {radarFilter !== 'ALL' && (
            <Button variant="secondary" size="sm" onClick={() => setRadarFilter('ALL')}>
              <RefreshCw className="h-3.5 w-3.5" />
              Đang bật Radar [{radarFilter}] — Bấm bỏ lọc
            </Button>
          )}
        </div>
      </Card>

      {/* ==================== 6 DEEP SUB-TABS NAVIGATION ==================== */}
      <div className="flex flex-wrap gap-1.5 rounded-xl border border-slate-200 bg-white p-2 shadow-card">
        {(
          [
            [1, `🗓️ 1. Bảng Nhập ${daysInMonth} Ngày`],
            [2, '📊 2. Tổng Hợp 16 Cột & Xếp Loại A/B/C'],
            [3, '🍱 3. Phụ Cấp Ăn Ca 31 Ngày'],
            [4, '⚡ 4. Chấm Hàng Loạt & Cẩm Nang Mã Công'],
            [5, '📆 5. Lũy Kế 12 Tháng (T1 ➔ T12)'],
            [6, '💎 6. Bảng Chốt Lương Tháng KPI 3P'],
          ] as Array<[AttSubTab, string]>
        ).map(([num, label]) => (
          <button
            key={num}
            type="button"
            onClick={() => setActiveSubTab(num)}
            className={`rounded-lg border px-3 py-2 text-xs font-extrabold transition-all ${
              activeSubTab === num
                ? num === 6
                  ? 'border-emerald-600 bg-emerald-600 text-white shadow-sm'
                  : 'border-blue-600 bg-blue-600 text-white shadow-sm'
                : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ==================== SUB-TAB 1: 31-DAY MEMOIZED MATRIX ==================== */}
      {activeSubTab === 1 && (
        <Card noPadding>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/80 px-4 py-2.5 text-xs">
            <span className="text-slate-600">
              💡 Gõ trực tiếp mã công (<code className="font-bold text-slate-800">X</code>,{' '}
              <code className="font-bold text-blue-700">C1+2</code>,{' '}
              <code className="font-bold text-orange-700">C2/2-0.75</code>,{' '}
              <code className="font-bold text-indigo-700">C3</code>,{' '}
              <code className="font-bold text-amber-700">P</code>,{' '}
              <code className="font-bold text-rose-700">KP</code>) — tự động tính công tức thì
              &amp; lưu nền sau 0.4s.
            </span>
            <div className="flex flex-wrap gap-1.5">
              <span className="inline-flex items-center rounded-md border border-rose-700 bg-rose-600 px-2 py-0.5 text-[11px] font-black text-white">
                KP: Nghỉ không phép
              </span>
              <Badge variant="info">Xanh: Tăng ca (+giờ)</Badge>
              <Badge variant="purple">Tím: Ca 3 Đêm</Badge>
              <Badge variant="warning">Cam/Vàng: Muộn / Phép P</Badge>
            </div>
          </div>

          <div className="max-h-[560px] overflow-auto">
            {loadingAtt ? (
              <div className="p-8 text-center text-sm text-slate-500">
                Đang nạp ma trận chấm công {yearMonth}...
              </div>
            ) : (
              <table className="w-full min-w-[1880px] border-separate border-spacing-0 text-left text-xs">
                <thead className="sticky top-0 z-20 bg-slate-50 text-[11px] font-bold text-slate-600">
                  <tr>
                    <th className="sticky left-0 z-30 min-w-[215px] border-b border-r border-slate-200 bg-slate-50 px-3 py-2 shadow-[2px_0_5px_-2px_rgba(15,23,42,0.08)]">
                      Nhân Sự &amp; Huy Hiệu Radar
                    </th>
                    <th className="min-w-[96px] border-b border-r border-slate-200 bg-slate-50 px-2 py-2 text-center">
                      Ca Mặc Định
                    </th>
                    <th className="min-w-[68px] border-b border-r border-slate-200 bg-slate-50 px-2 py-2 text-center text-emerald-700">
                      Công
                    </th>
                    {Array.from({ length: 31 }, (_, i) => {
                      const dayNum = i + 1;
                      const dow = dows[i] || '-';
                      const isSun = dow === 'CN';
                      const outOfMonth = dayNum > daysInMonth;
                      return (
                        <th
                          key={dayNum}
                          className={`min-w-[54px] border-b border-r border-slate-200 px-1 py-1.5 text-center ${
                            outOfMonth
                              ? 'bg-slate-100 text-slate-500'
                              : isSun
                                ? 'bg-rose-50 text-rose-700'
                                : 'bg-slate-50 text-slate-600'
                          }`}
                        >
                          <div className="font-mono-num">{String(dayNum).padStart(2, '0')}</div>
                          <div className="text-[10px]">{dow}</div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="bg-white">
                  {filteredEmployees.map((emp) => (
                    <tr key={emp.empId} className="group transition-colors hover:bg-blue-50">
                      <td className="sticky left-0 z-10 border-b border-r border-slate-200 bg-white px-3 py-2 shadow-[2px_0_5px_-2px_rgba(15,23,42,0.08)] group-hover:bg-blue-50">
                        <div className="font-bold text-slate-900">
                          {emp.name}{' '}
                          <span className="font-mono-num text-[11px] font-semibold text-blue-700">
                            ({emp.empId})
                          </span>
                        </div>
                        {emp.badges.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {emp.badges.map((b, bi) => (
                              <Badge
                                key={bi}
                                variant={
                                  b.includes('KP')
                                    ? 'danger'
                                    : b.includes('Muộn')
                                      ? 'warning'
                                      : 'info'
                                }
                                className="text-[10px]"
                              >
                                {b}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </td>

                      <td className="border-b border-r border-slate-200 px-1.5 py-1.5 text-center">
                        <select
                          value={emp.defaultShift}
                          onChange={(e) => void handleDefaultShiftChange(emp, e.target.value)}
                          className="h-7 w-full rounded border border-slate-300 bg-white px-1 text-[11px] font-semibold text-slate-800 focus:border-blue-600 focus:outline-none"
                        >
                          <option value="Hành chính">Hành chính</option>
                          <option value="Ca 1">Ca 1</option>
                          <option value="Ca 2">Ca 2</option>
                          <option value="Ca 3">Ca 3</option>
                        </select>
                      </td>

                      <td className="font-mono-num border-b border-r border-slate-200 px-2 py-1.5 text-center font-extrabold text-emerald-700">
                        {emp.regDays.toFixed(1)}
                      </td>

                      {Array.from({ length: 31 }, (_, dIdx) => (
                        <AttendanceDayCell
                          key={dIdx}
                          empId={emp.empId}
                          dayIndex={dIdx}
                          value={emp.days[dIdx] || ''}
                          isSunday={dows[dIdx] === 'CN'}
                          disabled={dIdx + 1 > daysInMonth}
                          radarFilter={radarFilter}
                          onCellChange={handleCellChange}
                        />
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>
      )}

      {/* ==================== SUB-TAB 2: 16-COLUMN SUMMARY & GRADE A/B/C ==================== */}
      {activeSubTab === 2 && (
        <Card noPadding>
          <div className="max-h-[560px] overflow-auto">
            <table className="w-full min-w-[1280px] border-separate border-spacing-0 text-left text-xs">
              <thead className="sticky top-0 z-20 bg-slate-50 text-[11px] font-bold uppercase text-slate-600">
                <tr>
                  <th className="border-b border-slate-200 bg-slate-50 px-2.5 py-2.5 text-center">
                    STT
                  </th>
                  <th className="border-b border-slate-200 bg-slate-50 px-2.5 py-2.5">Mã NV</th>
                  <th className="sticky left-0 z-30 border-b border-r border-slate-200 bg-slate-50 px-3 py-2.5 shadow-[2px_0_5px_-2px_rgba(15,23,42,0.08)]">
                    Tên Nhân Viên
                  </th>
                  <th className="border-b border-slate-200 bg-slate-50 px-3 py-2.5">
                    Nhận Diện Thông Minh &amp; Cảnh Báo
                  </th>
                  <th className="border-b border-slate-200 bg-slate-50 px-2.5 py-2.5 text-right">
                    Giờ 100% Lương
                  </th>
                  <th className="border-b border-slate-200 bg-slate-50 px-2.5 py-2.5 text-right">
                    Công Tính AB
                  </th>
                  <th className="border-b border-slate-200 bg-slate-50 px-2.5 py-2.5 text-center">
                    Xếp Loại
                  </th>
                  <th className="border-b border-slate-200 bg-slate-50 px-2.5 py-2.5 text-right">
                    Công Thường
                  </th>
                  <th className="border-b border-slate-200 bg-slate-50 px-2.5 py-2.5 text-right">
                    Công Ca 3
                  </th>
                  <th className="border-b border-slate-200 bg-slate-50 px-2.5 py-2.5 text-right text-blue-700">
                    TC x1.5
                  </th>
                  <th className="border-b border-slate-200 bg-slate-50 px-2.5 py-2.5 text-right text-amber-700">
                    TC x2
                  </th>
                  <th className="border-b border-slate-200 bg-slate-50 px-2.5 py-2.5 text-right text-indigo-700">
                    TC x3
                  </th>
                  <th className="border-b border-slate-200 bg-slate-50 px-2.5 py-2.5 text-right text-emerald-700">
                    Phụ Cấp Ăn Ca
                  </th>
                  <th className="border-b border-slate-200 bg-slate-50 px-2.5 py-2.5 text-right">
                    Tổng Nghỉ
                  </th>
                  <th className="border-b border-slate-200 bg-slate-50 px-2.5 py-2.5 text-right text-rose-700">
                    Muộn/Sớm
                  </th>
                  <th className="border-b border-slate-200 bg-slate-50 px-2.5 py-2.5 text-center">
                    Ô Lỗi
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white">
                {filteredEmployees.map((e, idx) => (
                  <tr key={e.empId} className="group transition-colors hover:bg-blue-50">
                    <td className="font-mono-num border-b border-slate-200 px-2.5 py-2 text-center text-slate-500">
                      {idx + 1}
                    </td>
                    <td className="font-mono-num border-b border-slate-200 px-2.5 py-2 font-bold text-blue-700">
                      {e.empId}
                    </td>
                    <td className="sticky left-0 z-10 border-b border-r border-slate-200 bg-white px-3 py-2 font-bold text-slate-900 shadow-[2px_0_5px_-2px_rgba(15,23,42,0.08)] group-hover:bg-blue-50">
                      {e.name}
                    </td>
                    <td className="border-b border-slate-200 px-3 py-2 text-[11px] text-slate-700">
                      {e.badgeText}
                    </td>
                    <td className="font-mono-num border-b border-slate-200 px-2.5 py-2 text-right font-bold text-slate-900">
                      {e.hours100.toFixed(2)}
                    </td>
                    <td className="font-mono-num border-b border-slate-200 px-2.5 py-2 text-right font-bold text-blue-700">
                      {e.abDays.toFixed(2)}
                    </td>
                    <td className="border-b border-slate-200 px-2.5 py-2 text-center">
                      <Badge
                        variant={
                          e.grade === 'A'
                            ? 'success'
                            : e.grade === 'B'
                              ? 'warning'
                              : 'danger'
                        }
                      >
                        {e.grade}
                      </Badge>
                    </td>
                    <td className="font-mono-num border-b border-slate-200 px-2.5 py-2 text-right font-bold text-slate-900">
                      {e.regDays.toFixed(2)}
                    </td>
                    <td className="font-mono-num border-b border-slate-200 px-2.5 py-2 text-right text-indigo-700">
                      {e.s3Days.toFixed(1)}
                    </td>
                    <td className="font-mono-num border-b border-slate-200 px-2.5 py-2 text-right font-semibold text-blue-700">
                      {e.ot15.toFixed(1)}
                    </td>
                    <td className="font-mono-num border-b border-slate-200 px-2.5 py-2 text-right font-semibold text-amber-700">
                      {e.ot20.toFixed(1)}
                    </td>
                    <td className="font-mono-num border-b border-slate-200 px-2.5 py-2 text-right font-semibold text-indigo-700">
                      {e.ot30.toFixed(1)}
                    </td>
                    <td className="font-mono-num border-b border-slate-200 px-2.5 py-2 text-right font-bold text-emerald-700">
                      {formatNumber(e.mealTotal)}
                    </td>
                    <td className="font-mono-num border-b border-slate-200 px-2.5 py-2 text-right text-slate-700">
                      {e.offDays.toFixed(1)}
                    </td>
                    <td
                      className={`font-mono-num border-b border-slate-200 px-2.5 py-2 text-right ${
                        e.lateHours > 0 ? 'font-bold text-rose-700' : 'text-slate-500'
                      }`}
                    >
                      {e.lateHours.toFixed(2)}
                    </td>
                    <td
                      className={`font-mono-num border-b border-slate-200 px-2.5 py-2 text-center ${
                        e.errCount > 0 ? 'font-bold text-rose-700' : 'text-slate-500'
                      }`}
                    >
                      {e.errCount}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-100 font-mono-num text-xs font-extrabold text-slate-900">
                <tr className="border-t-2 border-slate-300">
                  <td colSpan={4} className="px-3 py-2.5 text-right uppercase text-slate-700">
                    Tổng cộng ({filteredEmployees.length} nhân sự):
                  </td>
                  <td className="px-2.5 py-2.5 text-right">{tab2Totals.hours100.toFixed(1)}</td>
                  <td className="px-2.5 py-2.5 text-right text-blue-700">
                    {tab2Totals.abDays.toFixed(1)}
                  </td>
                  <td />
                  <td className="px-2.5 py-2.5 text-right text-slate-900">
                    {tab2Totals.regDays.toFixed(1)}
                  </td>
                  <td className="px-2.5 py-2.5 text-right text-indigo-700">
                    {tab2Totals.s3Days.toFixed(1)}
                  </td>
                  <td className="px-2.5 py-2.5 text-right text-blue-700">
                    {tab2Totals.ot15.toFixed(1)}
                  </td>
                  <td className="px-2.5 py-2.5 text-right text-amber-700">
                    {tab2Totals.ot20.toFixed(1)}
                  </td>
                  <td className="px-2.5 py-2.5 text-right text-indigo-700">
                    {tab2Totals.ot30.toFixed(1)}
                  </td>
                  <td className="px-2.5 py-2.5 text-right text-emerald-700">
                    {formatVnd(tab2Totals.mealTotal)}
                  </td>
                  <td className="px-2.5 py-2.5 text-right text-slate-700">
                    {tab2Totals.offDays.toFixed(1)}
                  </td>
                  <td className="px-2.5 py-2.5 text-right text-rose-700">
                    {tab2Totals.lateHours.toFixed(2)}
                  </td>
                  <td className="px-2.5 py-2.5 text-center">{tab2Totals.errCount}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      )}

      {/* ==================== SUB-TAB 3: UNIFIED 31-DAY MEAL ALLOWANCE ==================== */}
      {activeSubTab === 3 && (
        <Card noPadding>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/80 px-4 py-2.5 text-xs">
            <span className="font-medium text-slate-600">
              🍱 Định mức Phụ cấp Ăn ca thống nhất từ Cấu hình Hệ thống:
            </span>
            <div className="flex flex-wrap gap-2">
              <Badge variant="info">Ca 2 / Ca 3: {formatVnd(mealConfig.mealShift23)}</Badge>
              <Badge variant="success">Tăng ca ≥ 2h: {formatVnd(mealConfig.mealOt2h)}</Badge>
              <Badge variant="warning">Chủ nhật đủ ca: {formatVnd(mealConfig.mealSunday)}</Badge>
            </div>
          </div>

          <div className="max-h-[540px] overflow-auto">
            <table className="w-full min-w-[1750px] border-separate border-spacing-0 text-left text-xs">
              <thead className="sticky top-0 z-20 bg-slate-50 text-[11px] font-bold text-slate-600">
                <tr>
                  <th className="sticky left-0 z-30 min-w-[220px] border-b border-r border-slate-200 bg-slate-50 px-3 py-2 shadow-[2px_0_5px_-2px_rgba(15,23,42,0.08)]">
                    STT • Nhân Sự &amp; Mã NV
                  </th>
                  {Array.from({ length: 31 }, (_, i) => {
                    const isSun = dows[i] === 'CN';
                    return (
                      <th
                        key={i}
                        className={`min-w-[52px] border-b border-r border-slate-200 px-1 py-2 text-center ${
                          isSun ? 'bg-rose-50 text-rose-700' : 'bg-slate-50 text-slate-600'
                        }`}
                      >
                        <div className="font-mono-num">{String(i + 1).padStart(2, '0')}</div>
                        <div className="text-[10px]">{dows[i]}</div>
                      </th>
                    );
                  })}
                  <th className="min-w-[115px] border-b border-slate-200 bg-emerald-50/60 px-3 py-2 text-right text-emerald-700">
                    Tổng Ăn Ca
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white">
                {filteredEmployees.map((emp, idx) => (
                  <tr key={emp.empId} className="group transition-colors hover:bg-blue-50">
                    <td className="sticky left-0 z-10 border-b border-r border-slate-200 bg-white px-3 py-2 shadow-[2px_0_5px_-2px_rgba(15,23,42,0.08)] group-hover:bg-blue-50">
                      <span className="font-mono-num mr-2 text-slate-500">{idx + 1}.</span>
                      <span className="font-semibold text-slate-900">{emp.name}</span>{' '}
                      <span className="font-mono-num text-[11px] font-bold text-blue-700">
                        ({emp.empId})
                      </span>
                    </td>
                    {Array.from({ length: 31 }, (_, dIdx) => {
                      const mv = emp.dailyMeals[dIdx] || 0;
                      const isSun = dows[dIdx] === 'CN';
                      return (
                        <td
                          key={dIdx}
                          className={`font-mono-num border-b border-r border-slate-200 px-1 py-2 text-right text-[11px] ${
                            isSun ? 'bg-rose-50/30 ' : ''
                          }${
                            mv >= 30000
                              ? 'font-bold text-blue-700'
                              : mv > 0
                                ? 'font-semibold text-emerald-700'
                                : 'text-slate-400'
                          }`}
                        >
                          {mv > 0 ? `${Math.round(mv / 1000)}k` : '0'}
                        </td>
                      );
                    })}
                    <td className="font-mono-num border-b border-slate-200 bg-emerald-50/40 px-3 py-2 text-right font-extrabold text-emerald-700">
                      {formatVnd(emp.mealTotal)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ==================== SUB-TAB 4: 4-MODE BATCH FILL & CODE HANDBOOK ==================== */}
      {activeSubTab === 4 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          {/* Batch Form */}
          <Card className="lg:col-span-5">
            <div className="flex items-center gap-2 text-sm font-extrabold uppercase text-blue-700">
              <Zap className="h-4 w-4" />
              Chấm Công Hàng Loạt 4 Chế Độ Theo Khoảng Ngày
            </div>

            <form onSubmit={handleApplyBatch} className="mt-3 space-y-3 text-xs">
              <div>
                <label className="mb-1 block font-bold uppercase text-slate-600">
                  1. Chế độ áp dụng hàng loạt (*)
                </label>
                <select
                  value={batchMode}
                  onChange={(e) => {
                    const m = e.target.value as BatchMode;
                    setBatchMode(m);
                    if (m === 'OT_FIXED') setBatchValue('+2');
                    else if (m === 'DEFAULT_SHIFT') setBatchValue('AUTO');
                    else if (m === 'LONG_LEAVE') setBatchValue('P');
                    else setBatchValue('');
                  }}
                  className="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 font-semibold text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
                >
                  <option value="OT_FIXED">
                    1. OT_FIXED — Gắn tăng ca cố định (giữ nguyên ca &amp; muộn/sớm)
                  </option>
                  <option value="DEFAULT_SHIFT">
                    2. DEFAULT_SHIFT — Điền ca mặc định từng người (X, C1, C2, C3)
                  </option>
                  <option value="LONG_LEAVE">
                    3. LONG_LEAVE — Nghỉ phép / Điều động dài ngày (P, KP, O)
                  </option>
                  <option value="RESIGN">
                    4. RESIGN — Xóa trắng mã công từ ngày nghỉ việc
                  </option>
                </select>
              </div>

              <div className="grid grid-cols-3 gap-2.5">
                <div>
                  <label className="mb-1 block font-bold uppercase text-slate-600">Từ ngày</label>
                  <input
                    type="number"
                    min={1}
                    max={daysInMonth}
                    value={batchFromDay}
                    onChange={(e) => setBatchFromDay(Math.max(1, Number(e.target.value) || 1))}
                    className="font-mono-num h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 font-bold text-slate-900 focus:border-blue-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-bold uppercase text-slate-600">Đến ngày</label>
                  <input
                    type="number"
                    min={1}
                    max={daysInMonth}
                    value={batchToDay}
                    onChange={(e) =>
                      setBatchToDay(Math.min(daysInMonth, Math.max(1, Number(e.target.value) || 1)))
                    }
                    className="font-mono-num h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 font-bold text-slate-900 focus:border-blue-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-bold uppercase text-slate-600">
                    Mã / Giờ (+)
                  </label>
                  <input
                    type="text"
                    disabled={batchMode === 'DEFAULT_SHIFT' || batchMode === 'RESIGN'}
                    value={batchValue}
                    onChange={(e) => setBatchValue(e.target.value)}
                    placeholder="+2 hoặc P"
                    className="font-mono-num h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 font-bold text-blue-700 focus:border-blue-600 focus:outline-none disabled:bg-slate-100 disabled:opacity-60"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block font-bold uppercase text-slate-600">
                  2. Thứ trong tuần áp dụng
                </label>
                <div className="flex flex-wrap gap-2">
                  {(['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'] as const).map((dow) => {
                    const checked = batchDows.includes(dow);
                    return (
                      <label
                        key={dow}
                        className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1 font-bold transition-colors ${
                          checked
                            ? 'border-blue-600 bg-blue-600 text-white shadow-sm'
                            : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setBatchDows((prev) =>
                              checked ? prev.filter((x) => x !== dow) : [...prev, dow]
                            )
                          }
                          className="hidden"
                        />
                        {dow}
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-1.5 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                <label className="flex cursor-pointer items-center gap-2 text-slate-800">
                  <input
                    type="checkbox"
                    checked={batchFillEmpty}
                    onChange={(e) => setBatchFillEmpty(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 accent-blue-600"
                  />
                  Tự điền mã ca mặc định vào ô đang trống trước phần tăng ca
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-slate-800">
                  <input
                    type="checkbox"
                    checked={batchOverwrite}
                    onChange={(e) => setBatchOverwrite(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 accent-blue-600"
                  />
                  Cho phép ghi đè lên các ô đã có mã công trước đó
                </label>
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="font-bold uppercase text-slate-600">
                    3. Nhân sự áp dụng ({selectedEmpIds.length}/{employees.length})
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedEmpIds((prev) =>
                        prev.length === employees.length ? [] : employees.map((e) => e.empId)
                      )
                    }
                    className="font-bold text-blue-700 hover:underline"
                  >
                    ☑️ Chọn / Bỏ chọn tất cả
                  </button>
                </div>

                <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-2">
                  {employees.map((emp) => {
                    const checked = selectedEmpIds.includes(emp.empId);
                    return (
                      <label
                        key={emp.empId}
                        className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-blue-50"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setSelectedEmpIds((prev) =>
                              checked
                                ? prev.filter((id) => id !== emp.empId)
                                : [...prev, emp.empId]
                            )
                          }
                          className="h-3.5 w-3.5 rounded accent-blue-600"
                        />
                        <span className="font-semibold text-slate-900">{emp.name}</span>
                        <span className="text-[11px] text-slate-500">
                          ({emp.empId} • {emp.defaultShift})
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-between rounded-xl border border-blue-200 bg-blue-50 px-3 py-2">
                <span className="font-bold text-blue-900">Dự kiến số ô công tác động:</span>
                <Badge variant="info" className="font-mono-num text-sm">
                  {batchPreviewCount} ô
                </Badge>
              </div>

              <Button
                type="submit"
                variant="primary"
                className="w-full"
                disabled={applyingBatch}
              >
                <CheckSquare className="h-4 w-4" />
                {applyingBatch ? 'Đang chấm hàng loạt...' : '✅ Áp Dụng Chấm Công Hàng Loạt'}
              </Button>
            </form>
          </Card>

          {/* Attendance Code Handbook */}
          <Card className="lg:col-span-7">
            <div className="flex items-center gap-2 text-sm font-extrabold uppercase text-slate-800">
              <BookOpen className="h-4 w-4 text-blue-600" />
              Cẩm Nang Mã Chấm Công &amp; Quy Tắc Giải Mã Tự Động GCCK Thắng Lợi
            </div>

            <div className="mt-3 space-y-3 text-xs leading-relaxed text-slate-700">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="font-bold text-blue-700">1. Mã Công Chính &amp; Nghỉ Chế Độ</div>
                <ul className="mt-1.5 list-disc space-y-1 pl-4">
                  <li>
                    <code className="font-bold text-emerald-700">X</code>,{' '}
                    <code className="font-bold text-emerald-700">C1</code>,{' '}
                    <code className="font-bold text-emerald-700">C2</code>,{' '}
                    <code className="font-bold text-indigo-700">C3</code>,{' '}
                    <code className="font-bold text-emerald-700">K</code>,{' '}
                    <code className="font-bold text-emerald-700">VS</code>: Đủ 1.0 công (8 giờ).
                    Riêng <code className="font-bold text-indigo-700">C3</code> cộng thêm 1.0 vào
                    cột <strong>Công Ca 3 (130%)</strong>.
                  </li>
                  <li>
                    <code className="font-bold text-blue-700">X/2</code>,{' '}
                    <code className="font-bold text-blue-700">C2/2</code>,{' '}
                    <code className="font-bold text-blue-700">4</code>,{' '}
                    <code className="font-bold text-blue-700">6.25</code>: Nửa ca hoặc nhập trực
                    tiếp số giờ thực làm (tự chia cho 8h).
                  </li>
                  <li>
                    <code className="font-bold text-amber-700">P</code> /{' '}
                    <code className="font-bold text-amber-700">P/2</code>: Nghỉ phép năm có hưởng
                    lương (trừ vào quỹ 12 ngày phép/năm).
                  </li>
                  <li>
                    <code className="font-bold text-amber-700">O</code> hoặc{' '}
                    <code className="font-bold text-amber-700">0</code>: Nghỉ việc riêng có xin
                    phép / điều động — không hưởng lương ngày nhưng{' '}
                    <strong>vẫn bảo lưu điểm chuyên cần A/B</strong> (VD: <code>X/2+O/2</code> tính
                    0.5 ngày nghỉ, không bị tính trùng thành 1.0!).
                  </li>
                  <li className="rounded bg-blue-50/80 p-2 border border-blue-200 text-blue-900">
                    🏆 <strong>Quy chế Thưởng Chuyên Cần P2:</strong>
                    <br />• <strong>Loại A (250.000 đ)</strong>: Đủ số công trong tháng trừ Chủ nhật hoặc nghỉ tối đa nửa ngày (≤ 0.5 ngày).
                    <br />• <strong>Loại B (200.000 đ)</strong>: Nghỉ 1 ngày công (0.5 &lt; ngày nghỉ ≤ 1.0 ngày).
                    <br />• <strong>Quá 1 ngày nghỉ hoặc nghỉ KP (0 đ)</strong>: Không xét thưởng chuyên cần.
                  </li>
                  <li>
                    <code className="rounded bg-rose-600 px-1 py-0.5 font-black text-white">KP</code>
                    : Nghỉ Không Phép — cảnh báo đỏ nổi bật trên bảng &amp; Radar, hạ xếp loại xuống{' '}
                    <strong className="text-rose-700">Loại C (KP)</strong>.
                  </li>
                </ul>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="font-bold text-amber-700">
                  2. Ghép Giờ Tăng Ca (+) &amp; Trừ Đi Muộn / Về Sớm (-)
                </div>
                <ul className="mt-1.5 list-disc space-y-1 pl-4">
                  <li>
                    <code className="font-bold text-blue-700">C1+2</code>,{' '}
                    <code className="font-bold text-blue-700">1 2g</code>,{' '}
                    <code className="font-bold text-blue-700">X+3</code>: Tăng ca ngày thường tự
                    cộng vào <strong>TC x1.5</strong>; nếu rơi vào Chủ nhật tự động vào{' '}
                    <strong>TC x2.0</strong>.
                  </li>
                  <li>
                    <code className="font-bold text-indigo-700">C3+2D</code>,{' '}
                    <code className="font-bold text-indigo-700">+2DEM</code>,{' '}
                    <code className="font-bold text-indigo-700">+2TKD</code>: Tăng ca đêm tự cộng
                    vào <strong>TC x3.0</strong>.
                  </li>
                  <li>
                    <code className="font-bold text-orange-700">C2/2-0.75</code>,{' '}
                    <code className="font-bold text-orange-700">X-1.5</code>: Khấu trừ trực tiếp số
                    giờ đi muộn/về sớm khỏi tổng giờ hưởng 100% lương.
                  </li>
                </ul>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* ==================== SUB-TAB 5: 12-MONTH CUMULATIVE (T1 -> T12) ==================== */}
      {activeSubTab === 5 && (
        <Card noPadding>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/80 px-4 py-2.5 text-xs">
            <span className="text-slate-600">
              📆 Theo dõi lũy kế 12 tháng, kiểm soát trần tăng ca{' '}
              <strong className="text-slate-900">300 giờ/năm</strong> &amp; quỹ phép{' '}
              <strong className="text-slate-900">12 ngày/năm</strong>.
            </span>
            <Badge variant="info">💡 Bấm vào tiêu đề cột T1..T12 để mở bảng tháng tương ứng</Badge>
          </div>

          <div className="max-h-[560px] overflow-auto">
            <table className="w-full min-w-[1480px] border-separate border-spacing-0 text-left text-xs">
              <thead className="sticky top-0 z-20 bg-slate-50 text-[11px] font-bold uppercase text-slate-600">
                <tr>
                  <th className="sticky left-0 z-30 min-w-[220px] border-b border-r border-slate-200 bg-slate-50 px-3 py-2.5 shadow-[2px_0_5px_-2px_rgba(15,23,42,0.08)]">
                    STT • Nhân Sự &amp; Mã NV
                  </th>
                  {Array.from({ length: 12 }, (_, mIdx) => {
                    const mNum = mIdx + 1;
                    const isCur = mNum === month;
                    return (
                      <th
                        key={mNum}
                        onClick={() => {
                          setMonth(mNum);
                          setActiveSubTab(1);
                        }}
                        className={`cursor-pointer border-b border-slate-200 px-2 py-2.5 text-center transition-colors hover:bg-blue-50 hover:text-blue-700 ${
                          isCur ? 'bg-amber-50 text-amber-800' : 'bg-slate-50 text-slate-600'
                        }`}
                        title={`Mở bảng nhập Tháng ${mNum}`}
                      >
                        T{mNum}
                        {isCur ? '*' : ''}
                      </th>
                    );
                  })}
                  <th className="border-b border-slate-200 bg-slate-50 px-2.5 py-2.5 text-right text-emerald-700">
                    Tổng Công Năm
                  </th>
                  <th className="w-[150px] border-b border-slate-200 bg-slate-50 px-2.5 py-2.5 text-right text-amber-700">
                    Trần OT (/300h)
                  </th>
                  <th className="border-b border-slate-200 bg-slate-50 px-2.5 py-2.5 text-center text-blue-700">
                    Phép Năm (12)
                  </th>
                  <th className="border-b border-slate-200 bg-slate-50 px-2.5 py-2.5 text-center text-rose-700">
                    KP
                  </th>
                  <th className="border-b border-slate-200 bg-slate-50 px-3 py-2.5">
                    Danh Hiệu Cuối Năm
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white">
                {filteredEmployees.map((emp, idx) => {
                  const yr = emp.yearly;
                  return (
                    <tr key={emp.empId} className="group transition-colors hover:bg-blue-50">
                      <td className="sticky left-0 z-10 border-b border-r border-slate-200 bg-white px-3 py-2 shadow-[2px_0_5px_-2px_rgba(15,23,42,0.08)] group-hover:bg-blue-50">
                        <span className="font-mono-num mr-2 text-slate-500">{idx + 1}.</span>
                        <span className="font-bold text-slate-900">{emp.name}</span>{' '}
                        <span className="font-mono-num text-[11px] font-bold text-blue-700">
                          ({emp.empId})
                        </span>
                      </td>
                      {yr.months.map((val, mIdx) => (
                        <td
                          key={mIdx}
                          className={`font-mono-num border-b border-slate-200 px-2 py-2 text-center ${
                            mIdx + 1 === month
                              ? 'bg-amber-50/60 font-extrabold text-amber-800'
                              : 'text-slate-700'
                          }`}
                        >
                          {val.toFixed(1)}
                        </td>
                      ))}
                      <td className="font-mono-num border-b border-slate-200 px-2.5 py-2 text-right font-extrabold text-emerald-700">
                        {yr.totalYearDays.toFixed(1)}
                      </td>
                      <td className="border-b border-slate-200 px-2.5 py-2 text-right">
                        <div className="font-mono-num font-bold text-slate-800">
                          {yr.totalYearOt.toFixed(1)} / {yr.otCapHours}h
                        </div>
                        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                          <div
                            className={`h-full ${
                              yr.otCapPct > 85 ? 'bg-rose-500' : 'bg-blue-600'
                            }`}
                            style={{ width: `${yr.otCapPct}%` }}
                          />
                        </div>
                      </td>
                      <td className="font-mono-num border-b border-slate-200 px-2.5 py-2 text-center">
                        <span className="font-semibold text-amber-700">{yr.usedLeaveDays}</span> /{' '}
                        <span className="font-bold text-emerald-700">
                          Còn {yr.remainingLeaveDays}
                        </span>
                      </td>
                      <td
                        className={`font-mono-num border-b border-slate-200 px-2.5 py-2 text-center ${
                          emp.kpDays > 0 ? 'font-extrabold text-rose-700' : 'text-slate-500'
                        }`}
                      >
                        {emp.kpDays}
                      </td>
                      <td className="border-b border-slate-200 px-3 py-2">
                        <Badge
                          variant={
                            yr.yearRank.includes('C')
                              ? 'danger'
                              : yr.yearRank.includes('A+')
                                ? 'warning'
                                : 'success'
                          }
                        >
                          {yr.yearRank}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ==================== SUB-TAB 6: 3P MONTHLY PAYROLL CONSOLIDATION ==================== */}
      {activeSubTab === 6 && (
        <div className="space-y-4">
          {!canAccessPayroll3P ? (
            <Card className="border-amber-200 bg-amber-50/60 p-6 text-center">
              <Lock className="mx-auto h-9 w-9 text-amber-600" />
              <h3 className="mt-2 text-base font-extrabold text-slate-900">
                Bảng Chốt Lương Tháng KPI 3P Thuộc Quyền Bảo Mật Quản Đốc / Giám Đốc
              </h3>
              <p className="mt-1 text-xs text-slate-600">
                Trưởng ca có thể chấm công (Tab 1–5), nhưng chi tiết thu nhập thực lĩnh toàn xưởng
                chỉ mở cho Quản đốc.
              </p>
              <div className="mt-4 flex justify-center gap-2">
                {authMode === 'DEMO_QUICK' && (
                  <Button
                    variant="primary"
                    onClick={() => void quickSwitch({ workerId: 'NV00053' })}
                  >
                    Chuyển nhanh Quản Đốc (NV00053)
                  </Button>
                )}
                <Button variant="secondary" onClick={() => openPinModal('NV00053')}>
                  Mở khóa bằng PIN Quản Đốc
                </Button>
              </div>
            </Card>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Card className="border-l-4 border-l-emerald-500">
                  <div className="text-xs font-bold uppercase text-slate-500">
                    Tổng Thực Lĩnh Cuối Tháng ({payrollRows.length} NV)
                  </div>
                  <div className="font-mono-num mt-1 text-2xl font-black text-emerald-700">
                    {formatVnd(totalNetPay)}
                  </div>
                </Card>

                <Card className="border-l-4 border-l-slate-500">
                  <div className="text-xs font-bold uppercase text-slate-500">
                    Tổng P1 (Lương Vị Trí HC &amp; Phép)
                  </div>
                  <div className="font-mono-num mt-1 text-xl font-black text-slate-800">
                    {formatVnd(payrollRows.reduce((s, r) => s + r.p1PositionPay, 0))}
                  </div>
                </Card>

                <Card className="border-l-4 border-l-blue-600">
                  <div className="text-xs font-bold uppercase text-slate-500">
                    Tổng P2 (Chuyên Cần A: 250k • B: 200k)
                  </div>
                  <div className="font-mono-num mt-1 text-xl font-black text-blue-700">
                    {formatVnd(payrollRows.reduce((s, r) => s + r.p2PersonBonus, 0))}
                  </div>
                </Card>

                <Card className="border-l-4 border-l-indigo-500">
                  <div className="text-xs font-bold uppercase text-slate-500">
                    Tổng P3 (Lương Khoán SP &amp; Vượt ĐM)
                  </div>
                  <div className="font-mono-num mt-1 text-xl font-black text-indigo-700">
                    {formatVnd(payrollRows.reduce((s, r) => s + r.p3PerformancePay, 0))}
                  </div>
                </Card>
              </div>

              <Card noPadding>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 p-4">
                  <div className="flex items-center gap-2">
                    <Gem className="h-5 w-5 text-emerald-600" />
                    <div>
                      <h3 className="text-sm font-extrabold uppercase text-slate-900">
                        Bảng Tổng Hợp Chốt Lương KPI 3P Tháng {yearMonth}
                      </h3>
                      <p className="text-xs text-slate-500">
                        Hợp nhất Bảng Chấm Công + Phiếu Khoán Sản Lượng CNC + Thưởng Hạng A/B + Ăn
                        Ca (chống tính trùng) − Khấu trừ NG
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="success"
                    size="sm"
                    onClick={() =>
                      void downloadPayroll3PExcel(yearMonth, payrollRows).then(() =>
                        toast.success(`Đã xuất Excel Bảng Chốt Lương KPI 3P (${yearMonth})!`)
                      )
                    }
                  >
                    <Download className="h-4 w-4" />
                    📥 Xuất Excel Bảng Lương 3P
                  </Button>
                </div>

                <div className="max-h-[540px] overflow-auto">
                  {loadingPayroll ? (
                    <div className="p-8 text-center text-sm text-slate-500">
                      Đang tổng hợp lương KPI 3P toàn nhà máy...
                    </div>
                  ) : (
                    <table className="w-full min-w-[1260px] border-separate border-spacing-0 text-left text-xs">
                      <thead className="sticky top-0 z-20 bg-slate-50 text-[11px] font-bold uppercase text-slate-600">
                        <tr>
                          <th className="sticky left-0 z-30 min-w-[230px] border-b border-r border-slate-200 bg-slate-50 px-3 py-2.5 shadow-[2px_0_5px_-2px_rgba(15,23,42,0.08)]">
                            Nhân Sự &amp; Chế Độ
                          </th>
                          <th className="border-b border-slate-200 bg-slate-50 px-2.5 py-2.5 text-right">
                            Lương CB 8h
                          </th>
                          <th className="border-b border-slate-200 bg-slate-50 px-2.5 py-2.5 text-center">
                            Công / OT
                          </th>
                          <th className="border-b border-slate-200 bg-slate-50 px-2.5 py-2.5 text-center">
                            Giờ ĐM SP
                          </th>
                          <th className="border-b border-slate-200 bg-slate-100/80 px-2.5 py-2.5 text-right text-slate-800">
                            P1: Vị Trí/Phép
                          </th>
                          <th className="border-b border-slate-200 bg-blue-50/70 px-2.5 py-2.5 text-right text-blue-700" title="Chuyên cần VICO: Loại A = 250k (đủ công hoặc nghỉ ≤ 0.5 ngày), Loại B = 200k (nghỉ 1 ngày), Quá 1 ngày = 0đ">
                            P2: Thưởng {`A/B`}
                          </th>
                          <th className="border-b border-slate-200 bg-blue-50/70 px-2.5 py-2.5 text-right text-indigo-700">
                            P3: Khoán/Vượt ĐM
                          </th>
                          <th className="border-b border-slate-200 bg-slate-50 px-2.5 py-2.5 text-right text-emerald-700">
                            Ăn Ca
                          </th>
                          <th className="border-b border-slate-200 bg-slate-50 px-2.5 py-2.5 text-right text-rose-700">
                            Trừ NG
                          </th>
                          <th className="border-b border-slate-200 bg-emerald-50/80 px-3 py-2.5 text-right text-emerald-800">
                            Thực Lĩnh Cuối Tháng
                          </th>
                          <th className="border-b border-slate-200 bg-slate-50 px-3 py-2.5">
                            Diễn Giải
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white">
                        {payrollRows.map((r) => (
                          <tr key={r.workerId} className="group transition-colors hover:bg-blue-50">
                            <td className="sticky left-0 z-10 border-b border-r border-slate-200 bg-white px-3 py-2.5 shadow-[2px_0_5px_-2px_rgba(15,23,42,0.08)] group-hover:bg-blue-50">
                              <div className="font-bold text-slate-900">
                                {r.name}{' '}
                                <span className="font-mono-num text-[11px] font-semibold text-blue-700">
                                  ({r.workerId})
                                </span>
                              </div>
                              <div className="mt-0.5 flex items-center gap-1.5 text-[11px]">
                                <Badge
                                  variant={
                                    r.salaryMode.includes('Hành chính') ? 'info' : 'neutral'
                                  }
                                >
                                  {r.salaryMode}
                                </Badge>
                                <Badge
                                  variant={
                                    r.grade === 'A'
                                      ? 'success'
                                      : r.grade === 'B'
                                        ? 'warning'
                                        : 'danger'
                                  }
                                >
                                  Hạng {r.grade}
                                </Badge>
                              </div>
                            </td>

                            <td className="font-mono-num border-b border-slate-200 px-2.5 py-2.5 text-right text-slate-700">
                              {formatVnd(r.baseSalary)}
                            </td>

                            <td className="font-mono-num border-b border-slate-200 px-2.5 py-2.5 text-center">
                              <div className="font-bold text-slate-900">{r.regDays} công</div>
                              <div className="text-[11px] font-semibold text-blue-700">
                                +{r.totalOt}h OT
                              </div>
                            </td>

                            <td className="font-mono-num border-b border-slate-200 px-2.5 py-2.5 text-center">
                              <div className="font-bold text-indigo-700">{r.earnedStdHours}h</div>
                              <div className="text-[11px] text-slate-500">
                                {r.pieceworkLogCount} phiếu
                              </div>
                            </td>

                            <td className="font-mono-num border-b border-slate-200 bg-slate-50/70 px-2.5 py-2.5 text-right font-semibold text-slate-800 group-hover:bg-blue-50">
                              {formatVnd(r.p1PositionPay)}
                            </td>
                            <td className="font-mono-num border-b border-slate-200 bg-blue-50/60 px-2.5 py-2.5 text-right font-semibold text-blue-700 group-hover:bg-blue-50">
                              {formatVnd(r.p2PersonBonus)}
                            </td>
                            <td className="font-mono-num border-b border-slate-200 bg-blue-50/60 px-2.5 py-2.5 text-right font-bold text-indigo-700 group-hover:bg-blue-50">
                              {formatVnd(r.p3PerformancePay)}
                            </td>
                            <td className="font-mono-num border-b border-slate-200 px-2.5 py-2.5 text-right font-semibold text-emerald-700">
                              {formatVnd(r.mealAllowance)}
                            </td>
                            <td className="font-mono-num border-b border-slate-200 px-2.5 py-2.5 text-right font-semibold text-rose-700">
                              {r.scrapPenalty > 0 ? `-${formatVnd(r.scrapPenalty)}` : '0 đ'}
                            </td>
                            <td className="font-mono-num border-b border-slate-200 bg-emerald-50/60 px-3 py-2.5 text-right text-sm font-black text-emerald-700 group-hover:bg-blue-50">
                              {formatVnd(r.netPay)}
                            </td>
                            <td className="border-b border-slate-200 px-3 py-2.5 text-[11px] text-slate-600">
                              {r.note}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </Card>
            </>
          )}
        </div>
      )}
    </div>
  );
}
