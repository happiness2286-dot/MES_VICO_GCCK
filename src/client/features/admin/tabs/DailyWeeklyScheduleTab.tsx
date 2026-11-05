import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  Calendar,
  CalendarCheck2,
  CalendarClock,
  CalendarPlus,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Copy,
  Download,
  ExternalLink,
  Factory,
  FileSpreadsheet,
  FileText,
  Filter,
  Flame,
  FolderOpen,
  Layers,
  MessageSquare,
  Plus,
  Printer,
  RefreshCw,
  Save,
  Search,
  Share2,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  TrendingUp,
  Truck,
  UserPlus,
  Users,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import type { DailyPlanRow, WeeklyReportData } from '@shared/types';
import { apiClient } from '@client/lib/apiClient';
import { formatDateVn, formatNumber, formatVnd } from '@client/lib/formatters';
import { downloadDailyScheduleExcel } from '@client/lib/excelService';
import { navigateTo } from '@client/lib/navigation';
import {
  Badge,
  Button,
  Card,
  Modal,
  useToast,
} from '@client/components/ui/IndustrialPrimitives';
import { getFallbackBootstrap, rotateDailyPlanWeek, getFallbackDailyPlan, saveFallbackDailyPlan, mergePlanWithBaseline, calculateOpStandardPlanQty } from '@client/lib/clientFallbackStore';
import {
  isSupabaseConnected,
  pushDailyPlanToSupabase,
  fetchDailyPlanFromSupabase,
  fetchDailyDatesFromSupabase,
  deleteDailyPlanFromSupabase,
} from '@client/lib/supabaseClient';
import { DEFAULT_DRIVE_FOLDER_URL } from '@shared/driveHelper';
import { DailyQualityReportSection } from './DailyQualityReportSection';
import type { AdminTabCommonProps } from '../types';

export const SCHEDULE_NOTE_PRESETS = [
  'Máy chính',
  'Ghép 2 máy (+0.33)',
  '🔥 Tăng ca 2h (14:00 - 16:00)',
  '🔥 Tăng ca 2h (22:00 - 24:00)',
  'Thợ luân chuyển Ca 1 & Ca 2 theo điều động xưởng',
  'Chuyên máy Phay CNC 1',
  'Chuyên máy Phay CNC 2',
  'Ghép 2 máy (+0.33) - Cắt dây tự động 24/24',
  'Ca đêm Lights-out - Chu kỳ dài',
  'Định biên cố định Ca 2',
  'Trưởng ca - Chỉ đạo sản xuất',
];

export const FRACTIONAL_QTY_PRESETS = [
  { label: '0.25 ca (¼)', shortLabel: '¼', val: 0.25, title: '0.25 ca (¼ ca) - Phôi dài / Chu kỳ nhiều ca' },
  { label: '0.5 ca (½)', shortLabel: '½', val: 0.5, title: '0.5 ca (½ ca) - Bán thành phẩm nửa ca' },
  { label: '0.75 ca (¾)', shortLabel: '¾', val: 0.75, title: '0.75 ca (¾ ca) - Sắp hoàn thành nguyên công' },
  { label: '1.0 (Xong)', shortLabel: '1.0', val: 1.0, title: '1.0 ca / SP hoàn thành trong ca' },
];

export function formatPlannedQtyDisplay(qty: number): string {
  if (qty === 0.25) return '0.25 (¼ ca)';
  if (qty === 0.5) return '0.5 (½ ca)';
  if (qty === 0.75) return '0.75 (¾ ca)';
  if (qty === 0.33) return '0.33 (⅓ ca)';
  return String(qty);
}

