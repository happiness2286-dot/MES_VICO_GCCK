import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Camera,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  ClipboardCheck,
  Download,
  Edit3,
  FileSpreadsheet,
  GitCommit,
  Microscope,
  PackageCheck,
  Plus,
  Printer,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Truck,
  XCircle,
} from 'lucide-react';
import type {
  HandoverDept,
  HandoverSlipRow,
  ProductionLogDto,
  QcInspectionDto,
  TraceabilityDto,
} from '@shared/types';
import { matchesSearch, normalizeVn } from '@shared/vnSearch';
import { apiClient } from '@client/lib/apiClient';
import { clearAllClientStoredLogs, deleteFallbackHandover, getAllFallbackLogs, getFallbackBootstrap, getFallbackHandovers, saveFallbackHandover, getFallbackTraceability, saveClientStoredLog, syncClientStoredLogsWithCloud, updateFallbackLog, deleteFallbackLog } from '@client/lib/clientFallbackStore';
import { buildConsolidatedQcList } from '@client/lib/qcLogHelper';
import { downloadDailyLogsExcel } from '@client/lib/excelService';
import { deleteAllLogsFromSupabase, fetchLogsFromSupabase, subscribeSupabaseLogChanges, updateLogOnSupabase } from '@client/lib/supabaseClient';
import {
  formatDateVn,
  formatVnd,
  normalizeQcMeasuredDims,
} from '@client/lib/formatters';
import { navigateTo } from '@client/lib/navigation';
import {
  Badge,
  Button,
  Card,
  Modal,
  PaginationBar,
  useToast,
} from '@client/components/ui/IndustrialPrimitives';
import { useAuth } from '@client/context/AuthContext';
import type { AdminTabCommonProps } from '../types';

type SubViewMode = 'LOGS' | 'QC' | 'TRACE' | 'HANDOVER';
type LogIssueFilter = 'ALL' | 'HAS_NG' | 'PENDING_QC' | 'HANDOVER' | 'VOIDED';

interface MeasuredDimRow {
  feature: string;
  nominal: number;
  tolPlusMinus: number;
  measured: number;
}

