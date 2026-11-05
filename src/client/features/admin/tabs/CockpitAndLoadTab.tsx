import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  ArrowRightLeft,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileText,
  Clock,
  Cpu,
  Flame,
  Layers,
  Moon,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Wrench,
} from 'lucide-react';
import type {
  MachineLoadSummary,
  OperationMeta,
  PurchaseOrderInfo,
  ScheduleBlock,
} from '@shared/types';
import { matchesSearch, normalizeVn } from '@shared/vnSearch';
import { apiClient } from '@client/lib/apiClient';
import { formatDateVn, formatDurationSec, formatNumber } from '@client/lib/formatters';
import {
  Badge,
  Button,
  Card,
  Modal,
  PaginationBar,
  useToast,
} from '@client/components/ui/IndustrialPrimitives';
import type { AdminTabCommonProps } from '../types';

type LoadFilterMode = 'ALL' | 'BOTTLENECK' | 'WARNING' | 'NORMAL' | 'IDLE' | 'LIGHTS_OUT';
type WipViewMode = 'PO_WEIGHTED' | 'PRODUCT_CATALOG';

interface WeightedWipItem {
  key: string;
  poId: string | null;
  customer: string;
  productName: string;
  spId: string | null;
  qtyTarget: number;
  dueDate: string | null;
  totalStdSec: number;
  weightedPct: number;
  steps: Array<{
    ncId: string;
    opName: string;
    stepOrder: number;
    isFinalOp: number;
    stdSeconds: number;
    doneQty: number;
    stepPct: number;
  }>;
}

const SHIFT_OPTIONS = [
  'Ca 1 (Sáng 06h-14h)',
  'Ca 2 (Chiều 14h-22h)',
  'Ca 3 (Đêm 22h-06h)',
  'Ca Hành chính (07h30-16h30)',
];