function PlannedQtyCell({
  value,
  stdQty,
  onChange,
}: {
  value: number;
  stdQty?: number;
  onChange: (val: number) => void;
}) {
  const [text, setText] = useState<string>(String(value ?? 0));
  const [showDropdown, setShowDropdown] = useState(false);

  useEffect(() => {
    setText(String(value ?? 0));
  }, [value]);

  const commitValue = (valStr: string) => {
    const cleaned = valStr.replace(',', '.').trim();
    const num = Number(cleaned);
    if (!isNaN(num) && num >= 0) {
      const rounded = Number(num.toFixed(2));
      onChange(rounded);
      setText(String(rounded));
    } else {
      setText(String(value ?? 0));
    }
  };

  const handleBlur = () => {
    commitValue(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
    }
  };

  return (
    <div className="flex flex-col items-center gap-1 py-1">
      <div className="relative flex items-center justify-center">
        <input
          type="text"
          inputMode="decimal"
          value={text}
          onChange={(e) => {
            const raw = e.target.value;
            setText(raw);
            const cleaned = raw.replace(',', '.').trim();
            const num = Number(cleaned);
            if (!isNaN(num) && num >= 0 && raw !== '' && !raw.endsWith('.') && !raw.endsWith(',')) {
              onChange(num);
            }
          }}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          className="font-mono-num h-7 w-16 rounded border border-slate-300 bg-white px-1 text-center text-xs font-black text-blue-700 shadow-2xs focus:border-blue-600 focus:bg-blue-50/20 focus:outline-none"
          title="Nhập số lượng KH (hỗ trợ số lẻ 0.25, 0.5, 0.75, 1...)"
        />
        <button
          type="button"
          onClick={() => setShowDropdown((v) => !v)}
          className="ml-0.5 flex h-7 w-4.5 items-center justify-center rounded border border-slate-300 bg-slate-50 text-slate-500 hover:bg-slate-100 hover:text-blue-700"
          title="Bấm để chọn nhanh các mức phân đoạn ca hoặc sản lượng mẫu"
        >
          <ChevronDown className="h-3 w-3" />
        </button>

        {value > 0 && value < 1 && (
          <span className="pointer-events-none absolute -top-2 left-0 rounded-full bg-emerald-600 px-1 py-0.2 text-[9px] font-black text-white shadow-2xs">
            {value === 0.25 ? '¼' : value === 0.5 ? '½' : value === 0.75 ? '¾' : value === 0.33 ? '⅓' : String(value)}
          </span>
        )}

        {showDropdown && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setShowDropdown(false)}
            />
            <div className="absolute top-8 left-0 z-50 max-h-64 w-52 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 text-left shadow-xl">
              {stdQty !== undefined && stdQty > 0 && (
                <>
                  <div className="px-2 py-1 text-[10px] font-black text-blue-700 uppercase tracking-wider">
                    ⚡ Định mức công đoạn chuẩn
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(stdQty);
                      setText(String(stdQty));
                      setShowDropdown(false);
                    }}
                    className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-xs font-black transition-colors ${
                      Number(value) === Number(stdQty)
                        ? 'bg-blue-600 text-white'
                        : 'bg-blue-50 text-blue-800 hover:bg-blue-100'
                    }`}
                  >
                    <span>⚡ Chuẩn định mức: {stdQty} SP</span>
                    <span className="font-mono text-[11px] opacity-90">{stdQty}</span>
                  </button>
                  <div className="my-1 border-t border-slate-200" />
                </>
              )}
              <div className="px-2 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Phân đoạn ca (&lt; 1)
              </div>
              {FRACTIONAL_QTY_PRESETS.map((p) => (
                <button
                  key={p.val}
                  type="button"
                  onClick={() => {
                    onChange(p.val);
                    setText(String(p.val));
                    setShowDropdown(false);
                  }}
                  className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-xs font-bold transition-colors ${
                    value === p.val
                      ? 'bg-emerald-600 text-white'
                      : 'text-emerald-800 hover:bg-emerald-50'
                  }`}
                >
                  <span>{p.label}</span>
                  <span className="font-mono text-[11px] opacity-80">{p.val}</span>
                </button>
              ))}
              <div className="my-1 border-t border-slate-100" />
              <div className="px-2 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Số lượng chi tiết
              </div>
              {[2, 4, 6, 7, 8, 10, 12, 14, 15, 16, 18, 40].map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => {
                    onChange(num);
                    setText(String(num));
                    setShowDropdown(false);
                  }}
                  className={`flex w-full items-center justify-between rounded px-2 py-1 text-xs font-bold transition-colors ${
                    value === num
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-700 hover:bg-blue-50 hover:text-blue-700'
                  }`}
                >
                  <span>{num} chi tiết</span>
                  <span className="font-mono text-[11px] opacity-80">{num}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="flex items-center gap-0.5">
        {FRACTIONAL_QTY_PRESETS.map((preset) => {
          const isActive = Number(value) === preset.val;
          return (
            <button
              key={preset.val}
              type="button"
              onClick={() => {
                onChange(preset.val);
                setText(String(preset.val));
              }}
              title={preset.title}
              className={`rounded px-1.5 py-0.5 text-[9px] font-mono font-bold transition-all shadow-2xs ${
                isActive
                  ? 'bg-emerald-600 text-white ring-1 ring-emerald-500 font-black'
                  : 'border border-slate-200 bg-slate-50 text-slate-700 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800'
              }`}
            >
              {preset.shortLabel}
            </button>
          );
        })}
      </div>

      {stdQty !== undefined && stdQty > 0 && (
        <button
          type="button"
          onClick={() => {
            onChange(stdQty);
            setText(String(stdQty));
          }}
          title={`Bấm để chọn định mức công đoạn chuẩn: ${stdQty} SP`}
          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-black transition-all ${
            Number(value) === Number(stdQty)
              ? 'border border-blue-300 bg-blue-50 text-blue-800'
              : 'border border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 hover:border-amber-400 cursor-pointer shadow-2xs'
          }`}
        >
          <span>⚡ ĐM:</span>
          <span className="font-mono font-bold">{stdQty}</span>
        </button>
      )}
    </div>
  );
}

interface DailyDateMeta {
  workDate: string;
  rowCount: number;
  workerCount: number;
}

export function DailyWeeklyScheduleTab({
  bootstrap: rawBootstrap,
  onRefreshBootstrap,
  onNavigateTab,
  deepLink,
}: AdminTabCommonProps) {
  const bootstrap = rawBootstrap || getFallbackBootstrap();
  const toast = useToast();
  const [subTab, setSubTabState] = useState<'daily' | 'weekly' | 'daily_report'>(() => {
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search);
      const st = p.get('subtab') || p.get('subTab');
      if (st === 'daily_report' || st === 'report' || st === 'quality' || st === 'bm0403') return 'daily_report';
      if (st === 'weekly') return 'weekly';
    }
    return 'daily';
  });

  const setSubTab = (tab: 'daily' | 'weekly' | 'daily_report') => {
    setSubTabState(tab);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('subtab', tab);
      window.history.replaceState({}, '', url.toString());
    } catch (_) {}
  };

  // ==================== TAB 1: DAILY SCHEDULE STATE ====================
  const getVietnamToday = () =>
    new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });

  const getInitialPlanDate = () => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('GCCK_SELECTED_PLAN_DATE');
        if (saved && /^\d{4}-\d{2}-\d{2}$/.test(saved)) {
          return saved;
        }
      } catch {}
    }
    return getVietnamToday();
  };

  const [selectedDate, setSelectedDateState] = useState<string>(getInitialPlanDate);

  const setSelectedDate = (d: string) => {
    setSelectedDateState(d);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('GCCK_SELECTED_PLAN_DATE', d);
      } catch {}
    }
  };
  const [selectedShift, setSelectedShift] = useState<string>('ALL');
  const [searchFilter, setSearchFilter] = useState<string>(() => {
    try {
      const focus = localStorage.getItem('GCCK_ADMIN_SCHEDULE_WORKER_FOCUS');
      if (focus) {
        localStorage.removeItem('GCCK_ADMIN_SCHEDULE_WORKER_FOCUS');
        return focus;
      }
    } catch {
      // ignore
    }
    return deepLink?.dailyScheduleSearch || '';
  });

  useEffect(() => {
    try {
      const focus = localStorage.getItem('GCCK_ADMIN_SCHEDULE_WORKER_FOCUS');
      if (focus) {
        setSearchFilter(focus);
        localStorage.removeItem('GCCK_ADMIN_SCHEDULE_WORKER_FOCUS');
      }
    } catch {
      // ignore
    }
    if (deepLink?.dailyScheduleSearch) {
      setSearchFilter(deepLink.dailyScheduleSearch);
    }
  }, [deepLink?.dailyScheduleSearch]);
  const [dailyRows, setDailyRows] = useState<DailyPlanRow[]>([]);
  const [availableDates, setAvailableDates] = useState<DailyDateMeta[]>([]);
  const [loadingDates, setLoadingDates] = useState<boolean>(false);
  const [loadingDaily, setLoadingDaily] = useState<boolean>(false);
  const [savingDaily, setSavingDaily] = useState<boolean>(false);

  // Modals state
  const [showNewDateModal, setShowNewDateModal] = useState<boolean>(false);
  const [newPlanDate, setNewPlanDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [newPlanMode, setNewPlanMode] = useState<'copy' | 'template' | 'blank'>('copy');
  const [sourceCopyDate, setSourceCopyDate] = useState<string>(() => getVietnamToday());
  const [copyResetQty, setCopyResetQty] = useState<boolean>(false);
  const [creatingDate, setCreatingDate] = useState<boolean>(false);

  const [showCopyModal, setShowCopyModal] = useState<boolean>(false);
  const [copyTargetDate, setCopyTargetDate] = useState<string>(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().slice(0, 10);
  });
  const [copyTargetResetQty, setCopyTargetResetQty] = useState<boolean>(false);

  const [exportingExcel, setExportingExcel] = useState<boolean>(false);
  const [showShareModal, setShowShareModal] = useState<boolean>(false);
  const [shareText, setShareText] = useState<string>('');

  const [showAddWorkerModal, setShowAddWorkerModal] = useState<boolean>(false);
  const [newWorkerName, setNewWorkerName] = useState<string>('');
  const [newWorkerShift, setNewWorkerShift] = useState<string>('Ca 2');
  const [newWorkerLineCount, setNewWorkerLineCount] = useState<number>(3);

  // Load Daily Rows for selectedDate
  const loadDailyRows = async (date: string) => {
    setLoadingDaily(true);
    try {
      // 1. Try Supabase cloud first (seamless multi-device sync between PC & Mobile)
      if (isSupabaseConnected()) {
        try {
          const sbRows = await fetchDailyPlanFromSupabase(date);
          if (sbRows && sbRows.length > 0) {
            setDailyRows(sbRows);
            saveFallbackDailyPlan(date, sbRows);
            return;
          }
        } catch (e) {
          console.warn('Supabase fetch error in loadDailyRows:', e);
        }
      }

      const res = await apiClient.get<{ success: boolean; rows: DailyPlanRow[] }>(
        `/schedules/daily?date=${encodeURIComponent(date)}`
      );
      if (res.rows && res.rows.length > 0) {
        const completeRows = mergePlanWithBaseline(res.rows, date);
        setDailyRows(completeRows);
        saveFallbackDailyPlan(date, completeRows);
        // Auto-seed Supabase Cloud from local if Supabase is connected
        if (isSupabaseConnected()) {
          void pushDailyPlanToSupabase(date, completeRows);
        }
      } else {
        const fallback = getFallbackDailyPlan(date);
        if (fallback && fallback.length > 0) {
          setDailyRows(fallback);
          // Auto-seed Supabase Cloud from local fallback if Supabase is connected
          if (isSupabaseConnected()) {
            void pushDailyPlanToSupabase(date, fallback);
          }
        } else {
          // Generate blank 3-rows template for the 13 active workers if completely empty
          const activeWorkers = (bootstrap.workers || []).filter((w) => w.isActive !== 0);
          const blankRows: DailyPlanRow[] = [];
          let stt = 1;
          for (const w of activeWorkers) {
            for (let i = 0; i < 3; i++) {
              blankRows.push({
                workDate: date,
                shiftType: 'Ca 2',
                stt: stt++,
                workerName: w.name,
                customer: '',
                productName: '',
                opName: '',
                plannedQty: 0,
                machineName: '',
                note: '',
                actualQty: 0,
                status: 'PLANNED',
              });
            }
          }
          setDailyRows(blankRows);
        }
      }
    } catch (err: any) {
      toast.error(err?.message || 'Không thể tải kế hoạch ngày.');
    } finally {
      setLoadingDaily(false);
    }
  };

  useEffect(() => {
    void loadDailyRows(selectedDate);
  }, [selectedDate]);

  // Load list of dates that have daily schedules
  const loadAvailableDates = async () => {
    setLoadingDates(true);
    try {
      let cloudDates: DailyDateMeta[] = [];
      if (isSupabaseConnected()) {
        try {
          const sbDates = await fetchDailyDatesFromSupabase();
          if (sbDates && sbDates.length > 0) {
            cloudDates = sbDates;
          }
        } catch (e) {
          console.warn('Supabase fetch dates error:', e);
        }
      }

      const res = await apiClient.get<{ success: boolean; dates: DailyDateMeta[] }>(
        '/schedules/daily-dates'
      );
      const mergedMap = new Map<string, DailyDateMeta>();
      for (const d of cloudDates) mergedMap.set(d.workDate, d);
      for (const d of (res.dates || [])) {
        if (!mergedMap.has(d.workDate)) mergedMap.set(d.workDate, d);
      }
      const combined = Array.from(mergedMap.values()).sort((a, b) => b.workDate.localeCompare(a.workDate));
      if (combined.length > 0) {
        setAvailableDates(combined);
        if (!sourceCopyDate) {
          setSourceCopyDate(combined[0].workDate);
        }
      }
    } catch (err) {
      console.error('Failed to load available dates', err);
    } finally {
      setLoadingDates(false);
    }
  };

  useEffect(() => {
    void loadAvailableDates();
  }, []);

  // Check if current selectedDate is already persisted in DB
  const currentDateMeta = useMemo(() => {
    return availableDates.find((d) => d.workDate === selectedDate);
  }, [availableDates, selectedDate]);

  // Shift date helper (-1 day, +1 day)
  const changeDateByDays = (days: number) => {
    const parts = (selectedDate || '').split('-');
    if (parts.length !== 3) return;
    const cur = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    cur.setDate(cur.getDate() + days);
    const yr = cur.getFullYear();
    const mo = String(cur.getMonth() + 1).padStart(2, '0');
    const da = String(cur.getDate()).padStart(2, '0');
    setSelectedDate(`${yr}-${mo}-${da}`);
  };

  // Distinct Customers, Products, Machines for Cascade Selectors
  const customerList = useMemo(() => {
    const set = new Set<string>();
    for (const p of bootstrap.products) {
      if (p.customer) set.add(p.customer);
    }
    for (const po of bootstrap.ordersList) {
      if (po.customer) set.add(po.customer);
    }
    return Array.from(set).sort();
  }, [bootstrap.products, bootstrap.ordersList]);

  const machineList = useMemo(() => {
    return bootstrap.machines.map((m) => m.name);
  }, [bootstrap.machines]);

  // Handle row field change
  const handleRowChange = (index: number, field: keyof DailyPlanRow, value: any) => {
    setDailyRows((prev) => {
      const updated = [...prev];
      const cur = { ...updated[index], [field]: value };

      // Cascade logic: if customer changes, reset product, op and plannedQty
      if (field === 'customer') {
        cur.productName = '';
        cur.opName = '';
        cur.spId = '';
        cur.ncId = '';
        cur.plannedQty = 0;
      }
      // If product changes, auto fill spId and customer if empty, and auto-select op and plannedQty by standard norm
      if (field === 'productName') {
        const prod = bootstrap.products.find((p) => p.productName === value);
        if (prod) {
          cur.spId = prod.spId;
          if (!cur.customer) cur.customer = prod.customer;
        }

        // Auto find operations for this product
        const opsForProd = bootstrap.operations.filter(
          (o) => (cur.spId && o.spId === cur.spId) || o.productName === value
        );
        if (opsForProd.length > 0) {
          // Auto select first operation
          const targetOp = opsForProd[0];
          cur.opName = targetOp.opName;
          cur.ncId = targetOp.ncId;
          if (!cur.machineName && targetOp.defaultMachine) {
            cur.machineName = targetOp.defaultMachine;
          }
          // Ưu tiên lấy theo định mức công đoạn
          cur.plannedQty = calculateOpStandardPlanQty(targetOp);
        } else {
          cur.opName = '';
          cur.ncId = '';
          cur.plannedQty = 0;
        }
      }
      // If opName changes, auto fill ncId, default machine, and priority plannedQty by standard norm
      if (field === 'opName') {
        const op = bootstrap.operations.find(
          (o) => o.opName === value && (!cur.spId || o.spId === cur.spId)
        );
        if (op) {
          cur.ncId = op.ncId;
          if (!cur.machineName && op.defaultMachine) {
            cur.machineName = op.defaultMachine;
          }
          // Ưu tiên lấy theo định mức công đoạn
          cur.plannedQty = calculateOpStandardPlanQty(op);
        }
      }

      updated[index] = cur;
      return updated;
    });
  };

  // Add extra row for a worker with smart note defaults
  const handleAddWorkerRow = (workerName: string, shiftType: string) => {
    const existingCount = dailyRows.filter((r) => r.workerName === workerName).length;
    let defaultNote = 'Máy chính';
    if (existingCount === 1) defaultNote = 'Ghép 2 máy (+0.33)';
    else if (existingCount >= 2) defaultNote = '🔥 Tăng ca 2h (14:00 - 16:00)';

    setDailyRows((prev) => [
      ...prev,
      {
        workDate: selectedDate,
        shiftType: shiftType || 'Ca 2',
        stt: prev.length + 1,
        workerName,
        customer: '',
        productName: '',
        opName: '',
        plannedQty: 0,
        machineName: '',
        note: defaultNote,
        isOvertime: defaultNote.includes('Tăng ca'),
        overtimeHours: defaultNote.includes('Tăng ca') ? 2 : undefined,
        actualQty: 0,
        status: 'PLANNED',
      },
    ]);
  };

  // Delete row
  const handleDeleteRow = (index: number) => {
    setDailyRows((prev) => prev.filter((_, idx) => idx !== index));
  };

  // Save Daily Schedule
  const handleSaveDailySchedule = async () => {
    setSavingDaily(true);
    try {
      await apiClient.post('/schedules/daily', {
        workDate: selectedDate,
        rows: dailyRows,
      });
      if (isSupabaseConnected()) {
        const pushed = await pushDailyPlanToSupabase(selectedDate, dailyRows);
        if (pushed) {
          toast.success(`Đã lưu ${dailyRows.length} dòng và đồng bộ tức thì lên Supabase Cloud cho điện thoại công nhân!`);
        } else {
          toast.warning(`Đã lưu thành công ${dailyRows.length} dòng vào bộ nhớ máy.`);
        }
      } else {
        toast.success(`Đã lưu thành công ${dailyRows.length} dòng kế hoạch ngày ${selectedDate}!`);
      }
      await loadAvailableDates();
      await onRefreshBootstrap();
    } catch (err: any) {
      toast.error(err?.message || 'Không thể lưu kế hoạch ngày.');
    } finally {
      setSavingDaily(false);
    }
  };

  // Create a new date plan
  const handleCreateNewPlan = async () => {
    if (!newPlanDate) {
      toast.warning('Vui lòng chọn ngày kế hoạch.');
      return;
    }
    setCreatingDate(true);
    try {
      if (newPlanMode === 'copy') {
        let sourceRows = sourceCopyDate === selectedDate ? dailyRows : getFallbackDailyPlan(sourceCopyDate);
        if (isSupabaseConnected() && (!sourceRows || sourceRows.length === 0)) {
          const sb = await fetchDailyPlanFromSupabase(sourceCopyDate);
          if (sb && sb.length > 0) sourceRows = sb;
        }
        if (!sourceRows || sourceRows.length === 0) {
          toast.warning(`Không tìm thấy dữ liệu kế hoạch ngày nguồn: ${formatDateVn(sourceCopyDate)}`);
          return;
        }
        const targetRows: DailyPlanRow[] = sourceRows.map((r, idx) => ({
          ...r,
          id: undefined,
          workDate: newPlanDate,
          plannedQty: copyResetQty ? 0 : Number(r.plannedQty) || 0,
          actualQty: 0,
          stt: idx + 1,
          status: 'PLANNED',
        }));
        saveFallbackDailyPlan(newPlanDate, targetRows);
        try {
          await apiClient.post('/schedules/daily', {
            workDate: newPlanDate,
            rows: targetRows,
          });
        } catch (apiErr) {
          console.warn('API save schedule warning:', apiErr);
        }
        if (isSupabaseConnected()) {
          await pushDailyPlanToSupabase(newPlanDate, targetRows);
        }
        toast.success(
          `Đã sao chép thành công ${targetRows.length} dòng từ ngày ${formatDateVn(sourceCopyDate)} sang ngày ${formatDateVn(newPlanDate)} và đồng bộ Cloud!`
        );
        await loadAvailableDates();
        setShowNewDateModal(false);
        setSelectedDate(newPlanDate);
        setDailyRows(targetRows);
        return;
      } else if (newPlanMode === 'template') {
        const activeWorkers = (bootstrap.workers || []).filter((w) => w.isActive !== 0);
        const blankRows: DailyPlanRow[] = [];
        let stt = 1;
        for (const w of activeWorkers) {
          for (let i = 0; i < 3; i++) {
            blankRows.push({
              workDate: newPlanDate,
              shiftType: 'Ca 2',
              stt: stt++,
              workerName: w.name,
              customer: '',
              productName: '',
              opName: '',
              plannedQty: 0,
              machineName: '',
              note: '',
              actualQty: 0,
              status: 'PLANNED',
            });
          }
        }
        saveFallbackDailyPlan(newPlanDate, blankRows);
        try {
          await apiClient.post('/schedules/daily', {
            workDate: newPlanDate,
            rows: blankRows,
          });
        } catch (apiErr) {
          console.warn('API save schedule warning:', apiErr);
        }
        if (isSupabaseConnected()) {
          await pushDailyPlanToSupabase(newPlanDate, blankRows);
        }
        toast.success(`Đã khởi tạo khung kế hoạch ngày ${newPlanDate} cho ${activeWorkers.length} thợ!`);
        await loadAvailableDates();
        setShowNewDateModal(false);
        setSelectedDate(newPlanDate);
        setDailyRows(blankRows);
        return;
      } else {
        // blank mode
        saveFallbackDailyPlan(newPlanDate, []);
        try {
          await apiClient.post('/schedules/daily', {
            workDate: newPlanDate,
            rows: [],
          });
        } catch (apiErr) {
          console.warn('API save schedule warning:', apiErr);
        }
        if (isSupabaseConnected()) {
          await pushDailyPlanToSupabase(newPlanDate, []);
        }
        toast.success(`Đã tạo bảng kế hoạch trắng cho ngày ${newPlanDate}!`);
        await loadAvailableDates();
        setShowNewDateModal(false);
        setSelectedDate(newPlanDate);
        setDailyRows([]);
        return;
      }
    } catch (err: any) {
      toast.error(err?.message || 'Không thể tạo kế hoạch ngày mới.');
    } finally {
      setCreatingDate(false);
    }
  };

  // Quick clone current date schedule to another date
  const handleCopyCurrentSchedule = async () => {
    if (!copyTargetDate) {
      toast.warning('Vui lòng chọn ngày đích để sao chép.');
      return;
    }
    if (copyTargetDate === selectedDate) {
      toast.warning('Ngày đích phải khác ngày hiện tại.');
      return;
    }
    setCreatingDate(true);
    try {
      // 1. Source rows from current screen or local store
      let sourceRows = dailyRows;
      if (!sourceRows || sourceRows.length === 0) {
        sourceRows = getFallbackDailyPlan(selectedDate);
      }
      if (!sourceRows || sourceRows.length === 0) {
        toast.warning(`Không tìm thấy dữ liệu kế hoạch ngày nguồn: ${formatDateVn(selectedDate)}`);
        return;
      }

      // 2. Map all rows to copyTargetDate with reset actuals & fresh stt
      const targetRows: DailyPlanRow[] = sourceRows.map((r, idx) => ({
        ...r,
        id: undefined,
        workDate: copyTargetDate,
        plannedQty: copyTargetResetQty ? 0 : Number(r.plannedQty) || 0,
        actualQty: 0,
        stt: idx + 1,
        status: 'PLANNED',
      }));

      // 3. Save to local fallback store immediately
      saveFallbackDailyPlan(copyTargetDate, targetRows);

      // 4. Save to API / SQLite backend if available
      try {
        await apiClient.post('/schedules/daily', {
          workDate: copyTargetDate,
          rows: targetRows,
        });
      } catch (apiErr) {
        console.warn('API save schedule warning:', apiErr);
      }

      // 5. CRITICAL: Atomic sync to Supabase Cloud so all devices & worker phones have the copied plan immediately
      if (isSupabaseConnected()) {
        await pushDailyPlanToSupabase(copyTargetDate, targetRows);
      }

      toast.success(
        `Đã sao chép thành công ${targetRows.length} dòng từ ngày ${formatDateVn(selectedDate)} sang ngày ${formatDateVn(copyTargetDate)} và đồng bộ CSDL Cloud!`
      );
      await loadAvailableDates();
      setShowCopyModal(false);
      setSelectedDate(copyTargetDate);
      setDailyRows(targetRows);
    } catch (err: any) {
      toast.error(err?.message || 'Không thể sao chép kế hoạch.');
    } finally {
      setCreatingDate(false);
    }
  };

  // Delete daily schedule for currently selected date
  const handleDeleteDailySchedule = async () => {
    if (!window.confirm(`Bạn có chắc chắn muốn xóa toàn bộ kế hoạch ngày ${selectedDate}? Dữ liệu sẽ bị xóa khỏi cơ sở dữ liệu.`)) {
      return;
    }
    try {
      await apiClient.delete(`/schedules/daily?date=${encodeURIComponent(selectedDate)}`);
      if (isSupabaseConnected()) {
        void deleteDailyPlanFromSupabase(selectedDate);
      }
      toast.success(`Đã xóa kế hoạch ngày ${selectedDate}!`);
      const updatedDates = availableDates.filter((d) => d.workDate !== selectedDate);
      setAvailableDates(updatedDates);
      if (updatedDates.length > 0) {
        setSelectedDate(updatedDates[0].workDate);
      } else {
        setSelectedDate(getVietnamToday());
      }
    } catch (err: any) {
      toast.error(err?.message || 'Không thể xóa kế hoạch ngày.');
    }
  };

  // Add a new worker into the plan
  const handleAddNewWorker = (workerName: string, shiftType: string, count: number) => {
    if (!workerName) {
      toast.warning('Vui lòng chọn thợ.');
      return;
    }
    const newRows: DailyPlanRow[] = [];
    let nextStt = dailyRows.length > 0 ? Math.max(...dailyRows.map((r) => r.stt || 0)) + 1 : 1;
    for (let i = 0; i < count; i++) {
      let defaultNote = 'Máy chính';
            if (i === 1) defaultNote = 'Ghép 2 máy (+0.33)';
            else if (i >= 2) defaultNote = '🔥 Tăng ca 2h (14:00 - 16:00)';
      newRows.push({
        workDate: selectedDate,
        shiftType: shiftType || 'Ca 2',
        stt: nextStt++,
        workerName,
        customer: '',
        productName: '',
        opName: '',
        plannedQty: 0,
        machineName: '',
        note: defaultNote,
        isOvertime: defaultNote.includes('Tăng ca'),
        overtimeHours: defaultNote.includes('Tăng ca') ? 2 : undefined,
        actualQty: 0,
        status: 'PLANNED',
      });
    }
    setDailyRows((prev) => [...prev, ...newRows]);
    toast.success(`Đã thêm thợ ${workerName} (${shiftType}) với ${count} dòng công việc! Bấm "Lưu Kế Hoạch" để lưu.`);
    setShowAddWorkerModal(false);
  };

  // Export Daily Plan to Excel Form VICO QT.01.BM01
  const handleExportExcel = async () => {
    if (dailyRows.length === 0) {
      toast.warning('Chưa có dữ liệu kế hoạch để xuất file Excel.');
      return;
    }
    setExportingExcel(true);
    try {
      await downloadDailyScheduleExcel(selectedDate, dailyRows);
      toast.success(`Đã xuất file Excel kế hoạch ngày ${formatDateVn(selectedDate)} thành công!`);
    } catch (err: any) {
      toast.error(err?.message || 'Không thể xuất file Excel.');
    } finally {
      setExportingExcel(false);
    }
  };

  // Generate clean Zalo group summary text
  const generateZaloSummary = () => {
    const [y, m, d] = (selectedDate || '').split('-');
    const displayDate = d && m && y ? `${d}/${m}/${y}` : selectedDate;

    let text = `📋 KẾ HOẠCH SẢN XUẤT NGÀY ${displayDate} (FORM VICO QT.01.BM01)\n`;
    text += `🏭 Công ty CP Cơ khí Chính xác Thắng Lợi\n`;
    text += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;

    const shifts = ['Ca 1', 'Ca 2', 'Ca 3', 'Ca Hành chính'];
    let totalTasks = 0;

    shifts.forEach((shift) => {
      const shiftRows = dailyRows.filter(
        (r) => r.shiftType === shift && (r.productName || Number(r.plannedQty) > 0)
      );
      if (shiftRows.length === 0) return;

      text += `\n⏰ 【${shift.toUpperCase()}】\n`;
      const workersMap = new Map<string, typeof dailyRows>();
      shiftRows.forEach((r) => {
        const list = workersMap.get(r.workerName) || [];
        list.push(r);
        workersMap.set(r.workerName, list);
      });

      workersMap.forEach((wRows, wName) => {
        text += `👷 ${wName}:\n`;
        wRows.forEach((r, idx) => {
          totalTasks++;
          const cust = r.customer ? `[${r.customer}] ` : '';
          const mach = r.machineName ? ` » ${r.machineName}` : '';
          const note = r.note ? ` (${r.note})` : '';
          text += `   ${idx + 1}. ${cust}${r.productName || 'Chi tiết'} - ${r.opName || 'Theo bản vẽ'} | SL: ${formatPlannedQtyDisplay(r.plannedQty)}${mach}${note}\n`;
        });
      });
    });

    text += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    text += `📊 Tổng số công việc phân công: ${totalTasks} việc\n`;
    text += `🕒 Cập nhật: ${new Date().toLocaleTimeString('vi-VN')} ngày ${displayDate}`;
    return text;
  };

  // Open modal to share to Zalo / group
  const handleOpenShareModal = () => {
    if (dailyRows.length === 0) {
      toast.warning('Chưa có dữ liệu kế hoạch để gửi nhóm.');
      return;
    }
    const txt = generateZaloSummary();
    setShareText(txt);
    setShowShareModal(true);
  };

  // Copy Zalo text to clipboard directly
  const handleCopyShareText = () => {
    if (!shareText.trim()) return;
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(shareText);
      toast.success('Đã sao chép nội dung tin nhắn! Bạn có thể dán (Ctrl+V) vào nhóm Zalo / Viber.');
    } else {
      toast.info('Vui lòng chọn bôi đen và nhấn Ctrl+C để sao chép.');
    }
  };

  // Filtered rows by shift and search query
  const filteredDailyRows = useMemo(() => {
    return dailyRows.filter((r) => {
      if (selectedShift !== 'ALL') {
        if (selectedShift === 'TĂNG CA') {
          if (!r.isOvertime && r.shiftType !== 'Tăng ca' && !(r.note && /tăng ca|ot/i.test(r.note))) return false;
        } else if (r.shiftType !== selectedShift) {
          return false;
        }
      }
      if (searchFilter.trim()) {
        const q = searchFilter.toLowerCase();
        const matches =
          (r.workerName || '').toLowerCase().includes(q) ||
          (r.customer || '').toLowerCase().includes(q) ||
          (r.productName || '').toLowerCase().includes(q) ||
          (r.opName || '').toLowerCase().includes(q) ||
          (r.machineName || '').toLowerCase().includes(q) ||
          (r.note || '').toLowerCase().includes(q);
        if (!matches) return false;
      }
      return true;
    });
  }, [dailyRows, selectedShift, searchFilter]);

  // Group filtered rows by worker
  const rowsByWorker = useMemo(() => {
    const map = new Map<string, Array<{ row: DailyPlanRow; originalIdx: number }>>();
    dailyRows.forEach((row, originalIdx) => {
      if (selectedShift !== 'ALL') {
        if (selectedShift === 'TĂNG CA') {
          if (!row.isOvertime && row.shiftType !== 'Tăng ca' && !(row.note && /tăng ca|ot/i.test(row.note))) return;
        } else if (row.shiftType !== selectedShift) {
          return;
        }
      }
      if (searchFilter.trim()) {
        const q = searchFilter.toLowerCase();
        const matches =
          (row.workerName || '').toLowerCase().includes(q) ||
          (row.customer || '').toLowerCase().includes(q) ||
          (row.productName || '').toLowerCase().includes(q) ||
          (row.opName || '').toLowerCase().includes(q) ||
          (row.machineName || '').toLowerCase().includes(q) ||
          (row.note || '').toLowerCase().includes(q);
        if (!matches) return;
      }
      const list = map.get(row.workerName) || [];
      list.push({ row, originalIdx });
      map.set(row.workerName, list);
    });
    return Array.from(map.entries());
  }, [dailyRows, selectedShift, searchFilter]);

  // Overtime statistics
  const totalOvertimeTasks = useMemo(() => {
    return dailyRows.filter(
      (r) => r.isOvertime || r.shiftType === 'Tăng ca' || (r.note && /tăng ca|ot/i.test(r.note))
    ).length;
  }, [dailyRows]);

  const totalOvertimeHours = useMemo(() => {
    return dailyRows.reduce((sum, r) => {
      if (r.isOvertime || r.shiftType === 'Tăng ca' || (r.note && /tăng ca|ot/i.test(r.note))) {
        return sum + (Number(r.overtimeHours) || 2);
      }
      return sum;
    }, 0);
  }, [dailyRows]);

  // ==================== TAB 2: WEEKLY REPORT STATE ====================
  const [weeklyStart, setWeeklyStart] = useState<string>('2026-10-15');
  const [weeklyReport, setWeeklyReport] = useState<WeeklyReportData | null>(null);
  const [loadingWeekly, setLoadingWeekly] = useState<boolean>(false);
  const [newIncidentMachine, setNewIncidentMachine] = useState<string>('');
  const [newIncidentStopMin, setNewIncidentStopMin] = useState<number>(30);
  const [newIncidentReason, setNewIncidentReason] = useState<string>('');
  const [newIncidentNote, setNewIncidentNote] = useState<string>('');
  const [addingIncident, setAddingIncident] = useState<boolean>(false);

  type WeeklyMetricFilter = 'ALL' | 'ACTUAL' | 'COMPLETED' | 'DELAYED';
  const [weeklyMetricFilter, setWeeklyMetricFilter] = useState<WeeklyMetricFilter>('ALL');
  const [selectedWeeklyCustomer, setSelectedWeeklyCustomer] = useState<string | null>(null);

  // Trạng thái Thu Lên / Trải Xuống cho cả 4 mục PO
  const [poListExpandedByMetric, setPoListExpandedByMetric] = useState<Record<WeeklyMetricFilter, boolean>>({
    ALL: true,
    ACTUAL: true,
    COMPLETED: true,
    DELAYED: true,
  });

  // Trạng thái Thu Lên / Trải Xuống cho Bảng Đối Tác Khách Hàng
  const [isCustomerTableExpanded, setIsCustomerTableExpanded] = useState<boolean>(true);

  const togglePoListExpanded = (metric: WeeklyMetricFilter) => {
    setPoListExpandedByMetric((prev) => ({
      ...prev,
      [metric]: !prev[metric],
    }));
  };

  const toggleAllPoMetrics = (expanded: boolean) => {
    setPoListExpandedByMetric({
      ALL: expanded,
      ACTUAL: expanded,
      COMPLETED: expanded,
      DELAYED: expanded,
    });
  };

  const filteredCustomerStats = useMemo(() => {
    if (!weeklyReport?.customerStats) return [];
    let list = weeklyReport.customerStats;
    if (weeklyMetricFilter === 'DELAYED') {
      list = list.filter((c) => c.completionPct < 100);
    } else if (weeklyMetricFilter === 'COMPLETED') {
      list = list.filter((c) => c.completionPct >= 100);
    } else if (weeklyMetricFilter === 'ACTUAL') {
      list = list.filter((c) => c.actualQty > 0);
    }
    if (selectedWeeklyCustomer) {
      list = list.filter((c) => c.customer === selectedWeeklyCustomer);
    }
    return list;
  }, [weeklyReport, weeklyMetricFilter, selectedWeeklyCustomer]);

  const filteredPoStatuses = useMemo(() => {
    if (!weeklyReport?.poStatuses) return [];
    let list = weeklyReport.poStatuses;
    if (weeklyMetricFilter === 'DELAYED') {
      list = list.filter(
        (po) =>
          po.isDelayed ||
          (po.qtyPo > po.finishedQty &&
            Boolean(po.dueDate && new Date(po.dueDate) <= new Date(weeklyReport.weekEnd)))
      );
    } else if (weeklyMetricFilter === 'COMPLETED') {
      list = list.filter((po) => po.finishedQty >= po.qtyPo);
    } else if (weeklyMetricFilter === 'ACTUAL') {
      list = list.filter((po) => po.finishedQty > 0 || po.wipQty > 0);
    }
    if (selectedWeeklyCustomer) {
      list = list.filter((po) => po.customer === selectedWeeklyCustomer);
    }
    return list;
  }, [weeklyReport, weeklyMetricFilter, selectedWeeklyCustomer]);

  const handleWeeklyPoToDailySchedule = (productOrPo: string) => {
    try {
      localStorage.setItem('GCCK_ADMIN_SCHEDULE_WORKER_FOCUS', productOrPo);
    } catch {}
    setSearchFilter(productOrPo);
    setSubTab('daily');
    toast.success(`Đã chuyển sang phân hệ Kế Hoạch Ngày để phân công thợ cho ${productOrPo}!`);
  };

  const handleWeeklyPoToOrders = (poId: string) => {
    try {
      localStorage.setItem('GCCK_ADMIN_ORDERS_PO_FOCUS', poId);
    } catch {}
    if (onNavigateTab) {
      onNavigateTab('orders', { ordersSearch: poId });
    } else {
      navigateTo(`/admin?tab=orders&ordersSearch=${encodeURIComponent(poId)}`);
    }
  };

  const loadWeeklyReport = async (wStart: string) => {
    setLoadingWeekly(true);
    try {
      const res = await apiClient.get<WeeklyReportData>(
        `/reports/weekly?weekStart=${encodeURIComponent(wStart)}`
      );
      setWeeklyReport(res);
    } catch (err: any) {
      toast.error(err?.message || 'Không thể tải báo cáo tuần.');
    } finally {
      setLoadingWeekly(false);
    }
  };

  useEffect(() => {
    if (subTab === 'weekly') {
      void loadWeeklyReport(weeklyStart);
    }
  }, [subTab, weeklyStart]);

  const handleAddIncidentNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newIncidentReason.trim()) {
      toast.warning('Vui lòng nhập nguyên nhân sự cố hoặc dừng máy.');
      return;
    }
    setAddingIncident(true);
    try {
      await apiClient.post('/reports/weekly/incidents', {
        weekStart: weeklyStart,
        machineName: newIncidentMachine,
        stopMinutes: newIncidentStopMin,
        reason: newIncidentReason,
        note: newIncidentNote,
      });
      toast.success('Đã thêm ghi nhận sự cố máy trong tuần.');
      setNewIncidentReason('');
      setNewIncidentNote('');
      void loadWeeklyReport(weeklyStart);
    } catch (err: any) {
      toast.error(err?.message || 'Không thể lưu ghi nhận sự cố.');
    } finally {
      setAddingIncident(false);
    }
  };

  // ==================== TAB 2 - KHỐI 5: CÁC ĐỀ XUẤT & KIẾN NGHỊ KHÁC ====================
  const [newPropCategory, setNewPropCategory] = useState<string>('Vật tư & Dụng cụ cắt');
  const [newPropProposer, setNewPropProposer] = useState<string>('');
  const [newPropContent, setNewPropContent] = useState<string>('');
  const [newPropPriority, setNewPropPriority] = useState<string>('Bình thường');
  const [addingProposal, setAddingProposal] = useState<boolean>(false);

  const handleAddProposal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPropContent.trim()) {
      toast.warning('Vui lòng nhập nội dung đề xuất hoặc kiến nghị.');
      return;
    }
    setAddingProposal(true);
    try {
      await apiClient.post('/reports/weekly/proposals', {
        weekStart: weeklyStart,
        category: newPropCategory,
        proposer: newPropProposer || 'Phân xưởng',
        content: newPropContent,
        priority: newPropPriority,
      });
      toast.success('Đã ghi nhận đề xuất / kiến nghị mới.');
      setNewPropContent('');
      void loadWeeklyReport(weeklyStart);
    } catch (err: any) {
      toast.error(err?.message || 'Không thể gửi đề xuất.');
    } finally {
      setAddingProposal(false);
    }
  };

  const handleDeleteProposal = async (id: number) => {
    if (!window.confirm('Bạn có chắc chắn muốn xóa đề xuất này?')) return;
    try {
      await apiClient.delete(`/reports/weekly/proposals/${id}`);
      toast.success('Đã xóa đề xuất.');
      void loadWeeklyReport(weeklyStart);
    } catch (err: any) {
      toast.error(err?.message || 'Không thể xóa đề xuất.');
    }
  };

  const handleToggleProposalStatus = async (id: number, currentStatus: string) => {
    const nextStatus = currentStatus === 'APPROVED' ? 'PENDING' : 'APPROVED';
    try {
      await apiClient.patch(`/reports/weekly/proposals/${id}`, { status: nextStatus });
      toast.success(`Đã cập nhật trạng thái: ${nextStatus === 'APPROVED' ? 'Đã duyệt' : 'Chờ duyệt'}`);
      void loadWeeklyReport(weeklyStart);
    } catch (err: any) {
      toast.error(err?.message || 'Không thể cập nhật trạng thái.');
    }
  };

  return (
    <div className="space-y-4">
      {/* Sub-tab Navigation Banner (hidden when printing any form) */}
      <div className="no-print rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap gap-1.5 rounded-xl bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => setSubTab('daily')}
            className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-bold transition-all ${
              subTab === 'daily'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <CalendarClock className="h-4 w-4" />
            <span>1. Kế Hoạch Sản Xuất Ngày (Form VICO QT.01.BM01)</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('weekly')}
            className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-bold transition-all ${
              subTab === 'weekly'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <CalendarCheck2 className="h-4 w-4" />
            <span>2. Báo Cáo Tuần (T5 → T4) &amp; Cân Bằng Tải</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('daily_report')}
            className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-bold transition-all ${
              subTab === 'daily_report'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <FileSpreadsheet className="h-4 w-4" />
            <span>3. Báo Cáo Ngày (Form BM.KTCN.04.03)</span>
          </button>
        </div>

        {subTab === 'daily' && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => {
                const todayStr = new Date().toISOString().slice(0, 10);
                setNewPlanDate(todayStr);
                setNewPlanMode('copy');
                if (availableDates.length > 0) {
                  setSourceCopyDate(availableDates[0].workDate);
                }
                setShowNewDateModal(true);
              }}
              className="bg-blue-600 font-bold text-white shadow-sm hover:bg-blue-700"
            >
              <CalendarPlus className="h-4 w-4" />
              + Thêm Kế Hoạch Ngày Mới
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                const tomorrow = new Date();
                tomorrow.setDate(tomorrow.getDate() + 1);
                setCopyTargetDate(tomorrow.toISOString().slice(0, 10));
                setShowCopyModal(true);
              }}
              className="font-bold text-slate-700 hover:text-slate-900"
            >
              <Copy className="h-4 w-4 text-indigo-600" />
              Sao Chép Kế Hoạch
            </Button>

            {/* Ô Xuất File Excel Gửi Nhóm */}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleExportExcel}
              disabled={exportingExcel}
              className="bg-emerald-50 text-emerald-800 border-emerald-300 font-bold hover:bg-emerald-100 shadow-sm"
              title="Xuất file Excel (.xlsx) Form VICO QT.01.BM01 để gửi nhóm"
            >
              <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
              {exportingExcel ? 'Đang xuất...' : 'Xuất File Excel'}
            </Button>

            {/* Ô Gửi Vào Hội Nhóm Zalo / Viber */}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleOpenShareModal}
              className="bg-blue-50 text-blue-800 border-blue-300 font-bold hover:bg-blue-100 shadow-sm"
              title="Mở giao diện sao chép nội dung & đính kèm gửi nhóm Zalo / Viber"
            >
              <Share2 className="h-4 w-4 text-blue-600" />
              Gửi Nhóm Zalo
            </Button>

            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => navigateTo(`/print/daily-schedule?date=${encodeURIComponent(selectedDate)}`)}
              className="font-bold text-slate-800"
            >
              <Printer className="h-4 w-4 text-blue-600" />
              🖨️ In Biểu Mẫu A4
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                if (onNavigateTab) {
                  onNavigateTab('logs_qc', { logsSubView: 'HANDOVER' });
                } else {
                  navigateTo('/admin?tab=logs_qc');
                }
              }}
              className="bg-amber-50 text-amber-900 border-amber-300 font-bold hover:bg-amber-100 shadow-sm"
              title="Chuyển đến Sổ Bàn Giao Công Đoạn (Biểu Mẫu BM.GC.01.02) để đối soát kế hoạch đạt hay không"
            >
              <Truck className="h-4 w-4 text-amber-600" />
              📋 Sổ Bàn Giao (BM.GC.01.02)
            </Button>
            {currentDateMeta && (
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={handleDeleteDailySchedule}
                className="font-bold"
                title="Xóa toàn bộ kế hoạch ngày này"
              >
                <Trash2 className="h-4 w-4" />
                Xóa Ngày
              </Button>
            )}
            {isSupabaseConnected() && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={async () => {
                  setSavingDaily(true);
                  try {
                    const pushed = await pushDailyPlanToSupabase(selectedDate, dailyRows);
                    if (pushed) {
                      toast.success(`Đã đồng bộ ${dailyRows.length} nhiệm vụ ngày ${selectedDate} lên Cloud! Điện thoại công nhân đã cập nhật.`);
                    } else {
                      toast.error('Lỗi khi gửi lên Supabase Cloud.');
                    }
                  } catch (e: any) {
                    toast.error(e?.message || 'Không thể đồng bộ Cloud.');
                  } finally {
                    setSavingDaily(false);
                  }
                }}
                disabled={savingDaily}
                className="font-bold text-sky-800 bg-sky-50 border-sky-300 hover:bg-sky-100 shadow-sm"
                title="Đồng bộ kế hoạch này lên Supabase Cloud để điện thoại công nhân nhận ngay lập tức"
              >
                <Share2 className="h-4 w-4 text-sky-600" />
                Đồng Bộ Cloud
              </Button>
            )}
            <Button
              type="button"
              variant="success"
              size="sm"
              onClick={handleSaveDailySchedule}
              disabled={savingDaily}
              className="font-bold shadow-sm"
            >
              <Save className="h-4 w-4" />
              {savingDaily ? 'Đang lưu...' : 'Lưu Kế Hoạch Ngày'}
            </Button>
          </div>
        )}

        {subTab === 'weekly' && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => navigateTo(`/print/weekly-report?weekStart=${encodeURIComponent(weeklyStart)}`)}
              className="font-bold text-slate-800 hover:bg-slate-100"
            >
              <Printer className="h-4 w-4 text-blue-600" />
              🖨️ In Biểu Mẫu Báo Cáo Tuần (A4)
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void loadWeeklyReport(weeklyStart)}
              className="font-bold text-slate-700"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Làm Mới
            </Button>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* SUB-TAB 1: KẾ HOẠCH SẢN XUẤT NGÀY (FORM VICO GCCK.QT.01.BM01)             */}
      {/* ========================================================================= */}
      {subTab === 'daily' && (
        <div className="space-y-4">
          {/* Controls Bar: Date Navigation, Switcher, Shift, Filters */}
          <Card className="border-slate-200 bg-white p-4">
            <div className="space-y-3">
              {/* Row 1: Date Navigation & Saved Dates Selector */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold text-slate-700">Ngày lập KH:</span>
                  
                  {/* Step Day Buttons */}
                  <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                    <button
                      type="button"
                      onClick={() => changeDateByDays(-1)}
                      className="rounded p-1 hover:bg-white hover:text-blue-600 text-slate-600"
                      title="Ngày hôm trước"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <input
                      type="date"
                      value={selectedDate}
                      onChange={(e) => setSelectedDate(e.target.value)}
                      className="border-0 bg-transparent px-2 text-xs font-extrabold text-slate-900 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => changeDateByDays(1)}
                      className="rounded p-1 hover:bg-white hover:text-blue-600 text-slate-600"
                      title="Ngày tiếp theo"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setSelectedDate(getVietnamToday());
                    }}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-bold text-slate-700 hover:bg-slate-100 hover:text-blue-600"
                  >
                    Hôm nay
                  </button>

                  {/* Quick Select Saved Dates */}
                  {availableDates.length > 0 && (
                    <div className="flex items-center gap-1.5 pl-2 border-l border-slate-200">
                      <span className="text-xs text-slate-500 font-semibold">Chọn ngày đã lưu:</span>
                      <select
                        value={availableDates.some((d) => d.workDate === selectedDate) ? selectedDate : ''}
                        onChange={(e) => {
                          if (e.target.value) setSelectedDate(e.target.value);
                        }}
                        className="h-8 rounded-lg border border-slate-200 bg-slate-50 px-2 text-xs font-bold text-slate-800 focus:border-blue-600 focus:outline-none"
                      >
                        <option value="" disabled>
                          -- Chọn ngày ({availableDates.length} ngày) --
                        </option>
                        {availableDates.map((d) => (
                          <option key={d.workDate} value={d.workDate}>
                            {formatDateVn(d.workDate)} ({d.rowCount} dòng / {d.workerCount} thợ)
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Status Indicator */}
                  {currentDateMeta ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 border border-emerald-200">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Đã lưu CSDL ({currentDateMeta.rowCount} dòng &bull; {currentDateMeta.workerCount} thợ)
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700 border border-amber-200">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Kế hoạch mới (Chưa lưu CSDL)
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      if (dailyRows.length === 0) {
                        toast.warning('Chưa có danh sách kế hoạch ngày để đảo ca.');
                        return;
                      }
                      const rotated = rotateDailyPlanWeek(dailyRows);
                      setDailyRows(rotated);
                      toast.success(
                        'Đã đảo ca theo vòng lặp (Ca 1 ➔ Ca 3, Ca 2 ➔ Ca 1, Ca 3 ➔ Ca 2). Đặng Ngọc Long cố định Ca 2. Bấm "Lưu Kế Hoạch" để lưu lại!'
                      );
                    }}
                    className="font-bold text-violet-700 border-violet-300 bg-violet-50 hover:bg-violet-100"
                    title="Đảo ca hàng tuần theo vòng lặp: Ca 1 về Ca 3, Ca 2 về Ca 1, Ca 3 về Ca 2"
                  >
                    <RefreshCw className="h-3.5 w-3.5 text-violet-600" />
                    🔄 Đảo Ca Tuần (1→3, 2→1, 3→2)
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setShowAddWorkerModal(true)}
                    className="font-bold text-blue-700 hover:bg-blue-50"
                  >
                    <UserPlus className="h-3.5 w-3.5" />
                    + Thêm Thợ Vào Ca
                  </Button>
                </div>
              </div>

              {/* Row 2: Shift Filters & Search Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-700">Ca làm việc:</span>
                    <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                      {['ALL', 'Ca 1', 'Ca 2', 'Ca 3', 'Ca Hành chính', 'TĂNG CA'].map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setSelectedShift(s)}
                          className={`rounded-md px-2.5 py-1 text-xs font-bold transition-all ${
                            selectedShift === s
                              ? s === 'TĂNG CA'
                                ? 'bg-orange-600 text-white shadow-sm'
                                : 'bg-white text-blue-700 shadow-sm'
                              : s === 'TĂNG CA'
                                ? 'text-orange-700 hover:text-orange-950 bg-orange-100/60 font-black'
                                : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          {s === 'ALL' ? 'Tất Cả Ca' : s === 'TĂNG CA' ? '🔥 Tăng Ca (OT)' : s}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Search Filter */}
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Tìm thợ, khách hàng, sản phẩm, máy..."
                      value={searchFilter}
                      onChange={(e) => setSearchFilter(e.target.value)}
                      className="h-8 w-60 rounded-lg border border-slate-200 pl-8 pr-3 text-xs focus:border-blue-600 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2 text-xs font-bold text-slate-600">
                  {totalOvertimeTasks > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-orange-300 bg-orange-100 px-2.5 py-0.5 text-xs font-black text-orange-900 shadow-xs">
                      <Flame className="h-3.5 w-3.5 text-orange-600" />
                      Tăng ca: {totalOvertimeTasks} việc ({totalOvertimeHours}h)
                    </span>
                  )}
                  <span>Tổng số dòng: <strong>{filteredDailyRows.length}</strong></span>
                  <span>&bull;</span>
                  <span>Thợ phân công: <strong>{rowsByWorker.length} thợ</strong></span>
                  <button
                    type="button"
                    onClick={() => {
                      void loadDailyRows(selectedDate);
                      void loadAvailableDates();
                    }}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs hover:bg-slate-100"
                  >
                    <RefreshCw className="h-3.5 w-3.5" /> Nạp lại
                  </button>
                </div>
              </div>
            </div>
          </Card>

          {/* Workers Dispatch Cards: Each worker has minimum 3 lines */}
          {loadingDaily ? (
            <div className="py-12 text-center text-sm font-semibold text-slate-500">
              Đang tải danh sách kế hoạch ngày...
            </div>
          ) : rowsByWorker.length === 0 ? (
            <Card className="p-8 text-center text-slate-500">
              <Calendar className="mx-auto mb-2 h-10 w-10 text-slate-400" />
              <div className="font-bold text-sm text-slate-700">Chưa có dữ liệu kế hoạch cho ngày {formatDateVn(selectedDate)}</div>
              <p className="mt-1 text-xs text-slate-500">
                Bạn có thể tạo kế hoạch bằng cách sao chép từ ngày trước hoặc thêm thợ mới vào ca.
              </p>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    setNewPlanDate(selectedDate);
                    setNewPlanMode('copy');
                    if (availableDates.length > 0) {
                      setSourceCopyDate(availableDates[0].workDate);
                    }
                    setShowNewDateModal(true);
                  }}
                  className="bg-blue-600 font-bold text-white hover:bg-blue-700"
                >
                  <Copy className="h-4 w-4" />
                  Sao chép kế hoạch từ ngày khác
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowAddWorkerModal(true)}
                  className="font-bold text-blue-700"
                >
                  <UserPlus className="h-4 w-4" />
                  + Thêm thợ vào ca
                </Button>
              </div>
            </Card>
          ) : (
            <div className="space-y-3">
              {rowsByWorker.map(([workerName, workerRows]) => {
                const hasWorkerOt = workerRows.some(
                  ({ row }) =>
                    row.isOvertime ||
                    row.shiftType === 'Tăng ca' ||
                    (row.note && /tăng ca|ot/i.test(row.note))
                );
                const workerOtHours = workerRows.reduce((sum, { row }) => {
                  if (
                    row.isOvertime ||
                    row.shiftType === 'Tăng ca' ||
                    (row.note && /tăng ca|ot/i.test(row.note))
                  ) {
                    return sum + (Number(row.overtimeHours) || 2);
                  }
                  return sum;
                }, 0);

                return (
                <Card key={workerName} className="overflow-hidden border-slate-200 bg-white p-0">
                  {/* Worker Header Header */}
                  <div className="flex flex-wrap items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-100 font-extrabold text-xs text-blue-700">
                        {workerName.charAt(0)}
                      </div>
                      <span className="font-extrabold text-sm text-slate-900">{workerName}</span>

                      {/* Dropdown Ca Làm Việc - Trỏ xuống để đổi ca nhanh */}
                      <select
                        value={workerRows[0]?.row.shiftType || 'Ca 2'}
                        onChange={(e) => {
                          const newShift = e.target.value;
                          workerRows.forEach(({ originalIdx }) => {
                            handleRowChange(originalIdx, 'shiftType', newShift);
                          });
                          toast.info(`Đã đổi thợ ${workerName} sang ${newShift}. Bấm "Lưu Kế Hoạch" để cập nhật.`);
                        }}
                        className="h-7 rounded-lg border border-blue-300 bg-blue-50 px-2 py-0.5 text-xs font-black text-blue-800 shadow-sm focus:border-blue-600 focus:outline-none cursor-pointer hover:bg-blue-100"
                        title="Đổi ca làm việc cho thợ này"
                      >
                        <option value="Ca 1">Ca 1</option>
                        <option value="Ca 2">Ca 2</option>
                        <option value="Ca 3">Ca 3</option>
                        <option value="Ca Hành chính">Ca Hành chính</option>
                        <option value="Tăng ca">🔥 Tăng ca</option>
                      </select>

                      {hasWorkerOt && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-orange-400 bg-orange-100 px-2 py-0.5 text-xs font-black text-orange-950 shadow-2xs">
                          <Flame className="h-3 w-3 text-orange-600 animate-pulse" />
                          TĂNG CA (+{workerOtHours}h)
                        </span>
                      )}

                      <span className="text-xs text-slate-500">
                        ({workerRows.length} mặt hàng / nguyên công)
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => handleAddWorkerRow(workerName, workerRows[0]?.row.shiftType || 'Ca 2')}
                        className="text-xs font-bold text-blue-700"
                      >
                        <Plus className="h-3.5 w-3.5" /> Thêm Mặt Hàng
                      </Button>
                    </div>
                  </div>

                  {/* 3-Tier Cascade Table */}
                  <datalist id="schedule-note-presets-list">
                      {SCHEDULE_NOTE_PRESETS.map((preset) => (
                        <option key={preset} value={preset} />
                      ))}
                    </datalist>
                    <div className="overflow-x-auto">
                    <table className="w-full min-w-[950px] border-collapse text-left text-xs text-slate-900">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-100/70 text-[11px] font-extrabold uppercase text-slate-700">
                          <th className="w-10 px-2 py-2 text-center">#</th>
                          <th className="w-36 px-2 py-2">Khách Hàng (1)</th>
                          <th className="px-2 py-2">Sản Phẩm / Bản Vẽ (2)</th>
                          <th className="px-2 py-2">Công Đoạn HT (3)</th>
                          <th className="w-28 px-2 py-2 text-center">Kế Hoạch</th>
                          <th className="w-40 px-2 py-2">Máy / Ca</th>
                          <th className="w-32 px-2 py-2 text-center">🔥 Tăng Ca (OT)</th>
                          <th className="w-36 px-2 py-2">Ghi Chú</th>
                          <th className="w-16 px-1 py-2 text-center">Mã QR</th>
                          <th className="w-10 px-1 py-2 text-center"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {workerRows.map(({ row, originalIdx }, rowSubIdx) => {
                          // Cascade: products filtered by customer
                          const filteredProducts = bootstrap.products.filter(
                            (p) => !row.customer || p.customer === row.customer
                          );
                          // Cascade: operations filtered by product
                          const filteredOps = bootstrap.operations.filter(
                            (o) => !row.spId || o.spId === row.spId
                          );

                          const qrCodeImgUrl = `https://api.qrserver.com/v1/create-qr-code/?size=60x60&data=${encodeURIComponent(
                            `GCCK|${row.customer || 'VICO'}|${row.productName}|${row.workerName}`
                          )}`;

                          return (
                            <tr key={originalIdx} className="hover:bg-blue-50/30">
                              <td className="px-2 py-1.5 text-center font-mono font-bold text-slate-500">
                                {rowSubIdx + 1}
                              </td>

                              {/* 1. Khách Hàng */}
                              <td className="px-2 py-1.5">
                                <select
                                  value={row.customer}
                                  onChange={(e) =>
                                    handleRowChange(originalIdx, 'customer', e.target.value)
                                  }
                                  className="h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-900 focus:border-blue-600 focus:outline-none"
                                >
                                  <option value="">-- Chọn Khách --</option>
                                  {customerList.map((c) => (
                                    <option key={c} value={c}>
                                      {c}
                                    </option>
                                  ))}
                                </select>
                              </td>

                              {/* 2. Sản Phẩm */}
                              <td className="px-2 py-1.5">
                                <div className="flex items-center gap-1">
                                  <select
                                    value={row.productName}
                                    onChange={(e) =>
                                      handleRowChange(originalIdx, 'productName', e.target.value)
                                    }
                                    className="h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-xs font-bold text-slate-900 focus:border-blue-600 focus:outline-none"
                                  >
                                    <option value="">-- Chọn Bản Vẽ / Sản Phẩm --</option>
                                    {filteredProducts.map((p) => (
                                      <option key={p.spId} value={p.productName}>
                                        {p.productName}
                                      </option>
                                    ))}
                                    {row.productName &&
                                      !filteredProducts.some(
                                        (p) => p.productName === row.productName
                                      ) && (
                                        <option value={row.productName}>{row.productName}</option>
                                      )}
                                  </select>
                                  {row.productName && (
                                    <a
                                      href={row.drawingUrl || DEFAULT_DRIVE_FOLDER_URL}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border border-blue-200 bg-blue-50 text-blue-600 hover:bg-blue-100"
                                      title="Xem Bản Vẽ Google Drive"
                                    >
                                      <ExternalLink className="h-3.5 w-3.5" />
                                    </a>
                                  )}
                                </div>
                              </td>

                              {/* 3. Công Đoạn / Nguyên Công */}
                              <td className="px-2 py-1.5">
                                <select
                                  value={row.opName}
                                  onChange={(e) =>
                                    handleRowChange(originalIdx, 'opName', e.target.value)
                                  }
                                  className="h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-xs font-medium text-slate-800 focus:border-blue-600 focus:outline-none"
                                >
                                  <option value="">-- Chọn Công Đoạn --</option>
                                  {filteredOps.map((o) => (
                                    <option key={o.ncId} value={o.opName}>
                                      {o.opName}
                                    </option>
                                  ))}
                                  {row.opName &&
                                    !filteredOps.some((o) => o.opName === row.opName) && (
                                      <option value={row.opName}>{row.opName}</option>
                                    )}
                                </select>
                              </td>

                              {/* Kế Hoạch */}
                              <td className="px-2 py-1.5 text-center">
                                {(() => {
                                  const matchedOp = bootstrap.operations.find(
                                    (o) =>
                                      (row.ncId && o.ncId === row.ncId) ||
                                      (o.opName === row.opName && (!row.spId || o.spId === row.spId)) ||
                                      (o.productName === row.productName && o.opName === row.opName)
                                  );
                                  const opStdQty = matchedOp ? calculateOpStandardPlanQty(matchedOp) : undefined;
                                  return (
                                    <PlannedQtyCell
                                      value={row.plannedQty}
                                      stdQty={opStdQty}
                                      onChange={(val) =>
                                        handleRowChange(originalIdx, 'plannedQty', val)
                                      }
                                    />
                                  );
                                })()}
                              </td>

                              {/* Máy / Ca */}
                              <td className="px-2 py-1.5">
                                <select
                                  value={row.machineName}
                                  onChange={(e) =>
                                    handleRowChange(originalIdx, 'machineName', e.target.value)
                                  }
                                  className="h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-xs font-bold text-slate-800 focus:border-blue-600 focus:outline-none"
                                >
                                  <option value="">-- Chọn Máy --</option>
                                  {machineList.map((m) => (
                                    <option key={m} value={m}>
                                      {m}
                                    </option>
                                  ))}
                                  {row.machineName &&
                                    !machineList.includes(row.machineName) && (
                                      <option value={row.machineName}>{row.machineName}</option>
                                    )}
                                </select>
                              </td>

                              {/* Cột TĂNG CA (OT) */}
                              <td className="px-2 py-1.5 text-center">
                                <div className="flex items-center justify-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const nextVal = !row.isOvertime;
                                      handleRowChange(originalIdx, 'isOvertime', nextVal);
                                      if (nextVal && !row.overtimeHours) {
                                        handleRowChange(originalIdx, 'overtimeHours', 2);
                                      }
                                    }}
                                    className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-black transition-all ${
                                      row.isOvertime
                                        ? 'border border-orange-500 bg-orange-500 text-white shadow-xs'
                                        : 'border border-slate-300 bg-slate-50 text-slate-500 hover:border-orange-400 hover:text-orange-600'
                                    }`}
                                    title="Bấm để bật/tắt chế độ Tăng Ca cho công việc này"
                                  >
                                    <Flame className="h-3 w-3" />
                                    {row.isOvertime ? 'TĂNG CA' : 'Thường'}
                                  </button>
                                  {row.isOvertime && (
                                    <input
                                      type="number"
                                      min={0.5}
                                      max={12}
                                      step={0.5}
                                      value={row.overtimeHours ?? 2}
                                      onChange={(e) =>
                                        handleRowChange(
                                          originalIdx,
                                          'overtimeHours',
                                          Number(e.target.value) || 0
                                        )
                                      }
                                      className="font-mono-num h-7 w-12 rounded border border-orange-400 bg-orange-50 text-center text-xs font-black text-orange-950 focus:outline-none"
                                      title="Số giờ tăng ca"
                                    />
                                  )}
                                </div>
                              </td>

                              {/* Ghi chú: Danh mục trỏ xuống trực quan + Tự động đồng bộ Tăng ca */}
                              <td className="px-2 py-1.5 min-w-[210px]">
                                <div className="space-y-1">
                                  <select
                                    value={SCHEDULE_NOTE_PRESETS.includes(row.note || '') ? (row.note || '') : (row.note ? '__CUSTOM__' : 'Máy chính')}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      if (val === '__CUSTOM__') {
                                        handleRowChange(originalIdx, 'note', row.note && !SCHEDULE_NOTE_PRESETS.includes(row.note) ? row.note : '');
                                      } else {
                                        handleRowChange(originalIdx, 'note', val);
                                        if (val.includes('Tăng ca') && !row.isOvertime) {
                                          handleRowChange(originalIdx, 'isOvertime', true);
                                          if (!row.overtimeHours) handleRowChange(originalIdx, 'overtimeHours', 2);
                                        }
                                      }
                                    }}
                                    className="h-8 w-full rounded-md border border-slate-300 bg-white px-2 pr-6 text-xs font-semibold text-slate-800 shadow-2xs hover:border-blue-500 focus:border-blue-600 focus:outline-none"
                                  >
                                    <option value="Máy chính">Máy chính</option>
                                    <option value="Ghép 2 máy (+0.33)">Ghép 2 máy (+0.33)</option>
                                    <option value="🔥 Tăng ca 2h (14:00 - 16:00)">🔥 Tăng ca 2h (14:00 - 16:00)</option>
                                    <option value="🔥 Tăng ca 2h (22:00 - 24:00)">🔥 Tăng ca 2h (22:00 - 24:00)</option>
                                    <option value="Thợ luân chuyển Ca 1 & Ca 2 theo điều động xưởng">Thợ luân chuyển Ca 1 &amp; Ca 2</option>
                                    <option value="Định biên cố định Ca 2">Định biên cố định Ca 2</option>
                                    <option value="Chuyên máy Phay CNC 1">Chuyên máy Phay CNC 1</option>
                                    <option value="Chuyên máy Phay CNC 2">Chuyên máy Phay CNC 2</option>
                                    <option value="Ghép 2 máy (+0.33) - Cắt dây tự động 24/24">Ghép 2 máy (+0.33) - Cắt dây 24/24</option>
                                    <option value="Ca đêm Lights-out - Chu kỳ dài">Ca đêm Lights-out - Chu kỳ dài</option>
                                    <option value="Trưởng ca - Chỉ đạo sản xuất">Trưởng ca - Chỉ đạo sản xuất</option>
                                    <option value="__CUSTOM__">✍️ Ghi chú khác (Tự gõ)...</option>
                                  </select>

                                  {(!SCHEDULE_NOTE_PRESETS.includes(row.note || '') && row.note !== undefined && row.note !== 'Máy chính') && (
                                    <input
                                      type="text"
                                      value={row.note || ''}
                                      onChange={(e) => handleRowChange(originalIdx, 'note', e.target.value)}
                                      placeholder="Nhập ghi chú tùy ý..."
                                      className="h-7 w-full rounded border border-blue-400 bg-blue-50/50 px-2 text-xs font-medium text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none"
                                    />
                                  )}
                                </div>
                              </td>

                              {/* Mã QR */}
                              <td className="px-2 py-1.5 text-center">
                                <img
                                  src={qrCodeImgUrl}
                                  alt="QR"
                                  className="mx-auto h-7 w-7 rounded border border-slate-200"
                                />
                              </td>

                              {/* Delete button */}
                              <td className="px-2 py-1.5 text-center">
                                <button
                                  type="button"
                                  onClick={() => handleDeleteRow(originalIdx)}
                                  className="text-slate-400 hover:text-rose-600"
                                  title="Xóa hàng này"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Card>
              );
            })}
            </div>
          )}

          {/* Quick Note Presets Bar */}
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            <span className="font-bold text-slate-700">💡 Gợi ý nhanh:</span>
            <span>Mỗi thợ được chia sẵn 3 ô dòng hàng để đảm bảo đủ mặt hàng trong ca. Các dòng không chạy có thể để kế hoạch = 0.</span>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SUB-TAB 2: BÁO CÁO TUẦN (THỨ 5 -> THỨ 4) & CÂN BẰNG TẢI TUẦN TỚI          */}
      {/* ========================================================================= */}
      {subTab === 'weekly' && (
        <div className="space-y-4">
          {/* Week Selector Bar */}
          <Card className="border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold text-slate-700">
                  Chu kỳ Tuần (Thứ 5 &rarr; Thứ 4):
                </span>
                <input
                  type="date"
                  value={weeklyStart}
                  onChange={(e) => setWeeklyStart(e.target.value)}
                  className="h-9 rounded-lg border border-slate-300 px-3 text-xs font-bold text-slate-900 focus:border-blue-600 focus:outline-none"
                />
                {weeklyReport && (
                  <Badge variant="info" className="font-bold">
                    {weeklyReport.weekLabel}
                  </Badge>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => void loadWeeklyReport(weeklyStart)}
                  disabled={loadingWeekly}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Làm Mới
                </Button>
              </div>
            </div>
          </Card>

          {loadingWeekly || !weeklyReport ? (
            <div className="py-12 text-center text-sm font-semibold text-slate-500">
              Đang tổng hợp báo cáo sản xuất tuần &amp; tính toán cân bằng tải...
            </div>
          ) : (
            <div className="space-y-5">
              {/* KHỐI 1: TIẾN ĐỘ ĐƠN HÀNG & SẢN LƯỢNG THEO KHÁCH HÀNG */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide text-slate-900">
                    <TrendingUp className="h-4 w-4 text-blue-600" />
                    Khối 1: Tổng Hợp Sản Lượng &amp; Tiến Độ Theo Khách Hàng
                  </h3>
                  <Badge
                    variant={weeklyReport.summary.completionPct >= 90 ? 'success' : 'warning'}
                  >
                    Đạt {weeklyReport.summary.completionPct}% Kế Hoạch
                  </Badge>
                </div>

                {/* 4 Interactive Metric Cards (Click to Filter & Toggle Thu/Trải Directly) */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      if (weeklyMetricFilter === 'ALL') {
                        togglePoListExpanded('ALL');
                      } else {
                        setWeeklyMetricFilter('ALL');
                        setSelectedWeeklyCustomer(null);
                        setPoListExpandedByMetric((p) => ({ ...p, ALL: true }));
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        if (weeklyMetricFilter === 'ALL') {
                          togglePoListExpanded('ALL');
                        } else {
                          setWeeklyMetricFilter('ALL');
                          setSelectedWeeklyCustomer(null);
                          setPoListExpandedByMetric((p) => ({ ...p, ALL: true }));
                        }
                      }
                    }}
                    title="Bấm để lọc toàn bộ đơn hàng & thu lên/trải xuống danh sách"
                    className={`cursor-pointer rounded-2xl border p-3 text-center transition-all hover:shadow-md hover:scale-[1.02] active:scale-[0.98] ${
                      weeklyMetricFilter === 'ALL'
                        ? 'border-blue-400 bg-blue-50/50 ring-2 ring-blue-500 ring-offset-2'
                        : 'border-slate-200 bg-white hover:border-blue-300'
                    }`}
                  >
                    <div className="text-[11px] font-bold uppercase text-slate-500">
                      1. Tổng Kế Hoạch
                    </div>
                    <div className="font-mono-num mt-1 text-xl font-black text-slate-900">
                      {weeklyReport.summary.totalPlannedQty} SP
                    </div>
                    <div className="mt-1 flex items-center justify-center gap-1 text-[10px] font-bold">
                      {weeklyMetricFilter === 'ALL' ? (
                        <span className="inline-flex items-center gap-0.5 rounded bg-blue-100 px-1.5 py-0.5 text-blue-900">
                          {poListExpandedByMetric.ALL ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                          <span>{poListExpandedByMetric.ALL ? 'Đang mở (Bấm thu)' : 'Thu gọn (Bấm trải)'}</span>
                        </span>
                      ) : (
                        <span className="text-blue-700">🔍 Bấm lọc &amp; mở</span>
                      )}
                    </div>
                  </div>

                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      if (weeklyMetricFilter === 'ACTUAL') {
                        togglePoListExpanded('ACTUAL');
                      } else {
                        setWeeklyMetricFilter('ACTUAL');
                        setPoListExpandedByMetric((p) => ({ ...p, ACTUAL: true }));
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        if (weeklyMetricFilter === 'ACTUAL') {
                          togglePoListExpanded('ACTUAL');
                        } else {
                          setWeeklyMetricFilter('ACTUAL');
                          setPoListExpandedByMetric((p) => ({ ...p, ACTUAL: true }));
                        }
                      }
                    }}
                    title="Bấm để lọc các đơn đã có sản lượng gia công & thu lên/trải xuống danh sách"
                    className={`cursor-pointer rounded-2xl border p-3 text-center transition-all hover:shadow-md hover:scale-[1.02] active:scale-[0.98] ${
                      weeklyMetricFilter === 'ACTUAL'
                        ? 'border-emerald-400 bg-emerald-50/60 ring-2 ring-emerald-500 ring-offset-2'
                        : 'border-slate-200 bg-white hover:border-emerald-300'
                    }`}
                  >
                    <div className="text-[11px] font-bold uppercase text-slate-500">
                      2. Thực Tế Đã Làm
                    </div>
                    <div className="font-mono-num mt-1 text-xl font-black text-emerald-700">
                      {weeklyReport.summary.totalActualQty} SP
                    </div>
                    <div className="mt-1 flex items-center justify-center gap-1 text-[10px] font-bold">
                      {weeklyMetricFilter === 'ACTUAL' ? (
                        <span className="inline-flex items-center gap-0.5 rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-900">
                          {poListExpandedByMetric.ACTUAL ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                          <span>{poListExpandedByMetric.ACTUAL ? 'Đang mở (Bấm thu)' : 'Thu gọn (Bấm trải)'}</span>
                        </span>
                      ) : (
                        <span className="text-emerald-700">⚡ Bấm lọc &amp; mở</span>
                      )}
                    </div>
                  </div>

                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      if (weeklyMetricFilter === 'COMPLETED') {
                        togglePoListExpanded('COMPLETED');
                      } else {
                        setWeeklyMetricFilter('COMPLETED');
                        setPoListExpandedByMetric((p) => ({ ...p, COMPLETED: true }));
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        if (weeklyMetricFilter === 'COMPLETED') {
                          togglePoListExpanded('COMPLETED');
                        } else {
                          setWeeklyMetricFilter('COMPLETED');
                          setPoListExpandedByMetric((p) => ({ ...p, COMPLETED: true }));
                        }
                      }
                    }}
                    title="Bấm để lọc các đơn hàng đạt 100% kế hoạch & thu lên/trải xuống danh sách"
                    className={`cursor-pointer rounded-2xl border p-3 text-center transition-all hover:shadow-md hover:scale-[1.02] active:scale-[0.98] ${
                      weeklyMetricFilter === 'COMPLETED'
                        ? 'border-blue-400 bg-blue-50/70 ring-2 ring-blue-600 ring-offset-2'
                        : 'border-slate-200 bg-white hover:border-blue-300'
                    }`}
                  >
                    <div className="text-[11px] font-bold uppercase text-slate-500">
                      3. Đơn Đạt Kế Hoạch
                    </div>
                    <div className="font-mono-num mt-1 text-xl font-black text-blue-700">
                      {weeklyReport.summary.completedPoCount} PO
                    </div>
                    <div className="mt-1 flex items-center justify-center gap-1 text-[10px] font-bold">
                      {weeklyMetricFilter === 'COMPLETED' ? (
                        <span className="inline-flex items-center gap-0.5 rounded bg-blue-100 px-1.5 py-0.5 text-blue-900">
                          {poListExpandedByMetric.COMPLETED ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                          <span>{poListExpandedByMetric.COMPLETED ? 'Đang mở (Bấm thu)' : 'Thu gọn (Bấm trải)'}</span>
                        </span>
                      ) : (
                        <span className="text-blue-700">✅ Bấm lọc &amp; mở</span>
                      )}
                    </div>
                  </div>

                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      if (weeklyMetricFilter === 'DELAYED') {
                        togglePoListExpanded('DELAYED');
                      } else {
                        setWeeklyMetricFilter('DELAYED');
                        setPoListExpandedByMetric((p) => ({ ...p, DELAYED: true }));
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        if (weeklyMetricFilter === 'DELAYED') {
                          togglePoListExpanded('DELAYED');
                        } else {
                          setWeeklyMetricFilter('DELAYED');
                          setPoListExpandedByMetric((p) => ({ ...p, DELAYED: true }));
                        }
                      }
                    }}
                    title="Bấm để lọc các đơn trượt kế hoạch & thu lên/trải xuống danh sách"
                    className={`cursor-pointer rounded-2xl border p-3 text-center transition-all hover:shadow-md hover:scale-[1.02] active:scale-[0.98] ${
                      weeklyMetricFilter === 'DELAYED'
                        ? 'border-rose-400 bg-rose-50/70 ring-2 ring-rose-500 ring-offset-2 shadow-xs'
                        : 'border-slate-200 bg-white hover:border-rose-300'
                    }`}
                  >
                    <div className="text-[11px] font-bold uppercase text-slate-500">
                      4. Đơn Trượt Kế Hoạch
                    </div>
                    <div className="font-mono-num mt-1 text-xl font-black text-rose-700">
                      {weeklyReport.summary.delayedPoCount} PO
                    </div>
                    <div className="mt-1 flex items-center justify-center gap-1 text-[10px] font-bold">
                      {weeklyMetricFilter === 'DELAYED' ? (
                        <span className="inline-flex items-center gap-0.5 rounded bg-rose-100 px-1.5 py-0.5 text-rose-900 font-extrabold">
                          {poListExpandedByMetric.DELAYED ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                          <span>{poListExpandedByMetric.DELAYED ? 'Đang mở (Bấm thu)' : 'Thu gọn (Bấm trải)'}</span>
                        </span>
                      ) : (
                        <span className="text-rose-700 font-extrabold animate-pulse">🚨 Bấm lọc &amp; mở</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Active Filter Banner */}
                {(weeklyMetricFilter !== 'ALL' || selectedWeeklyCustomer) && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-blue-200 bg-blue-50/90 px-3.5 py-2 text-xs font-bold text-blue-950">
                    <div className="flex items-center gap-2">
                      <Filter className="h-4 w-4 text-blue-600" />
                      <span>
                        Đang lọc trực tiếp: <strong>
                          {weeklyMetricFilter === 'DELAYED' && '🚨 Đơn Trượt Kế Hoạch / Chậm Hạn'}
                          {weeklyMetricFilter === 'COMPLETED' && '✅ Đơn Đạt Kế Hoạch Đúng Hạn'}
                          {weeklyMetricFilter === 'ACTUAL' && '⚡ Đơn Đã Có Sản Lượng Thực Tế'}
                          {weeklyMetricFilter === 'ALL' && 'Tất Cả'}
                          {selectedWeeklyCustomer ? ` (Khách hàng: ${selectedWeeklyCustomer})` : ''}
                        </strong> ({filteredCustomerStats.length} đối tác &bull; {filteredPoStatuses.length} đơn PO)
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setWeeklyMetricFilter('ALL');
                        setSelectedWeeklyCustomer(null);
                      }}
                      className="inline-flex items-center gap-1 rounded-lg border border-blue-300 bg-white px-2.5 py-1 text-[11px] font-black text-blue-700 shadow-2xs hover:bg-blue-100"
                    >
                      <X className="h-3.5 w-3.5" />
                      <span>✕ Bỏ lọc (Hiện tất cả)</span>
                    </button>
                  </div>
                )}

                {/* Customer Stats Table (Có Nút Thu Lên / Trải Xuống) */}
                <Card className="overflow-hidden border-slate-200 bg-white p-0">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-bold text-slate-800">
                    <div className="flex items-center gap-2">
                      <span>Chi tiết sản lượng theo từng đối tác khách hàng (Bấm hàng để xem riêng đơn PO)</span>
                      {selectedWeeklyCustomer && (
                        <span className="text-[11px] font-bold text-blue-700">
                          &bull; Đang chọn: <strong>{selectedWeeklyCustomer}</strong>
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsCustomerTableExpanded((prev) => !prev)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-700 shadow-2xs hover:border-blue-400 hover:bg-blue-50 hover:text-blue-800 transition-colors"
                    >
                      {isCustomerTableExpanded ? (
                        <>
                          <ChevronUp className="h-3.5 w-3.5 text-slate-600" />
                          <span>Thu Lên</span>
                        </>
                      ) : (
                        <>
                          <ChevronDown className="h-3.5 w-3.5 text-blue-600" />
                          <span>Trải Xuống ({filteredCustomerStats.length} Đối Tác)</span>
                        </>
                      )}
                    </button>
                  </div>

                  {isCustomerTableExpanded ? (
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-100/60 font-bold uppercase text-slate-600">
                          <th className="px-4 py-2">Khách Hàng</th>
                          <th className="px-3 py-2 text-center">Số Mặt Hàng</th>
                          <th className="px-3 py-2 text-center">Kế Hoạch</th>
                          <th className="px-3 py-2 text-center">Thực Tế</th>
                          <th className="px-3 py-2 text-center">Tỷ Lệ %</th>
                          <th className="px-4 py-2">Trạng Thái Đơn</th>
                          <th className="px-3 py-2 text-center">Thao Tác</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-semibold text-slate-900">
                        {filteredCustomerStats.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="py-6 text-center text-xs text-slate-500">
                              Không có đối tác khách hàng nào khớp với trạng thái đang chọn.
                            </td>
                          </tr>
                        ) : (
                          filteredCustomerStats.map((cs) => {
                            const isSelected = selectedWeeklyCustomer === cs.customer;
                            return (
                              <tr
                                key={cs.customer}
                                onClick={() =>
                                  setSelectedWeeklyCustomer((cur) =>
                                    cur === cs.customer ? null : cs.customer
                                  )
                                }
                                title="Bấm để lọc riêng danh sách đơn hàng PO của khách này"
                                className={`cursor-pointer transition-colors ${
                                  isSelected ? 'bg-blue-50/70 font-bold' : 'hover:bg-slate-50'
                                }`}
                              >
                                <td className="px-4 py-2 font-extrabold text-blue-700 flex items-center gap-1.5">
                                  <span>{cs.customer}</span>
                                  {isSelected && (
                                    <span className="rounded bg-blue-600 px-1 py-0.2 text-[9px] font-black text-white">
                                      Đang xem
                                    </span>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-center">{cs.productCount}</td>
                                <td className="font-mono-num px-3 py-2 text-center">{cs.plannedQty}</td>
                                <td className="font-mono-num px-3 py-2 text-center text-emerald-700 font-extrabold">
                                  {cs.actualQty}
                                </td>
                                <td className="font-mono-num px-3 py-2 text-center">
                                  <Badge
                                    variant={
                                      cs.completionPct >= 90
                                        ? 'success'
                                        : cs.completionPct >= 70
                                        ? 'warning'
                                        : 'danger'
                                    }
                                  >
                                    {cs.completionPct}%
                                  </Badge>
                                </td>
                                <td className="px-4 py-2 text-slate-600">
                                  {cs.completionPct >= 100
                                    ? '✅ Hoàn thành đúng tiến độ'
                                    : `⏳ Còn thiếu ${Math.max(0, cs.plannedQty - cs.actualQty)} SP`}
                                </td>
                                <td className="px-3 py-2 text-center">
                                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-700 hover:underline">
                                    <span>Xem PO</span>
                                    <ArrowRight className="h-3 w-3" />
                                  </span>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  ) : (
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setIsCustomerTableExpanded(true)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') setIsCustomerTableExpanded(true);
                      }}
                      className="flex cursor-pointer items-center justify-between bg-slate-50/60 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-blue-50/50 hover:text-blue-800 transition-colors"
                    >
                      <span>Bảng tổng hợp đối tác đang thu gọn ({filteredCustomerStats.length} khách hàng).</span>
                      <span className="font-bold text-blue-700 underline">Bấm để trải xuống &darr;</span>
                    </div>
                  )}
                </Card>

                {/* DETAILED PO LIST (CẢ 4 MỤC ĐỀU CÓ NÚT THU LÊN / TRẢI XUỐNG RIÊNG & CHUNG) */}
                <Card className="overflow-hidden border-slate-200 bg-white p-0">
                  {/* Category Switcher Tabs for all 4 items */}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-100/70 px-4 py-2 text-xs">
                    <div className="flex flex-wrap items-center gap-1.5 font-bold">
                      <span className="text-slate-600">Xem mục:</span>
                      <button
                        type="button"
                        onClick={() => {
                          setWeeklyMetricFilter('ALL');
                          setSelectedWeeklyCustomer(null);
                        }}
                        className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-bold transition-all ${
                          weeklyMetricFilter === 'ALL'
                            ? 'bg-blue-600 text-white shadow-xs font-black'
                            : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <span>1. Tổng Kế Hoạch</span>
                        <span className={`rounded-sm px-1 py-0.2 text-[10px] ${
                          weeklyMetricFilter === 'ALL' ? 'bg-blue-800 text-white' : 'bg-slate-100 text-slate-600'
                        }`}>
                          {poListExpandedByMetric.ALL ? '▲ Mở' : '▼ Thu'}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setWeeklyMetricFilter('ACTUAL')}
                        className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-bold transition-all ${
                          weeklyMetricFilter === 'ACTUAL'
                            ? 'bg-emerald-600 text-white shadow-xs font-black'
                            : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <span>2. Thực Tế Đã Làm</span>
                        <span className={`rounded-sm px-1 py-0.2 text-[10px] ${
                          weeklyMetricFilter === 'ACTUAL' ? 'bg-emerald-800 text-white' : 'bg-slate-100 text-slate-600'
                        }`}>
                          {poListExpandedByMetric.ACTUAL ? '▲ Mở' : '▼ Thu'}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setWeeklyMetricFilter('COMPLETED')}
                        className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-bold transition-all ${
                          weeklyMetricFilter === 'COMPLETED'
                            ? 'bg-blue-700 text-white shadow-xs font-black'
                            : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <span>3. Đơn Đạt Chuẩn</span>
                        <span className={`rounded-sm px-1 py-0.2 text-[10px] ${
                          weeklyMetricFilter === 'COMPLETED' ? 'bg-blue-800 text-white' : 'bg-slate-100 text-slate-600'
                        }`}>
                          {poListExpandedByMetric.COMPLETED ? '▲ Mở' : '▼ Thu'}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setWeeklyMetricFilter('DELAYED')}
                        className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-bold transition-all ${
                          weeklyMetricFilter === 'DELAYED'
                            ? 'bg-rose-600 text-white shadow-xs font-black'
                            : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <span>4. Đơn Trượt Kế Hoạch</span>
                        <span className={`rounded-sm px-1 py-0.2 text-[10px] ${
                          weeklyMetricFilter === 'DELAYED' ? 'bg-rose-800 text-white' : 'bg-slate-100 text-slate-600'
                        }`}>
                          {poListExpandedByMetric.DELAYED ? '▲ Mở' : '▼ Thu'}
                        </span>
                      </button>
                    </div>

                    {/* Master buttons for all 4 categories */}
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => toggleAllPoMetrics(false)}
                        title="Thu lên toàn bộ cả 4 mục"
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-700 shadow-2xs hover:bg-slate-50 hover:text-slate-900"
                      >
                        <ChevronUp className="h-3.5 w-3.5 text-slate-600" />
                        <span>▲ Thu cả 4 mục</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleAllPoMetrics(true)}
                        title="Trải xuống toàn bộ cả 4 mục"
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-700 shadow-2xs hover:bg-slate-50 hover:text-slate-900"
                      >
                        <ChevronDown className="h-3.5 w-3.5 text-slate-600" />
                        <span>▼ Trải cả 4 mục</span>
                      </button>
                    </div>
                  </div>

                  {/* Header bar of the active list */}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-blue-600" />
                      <h4 className="text-xs font-black uppercase tracking-wide text-slate-900">
                        {weeklyMetricFilter === 'DELAYED'
                          ? `🚨 Danh Sách ${filteredPoStatuses.length} Đơn Hàng PO Trượt Kế Hoạch / Chậm Hạn (Cần Xử Lý Bù)`
                          : weeklyMetricFilter === 'COMPLETED'
                          ? `✅ Danh Sách ${filteredPoStatuses.length} Đơn Hàng PO Đạt Chuẩn 100% Kế Hoạch`
                          : weeklyMetricFilter === 'ACTUAL'
                          ? `⚡ Danh Sách ${filteredPoStatuses.length} Đơn Hàng PO Đã Có Sản Lượng Gia Công`
                          : `📦 Danh Sách Chi Tiết Các Đơn Hàng PO (${filteredPoStatuses.length} PO)`}
                      </h4>
                    </div>

                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="hidden text-[11px] font-semibold text-slate-600 lg:inline">
                        Bấm nút thao tác trực tiếp để giải quyết triệt để từng đơn hàng
                      </span>

                      {/* Nút Thu Lên / Trải Xuống cụ thể của mục đang chọn */}
                      <button
                        type="button"
                        onClick={() => togglePoListExpanded(weeklyMetricFilter)}
                        title={
                          poListExpandedByMetric[weeklyMetricFilter]
                            ? `Bấm để thu gọn danh sách ${filteredPoStatuses.length} đơn hàng mục này`
                            : `Bấm để trải xuống xem chi tiết ${filteredPoStatuses.length} đơn hàng mục này`
                        }
                        className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-black shadow-2xs transition-all active:scale-[0.98] ${
                          poListExpandedByMetric[weeklyMetricFilter]
                            ? 'border-blue-400 bg-blue-50 text-blue-900 hover:bg-blue-100'
                            : 'border-emerald-400 bg-emerald-50 text-emerald-900 ring-2 ring-emerald-200 hover:bg-emerald-100'
                        }`}
                      >
                        {poListExpandedByMetric[weeklyMetricFilter] ? (
                          <>
                            <ChevronUp className="h-4 w-4 text-blue-700" />
                            <span>▲ Thu Lên</span>
                          </>
                        ) : (
                          <>
                            <ChevronDown className="h-4 w-4 text-emerald-700" />
                            <span>▼ Trải Xuống ({filteredPoStatuses.length} Đơn)</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Body: Collapsed Banner OR PO Items List */}
                  {!poListExpandedByMetric[weeklyMetricFilter] ? (
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => togglePoListExpanded(weeklyMetricFilter)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') togglePoListExpanded(weeklyMetricFilter);
                      }}
                      className="flex cursor-pointer items-center justify-between bg-slate-50/90 px-4 py-3 text-xs font-bold text-slate-700 hover:bg-blue-50/70 hover:text-blue-900 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <ChevronDown className="h-4 w-4 text-blue-600" />
                        <span>
                          Danh sách <strong>{filteredPoStatuses.length}</strong> đơn hàng PO của mục này đang được <strong>thu gọn</strong>.
                        </span>
                      </div>
                      <span className="inline-flex items-center gap-1 rounded-lg border border-blue-300 bg-white px-2.5 py-1 text-xs font-black text-blue-800 shadow-2xs hover:bg-blue-50">
                        <span>Bấm để trải xuống xem {filteredPoStatuses.length} đơn</span>
                        <ChevronDown className="h-3.5 w-3.5" />
                      </span>
                    </div>
                  ) : filteredPoStatuses.length === 0 ? (
                    <div className="py-8 text-center text-xs text-slate-500">
                      Không có đơn hàng PO nào khớp với bộ lọc trạng thái hiện tại.
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {filteredPoStatuses.map((po) => {
                        const isDone = Number(po.finishedQty || 0) >= Number(po.qtyPo || 0);
                        const remain = Math.max(0, Number(po.qtyPo || 0) - Number(po.finishedQty || 0));
                        const pct =
                          po.qtyPo > 0
                            ? Math.min(100, Math.round((Number(po.finishedQty || 0) / Number(po.qtyPo || 1)) * 100))
                            : 0;

                        return (
                          <div
                            key={po.poId}
                            className={`flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between transition-colors ${
                              po.isDelayed
                                ? 'bg-rose-50/30 hover:bg-rose-50/60'
                                : isDone
                                ? 'bg-emerald-50/20 hover:bg-emerald-50/40'
                                : 'hover:bg-slate-50'
                            }`}
                          >
                            <div className="min-w-0 flex-1 space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-mono-num text-xs font-black text-blue-700">
                                  {po.poId}
                                </span>
                                <span className="text-xs font-extrabold text-slate-800">
                                  &bull; {po.customer}
                                </span>
                                {po.isDelayed && (
                                  <span className="rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-black text-white">
                                    🚨 TRƯỢT KẾ HOẠCH / CHẬM HẠN
                                  </span>
                                )}
                                {isDone && (
                                  <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-black text-white">
                                    ✅ ĐÃ XONG 100%
                                  </span>
                                )}
                                <span className="font-mono-num text-[11px] font-semibold text-slate-500">
                                  Hạn giao: {formatDateVn(po.dueDate)}
                                </span>
                              </div>

                              <div className="truncate text-xs font-bold text-slate-900 sm:text-sm">
                                {po.productName}
                              </div>

                              <div className="flex flex-wrap items-center gap-3 text-xs">
                                <span className="font-mono-num text-slate-600">
                                  Tổng đặt: <strong>{po.qtyPo}</strong> SP
                                </span>
                                <span className="font-mono-num text-emerald-700">
                                  Đã làm: <strong>{po.finishedQty}</strong> SP ({pct}%)
                                </span>
                                {remain > 0 && (
                                  <span className="font-mono-num font-bold text-rose-700">
                                    Còn thiếu: {remain} SP
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Direct Action Buttons to Resolve Completely */}
                            <div className="flex shrink-0 flex-wrap items-center gap-2 pt-1 sm:pt-0">
                              {remain > 0 && (
                                <button
                                  type="button"
                                  onClick={() => handleWeeklyPoToDailySchedule(po.productName || po.poId)}
                                  className="inline-flex items-center gap-1.5 rounded-xl border border-blue-300 bg-blue-600 px-3 py-1.5 text-xs font-black text-white shadow-sm transition-all hover:bg-blue-700 active:scale-[0.98]"
                                  title="Đưa mặt hàng này vào Kế hoạch ngày để bố trí máy và thợ làm bù"
                                >
                                  <Calendar className="h-3.5 w-3.5" />
                                  <span>📅 Đưa Vào Kế Hoạch Bù</span>
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={() => handleWeeklyPoToOrders(po.poId)}
                                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-black text-slate-800 shadow-sm transition-all hover:border-blue-400 hover:bg-slate-50 active:scale-[0.98]"
                                title="Vào phân hệ Quản lý Đơn hàng để kiểm tra phiếu traveler QR, bản vẽ &amp; tiến độ"
                              >
                                <ExternalLink className="h-3.5 w-3.5 text-slate-600" />
                                <span>📦 Chi Tiết Đơn PO</span>
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Card>
              </div>

              {/* KHỐI 2: TỔNG HỢP GIỜ CÔNG & LAO ĐỘNG (DỰA THEO PHÂN HỆ CHẤM CÔNG) */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide text-slate-900">
                    <Users className="h-4 w-4 text-emerald-600" />
                    Khối 2: Tổng Hợp Giờ Công &amp; Lao Động (Dựa Theo Phân Hệ Chấm Công)
                  </h3>
                  <span className="text-xs text-slate-600 font-semibold">
                    * Dữ liệu trích xuất trực tiếp từ bảng phân hệ chấm công tuần ({formatDateVn(weeklyReport.weekStart)} &rarr; {formatDateVn(weeklyReport.weekEnd)})
                  </span>
                </div>

                <Card className="overflow-hidden border-slate-200 bg-white p-0">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-100/60 font-bold uppercase text-slate-600">
                        <th className="px-4 py-2.5">Họ Và Tên</th>
                        <th className="px-3 py-2.5 text-center">Công Chuẩn (Ca)</th>
                        <th className="px-3 py-2.5 text-center">Thêm Giờ (OT h)</th>
                        <th className="px-3 py-2.5 text-center">Tăng Ca CN (h)</th>
                        <th className="px-3 py-2.5 text-center">Nghỉ / Phép</th>
                        <th className="px-3 py-2.5 text-center">Tổng Công Quy Đổi</th>
                        <th className="px-4 py-2.5 text-center">Sản Lượng SP Làm Ra</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-semibold text-slate-900">
                      {weeklyReport.workerLaborStats.map((w) => (
                        <tr key={w.workerId} className="hover:bg-slate-50">
                          <td className="px-4 py-2 font-extrabold text-slate-900">{w.workerName}</td>
                          <td className="font-mono-num px-3 py-2 text-center text-slate-700">
                            {w.standardShifts} ca
                          </td>
                          <td className="font-mono-num px-3 py-2 text-center text-amber-700">
                            {w.otHours > 0 ? `+${w.otHours}h` : '—'}
                          </td>
                          <td className="font-mono-num px-3 py-2 text-center text-violet-700">
                            {w.sundayHours > 0 ? `${w.sundayHours}h` : '—'}
                          </td>
                          <td className="font-mono-num px-3 py-2 text-center text-slate-600">
                            {w.offDays > 0 || w.pDays > 0 ? `${w.offDays + w.pDays}d` : '0'}
                          </td>
                          <td className="font-mono-num px-3 py-2 text-center font-extrabold text-emerald-800">
                            {w.totalConvertedShifts} công
                          </td>
                          <td className="font-mono-num px-4 py-2 text-center font-bold text-blue-700">
                            {w.actualCompletedPieces} SP
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              </div>

              {/* KHỐI 3: SỰ CỐ THIẾT BỊ & THỜI GIAN DỪNG MÁY (DOWNTIME) */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide text-slate-900">
                    <Wrench className="h-4 w-4 text-amber-600" />
                    Khối 3: Sự Cố Thiết Bị &amp; Thời Gian Dừng Máy Trong Tuần
                  </h3>
                  <Badge variant="warning">
                    {weeklyReport.downtimeIncidents.length} lượt dừng máy
                  </Badge>
                </div>

                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {/* Shopfloor stoppage logs */}
                  <Card className="border-slate-200 bg-white p-3.5">
                    <div className="mb-2 font-bold text-xs uppercase text-slate-700">
                      Nhật ký dừng máy từ báo cáo phân xưởng
                    </div>
                    {weeklyReport.downtimeIncidents.length === 0 ? (
                      <div className="py-6 text-center text-xs text-slate-500">
                        Không có sự cố dừng máy nào được ghi nhận trong tuần.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {weeklyReport.downtimeIncidents.map((inc) => (
                          <div
                            key={inc.id}
                            className="flex items-start justify-between rounded-lg border border-amber-200 bg-amber-50/60 p-2 text-xs text-amber-950"
                          >
                            <div>
                              <span className="font-bold text-slate-900">{inc.machineName}: </span>
                              <span>{inc.reason}</span>
                              <div className="text-[10px] text-slate-600">
                                {inc.date} &bull; Thợ: {inc.workerName || '—'}
                              </div>
                            </div>
                            <span className="font-mono-num shrink-0 font-extrabold text-rose-700">
                              {inc.stopMinutes} phút
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>

                  {/* Freeform Add Incident Card (Để trống vài dòng điền thực tế) */}
                  <Card className="border-slate-200 bg-white p-3.5">
                    <div className="mb-2 font-bold text-xs uppercase text-slate-700">
                      Ghi nhận sự cố &amp; tình trạng thiết bị phát sinh (Nhập tay)
                    </div>

                    {weeklyReport.customIncidentNotes.length > 0 && (
                      <div className="mb-3 space-y-1">
                        {weeklyReport.customIncidentNotes.map((note, idx) => (
                          <div
                            key={idx}
                            className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-800"
                          >
                            &bull; {note}
                          </div>
                        ))}
                      </div>
                    )}

                    <form onSubmit={handleAddIncidentNote} className="space-y-2.5">
                      <div className="grid grid-cols-2 gap-2">
                        <select
                          value={newIncidentMachine}
                          onChange={(e) => setNewIncidentMachine(e.target.value)}
                          className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-900 focus:outline-none"
                        >
                          <option value="">-- Chọn máy gặp sự cố --</option>
                          {machineList.map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </select>
                        <input
                          type="number"
                          min={0}
                          value={newIncidentStopMin}
                          onChange={(e) => setNewIncidentStopMin(Number(e.target.value) || 0)}
                          placeholder="Phút dừng máy"
                          className="font-mono-num h-8 rounded-md border border-slate-300 px-2 text-xs text-slate-900 focus:outline-none"
                        />
                      </div>
                      <input
                        type="text"
                        value={newIncidentReason}
                        onChange={(e) => setNewIncidentReason(e.target.value)}
                        placeholder="Nội dung sự cố: hỏng dao, kẹt phôi, rò dầu..."
                        className="h-8 w-full rounded-md border border-slate-300 px-2 text-xs text-slate-900 focus:outline-none"
                      />
                      <Button
                        type="submit"
                        variant="secondary"
                        size="sm"
                        disabled={addingIncident}
                        className="w-full font-bold"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        {addingIncident ? 'Đang lưu...' : 'Thêm Dòng Ghi Chú Sự Cố'}
                      </Button>
                    </form>
                  </Card>
                </div>
              </div>

              {/* KHỐI 4: KẾ HOẠCH TUẦN TỚI & ĐỀ XUẤT GIA CÔNG NGOÀI */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide text-slate-900">
                    <Truck className="h-4 w-4 text-purple-600" />
                    Khối 4: Kế Hoạch Tuần Tới &amp; Đề Xuất Gia Công Ngoài (Outsource)
                  </h3>
                  {weeklyReport.nextWeekForecast.isOverloaded ? (
                    <Badge variant="danger" className="animate-pulse">
                      ⚠️ Vượt Khung Năng Lực Máy
                    </Badge>
                  ) : (
                    <Badge variant="success">Đủ Máy Hoàn Thành Kế Hoạch</Badge>
                  )}
                </div>

                {/* Capacity Balance Warning */}
                <Card
                  className={`p-4 border ${
                    weeklyReport.nextWeekForecast.isOverloaded
                      ? 'border-rose-300 bg-rose-50 text-rose-950'
                      : 'border-emerald-300 bg-emerald-50 text-emerald-950'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-extrabold text-sm">
                        {weeklyReport.nextWeekForecast.isOverloaded
                          ? '⚠️ CẢNH BÁO: TỔNG GIỜ MÁY CẦN THIẾT VƯỢT QUÁ KHẢ NĂNG PHÂN XƯỞNG'
                          : '✅ ĐỦ NĂNG LỰC 23 MÁY ĐÁP ỨNG KẾ HOẠCH TUẦN TỚI'}
                      </div>
                      <div className="mt-1 text-xs">
                        Số lượng thiếu tuần trước cần bù:{' '}
                        <strong>{weeklyReport.nextWeekForecast.carryoverBacklogQty} SP</strong> &bull; Tổng
                        giờ gia công tuần tới: <strong>{weeklyReport.nextWeekForecast.totalRequiredHours}h</strong> / Khả dụng:{' '}
                        <strong>{weeklyReport.nextWeekForecast.machineCapacityHours}h</strong>.
                      </div>
                    </div>
                  </div>
                </Card>

                {/* Outsource Recommendations Table */}
                {weeklyReport.nextWeekForecast.outsourceRecommendations.length > 0 && (
                  <Card className="overflow-hidden border-slate-200 bg-white p-0">
                    <div className="border-b border-slate-200 bg-purple-50 px-4 py-2 font-bold text-xs text-purple-900">
                      📋 Danh sách đề xuất chuyển gia công ngoài (tránh trễ hạn khách hàng)
                    </div>
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-100/60 font-bold uppercase text-slate-600">
                          <th className="px-4 py-2">Đơn Hàng / Chi Tiết</th>
                          <th className="px-3 py-2">Khách Hàng</th>
                          <th className="px-3 py-2 text-center">SL Đề Xuất Chuyển</th>
                          <th className="px-4 py-2">Lý Do Đề Xuất</th>
                          <th className="px-4 py-2 text-right">Chi Phí Dự Kiến</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-semibold text-slate-900">
                        {weeklyReport.nextWeekForecast.outsourceRecommendations.map((rec) => (
                          <tr key={rec.poId} className="hover:bg-purple-50/20">
                            <td className="px-4 py-2 font-bold text-blue-700">
                              {rec.poId} &bull; {rec.productName}
                            </td>
                            <td className="px-3 py-2">{rec.customer}</td>
                            <td className="font-mono-num px-3 py-2 text-center font-extrabold text-purple-800">
                              {rec.suggestedOutsourceQty} SP
                            </td>
                            <td className="px-4 py-2 text-slate-700">{rec.reason}</td>
                            <td className="font-mono-num px-4 py-2 text-right font-extrabold text-slate-900">
                              {formatVnd(rec.estimatedOutsourceCost)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </Card>
                )}
              </div>

              {/* KHỐI 5: CÁC ĐỀ XUẤT & KIẾN NGHỊ KHÁC */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide text-slate-900">
                    <FileText className="h-4 w-4 text-indigo-600" />
                    Khối 5: Các Đề Xuất &amp; Kiến Nghị Khác
                  </h3>
                  <Badge variant="purple">
                    {weeklyReport.proposals ? weeklyReport.proposals.length : 0} đề xuất
                  </Badge>
                </div>

                {/* Proposals Table */}
                <Card className="overflow-hidden border-slate-200 bg-white p-0">
                  {!weeklyReport.proposals || weeklyReport.proposals.length === 0 ? (
                    <div className="p-6 text-center text-xs text-slate-500">
                      Chưa có đề xuất hoặc kiến nghị nào cho tuần này. Bạn có thể gửi đề xuất mới bên dưới.
                    </div>
                  ) : (
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-100/60 font-bold uppercase text-slate-600">
                          <th className="px-3 py-2 w-10 text-center">#</th>
                          <th className="px-3 py-2 w-44">Phân Loại</th>
                          <th className="px-3 py-2 w-44">Người Đề Xuất</th>
                          <th className="px-4 py-2">Nội Dung Đề Xuất / Kiến Nghị</th>
                          <th className="px-3 py-2 w-28 text-center">Mức Độ</th>
                          <th className="px-3 py-2 w-28 text-center">Trạng Thái</th>
                          <th className="px-3 py-2 w-24 text-center">Thao Tác</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-semibold text-slate-900">
                        {weeklyReport.proposals.map((p, idx) => (
                          <tr key={p.id} className="hover:bg-slate-50">
                            <td className="px-3 py-2 text-center text-slate-500 font-mono">{idx + 1}</td>
                            <td className="px-3 py-2 font-bold text-slate-800">
                              <span className="inline-flex rounded bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-700">
                                {p.category}
                              </span>
                            </td>
                            <td className="px-3 py-2 font-bold text-blue-800">{p.proposer || 'Phân xưởng'}</td>
                            <td className="px-4 py-2 text-slate-800">{p.content}</td>
                            <td className="px-3 py-2 text-center">
                              <Badge
                                variant={
                                  p.priority === 'Khẩn cấp'
                                    ? 'danger'
                                    : p.priority === 'Cao'
                                    ? 'warning'
                                    : 'neutral'
                                }
                              >
                                {p.priority}
                              </Badge>
                            </td>
                            <td className="px-3 py-2 text-center">
                              <button
                                type="button"
                                onClick={() => handleToggleProposalStatus(p.id, p.status)}
                                className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold transition-all ${
                                  p.status === 'APPROVED'
                                    ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                                    : p.status === 'REJECTED'
                                    ? 'bg-rose-100 text-rose-800 hover:bg-rose-200'
                                    : 'bg-amber-100 text-amber-800 hover:bg-amber-200'
                                }`}
                                title="Bấm để chuyển trạng thái duyệt / chờ duyệt"
                              >
                                {p.status === 'APPROVED' ? '✓ Đã duyệt' : p.status === 'REJECTED' ? '✕ Từ chối' : '⏳ Chờ duyệt'}
                              </button>
                            </td>
                            <td className="px-3 py-2 text-center">
                              <button
                                type="button"
                                onClick={() => handleDeleteProposal(p.id)}
                                className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition-colors"
                                title="Xóa đề xuất này"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}

                  {/* Add proposal inline form */}
                  <form onSubmit={handleAddProposal} className="border-t border-slate-200 bg-slate-50/70 p-3">
                    <div className="text-xs font-extrabold text-slate-800 mb-2">
                      + Thêm Đề Xuất / Kiến Nghị Cho Tuần Này:
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
                      <div className="md:col-span-3">
                        <select
                          value={newPropCategory}
                          onChange={(e) => setNewPropCategory(e.target.value)}
                          className="h-8 w-full rounded border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-800 focus:border-blue-600 focus:outline-none"
                        >
                          <option value="Vật tư & Dụng cụ cắt">Vật tư & Dụng cụ cắt</option>
                          <option value="Bảo dưỡng thiết bị">Bảo dưỡng & Sửa máy</option>
                          <option value="Nhân sự & Bố trí ca">Nhân sự & Ca kíp</option>
                          <option value="Quy trình & Chất lượng">Quy trình & Chất lượng</option>
                          <option value="An toàn & Môi trường">An toàn & Môi trường</option>
                          <option value="Đề xuất khác">Đề xuất khác</option>
                        </select>
                      </div>

                      <div className="md:col-span-3">
                        <input
                          type="text"
                          placeholder="Người đề xuất (Quản đốc, Tổ trưởng...)"
                          value={newPropProposer}
                          onChange={(e) => setNewPropProposer(e.target.value)}
                          className="h-8 w-full rounded border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-800 focus:border-blue-600 focus:outline-none"
                        />
                      </div>

                      <div className="md:col-span-2">
                        <select
                          value={newPropPriority}
                          onChange={(e) => setNewPropPriority(e.target.value)}
                          className="h-8 w-full rounded border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-800 focus:border-blue-600 focus:outline-none"
                        >
                          <option value="Bình thường">Ưu tiên: Bình thường</option>
                          <option value="Cao">Ưu tiên: Cao</option>
                          <option value="Khẩn cấp">Ưu tiên: Khẩn cấp</option>
                        </select>
                      </div>

                      <div className="md:col-span-4 flex items-center gap-2">
                        <input
                          type="text"
                          placeholder="Nội dung đề xuất / kiến nghị chi tiết..."
                          value={newPropContent}
                          onChange={(e) => setNewPropContent(e.target.value)}
                          className="h-8 w-full rounded border border-slate-300 bg-white px-2 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                        />
                        <Button
                          type="submit"
                          variant="primary"
                          size="sm"
                          disabled={addingProposal}
                          className="whitespace-nowrap bg-indigo-600 text-white font-bold hover:bg-indigo-700"
                        >
                          {addingProposal ? 'Đang gửi...' : 'Gửi'}
                        </Button>
                      </div>
                    </div>
                  </form>
                </Card>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* SUB-TAB 3: BÁO CÁO NGÀY (FORM BM.KTCN.04.03)                              */}
      {/* ========================================================================= */}
      {subTab === 'daily_report' && (
        <DailyQualityReportSection bootstrap={bootstrap} />
      )}

      {/* ========================================================================= */}
      {/* MODAL 1: TẠO KẾ HOẠCH CHO NGÀY MỚI                                         */}
      {/* ========================================================================= */}
      <Modal
        open={showNewDateModal}
        onClose={() => setShowNewDateModal(false)}
        title="Tạo Kế Hoạch Sản Xuất Cho Ngày Mới"
        subtitle="Khởi tạo bảng phân công thợ cho ca sản xuất theo biểu mẫu VICO"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowNewDateModal(false)}
            >
              Hủy
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={handleCreateNewPlan}
              disabled={creatingDate}
              className="bg-blue-600 font-bold text-white hover:bg-blue-700"
            >
              {creatingDate ? 'Đang tạo...' : 'Tạo Kế Hoạch & Mở Ngày Này'}
            </Button>
          </div>
        }
      >
        <div className="space-y-4 text-xs text-slate-800">
          <div>
            <label className="block font-bold text-slate-700 mb-1">
              Ngày lập kế hoạch:
            </label>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={newPlanDate}
                onChange={(e) => setNewPlanDate(e.target.value)}
                className="h-9 w-full rounded-lg border border-slate-300 px-3 text-xs font-bold text-slate-900 focus:border-blue-600 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => {
                  const todayStr = new Date().toISOString().slice(0, 10);
                  setNewPlanDate(todayStr);
                }}
                className="whitespace-nowrap rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 font-bold text-slate-700 hover:bg-slate-200"
              >
                Hôm nay
              </button>
              <button
                type="button"
                onClick={() => {
                  const tom = new Date();
                  tom.setDate(tom.getDate() + 1);
                  setNewPlanDate(tom.toISOString().slice(0, 10));
                }}
                className="whitespace-nowrap rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 font-bold text-slate-700 hover:bg-slate-200"
              >
                Ngày mai
              </button>
            </div>
          </div>

          <div className="space-y-2 border-t border-slate-100 pt-3">
            <span className="block font-bold text-slate-700">
              Phương thức khởi tạo kế hoạch:
            </span>

            {/* Option 1: Sao chép */}
            <label className="flex items-start gap-2.5 rounded-lg border border-slate-200 p-3 hover:bg-slate-50 cursor-pointer">
              <input
                type="radio"
                name="newPlanMode"
                value="copy"
                checked={newPlanMode === 'copy'}
                onChange={() => setNewPlanMode('copy')}
                className="mt-0.5 text-blue-600 focus:ring-blue-500"
              />
              <div className="flex-1 space-y-2">
                <div className="font-bold text-slate-900">
                  📋 Sao chép từ kế hoạch ngày đã có (Khuyến nghị)
                </div>
                <div className="text-slate-500 text-[11px]">
                  Kế thừa toàn bộ danh sách thợ, máy, chi tiết gia công và công đoạn từ ngày trước.
                </div>

                {newPlanMode === 'copy' && (
                  <div className="rounded-lg bg-blue-50/70 p-2.5 space-y-2 border border-blue-100">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-blue-900">Ngày nguồn:</span>
                      <select
                        value={sourceCopyDate}
                        onChange={(e) => setSourceCopyDate(e.target.value)}
                        className="rounded border border-blue-200 bg-white px-2 py-1 text-xs font-bold text-slate-800"
                      >
                        {availableDates.map((d) => (
                          <option key={d.workDate} value={d.workDate}>
                            {formatDateVn(d.workDate)} ({d.rowCount} dòng, {d.workerCount} thợ)
                          </option>
                        ))}
                      </select>
                    </div>

                    <label className="flex items-center gap-2 text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={copyResetQty}
                        onChange={(e) => setCopyResetQty(e.target.checked)}
                        className="rounded text-blue-600 focus:ring-blue-500"
                      />
                      <span>Đặt lại số lượng kế hoạch = 0 (giữ nguyên mặt hàng và máy, nhập số lượng mới)</span>
                    </label>
                  </div>
                )}
              </div>
            </label>

            {/* Option 2: Khung mẫu thợ */}
            <label className="flex items-start gap-2.5 rounded-lg border border-slate-200 p-3 hover:bg-slate-50 cursor-pointer">
              <input
                type="radio"
                name="newPlanMode"
                value="template"
                checked={newPlanMode === 'template'}
                onChange={() => setNewPlanMode('template')}
                className="mt-0.5 text-blue-600 focus:ring-blue-500"
              />
              <div>
                <div className="font-bold text-slate-900">
                  ⚙️ Tạo khung mẫu cho tất cả thợ ({(bootstrap.workers || []).filter((w) => w.isActive !== 0).length} thợ)
                </div>
                <div className="text-slate-500 text-[11px]">
                  Tự động tạo 3 dòng trống cho mỗi thợ đang hoạt động theo đúng chuẩn biểu mẫu xưởng.
                </div>
              </div>
            </label>

            {/* Option 3: Bảng trắng */}
            <label className="flex items-start gap-2.5 rounded-lg border border-slate-200 p-3 hover:bg-slate-50 cursor-pointer">
              <input
                type="radio"
                name="newPlanMode"
                value="blank"
                checked={newPlanMode === 'blank'}
                onChange={() => setNewPlanMode('blank')}
                className="mt-0.5 text-blue-600 focus:ring-blue-500"
              />
              <div>
                <div className="font-bold text-slate-900">📄 Bảng trắng hoàn toàn</div>
                <div className="text-slate-500 text-[11px]">
                  Tạo kế hoạch rỗng, cho phép tự thêm từng thợ và mặt hàng thủ công.
                </div>
              </div>
            </label>
          </div>
        </div>
      </Modal>

      {/* ========================================================================= */}
      {/* MODAL 2: SAO CHÉP KẾ HOẠCH SANG NGÀY KHÁC                                 */}
      {/* ========================================================================= */}
      <Modal
        open={showCopyModal}
        onClose={() => setShowCopyModal(false)}
        title="Sao Chép Kế Hoạch Sang Ngày Mới"
        subtitle={`Sao chép toàn bộ ${dailyRows.length} dòng kế hoạch từ ngày ${formatDateVn(selectedDate)}`}
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowCopyModal(false)}
            >
              Hủy
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={handleCopyCurrentSchedule}
              disabled={creatingDate}
              className="bg-indigo-600 font-bold text-white hover:bg-indigo-700"
            >
              {creatingDate ? 'Đang sao chép...' : 'Thực Hiện Sao Chép'}
            </Button>
          </div>
        }
      >
        <div className="space-y-4 text-xs text-slate-800">
          <div>
            <label className="block font-bold text-slate-700 mb-1">
              Ngày đích nhận kế hoạch sao chép:
            </label>
            <input
              type="date"
              value={copyTargetDate}
              onChange={(e) => setCopyTargetDate(e.target.value)}
              className="h-9 w-full rounded-lg border border-slate-300 px-3 text-xs font-bold text-slate-900 focus:border-indigo-600 focus:outline-none"
            />
          </div>

          <label className="flex items-center gap-2 rounded-lg border border-slate-200 p-3 text-slate-700 hover:bg-slate-50 cursor-pointer">
            <input
              type="checkbox"
              checked={copyTargetResetQty}
              onChange={(e) => setCopyTargetResetQty(e.target.checked)}
              className="rounded text-indigo-600 focus:ring-indigo-500"
            />
            <div>
              <span className="font-bold text-slate-900">Đặt lại số lượng kế hoạch = 0</span>
              <div className="text-[11px] text-slate-500">Giữ nguyên danh sách thợ, máy móc và mặt hàng, đặt lại sản lượng để nhập mới.</div>
            </div>
          </label>
        </div>
      </Modal>

      {/* ========================================================================= */}
      {/* MODAL 3: THÊM THỢ VÀO CA / KẾ HOẠCH NGÀY                                   */}
      {/* ========================================================================= */}
      <Modal
        open={showAddWorkerModal}
        onClose={() => setShowAddWorkerModal(false)}
        title="Thêm Thợ Vào Ca / Kế Hoạch Ngày"
        subtitle={`Ngày ${formatDateVn(selectedDate)}`}
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowAddWorkerModal(false)}
            >
              Hủy
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => {
                const activeWorkers = (bootstrap.workers || []).filter((w) => w.isActive !== 0);
                if (!newWorkerName && activeWorkers[0]) {
                  handleAddNewWorker(activeWorkers[0].name, newWorkerShift, newWorkerLineCount);
                } else {
                  handleAddNewWorker(newWorkerName, newWorkerShift, newWorkerLineCount);
                }
              }}
              className="bg-blue-600 font-bold text-white hover:bg-blue-700"
            >
              + Thêm Thợ
            </Button>
          </div>
        }
      >
        <div className="space-y-4 text-xs text-slate-800">
          <div>
            <label className="block font-bold text-slate-700 mb-1">
              Chọn nhân sự thợ:
            </label>
            <select
              value={newWorkerName || ((bootstrap.workers || []).filter((w) => w.isActive !== 0)[0]?.name || '')}
              onChange={(e) => setNewWorkerName(e.target.value)}
              className="h-9 w-full rounded-lg border border-slate-300 px-3 text-xs font-bold text-slate-900 focus:border-blue-600 focus:outline-none"
            >
              {(bootstrap.workers || [])
                .filter((w) => w.isActive !== 0)
                .map((w) => (
                  <option key={w.id} value={w.name}>
                    {w.name} {w.role ? `(${w.role})` : ''}
                  </option>
                ))}
            </select>
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1">
              Ca làm việc:
            </label>
            <select
              value={newWorkerShift}
              onChange={(e) => setNewWorkerShift(e.target.value)}
              className="h-9 w-full rounded-lg border border-slate-300 px-3 text-xs font-bold text-slate-900 focus:border-blue-600 focus:outline-none"
            >
              <option value="Ca 1">Ca 1 (06:00 - 14:00)</option>
              <option value="Ca 2">Ca 2 (14:00 - 22:00)</option>
              <option value="Ca 3">Ca 3 (22:00 - 06:00)</option>
              <option value="Ca Hành chính">Ca Hành chính (08:00 - 17:00)</option>
              <option value="Tăng ca">🔥 Tăng ca (OT)</option>
            </select>
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1">
              Số dòng công việc ban đầu:
            </label>
            <select
              value={newWorkerLineCount}
              onChange={(e) => setNewWorkerLineCount(Number(e.target.value))}
              className="h-9 w-full rounded-lg border border-slate-300 px-3 text-xs font-bold text-slate-900 focus:border-blue-600 focus:outline-none"
            >
              <option value={1}>1 dòng công việc</option>
              <option value={2}>2 dòng công việc</option>
              <option value={3}>3 dòng công việc (Chuẩn Form VICO)</option>
              <option value={4}>4 dòng công việc</option>
              <option value={5}>5 dòng công việc</option>
            </select>
          </div>
        </div>
      </Modal>

      {/* ========================================================================= */}
      {/* MODAL 4: XUẤT FILE & GỬI KẾ HOẠCH VÀO HỘI NHÓM (ZALO / VIBER / EXCEL)    */}
      {/* ========================================================================= */}
      <Modal
        open={showShareModal}
        onClose={() => setShowShareModal(false)}
        title="Xuất File & Gửi Kế Hoạch Vào Hội Nhóm"
        subtitle={`Kế hoạch sản xuất ngày ${formatDateVn(selectedDate)} (Form VICO QT.01.BM01)`}
        maxWidthClass="max-w-2xl"
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2 w-full">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleExportExcel}
                disabled={exportingExcel}
                className="bg-emerald-50 text-emerald-800 border-emerald-300 font-bold hover:bg-emerald-100"
              >
                <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
                {exportingExcel ? 'Đang tải...' : 'Tải File Excel (.xlsx)'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setShowShareModal(false);
                  navigateTo(`/print/daily-schedule?date=${encodeURIComponent(selectedDate)}`);
                }}
                className="font-bold text-slate-700"
              >
                <Printer className="h-4 w-4 text-blue-600" />
                In / Lưu PDF
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setShowShareModal(false)}
              >
                Đóng
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={handleCopyShareText}
                className="bg-blue-600 text-white font-bold hover:bg-blue-700 shadow-sm"
              >
                <Copy className="h-4 w-4" />
                Sao Chép Tin Nhắn Zalo
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-3 text-xs text-slate-800">
          <div className="rounded-lg bg-blue-50/70 p-3 border border-blue-100 text-blue-900 leading-relaxed">
            💡 <strong>Hướng dẫn gửi nhóm:</strong> Bạn có thể bấm <strong>&quot;Sao Chép Tin Nhắn Zalo&quot;</strong> để dán (Ctrl+V) ngay vào nhóm chat của phân xưởng, hoặc bấm <strong>&quot;Tải File Excel (.xlsx)&quot;</strong> để gửi đính kèm file báo cáo đầy đủ theo biểu mẫu VICO.
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="font-bold text-slate-700">
                Nội dung tóm tắt gửi hội nhóm (có thể sửa trước khi gửi):
              </label>
              <button
                type="button"
                onClick={() => setShareText(generateZaloSummary())}
                className="text-[11px] font-bold text-blue-600 hover:underline"
              >
                Khôi phục mặc định
              </button>
            </div>
            <textarea
              rows={12}
              value={shareText}
              onChange={(e) => setShareText(e.target.value)}
              className="w-full rounded-lg border border-slate-300 p-3 font-mono text-[11px] leading-relaxed text-slate-900 focus:border-blue-600 focus:outline-none"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
