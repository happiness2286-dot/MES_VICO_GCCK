import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  Calendar,
  CalendarCheck2,
  CalendarClock,
  CalendarPlus,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
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
import { getFallbackBootstrap } from '@client/lib/clientFallbackStore';
import { DEFAULT_DRIVE_FOLDER_URL } from '@shared/driveHelper';
import { DailyQualityReportSection } from './DailyQualityReportSection';
import type { AdminTabCommonProps } from '../types';

interface DailyDateMeta {
  workDate: string;
  rowCount: number;
  workerCount: number;
}

export function DailyWeeklyScheduleTab({
  bootstrap: rawBootstrap,
  onRefreshBootstrap,
  onNavigateTab,
}: AdminTabCommonProps) {
  const bootstrap = rawBootstrap || getFallbackBootstrap();
  const toast = useToast();
  const [subTab, setSubTab] = useState<'daily' | 'weekly' | 'daily_report'>('daily');

  // ==================== TAB 1: DAILY SCHEDULE STATE ====================
  const [selectedDate, setSelectedDate] = useState<string>('2026-10-21');
  const [selectedShift, setSelectedShift] = useState<string>('ALL');
  const [searchFilter, setSearchFilter] = useState<string>('');
  const [dailyRows, setDailyRows] = useState<DailyPlanRow[]>([]);
  const [availableDates, setAvailableDates] = useState<DailyDateMeta[]>([]);
  const [loadingDates, setLoadingDates] = useState<boolean>(false);
  const [loadingDaily, setLoadingDaily] = useState<boolean>(false);
  const [savingDaily, setSavingDaily] = useState<boolean>(false);

  // Modals state
  const [showNewDateModal, setShowNewDateModal] = useState<boolean>(false);
  const [newPlanDate, setNewPlanDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [newPlanMode, setNewPlanMode] = useState<'copy' | 'template' | 'blank'>('copy');
  const [sourceCopyDate, setSourceCopyDate] = useState<string>('2026-10-21');
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
      const res = await apiClient.get<{ success: boolean; rows: DailyPlanRow[] }>(
        `/schedules/daily?date=${encodeURIComponent(date)}`
      );
      if (res.rows && res.rows.length > 0) {
        setDailyRows(res.rows);
      } else {
        // Generate blank 3-rows template for the 13 active workers if date is empty
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
      const res = await apiClient.get<{ success: boolean; dates: DailyDateMeta[] }>(
        '/schedules/daily-dates'
      );
      if (res.dates) {
        setAvailableDates(res.dates);
        if (res.dates.length > 0 && !sourceCopyDate) {
          setSourceCopyDate(res.dates[0].workDate);
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

      // Cascade logic: if customer changes, reset product and op
      if (field === 'customer') {
        cur.productName = '';
        cur.opName = '';
        cur.spId = '';
        cur.ncId = '';
      }
      // If product changes, auto fill spId and customer if empty, and reset op
      if (field === 'productName') {
        const prod = bootstrap.products.find((p) => p.productName === value);
        if (prod) {
          cur.spId = prod.spId;
          if (!cur.customer) cur.customer = prod.customer;
        }
        cur.opName = '';
        cur.ncId = '';
      }
      // If opName changes, auto fill ncId and default machine
      if (field === 'opName') {
        const op = bootstrap.operations.find(
          (o) => o.opName === value && (!cur.spId || o.spId === cur.spId)
        );
        if (op) {
          cur.ncId = op.ncId;
          if (!cur.machineName && op.defaultMachine) {
            cur.machineName = op.defaultMachine;
          }
        }
      }

      updated[index] = cur;
      return updated;
    });
  };

  // Add extra row for a worker
  const handleAddWorkerRow = (workerName: string, shiftType: string) => {
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
        note: '',
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
      toast.success(`Đã lưu thành công ${dailyRows.length} dòng kế hoạch ngày ${selectedDate}!`);
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
        const res = await apiClient.post<{ success: boolean; targetDate: string; rowCount: number }>(
          '/schedules/daily/copy',
          {
            sourceDate: sourceCopyDate,
            targetDate: newPlanDate,
            resetQty: copyResetQty,
          }
        );
        toast.success(`Đã sao chép thành công ${res.rowCount} dòng từ ngày ${sourceCopyDate} sang ngày ${newPlanDate}!`);
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
        await apiClient.post('/schedules/daily', {
          workDate: newPlanDate,
          rows: blankRows,
        });
        toast.success(`Đã khởi tạo khung kế hoạch ngày ${newPlanDate} cho ${activeWorkers.length} thợ!`);
      } else {
        // blank mode
        await apiClient.post('/schedules/daily', {
          workDate: newPlanDate,
          rows: [],
        });
        toast.success(`Đã tạo bảng kế hoạch trắng cho ngày ${newPlanDate}!`);
      }

      await loadAvailableDates();
      setSelectedDate(newPlanDate);
      setShowNewDateModal(false);
      await loadDailyRows(newPlanDate);
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
      const res = await apiClient.post<{ success: boolean; targetDate: string; rowCount: number }>(
        '/schedules/daily/copy',
        {
          sourceDate: selectedDate,
          targetDate: copyTargetDate,
          resetQty: copyTargetResetQty,
        }
      );
      toast.success(`Đã sao chép thành công ${res.rowCount} dòng từ ngày ${selectedDate} sang ngày ${copyTargetDate}!`);
      await loadAvailableDates();
      setSelectedDate(copyTargetDate);
      setShowCopyModal(false);
      await loadDailyRows(copyTargetDate);
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
      toast.success(`Đã xóa kế hoạch ngày ${selectedDate}!`);
      const updatedDates = availableDates.filter((d) => d.workDate !== selectedDate);
      setAvailableDates(updatedDates);
      if (updatedDates.length > 0) {
        setSelectedDate(updatedDates[0].workDate);
      } else {
        setSelectedDate('2026-10-21');
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
        note: '',
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
          text += `   ${idx + 1}. ${cust}${r.productName || 'Chi tiết'} - ${r.opName || 'Theo bản vẽ'} | SL: ${r.plannedQty}${mach}${note}\n`;
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
      if (selectedShift !== 'ALL' && r.shiftType !== selectedShift) return false;
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
      if (selectedShift !== 'ALL' && row.shiftType !== selectedShift) return;
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

  // ==================== TAB 2: WEEKLY REPORT STATE ====================
  const [weeklyStart, setWeeklyStart] = useState<string>('2026-10-15');
  const [weeklyReport, setWeeklyReport] = useState<WeeklyReportData | null>(null);
  const [loadingWeekly, setLoadingWeekly] = useState<boolean>(false);
  const [newIncidentMachine, setNewIncidentMachine] = useState<string>('');
  const [newIncidentStopMin, setNewIncidentStopMin] = useState<number>(30);
  const [newIncidentReason, setNewIncidentReason] = useState<string>('');
  const [newIncidentNote, setNewIncidentNote] = useState<string>('');
  const [addingIncident, setAddingIncident] = useState<boolean>(false);

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
      {/* Sub-tab Navigation Banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex items-center gap-1.5 rounded-xl bg-slate-100 p-1">
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
            <span>2. Báo Cáo Tuần (Thứ 5 &rarr; Thứ 4) &amp; Cân Bằng Tải</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('daily_report')}
            className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-bold transition-all ${
              subTab === 'daily_report'
                ? 'bg-blue-600 text-white shadow-sm'
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
                      const todayStr = new Date().toISOString().slice(0, 10);
                      setSelectedDate(todayStr);
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
                      {['ALL', 'Ca 1', 'Ca 2', 'Ca 3', 'Ca Hành chính'].map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setSelectedShift(s)}
                          className={`rounded-md px-2.5 py-1 text-xs font-bold transition-all ${
                            selectedShift === s
                              ? 'bg-white text-blue-700 shadow-sm'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          {s === 'ALL' ? 'Tất Cả Ca' : s}
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
              {rowsByWorker.map(([workerName, workerRows]) => (
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
                      </select>

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
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[900px] border-collapse text-left text-xs text-slate-900">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-100/70 text-[11px] font-extrabold uppercase text-slate-700">
                          <th className="w-10 px-3 py-2 text-center">#</th>
                          <th className="w-40 px-3 py-2">Khách Hàng (1)</th>
                          <th className="px-3 py-2">Sản Phẩm / Bản Vẽ (2)</th>
                          <th className="px-3 py-2">Công Đoạn HT (3)</th>
                          <th className="w-24 px-2 py-2 text-center">Kế Hoạch</th>
                          <th className="w-48 px-3 py-2">Máy / Ca</th>
                          <th className="w-44 px-3 py-2">Ghi Chú</th>
                          <th className="w-20 px-2 py-2 text-center">Mã QR</th>
                          <th className="w-10 px-2 py-2 text-center"></th>
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
                              <td className="px-3 py-2 text-center font-mono font-bold text-slate-500">
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
                                <input
                                  type="number"
                                  min={0}
                                  step="any"
                                  value={row.plannedQty}
                                  onChange={(e) =>
                                    handleRowChange(
                                      originalIdx,
                                      'plannedQty',
                                      Number(e.target.value) || 0
                                    )
                                  }
                                  className="font-mono-num h-8 w-20 rounded-md border border-slate-300 px-1 text-center text-xs font-extrabold text-blue-700 focus:border-blue-600 focus:outline-none"
                                />
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

                              {/* Ghi chú */}
                              <td className="px-2 py-1.5">
                                <input
                                  type="text"
                                  value={row.note || ''}
                                  onChange={(e) =>
                                    handleRowChange(originalIdx, 'note', e.target.value)
                                  }
                                  placeholder="Ghi chú / Tăng ca..."
                                  className="h-8 w-full rounded-md border border-slate-300 px-2 text-xs text-slate-800 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
                                />
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
              ))}
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

                {/* 4 Metric Cards */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Card className="border-slate-200 bg-white p-3 text-center">
                    <div className="text-[11px] font-bold uppercase text-slate-500">
                      Tổng Kế Hoạch
                    </div>
                    <div className="font-mono-num mt-1 text-xl font-black text-slate-900">
                      {weeklyReport.summary.totalPlannedQty} SP
                    </div>
                  </Card>
                  <Card className="border-slate-200 bg-white p-3 text-center">
                    <div className="text-[11px] font-bold uppercase text-slate-500">
                      Thực Tế Đã Làm
                    </div>
                    <div className="font-mono-num mt-1 text-xl font-black text-emerald-700">
                      {weeklyReport.summary.totalActualQty} SP
                    </div>
                  </Card>
                  <Card className="border-slate-200 bg-white p-3 text-center">
                    <div className="text-[11px] font-bold uppercase text-slate-500">
                      Đơn Đạt Kế Hoạch
                    </div>
                    <div className="font-mono-num mt-1 text-xl font-black text-blue-700">
                      {weeklyReport.summary.completedPoCount} PO
                    </div>
                  </Card>
                  <Card className="border-slate-200 bg-white p-3 text-center">
                    <div className="text-[11px] font-bold uppercase text-slate-500">
                      Đơn Trượt Kế Hoạch
                    </div>
                    <div className="font-mono-num mt-1 text-xl font-black text-rose-700">
                      {weeklyReport.summary.delayedPoCount} PO
                    </div>
                  </Card>
                </div>

                {/* Customer Stats Table */}
                <Card className="overflow-hidden border-slate-200 bg-white p-0">
                  <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 font-bold text-xs text-slate-800">
                    Chi tiết sản lượng theo từng đối tác khách hàng
                  </div>
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-100/60 font-bold uppercase text-slate-600">
                        <th className="px-4 py-2">Khách Hàng</th>
                        <th className="px-3 py-2 text-center">Số Mặt Hàng</th>
                        <th className="px-3 py-2 text-center">Kế Hoạch</th>
                        <th className="px-3 py-2 text-center">Thực Tế</th>
                        <th className="px-3 py-2 text-center">Tỷ Lệ %</th>
                        <th className="px-4 py-2">Trạng Thái Đơn</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-semibold text-slate-900">
                      {weeklyReport.customerStats.map((cs) => (
                        <tr key={cs.customer} className="hover:bg-slate-50">
                          <td className="px-4 py-2 font-extrabold text-blue-700">{cs.customer}</td>
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
                        </tr>
                      ))}
                    </tbody>
                  </table>
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