export function CockpitAndLoadTab({
  bootstrap,
  onRefreshBootstrap,
  onNavigateTab,
}: AdminTabCommonProps) {
  const toast = useToast();

  const [loads, setLoads] = useState<MachineLoadSummary[]>(bootstrap.machineLoads || []);
  const [schedules, setSchedules] = useState<ScheduleBlock[]>(bootstrap.schedules || []);
  const [loadFilter, setLoadFilter] = useState<LoadFilterMode>('ALL');
  const [machineQuery, setMachineQuery] = useState('');
  const [scheduleDateFilter, setScheduleDateFilter] = useState<string>('');
  const [busyScheduleId, setBusyScheduleId] = useState<number | null>(null);

  type CockpitKpiFilter = 'OK' | 'REWORK' | 'SCRAP' | 'SPINDLE';
  const [cockpitKpiFilter, setCockpitKpiFilter] = useState<CockpitKpiFilter>('OK');

  // Trạng thái Thu Lên / Trải Xuống cho cả 4 mục KPI
  const [kpiExpandedByFilter, setKpiExpandedByFilter] = useState<Record<CockpitKpiFilter, boolean>>({
    OK: true,
    REWORK: true,
    SCRAP: true,
    SPINDLE: true,
  });

  const toggleKpiExpanded = (mode: CockpitKpiFilter) => {
    setKpiExpandedByFilter((prev) => ({
      ...prev,
      [mode]: !prev[mode],
    }));
  };

  const toggleAllKpiModes = (expanded: boolean) => {
    setKpiExpandedByFilter({
      OK: expanded,
      REWORK: expanded,
      SCRAP: expanded,
      SPINDLE: expanded,
    });
  };

  const [isGembaAlertsExpanded, setIsGembaAlertsExpanded] = useState(true);
  const [isMachineLoadExpanded, setIsMachineLoadExpanded] = useState(true);

  // Add Schedule Modal State
  const [addSchedOpen, setAddSchedOpen] = useState(false);
  const [schedMachineId, setSchedMachineId] = useState(bootstrap.machines[0]?.id || 'M02');
  const [schedPoId, setSchedPoId] = useState(bootstrap.ordersList[0]?.poId || 'PO-THEO-KH');
  const [schedNcId, setSchedNcId] = useState(bootstrap.operations[0]?.ncId || 'NC001');
  const [schedDate, setSchedDate] = useState(bootstrap.vietnamToday);
  const [schedShift, setSchedShift] = useState(SHIFT_OPTIONS[0]);
  const [schedQty, setSchedQty] = useState(10);
  const [schedHours, setSchedHours] = useState(4);
  const [schedLightsOut, setSchedLightsOut] = useState(false);
  const [schedNote, setSchedNote] = useState('');
  const [submittingSched, setSubmittingSched] = useState(false);

  // Reassign Operation Machine Modal State (San tải máy cổ chai)
  const [reassignModalMachine, setReassignModalMachine] = useState<MachineLoadSummary | null>(null);
  const [selectedReassignNcId, setSelectedReassignNcId] = useState('');
  const [targetMachineName, setTargetMachineName] = useState('');
  const [reassigning, setReassigning] = useState(false);

  // Delete Schedule Confirmation Modal
  const [deleteTargetSched, setDeleteTargetSched] = useState<ScheduleBlock | null>(null);

  // WIP Progress State
  const [wipMode, setWipMode] = useState<WipViewMode>('PO_WEIGHTED');
  const [wipSearch, setWipSearch] = useState('');
  const [wipOnlyActive, setWipOnlyActive] = useState(false);
  const [wipPage, setWipPage] = useState(1);
  const [wipPageSize, setWipPageSize] = useState(25);

  useEffect(() => {
    setLoads(bootstrap.machineLoads || []);
    setSchedules(bootstrap.schedules || []);
  }, [bootstrap.machineLoads, bootstrap.schedules]);

  const reloadSchedulesAndLoads = async () => {
    try {
      const res = await apiClient.get<{ schedules: ScheduleBlock[]; loads: MachineLoadSummary[] }>(
        '/schedules'
      );
      setSchedules(res.schedules || []);
      setLoads(res.loads || []);
    } catch (err: any) {
      toast.error(err?.message || 'Không thể tải dữ liệu cân bằng tải máy.');
    }
  };

  // KPI calculations
  const kpi = bootstrap.kpiSummary;
  const totalMachines = bootstrap.machines.length || 1;
  const runPct = Math.round((kpi.runningMachines / totalMachines) * 100);
  const totalInspected = kpi.totalOk + kpi.totalRework + kpi.totalScrap;
  const reworkRatePct =
    totalInspected > 0 ? ((kpi.totalRework / totalInspected) * 100).toFixed(2) : '0.00';
  const scrapRatePct =
    totalInspected > 0 ? ((kpi.totalScrap / totalInspected) * 100).toFixed(2) : '0.00';

  const loadCounts = useMemo(() => {
    return {
      all: loads.length,
      bottleneck: loads.filter((m) => m.loadLevel === 'BOTTLENECK').length,
      warning: loads.filter((m) => m.loadLevel === 'WARNING').length,
      normal: loads.filter((m) => m.loadLevel === 'NORMAL').length,
      idle: loads.filter((m) => m.loadLevel === 'IDLE').length,
      lightsOut: loads.filter((m) => m.suggestLightsOut).length,
    };
  }, [loads]);

  const filteredLoads = useMemo(() => {
    return loads
      .filter((m) => {
        if (loadFilter === 'BOTTLENECK' && m.loadLevel !== 'BOTTLENECK') return false;
        if (loadFilter === 'WARNING' && m.loadLevel !== 'WARNING') return false;
        if (loadFilter === 'NORMAL' && m.loadLevel !== 'NORMAL') return false;
        if (loadFilter === 'IDLE' && m.loadLevel !== 'IDLE') return false;
        if (loadFilter === 'LIGHTS_OUT' && !m.suggestLightsOut) return false;
        if (!machineQuery.trim()) return true;
        const smedTxt = m.smedClusters.map((c) => c.materialGroup).join(' ');
        return matchesSearch(`${m.machineId} ${m.machineName} ${m.group} ${smedTxt}`, machineQuery);
      })
      .sort((a, b) => b.loadPct - a.loadPct);
  }, [loads, loadFilter, machineQuery]);

  const filteredSchedules = useMemo(() => {
    return schedules.filter((sb) => {
      if (scheduleDateFilter && sb.workDate !== scheduleDateFilter) return false;
      if (machineQuery.trim()) {
        return matchesSearch(
          `${sb.machineName} ${sb.poId} ${sb.ncId} ${sb.productName || ''} ${sb.opName || ''}`,
          machineQuery
        );
      }
      return true;
    });
  }, [schedules, scheduleDateFilter, machineQuery]);

  // Operations matched to selected PO in Add Schedule Modal
  const selectedPoForSched = useMemo(
    () => bootstrap.ordersList.find((p) => p.poId === schedPoId) || null,
    [bootstrap.ordersList, schedPoId]
  );

  const opsForSelectedPo = useMemo(() => {
    if (!selectedPoForSched) return bootstrap.operations;
    const matched = bootstrap.operations.filter((op) => {
      if (selectedPoForSched.spId && op.spId === selectedPoForSched.spId) return true;
      return (
        normalizeVn(op.productName).toLowerCase() ===
        normalizeVn(selectedPoForSched.productName).toLowerCase()
      );
    });
    return matched.length > 0 ? matched : bootstrap.operations;
  }, [bootstrap.operations, selectedPoForSched]);

  // Operations assigned to machine in Reassign Modal
  const opsOnReassignMachine = useMemo(() => {
    if (!reassignModalMachine) return [];
    const target = normalizeVn(reassignModalMachine.machineName).toLowerCase();
    return bootstrap.operations.filter(
      (o) => normalizeVn(o.defaultMachine).toLowerCase() === target
    );
  }, [bootstrap.operations, reassignModalMachine]);

  const openReassignModal = (mach: MachineLoadSummary) => {
    setReassignModalMachine(mach);
    const matchingOps = bootstrap.operations.filter(
      (o) =>
        normalizeVn(o.defaultMachine).toLowerCase() ===
        normalizeVn(mach.machineName).toLowerCase()
    );
    setSelectedReassignNcId(matchingOps[0]?.ncId || bootstrap.operations[0]?.ncId || '');
    const defaultAlt =
      mach.alternativeMachines[0] ||
      bootstrap.machines.find((m) => m.id !== mach.machineId)?.name ||
      '';
    setTargetMachineName(defaultAlt);
  };

  const handleCreateSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingSched(true);
    try {
      const chosenOp = bootstrap.operations.find((o) => o.ncId === schedNcId);
      await apiClient.post('/schedules', {
        machineId: schedMachineId,
        poId: schedPoId,
        ncId: schedNcId,
        productName: chosenOp?.productName || selectedPoForSched?.productName || '',
        opName: chosenOp?.opName || '',
        matName: chosenOp?.matName || '',
        toolCode: chosenOp?.toolCode || '',
        workDate: schedDate,
        shiftType: schedShift,
        plannedQty: schedQty,
        plannedHours: schedHours,
        isLightsOut: schedLightsOut,
        note: schedNote,
      });
      toast.success('Đã thêm lịch điều độ ca máy thành công.');
      setAddSchedOpen(false);
      setSchedNote('');
      await reloadSchedulesAndLoads();
      await onRefreshBootstrap();
    } catch (err: any) {
      toast.error(err?.message || 'Không thể lưu lịch điều độ ca.');
    } finally {
      setSubmittingSched(false);
    }
  };

  const handleToggleLightsOut = async (sb: ScheduleBlock) => {
    setBusyScheduleId(sb.id);
    try {
      const nextVal = Number(sb.isLightsOut) !== 1;
      await apiClient.patch(`/schedules/${sb.id}`, {
        isLightsOut: nextVal,
        shiftType: nextVal ? 'Ca 3 (Đêm 22h-06h)' : sb.shiftType,
      });
      toast.success(
        nextVal
          ? `Đã bật 🌙 Chạy đêm Lights-out cho ${sb.machineName} (${sb.poId})`
          : `Đã tắt chế độ Lights-out cho ${sb.machineName}`
      );
      await reloadSchedulesAndLoads();
      await onRefreshBootstrap();
    } catch (err: any) {
      toast.error(err?.message || 'Lỗi cập nhật chế độ Lights-out.');
    } finally {
      setBusyScheduleId(null);
    }
  };

  const handleChangeScheduleMachine = async (sb: ScheduleBlock, newMachineId: string) => {
    setBusyScheduleId(sb.id);
    try {
      await apiClient.patch(`/schedules/${sb.id}`, { machineId: newMachineId });
      toast.success(`Đã chuyển lịch ${sb.poId} (${sb.ncId}) sang máy ${newMachineId}.`);
      await reloadSchedulesAndLoads();
      await onRefreshBootstrap();
    } catch (err: any) {
      toast.error(err?.message || 'Không thể đổi máy cho lịch ca.');
    } finally {
      setBusyScheduleId(null);
    }
  };

  const handleChangeScheduleStatus = async (sb: ScheduleBlock, newStatus: string) => {
    setBusyScheduleId(sb.id);
    try {
      await apiClient.patch(`/schedules/${sb.id}`, { status: newStatus });
      toast.info(`Đã cập nhật trạng thái lịch #${sb.id} ➔ ${newStatus}.`);
      await reloadSchedulesAndLoads();
    } catch (err: any) {
      toast.error(err?.message || 'Không thể cập nhật trạng thái lịch.');
    } finally {
      setBusyScheduleId(null);
    }
  };

  const handleDeleteSchedule = async () => {
    if (!deleteTargetSched) return;
    setBusyScheduleId(deleteTargetSched.id);
    try {
      await apiClient.delete(`/schedules/${deleteTargetSched.id}`);
      toast.success(`Đã xóa lịch ca #${deleteTargetSched.id}.`);
      setDeleteTargetSched(null);
      await reloadSchedulesAndLoads();
      await onRefreshBootstrap();
    } catch (err: any) {
      toast.error(err?.message || 'Không thể xóa lịch ca.');
    } finally {
      setBusyScheduleId(null);
    }
  };

  const handleReassignOperationMachine = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedReassignNcId || !targetMachineName) return;
    setReassigning(true);
    try {
      const res = await apiClient.post<{ message: string }>(
        `/operations/${encodeURIComponent(selectedReassignNcId)}/assign-machine`,
        { machineName: targetMachineName }
      );
      toast.success(
        res.message || `Đã điều chuyển ${selectedReassignNcId} sang ${targetMachineName}`
      );
      setReassignModalMachine(null);
      await onRefreshBootstrap();
      await reloadSchedulesAndLoads();
    } catch (err: any) {
      toast.error(err?.message || 'Lỗi điều chuyển máy cho nguyên công.');
    } finally {
      setReassigning(false);
    }
  };

  // ==================== WEIGHTED WIP COMPUTATION (FIXED: DIVIDES BY REAL qtyPo!) ====================
  const wipItems = useMemo<WeightedWipItem[]>(() => {
    const opsBySp = new Map<string, OperationMeta[]>();
    const opsByName = new Map<string, OperationMeta[]>();
    for (const op of bootstrap.operations) {
      if (op.spId) {
        const list = opsBySp.get(op.spId) || [];
        list.push(op);
        opsBySp.set(op.spId, list);
      }
      const compact = normalizeVn(op.productName).replace(/\s+/g, '').toUpperCase();
      if (compact) {
        const list = opsByName.get(compact) || [];
        list.push(op);
        opsByName.set(compact, list);
      }
    }

    // Aggregate per-(poId, ncId) okQty from recentLogs when available
    const poNcDoneMap = new Map<string, number>();
    for (const l of bootstrap.recentLogs || []) {
      if (l.isVoided) continue;
      const k = `${l.poId}||${l.ncId}`;
      poNcDoneMap.set(k, (poNcDoneMap.get(k) || 0) + (Number(l.okQty) || 0));
    }

    if (wipMode === 'PO_WEIGHTED') {
      return bootstrap.ordersList.map((po: PurchaseOrderInfo) => {
        const compact = normalizeVn(po.productName).replace(/\s+/g, '').toUpperCase();
        const matchedOps = (
          (po.spId && opsBySp.get(po.spId)) ||
          opsByName.get(compact) ||
          []
        )
          .slice()
          .sort((a, b) => (a.stepOrder || 0) - (b.stepOrder || 0));

        const qtyTarget = Math.max(1, Number(po.qtyPo) || 1);
        const totalStdSec = matchedOps.reduce((s, o) => s + (Number(o.stdSeconds) || 0), 0);

        let weightedSecDone = 0;
        const steps = matchedOps.map((op) => {
          const directPoNc = poNcDoneMap.get(`${po.poId}||${op.ncId}`);
          let doneQty = 0;
          if (directPoNc !== undefined && directPoNc > 0) {
            doneQty = directPoNc;
          } else if (Number(op.isFinalOp) === 1) {
            doneQty = Number(po.finishedQty) || 0;
          } else if ((Number(po.finishedQty) || 0) > 0) {
            // Khi đã có BTP chốt xong ở bước cuối thì các bước trước đó đương nhiên đã qua
            doneQty = Number(po.finishedQty) || 0;
          }

          // Strictly cap ratio by real qtyPo (fixes legacy 100% credit on 1 pc bug!)
          const stepRatio = Math.min(1, Math.max(0, doneQty / qtyTarget));
          weightedSecDone += stepRatio * (Number(op.stdSeconds) || 0);

          return {
            ncId: op.ncId,
            opName: op.opName,
            stepOrder: op.stepOrder,
            isFinalOp: op.isFinalOp,
            stdSeconds: op.stdSeconds,
            doneQty,
            stepPct: Math.round(stepRatio * 100),
          };
        });

        const weightedPct =
          totalStdSec > 0
            ? Math.min(100, Number(((weightedSecDone / totalStdSec) * 100).toFixed(1)))
            : Math.min(
                100,
                Number((((Number(po.finishedQty) || 0) / qtyTarget) * 100).toFixed(1))
              );

        return {
          key: po.poId,
          poId: po.poId,
          customer: po.customer,
          productName: po.productName,
          spId: po.spId,
          qtyTarget,
          dueDate: po.dueDate,
          totalStdSec,
          weightedPct,
          steps,
        };
      });
    }

    // PRODUCT_CATALOG mode (all 334+ products, using linked open PO qty sum or actual batch target)
    const poQtyBySp = new Map<string, number>();
    for (const po of bootstrap.ordersList) {
      if (po.spId) {
        poQtyBySp.set(po.spId, (poQtyBySp.get(po.spId) || 0) + (Number(po.qtyPo) || 0));
      }
    }

    return bootstrap.products.map((prod) => {
      const matchedOps = (opsBySp.get(prod.spId) || [])
        .slice()
        .sort((a, b) => (a.stepOrder || 0) - (b.stepOrder || 0));
      const maxOpDone = matchedOps.reduce(
        (mx, o) => Math.max(mx, bootstrap.opDoneMap[o.ncId] || 0),
        0
      );
      const qtyTarget = Math.max(1, poQtyBySp.get(prod.spId) || maxOpDone || 10);
      const totalStdSec = matchedOps.reduce((s, o) => s + (Number(o.stdSeconds) || 0), 0);

      let weightedSecDone = 0;
      const steps = matchedOps.map((op) => {
        const doneQty = bootstrap.opDoneMap[op.ncId] || 0;
        const stepRatio = Math.min(1, Math.max(0, doneQty / qtyTarget));
        weightedSecDone += stepRatio * (Number(op.stdSeconds) || 0);
        return {
          ncId: op.ncId,
          opName: op.opName,
          stepOrder: op.stepOrder,
          isFinalOp: op.isFinalOp,
          stdSeconds: op.stdSeconds,
          doneQty,
          stepPct: Math.round(stepRatio * 100),
        };
      });

      const weightedPct =
        totalStdSec > 0
          ? Math.min(100, Number(((weightedSecDone / totalStdSec) * 100).toFixed(1)))
          : 0;

      return {
        key: prod.spId,
        poId: null,
        customer: prod.customer,
        productName: prod.productName,
        spId: prod.spId,
        qtyTarget,
        dueDate: null,
        totalStdSec,
        weightedPct,
        steps,
      };
    });
  }, [
    wipMode,
    bootstrap.operations,
    bootstrap.ordersList,
    bootstrap.products,
    bootstrap.opDoneMap,
    bootstrap.recentLogs,
  ]);

  const filteredWip = useMemo(() => {
    return wipItems
      .filter((item) => {
        if (wipOnlyActive && item.weightedPct <= 0) return false;
        if (!wipSearch.trim()) return true;
        return matchesSearch(
          `${item.poId || ''} ${item.spId || ''} ${item.customer} ${item.productName}`,
          wipSearch
        );
      })
      .sort((a, b) => {
        // Prioritize active in-progress (0 < pct < 100) first, then highest progress
        const aInProg = a.weightedPct > 0 && a.weightedPct < 100 ? 1 : 0;
        const bInProg = b.weightedPct > 0 && b.weightedPct < 100 ? 1 : 0;
        if (aInProg !== bInProg) return bInProg - aInProg;
        return b.weightedPct - a.weightedPct;
      });
  }, [wipItems, wipOnlyActive, wipSearch]);

  const pagedWip = useMemo(() => {
    const start = (wipPage - 1) * wipPageSize;
    return filteredWip.slice(start, start + wipPageSize);
  }, [filteredWip, wipPage, wipPageSize]);

  const modalInputCls =
    'h-10 w-full rounded-xl border border-slate-300 bg-white px-3 font-semibold text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/15';

  return (
    <div className="space-y-5">
      {/* ==================== 1. 4 EXECUTIVE KPI CARDS (BẤM ĐỂ LỌC & THU LÊN / TRẢI XUỐNG) ==================== */}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        {/* CARD 1: TỔNG SẢN LƯỢNG ĐẠT */}
        <Card
          role="button"
          tabIndex={0}
          onClick={() => {
            if (cockpitKpiFilter === 'OK') {
              toggleKpiExpanded('OK');
            } else {
              setCockpitKpiFilter('OK');
              setKpiExpandedByFilter((p) => ({ ...p, OK: true }));
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              if (cockpitKpiFilter === 'OK') {
                toggleKpiExpanded('OK');
              } else {
                setCockpitKpiFilter('OK');
                setKpiExpandedByFilter((p) => ({ ...p, OK: true }));
              }
            }
          }}
          title="Bấm để lọc chi tiết sản lượng đạt & thu lên/trải xuống danh sách"
          className={`cursor-pointer border-slate-200 border-l-4 border-l-emerald-500 bg-white shadow-card transition-all hover:scale-[1.01] hover:shadow-md active:scale-[0.99] ${
            cockpitKpiFilter === 'OK'
              ? 'ring-2 ring-emerald-500 ring-offset-2 bg-emerald-50/40'
              : 'hover:border-emerald-300'
          }`}
        >
          <div className="flex items-start justify-between">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                1. Tổng Sản Lượng Đạt (OK)
              </div>
              <div className="font-mono-num mt-1.5 text-3xl font-black text-slate-900">
                {formatNumber(kpi.totalOk)}{' '}
                <span className="text-sm font-semibold text-slate-500">SP</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
                <Badge variant="info">{kpi.openOrders} PO đang mở</Badge>
                {kpi.overdueOrders > 0 && (
                  <Badge variant="danger">🔥 {kpi.overdueOrders} PO trễ hạn</Badge>
                )}
              </div>
              <div className="mt-2 flex items-center gap-1 text-[11px] font-bold">
                {cockpitKpiFilter === 'OK' ? (
                  <span className="inline-flex items-center gap-0.5 rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-900">
                    {kpiExpandedByFilter.OK ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    <span>{kpiExpandedByFilter.OK ? 'Đang mở (Bấm thu)' : 'Thu gọn (Bấm trải)'}</span>
                  </span>
                ) : (
                  <span className="text-emerald-700">🟢 Bấm lọc &amp; mở</span>
                )}
              </div>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-600">
              <CheckCircle2 className="h-6 w-6" />
            </div>
          </div>
        </Card>

        {/* CARD 2: TỔNG HÀNG XỬ LÝ (REWORK) */}
        <Card
          role="button"
          tabIndex={0}
          onClick={() => {
            if (cockpitKpiFilter === 'REWORK') {
              toggleKpiExpanded('REWORK');
            } else {
              setCockpitKpiFilter('REWORK');
              setKpiExpandedByFilter((p) => ({ ...p, REWORK: true }));
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              if (cockpitKpiFilter === 'REWORK') {
                toggleKpiExpanded('REWORK');
              } else {
                setCockpitKpiFilter('REWORK');
                setKpiExpandedByFilter((p) => ({ ...p, REWORK: true }));
              }
            }
          }}
          title="Bấm để lọc chi tiết hàng sửa lại & thu lên/trải xuống danh sách"
          className={`cursor-pointer border-slate-200 border-l-4 border-l-amber-500 bg-white shadow-card transition-all hover:scale-[1.01] hover:shadow-md active:scale-[0.99] ${
            cockpitKpiFilter === 'REWORK'
              ? 'ring-2 ring-amber-500 ring-offset-2 bg-amber-50/50'
              : 'hover:border-amber-300'
          }`}
        >
          <div className="flex items-start justify-between">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                2. Tổng Hàng Xử Lý (Rework)
              </div>
              <div className="font-mono-num mt-1.5 text-3xl font-black text-slate-900">
                {formatNumber(kpi.totalRework)}{' '}
                <span className="text-sm font-semibold text-slate-500">SP</span>
              </div>
              <div className="mt-2 text-xs text-slate-600">
                Tỷ lệ sửa hàng:{' '}
                <strong className="font-mono-num text-amber-700">{reworkRatePct}%</strong> tổng phôi
              </div>
              <div className="mt-2 flex items-center gap-1 text-[11px] font-bold">
                {cockpitKpiFilter === 'REWORK' ? (
                  <span className="inline-flex items-center gap-0.5 rounded bg-amber-100 px-1.5 py-0.5 text-amber-900">
                    {kpiExpandedByFilter.REWORK ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    <span>{kpiExpandedByFilter.REWORK ? 'Đang mở (Bấm thu)' : 'Thu gọn (Bấm trải)'}</span>
                  </span>
                ) : (
                  <span className="text-amber-800">⚡ Bấm lọc &amp; mở</span>
                )}
              </div>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-amber-200 bg-amber-50 text-amber-600">
              <Wrench className="h-6 w-6" />
            </div>
          </div>
        </Card>

        {/* CARD 3: TỔNG PHẾ PHẨM HỦY (SCRAP NG) */}
        <Card
          role="button"
          tabIndex={0}
          onClick={() => {
            if (cockpitKpiFilter === 'SCRAP') {
              toggleKpiExpanded('SCRAP');
            } else {
              setCockpitKpiFilter('SCRAP');
              setKpiExpandedByFilter((p) => ({ ...p, SCRAP: true }));
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              if (cockpitKpiFilter === 'SCRAP') {
                toggleKpiExpanded('SCRAP');
              } else {
                setCockpitKpiFilter('SCRAP');
                setKpiExpandedByFilter((p) => ({ ...p, SCRAP: true }));
              }
            }
          }}
          title="Bấm để lọc chi tiết phế phẩm hủy & thu lên/trải xuống danh sách"
          className={`cursor-pointer border-slate-200 border-l-4 border-l-rose-500 bg-white shadow-card transition-all hover:scale-[1.01] hover:shadow-md active:scale-[0.99] ${
            cockpitKpiFilter === 'SCRAP'
              ? 'ring-2 ring-rose-500 ring-offset-2 bg-rose-50/50'
              : 'hover:border-rose-300'
          }`}
        >
          <div className="flex items-start justify-between">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                3. Tổng Phế Phẩm Hủy (Scrap NG)
              </div>
              <div className="font-mono-num mt-1.5 text-3xl font-black text-slate-900">
                {formatNumber(kpi.totalScrap)}{' '}
                <span className="text-sm font-semibold text-slate-500">SP</span>
              </div>
              <div className="mt-2 flex items-center gap-2 text-xs text-slate-600">
                <span>
                  Tỷ lệ NG: <strong className="font-mono-num text-rose-700">{scrapRatePct}%</strong>
                </span>
              </div>
              <div className="mt-2 flex items-center gap-1 text-[11px] font-bold">
                {cockpitKpiFilter === 'SCRAP' ? (
                  <span className="inline-flex items-center gap-0.5 rounded bg-rose-100 px-1.5 py-0.5 text-rose-900 font-extrabold">
                    {kpiExpandedByFilter.SCRAP ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    <span>{kpiExpandedByFilter.SCRAP ? 'Đang mở (Bấm thu)' : 'Thu gọn (Bấm trải)'}</span>
                  </span>
                ) : (
                  <span className="text-rose-700 font-extrabold animate-pulse">🔴 Bấm lọc &amp; mở</span>
                )}
              </div>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-rose-200 bg-rose-50 text-rose-600">
              <AlertOctagon className="h-6 w-6" />
            </div>
          </div>
        </Card>

        {/* CARD 4: DỪNG MÁY & TỶ LỆ CHẠY SPINDLE */}
        <Card
          role="button"
          tabIndex={0}
          onClick={() => {
            if (cockpitKpiFilter === 'SPINDLE') {
              toggleKpiExpanded('SPINDLE');
            } else {
              setCockpitKpiFilter('SPINDLE');
              setKpiExpandedByFilter((p) => ({ ...p, SPINDLE: true }));
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              if (cockpitKpiFilter === 'SPINDLE') {
                toggleKpiExpanded('SPINDLE');
              } else {
                setCockpitKpiFilter('SPINDLE');
                setKpiExpandedByFilter((p) => ({ ...p, SPINDLE: true }));
              }
            }
          }}
          title="Bấm để lọc trạng thái dừng máy & tỷ lệ spindle và thu lên/trải xuống danh sách"
          className={`cursor-pointer border-slate-200 border-l-4 border-l-blue-600 bg-white shadow-card transition-all hover:scale-[1.01] hover:shadow-md active:scale-[0.99] ${
            cockpitKpiFilter === 'SPINDLE'
              ? 'ring-2 ring-blue-500 ring-offset-2 bg-blue-50/40'
              : 'hover:border-blue-300'
          }`}
        >
          <div className="flex items-start justify-between">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                4. Dừng Máy &amp; Tỷ Lệ Chạy Spindle
              </div>
              <div className="font-mono-num mt-1.5 text-3xl font-black text-slate-900">
                {formatNumber(kpi.totalStopMinutes)}{' '}
                <span className="text-sm font-semibold text-slate-500">phút</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                <Badge variant="success">
                  🟢 {kpi.runningMachines}/{bootstrap.machines.length} máy chạy ({runPct}%)
                </Badge>
                {kpi.bottleneckMachines > 0 && (
                  <Badge variant="danger">🔴 {kpi.bottleneckMachines} máy cổ chai</Badge>
                )}
              </div>
              <div className="mt-2 flex items-center gap-1 text-[11px] font-bold">
                {cockpitKpiFilter === 'SPINDLE' ? (
                  <span className="inline-flex items-center gap-0.5 rounded bg-blue-100 px-1.5 py-0.5 text-blue-900">
                    {kpiExpandedByFilter.SPINDLE ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    <span>{kpiExpandedByFilter.SPINDLE ? 'Đang mở (Bấm thu)' : 'Thu gọn (Bấm trải)'}</span>
                  </span>
                ) : (
                  <span className="text-blue-700">⚡ Bấm lọc &amp; mở</span>
                )}
              </div>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-blue-200 bg-blue-50 text-blue-600">
              <Activity className="h-6 w-6" />
            </div>
          </div>
        </Card>
      </div>

      {/* ==================== COLLAPSIBLE KPI DRILLDOWN & ACTION CARD (CẢ 4 MỤC) ==================== */}
      <Card noPadding className="overflow-hidden border-slate-200 bg-white">
        {/* Switcher & Header Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-100/70 px-4 py-2 text-xs">
          <div className="flex flex-wrap items-center gap-1.5 font-bold">
            <span className="text-slate-600">Xem mục:</span>
            <button
              type="button"
              onClick={() => setCockpitKpiFilter('OK')}
              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-bold transition-all ${
                cockpitKpiFilter === 'OK'
                  ? 'bg-emerald-600 text-white shadow-xs font-black'
                  : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              <span>1. Sản Lượng Đạt (OK)</span>
              <span className={`rounded-sm px-1 py-0.2 text-[10px] ${
                cockpitKpiFilter === 'OK' ? 'bg-emerald-800 text-white' : 'bg-slate-100 text-slate-600'
              }`}>
                {kpiExpandedByFilter.OK ? '▲ Mở' : '▼ Thu'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setCockpitKpiFilter('REWORK')}
              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-bold transition-all ${
                cockpitKpiFilter === 'REWORK'
                  ? 'bg-amber-600 text-white shadow-xs font-black'
                  : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              <span>2. Hàng Sửa Lại</span>
              <span className={`rounded-sm px-1 py-0.2 text-[10px] ${
                cockpitKpiFilter === 'REWORK' ? 'bg-amber-800 text-white' : 'bg-slate-100 text-slate-600'
              }`}>
                {kpiExpandedByFilter.REWORK ? '▲ Mở' : '▼ Thu'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setCockpitKpiFilter('SCRAP')}
              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-bold transition-all ${
                cockpitKpiFilter === 'SCRAP'
                  ? 'bg-rose-600 text-white shadow-xs font-black'
                  : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              <span>3. Phế Phẩm Hủy</span>
              <span className={`rounded-sm px-1 py-0.2 text-[10px] ${
                cockpitKpiFilter === 'SCRAP' ? 'bg-rose-800 text-white' : 'bg-slate-100 text-slate-600'
              }`}>
                {kpiExpandedByFilter.SCRAP ? '▲ Mở' : '▼ Thu'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setCockpitKpiFilter('SPINDLE')}
              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-bold transition-all ${
                cockpitKpiFilter === 'SPINDLE'
                  ? 'bg-blue-600 text-white shadow-xs font-black'
                  : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              <span>4. Dừng Máy & Spindle</span>
              <span className={`rounded-sm px-1 py-0.2 text-[10px] ${
                cockpitKpiFilter === 'SPINDLE' ? 'bg-blue-800 text-white' : 'bg-slate-100 text-slate-600'
              }`}>
                {kpiExpandedByFilter.SPINDLE ? '▲ Mở' : '▼ Thu'}
              </span>
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Nút Thu Lên / Trải Xuống mục đang chọn */}
            <button
              type="button"
              onClick={() => toggleKpiExpanded(cockpitKpiFilter)}
              title={
                kpiExpandedByFilter[cockpitKpiFilter]
                  ? "Bấm để thu gọn chi tiết mục này"
                  : "Bấm để trải xuống xem chi tiết mục này"
              }
              className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-black shadow-2xs transition-all active:scale-[0.98] ${
                kpiExpandedByFilter[cockpitKpiFilter]
                  ? 'border-blue-400 bg-blue-50 text-blue-900 hover:bg-blue-100'
                  : 'border-emerald-400 bg-emerald-50 text-emerald-900 ring-2 ring-emerald-200 hover:bg-emerald-100'
              }`}
            >
              {kpiExpandedByFilter[cockpitKpiFilter] ? (
                <>
                  <ChevronUp className="h-4 w-4 text-blue-700" />
                  <span>▲ Thu Lên</span>
                </>
              ) : (
                <>
                  <ChevronDown className="h-4 w-4 text-emerald-700" />
                  <span>▼ Trải Xuống</span>
                </>
              )}
            </button>

            {/* Master buttons for all 4 categories */}
            <div className="flex items-center gap-1 border-l border-slate-300 pl-2">
              <button
                type="button"
                onClick={() => toggleAllKpiModes(false)}
                title="Thu lên toàn bộ cả 4 mục"
                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-bold text-slate-700 shadow-2xs hover:bg-slate-50 hover:text-slate-900"
              >
                <ChevronUp className="h-3 w-3 text-slate-600" />
                <span>Thu cả 4 mục</span>
              </button>
              <button
                type="button"
                onClick={() => toggleAllKpiModes(true)}
                title="Trải xuống toàn bộ cả 4 mục"
                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-bold text-slate-700 shadow-2xs hover:bg-slate-50 hover:text-slate-900"
              >
                <ChevronDown className="h-3 w-3 text-slate-600" />
                <span>Trải cả 4 mục</span>
              </button>
            </div>
          </div>
        </div>

        {/* Body: Collapsed Banner OR Detailed Content */}
        {!kpiExpandedByFilter[cockpitKpiFilter] ? (
          <div
            role="button"
            tabIndex={0}
            onClick={() => toggleKpiExpanded(cockpitKpiFilter)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') toggleKpiExpanded(cockpitKpiFilter);
            }}
            className="flex cursor-pointer items-center justify-between bg-slate-50/90 px-4 py-3 text-xs font-bold text-slate-700 hover:bg-blue-50/70 hover:text-blue-900 transition-colors"
          >
            <div className="flex items-center gap-2">
              <ChevronDown className="h-4 w-4 text-blue-600" />
              <span>
                Chi tiết dữ liệu của mục <strong>{cockpitKpiFilter === 'OK' ? '1. Sản Lượng Đạt (OK)' : cockpitKpiFilter === 'REWORK' ? '2. Hàng Sửa Lại (Rework)' : cockpitKpiFilter === 'SCRAP' ? '3. Phế Phẩm Hủy (Scrap NG)' : '4. Dừng Máy & Tỷ Lệ Spindle'}</strong> đang được <strong>thu gọn</strong>.
              </span>
            </div>
            <span className="inline-flex items-center gap-1 rounded-lg border border-blue-300 bg-white px-2.5 py-1 text-xs font-black text-blue-800 shadow-2xs hover:bg-blue-50">
              <span>Bấm để trải xuống xem chi tiết</span>
              <ChevronDown className="h-3.5 w-3.5" />
            </span>
          </div>
        ) : (
          <div className="p-4">
            {cockpitKpiFilter === 'OK' && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    <span className="text-xs font-black uppercase text-slate-900">
                      Danh Sách Các Đơn Hàng PO Đang Mở &amp; Sản Lượng Đạt ({bootstrap.ordersList.filter(o => o.status !== 'COMPLETED').length} PO)
                    </span>
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => onNavigateTab('orders')}
                    title="Vào phân hệ Quản lý Đơn hàng PO"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    <span>Xem Phân Hệ Đơn Hàng PO</span>
                  </Button>
                </div>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                  {bootstrap.ordersList.filter(o => o.status !== 'COMPLETED').slice(0, 6).map((po) => {
                    const pct = po.qtyPo > 0 ? Math.min(100, Math.round(((po.finishedQty || 0) / po.qtyPo) * 100)) : 0;
                    return (
                      <div key={po.poId} className="rounded-xl border border-slate-200 bg-slate-50/50 p-2.5 text-xs hover:bg-slate-50 transition-colors">
                        <div className="flex items-center justify-between font-bold">
                          <span className="text-blue-700">{po.poId}</span>
                          <span className="text-slate-500 font-mono-num text-[11px]">{formatDateVn(po.dueDate)}</span>
                        </div>
                        <div className="font-extrabold text-slate-900 truncate mt-0.5">{po.productName}</div>
                        <div className="mt-1 flex items-center justify-between text-[11px] text-slate-600">
                          <span>{po.customer}</span>
                          <span className="font-mono-num font-bold text-emerald-700">{po.finishedQty || 0}/{po.qtyPo} SP ({pct}%)</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {cockpitKpiFilter === 'REWORK' && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                  <div className="flex items-center gap-2">
                    <Wrench className="h-4 w-4 text-amber-600" />
                    <span className="text-xs font-black uppercase text-slate-900">
                      Tình Trạng Hàng Sửa Lại (Rework: {kpi.totalRework} SP - Tỷ Lệ: {reworkRatePct}%)
                    </span>
                  </div>
                  <Button
                    variant="warning"
                    size="sm"
                    onClick={() => setAddSchedOpen(true)}
                    title="Xếp lịch sửa hàng vào ca máy rảnh"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Xếp Lịch Sửa Hàng Lại</span>
                  </Button>
                </div>
                <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3 text-xs text-amber-900">
                  <div className="font-bold">Quy trình xử lý Rework:</div>
                  <ul className="mt-1 list-disc pl-4 space-y-0.5 text-slate-700">
                    <li>Hàng sửa lại cần được lập tức kiểm tra sai số kích thước FAI.</li>
                    <li>Sắp xếp nguyên công sửa vào ca 2 hoặc máy rảnh để không ảnh hưởng tiến độ máy chính.</li>
                  </ul>
                </div>
              </div>
            )}

            {cockpitKpiFilter === 'SCRAP' && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                  <div className="flex items-center gap-2">
                    <AlertOctagon className="h-4 w-4 text-rose-600" />
                    <span className="text-xs font-black uppercase text-slate-900">
                      Tình Trạng Phế Phẩm Hủy (Scrap NG: {kpi.totalScrap} SP - Tỷ Lệ: {scrapRatePct}%)
                    </span>
                  </div>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => onNavigateTab('logs_qc', { logsSubView: 'QC' })}
                    title="Mở phân hệ Nhật ký & Biên bản QC"
                  >
                    <FileText className="h-3.5 w-3.5" />
                    <span>Xem Biên Bản QC &amp; Hàng Hủy</span>
                  </Button>
                </div>
                <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-3 text-xs text-rose-950">
                  <div className="font-bold">Cảnh báo phế phẩm:</div>
                  <p className="mt-1 text-slate-700">
                    Hàng hủy NG sẽ được tự động phân loại theo nguyên nhân khách quan (phôi rỗ nứt) hoặc chủ quan (cháy dao, sai code) để tính thưởng/phạt chính xác trong phân hệ Chấm công &amp; 3P.
                  </p>
                </div>
              </div>
            )}

            {cockpitKpiFilter === 'SPINDLE' && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                  <div className="flex items-center gap-2">
                    <Activity className="h-4 w-4 text-blue-600" />
                    <span className="text-xs font-black uppercase text-slate-900">
                      Dừng Máy ({kpi.totalStopMinutes} phút) &amp; Tỷ Lệ Chạy ({kpi.runningMachines}/{bootstrap.machines.length} máy - {runPct}%)
                    </span>
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => setAddSchedOpen(true)}
                    title="Bố trí thêm lịch điều độ ca để lấp đầy máy rảnh"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Thêm Lịch Điều Độ Ca</span>
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 text-center text-xs">
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-2.5">
                    <div className="text-[11px] font-bold text-emerald-800 uppercase">Đang Chạy Live</div>
                    <div className="font-mono-num text-xl font-black text-emerald-700">{kpi.runningMachines} Máy</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-2.5">
                    <div className="text-[11px] font-bold text-slate-600 uppercase">Máy Nghỉ / Rảnh</div>
                    <div className="font-mono-num text-xl font-black text-slate-800">{bootstrap.machines.length - kpi.runningMachines} Máy</div>
                  </div>
                  <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-2.5">
                    <div className="text-[11px] font-bold text-rose-800 uppercase">Máy Cổ Chai</div>
                    <div className="font-mono-num text-xl font-black text-rose-700">{kpi.bottleneckMachines} Máy</div>
                  </div>
                  <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-2.5">
                    <div className="text-[11px] font-bold text-amber-800 uppercase">Thời Gian Dừng</div>
                    <div className="font-mono-num text-xl font-black text-amber-700">{kpi.totalStopMinutes} Phút</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* ==================== GEMBA SHIFT HANDOVER ALERTS ==================== */}
      {bootstrap.shiftHandoverAlerts.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/50 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-800">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
              <span>
                Bàn Giao Ca Gemba Mới Nhất Từ Xưởng ({bootstrap.shiftHandoverAlerts.length})
              </span>
            </div>
            <span className="text-xs text-slate-600">
              Nhắc nhở gá đặt G54, dao mòn &amp; bán thành phẩm dở dang giữa các ca
            </span>
          </div>
          <div className="mt-2.5 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
            {bootstrap.shiftHandoverAlerts.slice(0, 3).map((alert) => (
              <div
                key={alert.id}
                className="rounded-xl border border-amber-200 bg-white px-3 py-2.5 text-xs shadow-sm"
              >
                <div className="flex items-center justify-between gap-2 font-bold text-amber-900">
                  <span>
                    {alert.machineName} • {alert.workerName}
                  </span>
                  <span className="font-mono-num text-[11px] font-medium text-slate-500">
                    {formatDateVn(alert.workDate)}
                  </span>
                </div>
                <div className="mt-0.5 truncate text-[11px] font-semibold text-blue-700">
                  [{alert.poId}] {alert.productName} — {alert.opName}
                </div>
                <div className="mt-1 font-medium text-slate-800">“{alert.handoverNote}”</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ==================== 2. LEAN MACHINE LOADING & BOTTLENECK BOARD ==================== */}
      <Card noPadding>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
          <div>
            <div className="flex items-center gap-2">
              <Cpu className="h-5 w-5 text-blue-600" />
              <h2 className="text-base font-extrabold uppercase tracking-wide text-slate-900">
                Bảng Cân Bằng Tải Máy, Gom Nhóm SMED &amp; Phát Hiện Cổ Chai ({loads.length} máy)
              </h2>
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              Quỹ năng lực chuẩn 2 ca/tuần (96h/máy). Tự động phát hiện máy quá tải &gt;100%, gợi ý
              gom phôi cùng mác vật liệu SMED và chạy đêm Lights-out.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" size="sm" onClick={() => setAddSchedOpen(true)}>
              <Plus className="h-4 w-4" />
              Thêm Lịch Điều Độ Ca
            </Button>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/80 px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                ['ALL', `Tất cả (${loadCounts.all})`],
                ['BOTTLENECK', `🔴 Cổ chai >100% (${loadCounts.bottleneck})`],
                ['WARNING', `🟡 Sắp đầy >80% (${loadCounts.warning})`],
                ['NORMAL', `🟢 Bình thường (${loadCounts.normal})`],
                ['IDLE', `⚪ Máy rảnh (${loadCounts.idle})`],
                ['LIGHTS_OUT', `🌙 Gợi ý Chạy đêm (${loadCounts.lightsOut})`],
              ] as Array<[LoadFilterMode, string]>
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => setLoadFilter(mode)}
                className={`rounded-lg border px-2.5 py-1.5 text-xs font-bold transition-colors ${
                  loadFilter === mode
                    ? 'border-blue-600 bg-blue-600 text-white shadow-sm'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="relative min-w-[250px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={machineQuery}
              onChange={(e) => setMachineQuery(e.target.value)}
              placeholder="Tìm máy, nhóm CNC, mác vật liệu SKD11..."
              className="h-9 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/15"
            />
          </div>
        </div>

        {/* 23+ Machine Capacity Table */}
        <div className="max-h-[480px] overflow-auto">
          <table className="w-full min-w-[1040px] border-collapse text-left text-xs">
            <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-600">
              <tr>
                <th className="px-3.5 py-2.5">Máy Gia Công &amp; Nhóm</th>
                <th className="px-3 py-2.5 text-center">Trạng Thái Live</th>
                <th className="w-[300px] px-3 py-2.5">Thanh Tải Năng Lực (Capacity %)</th>
                <th className="px-3 py-2.5 text-right">Giờ Đơn Mở / Lịch Ca</th>
                <th className="px-3 py-2.5">Gom Nhóm Vật Liệu SMED &amp; Lights-Out</th>
                <th className="px-3.5 py-2.5 text-right">Điều Chuyển San Tải</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {filteredLoads.map((m) => {
                const barWidth = Math.min(100, Math.max(0, m.loadPct));
                const isOverloaded = m.isBottleneck || m.loadPct > 85;
                const isElevatedLoad = !isOverloaded && (m.isWarning || m.loadPct >= 70);

                const barColor = isOverloaded
                  ? 'bg-rose-500'
                  : isElevatedLoad
                    ? 'bg-amber-500'
                    : m.loadLevel === 'IDLE'
                      ? 'bg-slate-400'
                      : 'bg-emerald-500';

                const pctColor = isOverloaded
                  ? 'text-rose-700'
                  : isElevatedLoad
                    ? 'text-amber-700'
                    : m.loadLevel === 'IDLE'
                      ? 'text-slate-600'
                      : 'text-emerald-700';

                const levelBadge = m.isBottleneck ? (
                  <Badge variant="danger">🔴 &gt;100% CỔ CHAI QUÁ TẢI</Badge>
                ) : m.isWarning ? (
                  <Badge variant="warning">🟡 &gt;80% Sắp đầy</Badge>
                ) : m.loadLevel === 'IDLE' ? (
                  <Badge variant="neutral">⚪ Đang rảnh</Badge>
                ) : (
                  <Badge variant="success">🟢 Bình thường</Badge>
                );

                const statusVariant =
                  m.status === 'RUNNING'
                    ? 'success'
                    : m.status === 'STOPPED'
                      ? 'danger'
                      : m.status === 'SETUP'
                        ? 'warning'
                        : 'neutral';

                return (
                  <tr
                    key={m.machineId}
                    className={`border-b transition-colors ${
                      isOverloaded
                        ? 'border-rose-300 bg-rose-50/50 hover:bg-rose-50/80'
                        : 'border-slate-200 bg-white hover:border-blue-300 hover:bg-blue-50/40'
                    }`}
                  >
                    <td className="px-3.5 py-2.5">
                      <div className="font-bold text-slate-900">
                        <span className="font-mono-num mr-1.5 text-blue-700">{m.machineId}</span>
                        {m.machineName}
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-500">
                        {m.group} • {m.jobCount} PO chờ gia công
                      </div>
                    </td>

                    <td className="px-3 py-2.5 text-center">
                      <Badge variant={statusVariant}>{m.status}</Badge>
                    </td>

                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        {levelBadge}
                        <span className={`font-mono-num text-sm font-extrabold ${pctColor}`}>
                          {m.loadPct.toFixed(1)}%
                        </span>
                      </div>
                      <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full border border-slate-200/80 bg-slate-100">
                        <div
                          className={`h-full rounded-full transition-all ${barColor}`}
                          style={{ width: `${barWidth}%` }}
                        />
                      </div>
                    </td>

                    <td className="font-mono-num px-3 py-2.5 text-right">
                      <div className="font-bold text-slate-900">
                        {m.totalDemandHours.toFixed(1)}h / {m.capacityHours}h
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-500">
                        PO: {m.openPoHours.toFixed(1)}h | Ca: {m.scheduledHours.toFixed(1)}h
                        {m.lightsOutHours > 0 && (
                          <span className="ml-1 font-semibold text-violet-700">
                            (🌙 {m.lightsOutHours.toFixed(1)}h)
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {m.smedClusters.length > 0 ? (
                          m.smedClusters.slice(0, 3).map((c) => (
                            <Badge key={c.materialGroup} variant="info">
                              <Layers className="h-3 w-3" />
                              {c.materialGroup}: {c.jobCount} lệnh ({c.totalHours}h)
                            </Badge>
                          ))
                        ) : (
                          <span className="text-slate-500">Chưa có cụm phôi chờ</span>
                        )}
                        {m.suggestLightsOut && (
                          <Badge variant="purple">
                            <Moon className="h-3 w-3" /> Đề xuất Ca 3 Lights-out
                          </Badge>
                        )}
                      </div>
                      {m.smedSuggestion && (
                        <div className="mt-1 flex items-center gap-1 text-[11px] font-medium text-emerald-700">
                          <Sparkles className="h-3 w-3 shrink-0" />
                          <span>{m.smedSuggestion}</span>
                        </div>
                      )}
                    </td>

                    <td className="px-3.5 py-2.5 text-right">
                      <Button
                        variant={m.isBottleneck ? 'danger' : 'secondary'}
                        size="sm"
                        onClick={() => openReassignModal(m)}
                      >
                        <ArrowRightLeft className="h-3.5 w-3.5" />
                        San tải NC
                      </Button>
                      {m.alternativeMachines.length > 0 && (m.isBottleneck || m.isWarning) && (
                        <div className="mt-1 text-[11px] text-slate-500">
                          Gợi ý: {m.alternativeMachines.slice(0, 2).join(', ')}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ==================== SCHEDULE GANTT BLOCKS BOARD ==================== */}
        <div className="border-t border-slate-200 bg-slate-50/60 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-violet-600" />
              <h3 className="text-sm font-bold text-slate-900">
                Kế Hoạch Điều Độ Ca &amp; Chế Độ Chạy Đêm Tự Động (🌙 Lights-out)
              </h3>
              <Badge variant="purple">{filteredSchedules.length} block lịch</Badge>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <label className="font-semibold text-slate-600">Lọc ngày:</label>
              <input
                type="date"
                value={scheduleDateFilter}
                onChange={(e) => setScheduleDateFilter(e.target.value)}
                className="h-8 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-900 focus:border-blue-500 focus:outline-none"
              />
              {scheduleDateFilter && (
                <Button variant="ghost" size="sm" onClick={() => setScheduleDateFilter('')}>
                  Xem tất cả ngày
                </Button>
              )}
            </div>
          </div>

          {filteredSchedules.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-xs text-slate-500">
              Chưa có block điều độ ca nào khớp bộ lọc. Bấm{' '}
              <strong className="text-slate-800">Thêm Lịch Điều Độ Ca</strong> để xếp kế hoạch chạy
              máy hoặc kích hoạt chạy đêm Lights-out.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full min-w-[980px] border-collapse text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase text-slate-600">
                  <tr>
                    <th className="px-3 py-2">Ngày &amp; Ca</th>
                    <th className="px-3 py-2">Máy Phân Công (Đổi Nhanh)</th>
                    <th className="px-3 py-2">Lệnh PO / Sản Phẩm / Nguyên Công</th>
                    <th className="px-3 py-2 text-center">SL &amp; Giờ KH</th>
                    <th className="px-3 py-2 text-center">🌙 Chạy Đêm Lights-Out</th>
                    <th className="px-3 py-2 text-center">Trạng Thái</th>
                    <th className="px-3 py-2 text-right">Xóa</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {filteredSchedules.map((sb) => {
                    const isLo = Number(sb.isLightsOut) === 1;
                    return (
                      <tr key={sb.id} className="transition-colors hover:bg-blue-50/40">
                        <td className="px-3 py-2">
                          <div className="font-mono-num font-bold text-slate-900">
                            {formatDateVn(sb.workDate)}
                          </div>
                          <div className="text-[11px] text-slate-500">{sb.shiftType}</div>
                        </td>
                        <td className="px-3 py-2">
                          <select
                            disabled={busyScheduleId === sb.id}
                            value={sb.machineId}
                            onChange={(e) => void handleChangeScheduleMachine(sb, e.target.value)}
                            className="h-8 rounded-lg border border-slate-300 bg-white px-2 text-xs font-semibold text-blue-700 focus:border-blue-500 focus:outline-none"
                          >
                            {bootstrap.machines.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.id} — {m.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge variant="warning">{sb.poId}</Badge>
                            <Badge variant="info">{sb.ncId}</Badge>
                            {sb.matName && <Badge variant="neutral">{sb.matName}</Badge>}
                          </div>
                          <div className="mt-1 font-semibold text-slate-900">
                            {sb.productName || 'Sản phẩm theo PO'}{' '}
                            {sb.opName ? `— ${sb.opName}` : ''}
                          </div>
                        </td>
                        <td className="font-mono-num px-3 py-2 text-center">
                          <div className="font-bold text-emerald-700">{sb.plannedQty} SP</div>
                          <div className="text-[11px] text-slate-500">{sb.plannedHours} giờ</div>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <button
                            type="button"
                            disabled={busyScheduleId === sb.id}
                            onClick={() => void handleToggleLightsOut(sb)}
                            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-bold transition-all ${
                              isLo
                                ? 'border-violet-300 bg-violet-50 text-violet-700 shadow-sm'
                                : 'border-slate-300 bg-white text-slate-600 hover:border-violet-300 hover:bg-violet-50/50 hover:text-violet-700'
                            }`}
                          >
                            <Moon className="h-3.5 w-3.5" />
                            {isLo ? '🌙 Đang bật Lights-out' : 'Bật chạy đêm'}
                          </button>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <select
                            disabled={busyScheduleId === sb.id}
                            value={sb.status}
                            onChange={(e) => void handleChangeScheduleStatus(sb, e.target.value)}
                            className="h-8 rounded-lg border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-800 focus:border-blue-500 focus:outline-none"
                          >
                            <option value="PLANNED">PLANNED</option>
                            <option value="RUNNING">RUNNING</option>
                            <option value="DONE">DONE</option>
                          </select>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => setDeleteTargetSched(sb)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700"
                            title="Xóa lịch ca"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>

      {/* ==================== 3. WEIGHTED WIP PROGRESS TABLE (ACCURATE BY qtyPo) ==================== */}
      <Card noPadding>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
          <div>
            <div className="flex items-center gap-2">
              <Flame className="h-5 w-5 text-emerald-600" />
              <h2 className="text-base font-extrabold uppercase tracking-wide text-slate-900">
                Bảng Tiến Độ WIP Trọng Số Chuẩn Xác Theo Từng Bước Nguyên Công
              </h2>
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              Tính % hoàn thành thực tế từng công đoạn chia chuẩn theo{' '}
              <strong className="text-slate-700">SL Đặt PO (qtyPo)</strong> nhân trọng số giây định
              mức (đã khử triệt để lỗi báo 100% ảo khi mới chạy 1 chi tiết).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setWipMode('PO_WEIGHTED');
                setWipPage(1);
              }}
              className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors ${
                wipMode === 'PO_WEIGHTED'
                  ? 'border-blue-600 bg-blue-600 text-white shadow-sm'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              Theo Đơn Hàng PO ({bootstrap.ordersList.length})
            </button>
            <button
              type="button"
              onClick={() => {
                setWipMode('PRODUCT_CATALOG');
                setWipPage(1);
              }}
              className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors ${
                wipMode === 'PRODUCT_CATALOG'
                  ? 'border-blue-600 bg-blue-600 text-white shadow-sm'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              Theo Danh Mục SP ({bootstrap.products.length})
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/80 px-4 py-2.5">
          <div className="relative min-w-[260px] flex-1 sm:max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={wipSearch}
              onChange={(e) => {
                setWipSearch(e.target.value);
                setWipPage(1);
              }}
              placeholder="Tìm PO, Mã SP, Khách hàng, Tên bản vẽ không dấu..."
              className="h-9 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/15"
            />
          </div>
          <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-700">
            <input
              type="checkbox"
              checked={wipOnlyActive}
              onChange={(e) => {
                setWipOnlyActive(e.target.checked);
                setWipPage(1);
              }}
              className="h-4 w-4 rounded border-slate-300 bg-white text-blue-600 focus:ring-blue-500"
            />
            Chỉ hiện mã đã phát sinh sản lượng (&gt;0%)
          </label>
        </div>

        <div className="max-h-[500px] overflow-auto">
          <table className="w-full min-w-[980px] border-collapse text-left text-xs">
            <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-600">
              <tr>
                <th className="px-3.5 py-2.5">PO / Mã SP &amp; Khách Hàng</th>
                <th className="px-3 py-2.5">Sản Phẩm</th>
                <th className="px-3 py-2.5 text-center">SL Đích (qtyPo)</th>
                <th className="px-3 py-2.5 text-center">Tổng ĐM</th>
                <th className="px-3 py-2.5">Tiến Độ Từng Bước Nguyên Công</th>
                <th className="w-[210px] px-3.5 py-2.5">% Hoàn Thành Trọng Số</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {pagedWip.map((w) => (
                <tr key={w.key} className="transition-colors hover:bg-blue-50/40">
                  <td className="px-3.5 py-2.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {w.poId && <Badge variant="warning">{w.poId}</Badge>}
                      {w.spId && <Badge variant="neutral">{w.spId}</Badge>}
                    </div>
                    <div className="mt-1 text-[11px] font-medium text-slate-600">{w.customer}</div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="font-bold text-blue-700">{w.productName}</div>
                    {w.dueDate && (
                      <div className="mt-0.5 text-[11px] text-slate-500">
                        Hạn giao:{' '}
                        <span className="font-mono-num font-medium text-slate-700">
                          {formatDateVn(w.dueDate)}
                        </span>
                      </div>
                    )}
                  </td>
                  <td className="font-mono-num px-3 py-2.5 text-center font-bold text-slate-900">
                    {formatNumber(w.qtyTarget)} SP
                  </td>
                  <td className="font-mono-num px-3 py-2.5 text-center text-slate-700">
                    {w.totalStdSec > 0 ? formatDurationSec(w.totalStdSec) : '—'}
                  </td>
                  <td className="px-3 py-2.5">
                    {w.steps.length === 0 ? (
                      <Badge variant="warning">⚠️ Chưa khai báo quy trình NC</Badge>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {w.steps.map((s) => (
                          <Badge
                            key={s.ncId}
                            variant={
                              s.doneQty >= w.qtyTarget
                                ? 'success'
                                : s.doneQty > 0
                                  ? 'info'
                                  : 'neutral'
                            }
                          >
                            {s.isFinalOp === 1 ? '🏁 ' : `B${s.stepOrder}: `}
                            {s.opName}: {s.doneQty}/{w.qtyTarget} ({s.stepPct}%)
                          </Badge>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-3.5 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="h-2.5 flex-1 overflow-hidden rounded-full border border-slate-200/80 bg-slate-100">
                        <div
                          className={`h-full rounded-full ${
                            w.weightedPct >= 100
                              ? 'bg-emerald-500'
                              : w.weightedPct > 0
                                ? 'bg-blue-600'
                                : 'bg-slate-300'
                          }`}
                          style={{ width: `${Math.min(100, w.weightedPct)}%` }}
                        />
                      </div>
                      <span
                        className={`font-mono-num w-12 text-right font-bold ${
                          w.weightedPct >= 100
                            ? 'text-emerald-700'
                            : w.weightedPct > 0
                              ? 'text-blue-700'
                              : 'text-slate-500'
                        }`}
                      >
                        {w.weightedPct}%
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <PaginationBar
          totalItems={filteredWip.length}
          page={wipPage}
          pageSize={wipPageSize}
          onPageChange={setWipPage}
          onPageSizeChange={(sz) => {
            setWipPageSize(sz);
            setWipPage(1);
          }}
        />
      </Card>

      {/* ==================== MODAL: ADD SCHEDULE BLOCK ==================== */}
      <Modal
        open={addSchedOpen}
        onClose={() => setAddSchedOpen(false)}
        title="➕ Thêm Lịch Điều Độ Ca & Kế Hoạch Chạy Máy"
        subtitle="Phân bổ PO & Nguyên công vào ca máy cụ thể hoặc bật chế độ chạy đêm tự động Lights-out"
        maxWidthClass="max-w-xl"
      >
        <form noValidate onSubmit={handleCreateSchedule} className="space-y-3.5 text-xs">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block font-bold uppercase text-slate-700">
                Máy gia công (*)
              </label>
              <select
                value={schedMachineId}
                onChange={(e) => setSchedMachineId(e.target.value)}
                className={modalInputCls}
              >
                {bootstrap.machines.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id} — {m.name} ({m.group})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block font-bold uppercase text-slate-700">
                Ngày chạy kế hoạch (*)
              </label>
              <input
                type="date"
                value={schedDate}
                onChange={(e) => setSchedDate(e.target.value)}
                className={modalInputCls}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block font-bold uppercase text-slate-700">
                Đơn hàng PO (*)
              </label>
              <select
                value={schedPoId}
                onChange={(e) => {
                  const nextPo = e.target.value;
                  setSchedPoId(nextPo);
                  const poObj = bootstrap.ordersList.find((p) => p.poId === nextPo);
                  if (poObj) {
                    const firstOp = bootstrap.operations.find(
                      (o) =>
                        (poObj.spId && o.spId === poObj.spId) ||
                        normalizeVn(o.productName).toLowerCase() ===
                          normalizeVn(poObj.productName).toLowerCase()
                    );
                    if (firstOp) setSchedNcId(firstOp.ncId);
                  }
                }}
                className={modalInputCls}
              >
                {bootstrap.ordersList.map((po) => (
                  <option key={po.poId} value={po.poId}>
                    {po.poId} — {po.productName} (Còn: {po.remainQty})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block font-bold uppercase text-slate-700">
                Nguyên công thực hiện (*)
              </label>
              <select
                value={schedNcId}
                onChange={(e) => setSchedNcId(e.target.value)}
                className={modalInputCls}
              >
                {opsForSelectedPo.map((op) => (
                  <option key={op.ncId} value={op.ncId}>
                    {op.ncId} — {op.opName} ({op.stdSeconds}s)
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block font-bold uppercase text-slate-700">Ca làm việc</label>
              <select
                value={schedShift}
                onChange={(e) => setSchedShift(e.target.value)}
                className={modalInputCls}
              >
                {SHIFT_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block font-bold uppercase text-slate-700">SL Kế hoạch</label>
              <input
                type="number"
                min={1}
                step="any"
                value={schedQty}
                onChange={(e) => setSchedQty(Math.max(1, Number(e.target.value) || 1))}
                className={`${modalInputCls} font-mono-num font-bold text-emerald-700`}
              />
            </div>
            <div>
              <label className="mb-1 block font-bold uppercase text-slate-700">
                Số giờ dự kiến (h)
              </label>
              <input
                type="number"
                min={0.1}
                step="any"
                value={schedHours}
                onChange={(e) => setSchedHours(Math.max(0.25, Number(e.target.value) || 1))}
                className={`${modalInputCls} font-mono-num font-bold text-blue-700`}
              />
            </div>
          </div>

          <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-violet-200 bg-violet-50/70 p-3">
            <input
              type="checkbox"
              checked={schedLightsOut}
              onChange={(e) => {
                setSchedLightsOut(e.target.checked);
                if (e.target.checked) setSchedShift('Ca 3 (Đêm 22h-06h)');
              }}
              className="h-4 w-4 rounded border-violet-300 bg-white text-violet-600 focus:ring-violet-500"
            />
            <div>
              <div className="font-bold text-violet-900">
                🌙 Kích hoạt chạy đêm tự động (Lights-out Machining)
              </div>
              <div className="text-[11px] text-slate-600">
                Dành cho nguyên công chu kỳ dài trên máy CNC / Cắt dây EDM chạy tự động không người
                đứng máy
              </div>
            </div>
          </label>

          <div>
            <label className="mb-1 block font-bold uppercase text-slate-700">Ghi chú gá đặt</label>
            <input
              type="text"
              value={schedNote}
              onChange={(e) => setSchedNote(e.target.value)}
              placeholder="Gom nhóm phôi cùng đồ gá SMED, kiểm tra chíp T01 trước ca..."
              className={modalInputCls}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setAddSchedOpen(false)}>
              Hủy
            </Button>
            <Button type="submit" variant="primary" disabled={submittingSched}>
              <Clock className="h-4 w-4" />
              {submittingSched ? 'Đang lưu...' : 'Lưu Lịch Điều Độ Ca'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ==================== MODAL: REASSIGN OPERATION MACHINE (SAN TẢI) ==================== */}
      <Modal
        open={Boolean(reassignModalMachine)}
        onClose={() => setReassignModalMachine(null)}
        title={`⇄ Điều Chuyển San Tải Máy: ${reassignModalMachine?.machineName || ''}`}
        subtitle="Chuyển nguyên công mặc định sang máy chị em đang rảnh để giải phóng cổ chai tức thì"
        maxWidthClass="max-w-lg"
      >
        <form noValidate onSubmit={handleReassignOperationMachine} className="space-y-4 text-xs">
          <div>
            <label className="mb-1.5 block font-bold uppercase text-slate-700">
              Chọn nguyên công đang gán trên {reassignModalMachine?.machineName}
            </label>
            <select
              value={selectedReassignNcId}
              onChange={(e) => setSelectedReassignNcId(e.target.value)}
              className={modalInputCls}
            >
              {(opsOnReassignMachine.length > 0 ? opsOnReassignMachine : bootstrap.operations).map(
                (op) => (
                  <option key={op.ncId} value={op.ncId}>
                    {op.ncId} — {op.productName} | {op.opName} ({op.stdSeconds}s)
                  </option>
                )
              )}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block font-bold uppercase text-slate-700">
              Chuyển sang máy nhận tải (ưu tiên máy &lt;80% tải)
            </label>
            <select
              value={targetMachineName}
              onChange={(e) => setTargetMachineName(e.target.value)}
              className={`${modalInputCls} font-bold text-emerald-700`}
            >
              {bootstrap.machines.map((m) => {
                const ml = loads.find((l) => l.machineId === m.id);
                return (
                  <option key={m.id} value={m.name}>
                    {m.name} ({m.group}) — Tải hiện tại: {ml ? `${ml.loadPct}%` : '0%'}
                  </option>
                );
              })}
            </select>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setReassignModalMachine(null)}>
              Đóng
            </Button>
            <Button type="submit" variant="success" disabled={reassigning}>
              <ArrowRightLeft className="h-4 w-4" />
              {reassigning ? 'Đang điều chuyển...' : 'Xác Nhận San Tải Nguyên Công'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ==================== MODAL: CONFIRM DELETE SCHEDULE ==================== */}
      <Modal
        open={Boolean(deleteTargetSched)}
        onClose={() => setDeleteTargetSched(null)}
        title="Xác Nhận Xóa Block Điều Độ Ca"
        maxWidthClass="max-w-md"
      >
        <div className="space-y-4 text-sm text-slate-700">
          <p>
            Bạn có chắc muốn xóa lịch chạy máy{' '}
            <strong className="text-blue-700">{deleteTargetSched?.machineName}</strong> cho đơn{' '}
            <strong className="text-amber-700">{deleteTargetSched?.poId}</strong> (
            {deleteTargetSched?.ncId})?
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDeleteTargetSched(null)}>
              Giữ lại
            </Button>
            <Button variant="danger" onClick={() => void handleDeleteSchedule()}>
              <Trash2 className="h-4 w-4" /> Xóa lịch ca
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