export function LogsQcTraceTab({
  bootstrap: rawBootstrap,
  onRefreshBootstrap,
  onNavigateTab,
  deepLink,
}: AdminTabCommonProps) {
  const bootstrap = rawBootstrap || getFallbackBootstrap();
  const toast = useToast();
  const { user } = useAuth();
  const isAdmin = user?.appRole === 'ADMIN' || user?.appRole === 'DIRECTOR';
  const canEditLogs = user?.appRole === 'ADMIN' || user?.appRole === 'SHIFT_LEADER';
  const [resettingData, setResettingData] = useState(false);

  const handleResetProductionLogs = async () => {
    const confirmReset = window.confirm(
      '⚠️ XÁC NHẬN LÀM MỚI TOÀN BỘ:\n\nBạn có chắc chắn muốn xóa toàn bộ dữ liệu nhật ký ca cũ để bắt đầu nhập mới từ Tháng 11 không?\n\n(Hành động này sẽ làm sạch dữ liệu cả trên máy chủ, Supabase Cloud và bộ nhớ tạm trình duyệt)'
    );
    if (!confirmReset) return;

    setResettingData(true);
    try {
      // 1. Clear Supabase Cloud logs
      await deleteAllLogsFromSupabase();

      // 2. Clear backend SQLite database (if server running)
      try {
        await apiClient.post('/admin/reset-production-data', {});
      } catch (e) {
        console.warn('Backend reset call:', e);
      }

      // 3. Clear local browser storage
      clearAllClientStoredLogs();

      // 4. Reset local component state
      setLogs([]);

      if (onRefreshBootstrap) {
        await onRefreshBootstrap();
      }

      toast.success('✨ Đã làm mới toàn bộ dữ liệu nhật ký sản xuất về 0 cho Tháng 11!');
    } catch (err: any) {
      toast.error(err?.message || 'Có lỗi khi làm mới dữ liệu.');
    } finally {
      setResettingData(false);
    }
  };

  const [subView, setSubView] = useState<SubViewMode>(deepLink?.logsSubView || 'LOGS');

  // ==================== SUB-VIEW A: LOGS STATE ====================
  const [logs, setLogs] = useState<ProductionLogDto[]>(bootstrap.recentLogs || []);
  const [logSearch, setLogSearch] = useState('');
  const [logDateFilter, setLogDateFilter] = useState('');
  const [logShiftFilter, setLogShiftFilter] = useState('ALL');
  const [logWorkerFilter, setLogWorkerFilter] = useState('ALL');
  const [logMachineFilter, setLogMachineFilter] = useState('ALL');
  const [logIssueFilter, setLogIssueFilter] = useState<LogIssueFilter>('ALL');
  const [logPage, setLogPage] = useState(1);
  const [logPageSize, setLogPageSize] = useState(50);
  const [exportingLogs, setExportingLogs] = useState(false);

  // Edit / Void Log Modal
  const [editLog, setEditLog] = useState<ProductionLogDto | null>(null);
  const [editWorkDate, setEditWorkDate] = useState('');
  const [editShiftType, setEditShiftType] = useState('Ca 1 (06:00-14:00)');
  const [editMachineName, setEditMachineName] = useState('');
  const [editMachineMode, setEditMachineMode] = useState<'FIRST' | 'SECOND'>('FIRST');
  const [editPoId, setEditPoId] = useState('');
  const [editNcId, setEditNcId] = useState('');
  const [editStdSeconds, setEditStdSeconds] = useState(1800);
  const [editStopMinutes, setEditStopMinutes] = useState(0);
  const [editOkQty, setEditOkQty] = useState(0);
  const [editReworkQty, setEditReworkQty] = useState(0);
  const [editScrapQty, setEditScrapQty] = useState(0);
  const [editQcStatus, setEditQcStatus] = useState<'PASSED' | 'PENDING_QC' | 'NG_HOLD'>('PASSED');
  const [editIsVoided, setEditIsVoided] = useState(false);
  const [savingLogEdit, setSavingLogEdit] = useState(false);

  // Photo Preview Modal
  const [previewPhotoLog, setPreviewPhotoLog] = useState<ProductionLogDto | null>(null);

  // ==================== SUB-VIEW B: QC 3-TIER STATE ====================
  const [explicitQcList, setExplicitQcList] = useState<QcInspectionDto[]>(bootstrap.qcInspections || []);

  // Tự động tổng hợp 100% biên bản kiểm soát chất lượng từ Nhật ký ca của thợ + hồ sơ QC chính thức
  const qcList = useMemo(() => {
    return buildConsolidatedQcList(explicitQcList, logs);
  }, [explicitQcList, logs]);
  const [qcTypeFilter, setQcTypeFilter] = useState<string>('ALL');
  const [qcSearch, setQcSearch] = useState('');
  const [qcPage, setQcPage] = useState(1);
  const [qcPageSize, setQcPageSize] = useState(25);

  // Create QC Modal State
  const [createQcOpen, setCreateQcOpen] = useState(false);
  const [qcInspType, setQcInspType] = useState<'FAI' | 'IPQC' | 'OQC' | 'NG_REVIEW'>('FAI');
  const [qcPoId, setQcPoId] = useState(bootstrap.ordersList[0]?.poId || '');
  const [qcNcId, setQcNcId] = useState('');
  const [qcMachineName, setQcMachineName] = useState(bootstrap.machines[0]?.name || '');
  const [qcOperatorId, setQcOperatorId] = useState(bootstrap.workers[0]?.id || '');
  const [qcSampleSize, setQcSampleSize] = useState(3);
  const [qcDefectQty, setQcDefectQty] = useState(0);
  const [qcResult, setQcResult] = useState<'PASS' | 'CONCESSION' | 'REWORK' | 'SCRAP'>('PASS');
  const [qcRootCause, setQcRootCause] = useState('');
  const [qcCorrective, setQcCorrective] = useState('');
  const [qcDims, setQcDims] = useState<MeasuredDimRow[]>([
    { feature: 'Đường kính lỗ tinh Ø', nominal: 40.0, tolPlusMinus: 0.01, measured: 40.004 },
    { feature: 'Chiều dày bậc vai L', nominal: 25.0, tolPlusMinus: 0.02, measured: 24.992 },
  ]);
  const [submittingQc, setSubmittingQc] = useState(false);

  // ==================== SUB-VIEW C: TRACEABILITY STATE ====================
  const defaultTracePo =
    deepLink?.tracePoId || bootstrap.ordersList[0]?.poId || 'PO485-01';
  const [tracePoInput, setTracePoInput] = useState(defaultTracePo);
  const [traceData, setTraceData] = useState<TraceabilityDto | null>(null);
  const [loadingTrace, setLoadingTrace] = useState(false);
  const [traceError, setTraceError] = useState('');

  useEffect(() => {
    if (deepLink?.logsSubView) setSubView(deepLink.logsSubView);
    if (deepLink?.tracePoId) {
      setTracePoInput(deepLink.tracePoId);
      void fetchTraceability(deepLink.tracePoId);
    }
  }, [deepLink?.logsSubView, deepLink?.tracePoId]);

  const reloadLogs = async () => {
    try {
      // 1. Authoritative backend API (SQLite server)
      let serverLogs: ProductionLogDto[] = [];
      try {
        const res = await apiClient.get<{ items: ProductionLogDto[] }>('/logs?includeVoided=1');
        if (res?.items && Array.isArray(res.items)) {
          serverLogs = res.items;
        }
      } catch (apiErr) {
        console.warn('API /logs fetch error (falling back to cloud/local):', apiErr);
      }

      // 2. Supabase cloud logs (if configured)
      let sbLogs: ProductionLogDto[] | null = null;
      try {
        sbLogs = await fetchLogsFromSupabase();
      } catch {
        sbLogs = null;
      }

      if (sbLogs && sbLogs.length > 0) {
        syncClientStoredLogsWithCloud(sbLogs);
      }

      // 3. Fallback client stored logs (from offline/phone storage)
      const localFallbackLogs = getAllFallbackLogs();

      // 4. Merge all sources, deduplicating by recordUid or id, newest first (Supabase Cloud is authoritative over stale local storage)
      const mergedMap = new Map<string, ProductionLogDto>();

      if (bootstrap?.recentLogs) {
        for (const l of bootstrap.recentLogs) {
          if (!l || (!l.workerName && !l.workerId)) continue;
          mergedMap.set(l.recordUid || String(l.id), l);
        }
      }

      for (const l of localFallbackLogs) {
        if (!l || (!l.workerName && !l.workerId)) continue;
        const key = l.recordUid || String(l.id);
        mergedMap.set(key, l);
      }

      for (const l of serverLogs) {
        if (!l || (!l.workerName && !l.workerId)) continue;
        mergedMap.set(l.recordUid || String(l.id), l);
      }

      if (sbLogs && sbLogs.length > 0) {
        for (const l of sbLogs) {
          if (!l || (!l.workerName && !l.workerId)) continue;
          mergedMap.set(l.recordUid || String(l.id), l);
        }
      }

      const finalList = Array.from(mergedMap.values()).sort((a, b) => {
        const tA = new Date(a.createdAt || a.workDate).getTime() || 0;
        const tB = new Date(b.createdAt || b.workDate).getTime() || 0;
        return tB - tA;
      });

      setLogs(finalList.length > 0 ? finalList : (bootstrap.recentLogs || []));
    } catch {
      setLogs(bootstrap.recentLogs || []);
    }
  };

  useEffect(() => {
    if (bootstrap?.recentLogs && bootstrap.recentLogs.length > 0) {
      setLogs((current) => {
        if (current.length === 0) return bootstrap.recentLogs;
        const map = new Map<string, ProductionLogDto>();
        for (const l of current) {
          map.set(l.recordUid || String(l.id), l);
        }
        for (const l of bootstrap.recentLogs) {
          map.set(l.recordUid || String(l.id), l);
        }
        return Array.from(map.values()).sort((a, b) => {
          const tA = new Date(a.createdAt || a.workDate).getTime() || 0;
          const tB = new Date(b.createdAt || b.workDate).getTime() || 0;
          return tB - tA;
        });
      });
    }
  }, [bootstrap?.recentLogs]);

  const reloadQc = async () => {
    try {
      const res = await apiClient.get<{ items: QcInspectionDto[] }>('/qc');
      if (res?.items && Array.isArray(res.items)) {
        setExplicitQcList(res.items);
      }
    } catch {
      setExplicitQcList(bootstrap.qcInspections || []);
    }
  };

  const fetchTraceability = async (poId: string) => {
    const clean = poId.trim();
    if (!clean) return;
    setLoadingTrace(true);
    setTraceError('');
    try {
      const dto = await apiClient.get<TraceabilityDto>(
        `/orders/${encodeURIComponent(clean)}/traceability`
      );
      if (dto && dto.po && dto.po.poId) {
        setTraceData(dto);
      } else {
        setTraceData(getFallbackTraceability(clean));
      }
    } catch (err: any) {
      setTraceData(getFallbackTraceability(clean));
    } finally {
      setLoadingTrace(false);
    }
  };

  // ==================== SUB-VIEW D: HANDOVER BM.GC.01.02 STATE ====================
  const HANDOVER_SENDER_OPTIONS = [
    'Hoàng Ngọc Hà',
    'Lê Trung Hải',
    'Nguyễn Văn Duy',
    'Trần Văn Quỳnh',
    'Trần Văn Dũng',
    'Phạm Văn Tráng',
    'Phùng Gia Phúc',
  ];

  const HANDOVER_RECEIVER_OPTIONS = [
    'Phùng Gia Phúc',
    'Phạm Văn Tráng',
    'Trần Văn Dũng',
    'Lê Trung Hải',
    'Nguyễn Văn Duy',
    'Hoàng Ngọc Hà',
    'Trần Văn Quỳnh',
  ];

  type HandoverMetricFilter = 'ALL' | 'OK' | 'DEFECT' | 'RAW_DEFECT';
  const [hoMetricFilter, setHoMetricFilter] = useState<HandoverMetricFilter>('ALL');

  // Trạng thái Thu Lên / Trải Xuống cho cả 4 mục Bàn Giao BM.GC.01.02
  const [hoExpandedByMetric, setHoExpandedByMetric] = useState<Record<HandoverMetricFilter, boolean>>({
    ALL: true,
    OK: true,
    DEFECT: true,
    RAW_DEFECT: true,
  });

  const toggleHoMetricExpanded = (metric: HandoverMetricFilter) => {
    setHoExpandedByMetric((prev) => ({
      ...prev,
      [metric]: !prev[metric],
    }));
  };

  const toggleAllHoMetrics = (expanded: boolean) => {
    setHoExpandedByMetric({
      ALL: expanded,
      OK: expanded,
      DEFECT: expanded,
      RAW_DEFECT: expanded,
    });
  };

  const [handovers, setHandovers] = useState<HandoverSlipRow[]>(() => getFallbackHandovers());
  const [hoSearch, setHoSearch] = useState('');
  const [hoDateFilter, setHoDateFilter] = useState('');
  const [hoDeptFilter, setHoDeptFilter] = useState<'ALL' | HandoverDept>('ALL');
  const [hoModalOpen, setHoModalOpen] = useState(false);
  const [editingHoId, setEditingHoId] = useState<string | null>(null);

  // New / Edit Handover Form State
  const [hoDate, setHoDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [hoFromDept, setHoFromDept] = useState<HandoverDept>('PX_GIA_CONG');
  const [hoToDept, setHoToDept] = useState<HandoverDept>('PX_NHIET_LUYEN');
  const [hoSelectedPo, setHoSelectedPo] = useState(bootstrap.ordersList[0]?.poId || 'PO485-01');
  const [hoProdName, setHoProdName] = useState(bootstrap.ordersList[0]?.productName || 'ALKTOP 1342 M');
  const [hoCustomer, setHoCustomer] = useState(bootstrap.ordersList[0]?.customer || 'Win-Win - PO485');
  const [hoUnit, setHoUnit] = useState('Cái');
  const [hoProdQtyTransferred, setHoProdQtyTransferred] = useState(50);
  const [hoProdQtyDefect, setHoProdQtyDefect] = useState(0);
  const [hoProdQtyMissing, setHoProdQtyMissing] = useState(0);
  const [hoRawQtyTransferred, setHoRawQtyTransferred] = useState(50);
  const [hoRawQtyDefect, setHoRawQtyDefect] = useState(0);
  const [hoRawQtyMissing, setHoRawQtyMissing] = useState(0);
  const [hoNote, setHoNote] = useState('');
  const [hoReceiver, setHoReceiver] = useState('Trần Văn Dũng');
  const [hoSender, setHoSender] = useState(user?.name || 'Hoàng Ngọc Hà');
  const [customSenderMode, setCustomSenderMode] = useState(false);
  const [customReceiverMode, setCustomReceiverMode] = useState(false);
  const [submittingHo, setSubmittingHo] = useState(false);
  const [isHoPoSummaryExpanded, setIsHoPoSummaryExpanded] = useState(true);

  // Prior transfers calculation for the currently selected PO in the modal
  const priorProdTransferred = useMemo(() => {
    if (!hoSelectedPo && !hoProdName) return 0;
    const cleanPoId = (hoSelectedPo || '').trim().toLowerCase();
    const cleanProd = (hoProdName || '').trim().toLowerCase();
    return handovers
      .filter((h) =>
        (!editingHoId || h.id !== editingHoId) &&
        ((cleanPoId && (h.poId || '').trim().toLowerCase() === cleanPoId) ||
          (cleanProd && (h.productName || '').trim().toLowerCase() === cleanProd))
      )
      .reduce((sum, h) => sum + (Number(h.prodQtyTransferred) || 0), 0);
  }, [handovers, editingHoId, hoSelectedPo, hoProdName]);

  const priorRawTransferred = useMemo(() => {
    if (!hoSelectedPo && !hoProdName) return 0;
    const cleanPoId = (hoSelectedPo || '').trim().toLowerCase();
    const cleanProd = (hoProdName || '').trim().toLowerCase();
    return handovers
      .filter((h) =>
        (!editingHoId || h.id !== editingHoId) &&
        ((cleanPoId && (h.poId || '').trim().toLowerCase() === cleanPoId) ||
          (cleanProd && (h.productName || '').trim().toLowerCase() === cleanProd))
      )
      .reduce((sum, h) => sum + (Number(h.rawQtyTransferred) || 0), 0);
  }, [handovers, editingHoId, hoSelectedPo, hoProdName]);

  // Aggregate handovers by PO & Product for the "Tất Cả Các Phân Xưởng" cumulative view
  const poHandoversSummary = useMemo(() => {
    const map = new Map<string, {
      poId: string;
      productName: string;
      customer: string;
      qtyPo: number;
      wipQty: number;
      slips: HandoverSlipRow[];
      dates: { date: string; qty: number; from: HandoverDept; to: HandoverDept; defect: number }[];
      totalBtp: number;
      totalRaw: number;
      totalDefect: number;
      totalRawDefect: number;
      missingQty: number;
      progressPct: number;
      interWorkshopRoutes: { route: string; qty: number; defect: number }[];
    }>();

    for (const h of handovers) {
      const key = (h.poId || h.productName || 'UNKNOWN').trim().toUpperCase();
      if (!map.has(key)) {
        const cleanPoId = (h.poId || '').trim().toLowerCase();
        const cleanProd = (h.productName || '').trim().toLowerCase();
        const po = bootstrap.ordersList.find((p) =>
          (cleanPoId && p.poId.toLowerCase() === cleanPoId) ||
          (cleanProd && p.productName.trim().toLowerCase() === cleanProd)
        );
        map.set(key, {
          poId: h.poId || po?.poId || '—',
          productName: h.productName || po?.productName || '—',
          customer: h.customer || po?.customer || 'Nội bộ',
          qtyPo: po?.qtyPo || 0,
          wipQty: po?.wipQty || 0,
          slips: [],
          dates: [],
          totalBtp: 0,
          totalRaw: 0,
          totalDefect: 0,
          totalRawDefect: 0,
          missingQty: 0,
          progressPct: 0,
          interWorkshopRoutes: [],
        });
      }

      const item = map.get(key)!;
      item.slips.push(h);
      const btp = Number(h.prodQtyTransferred || 0);
      const raw = Number(h.rawQtyTransferred || 0);
      const def = Number(h.prodQtyDefect || 0);
      const rawDef = Number(h.rawQtyDefect || 0);

      item.totalBtp += btp;
      item.totalRaw = Math.max(item.totalRaw, raw);
      item.totalDefect += def;
      item.totalRawDefect += rawDef;

      item.dates.push({
        date: h.handoverDate,
        qty: btp,
        from: h.fromDept,
        to: h.toDept,
        defect: def,
      });

      const fromName = h.fromDept === 'PX_GIA_CONG' ? 'Gia Công' : h.fromDept === 'PX_NHIET_LUYEN' ? 'Nhiệt Luyện' : h.fromDept === 'PX_HOAN_THIEN' ? 'Hoàn Thiện' : 'KHVT';
      const toName = h.toDept === 'PX_GIA_CONG' ? 'Gia Công' : h.toDept === 'PX_NHIET_LUYEN' ? 'Nhiệt Luyện' : h.toDept === 'PX_HOAN_THIEN' ? 'Hoàn Thiện' : 'KHVT';
      const routeKey = `${fromName} ➔ ${toName}`;
      const existingRoute = item.interWorkshopRoutes.find((r) => r.route === routeKey);
      if (existingRoute) {
        existingRoute.qty += btp;
        existingRoute.defect += def;
      } else {
        item.interWorkshopRoutes.push({ route: routeKey, qty: btp, defect: def });
      }
    }

    for (const item of map.values()) {
      const targetQty = item.qtyPo > 0 ? item.qtyPo : item.totalBtp;
      item.missingQty = Math.max(0, targetQty - item.totalBtp);
      item.progressPct = targetQty > 0 ? Math.min(100, Math.round((item.totalBtp / targetQty) * 100)) : 100;
    }

    return Array.from(map.values()).sort((a, b) => b.totalBtp - a.totalBtp);
  }, [handovers, bootstrap.ordersList]);

  const reloadHandovers = async () => {
    try {
      const data = await apiClient.get<HandoverSlipRow[]>('/handovers');
      setHandovers(data && data.length > 0 ? data : getFallbackHandovers());
    } catch {
      setHandovers(getFallbackHandovers());
    }
  };

  const handleOpenEditHandover = (row: HandoverSlipRow) => {
    setEditingHoId(row.id);
    setHoDate(row.handoverDate || new Date().toISOString().slice(0, 10));
    setHoFromDept(row.fromDept);
    setHoToDept(row.toDept);
    setHoSelectedPo(row.poId || '');
    setHoProdName(row.productName);
    setHoCustomer(row.customer);
    setHoUnit(row.unit || 'Cái');
    setHoProdQtyTransferred(row.prodQtyTransferred || 0);
    setHoProdQtyDefect(row.prodQtyDefect || 0);
    setHoProdQtyMissing(row.prodQtyMissing || 0);
    setHoRawQtyTransferred(row.rawQtyTransferred || 0);
    setHoRawQtyDefect(row.rawQtyDefect || 0);
    setHoRawQtyMissing(row.rawQtyMissing || 0);
    setHoNote(row.note || '');
    const rec = row.receiverName || 'Trần Văn Dũng';
    const snd = row.senderName || user?.name || 'Hoàng Ngọc Hà';
    setHoReceiver(rec);
    setHoSender(snd);
    setCustomReceiverMode(Boolean(rec && !HANDOVER_RECEIVER_OPTIONS.includes(rec)));
    setCustomSenderMode(Boolean(snd && !HANDOVER_SENDER_OPTIONS.includes(snd)));
    setHoModalOpen(true);
  };

  const handleOpenCreateHandover = () => {
    setEditingHoId(null);
    setHoDate(new Date().toISOString().slice(0, 10));
    setHoFromDept('PX_GIA_CONG');
    setHoToDept('PX_HOAN_THIEN');
    const firstPo = bootstrap.ordersList[0];
    const poQty = firstPo?.qtyPo || 0;
    const cleanPoId = (firstPo?.poId || '').trim().toLowerCase();
    const cleanProd = (firstPo?.productName || '').trim().toLowerCase();
    const priorBtp = handovers
      .filter((h) => (cleanPoId && (h.poId || '').trim().toLowerCase() === cleanPoId) || (cleanProd && (h.productName || '').trim().toLowerCase() === cleanProd))
      .reduce((sum, h) => sum + (Number(h.prodQtyTransferred) || 0), 0);
    const priorRaw = handovers
      .filter((h) => (cleanPoId && (h.poId || '').trim().toLowerCase() === cleanPoId) || (cleanProd && (h.productName || '').trim().toLowerCase() === cleanProd))
      .reduce((sum, h) => sum + (Number(h.rawQtyTransferred) || 0), 0);

    const suggestedBtp = Math.max(0, poQty - priorBtp);
    const suggestedRaw = Math.max(0, poQty - priorRaw);

    setHoSelectedPo(firstPo?.poId || '');
    setHoProdName(firstPo?.productName || '');
    setHoCustomer(firstPo?.customer || '');
    setHoUnit('Cái');
    setHoProdQtyTransferred(suggestedBtp > 0 ? suggestedBtp : 1);
    setHoProdQtyDefect(0);
    setHoProdQtyMissing(Math.max(0, poQty - (priorBtp + (suggestedBtp > 0 ? suggestedBtp : 1))));
    setHoRawQtyTransferred(suggestedRaw > 0 ? suggestedRaw : poQty);
    setHoRawQtyDefect(0);
    setHoRawQtyMissing(Math.max(0, poQty - (priorRaw + (suggestedRaw > 0 ? suggestedRaw : poQty))));
    setHoNote('');
    setHoReceiver('Trần Văn Dũng');
    setHoSender(user?.name || 'Hoàng Ngọc Hà');
    setCustomSenderMode(false);
    setCustomReceiverMode(false);
    setHoModalOpen(true);
  };

  const handleDeleteHandover = async (id: string) => {
    if (!window.confirm('Bạn có chắc muốn xóa phiếu bàn giao này không?')) return;
    try {
      await apiClient.delete(`/handovers/${id}`);
    } catch {
      // fallback
    }
    deleteFallbackHandover(id);
    setHandovers((prev) => prev.filter((h) => h.id !== id));
    toast.success('Đã xóa phiếu bàn giao thành công.');
  };

  const handleSelectPoForHandover = (poId: string) => {
    setHoSelectedPo(poId);
    const po = bootstrap.ordersList.find((p) => p.poId === poId);
    if (po) {
      setHoProdName(po.productName);
      setHoCustomer(po.customer);
      const poQty = po.qtyPo || 0;
      const cleanPoId = poId.trim().toLowerCase();
      const cleanProd = po.productName.trim().toLowerCase();
      const priorBtp = handovers
        .filter((h) => (!editingHoId || h.id !== editingHoId) && ((cleanPoId && (h.poId || '').trim().toLowerCase() === cleanPoId) || (cleanProd && (h.productName || '').trim().toLowerCase() === cleanProd)))
        .reduce((sum, h) => sum + (Number(h.prodQtyTransferred) || 0), 0);
      const priorRaw = handovers
        .filter((h) => (!editingHoId || h.id !== editingHoId) && ((cleanPoId && (h.poId || '').trim().toLowerCase() === cleanPoId) || (cleanProd && (h.productName || '').trim().toLowerCase() === cleanProd)))
        .reduce((sum, h) => sum + (Number(h.rawQtyTransferred) || 0), 0);

      const suggestedBtp = Math.max(0, poQty - priorBtp);
      const suggestedRaw = Math.max(0, poQty - priorRaw);

      setHoProdQtyTransferred(suggestedBtp > 0 ? suggestedBtp : 1);
      setHoProdQtyDefect(0);
      setHoProdQtyMissing(Math.max(0, poQty - (priorBtp + (suggestedBtp > 0 ? suggestedBtp : 1))));
      setHoRawQtyTransferred(suggestedRaw > 0 ? suggestedRaw : poQty);
      setHoRawQtyDefect(0);
      setHoRawQtyMissing(Math.max(0, poQty - (priorRaw + (suggestedRaw > 0 ? suggestedRaw : poQty))));
    }
  };

  const handleFillFromShiftLogs = () => {
    const matchingLogs = logs.filter(
      (l) => !l.isVoided && (l.poId === hoSelectedPo || l.productName === hoProdName)
    );
    if (matchingLogs.length === 0) {
      toast.info('Không tìm thấy nhật ký ca gần đây cho sản phẩm này. Giữ nguyên số liệu.');
      return;
    }
    const totOk = matchingLogs.reduce((acc, l) => acc + (l.okQty || 0), 0);
    const totNg = matchingLogs.reduce((acc, l) => acc + (l.scrapQty || 0), 0);
    setHoProdQtyTransferred(totOk);
    setHoProdQtyDefect(totNg);
    toast.success(`Đã tự động điền từ nhật ký ca: ${totOk} Đạt OK, ${totNg} Lỗi NG.`);
  };

  const handleSaveHandover = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hoProdName.trim()) {
      toast.warning('Vui lòng nhập Tên sản phẩm bàn giao.');
      return;
    }
    setSubmittingHo(true);
    try {
      const rowId = editingHoId || `HO-${Date.now()}`;
      const existingRow = editingHoId ? handovers.find((h) => h.id === editingHoId) : null;
      const targetRow: HandoverSlipRow = {
        id: rowId,
        handoverDate: hoDate,
        fromDept: hoFromDept,
        toDept: hoToDept,
        poId: hoSelectedPo,
        productName: hoProdName.trim(),
        customer: hoCustomer.trim() || 'Nội bộ',
        unit: hoUnit || 'Cái',
        prodQtyTransferred: Number(hoProdQtyTransferred) || 0,
        prodQtyDefect: Number(hoProdQtyDefect) || 0,
        prodQtyMissing: Number(hoProdQtyMissing) || 0,
        rawQtyTransferred: Number(hoRawQtyTransferred) || 0,
        rawQtyDefect: Number(hoRawQtyDefect) || 0,
        rawQtyMissing: Number(hoRawQtyMissing) || 0,
        note: hoNote.trim(),
        receiverName: hoReceiver.trim(),
        senderName: hoSender.trim(),
        createdAt: existingRow?.createdAt || new Date().toISOString(),
      };

      if (editingHoId) {
        try {
          await apiClient.patch(`/handovers/${editingHoId}`, targetRow);
        } catch {
          // fallback
        }
        saveFallbackHandover(targetRow);
        setHandovers((prev) => prev.map((h) => (h.id === editingHoId ? targetRow : h)));
        if (onRefreshBootstrap) {
          try { await onRefreshBootstrap(); } catch { }
        }
        toast.success('Đã cập nhật số liệu chuyển giao BM.GC.01.02 & tự động đồng bộ sang Lệnh PO & QR!');
      } else {
        try {
          await apiClient.post('/handovers', targetRow);
        } catch {
          // fallback
        }
        saveFallbackHandover(targetRow);
        setHandovers((prev) => [targetRow, ...prev]);
        if (onRefreshBootstrap) {
          try { await onRefreshBootstrap(); } catch { }
        }
        toast.success('Đã lưu phiếu chuyển giao BM.GC.01.02 & tự động đồng bộ sang Lệnh PO & QR!');
      }
      setHoModalOpen(false);
    } catch (err: any) {
      toast.error(err?.message || 'Lỗi khi lưu phiếu bàn giao.');
    } finally {
      setSubmittingHo(false);
    }
  };

  const filteredHandovers = useMemo(() => {
    return handovers.filter((h) => {
      if (hoDeptFilter !== 'ALL' && h.fromDept !== hoDeptFilter && h.toDept !== hoDeptFilter) {
        return false;
      }
      if (hoDateFilter && h.handoverDate !== hoDateFilter) {
        return false;
      }
      if (hoMetricFilter === 'OK' && (h.prodQtyTransferred || 0) <= 0) {
        return false;
      }
      if (hoMetricFilter === 'DEFECT' && (h.prodQtyDefect || 0) <= 0) {
        return false;
      }
      if (hoMetricFilter === 'RAW_DEFECT' && (h.rawQtyDefect || 0) <= 0 && (h.prodQtyMissing || 0) <= 0) {
        return false;
      }
      if (hoSearch.trim()) {
        const q = hoSearch.toLowerCase();
        const text = `${h.productName} ${h.customer} ${h.poId || ''} ${h.note || ''} ${h.receiverName || ''} ${h.senderName || ''}`.toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });
  }, [handovers, hoDeptFilter, hoDateFilter, hoMetricFilter, hoSearch]);

  useEffect(() => {
    void reloadLogs();
    void reloadQc();

    const handleRealtimeUpdate = () => {
      void reloadLogs();
      if (onRefreshBootstrap) void onRefreshBootstrap();
    };

    window.addEventListener('gcck:report-submitted', handleRealtimeUpdate);
    window.addEventListener('storage', handleRealtimeUpdate);

    const unsubSupabase = subscribeSupabaseLogChanges(() => {
      void reloadLogs();
      if (onRefreshBootstrap) void onRefreshBootstrap();
    });

    // Auto-polling interval every 10 seconds for cross-device realtime synchronization
    const pollTimer = setInterval(() => {
      void reloadLogs();
      void reloadQc();
    }, 10000);

    return () => {
      clearInterval(pollTimer);
      window.removeEventListener('gcck:report-submitted', handleRealtimeUpdate);
      window.removeEventListener('storage', handleRealtimeUpdate);
      if (unsubSupabase) unsubSupabase();
    };
  }, [onRefreshBootstrap]);

  useEffect(() => {
    if (subView === 'TRACE' && !traceData && tracePoInput) {
      void fetchTraceability(tracePoInput);
    }
  }, [subView]);

  // Filtered Logs
  const filteredLogs = useMemo(() => {
    return logs.filter((l) => {
      if (logIssueFilter === 'VOIDED') {
        if (!l.isVoided) return false;
      } else if (l.isVoided) {
        return false;
      }

      if (logDateFilter && l.workDate !== logDateFilter) return false;
      if (logShiftFilter !== 'ALL' && !l.shiftType.includes(logShiftFilter)) return false;
      if (logWorkerFilter !== 'ALL' && l.workerId !== logWorkerFilter) return false;
      if (logMachineFilter !== 'ALL' && l.machineName !== logMachineFilter) return false;

      if (logIssueFilter === 'HAS_NG' && l.scrapQty <= 0 && l.reworkQty <= 0) return false;
      if (logIssueFilter === 'PENDING_QC' && l.qcStatus === 'PASSED') return false;
      if (logIssueFilter === 'HANDOVER' && !l.handoverNote) return false;

      if (!logSearch.trim()) return true;
      return matchesSearch(
        `${l.recordUid} ${l.poId} ${l.customer} ${l.productName} ${l.ncId} ${l.opName} ${l.workerName} ${l.machineName} ${l.handoverNote}`,
        logSearch
      );
    });
  }, [
    logs,
    logDateFilter,
    logShiftFilter,
    logWorkerFilter,
    logMachineFilter,
    logIssueFilter,
    logSearch,
  ]);

  const pagedLogs = useMemo(() => {
    const start = (logPage - 1) * logPageSize;
    return filteredLogs.slice(start, start + logPageSize);
  }, [filteredLogs, logPage, logPageSize]);

  // Map định mức theo từng máy & toàn ca cho thợ chạy nhiều máy / nhiều mã
  const { machineAggregatedKpiMap, shiftAggregatedKpiMap } = useMemo(() => {
    const mM = new Map<
      string,
      { totalEarnedSec: number; totalStopMin: number; logsCount: number; isSecondMach: boolean; sKey: string; mName: string }
    >();
    const sM = new Map<
      string,
      {
        mainEarnedSec: number;
        mainStopMin: number;
        mainMachinesCount: number;
        distinctMainMachines: Set<string>;
        anyMainOver100: boolean;
      }
    >();

    for (const l of logs) {
      if (l.isVoided) continue;
      const mName = (l.machineName || '').trim();
      const isSecond = l.machineMode === 'SECOND';
      const sKey = `${l.workerId}_${l.workDate || 'today'}_${(l.shiftType || 'ca').slice(0, 4)}`;
      const mKey = `${sKey}_${mName}_${isSecond ? 'SECOND' : 'FIRST'}`;

      const ok = Number(l.okQty || 0);
      const rework = Number(l.reworkQty || 0);
      const scrap = Number(l.scrapQty || 0);
      const stopMin = Number(l.stopMinutes || 0);
      const stdSec = Number(l.stdSeconds || 1800);
      const totalMachined = ok + rework + scrap;
      const earnedSec = totalMachined * stdSec;

      if (!mM.has(mKey)) {
        mM.set(mKey, { totalEarnedSec: 0, totalStopMin: 0, logsCount: 0, isSecondMach: isSecond, sKey, mName });
      }
      const curM = mM.get(mKey)!;
      curM.totalEarnedSec += earnedSec;
      curM.totalStopMin += stopMin;
      curM.logsCount += 1;
      if (!isSecond) curM.isSecondMach = false;
    }

    for (const [, mVal] of mM.entries()) {
      if (mVal.isSecondMach) continue;
      if (!sM.has(mVal.sKey)) {
        sM.set(mVal.sKey, {
          mainEarnedSec: 0,
          mainStopMin: 0,
          mainMachinesCount: 0,
          distinctMainMachines: new Set(),
          anyMainOver100: false,
        });
      }
      const curS = sM.get(mVal.sKey)!;
      curS.mainEarnedSec += mVal.totalEarnedSec;
      curS.mainStopMin += mVal.totalStopMin;
      if (mVal.mName) curS.distinctMainMachines.add(mVal.mName);
      curS.mainMachinesCount = curS.distinctMainMachines.size;
      const mNetSec = Math.max(1, 28800 - mVal.totalStopMin * 60);
      const mKpi = (mVal.totalEarnedSec / mNetSec) * 100;
      if (mKpi >= 99.9) {
        curS.anyMainOver100 = true;
      }
    }

    return { machineAggregatedKpiMap: mM, shiftAggregatedKpiMap: sM };
  }, [logs]);

  const openEditLogModal = (log: ProductionLogDto) => {
    setEditLog(log);
    setEditWorkDate(log.workDate || bootstrap.vietnamToday);
    setEditShiftType(log.shiftType || 'Ca 1 (06:00-14:00)');
    setEditMachineName(log.machineName || bootstrap.machines[0]?.name || 'Máy Tiện CNC 1');
    setEditMachineMode(log.machineMode === 'SECOND' ? 'SECOND' : 'FIRST');
    setEditPoId(log.poId || 'PO-THEO-KH');
    setEditNcId(log.ncId || '');
    setEditStdSeconds(Number(log.stdSeconds || 1800));
    setEditStopMinutes(Number(log.stopMinutes || 0));
    setEditOkQty(log.okQty);
    setEditReworkQty(log.reworkQty);
    setEditScrapQty(log.scrapQty);
    setEditQcStatus(log.qcStatus);
    setEditIsVoided(Boolean(log.isVoided));
  };

  const handleSaveLogEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editLog) return;
    setSavingLogEdit(true);
    try {
      const matchedOp = bootstrap.operations.find((o) => o.ncId === editNcId);
      const matchedPo = bootstrap.ordersList.find((p) => p.poId === editPoId);
      const matchedMach = bootstrap.machines.find((m) => m.name === editMachineName);

      const effectiveStdSec = Math.max(1, Number(editStdSeconds || matchedOp?.stdSeconds || editLog.stdSeconds || 1800));
      const prevMode = editLog.machineMode === 'SECOND' ? 'SECOND' : 'FIRST';

      // Preserve existing wage if okQty, stdSeconds, and machineMode did not change; otherwise recalculate proportionally
      let newIncome = Number(editLog.income || 0);
      if (
        editOkQty !== editLog.okQty ||
        effectiveStdSec !== Number(editLog.stdSeconds || 0) ||
        editMachineMode !== prevMode
      ) {
        const baseRatePerSec =
          editLog.okQty > 0 && Number(editLog.stdSeconds) > 0 && Number(editLog.income) > 0
            ? Number(editLog.income) / (editLog.okQty * Number(editLog.stdSeconds) * (prevMode === 'SECOND' ? 0.5 : 1))
            : 13.37;
        const modeMult = editMachineMode === 'SECOND' ? 0.5 : 1;
        newIncome = Math.round(editOkQty * effectiveStdSec * baseRatePerSec * modeMult);
      }

      const totalMachined = editOkQty + editReworkQty + editScrapQty;
      const netSec = Math.max(1, 28800 - editStopMinutes * 60);
      const computedKpi = Math.round(((totalMachined * effectiveStdSec) / netSec) * 100);
      const defectInfo =
        editReworkQty > 0 || editScrapQty > 0
          ? ` (${editOkQty} OK${editReworkQty > 0 ? `, ${editReworkQty} Sửa` : ''}${editScrapQty > 0 ? `, ${editScrapQty} NG` : ''})`
          : '';
      const computedStatus =
        totalMachined === 0 && editStopMinutes === 0
          ? '🚨 0% ĐM'
          : computedKpi >= 100
            ? `Đạt ${computedKpi}% ĐM${defectInfo}`
            : computedKpi < 50 && editStopMinutes === 0
              ? `🚨 Rất thấp (${computedKpi}% ĐM)${defectInfo}`
              : `⚠️ Chưa đạt ĐM (${computedKpi}%)${defectInfo}`;

      const updatedLog: ProductionLogDto = {
        ...editLog,
        workDate: editWorkDate || editLog.workDate,
        shiftType: editShiftType || editLog.shiftType,
        machineId: matchedMach?.id || editLog.machineId,
        machineName: editMachineName || editLog.machineName,
        machineMode: editMachineMode,
        poId: editPoId || editLog.poId,
        ncId: editNcId || editLog.ncId,
        opName: matchedOp?.opName || editLog.opName,
        spId: matchedOp?.spId || matchedPo?.spId || editLog.spId,
        productName: matchedPo?.productName || matchedOp?.productName || editLog.productName,
        customer: matchedPo?.customer || matchedOp?.customer || editLog.customer,
        stdSeconds: effectiveStdSec,
        stopMinutes: editStopMinutes,
        okQty: editOkQty,
        reworkQty: editReworkQty,
        scrapQty: editScrapQty,
        qcStatus: editQcStatus,
        isVoided: editIsVoided ? 1 : 0,
        income: newIncome,
        pieceWage: newIncome,
        kpiPct: computedKpi,
        kpiStatus: computedStatus,
      };

      // 1. Update Supabase Cloud directly
      await updateLogOnSupabase(editLog.id, editLog.recordUid, {
        work_date: updatedLog.workDate,
        shift_type: updatedLog.shiftType,
        machine_id: updatedLog.machineId,
        machine_name: updatedLog.machineName,
        machine_mode: updatedLog.machineMode,
        po_id: updatedLog.poId,
        nc_id: updatedLog.ncId,
        op_name: updatedLog.opName,
        sp_id: updatedLog.spId,
        product_name: updatedLog.productName,
        customer: updatedLog.customer,
        std_seconds: updatedLog.stdSeconds,
        stop_minutes: updatedLog.stopMinutes,
        ok_qty: updatedLog.okQty,
        rework_qty: updatedLog.reworkQty,
        scrap_qty: updatedLog.scrapQty,
        qc_status: updatedLog.qcStatus,
        is_voided: updatedLog.isVoided,
        income: updatedLog.income,
        piece_wage: updatedLog.pieceWage,
        kpi_pct: updatedLog.kpiPct,
        kpi_status: updatedLog.kpiStatus,
      });

      // 2. Update Backend API if running
      try {
        await apiClient.patch(`/logs/${editLog.id}`, {
          workDate: updatedLog.workDate,
          shiftType: updatedLog.shiftType,
          machineName: updatedLog.machineName,
          machineMode: updatedLog.machineMode,
          poId: updatedLog.poId,
          ncId: updatedLog.ncId,
          stdSeconds: updatedLog.stdSeconds,
          stopMinutes: updatedLog.stopMinutes,
          okQty: editOkQty,
          reworkQty: editReworkQty,
          scrapQty: editScrapQty,
          qcStatus: editQcStatus,
          isVoided: editIsVoided,
          income: updatedLog.income,
          pieceWage: updatedLog.pieceWage,
        });
      } catch {
        // Ignore if backend server is static/offline
      }

      // 3. Update localStorage fallback immediately
      if (editIsVoided) {
        deleteFallbackLog(editLog.id);
        if (editLog.recordUid) deleteFallbackLog(editLog.recordUid);
      } else {
        saveClientStoredLog(updatedLog);
        updateFallbackLog(editLog.id, updatedLog);
        if (editLog.recordUid) updateFallbackLog(editLog.recordUid, updatedLog);
      }

      // 4. Update React state immediately so UI never reverts to old values
      setLogs((prev) =>
        prev.map((item) =>
          String(item.id) === String(editLog.id) ||
            (editLog.recordUid && item.recordUid === editLog.recordUid)
            ? updatedLog
            : item
        )
      );

      toast.success(
        editIsVoided
          ? `Đã hủy phiếu nhầm #${editLog.recordUid || editLog.id} và đồng bộ lên Cloud.`
          : `Đã lưu cập nhật phiếu #${editLog.recordUid || editLog.id} lên Cloud thành công!`
      );
      setEditLog(null);
      await reloadLogs();
      if (onRefreshBootstrap) await onRefreshBootstrap();
    } catch (err: any) {
      toast.error(err?.message || 'Không thể chỉnh sửa phiếu sản lượng.');
    } finally {
      setSavingLogEdit(false);
    }
  };

  const handleExportLogsExcel = async () => {
    setExportingLogs(true);
    try {
      await downloadDailyLogsExcel(filteredLogs, logDateFilter || bootstrap.vietnamToday);
      toast.success(`Đã xuất Excel 17 cột (${filteredLogs.length} bản ghi sản lượng).`);
    } catch (err: any) {
      toast.error(err?.message || 'Lỗi xuất file Excel báo cáo ngày.');
    } finally {
      setExportingLogs(false);
    }
  };

  // Pending FAI POs
  const pendingFaiPos = useMemo(
    () => bootstrap.ordersList.filter((po) => po.faiStatus === 'PENDING_FAI'),
    [bootstrap.ordersList]
  );

  // Operations for selected QC PO
  const opsForQcPo = useMemo(() => {
    const po = bootstrap.ordersList.find((p) => p.poId === qcPoId);
    if (!po) return bootstrap.operations;
    const matched = bootstrap.operations.filter(
      (o) =>
        (po.spId && o.spId === po.spId) ||
        normalizeVn(o.productName).toLowerCase() === normalizeVn(po.productName).toLowerCase()
    );
    return matched.length > 0 ? matched : bootstrap.operations;
  }, [bootstrap.ordersList, bootstrap.operations, qcPoId]);

  const openNewQcModalForPo = (
    poId?: string,
    type: 'FAI' | 'IPQC' | 'OQC' | 'NG_REVIEW' = 'FAI'
  ) => {
    const chosenPoId = poId || bootstrap.ordersList[0]?.poId || '';
    setQcInspType(type);
    setQcPoId(chosenPoId);
    const poObj = bootstrap.ordersList.find((p) => p.poId === chosenPoId);
    const firstOp = poObj
      ? bootstrap.operations.find(
        (o) =>
          (poObj.spId && o.spId === poObj.spId) ||
          normalizeVn(o.productName).toLowerCase() ===
          normalizeVn(poObj.productName).toLowerCase()
      )
      : bootstrap.operations[0];
    setQcNcId(firstOp?.ncId || '');
    setQcMachineName(firstOp?.defaultMachine || bootstrap.machines[0]?.name || '');
    setQcResult('PASS');
    setQcDefectQty(0);
    setCreateQcOpen(true);
  };

  const handleSubmitQc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!qcPoId) {
      toast.warning('Vui lòng chọn mã PO cần lập biên bản QC.');
      return;
    }
    setSubmittingQc(true);
    try {
      const enrichedDims = qcDims.map((d) => {
        const diff = Math.abs(Number(d.measured) - Number(d.nominal));
        const pass = diff <= Number(d.tolPlusMinus) + 1e-6;
        return {
          ...d,
          deviation: Number((Number(d.measured) - Number(d.nominal)).toFixed(4)),
          pass,
        };
      });

      await apiClient.post('/qc', {
        inspectionType: qcInspType,
        poId: qcPoId,
        ncId: qcNcId || null,
        machineName: qcMachineName,
        operatorId: qcOperatorId,
        sampleSize: qcSampleSize,
        defectQty: qcDefectQty,
        result: qcResult,
        measuredDims: enrichedDims,
        rootCause: qcRootCause,
        correctiveAction: qcCorrective,
      });

      toast.success(`Đã lưu biên bản ${qcInspType} cho lệnh ${qcPoId} (${qcResult}).`);
      setCreateQcOpen(false);
      setQcRootCause('');
      setQcCorrective('');
      await reloadQc();
      await reloadLogs();
      await onRefreshBootstrap();
    } catch (err: any) {
      toast.error(err?.message || 'Không thể lưu biên bản QC.');
    } finally {
      setSubmittingQc(false);
    }
  };

  const filteredQc = useMemo(() => {
    return qcList.filter((q) => {
      if (qcTypeFilter !== 'ALL' && q.inspectionType !== qcTypeFilter) return false;
      if (!qcSearch.trim()) return true;
      return matchesSearch(
        `${q.poId} ${q.productName || ''} ${q.opName || ''} ${q.inspectorName} ${q.machineName} ${q.result}`,
        qcSearch
      );
    });
  }, [qcList, qcTypeFilter, qcSearch]);

  const pagedQc = useMemo(() => {
    const start = (qcPage - 1) * qcPageSize;
    return filteredQc.slice(start, start + qcPageSize);
  }, [filteredQc, qcPage, qcPageSize]);

  const filterInputCls =
    'h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/15';
  const modalInputCls =
    'h-10 w-full rounded-xl border border-slate-300 bg-white px-3 font-semibold text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/15';

  return (
    <div className="space-y-4">
      {/* ==================== SUB-VIEW NAVIGATION BAR ==================== */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-2.5 shadow-card">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSubView('LOGS')}
            className={`inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-xs font-extrabold transition-all ${subView === 'LOGS'
                ? 'border-blue-600 bg-blue-50 text-blue-700 shadow-sm'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900'
              }`}
          >
            <FileSpreadsheet
              className={`h-4 w-4 ${subView === 'LOGS' ? 'text-blue-600' : 'text-slate-500'}`}
            />
            A. Nhật Ký Sản Lượng Realtime ({logs.filter((l) => !l.isVoided).length})
          </button>

          <button
            type="button"
            onClick={() => setSubView('QC')}
            className={`inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-xs font-extrabold transition-all ${subView === 'QC'
                ? 'border-emerald-600 bg-emerald-50 text-emerald-800 shadow-sm'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900'
              }`}
          >
            <Microscope
              className={`h-4 w-4 ${subView === 'QC' ? 'text-emerald-600' : 'text-slate-500'}`}
            />
            B. Kiểm Soát Chất Lượng 3 Tầng — FAI / IPQC / OQC ({qcList.length})
            {pendingFaiPos.length > 0 && (
              <Badge variant="warning">{pendingFaiPos.length} chờ FAI</Badge>
            )}
          </button>

          <button
            type="button"
            onClick={() => setSubView('TRACE')}
            className={`inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-xs font-extrabold transition-all ${subView === 'TRACE'
                ? 'border-violet-600 bg-violet-50 text-violet-800 shadow-sm'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900'
              }`}
          >
            <GitCommit
              className={`h-4 w-4 ${subView === 'TRACE' ? 'text-violet-600' : 'text-slate-500'}`}
            />
            C. Truy Vết Nguồn Gốc 100% Theo Mã PO
          </button>

          <button
            type="button"
            onClick={() => setSubView('HANDOVER')}
            className={`inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-xs font-extrabold transition-all ${subView === 'HANDOVER'
                ? 'border-amber-600 bg-amber-50 text-amber-800 shadow-sm'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900'
              }`}
          >
            <Truck
              className={`h-4 w-4 ${subView === 'HANDOVER' ? 'text-amber-600' : 'text-slate-500'}`}
            />
            D. Sổ Bàn Giao Công Đoạn (BM.GC.01.02) ({handovers.length})
          </button>
        </div>

        {subView === 'LOGS' && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={async () => {
                await reloadLogs();
                if (onRefreshBootstrap) await onRefreshBootstrap();
                toast.success(`Đã làm mới dữ liệu (${logs.length} bản ghi)!`);
              }}
              title="Cập nhật ngay báo cáo mới nhất từ điện thoại công nhân"
            >
              <RefreshCw className="h-4 w-4 text-blue-600" />
              Làm mới ({logs.length})
            </Button>
            <Button
              variant="success"
              size="sm"
              disabled={exportingLogs}
              onClick={() => void handleExportLogsExcel()}
            >
              <Download className="h-4 w-4" />
              📥 Xuất Excel Báo Cáo Ngày (17 cột)
            </Button>
            {isAdmin && (
              <Button
                variant="danger"
                size="sm"
                disabled={resettingData}
                onClick={() => void handleResetProductionLogs()}
                title="Xóa toàn bộ nhật ký sản xuất cũ để công nhân bắt đầu nhập mới từ Tháng 11"
              >
                <Trash2 className="h-4 w-4" />
                🧹 Về Mới Tinh Cho T11
              </Button>
            )}
          </div>
        )}

        {subView === 'QC' && (
          <Button variant="primary" size="sm" onClick={() => openNewQcModalForPo()}>
            <Plus className="h-4 w-4" />
            Tạo Biên Bản Kiểm Tra QC Mới
          </Button>
        )}

        {subView === 'HANDOVER' && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => navigateTo(`/print/handover?date=${hoDateFilter || hoDate}`)}
            >
              <Printer className="h-4 w-4" />
              🖨️ In Biểu Mẫu A4 BM.GC.01.02
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleOpenCreateHandover}
            >
              <Plus className="h-4 w-4" />
              ➕ Lập Phiếu / Nhập Số Liệu Đã Chuyển Trước Đó
            </Button>
          </div>
        )}
      </div>

      {/* ==================== SUB-VIEW A: PRODUCTION LOGS ==================== */}
      {subView === 'LOGS' && (
        <Card noPadding>
          <div className="space-y-3 border-b border-slate-200 bg-slate-50/70 p-4">
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  ['ALL', 'Tất cả phiếu hợp lệ'],
                  ['HAS_NG', '⚠️ Có hàng NG / Rework'],
                  ['PENDING_QC', '⏳ Chờ QC hậu kiểm / NG Hold'],
                  ['HANDOVER', '📝 Có ghi chú bàn giao ca'],
                  ['VOIDED', '🚫 Phiếu đã hủy (Voided)'],
                ] as Array<[LogIssueFilter, string]>
              ).map(([k, lbl]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    setLogIssueFilter(k);
                    setLogPage(1);
                  }}
                  className={`rounded-lg border px-2.5 py-1 text-xs font-bold transition-colors ${logIssueFilter === k
                      ? 'border-blue-600 bg-blue-600 text-white shadow-sm'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900'
                    }`}
                >
                  {lbl}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
              <div className="relative lg:col-span-2">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={logSearch}
                  onChange={(e) => {
                    setLogSearch(e.target.value);
                    setLogPage(1);
                  }}
                  placeholder="Tìm mã phiếu, PO, Sản phẩm, Nguyên công, Công nhân..."
                  className={`${filterInputCls} w-full pl-9 pr-3`}
                />
              </div>

              <input
                type="date"
                value={logDateFilter}
                onChange={(e) => {
                  setLogDateFilter(e.target.value);
                  setLogPage(1);
                }}
                className={filterInputCls}
              />

              <select
                value={logWorkerFilter}
                onChange={(e) => {
                  setLogWorkerFilter(e.target.value);
                  setLogPage(1);
                }}
                className={`${filterInputCls} font-medium`}
              >
                <option value="ALL">Tất cả Công nhân</option>
                {bootstrap.workers.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} ({w.id})
                  </option>
                ))}
              </select>

              <div className="flex gap-1.5">
                <select
                  value={logMachineFilter}
                  onChange={(e) => {
                    setLogMachineFilter(e.target.value);
                    setLogPage(1);
                  }}
                  className={`${filterInputCls} flex-1 font-medium`}
                >
                  <option value="ALL">Tất cả Máy</option>
                  {bootstrap.machines.map((m) => (
                    <option key={m.id} value={m.name}>
                      {m.name}
                    </option>
                  ))}
                </select>
                <select
                  value={logShiftFilter}
                  onChange={(e) => {
                    setLogShiftFilter(e.target.value);
                    setLogPage(1);
                  }}
                  className={`${filterInputCls} w-24 font-medium`}
                >
                  <option value="ALL">Mọi ca</option>
                  <option value="Ca 1">Ca 1</option>
                  <option value="Ca 2">Ca 2</option>
                  <option value="Ca 3">Ca 3</option>
                  <option value="Hành chính">HC</option>
                </select>
              </div>
            </div>
          </div>

          <div className="max-h-[560px] overflow-auto">
            <table className="w-full min-w-[1180px] border-collapse text-left text-xs">
              <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-600">
                <tr>
                  <th className="px-3 py-2.5">Thời Gian / Ca</th>
                  <th className="px-3 py-2.5">Công Nhân &amp; Máy</th>
                  <th className="px-3 py-2.5">PO / Sản Phẩm / Nguyên Công</th>
                  <th className="px-3 py-2.5 text-center">OK / RW / NG</th>
                  <th className="px-3 py-2.5 text-center">Dừng / Dao</th>
                  <th className="px-3 py-2.5 text-center">QC &amp; KPI</th>
                  <th className="px-3 py-2.5 text-right">Lương Ca</th>
                  <th className="px-3 py-2.5">Ảnh &amp; Bàn Giao Ca</th>
                  <th className="px-3 py-2.5 text-right">Sửa / Hủy</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {pagedLogs.map((l) => (
                  <tr
                    key={l.id}
                    className={`transition-colors ${l.isVoided
                        ? 'bg-rose-50/40 opacity-70 line-through'
                        : 'hover:bg-blue-50/40'
                      }`}
                  >
                    <td className="px-3 py-2.5">
                      <div className="font-mono-num font-bold text-slate-900">
                        {formatDateVn(l.workDate)} • {l.timeStr}
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-500">
                        {(l.shiftType ? l.shiftType.split('(')[0].trim() : 'Ca 1')} ({l.startTime || '07:30'}–{l.endTime || '16:30'})
                        {l.isLightsOut === 1 && (
                          <span className="ml-1 font-semibold text-violet-700">🌙 Lights-out</span>
                        )}
                      </div>
                    </td>

                    <td className="px-3 py-2.5">
                      <div className="font-bold text-slate-900">{l.workerName}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px]">
                        <Badge variant="neutral">{l.machineName}</Badge>
                        {l.machineMode === 'SECOND' && (
                          <Badge variant="info">Ghép máy 0.33</Badge>
                        )}
                      </div>
                    </td>

                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setTracePoInput(l.poId);
                            setSubView('TRACE');
                            void fetchTraceability(l.poId);
                          }}
                          className="font-mono-num font-bold text-blue-700 hover:underline"
                          title="Bấm truy vết PO này"
                        >
                          {l.poId}
                        </button>
                        <span className="text-slate-500">• {l.customer}</span>
                      </div>
                      <div className="mt-0.5 font-semibold text-slate-900">{l.productName}</div>
                      <div className="text-[11px] text-slate-500">
                        [{l.ncId}] {l.opName} {l.isFinalOp === 1 ? '🏁(End)' : ''}
                      </div>
                    </td>

                    <td className="font-mono-num px-3 py-2.5 text-center">
                      <div className="inline-flex items-center gap-1.5">
                        <span className="font-bold text-emerald-700">{l.okQty}</span>
                        <span className="text-slate-400">/</span>
                        {l.reworkQty > 0 ? (
                          <span className="rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] font-bold text-amber-800">
                            {l.reworkQty}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                        <span className="text-slate-400">/</span>
                        {l.scrapQty > 0 ? (
                          <span className="rounded-md border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[11px] font-bold text-rose-700">
                            {l.scrapQty}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </div>
                    </td>

                    <td className="font-mono-num px-3 py-2.5 text-center text-[11px]">
                      {l.stopMinutes > 0 ? (
                        <div className="font-bold text-amber-700">{l.stopMinutes}p dừng</div>
                      ) : (
                        <div className="text-slate-400">0p dừng</div>
                      )}
                      {l.toolCode && (
                        <div className="text-slate-500">
                          {l.toolCode} ({l.edgesUsed} cạnh)
                        </div>
                      )}
                    </td>

                    {(() => {
                      const ok = Number(l.okQty || 0);
                      const rework = Number(l.reworkQty || 0);
                      const scrap = Number(l.scrapQty || 0);
                      const stopMin = Number(l.stopMinutes || 0);
                      const stdSec = Number(l.stdSeconds || 1800);
                      // ĐỊNH MỨC KHOÁN MÁY: tính trên tổng số sản phẩm đã gia công trên máy (OK + Sửa + NG)
                      const totalMachined = ok + rework + scrap;
                      const earnedSec = totalMachined * stdSec;
                      const netSec = Math.max(1, 28800 - stopMin * 60);
                      const realKpi = Math.round((earnedSec / netSec) * 10000) / 100;

                      const fmtPct = (val: number) => {
                        const r = Math.round(val * 100) / 100;
                        if (Math.abs(r - Math.round(r)) < 0.01) return `${Math.round(r)}%`;
                        return `${r.toFixed(2).replace(/\.?0+$/, '')}%`;
                      };

                      const defectDetail =
                        rework > 0 || scrap > 0
                          ? ` (${ok} OK${rework > 0 ? `, ${rework} Sửa` : ''}${scrap > 0 ? `, ${scrap} NG` : ''})`
                          : '';

                      // Phân bổ định mức theo từng máy & ca gộp (chỉ ghép các máy chính chưa đủ 100%)
                      const mName = (l.machineName || '').trim();
                      const isSecondMach = l.machineMode === 'SECOND';
                      const sKey = `${l.workerId}_${l.workDate || 'today'}_${(l.shiftType || 'ca').slice(0, 4)}`;
                      const mKey = `${sKey}_${mName}_${isSecondMach ? 'SECOND' : 'FIRST'}`;

                      const mStats = machineAggregatedKpiMap.get(mKey);
                      const sStats = shiftAggregatedKpiMap.get(sKey);

                      const mNetSec = Math.max(1, 28800 - (mStats?.totalStopMin || 0) * 60);
                      const sMainNetSec = Math.max(1, 28800 - (sStats?.mainStopMin || 0) * 60);

                      const mTotalKpi = mStats
                        ? Math.round((mStats.totalEarnedSec / mNetSec) * 10000) / 100
                        : realKpi;
                      const sMainTotalKpi = sStats
                        ? Math.round((sStats.mainEarnedSec / sMainNetSec) * 10000) / 100
                        : realKpi;

                      const hasMultiJobsOnMachine = Boolean(mStats && mStats.logsCount > 1);
                      const canCombineMainShift = Boolean(
                        !isSecondMach &&
                        sStats &&
                        sStats.mainMachinesCount > 1 &&
                        !sStats.anyMainOver100
                      );
                      const prefix = isSecondMach ? 'Máy phụ' : 'Máy';

                      let badgeText = l.kpiStatus;
                      let isCrit = false;
                      let isWarn = false;

                      if (totalMachined === 0 && stopMin === 0) {
                        badgeText = `🚨 ${prefix} 0% ĐM`;
                        isCrit = true;
                      } else if (hasMultiJobsOnMachine) {
                        if (mTotalKpi >= 100) {
                          badgeText = `✅ ${prefix} đạt ${fmtPct(mTotalKpi)} (Mã này: ${fmtPct(realKpi)}${defectDetail})`;
                        } else if (canCombineMainShift && sMainTotalKpi >= 100) {
                          badgeText = `✅ Mã này: ${fmtPct(realKpi)} (Máy: ${fmtPct(mTotalKpi)} · Ghép ca: ${fmtPct(sMainTotalKpi)})${defectDetail}`;
                        } else if (mTotalKpi < 50 && (mStats?.totalStopMin || 0) === 0) {
                          badgeText = `🚨 Mã này: ${fmtPct(realKpi)} (Tổng ${prefix.toLowerCase()}: ${fmtPct(mTotalKpi)} < 100%)${defectDetail}`;
                          isCrit = true;
                        } else {
                          badgeText = `⚠️ Mã này: ${fmtPct(realKpi)} (Tổng ${prefix.toLowerCase()}: ${fmtPct(mTotalKpi)} < 100%)${defectDetail}`;
                          isWarn = true;
                        }
                      } else {
                        if (realKpi >= 100) {
                          badgeText = `✅ ${prefix} đạt ${fmtPct(realKpi)} ĐM${defectDetail}`;
                        } else if (canCombineMainShift && sMainTotalKpi >= 100) {
                          badgeText = `✅ Đạt ${fmtPct(realKpi)} ĐM (Ghép 2 máy: ${fmtPct(sMainTotalKpi)})${defectDetail}`;
                        } else if (realKpi < 50 && stopMin === 0) {
                          badgeText = `🚨 ${prefix} rất thấp (${fmtPct(realKpi)} ĐM)${defectDetail}`;
                          isCrit = true;
                        } else {
                          badgeText = `⚠️ ${prefix} chưa đạt (${fmtPct(realKpi)} < 100%)${defectDetail}`;
                          isWarn = true;
                        }
                      }

                      return (
                        <>
                          <td className="px-3 py-2.5 text-center">
                            <Badge
                              variant={
                                l.qcStatus === 'PASSED'
                                  ? 'success'
                                  : l.qcStatus === 'NG_HOLD'
                                    ? 'danger'
                                    : 'warning'
                              }
                            >
                              {l.qcStatus}
                            </Badge>
                            <div className="mt-1">
                              {isCrit ? (
                                <span
                                  className="inline-flex items-center gap-1 rounded border border-rose-300 bg-rose-50 px-1.5 py-0.5 text-[10px] font-extrabold text-rose-700 animate-pulse"
                                  title="Sản lượng máy rất thấp (< 50% định mức ca)"
                                >
                                  {badgeText}
                                </span>
                              ) : isWarn ? (
                                <span
                                  className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-800"
                                  title="Sản lượng máy chưa đạt định mức 100%"
                                >
                                  {badgeText}
                                </span>
                              ) : badgeText?.startsWith('✅') ? (
                                <span className="inline-flex items-center gap-1 rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">
                                  {badgeText}
                                </span>
                              ) : (
                                <span className="text-[11px] font-medium text-slate-500">
                                  {badgeText}
                                </span>
                              )}
                            </div>
                          </td>

                          <td className="font-mono-num px-3 py-2.5 text-right font-bold">
                            {l.income > 0 ? (
                              <div>
                                <span className="text-blue-700">{formatVnd(l.income)}</span>
                              </div>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                        </>
                      );
                    })()}

                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {l.photoUrl && (
                          <button
                            type="button"
                            onClick={() => setPreviewPhotoLog(l)}
                            className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700 transition-colors hover:bg-emerald-100"
                          >
                            <Camera className="h-3 w-3" /> Ảnh SP
                          </button>
                        )}
                        {l.handoverNote ? (
                          <span className="max-w-[180px] truncate rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">
                            📝 {l.handoverNote}
                          </span>
                        ) : (
                          !l.photoUrl && <span className="text-slate-400">—</span>
                        )}
                      </div>
                    </td>

                    <td className="px-3 py-2.5 text-right">
                      {canEditLogs ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => openEditLogModal(l)}
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                          Sửa/Hủy
                        </Button>
                      ) : (
                        <span className="text-[11px] text-slate-500">Chỉ xem</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <PaginationBar
            totalItems={filteredLogs.length}
            page={logPage}
            pageSize={logPageSize}
            onPageChange={setLogPage}
            onPageSizeChange={(sz) => {
              setLogPageSize(sz);
              setLogPage(1);
            }}
          />
        </Card>
      )}

      {/* ==================== SUB-VIEW B: 3-TIER QA/QC & FAI ==================== */}
      {subView === 'QC' && (
        <div className="space-y-4">
          {pendingFaiPos.length > 0 && (
            <Card className="border-amber-200 bg-amber-50/50">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-amber-800">
                  <ShieldAlert className="h-4 w-4 text-amber-600" />
                  <span>
                    Danh Sách Đơn Hàng Lô Lớn (SL ≥ 5) Đang Chờ Duyệt Mẫu Đầu FAI (
                    {pendingFaiPos.length} PO)
                  </span>
                </div>
                <span className="text-xs text-slate-600">
                  Bấm 1-click để mở bảng đo dung sai ±0.01mm &amp; cấp phép chạy loạt
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {pendingFaiPos.slice(0, 12).map((po) => (
                  <button
                    key={po.poId}
                    type="button"
                    onClick={() => openNewQcModalForPo(po.poId, 'FAI')}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-900 shadow-sm transition-colors hover:border-amber-400 hover:bg-amber-50"
                  >
                    <ClipboardCheck className="h-3.5 w-3.5 text-emerald-600" />
                    <span>{po.poId}</span>
                    <span className="text-slate-500">({po.qtyPo} SP)</span>
                    <span className="text-blue-700">→ Duyệt FAI</span>
                  </button>
                ))}
              </div>
            </Card>
          )}

          <Card noPadding>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/70 px-4 py-3">
              <div className="flex flex-wrap items-center gap-1.5">
                {(['ALL', 'FAI', 'IPQC', 'OQC', 'NG_REVIEW'] as const).map((tp) => (
                  <button
                    key={tp}
                    type="button"
                    onClick={() => {
                      setQcTypeFilter(tp);
                      setQcPage(1);
                    }}
                    className={`rounded-lg border px-2.5 py-1.5 text-xs font-bold transition-colors ${qcTypeFilter === tp
                        ? 'border-emerald-600 bg-emerald-600 text-white shadow-sm'
                        : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900'
                      }`}
                  >
                    {tp === 'ALL'
                      ? `Tất cả (${qcList.length})`
                      : tp === 'FAI'
                        ? '🟢 Tầng 1: FAI (Con đầu)'
                        : tp === 'IPQC'
                          ? '🔵 Tầng 2: IPQC (Trong ca)'
                          : tp === 'OQC'
                            ? '🟣 Tầng 3: OQC (Xuất xưởng)'
                            : '🔴 NG_REVIEW (Xử lý hàng lỗi)'}
                  </button>
                ))}
              </div>

              <div className="relative min-w-[250px] flex-1 sm:max-w-xs">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={qcSearch}
                  onChange={(e) => {
                    setQcSearch(e.target.value);
                    setQcPage(1);
                  }}
                  placeholder="Tìm PO, Sản phẩm, Người duyệt QC..."
                  className={`${filterInputCls} w-full pl-9 pr-3`}
                />
              </div>
            </div>

            <div className="max-h-[520px] overflow-auto">
              <table className="w-full min-w-[1050px] border-collapse text-left text-xs">
                <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-600">
                  <tr>
                    <th className="px-3.5 py-2.5">Loại &amp; Thời Gian</th>
                    <th className="px-3 py-2.5">Mã PO / Sản Phẩm / Công Đoạn</th>
                    <th className="px-3 py-2.5">Máy &amp; Người Kiểm Tra</th>
                    <th className="px-3 py-2.5 text-center">Mẫu / Lỗi</th>
                    <th className="px-3 py-2.5">Bảng Đo Dung Sai Thực Tế (±0.01mm)</th>
                    <th className="px-3 py-2.5 text-center">Kết Quả</th>
                    <th className="px-3.5 py-2.5">Nguyên Nhân &amp; Đối Sách</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {pagedQc.map((q) => {
                    const dims = normalizeQcMeasuredDims(q.measuredDimsJson);
                    const resVariant =
                      q.result === 'PASS'
                        ? 'success'
                        : q.result === 'CONCESSION'
                          ? 'info'
                          : q.result === 'REWORK'
                            ? 'warning'
                            : 'danger';

                    return (
                      <tr key={q.id} className="transition-colors hover:bg-blue-50/40">
                        <td className="px-3.5 py-2.5">
                          <Badge
                            variant={
                              q.inspectionType === 'FAI'
                                ? 'success'
                                : q.inspectionType === 'NG_REVIEW'
                                  ? 'danger'
                                  : 'info'
                            }
                          >
                            {q.inspectionType}
                          </Badge>
                          <div className="font-mono-num mt-1 text-[11px] text-slate-500">
                            {q.createdAt}
                          </div>
                        </td>

                        <td className="px-3 py-2.5">
                          <div className="font-mono-num font-bold text-blue-700">{q.poId}</div>
                          <div className="font-semibold text-slate-900">{q.productName || '—'}</div>
                          {q.opName && (
                            <div className="text-[11px] text-slate-500">
                              [{q.ncId}] {q.opName}
                            </div>
                          )}
                        </td>

                        <td className="px-3 py-2.5">
                          <div className="font-semibold text-slate-800">
                            {q.machineName || '—'}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            QC: <strong className="text-emerald-700">{q.inspectorName}</strong>
                          </div>
                        </td>

                        <td className="font-mono-num px-3 py-2.5 text-center">
                          <span className="font-bold text-slate-900">{q.sampleSize}</span> mẫu /{' '}
                          <span
                            className={
                              q.defectQty > 0 ? 'font-bold text-rose-700' : 'text-slate-400'
                            }
                          >
                            {q.defectQty} lỗi
                          </span>
                        </td>

                        <td className="px-3 py-2.5">
                          {dims.length === 0 ? (
                            <span className="text-slate-500">Kiểm ngoại quan / Calip đạt</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {dims.map((d, idx) => (
                                <Badge key={idx} variant={d.ok ? 'success' : 'danger'}>
                                  {d.label}
                                  {d.specText ? `: ${d.specText}` : ''} →{' '}
                                  <strong>{d.measuredText}</strong>
                                </Badge>
                              ))}
                            </div>
                          )}
                        </td>

                        <td className="px-3 py-2.5 text-center">
                          <Badge variant={resVariant}>{q.result}</Badge>
                        </td>

                        <td className="px-3.5 py-2.5 text-[11px]">
                          {q.rootCause ? (
                            <div>
                              <span className="font-medium text-rose-700">NN: {q.rootCause}</span>
                              {q.correctiveAction && (
                                <div className="font-medium text-emerald-700">
                                  ĐS: {q.correctiveAction}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-500">Đạt chuẩn dung sai bản vẽ</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <PaginationBar
              totalItems={filteredQc.length}
              page={qcPage}
              pageSize={qcPageSize}
              onPageChange={setQcPage}
              onPageSizeChange={(sz) => {
                setQcPageSize(sz);
                setQcPage(1);
              }}
            />
          </Card>
        </div>
      )}

      {/* ==================== SUB-VIEW C: 100% PO GENEALOGY TRACEABILITY ==================== */}
      {subView === 'TRACE' && (
        <div className="space-y-4">
          <Card>
            <form
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                void fetchTraceability(tracePoInput);
              }}
              className="flex flex-wrap items-end gap-3"
            >
              <div className="min-w-[260px] flex-1">
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-600">
                  Nhập hoặc Chọn Mã Đơn Hàng PO Cần Truy Vết 100% Nguồn Gốc
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    list="gcck-trace-pos"
                    value={tracePoInput}
                    onChange={(e) => setTracePoInput(e.target.value)}
                    placeholder="VD: PO485-01..."
                    className="font-mono-num h-10 flex-1 rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold text-blue-700 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/15"
                  />
                  <datalist id="gcck-trace-pos">
                    {bootstrap.ordersList.map((po) => (
                      <option
                        key={po.poId}
                        value={po.poId}
                        label={`${po.customer} — ${po.productName}`}
                      />
                    ))}
                  </datalist>
                  <Button type="submit" variant="primary" disabled={loadingTrace}>
                    <Search className="h-4 w-4" />
                    {loadingTrace ? 'Đang truy vết...' : 'Truy Xuất Hồ Sơ Lô'}
                  </Button>
                </div>
              </div>

              {traceData && (
                <Button
                  variant="secondary"
                  onClick={() =>
                    navigateTo(`/print/traveler/${encodeURIComponent(traceData?.po?.poId)}`)
                  }
                >
                  <Printer className="h-4 w-4 text-blue-600" />
                  🖨️ In Phiếu Công Nghệ QR
                </Button>
              )}
            </form>

            {/* Quick select recent active POs */}
            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
              <span className="font-medium text-slate-500">Chọn nhanh PO tiêu biểu:</span>
              {bootstrap.ordersList.slice(0, 8).map((po) => (
                <button
                  key={po.poId}
                  type="button"
                  onClick={() => {
                    setTracePoInput(po.poId);
                    void fetchTraceability(po.poId);
                  }}
                  className={`font-mono-num rounded-md border px-2 py-0.5 font-semibold transition-colors ${traceData?.po?.poId === po.poId
                      ? 'border-violet-600 bg-violet-50 text-violet-800 shadow-sm'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900'
                    }`}
                >
                  {po.poId}
                </button>
              ))}
            </div>
          </Card>

          {traceError && (
            <Card className="border-rose-200 bg-rose-50 text-sm font-medium text-rose-800">
              {traceError}
            </Card>
          )}

          {traceData && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              {/* Stage 1 & 2 & 4 Left Column */}
              <div className="space-y-4">
                <Card className="border-slate-200 border-l-4 border-l-blue-600">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-extrabold uppercase tracking-wider text-blue-700">
                      1. Lô Phôi Đầu Vào &amp; Nhà Cung Cấp
                    </div>
                    {traceData?.po?.faiStatus && (
                      <Badge
                        variant={
                          traceData?.po?.faiStatus === 'FAI_PASSED'
                            ? 'success'
                            : traceData?.po?.faiStatus === 'PENDING_FAI'
                              ? 'warning'
                              : 'neutral'
                        }
                      >
                        {traceData?.po?.faiStatus}
                      </Badge>
                    )}
                  </div>
                  <div className="mt-2.5 space-y-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Mã Lệnh SX / PO:</span>
                      <span className="font-mono-num font-extrabold text-blue-700">
                        {traceData?.po?.poId}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Khách hàng:</span>
                      <span className="font-bold text-slate-900">{traceData?.po?.customer}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Sản phẩm:</span>
                      <span className="font-bold text-slate-900">{traceData?.po?.productName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Mã Lô Phôi (Heat Lot):</span>
                      <Badge variant="info">{traceData.materialInfo.materialLot}</Badge>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Nhà cung cấp phôi:</span>
                      <span className="font-semibold text-slate-700">
                        {traceData.materialInfo.supplierName}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Ngày đúc / Nhập phôi:</span>
                      <span className="font-mono-num text-slate-700">
                        {formatDateVn(traceData.materialInfo.castDate)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Mác vật liệu:</span>
                      <span className="font-semibold text-emerald-700">
                        {traceData.materialInfo.matName}
                      </span>
                    </div>
                  </div>
                </Card>

                <Card className="border-slate-200 border-l-4 border-l-emerald-500">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-extrabold uppercase tracking-wider text-emerald-700">
                      2. Hồ Sơ Duyệt FAI &amp; QC ({traceData.qcRecords.length})
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openNewQcModalForPo(traceData?.po?.poId, 'FAI')}
                    >
                      + Lập QC
                    </Button>
                  </div>
                  <div className="mt-2 space-y-2 text-xs">
                    {traceData.qcRecords.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/60 p-3 text-slate-500">
                        Chưa có biên bản kiểm tra FAI/IPQC cho PO này.
                      </div>
                    ) : (
                      traceData.qcRecords.map((qc) => (
                        <div
                          key={qc.id}
                          className="rounded-lg border border-slate-200 bg-slate-50/70 p-2.5"
                        >
                          <div className="flex items-center justify-between">
                            <Badge variant="success">{qc.inspectionType}</Badge>
                            <Badge variant={qc.result === 'PASS' ? 'success' : 'warning'}>
                              {qc.result}
                            </Badge>
                          </div>
                          <div className="mt-1 font-semibold text-slate-800">
                            Người duyệt: {qc.inspectorName} ({qc.machineName || 'QC Room'})
                          </div>
                          <div className="font-mono-num text-[11px] text-slate-500">
                            {qc.createdAt} • Mẫu: {qc.sampleSize}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </Card>

                <Card className="border-slate-200 border-l-4 border-l-amber-500">
                  <div className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-amber-700">
                    <PackageCheck className="h-4 w-4 text-amber-600" />
                    <span>4. Lịch Sử Xuất Kho Giao Hàng ({traceData.deliveries.length})</span>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 text-center text-xs">
                    <div>
                      <div className="text-[10px] font-medium text-slate-500">SL Đặt</div>
                      <div className="font-mono-num font-bold text-slate-900">
                        {traceData?.po?.qtyPo}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] font-medium text-slate-500">Đã Giao</div>
                      <div className="font-mono-num font-bold text-emerald-700">
                        {traceData?.po?.deliveredQty}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] font-medium text-slate-500">Còn Lại</div>
                      <div className="font-mono-num font-bold text-amber-700">
                        {traceData?.po?.remainQty}
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 space-y-2 text-xs">
                    {traceData.deliveries.length === 0 ? (
                      <div className="text-slate-500">Chưa xuất giao đợt nào.</div>
                    ) : (
                      traceData.deliveries.map((d) => (
                        <div
                          key={d.id}
                          className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-2.5 py-2"
                        >
                          <div>
                            <div className="font-bold text-emerald-700">
                              <Truck className="mr-1 inline h-3.5 w-3.5" />
                              Giao +{d.qtyDeliver} SP
                            </div>
                            <div className="text-[11px] text-slate-500">
                              Bởi {d.deliveredBy} • {d.note || 'Phiếu xuất chuẩn'}
                            </div>
                          </div>
                          <span className="font-mono-num text-[11px] text-slate-500">
                            {d.deliveredAt}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </Card>
              </div>

              {/* Stage 3 Right 2 Columns: Full Step-by-Step Operations Genealogy */}
              <div className="lg:col-span-2">
                <Card>
                  <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                    <div>
                      <div className="text-xs font-extrabold uppercase tracking-wider text-violet-700">
                        3. Hành Trình Gia Công Từng Nguyên Công (Máy — Thợ — Giờ — Dao — Ảnh)
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500">
                        Theo dõi xuyên suốt từ Bước 1 tới Công đoạn Cuối (End)
                      </div>
                    </div>
                    <Badge variant="purple">
                      {traceData.operationsTimeline.length} bước công nghệ
                    </Badge>
                  </div>

                  <div className="mt-4">
                    {traceData.operationsTimeline.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-6 text-center text-xs text-slate-500">
                        Sản phẩm của PO này chưa khai báo danh sách nguyên công chuẩn.
                      </div>
                    ) : (
                      <div className="space-y-4 border-l-2 border-slate-300 pl-4">
                        {traceData.operationsTimeline.map((step) => (
                          <div
                            key={step.ncId}
                            className="relative rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm"
                          >
                            <span
                              aria-hidden="true"
                              className="absolute -left-[23px] top-4 h-3 w-3 rounded-full border-2 border-blue-600 bg-white"
                            />
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <Badge variant={step.isFinalOp === 1 ? 'success' : 'info'}>
                                  {step.isFinalOp === 1
                                    ? `🏁 Bước Cuối (${step.stepOrder})`
                                    : `Bước ${step.stepOrder}`}
                                </Badge>
                                <span className="font-mono-num text-xs font-bold text-blue-700">
                                  {step.ncId}
                                </span>
                                <span className="text-sm font-bold text-slate-900">
                                  {step.opName}
                                </span>
                              </div>

                              <div className="font-mono-num flex items-center gap-2 text-xs">
                                <Badge variant="success">OK: {step.totalOk}</Badge>
                                {step.totalRework > 0 && (
                                  <Badge variant="warning">RW: {step.totalRework}</Badge>
                                )}
                                {step.totalScrap > 0 && (
                                  <Badge variant="danger">NG: {step.totalScrap}</Badge>
                                )}
                              </div>
                            </div>

                            {step.logs.length === 0 ? (
                              <div className="mt-2 text-xs text-slate-500">
                                Chưa có phiếu ghi nhận sản lượng ở bước này.
                              </div>
                            ) : (
                              <div className="mt-3 space-y-2">
                                {step.logs.map((lg) => (
                                  <div
                                    key={lg.id}
                                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2 text-xs"
                                  >
                                    <div>
                                      <div className="font-semibold text-slate-900">
                                        👷 {lg.workerName} • 🖥️{' '}
                                        <span className="text-blue-700">{lg.machineName}</span>
                                      </div>
                                      <div className="font-mono-num mt-0.5 text-[11px] text-slate-500">
                                        {formatDateVn(lg.workDate)} ({lg.startTime}–{lg.endTime}) •
                                        Dao: {lg.toolCode || 'Chuẩn'} ({lg.edgesUsed} cạnh)
                                      </div>
                                      {lg.handoverNote && (
                                        <div className="mt-0.5 text-[11px] font-medium text-amber-800">
                                          📝 Bàn giao: {lg.handoverNote}
                                        </div>
                                      )}
                                    </div>

                                    <div className="flex items-center gap-2">
                                      {lg.photoUrl && (
                                        <button
                                          type="button"
                                          onClick={() => setPreviewPhotoLog(lg)}
                                          className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700 transition-colors hover:bg-emerald-100"
                                        >
                                          📷 Xem ảnh
                                        </button>
                                      )}
                                      <div className="font-mono-num text-right">
                                        <div className="font-bold text-emerald-700">
                                          +{lg.okQty} OK
                                        </div>
                                        <div className="text-[10px] text-slate-500">
                                          {lg.recordUid}
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </Card>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ==================== SUB-VIEW D: SỔ CHUYỂN GIAO CÔNG ĐOẠN (BM.GC.01.02) ==================== */}
      {subView === 'HANDOVER' && (
        <div className="space-y-4">
          {/* Top KPI Cards (Bấm vào để lọc & Thu Lên / Trải Xuống) */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {/* THẺ 1: TỔNG PHIẾU BÀN GIAO */}
            <Card
              role="button"
              tabIndex={0}
              onClick={() => {
                if (hoMetricFilter === 'ALL') {
                  toggleHoMetricExpanded('ALL');
                } else {
                  setHoMetricFilter('ALL');
                  setHoExpandedByMetric((p) => ({ ...p, ALL: true }));
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  if (hoMetricFilter === 'ALL') {
                    toggleHoMetricExpanded('ALL');
                  } else {
                    setHoMetricFilter('ALL');
                    setHoExpandedByMetric((p) => ({ ...p, ALL: true }));
                  }
                }
              }}
              title="Bấm để lọc toàn bộ phiếu bàn giao và thu lên / trải xuống bảng"
              className={`cursor-pointer border-l-4 border-l-blue-600 p-3.5 transition-all hover:scale-[1.01] hover:shadow-md active:scale-[0.99] ${hoMetricFilter === 'ALL'
                  ? 'ring-2 ring-blue-500 ring-offset-2 bg-blue-50/40'
                  : 'hover:border-blue-300'
                }`}
            >
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                1. Tổng Phiếu Bàn Giao
              </div>
              <div className="mt-1 font-mono-num text-2xl font-black text-slate-900">
                {handovers.length}
              </div>
              <div className="text-[11px] text-slate-500">Theo biểu mẫu BM.GC.01.02</div>
              <div className="mt-2 flex items-center gap-1 text-[11px] font-bold">
                {hoMetricFilter === 'ALL' ? (
                  <span className="inline-flex items-center gap-0.5 rounded bg-blue-100 px-1.5 py-0.5 text-blue-900">
                    {hoExpandedByMetric.ALL ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    <span>{hoExpandedByMetric.ALL ? 'Đang mở (Bấm thu)' : 'Thu gọn (Bấm trải)'}</span>
                  </span>
                ) : (
                  <span className="text-blue-700">🔍 Bấm lọc &amp; mở</span>
                )}
              </div>
            </Card>

            {/* THẺ 2: BTP CHUYỂN GIAO ĐẠT */}
            <Card
              role="button"
              tabIndex={0}
              onClick={() => {
                if (hoMetricFilter === 'OK') {
                  toggleHoMetricExpanded('OK');
                } else {
                  setHoMetricFilter('OK');
                  setHoExpandedByMetric((p) => ({ ...p, OK: true }));
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  if (hoMetricFilter === 'OK') {
                    toggleHoMetricExpanded('OK');
                  } else {
                    setHoMetricFilter('OK');
                    setHoExpandedByMetric((p) => ({ ...p, OK: true }));
                  }
                }
              }}
              title="Bấm để lọc riêng các phiếu có BTP chuyển giao đạt và thu lên / trải xuống bảng"
              className={`cursor-pointer border-l-4 border-l-emerald-600 p-3.5 transition-all hover:scale-[1.01] hover:shadow-md active:scale-[0.99] ${hoMetricFilter === 'OK'
                  ? 'ring-2 ring-emerald-500 ring-offset-2 bg-emerald-50/50'
                  : 'hover:border-emerald-300'
                }`}
            >
              <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">
                2. BTP Chuyển Giao Đạt
              </div>
              <div className="mt-1 font-mono-num text-2xl font-black text-emerald-700">
                {handovers.reduce((sum, h) => sum + (h.prodQtyTransferred || 0), 0).toLocaleString('vi-VN')}
              </div>
              <div className="text-[11px] text-emerald-600 font-semibold">Chuyển sang công đoạn sau</div>
              <div className="mt-2 flex items-center gap-1 text-[11px] font-bold">
                {hoMetricFilter === 'OK' ? (
                  <span className="inline-flex items-center gap-0.5 rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-900">
                    {hoExpandedByMetric.OK ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    <span>{hoExpandedByMetric.OK ? 'Đang mở (Bấm thu)' : 'Thu gọn (Bấm trải)'}</span>
                  </span>
                ) : (
                  <span className="text-emerald-700">🟢 Bấm lọc &amp; mở</span>
                )}
              </div>
            </Card>

            {/* THẺ 3: PHẾ PHẨM GIA CÔNG */}
            <Card
              role="button"
              tabIndex={0}
              onClick={() => {
                if (hoMetricFilter === 'DEFECT') {
                  toggleHoMetricExpanded('DEFECT');
                } else {
                  setHoMetricFilter('DEFECT');
                  setHoExpandedByMetric((p) => ({ ...p, DEFECT: true }));
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  if (hoMetricFilter === 'DEFECT') {
                    toggleHoMetricExpanded('DEFECT');
                  } else {
                    setHoMetricFilter('DEFECT');
                    setHoExpandedByMetric((p) => ({ ...p, DEFECT: true }));
                  }
                }
              }}
              title="Bấm để lọc riêng các phiếu có phát sinh phế phẩm hỏng gia công và thu lên / trải xuống bảng"
              className={`cursor-pointer border-l-4 border-l-rose-600 p-3.5 transition-all hover:scale-[1.01] hover:shadow-md active:scale-[0.99] ${hoMetricFilter === 'DEFECT'
                  ? 'ring-2 ring-rose-500 ring-offset-2 bg-rose-50/50'
                  : 'hover:border-rose-300'
                }`}
            >
              <div className="text-[11px] font-bold uppercase tracking-wider text-rose-700">
                3. Phế Phẩm Gia Công
              </div>
              <div className="mt-1 font-mono-num text-2xl font-black text-rose-700">
                {handovers.reduce((sum, h) => sum + (h.prodQtyDefect || 0), 0).toLocaleString('vi-VN')}
              </div>
              <div className="text-[11px] text-rose-600 font-semibold">Hỏng tại PX Gia Công</div>
              <div className="mt-2 flex items-center gap-1 text-[11px] font-bold">
                {hoMetricFilter === 'DEFECT' ? (
                  <span className="inline-flex items-center gap-0.5 rounded bg-rose-100 px-1.5 py-0.5 text-rose-900 font-extrabold">
                    {hoExpandedByMetric.DEFECT ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    <span>{hoExpandedByMetric.DEFECT ? 'Đang mở (Bấm thu)' : 'Thu gọn (Bấm trải)'}</span>
                  </span>
                ) : (
                  <span className="text-rose-700 font-extrabold animate-pulse">🔴 Bấm lọc &amp; mở</span>
                )}
              </div>
            </Card>

            {/* THẺ 4: PHÔI LỖI & HAO HỤT */}
            <Card
              role="button"
              tabIndex={0}
              onClick={() => {
                if (hoMetricFilter === 'RAW_DEFECT') {
                  toggleHoMetricExpanded('RAW_DEFECT');
                } else {
                  setHoMetricFilter('RAW_DEFECT');
                  setHoExpandedByMetric((p) => ({ ...p, RAW_DEFECT: true }));
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  if (hoMetricFilter === 'RAW_DEFECT') {
                    toggleHoMetricExpanded('RAW_DEFECT');
                  } else {
                    setHoMetricFilter('RAW_DEFECT');
                    setHoExpandedByMetric((p) => ({ ...p, RAW_DEFECT: true }));
                  }
                }
              }}
              title="Bấm để lọc riêng các phiếu có phôi lỗi đúc hoặc thiếu hàng và thu lên / trải xuống bảng"
              className={`cursor-pointer border-l-4 border-l-amber-600 p-3.5 transition-all hover:scale-[1.01] hover:shadow-md active:scale-[0.99] ${hoMetricFilter === 'RAW_DEFECT'
                  ? 'ring-2 ring-amber-500 ring-offset-2 bg-amber-50/50'
                  : 'hover:border-amber-300'
                }`}
            >
              <div className="text-[11px] font-bold uppercase tracking-wider text-amber-700">
                4. Phôi Lỗi &amp; Hao Hụt
              </div>
              <div className="mt-1 font-mono-num text-2xl font-black text-amber-700">
                {handovers.reduce((sum, h) => sum + (h.rawQtyDefect || 0) + (h.prodQtyMissing || 0), 0).toLocaleString('vi-VN')}
              </div>
              <div className="text-[11px] text-amber-600 font-semibold">Lỗi đúc / Thiếu hàng</div>
              <div className="mt-2 flex items-center gap-1 text-[11px] font-bold">
                {hoMetricFilter === 'RAW_DEFECT' ? (
                  <span className="inline-flex items-center gap-0.5 rounded bg-amber-100 px-1.5 py-0.5 text-amber-900">
                    {hoExpandedByMetric.RAW_DEFECT ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    <span>{hoExpandedByMetric.RAW_DEFECT ? 'Đang mở (Bấm thu)' : 'Thu gọn (Bấm trải)'}</span>
                  </span>
                ) : (
                  <span className="text-amber-800">⚡ Bấm lọc &amp; mở</span>
                )}
              </div>
            </Card>
          </div>

          {/* Filter Bar */}
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[240px]">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <input
                    type="text"
                    value={hoSearch}
                    onChange={(e) => setHoSearch(e.target.value)}
                    placeholder="Tìm theo sản phẩm, PO, khách hàng..."
                    className="h-9 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-xs font-semibold text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-slate-600">Ngày:</span>
                  <input
                    type="date"
                    value={hoDateFilter}
                    onChange={(e) => setHoDateFilter(e.target.value)}
                    className="h-9 rounded-lg border border-slate-300 px-2.5 text-xs font-bold text-slate-900"
                  />
                  {hoDateFilter && (
                    <button
                      type="button"
                      onClick={() => setHoDateFilter('')}
                      className="text-xs font-bold text-slate-500 hover:text-slate-900"
                    >
                      Xóa
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-1">
                  {(
                    [
                      ['ALL', 'Tất cả phân xưởng'],
                      ['PX_GIA_CONG', 'PX Gia Công'],
                      ['PX_HOAN_THIEN', 'PX Hoàn Thiện'],
                      ['PX_NHIET_LUYEN', 'PX Nhiệt Luyện'],
                      ['PHONG_KHVT', 'Phòng KHVT'],
                    ] as const
                  ).map(([deptKey, deptLabel]) => (
                    <button
                      key={deptKey}
                      type="button"
                      onClick={() => setHoDeptFilter(deptKey)}
                      className={`rounded-lg px-2.5 py-1.5 text-xs font-bold transition-all ${hoDeptFilter === deptKey
                          ? 'bg-amber-600 text-white shadow-sm'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                        }`}
                    >
                      {deptLabel}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => navigateTo(`/print/handover?date=${hoDateFilter || hoDate}`)}
                >
                  <Printer className="h-4 w-4" />
                  🖨️ In Biểu Mẫu A4 BM.GC.01.02
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleOpenCreateHandover}
                >
                  <Plus className="h-4 w-4" />
                  ➕ Lập Phiếu Mới / Nhập Số Liệu Bàn Giao
                </Button>
              </div>
            </div>
          </Card>

          {/* ================= BẢNG TỔNG HỢP LŨY KẾ & TIẾN ĐỘ ĐƠN HÀNG PO (TẤT CẢ PHÂN XƯỞNG) ================= */}
          {hoDeptFilter === 'ALL' && (
            <Card noPadding className="overflow-hidden border border-blue-200 shadow-2xs">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-blue-100 bg-blue-50/70 px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-blue-600 text-white font-black text-xs">
                    ∑
                  </div>
                  <div>
                    <span className="text-xs font-black uppercase text-blue-950">
                      Tổng Hợp Lũy Kế &amp; Tiến Độ Bàn Giao Theo Đơn Hàng PO (Tất Cả Phân Xưởng)
                    </span>
                    <span className="ml-2 text-[11px] font-semibold text-blue-700 hidden sm:inline">
                      Cộng dồn số liệu các ngày để ăn khớp với Lệnh PO &amp; QC
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsHoPoSummaryExpanded((p) => !p)}
                    className="inline-flex items-center gap-1 rounded-lg border border-blue-300 bg-white px-2.5 py-1 text-xs font-bold text-blue-800 shadow-2xs hover:bg-blue-50"
                  >
                    {isHoPoSummaryExpanded ? <ChevronUp className="h-3.5 w-3.5 text-blue-700" /> : <ChevronDown className="h-3.5 w-3.5 text-blue-700" />}
                    <span>{isHoPoSummaryExpanded ? '▲ Thu Lên' : `▼ Trải Xuống (${poHandoversSummary.length} Đơn PO)`}</span>
                  </button>
                </div>
              </div>

              {isHoPoSummaryExpanded && (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-100 font-bold text-slate-800 text-[11px] uppercase tracking-wider">
                        <th className="border-r border-slate-200 p-2.5 text-center">STT</th>
                        <th className="border-r border-slate-200 p-2.5">Mã PO &amp; Khách Hàng</th>
                        <th className="border-r border-slate-200 p-2.5">Tên Sản Phẩm / Bán Thành Phẩm</th>
                        <th className="border-r border-slate-200 p-2 text-center bg-blue-50/60 text-blue-900">SL Đặt PO</th>
                        <th className="border-r border-slate-200 p-2 text-center bg-amber-50/60 text-amber-900">Phôi Nhận</th>
                        <th className="border-r border-slate-200 p-2.5 bg-emerald-50 text-emerald-950">Chi Tiết Lũy Kế Chuyển Giao Theo Ngày &amp; Tuyến</th>
                        <th className="border-r border-slate-200 p-2 text-center bg-emerald-100/70 text-emerald-900 font-black">Cộng Tổng Đã Giao</th>
                        <th className="border-r border-slate-200 p-2 text-center bg-rose-50 text-rose-800">SP Lỗi</th>
                        <th className="border-r border-slate-200 p-2 text-center bg-amber-100/80 text-amber-900 font-black">Còn Thiếu Thực Tế</th>
                        <th className="border-r border-slate-200 p-2.5 text-center">Tiến Độ</th>
                        <th className="p-2 text-center">Liên Thông PO</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white">
                      {poHandoversSummary.length === 0 ? (
                        <tr>
                          <td colSpan={11} className="p-6 text-center text-slate-500 font-semibold">
                            Chưa có dữ liệu bàn giao công đoạn nào được ghi nhận.
                          </td>
                        </tr>
                      ) : (
                        poHandoversSummary.map((sumItem, sIdx) => {
                          return (
                            <tr key={sumItem.poId + sIdx} className="hover:bg-blue-50/30 transition-colors">
                              <td className="border-r border-slate-200 p-2.5 text-center font-bold font-mono-num text-slate-700">
                                {sIdx + 1}
                              </td>
                              <td className="border-r border-slate-200 p-2.5">
                                <div className="font-mono-num font-black text-blue-700 text-sm">{sumItem.poId}</div>
                                <div className="text-[11px] font-semibold text-slate-600">{sumItem.customer}</div>
                              </td>
                              <td className="border-r border-slate-200 p-2.5">
                                <div className="font-extrabold text-slate-900 text-sm">{sumItem.productName}</div>
                                {sumItem.interWorkshopRoutes.length > 0 && (
                                  <div className="mt-1 flex flex-wrap gap-1">
                                    {sumItem.interWorkshopRoutes.map((r, rIdx) => (
                                      <span key={rIdx} className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-700">
                                        <span>{r.route}:</span>
                                        <strong className="text-blue-700">{r.qty}</strong>
                                        {r.defect > 0 && <strong className="text-rose-600">({r.defect} lỗi)</strong>}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </td>
                              <td className="border-r border-slate-200 p-2 text-center font-mono-num font-black text-slate-900 text-sm bg-blue-50/20">
                                {sumItem.qtyPo > 0 ? sumItem.qtyPo : '—'}
                              </td>
                              <td className="border-r border-slate-200 p-2 text-center font-mono-num font-bold text-amber-800 bg-amber-50/20">
                                {sumItem.totalRaw > 0 ? sumItem.totalRaw : '—'}
                              </td>
                              <td className="border-r border-slate-200 p-2 text-xs bg-emerald-50/20">
                                <div className="space-y-1">
                                  {sumItem.dates.map((d, dIdx) => (
                                    <div key={dIdx} className="flex items-center justify-between gap-2 text-[11px]">
                                      <span className="font-mono-num font-bold text-slate-700">
                                        📅 {formatDateVn(d.date)}:
                                      </span>
                                      <span className="font-semibold text-slate-600 truncate max-w-[200px]" title={`${d.from} → ${d.to}`}>
                                        {d.from === 'PX_GIA_CONG' ? 'PX Gia Công' : d.from === 'PX_NHIET_LUYEN' ? 'PX Nhiệt Luyện' : d.from} &rarr; {d.to === 'PX_HOAN_THIEN' ? 'PX Hoàn Thiện' : d.to === 'PX_GIA_CONG' ? 'PX Gia Công' : d.to}
                                      </span>
                                      <span className="font-mono-num font-black text-emerald-700">
                                        +{d.qty} SP
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </td>
                              <td className="border-r border-slate-200 p-2 text-center font-mono-num font-black text-emerald-800 bg-emerald-100/50 text-base">
                                {sumItem.totalBtp}
                              </td>
                              <td className="border-r border-slate-200 p-2 text-center font-mono-num font-black text-rose-700 bg-rose-50/30">
                                {sumItem.totalDefect > 0 ? sumItem.totalDefect : '—'}
                              </td>
                              <td className="border-r border-slate-200 p-2 text-center font-mono-num font-black text-base bg-amber-100/60 text-amber-900">
                                {sumItem.missingQty > 0 ? (
                                  <span className="inline-block rounded bg-amber-200/80 px-2 py-0.5 text-amber-900 font-black">
                                    Thiếu {sumItem.missingQty}
                                  </span>
                                ) : (
                                  <span className="text-emerald-700 font-bold">Đủ 100%</span>
                                )}
                              </td>
                              <td className="border-r border-slate-200 p-2 text-center">
                                <div className="font-mono-num font-black text-blue-700 text-xs">
                                  {sumItem.progressPct}%
                                </div>
                                <div className="mt-1 h-2 w-full min-w-[60px] overflow-hidden rounded-full bg-slate-200">
                                  <div
                                    className={`h-full rounded-full transition-all ${sumItem.progressPct >= 100 ? 'bg-emerald-500' : 'bg-blue-600'
                                      }`}
                                    style={{ width: `${sumItem.progressPct}%` }}
                                  />
                                </div>
                              </td>
                              <td className="p-2 text-center whitespace-nowrap">
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (onNavigateTab) {
                                      onNavigateTab('orders', { ordersSearch: sumItem.poId });
                                    } else {
                                      navigateTo('/admin/orders');
                                    }
                                  }}
                                  className="inline-flex items-center gap-1 rounded-lg border border-blue-300 bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-800 shadow-2xs hover:bg-blue-100 hover:text-blue-900 transition-colors"
                                  title="Chuyển sang Lệnh PO & QR để xem tiến độ và xuất giao"
                                >
                                  <span>Lệnh PO</span>
                                  <ArrowRight className="h-3 w-3 text-blue-700" />
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}

          {/* Main Handover Table matching Form BM.GC.01.02 */}
          <Card noPadding className="overflow-hidden">
            {/* Header bar with Collapse / Expand and Master controls */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
              <div className="flex items-center gap-2">
                <span className="text-xs font-black uppercase text-slate-900">
                  {hoMetricFilter === 'DEFECT'
                    ? `🚨 Danh Sách ${filteredHandovers.length} Phiếu Có Phế Phẩm Hỏng Gia Công`
                    : hoMetricFilter === 'RAW_DEFECT'
                      ? `⚠️ Danh Sách ${filteredHandovers.length} Phiếu Có Phôi Lỗi Đúc / Hao Hụt`
                      : hoMetricFilter === 'OK'
                        ? `✅ Danh Sách ${filteredHandovers.length} Phiếu Chuyển Giao BTP Đạt`
                        : `📋 Sổ Chuyển Giao Bán Thành Phẩm & Phôi (BM.GC.01.02) — ${filteredHandovers.length} Phiếu`}
                </span>
              </div>

              <div className="flex items-center gap-2">
                {/* Nút Thu Lên / Trải Xuống mục đang chọn */}
                <button
                  type="button"
                  onClick={() => toggleHoMetricExpanded(hoMetricFilter)}
                  title={
                    hoExpandedByMetric[hoMetricFilter]
                      ? `Thu gọn bảng danh sách ${filteredHandovers.length} phiếu`
                      : `Trải rộng bảng danh sách ${filteredHandovers.length} phiếu`
                  }
                  className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-black shadow-2xs transition-all active:scale-[0.98] ${hoExpandedByMetric[hoMetricFilter]
                      ? 'border-blue-400 bg-blue-50 text-blue-900 hover:bg-blue-100'
                      : 'border-emerald-400 bg-emerald-50 text-emerald-900 ring-2 ring-emerald-200 hover:bg-emerald-100'
                    }`}
                >
                  {hoExpandedByMetric[hoMetricFilter] ? (
                    <>
                      <ChevronUp className="h-4 w-4 text-blue-700" />
                      <span>▲ Thu Lên</span>
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-4 w-4 text-emerald-700" />
                      <span>▼ Trải Xuống ({filteredHandovers.length} Phiếu)</span>
                    </>
                  )}
                </button>

                {/* Master buttons for all 4 categories */}
                <div className="flex items-center gap-1 border-l border-slate-300 pl-2">
                  <button
                    type="button"
                    onClick={() => toggleAllHoMetrics(false)}
                    title="Thu lên toàn bộ cả 4 mục"
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-bold text-slate-700 shadow-2xs hover:bg-slate-100"
                  >
                    <ChevronUp className="h-3 w-3 text-slate-600" />
                    <span>Thu cả 4 mục</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleAllHoMetrics(true)}
                    title="Trải xuống toàn bộ cả 4 mục"
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-bold text-slate-700 shadow-2xs hover:bg-slate-100"
                  >
                    <ChevronDown className="h-3 w-3 text-slate-600" />
                    <span>Trải cả 4 mục</span>
                  </button>
                </div>
              </div>
            </div>

            {!hoExpandedByMetric[hoMetricFilter] ? (
              <div
                role="button"
                tabIndex={0}
                onClick={() => toggleHoMetricExpanded(hoMetricFilter)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') toggleHoMetricExpanded(hoMetricFilter);
                }}
                className="flex cursor-pointer items-center justify-between bg-slate-50/90 px-4 py-3.5 text-xs font-bold text-slate-700 hover:bg-blue-50/70 hover:text-blue-900 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <ChevronDown className="h-4 w-4 text-blue-600" />
                  <span>
                    Bảng sổ chuyển giao công đoạn BM.GC.01.02 của <strong>{filteredHandovers.length}</strong> phiếu mục này đang được <strong>thu gọn</strong>.
                  </span>
                </div>
                <span className="inline-flex items-center gap-1 rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-xs font-black text-blue-800 shadow-2xs hover:bg-blue-50">
                  <span>Bấm để trải xuống ({filteredHandovers.length} Phiếu)</span>
                  <ChevronDown className="h-3.5 w-3.5" />
                </span>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-100 font-bold text-slate-800">
                      <th rowSpan={2} className="border-r border-slate-200 p-2.5 text-center">STT</th>
                      <th rowSpan={2} className="border-r border-slate-200 p-2.5">Ngày Bàn Giao</th>
                      <th rowSpan={2} className="min-w-[180px] border-r border-slate-200 p-2.5">Tên Sản Phẩm / Lệnh PO</th>
                      <th rowSpan={2} className="border-r border-slate-200 p-2.5">Khách Hàng</th>
                      <th rowSpan={2} className="border-r border-slate-200 p-2.5 text-center">ĐVT</th>
                      <th colSpan={3} className="border-r border-slate-200 p-2 text-center bg-emerald-50 text-emerald-900 font-extrabold">
                        Chuyển Giao Sản Phẩm (BTP)
                      </th>
                      <th colSpan={3} className="border-r border-slate-200 p-2 text-center bg-blue-50 text-blue-900 font-extrabold">
                        Chuyển Giao Phôi
                      </th>
                      <th rowSpan={2} className="border-r border-slate-200 p-2.5">Tuyến Bàn Giao</th>
                      <th rowSpan={2} className="border-r border-slate-200 p-2.5">Người Nhận / Người Giao</th>
                      <th rowSpan={2} className="border-r border-slate-200 p-2.5">Ghi Chú</th>
                      <th rowSpan={2} className="p-2.5 text-center whitespace-nowrap min-w-[90px]">Thao Tác</th>
                    </tr>
                    <tr className="border-b border-slate-300 bg-slate-50 text-[11px] font-bold text-slate-700 text-center">
                      <th className="border-r border-slate-200 p-1.5 bg-emerald-50 text-emerald-800">Số chuyển</th>
                      <th className="border-r border-slate-200 p-1.5 bg-rose-50 text-rose-700">SP lỗi</th>
                      <th className="border-r border-slate-200 p-1.5 bg-amber-50 text-amber-700">Số thiếu</th>
                      <th className="border-r border-slate-200 p-1.5 bg-blue-50 text-blue-800">Số chuyển</th>
                      <th className="border-r border-slate-200 p-1.5 bg-rose-50 text-rose-700">Phôi lỗi</th>
                      <th className="border-r border-slate-200 p-1.5 bg-amber-50 text-amber-700">Số thiếu</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white">
                    {filteredHandovers.length === 0 ? (
                      <tr>
                        <td colSpan={14} className="p-12 text-center">
                          <div className="flex flex-col items-center justify-center space-y-3">
                            <div className="text-slate-500 font-medium">
                              Chưa có phiếu chuyển giao công đoạn nào được ghi nhận cho tháng 11.
                            </div>
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={handleOpenCreateHandover}
                            >
                              <Plus className="h-4 w-4 mr-1" />
                              Nhập Số Liệu Chuyển Giao Mới / Bổ Sung Số Liệu Tháng 11
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      filteredHandovers.map((row, idx) => {
                        const deptName = (d: HandoverDept) => {
                          switch (d) {
                            case 'PX_GIA_CONG': return 'PX Gia Công';
                            case 'PX_HOAN_THIEN': return 'PX Hoàn Thiện';
                            case 'PX_NHIET_LUYEN': return 'PX Nhiệt Luyện';
                            case 'PHONG_KHVT': return 'Phòng KHVT';
                          }
                        };

                        return (
                          <tr key={row.id || idx} className="hover:bg-slate-50 transition-colors">
                            <td className="border-r border-slate-200 p-2.5 text-center font-bold font-mono-num text-slate-700">
                              {idx + 1}
                            </td>
                            <td className="border-r border-slate-200 p-2.5 font-mono-num font-semibold text-slate-900 whitespace-nowrap">
                              {formatDateVn(row.handoverDate)}
                            </td>
                            <td className="border-r border-slate-200 p-2.5">
                              <div className="font-extrabold text-slate-900">{row.productName}</div>
                              {row.poId && (
                                <div className="font-mono-num text-[11px] font-bold text-blue-700">
                                  {row.poId}
                                </div>
                              )}
                            </td>
                            <td className="border-r border-slate-200 p-2.5 text-slate-700 whitespace-nowrap">
                              {row.customer}
                            </td>
                            <td className="border-r border-slate-200 p-2.5 text-center font-semibold text-slate-600">
                              {row.unit || 'Cái'}
                            </td>
                            <td className="border-r border-slate-200 p-2 text-center font-mono-num font-black text-emerald-700 bg-emerald-50/30 text-sm">
                              {row.prodQtyTransferred || 0}
                            </td>
                            <td className="border-r border-slate-200 p-2 text-center font-mono-num font-black text-rose-700 bg-rose-50/30">
                              {row.prodQtyDefect > 0 ? row.prodQtyDefect : '—'}
                            </td>
                            <td className="border-r border-slate-200 p-2 text-center font-mono-num font-black text-amber-700 bg-amber-50/30">
                              {(() => {
                                const cleanPoId = (row.poId || '').trim().toLowerCase();
                                const cleanProd = (row.productName || '').trim().toLowerCase();
                                const po = bootstrap.ordersList.find((p) => (cleanPoId && p.poId.toLowerCase() === cleanPoId) || (cleanProd && p.productName.trim().toLowerCase() === cleanProd));
                                if (po && po.qtyPo > 0) {
                                  const samePoHandovers = handovers.filter((h) =>
                                    (cleanPoId && (h.poId || '').trim().toLowerCase() === cleanPoId) ||
                                    (cleanProd && (h.productName || '').trim().toLowerCase() === cleanProd)
                                  );
                                  const sorted = [...samePoHandovers].sort((a, b) =>
                                    (a.handoverDate || '').localeCompare(b.handoverDate || '') ||
                                    (a.id || '').localeCompare(b.id || '')
                                  );
                                  const rowIdx = sorted.findIndex((h) => h.id === row.id);
                                  const upToSlips = rowIdx >= 0 ? sorted.slice(0, rowIdx + 1) : [row];
                                  const cumProd = upToSlips.reduce((sum, h) => sum + (Number(h.prodQtyTransferred) || 0), 0);
                                  const missing = Math.max(0, po.qtyPo - cumProd);
                                  return missing > 0 ? missing : '—';
                                }
                                if (row.prodQtyMissing > 0) return row.prodQtyMissing;
                                return '—';
                              })()}
                            </td>
                            <td className="border-r border-slate-200 p-2 text-center font-mono-num font-black text-blue-700 bg-blue-50/30 text-sm">
                              {row.rawQtyTransferred || 0}
                            </td>
                            <td className="border-r border-slate-200 p-2 text-center font-mono-num font-black text-rose-700 bg-rose-50/30">
                              {row.rawQtyDefect > 0 ? row.rawQtyDefect : '—'}
                            </td>
                            <td className="border-r border-slate-200 p-2 text-center font-mono-num font-black text-amber-700 bg-amber-50/30">
                              {(() => {
                                if (row.rawQtyMissing > 0) return row.rawQtyMissing;
                                const po = bootstrap.ordersList.find((p) => (row.poId && p.poId.toLowerCase() === row.poId.toLowerCase()) || (row.productName && p.productName.trim().toLowerCase() === row.productName.trim().toLowerCase()));
                                if (po && po.qtyPo > 0) {
                                  const calc = Math.max(0, po.qtyPo - (row.rawQtyTransferred || 0) - (row.rawQtyDefect || 0));
                                  if (calc > 0) return calc;
                                }
                                return '—';
                              })()}
                            </td>
                            <td className="border-r border-slate-200 p-2.5 text-xs">
                              <div className="font-bold text-slate-800">
                                {deptName(row.fromDept)} &rarr; {deptName(row.toDept)}
                              </div>
                            </td>
                            <td className="border-r border-slate-200 p-2.5 text-xs">
                              <div className="text-slate-800">
                                <strong>Nhận:</strong> {row.receiverName || '—'}
                              </div>
                              <div className="text-slate-500">
                                <strong>Giao:</strong> {row.senderName || '—'}
                              </div>
                            </td>
                            <td className="border-r border-slate-200 p-2.5 text-xs text-slate-600">
                              {row.note || '—'}
                            </td>
                            <td className="p-2 text-center whitespace-nowrap">
                              <div className="flex items-center justify-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleOpenEditHandover(row)}
                                  className="inline-flex items-center gap-1 rounded bg-blue-50 px-2 py-1 text-xs font-bold text-blue-700 hover:bg-blue-100 hover:text-blue-900 border border-blue-200 transition-colors"
                                  title="Chỉnh sửa số liệu phiếu bàn giao đã chuyển trước đó"
                                >
                                  <Edit3 className="h-3 w-3" /> Sửa
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleDeleteHandover(row.id)}
                                  className="p-1 rounded text-rose-500 hover:text-rose-700 hover:bg-rose-50 transition-colors"
                                  title="Xóa phiếu bàn giao này"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ==================== MODAL: LẬP / CHỈNH SỬA PHIẾU CHUYỂN GIAO CÔNG ĐOẠN (BM.GC.01.02) ==================== */}
      <Modal
        open={hoModalOpen}
        onClose={() => setHoModalOpen(false)}
        title={
          editingHoId
            ? '✏️ Chỉnh Sửa Số Liệu Bàn Giao Đã Chuyển Trước Đó (BM.GC.01.02)'
            : '📋 Lập Phiếu / Nhập Số Liệu Bàn Giao Đã Chuyển Trước Đó (BM.GC.01.02)'
        }
        maxWidthClass="max-w-2xl"
      >
        <form onSubmit={(e) => void handleSaveHandover(e)} className="space-y-4 text-xs">
          {/* Notification / Guide Banner */}
          {editingHoId ? (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-2.5 text-[11px] text-amber-900 font-medium">
              💡 <strong>Đang chỉnh sửa số liệu bàn giao:</strong> Bạn có thể sửa ngày bàn giao (trong quá khứ), số lượng BTP/Phôi đã chuyển, lỗi hỏng, số thiếu để số liệu vào đúng thực tế đã chuyển trước đó.
            </div>
          ) : (
            <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-2.5 text-[11px] text-emerald-900 font-medium">
              💡 <strong>Nhập số liệu chuyển giao mới hoặc đã chuyển trước đó:</strong> Bạn có thể chọn ngày bàn giao trong quá khứ để nạp bù số liệu hàng đã chuyển giữa các phân xưởng từ trước.
            </div>
          )}
          {/* Quick PO Selector */}
          <div>
            <label className="mb-1 block font-bold text-slate-700 uppercase">
              1. Chọn Lệnh Sản Xuất PO / Sản Phẩm (Tự động điền dữ liệu)
            </label>
            <select
              value={hoSelectedPo}
              onChange={(e) => handleSelectPoForHandover(e.target.value)}
              className={modalInputCls}
            >
              {bootstrap.ordersList.map((po) => (
                <option key={po.poId} value={po.poId}>
                  {po.poId} — {po.productName} ({po.customer}) | SL: {po.qtyPo}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block font-bold text-slate-700">Tên Sản Phẩm</label>
              <input
                type="text"
                value={hoProdName}
                onChange={(e) => setHoProdName(e.target.value)}
                required
                className={modalInputCls}
              />
            </div>
            <div>
              <label className="mb-1 block font-bold text-slate-700">Khách Hàng</label>
              <input
                type="text"
                value={hoCustomer}
                onChange={(e) => setHoCustomer(e.target.value)}
                className={modalInputCls}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block font-bold text-slate-700">Ngày Bàn Giao</label>
              <input
                type="date"
                value={hoDate}
                onChange={(e) => setHoDate(e.target.value)}
                className={modalInputCls}
              />
            </div>
            <div>
              <label className="mb-1 block font-bold text-slate-700">Từ Phân Xưởng (Giao)</label>
              <select
                value={hoFromDept}
                onChange={(e) => setHoFromDept(e.target.value as HandoverDept)}
                className={modalInputCls}
              >
                <option value="PX_GIA_CONG">PX Gia Công</option>
                <option value="PHONG_KHVT">Phòng KHVT</option>
                <option value="PX_NHIET_LUYEN">PX Nhiệt Luyện</option>
                <option value="PX_HOAN_THIEN">PX Hoàn Thiện</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block font-bold text-slate-700">Đến Phân Xưởng (Nhận)</label>
              <select
                value={hoToDept}
                onChange={(e) => setHoToDept(e.target.value as HandoverDept)}
                className={modalInputCls}
              >
                <option value="PX_NHIET_LUYEN">PX Nhiệt Luyện</option>
                <option value="PX_HOAN_THIEN">PX Hoàn Thiện</option>
                <option value="PX_GIA_CONG">PX Gia Công</option>
                <option value="PHONG_KHVT">Phòng KHVT</option>
              </select>
            </div>
          </div>

          {/* Quick Auto-Fill Button */}
          <div className="flex items-center justify-between rounded-xl border border-blue-200 bg-blue-50/60 p-2.5">
            <span className="text-[11px] font-semibold text-blue-900">
              ⚡ Tự động tính tổng SL Đạt và Hỏng từ các mẻ thợ vừa nộp trên điện thoại:
            </span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleFillFromShiftLogs}
            >
              Điền Từ Nhật Ký Ca
            </Button>
          </div>

          {/* Transfer Quantities: Products (BTP) */}
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/30 p-3 space-y-2">
            <div className="font-extrabold text-emerald-900 uppercase">
              2. Chuyển Giao Sản Phẩm (Bán Thành Phẩm)
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="mb-1 block font-bold text-emerald-800">Số Chuyển (OK)</label>
                <input
                  type="number"
                  min="0"
                  value={hoProdQtyTransferred}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setHoProdQtyTransferred(val);
                    const po = bootstrap.ordersList.find((p) => p.poId === hoSelectedPo);
                    if (po && po.qtyPo > 0) {
                      setHoProdQtyMissing(Math.max(0, po.qtyPo - priorProdTransferred - val - hoProdQtyDefect));
                    }
                  }}
                  className={modalInputCls}
                />
              </div>
              <div>
                <label className="mb-1 block font-bold text-rose-700">SP Lỗi (NG)</label>
                <input
                  type="number"
                  min="0"
                  value={hoProdQtyDefect}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setHoProdQtyDefect(val);
                    const po = bootstrap.ordersList.find((p) => p.poId === hoSelectedPo);
                    if (po && po.qtyPo > 0) {
                      setHoProdQtyMissing(Math.max(0, po.qtyPo - priorProdTransferred - hoProdQtyTransferred - val));
                    }
                  }}
                  className={modalInputCls}
                />
              </div>
              <div>
                <label className="mb-1 block font-bold text-amber-700">Số Thiếu (Còn nợ đơn PO)</label>
                <input
                  type="number"
                  min="0"
                  value={hoProdQtyMissing}
                  onChange={(e) => setHoProdQtyMissing(Number(e.target.value))}
                  className={modalInputCls}
                />
              </div>
            </div>
            {(() => {
              const po = bootstrap.ordersList.find((p) => p.poId === hoSelectedPo);
              if (!po) return null;
              const cumTransferred = priorProdTransferred + hoProdQtyTransferred;
              const remMissing = Math.max(0, po.qtyPo - cumTransferred - hoProdQtyDefect);
              return (
                <div className="text-[11px] font-semibold text-emerald-800 bg-emerald-50 px-2.5 py-1.5 rounded-lg border border-emerald-200 flex flex-wrap items-center justify-between gap-1">
                  <span>
                    💡 Đơn PO: <strong>{po.qtyPo} Cái</strong> • Đã chuyển các đợt trước: <strong className="text-blue-700">{priorProdTransferred}</strong> • Tổng lũy kế đợt này: <strong className="text-emerald-700">{cumTransferred}</strong>
                  </span>
                  <span>
                    Còn thiếu sau giao: <strong className="text-amber-800">{remMissing} SP</strong>
                  </span>
                </div>
              );
            })()}
          </div>

          {/* Transfer Quantities: Raw Material (Phôi) */}
          <div className="rounded-xl border border-blue-200 bg-blue-50/30 p-3 space-y-2">
            <div className="font-extrabold text-blue-900 uppercase">
              3. Chuyển Giao Phôi (Cấp hoặc Thu Hồi Phôi)
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="mb-1 block font-bold text-blue-800">Số Chuyển (Phôi nhận)</label>
                <input
                  type="number"
                  min="0"
                  value={hoRawQtyTransferred}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setHoRawQtyTransferred(val);
                    const po = bootstrap.ordersList.find((p) => p.poId === hoSelectedPo);
                    if (po && po.qtyPo > 0) {
                      setHoRawQtyMissing(Math.max(0, po.qtyPo - val - hoRawQtyDefect));
                    }
                  }}
                  className={modalInputCls}
                />
              </div>
              <div>
                <label className="mb-1 block font-bold text-rose-700">Phôi Lỗi (Đúc/Rỗ)</label>
                <input
                  type="number"
                  min="0"
                  value={hoRawQtyDefect}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setHoRawQtyDefect(val);
                    const po = bootstrap.ordersList.find((p) => p.poId === hoSelectedPo);
                    if (po && po.qtyPo > 0) {
                      setHoRawQtyMissing(Math.max(0, po.qtyPo - hoRawQtyTransferred - val));
                    }
                  }}
                  className={modalInputCls}
                />
              </div>
              <div>
                <label className="mb-1 block font-bold text-amber-700">Số Thiếu Phôi</label>
                <input
                  type="number"
                  min="0"
                  value={hoRawQtyMissing}
                  onChange={(e) => setHoRawQtyMissing(Number(e.target.value))}
                  className={modalInputCls}
                />
              </div>
            </div>
            {(() => {
              const po = bootstrap.ordersList.find((p) => p.poId === hoSelectedPo);
              if (!po) return null;
              return (
                <div className="text-[11px] font-semibold text-blue-800 bg-blue-50 px-2 py-1 rounded border border-blue-200">
                  💡 SL Đặt: <strong>{po.qtyPo}</strong> — Phôi còn thiếu: <strong>{Math.max(0, po.qtyPo - hoRawQtyTransferred - hoRawQtyDefect)} phôi</strong> (Ghi nhận phôi nhận vào WIP: <strong>{hoRawQtyTransferred}</strong>)
                </div>
              );
            })()}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block font-bold text-slate-700">
                Người Giao <span className="text-blue-600 font-normal text-xs">(Chọn từ danh sách)</span>
              </label>
              <select
                value={HANDOVER_SENDER_OPTIONS.includes(hoSender) ? hoSender : (customSenderMode ? '__CUSTOM__' : hoSender)}
                onChange={(e) => {
                  if (e.target.value === '__CUSTOM__') {
                    setCustomSenderMode(true);
                    setHoSender('');
                  } else {
                    setCustomSenderMode(false);
                    setHoSender(e.target.value);
                  }
                }}
                className={modalInputCls}
              >
                <option value="Hoàng Ngọc Hà">Hoàng Ngọc Hà (Quản đốc)</option>
                <option value="Lê Trung Hải">Lê Trung Hải</option>
                <option value="Nguyễn Văn Duy">Nguyễn Văn Duy</option>
                <option value="Trần Văn Dũng">Trần Văn Dũng (Trưởng Ca 2)</option>
                <option value="Phạm Văn Tráng">Phạm Văn Tráng (Trưởng Ca 1)</option>
                <option value="Phùng Gia Phúc">Phùng Gia Phúc (Trưởng Ca 3)</option>
                <option value="Trần Văn Quỳnh">Trần Văn Quỳnh (Kỹ thuật)</option>
                {!HANDOVER_SENDER_OPTIONS.includes(hoSender) && hoSender && (
                  <option value={hoSender}>{hoSender}</option>
                )}
                <option value="__CUSTOM__">-- Nhập tên khác... --</option>
              </select>
              {customSenderMode && (
                <input
                  type="text"
                  placeholder="Nhập họ tên người giao..."
                  value={hoSender}
                  onChange={(e) => setHoSender(e.target.value)}
                  className={`mt-1.5 ${modalInputCls}`}
                  autoFocus
                />
              )}
            </div>
            <div>
              <label className="mb-1 block font-bold text-slate-700">
                Người Nhận <span className="text-emerald-600 font-normal text-xs">(Chọn từ danh sách)</span>
              </label>
              <select
                value={HANDOVER_RECEIVER_OPTIONS.includes(hoReceiver) ? hoReceiver : (customReceiverMode ? '__CUSTOM__' : hoReceiver)}
                onChange={(e) => {
                  if (e.target.value === '__CUSTOM__') {
                    setCustomReceiverMode(true);
                    setHoReceiver('');
                  } else {
                    setCustomReceiverMode(false);
                    setHoReceiver(e.target.value);
                  }
                }}
                className={modalInputCls}
              >
                <option value="Phùng Gia Phúc">Phùng Gia Phúc (Trưởng Ca 3)</option>
                <option value="Phạm Văn Tráng">Phạm Văn Tráng (Trưởng Ca 1)</option>
                <option value="Trần Văn Dũng">Trần Văn Dũng (Trưởng Ca 2)</option>
                <option value="Lê Trung Hải">Lê Trung Hải</option>
                <option value="Nguyễn Văn Duy">Nguyễn Văn Duy</option>
                <option value="Hoàng Ngọc Hà">Hoàng Ngọc Hà (Quản đốc)</option>
                <option value="Trần Văn Quỳnh">Trần Văn Quỳnh (Kỹ thuật)</option>
                {!HANDOVER_RECEIVER_OPTIONS.includes(hoReceiver) && hoReceiver && (
                  <option value={hoReceiver}>{hoReceiver}</option>
                )}
                <option value="__CUSTOM__">-- Nhập tên khác... --</option>
              </select>
              {customReceiverMode && (
                <input
                  type="text"
                  placeholder="Nhập họ tên người nhận..."
                  value={hoReceiver}
                  onChange={(e) => setHoReceiver(e.target.value)}
                  className={`mt-1.5 ${modalInputCls}`}
                  autoFocus
                />
              )}
            </div>
          </div>

          <div>
            <label className="mb-1 block font-bold text-slate-700">Ghi Chú Bàn Giao</label>
            <input
              type="text"
              value={hoNote}
              onChange={(e) => setHoNote(e.target.value)}
              placeholder="Ví dụ: Đã qua tôi cao tần, chuyển mài phẳng..."
              className={modalInputCls}
            />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
            <Button
              type="button"
              variant="ghost"
              size="md"
              onClick={() => setHoModalOpen(false)}
            >
              Hủy Bỏ
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={submittingHo}
            >
              {submittingHo ? 'Đang Lưu...' : editingHoId ? '💾 Lưu Cập Nhật Số Liệu' : '➕ Lưu Phiếu Bàn Giao'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ==================== MODAL: EDIT / VOID PRODUCTION LOG ==================== */}
      <Modal
        open={Boolean(editLog)}
        onClose={() => setEditLog(null)}
        title={`✏️ Hiệu Chỉnh / Hủy Phiếu Sản Lượng: ${editLog?.recordUid || `#${editLog?.id || ''}`}`}
        subtitle={
          editLog
            ? `${editLog.workerName} • ${editLog.machineName} • [${editLog.poId}] ${editLog.productName}`
            : ''
        }
        maxWidthClass="max-w-xl"
      >
        <form noValidate onSubmit={handleSaveLogEdit} className="space-y-3.5 text-xs">
          {/* Ngày & Ca */}
          <div className="grid grid-cols-2 gap-3 rounded-xl border border-blue-200 bg-blue-50/40 p-2.5">
            <div>
              <label className="mb-1 block font-bold uppercase text-blue-900">Ngày Làm Việc</label>
              <input
                type="date"
                value={editWorkDate}
                onChange={(e) => setEditWorkDate(e.target.value)}
                className={modalInputCls}
              />
            </div>
            <div>
              <label className="mb-1 block font-bold uppercase text-blue-900">Ca Sản Xuất</label>
              <select
                value={editShiftType}
                onChange={(e) => setEditShiftType(e.target.value)}
                className={modalInputCls}
              >
                <option value="Ca 1 (06:00-14:00)">Ca 1 (06:00-14:00)</option>
                <option value="Ca 2 (14:00-22:00)">Ca 2 (14:00-22:00)</option>
                <option value="Ca 3 (22:00-06:00)">Ca 3 (22:00-06:00)</option>
                <option value="Ca HC (08:00-17:00)">Ca HC (08:00-17:00)</option>
              </select>
            </div>
          </div>

          {/* Máy & Chế độ máy */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block font-bold uppercase text-slate-700">Máy Gia Công</label>
              <select
                value={editMachineName}
                onChange={(e) => setEditMachineName(e.target.value)}
                className={modalInputCls}
              >
                {editMachineName && !bootstrap.machines.some((m) => m.name === editMachineName) && (
                  <option value={editMachineName}>{editMachineName}</option>
                )}
                {bootstrap.machines.map((m) => (
                  <option key={m.id} value={m.name}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block font-bold uppercase text-slate-700">Chế Độ Khoán Máy</label>
              <select
                value={editMachineMode}
                onChange={(e) => setEditMachineMode(e.target.value as 'FIRST' | 'SECOND')}
                className={modalInputCls}
              >
                <option value="FIRST">Máy chính (100% ĐM máy)</option>
                <option value="SECOND">Máy phụ / Ghép máy 0.33</option>
              </select>
            </div>
          </div>

          {/* Lệnh PO & Nguyên Công */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block font-bold uppercase text-slate-700">Lệnh PO</label>
              <select
                value={editPoId}
                onChange={(e) => {
                  const nextPo = e.target.value;
                  setEditPoId(nextPo);
                  const poObj = bootstrap.ordersList.find((p) => p.poId === nextPo);
                  if (poObj?.spId) {
                    const opObj = bootstrap.operations.find((o) => o.spId === poObj.spId);
                    if (opObj) {
                      setEditNcId(opObj.ncId);
                      setEditStdSeconds(Number(opObj.stdSeconds || 1800));
                    }
                  }
                }}
                className={modalInputCls}
              >
                {editPoId && !bootstrap.ordersList.some((p) => p.poId === editPoId) && (
                  <option value={editPoId}>{editPoId}</option>
                )}
                {bootstrap.ordersList.map((po) => (
                  <option key={po.poId} value={po.poId}>
                    {po.poId} — {po.productName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block font-bold uppercase text-slate-700">Nguyên Công</label>
              <select
                value={editNcId}
                onChange={(e) => {
                  const nextNc = e.target.value;
                  setEditNcId(nextNc);
                  const opObj = bootstrap.operations.find((o) => o.ncId === nextNc);
                  if (opObj?.stdSeconds) {
                    setEditStdSeconds(Number(opObj.stdSeconds));
                  }
                }}
                className={modalInputCls}
              >
                {bootstrap.operations.map((op) => (
                  <option key={op.ncId} value={op.ncId}>
                    [{op.ncId}] {op.opName} — {op.productName} ({op.stdSeconds}s)
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Định mức giây/SP & Phút dừng máy */}
          <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-2.5">
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="font-bold uppercase text-slate-700">Định Mức (Giây/SP)</label>
                <span className="font-mono-num text-[11px] font-extrabold text-blue-700">
                  ≈ {editStdSeconds > 0 ? Math.round((28800 / editStdSeconds) * 100) / 100 : 0} SP/ca 8h
                </span>
              </div>
              <input
                type="number"
                min={10}
                step="any"
                value={editStdSeconds}
                onChange={(e) => setEditStdSeconds(Math.max(10, Number(e.target.value) || 1800))}
                className={`${modalInputCls} font-mono-num font-bold text-blue-700`}
              />
              <div className="mt-1.5 flex flex-wrap gap-1">
                {[
                  { label: '12 SP/ca (2400s)', sec: 2400 },
                  { label: '10 SP/ca (2880s)', sec: 2880 },
                  { label: '8 SP/ca (3600s)', sec: 3600 },
                  { label: '6 SP/ca (4800s)', sec: 4800 },
                  { label: '5 SP/ca (5760s)', sec: 5760 },
                ].map((preset) => (
                  <button
                    key={preset.sec}
                    type="button"
                    onClick={() => setEditStdSeconds(preset.sec)}
                    className={`rounded border px-1.5 py-0.5 text-[10px] font-bold transition-colors ${editStdSeconds === preset.sec
                        ? 'border-blue-600 bg-blue-600 text-white'
                        : 'border-slate-300 bg-white text-slate-700 hover:bg-blue-50'
                      }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-1 block font-bold uppercase text-amber-800">
                Phút Dừng Máy (Phút)
              </label>
              <input
                type="number"
                min={0}
                max={480}
                step="any"
                value={editStopMinutes}
                onChange={(e) => setEditStopMinutes(Math.max(0, Number(e.target.value) || 0))}
                className={`${modalInputCls} font-mono-num font-bold text-amber-800`}
              />
              <div className="mt-1.5 text-[11px] text-slate-600">
                KPI dự kiến phiếu này:{' '}
                <strong className="text-blue-700">
                  {Math.round(
                    (((editOkQty + editReworkQty + editScrapQty) * editStdSeconds) /
                      Math.max(1, 28800 - editStopMinutes * 60)) *
                    10000
                  ) / 100}
                  % ĐM
                </strong>
              </div>
            </div>
          </div>

          {/* Số lượng OK / Rework / NG */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block font-bold uppercase text-emerald-700">SL Đạt (OK)</label>
              <input
                type="number"
                min={0}
                step="any"
                value={editOkQty}
                onChange={(e) => setEditOkQty(Math.max(0, Number(e.target.value) || 0))}
                className={`${modalInputCls} font-mono-num text-base font-bold text-emerald-700`}
              />
            </div>
            <div>
              <label className="mb-1 block font-bold uppercase text-amber-700">SL Rework (Sửa)</label>
              <input
                type="number"
                min={0}
                step="any"
                value={editReworkQty}
                onChange={(e) => setEditReworkQty(Math.max(0, Number(e.target.value) || 0))}
                className={`${modalInputCls} font-mono-num text-base font-bold text-amber-700`}
              />
            </div>
            <div>
              <label className="mb-1 block font-bold uppercase text-rose-700">SL Hủy (NG)</label>
              <input
                type="number"
                min={0}
                step="any"
                value={editScrapQty}
                onChange={(e) => setEditScrapQty(Math.max(0, Number(e.target.value) || 0))}
                className={`${modalInputCls} font-mono-num text-base font-bold text-rose-700`}
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block font-bold uppercase text-slate-700">
              Trạng Thái Phê Duyệt QC
            </label>
            <select
              value={editQcStatus}
              onChange={(e) =>
                setEditQcStatus(e.target.value as 'PASSED' | 'PENDING_QC' | 'NG_HOLD')
              }
              className={modalInputCls}
            >
              <option value="PASSED">PASSED — Đạt chất lượng</option>
              <option value="PENDING_QC">PENDING_QC — Đang chờ hậu kiểm</option>
              <option value="NG_HOLD">NG_HOLD — Tạm giữ khoang đỏ chờ xử lý</option>
            </select>
          </div>

          <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-rose-200 bg-rose-50/70 p-3">
            <input
              type="checkbox"
              checked={editIsVoided}
              onChange={(e) => setEditIsVoided(e.target.checked)}
              className="h-4 w-4 rounded border-rose-300 bg-white text-rose-600 focus:ring-rose-500"
            />
            <div>
              <div className="font-bold text-rose-800">
                🚫 Đánh dấu Hủy phiếu báo cáo nhầm (Void Ticket)
              </div>
              <div className="text-[11px] text-slate-600">
                Phiếu bị hủy sẽ không tính vào lương tháng, giá thành thực tế và tự động hoàn trừ SL
                thành phẩm trên PO nếu là công đoạn cuối.
              </div>
            </div>
          </label>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setEditLog(null)}>
              Đóng
            </Button>
            <Button
              type="submit"
              variant={editIsVoided ? 'danger' : 'primary'}
              disabled={savingLogEdit}
            >
              {editIsVoided ? <XCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
              {savingLogEdit
                ? 'Đang lưu Cloud...'
                : editIsVoided
                  ? 'Xác Nhận Hủy Phiếu'
                  : 'Lưu Hiệu Chỉnh'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ==================== MODAL: CREATE 3-TIER QC INSPECTION ==================== */}
      <Modal
        open={createQcOpen}
        onClose={() => setCreateQcOpen(false)}
        title="🔬 Lập Biên Bản Kiểm Soát Chất Lượng 3 Tầng (FAI / IPQC / OQC)"
        subtitle="Ghi nhận bảng đo kích thước dung sai thực tế ±0.01mm và phê duyệt chạy loạt"
        maxWidthClass="max-w-2xl"
      >
        <form noValidate onSubmit={handleSubmitQc} className="space-y-3.5 text-xs">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block font-bold uppercase text-slate-700">
                Tầng Kiểm Tra (*)
              </label>
              <select
                value={qcInspType}
                onChange={(e) => setQcInspType(e.target.value as any)}
                className={`${modalInputCls} font-bold text-emerald-700`}
              >
                <option value="FAI">FAI — Duyệt mẫu đầu tiên</option>
                <option value="IPQC">IPQC — Tuần kiểm trong ca</option>
                <option value="OQC">OQC — Kiểm cuối xuất xưởng</option>
                <option value="NG_REVIEW">NG_REVIEW — Xử lý phế phẩm</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block font-bold uppercase text-slate-700">
                Mã Lệnh PO (*)
              </label>
              <select
                value={qcPoId}
                onChange={(e) => setQcPoId(e.target.value)}
                className={`${modalInputCls} font-bold text-blue-700`}
              >
                {bootstrap.ordersList.map((po) => (
                  <option key={po.poId} value={po.poId}>
                    {po.poId} — {po.productName}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block font-bold uppercase text-slate-700">Nguyên Công</label>
              <select
                value={qcNcId}
                onChange={(e) => setQcNcId(e.target.value)}
                className={modalInputCls}
              >
                <option value="">-- Chung toàn PO --</option>
                {opsForQcPo.map((op) => (
                  <option key={op.ncId} value={op.ncId}>
                    {op.ncId} — {op.opName}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <label className="mb-1 block font-bold uppercase text-slate-700">Máy gia công</label>
              <select
                value={qcMachineName}
                onChange={(e) => setQcMachineName(e.target.value)}
                className={`${filterInputCls} w-full font-medium`}
              >
                {bootstrap.machines.map((m) => (
                  <option key={m.id} value={m.name}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block font-bold uppercase text-slate-700">Thợ đứng máy</label>
              <select
                value={qcOperatorId}
                onChange={(e) => setQcOperatorId(e.target.value)}
                className={`${filterInputCls} w-full font-medium`}
              >
                {bootstrap.workers.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block font-bold uppercase text-slate-700">Cỡ mẫu đo</label>
              <input
                type="number"
                min={1}
                step="any"
                value={qcSampleSize}
                onChange={(e) => setQcSampleSize(Math.max(1, Number(e.target.value) || 1))}
                className={`${filterInputCls} font-mono-num w-full font-bold`}
              />
            </div>
            <div>
              <label className="mb-1 block font-bold uppercase text-slate-700">
                SL Lỗi phát hiện
              </label>
              <input
                type="number"
                min={0}
                step="any"
                value={qcDefectQty}
                onChange={(e) => setQcDefectQty(Math.max(0, Number(e.target.value) || 0))}
                className={`${filterInputCls} font-mono-num w-full font-bold text-rose-700`}
              />
            </div>
          </div>

          {/* Precision Tolerance Table ±0.01mm */}
          <div className="rounded-xl border border-blue-200 bg-slate-50/80 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-bold uppercase text-blue-800">
                📏 Bảng Đo Kích Thước Dung Sai Thực Tế (Panme / Đồng Hồ So ±0.01mm)
              </span>
              <button
                type="button"
                onClick={() =>
                  setQcDims((prev) => [
                    ...prev,
                    {
                      feature: `Kích thước KT${prev.length + 1}`,
                      nominal: 50,
                      tolPlusMinus: 0.01,
                      measured: 50.0,
                    },
                  ])
                }
                className="rounded border border-blue-300 bg-white px-2 py-0.5 text-[11px] font-bold text-blue-700 transition-colors hover:bg-blue-50"
              >
                + Thêm dòng đo
              </button>
            </div>

            <div className="space-y-1.5">
              {qcDims.map((dim, idx) => {
                const diff = Math.abs(Number(dim.measured) - Number(dim.nominal));
                const isOk = diff <= Number(dim.tolPlusMinus) + 1e-6;
                return (
                  <div key={idx} className="grid grid-cols-12 items-center gap-1.5">
                    <input
                      type="text"
                      value={dim.feature}
                      onChange={(e) =>
                        setQcDims((prev) =>
                          prev.map((r, i) => (i === idx ? { ...r, feature: e.target.value } : r))
                        )
                      }
                      className="col-span-5 h-8 rounded border border-slate-300 bg-white px-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
                      placeholder="Tên kích thước"
                    />
                    <input
                      type="number"
                      step="any"
                      value={dim.nominal}
                      onChange={(e) =>
                        setQcDims((prev) =>
                          prev.map((r, i) =>
                            i === idx ? { ...r, nominal: Number(e.target.value) } : r
                          )
                        )
                      }
                      className="font-mono-num col-span-2 h-8 rounded border border-slate-300 bg-white px-2 text-right text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
                      title="Danh nghĩa (mm)"
                    />
                    <input
                      type="number"
                      step="any"
                      value={dim.tolPlusMinus}
                      onChange={(e) =>
                        setQcDims((prev) =>
                          prev.map((r, i) =>
                            i === idx ? { ...r, tolPlusMinus: Number(e.target.value) } : r
                          )
                        )
                      }
                      className="font-mono-num col-span-2 h-8 rounded border border-slate-300 bg-white px-2 text-right text-xs font-semibold text-amber-700 focus:border-blue-500 focus:outline-none"
                      title="Dung sai ± (mm)"
                    />
                    <input
                      type="number"
                      step="any"
                      value={dim.measured}
                      onChange={(e) =>
                        setQcDims((prev) =>
                          prev.map((r, i) =>
                            i === idx ? { ...r, measured: Number(e.target.value) } : r
                          )
                        )
                      }
                      className="font-mono-num col-span-2 h-8 rounded border border-blue-300 bg-white px-2 text-right text-xs font-bold text-blue-700 focus:border-blue-500 focus:outline-none"
                      title="Thực đo (mm)"
                    />
                    <div className="col-span-1 text-center">
                      <Badge variant={isOk ? 'success' : 'danger'}>{isOk ? 'OK' : 'NG'}</Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block font-bold uppercase text-slate-700">
                Kết Luận Phê Duyệt (*)
              </label>
              <select
                value={qcResult}
                onChange={(e) => setQcResult(e.target.value as any)}
                className={`${modalInputCls} font-bold`}
              >
                <option value="PASS">✅ PASS — Đạt chuẩn cho chạy loạt</option>
                <option value="CONCESSION">🔵 CONCESSION — Nhân nhượng kỹ thuật</option>
                <option value="REWORK">🟡 REWORK — Yêu cầu sửa lại</option>
                <option value="SCRAP">🔴 SCRAP — Loại bỏ phế phẩm</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block font-bold uppercase text-slate-700">
                Nguyên Nhân (nếu lỗi)
              </label>
              <input
                type="text"
                value={qcRootCause}
                onChange={(e) => setQcRootCause(e.target.value)}
                placeholder="Mòn mảnh dao tinh, lệch gốc G54..."
                className={modalInputCls}
              />
            </div>
            <div>
              <label className="mb-1 block font-bold uppercase text-slate-700">
                Đối Sách Khắc Phục
              </label>
              <input
                type="text"
                value={qcCorrective}
                onChange={(e) => setQcCorrective(e.target.value)}
                placeholder="Bù dao -0.015mm, thay chíp mới..."
                className={modalInputCls}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setCreateQcOpen(false)}>
              Hủy
            </Button>
            <Button type="submit" variant="success" disabled={submittingQc}>
              <ShieldCheck className="h-4 w-4" />
              {submittingQc ? 'Đang lưu biên bản...' : 'Lưu Biên Bản Kiểm Tra QC'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ==================== MODAL: PHOTO EVIDENCE PREVIEW ==================== */}
      <Modal
        open={Boolean(previewPhotoLog)}
        onClose={() => setPreviewPhotoLog(null)}
        title={`📷 Ảnh Minh Chứng Sản Lượng: ${previewPhotoLog?.recordUid || ''}`}
        subtitle={
          previewPhotoLog
            ? `${previewPhotoLog.workerName} • ${previewPhotoLog.productName} (${previewPhotoLog.opName})`
            : ''
        }
        maxWidthClass="max-w-lg"
      >
        {previewPhotoLog && (
          <div className="space-y-3 text-xs">
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
              <img
                src={previewPhotoLog.photoUrl}
                alt={previewPhotoLog.productName}
                className="max-h-[420px] w-full object-contain"
              />
            </div>
            {previewPhotoLog.handoverNote && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 font-medium text-amber-900">
                📝 Ghi chú bàn giao: {previewPhotoLog.handoverNote}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
