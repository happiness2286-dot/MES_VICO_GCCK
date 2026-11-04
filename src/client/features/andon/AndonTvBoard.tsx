import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Award,
  Calendar,
  CheckCircle2,
  Clock,
  Cpu,
  ExternalLink,
  FileText,
  Filter,
  Flame,
  LayoutGrid,
  Maximize2,
  Minimize2,
  Pin,
  PlayCircle,
  RefreshCw,
  Trophy,
  Users,
  UserCheck,
  UserX,
  Wrench,
  X,
} from 'lucide-react';
import type { AndonLivePayload } from '@shared/types';
import { removeVietnameseTones } from '@shared/vnSearch';
import { apiClient } from '../../lib/apiClient';
import { getFallbackAndonLive, saveFallbackDailyPlan } from '../../lib/clientFallbackStore';
import { isSupabaseConnected, fetchDailyPlanFromSupabase, subscribeSupabaseDailyPlanChanges } from '../../lib/supabaseClient';
import { formatDateVn, formatNumber } from '../../lib/formatters';
import { navigateTo } from '../../lib/navigation';
import { Badge, Button, Modal } from '../../components/ui/IndustrialPrimitives';

type AndonDisplayMode = 'ALL_ZONES' | 'CAROUSEL';
type AndonSlideIndex = 0 | 1 | 2;
type MachineFilterKey = 'ALL' | 'RUNNING' | 'SETUP' | 'OVERTIME' | 'STOPPED' | 'LIGHTS_OUT' | 'IDLE';

const MACHINE_FILTER_LABELS: Record<MachineFilterKey, string> = {
  ALL: 'Tất cả máy gia công',
  RUNNING: '🟢 Đang chạy (Hoạt động tốt)',
  SETUP: '🟡 Setup / Đo kiểm (Chuẩn bị gá)',
  OVERTIME: '🔥 Đang tăng cường tăng ca (OT)',
  STOPPED: '🔴 Sự cố / Dừng máy',
  LIGHTS_OUT: '🟣 Lights-out đêm / Chờ phôi',
  IDLE: '⚪ Không hoạt động (Chưa bố trí thợ)',
};

function getVietnamClockAndShift(now: Date): { clockStr: string; shiftLabel: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const hh = parts.find((p) => p.type === 'hour')?.value ?? '08';
  const mm = parts.find((p) => p.type === 'minute')?.value ?? '00';
  const ss = parts.find((p) => p.type === 'second')?.value ?? '00';
  const hourNum = Number(hh);

  let shiftLabel = 'CA 1 · SÁNG (06:00–14:00)';
  if (hourNum >= 14 && hourNum < 22) {
    shiftLabel = 'CA 2 · CHIỀU (14:00–22:00)';
  } else if (hourNum >= 22 || hourNum < 6) {
    shiftLabel = 'CA 3 · ĐÊM (22:00–06:00)';
  }

  return {
    clockStr: `${hh}:${mm}:${ss}`,
    shiftLabel,
  };
}

function resolveMachineVisualState(m: AndonLivePayload['machines'][number]): {
  badgeLabel: string;
  cardCls: string;
  pillCls: string;
  dotCls: string;
} {
  const stopAscii = removeVietnameseTones(m.stopReason || '').toLowerCase();
  const isWaitingMaterial =
    m.status === 'STOPPED' && (stopAscii.includes('cho phoi') || stopAscii.includes('cho cau'));

  if (m.status === 'RUNNING' && m.isLightsOut) {
    return {
      badgeLabel: '🟣 ĐÊM LIGHTS-OUT',
      cardCls: 'border-slate-200 border-l-4 border-l-violet-500 bg-white shadow-sm',
      pillCls: 'border-violet-200 bg-violet-50 text-violet-700',
      dotCls: 'bg-violet-600 animate-pulse',
    };
  }

  if (m.status === 'RUNNING') {
    return {
      badgeLabel: '🟢 ĐANG CHẠY',
      cardCls: 'border-slate-200 border-l-4 border-l-emerald-500 bg-white shadow-sm',
      pillCls: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      dotCls: 'bg-emerald-500 animate-pulse',
    };
  }

  if (m.status === 'SETUP') {
    return {
      badgeLabel: '🟡 SETUP / ĐO KIỂM',
      cardCls: 'border-slate-200 border-l-4 border-l-amber-500 bg-white shadow-sm',
      pillCls: 'border-amber-200 bg-amber-50 text-amber-800',
      dotCls: 'bg-amber-500',
    };
  }

  if (isWaitingMaterial) {
    return {
      badgeLabel: '🟣 CHỜ PHÔI / CẨU',
      cardCls: 'border-slate-200 border-l-4 border-l-violet-500 bg-white shadow-sm',
      pillCls: 'border-violet-200 bg-violet-50 text-violet-700',
      dotCls: 'bg-violet-500',
    };
  }

  if (m.status === 'STOPPED' || m.status === 'MAINTENANCE') {
    return {
      badgeLabel: '🔴 SỰ CỐ / CHỜ SỬA CHỮA',
      cardCls: 'border-rose-200 border-l-4 border-l-rose-600 bg-rose-50/40 shadow-sm',
      pillCls: 'border-rose-200 bg-rose-100/80 text-rose-800',
      dotCls: 'bg-rose-600 animate-ping',
    };
  }

  return {
    badgeLabel: '⚪ KHÔNG HOẠT ĐỘNG',
    cardCls: 'border-slate-200 border-l-4 border-l-slate-300 bg-white shadow-sm',
    pillCls: 'border-slate-200 bg-slate-100 text-slate-600',
    dotCls: 'bg-slate-400',
  };
}

export function AndonTvBoard() {
  const [data, setData] = useState<AndonLivePayload>(() => getFallbackAndonLive());
  const [loading, setLoading] = useState<boolean>(true);
  const [now, setNow] = useState<Date>(() => new Date());
  const [displayMode, setDisplayMode] = useState<AndonDisplayMode>('ALL_ZONES');
  const [slideIdx, setSlideIdx] = useState<AndonSlideIndex>(0);
  const [slidePinned, setSlidePinned] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [viewShift, setViewShift] = useState<'AUTO' | 'Ca 1' | 'Ca 2' | 'Ca 3'>('AUTO');
  const [crewFilter, setCrewFilter] = useState<'SHIFT_ONLY' | 'ALL_13'>('ALL_13');
  const [machineFilter, setMachineFilter] = useState<MachineFilterKey>('ALL');

  // Inspection & Resolution Modals
  const [selectedWorker, setSelectedWorker] = useState<NonNullable<AndonLivePayload['workersStatus']>[number] | null>(null);
  const [selectedMachine, setSelectedMachine] = useState<AndonLivePayload['machines'][number] | null>(null);
  const [selectedPo, setSelectedPo] = useState<AndonLivePayload['urgentOrders'][number] | null>(null);

  // Fast resolution navigation helpers
  const handleResolveWorkerSchedule = (workerName: string) => {
    try {
      localStorage.setItem('GCCK_ADMIN_SCHEDULE_WORKER_FOCUS', workerName);
    } catch {}
    navigateTo(`/admin?tab=daily_schedule&worker=${encodeURIComponent(workerName)}`);
  };

  const handleResolveWorkerQc = () => {
    navigateTo('/admin?tab=logs_qc');
  };

  const handleResolveWorkerPortal = () => {
    navigateTo('/worker');
  };

  const handleResolveMachineCockpit = (_machineId?: string) => {
    navigateTo('/admin?tab=cockpit');
  };

  const handleResolveMachineSchedule = (machineOrWorkerName: string) => {
    try {
      localStorage.setItem('GCCK_ADMIN_SCHEDULE_WORKER_FOCUS', machineOrWorkerName);
    } catch {}
    navigateTo(`/admin?tab=daily_schedule&worker=${encodeURIComponent(machineOrWorkerName)}`);
  };

  const handleResolveMachinePo = (poId: string) => {
    try {
      localStorage.setItem('GCCK_ADMIN_ORDERS_PO_FOCUS', poId);
    } catch {}
    navigateTo(`/admin?tab=orders&ordersSearch=${encodeURIComponent(poId)}`);
  };

  const handleResolvePoOrders = (poId?: string) => {
    try {
      if (poId) localStorage.setItem('GCCK_ADMIN_ORDERS_PO_FOCUS', poId);
    } catch {}
    navigateTo(poId ? `/admin?tab=orders&ordersSearch=${encodeURIComponent(poId)}` : '/admin?tab=orders');
  };

  const handleResolvePoSchedule = (productOrPo?: string) => {
    try {
      if (productOrPo) localStorage.setItem('GCCK_ADMIN_SCHEDULE_WORKER_FOCUS', productOrPo);
    } catch {}
    navigateTo(productOrPo ? `/admin?tab=daily_schedule&worker=${encodeURIComponent(productOrPo)}` : '/admin?tab=daily_schedule');
  };

  const handleResolvePoTrace = (poId: string) => {
    navigateTo(`/admin?tab=logs_qc&tracePoId=${encodeURIComponent(poId)}`);
  };

  const fetchAndon = useCallback(
    async (silent = true, overrideShift?: 'AUTO' | 'Ca 1' | 'Ca 2' | 'Ca 3') => {
      if (!silent) setLoading(true);
      try {
        if (isSupabaseConnected()) {
          const vDate = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
          const sbRows = await fetchDailyPlanFromSupabase(vDate);
          if (sbRows && sbRows.length > 0) {
            saveFallbackDailyPlan(vDate, sbRows);
          }
        }
        const curShift = overrideShift !== undefined ? overrideShift : viewShift;
        const url =
          curShift !== 'AUTO'
            ? `/andon/live?shift=${encodeURIComponent(curShift)}`
            : '/andon/live';
        const payload = await apiClient.get<AndonLivePayload>(url, { timeoutMs: 9000 });
        setData(payload);
      } catch {
        // Keep last known live board on transient network hiccup
      } finally {
        setLoading(false);
      }
    },
    [viewShift]
  );

  // Poll /andon/live every 10s and subscribe to cloud plan changes
  useEffect(() => {
    void fetchAndon(false, viewShift);
    const pollId = window.setInterval(() => {
      void fetchAndon(true, viewShift);
    }, 10000);

    const unsub = subscribeSupabaseDailyPlanChanges(() => {
      void fetchAndon(true, viewShift);
    });

    return () => {
      window.clearInterval(pollId);
      if (unsub) unsub();
    };
  }, [fetchAndon, viewShift]);

  // Digital 1s clock
  useEffect(() => {
    const clockId = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(clockId);
  }, []);

  // Auto-carousel 15s rotation when in CAROUSEL mode and not pinned
  useEffect(() => {
    if (displayMode !== 'CAROUSEL' || slidePinned) return;
    const rotId = window.setInterval(() => {
      setSlideIdx((prev) => ((prev + 1) % 3) as AndonSlideIndex);
    }, 15000);
    return () => window.clearInterval(rotId);
  }, [displayMode, slidePinned]);

  // Sync fullscreen state
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // Ignore browser restriction
    }
  };

  const { clockStr, shiftLabel } = useMemo(() => getVietnamClockAndShift(now), [now]);

  const spindlePct = data?.spindleRunPct ?? 0;
  const machines = data?.machines ?? [];
  const urgentOrders = data?.urgentOrders ?? [];
  const leaderboard = data?.workerLeaderboard ?? [];
  const tickerItems = data?.alertsTicker ?? [
    'Đang đồng bộ tín hiệu trực tuyến từ phân xưởng GCCK Thắng Lợi...',
  ];

  const lightsOutOrWaitCount = useMemo(
    () =>
      machines.filter((m) => {
        if (m.status === 'RUNNING' && m.isLightsOut) return true;
        if (m.status === 'STOPPED') {
          const stopAscii = removeVietnameseTones(m.stopReason || '').toLowerCase();
          return stopAscii.includes('cho phoi') || stopAscii.includes('cho cau');
        }
        return false;
      }).length,
    [machines]
  );

  const filteredMachines = useMemo(() => {
    if (machineFilter === 'ALL') return machines;
    return machines.filter((m) => {
      if (machineFilter === 'RUNNING') return m.status === 'RUNNING';
      if (machineFilter === 'SETUP') return m.status === 'SETUP';
      if (machineFilter === 'OVERTIME') return Boolean(m.isOvertime);
      if (machineFilter === 'STOPPED') return m.status === 'STOPPED';
      if (machineFilter === 'LIGHTS_OUT') {
        if (m.status === 'RUNNING' && m.isLightsOut) return true;
        if (m.status === 'STOPPED') {
          const stopAscii = removeVietnameseTones(m.stopReason || '').toLowerCase();
          return stopAscii.includes('cho phoi') || stopAscii.includes('cho cau');
        }
        return false;
      }
      if (machineFilter === 'IDLE') {
        return m.status === 'IDLE' || (!m.currentPoId && !m.currentWorkerName);
      }
      return true;
    });
  }, [machines, machineFilter]);

  const showZone1 = displayMode === 'ALL_ZONES' || slideIdx === 0;
  const showZone2 = displayMode === 'ALL_ZONES' || slideIdx === 1;
  const showZone3 = displayMode === 'ALL_ZONES' || slideIdx === 2;

  return (
    <div className="flex min-h-[calc(100vh-52px)] w-full max-w-full flex-col justify-between overflow-x-hidden bg-[#EEF2F6] text-slate-900">
      {/* ==================== DAYLIGHT ANTI-GLARE KIOSK HEADER ==================== */}
      <header className="w-full border-b border-slate-200 bg-white px-3 py-3 shadow-sm sm:px-5">
        <div className="mx-auto flex w-full max-w-[1920px] flex-wrap items-center justify-between gap-3">
          {/* Title & Live Shift */}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="inline-flex h-3 w-3 rounded-full bg-emerald-500 ring-4 ring-emerald-500/20" />
              <h1 className="text-base font-black tracking-wide text-slate-900 sm:text-xl lg:text-2xl">
                GCCK THẮNG LỢI — LIVE SHOPFLOOR ANDON
              </h1>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-bold sm:text-sm">
              <span
                className={`rounded-lg border px-2.5 py-1 font-black ${
                  viewShift === 'AUTO'
                    ? 'border-blue-300 bg-blue-50 text-blue-800'
                    : 'border-amber-400 bg-amber-100 text-amber-950 animate-pulse'
                }`}
              >
                {viewShift === 'AUTO' ? shiftLabel : `ĐANG XEM TRƯỚC: ${viewShift.toUpperCase()}`}
              </span>
              <span className="font-mono-num text-slate-600">
                Ngày {formatDateVn(data?.vietnamDate)}
              </span>

              {/* Shift Selector Toolbar on TV Andon */}
              <div className="flex items-center gap-1 rounded-xl border border-slate-300 bg-slate-100/90 p-1 shadow-2xs">
                <button
                  type="button"
                  onClick={() => setViewShift('AUTO')}
                  className={`rounded-lg px-2.5 py-1 text-xs font-black transition-all ${
                    viewShift === 'AUTO'
                      ? 'border border-emerald-500 bg-emerald-600 text-white shadow-xs'
                      : 'text-slate-700 hover:bg-white hover:text-emerald-700'
                  }`}
                  title="Nhận diện tự động theo giờ thực tế tại xưởng"
                >
                  🔴 Tự động (Live)
                </button>
                {(['Ca 1', 'Ca 2', 'Ca 3'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setViewShift(s)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-black transition-all ${
                      viewShift === s
                        ? 'border border-blue-600 bg-blue-600 text-white shadow-xs'
                        : 'text-slate-700 hover:bg-white hover:text-blue-700'
                    }`}
                    title={`Chuyển sang xem kế hoạch & máy ${s}`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Key KPI Strip: Spindle Run-time %, Today OK / NG, Live Clock, Kiosk Controls */}
          <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
            {/* Spindle Run-time % */}
            <div className="rounded-xl border border-slate-200 border-l-4 border-l-emerald-500 bg-slate-50/80 px-3.5 py-1.5 shadow-sm">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600">
                Spindle Run-time
              </div>
              <div className="flex items-baseline gap-2">
                <span
                  className={`font-mono-num tabular-nums text-xl font-black sm:text-2xl ${
                    spindlePct >= 60
                      ? 'text-emerald-700'
                      : spindlePct >= 35
                        ? 'text-amber-700'
                        : 'text-rose-700'
                  }`}
                >
                  {spindlePct}%
                </span>
                <span className="font-mono-num text-xs font-semibold text-slate-600">
                  ({data?.summary?.runningCount ?? 0}/{data?.summary?.totalMachines ?? 0} máy)
                </span>
              </div>
            </div>

            {/* Today OK / NG */}
            <div className="rounded-xl border border-slate-200 border-l-4 border-l-blue-600 bg-slate-50/80 px-3.5 py-1.5 shadow-sm">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600">
                Sản lượng hôm nay
              </div>
              <div className="font-mono-num tabular-nums text-lg font-black sm:text-2xl">
                <span className="text-emerald-700">
                  {formatNumber(data?.summary?.todayOkQty ?? 0)} OK
                </span>
                <span className="mx-1.5 text-slate-500">/</span>
                <span className="text-rose-700">
                  {formatNumber(data?.summary?.todayScrapQty ?? 0)} NG
                </span>
              </div>
            </div>

            {/* Digital Clock HH:MM:SS */}
            <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-3.5 py-1.5 shadow-sm">
              <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-blue-700">
                <Clock className="h-3 w-3 text-blue-600" /> Giờ Xưởng
              </div>
              <div
                data-testid="andon-digital-clock"
                className="font-mono-num tabular-nums text-xl font-black tracking-wider text-slate-900 sm:text-2xl"
              >
                {clockStr}
              </div>
            </div>

            {/* Kiosk Controls & Fast Navigation */}
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => navigateTo('/admin')}
                className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-black text-slate-700 shadow-sm transition-colors hover:border-blue-500 hover:bg-slate-50 hover:text-blue-700"
                title="Quay lại phân hệ Quản trị Admin"
              >
                <ArrowLeft className="h-4 w-4 text-blue-600" />
                <span>Quản Trị</span>
              </button>

              <button
                type="button"
                onClick={() => navigateTo('/worker')}
                className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-black text-slate-700 shadow-sm transition-colors hover:border-emerald-500 hover:bg-emerald-50 hover:text-emerald-700"
                title="Về Cổng Báo Cáo Công Nhân"
              >
                <span>Cổng Thợ</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  setDisplayMode((m) => (m === 'ALL_ZONES' ? 'CAROUSEL' : 'ALL_ZONES'))
                }
                className={`inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-extrabold shadow-sm transition-colors ${
                  displayMode === 'CAROUSEL'
                    ? 'border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-100'
                    : 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'
                }`}
              >
                {displayMode === 'ALL_ZONES' ? (
                  <>
                    <PlayCircle className="h-4 w-4" />
                    <span>Auto-Slide 15s</span>
                  </>
                ) : (
                  <>
                    <LayoutGrid className="h-4 w-4" />
                    <span>Xem Đủ 3 Vùng</span>
                  </>
                )}
              </button>

              {displayMode === 'CAROUSEL' && (
                <>
                  <button
                    type="button"
                    onClick={() => setSlidePinned((p) => !p)}
                    className={`inline-flex min-h-[42px] items-center gap-1 rounded-xl border px-3 py-1.5 text-xs font-extrabold shadow-sm ${
                      slidePinned
                        ? 'border-amber-300 bg-amber-50 text-amber-800'
                        : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <Pin className="h-3.5 w-3.5" />
                    <span>{slidePinned ? 'Đã ghim' : 'Ghim Slide'}</span>
                  </button>
                  {([0, 1, 2] as const).map((idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setSlideIdx(idx)}
                      className={`font-mono-num h-[42px] w-[38px] rounded-xl border text-xs font-black shadow-sm ${
                        slideIdx === idx
                          ? 'border-blue-600 bg-blue-600 text-white'
                          : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {idx + 1}
                    </button>
                  ))}
                </>
              )}

              <button
                type="button"
                onClick={() => void fetchAndon(false)}
                className="inline-flex h-[42px] w-[42px] items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700 shadow-sm transition-colors hover:border-blue-500 hover:bg-slate-50 hover:text-blue-700"
                title="Làm mới ngay"
                aria-label="Làm mới bảng Andon"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin text-blue-600' : ''}`} />
              </button>

              <button
                type="button"
                onClick={() => void toggleFullscreen()}
                className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm transition-colors hover:border-blue-500 hover:bg-slate-50 hover:text-blue-700"
              >
                {isFullscreen ? (
                  <>
                    <Minimize2 className="h-4 w-4 text-blue-600" />
                    <span>Thu nhỏ</span>
                  </>
                ) : (
                  <>
                    <Maximize2 className="h-4 w-4 text-blue-600" />
                    <span>Toàn màn hình</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[1920px] flex-1 space-y-3 p-3 sm:p-4">
        {/* ==================== SUMMARY KPI STRIP (CLICK TO FILTER MACHINES) ==================== */}
        <section
          aria-label="Tóm tắt trạng thái máy công cụ"
          className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6"
        >
          <div
            role="button"
            tabIndex={0}
            onClick={() => setMachineFilter((cur) => (cur === 'RUNNING' ? 'ALL' : 'RUNNING'))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                setMachineFilter((cur) => (cur === 'RUNNING' ? 'ALL' : 'RUNNING'));
              }
            }}
            title="Bấm để lọc hiển thị các máy đang chạy tốt"
            className={`cursor-pointer transition-all flex items-center justify-between rounded-xl border border-slate-200 border-l-4 border-l-emerald-500 bg-white px-3.5 py-2 shadow-sm hover:shadow-md hover:scale-[1.02] active:scale-[0.98] ${
              machineFilter === 'RUNNING' ? 'ring-2 ring-emerald-500 ring-offset-2 bg-emerald-50/40' : ''
            }`}
          >
            <div>
              <div className="text-[11px] font-bold uppercase text-slate-600">Đang chạy</div>
              <div className="text-xs font-semibold text-emerald-700">🟢 Hoạt động tốt</div>
            </div>
            <span className="font-mono-num text-2xl font-black text-emerald-700">
              {data?.summary?.runningCount ?? 0}
            </span>
          </div>

          <div
            role="button"
            tabIndex={0}
            onClick={() => setMachineFilter((cur) => (cur === 'SETUP' ? 'ALL' : 'SETUP'))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                setMachineFilter((cur) => (cur === 'SETUP' ? 'ALL' : 'SETUP'));
              }
            }}
            title="Bấm để lọc hiển thị các máy đang setup / gá đặt"
            className={`cursor-pointer transition-all flex items-center justify-between rounded-xl border border-slate-200 border-l-4 border-l-amber-500 bg-white px-3.5 py-2 shadow-sm hover:shadow-md hover:scale-[1.02] active:scale-[0.98] ${
              machineFilter === 'SETUP' ? 'ring-2 ring-amber-500 ring-offset-2 bg-amber-50/40' : ''
            }`}
          >
            <div>
              <div className="text-[11px] font-bold uppercase text-slate-600">Setup / Đo kiểm</div>
              <div className="text-xs font-semibold text-amber-800">🟡 Chuẩn bị gá</div>
            </div>
            <span className="font-mono-num text-2xl font-black text-amber-700">
              {data?.summary?.setupCount ?? 0}
            </span>
          </div>

          <div
            role="button"
            tabIndex={0}
            onClick={() => setMachineFilter((cur) => (cur === 'OVERTIME' ? 'ALL' : 'OVERTIME'))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                setMachineFilter((cur) => (cur === 'OVERTIME' ? 'ALL' : 'OVERTIME'));
              }
            }}
            title="Bấm để lọc hiển thị các máy đang chạy tăng ca"
            className={`cursor-pointer transition-all flex items-center justify-between rounded-xl border border-orange-200 border-l-4 border-l-orange-500 bg-orange-50/30 px-3.5 py-2 shadow-sm hover:shadow-md hover:scale-[1.02] active:scale-[0.98] ${
              machineFilter === 'OVERTIME' ? 'ring-2 ring-orange-500 ring-offset-2 bg-orange-100/50' : ''
            }`}
          >
            <div>
              <div className="text-[11px] font-bold uppercase text-orange-700">Tăng ca (OT)</div>
              <div className="text-xs font-semibold text-orange-800">🔥 Đang tăng cường</div>
            </div>
            <span className="font-mono-num text-2xl font-black text-orange-700">
              {data?.summary?.overtimeCount ?? machines.filter((m) => m.isOvertime).length}
            </span>
          </div>

          <div
            role="button"
            tabIndex={0}
            onClick={() => setMachineFilter((cur) => (cur === 'STOPPED' ? 'ALL' : 'STOPPED'))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                setMachineFilter((cur) => (cur === 'STOPPED' ? 'ALL' : 'STOPPED'));
              }
            }}
            title="Bấm để lọc hiển thị các máy đang gặp sự cố / dừng"
            className={`cursor-pointer transition-all flex items-center justify-between rounded-xl border border-slate-200 border-l-4 border-l-rose-600 bg-white px-3.5 py-2 shadow-sm hover:shadow-md hover:scale-[1.02] active:scale-[0.98] ${
              machineFilter === 'STOPPED' ? 'ring-2 ring-rose-500 ring-offset-2 bg-rose-50/50' : ''
            }`}
          >
            <div>
              <div className="text-[11px] font-bold uppercase text-slate-600">Sự cố / Dừng</div>
              <div className="text-xs font-semibold text-rose-700">🔴 Cần xử lý</div>
            </div>
            <span className="font-mono-num text-2xl font-black text-rose-700">
              {data?.summary?.stoppedCount ?? 0}
            </span>
          </div>

          <div
            role="button"
            tabIndex={0}
            onClick={() => setMachineFilter((cur) => (cur === 'LIGHTS_OUT' ? 'ALL' : 'LIGHTS_OUT'))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                setMachineFilter((cur) => (cur === 'LIGHTS_OUT' ? 'ALL' : 'LIGHTS_OUT'));
              }
            }}
            title="Bấm để lọc hiển thị máy chạy đêm lights-out hoặc chờ phôi"
            className={`cursor-pointer transition-all flex items-center justify-between rounded-xl border border-slate-200 border-l-4 border-l-violet-500 bg-white px-3.5 py-2 shadow-sm hover:shadow-md hover:scale-[1.02] active:scale-[0.98] ${
              machineFilter === 'LIGHTS_OUT' ? 'ring-2 ring-violet-500 ring-offset-2 bg-violet-50/50' : ''
            }`}
          >
            <div>
              <div className="text-[11px] font-bold uppercase text-slate-600">Trong đó: Đêm / Chờ phôi</div>
              <div className="text-xs font-semibold text-violet-700">🟣 Lights-out</div>
            </div>
            <span className="font-mono-num text-2xl font-black text-violet-700">
              {lightsOutOrWaitCount}
            </span>
          </div>

          <div
            role="button"
            tabIndex={0}
            onClick={() => setMachineFilter((cur) => (cur === 'IDLE' ? 'ALL' : 'IDLE'))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                setMachineFilter((cur) => (cur === 'IDLE' ? 'ALL' : 'IDLE'));
              }
            }}
            title="Bấm để lọc hiển thị các máy chưa bố trí thợ"
            className={`cursor-pointer transition-all flex items-center justify-between rounded-xl border border-slate-200 border-l-4 border-l-slate-400 bg-white px-3.5 py-2 shadow-sm hover:shadow-md hover:scale-[1.02] active:scale-[0.98] ${
              machineFilter === 'IDLE' ? 'ring-2 ring-slate-500 ring-offset-2 bg-slate-100' : ''
            }`}
          >
            <div>
              <div className="text-[11px] font-bold uppercase text-slate-600">Không hoạt động</div>
              <div className="text-xs font-semibold text-slate-600">⚪ Chưa bố trí thợ</div>
            </div>
            <span className="font-mono-num text-2xl font-black text-slate-700">
              {data?.summary?.idleCount ?? 0}
            </span>
          </div>
        </section>

        {/* ==================== BẢNG ĐIỀU HÀNH 13 NHÂN SỰ & PHÂN CA REALTIME ==================== */}
        <section
          aria-label="Giám sát 13 nhân sự và phân ca xưởng"
          className="rounded-2xl border-2 border-blue-300 bg-gradient-to-r from-blue-50/90 via-slate-50 to-indigo-50/80 p-3.5 shadow-sm space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-blue-200 pb-2">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-blue-700" />
              <h2 className="text-sm font-black uppercase tracking-wider text-slate-900 sm:text-base">
                Giám Sát 13 Nhân Sự &amp; Điều Phối Máy Chính / Máy Phụ ({shiftLabel})
              </h2>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 text-xs font-bold">
              <button
                type="button"
                onClick={() => setCrewFilter('SHIFT_ONLY')}
                className={`px-3 py-1.5 rounded-lg border transition-all ${
                  crewFilter === 'SHIFT_ONLY'
                    ? 'bg-blue-600 text-white border-blue-700 shadow-xs'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                }`}
              >
                Tổ Ca Đang Trực ({shiftLabel.split('·')[0].trim()})
              </button>
              <button
                type="button"
                onClick={() => setCrewFilter('ALL_13')}
                className={`px-3 py-1.5 rounded-lg border transition-all ${
                  crewFilter === 'ALL_13'
                    ? 'bg-blue-600 text-white border-blue-700 shadow-xs'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                }`}
              >
                Xem Toàn Bộ 13 Nhân Sự (Cả 3 Ca)
              </button>
            </div>
          </div>

          {/* Workers Grid */}
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {(data?.workersStatus || [])
              .filter((w) => (crewFilter === 'SHIFT_ONLY' ? w.isCurrentShiftActive || w.status === 'SUPERVISOR' : true))
              .map((w) => {
                const isWorking = w.status === 'ACTIVE' || w.status === 'OVERTIME';
                const isOffInShift = w.status === 'OFF';
                const isSupervisor = w.status === 'SUPERVISOR';

                const cardCls = isWorking
                  ? 'border-emerald-300 bg-emerald-50/50 shadow-xs ring-1 ring-emerald-400/30'
                  : isOffInShift
                  ? 'border-amber-300 bg-amber-50/60 shadow-xs'
                  : isSupervisor
                  ? 'border-blue-300 bg-blue-50/70 shadow-xs'
                  : 'border-slate-200 bg-white/70 text-slate-500 opacity-80';

                const badgeCls = isWorking
                  ? 'bg-emerald-600 text-white'
                  : isOffInShift
                  ? 'bg-amber-500 text-slate-950 font-black'
                  : isSupervisor
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-200 text-slate-700';

                return (
                  <div
                    key={w.workerId}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedWorker(w)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        setSelectedWorker(w);
                      }
                    }}
                    title={`Bấm để vào xem chi tiết & giải quyết cho thợ ${w.name}`}
                    className={`group flex flex-col justify-between rounded-xl border p-2.5 transition-all cursor-pointer hover:shadow-lg hover:border-blue-400 hover:-translate-y-0.5 active:scale-[0.99] ${cardCls}`}
                  >
                    <div>
                      <div className="flex items-start justify-between gap-1.5">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-black text-slate-900 flex items-center gap-1.5">
                            <span className="group-hover:text-blue-700 transition-colors">{w.name}</span>
                            <span className="font-mono text-[10px] font-bold text-slate-500">({w.workerId})</span>
                          </div>
                          <div className="truncate text-[11px] font-bold text-slate-600">
                            {w.title || w.role} {w.assignedShift ? `• ${w.assignedShift}` : ''}
                          </div>
                        </div>

                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-black shrink-0 ${badgeCls}`}>
                          {w.status === 'ACTIVE'
                            ? '🟢 ĐANG LÀM'
                            : w.status === 'OVERTIME'
                            ? '🔥 TĂNG CA'
                            : w.status === 'OFF'
                            ? '⚪ BÁO NGHỈ / CHƯA GÁN'
                            : w.status === 'SUPERVISOR'
                            ? '👔 QUẢN ĐỐC'
                            : '💤 NGHỈ CA'}
                        </span>
                      </div>

                      {/* Machine assignment details */}
                      {isWorking && (
                        <div className="mt-2 space-y-1 text-xs">
                          {w.primaryMachine && (
                            <div className="truncate font-extrabold text-emerald-800 bg-white px-2 py-1 rounded border border-emerald-200">
                              ⚙️ Máy chính: <strong>{w.primaryMachine}</strong>
                            </div>
                          )}
                          {w.secondaryMachine && (
                            <div className="truncate font-black text-amber-900 bg-amber-100/80 px-2 py-1 rounded border border-amber-300">
                              ⭐ Ghép máy phụ (+0.33): <strong>{w.secondaryMachine}</strong>
                            </div>
                          )}
                          {w.productName && (
                            <div className="truncate text-[11px] font-semibold text-slate-700 pt-0.5">
                              SP: {w.productName} {w.opName ? `· ${w.opName}` : ''}
                            </div>
                          )}
                        </div>
                      )}

                      {isOffInShift && (
                        <div className="mt-2 rounded bg-amber-100/70 p-1.5 text-[11px] font-semibold text-amber-900 border border-amber-200">
                          ⚠️ Chưa phân công máy hoặc công nhân báo nghỉ ca hôm nay.
                        </div>
                      )}

                      {isSupervisor && (
                        <div className="mt-2 rounded bg-blue-100/60 p-1.5 text-[11px] font-semibold text-blue-900 border border-blue-200">
                          Chỉ đạo điều hành sản xuất 3 ca xưởng cơ khí, không trực tiếp vận hành máy.
                        </div>
                      )}

                      {w.status === 'OFF_SHIFT' && (
                        <div className="mt-2 text-[11px] italic text-slate-500">
                          Nghỉ ca theo lịch luân chuyển, chờ đến ca trực.
                        </div>
                      )}
                    </div>

                    {/* 1-Click Inspection Visual Cue */}
                    <div className="mt-2.5 pt-1.5 border-t border-slate-200/60 flex items-center justify-between text-[11px] font-bold text-blue-700 group-hover:text-blue-800">
                      <span className="inline-flex items-center gap-1">
                        <span>🔍 Bấm xem &amp; giải quyết</span>
                      </span>
                      <ArrowRight className="h-3.5 w-3.5 text-blue-600 transition-transform group-hover:translate-x-0.5" />
                    </div>
                  </div>
                );
              })}
          </div>
        </section>

        {/* ==================== 3-ZONE LIVE GRID ==================== */}
        <div
          className={
            displayMode === 'ALL_ZONES'
              ? 'grid grid-cols-1 gap-3.5 xl:grid-cols-12'
              : 'grid grid-cols-1 gap-3.5'
          }
        >
          {/* ZONE 1: 23+ MACHINE LIVE STATUS MATRIX */}
          {showZone1 && (
            <section
              aria-label="Lưới trạng thái máy gia công"
              className={`rounded-2xl border border-slate-200 bg-white/95 p-3.5 shadow-card ${
                displayMode === 'ALL_ZONES' ? 'xl:col-span-7' : ''
              }`}
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Cpu className="h-5 w-5 text-blue-600" />
                  <h2 className="text-sm font-black uppercase tracking-wider text-slate-900 sm:text-base">
                    Vùng 1 · Trạng Thái {filteredMachines.length}/{machines.length} Máy Gia Công Cơ Khí
                  </h2>
                </div>

                {/* Color Legend (Clickable quick filter) */}
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold">
                  <button
                    type="button"
                    onClick={() => setMachineFilter((cur) => (cur === 'RUNNING' ? 'ALL' : 'RUNNING'))}
                    className={`rounded-md border px-2 py-0.5 transition-all ${
                      machineFilter === 'RUNNING'
                        ? 'border-emerald-600 bg-emerald-600 text-white shadow-xs'
                        : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                    }`}
                  >
                    🟢 Chạy: {data?.summary?.runningCount ?? 0}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMachineFilter((cur) => (cur === 'SETUP' ? 'ALL' : 'SETUP'))}
                    className={`rounded-md border px-2 py-0.5 transition-all ${
                      machineFilter === 'SETUP'
                        ? 'border-amber-600 bg-amber-500 text-slate-950 font-black shadow-xs'
                        : 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100'
                    }`}
                  >
                    🟡 Setup: {data?.summary?.setupCount ?? 0}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMachineFilter((cur) => (cur === 'STOPPED' ? 'ALL' : 'STOPPED'))}
                    className={`rounded-md border px-2 py-0.5 transition-all ${
                      machineFilter === 'STOPPED'
                        ? 'border-rose-600 bg-rose-600 text-white shadow-xs'
                        : 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
                    }`}
                  >
                    🔴 Sự cố: {data?.summary?.stoppedCount ?? 0}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMachineFilter((cur) => (cur === 'LIGHTS_OUT' ? 'ALL' : 'LIGHTS_OUT'))}
                    className={`rounded-md border px-2 py-0.5 transition-all ${
                      machineFilter === 'LIGHTS_OUT'
                        ? 'border-violet-600 bg-violet-600 text-white shadow-xs'
                        : 'border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100'
                    }`}
                  >
                    🟣 Chờ phôi / Đêm
                  </button>
                  <button
                    type="button"
                    onClick={() => setMachineFilter((cur) => (cur === 'IDLE' ? 'ALL' : 'IDLE'))}
                    className={`rounded-md border px-2 py-0.5 transition-all ${
                      machineFilter === 'IDLE'
                        ? 'border-slate-400 bg-slate-200 text-slate-900 font-black shadow-xs'
                        : 'border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    ⚪ Không hoạt động: {data?.summary?.idleCount ?? 0}
                  </button>
                </div>
              </div>

              {/* Active Filter Notification Bar */}
              {machineFilter !== 'ALL' && (
                <div className="mb-3 flex items-center justify-between rounded-xl border border-blue-200 bg-blue-50/80 px-3 py-1.5 text-xs text-blue-900 font-bold">
                  <div className="flex items-center gap-2">
                    <Filter className="h-4 w-4 text-blue-600" />
                    <span>
                      Đang lọc hiển thị: <strong>{MACHINE_FILTER_LABELS[machineFilter]}</strong> ({filteredMachines.length} máy)
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setMachineFilter('ALL')}
                    className="inline-flex items-center gap-1 rounded-lg border border-blue-300 bg-white px-2 py-0.5 text-[11px] font-black text-blue-700 shadow-2xs hover:bg-blue-100"
                  >
                    <X className="h-3.5 w-3.5" />
                    <span>Hiện tất cả 23 máy</span>
                  </button>
                </div>
              )}

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {filteredMachines.map((m) => {
                  const vis = resolveMachineVisualState(m);
                  return (
                    <div
                      key={m.id}
                      data-testid={`andon-machine-${m.id}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedMachine(m)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          setSelectedMachine(m);
                        }
                      }}
                      title={`Bấm để xem chi tiết & giải quyết cho máy ${m.name}`}
                      className={`group flex flex-col justify-between rounded-xl border p-2.5 transition-all cursor-pointer hover:shadow-lg hover:border-blue-400 hover:-translate-y-0.5 active:scale-[0.99] ${vis.cardCls}`}
                    >
                      <div>
                        <div className="flex items-start justify-between gap-1.5">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-black text-slate-900 group-hover:text-blue-700 transition-colors">
                              {m.name}
                            </div>
                            <div className="truncate text-[11px] font-medium text-slate-500">
                              {m.group}
                            </div>
                          </div>
                          {m.isBottleneck && (
                            <span
                              title="Máy cổ chai quá tải"
                              className="inline-flex shrink-0 items-center gap-0.5 rounded border border-rose-200 bg-rose-50 px-1.5 py-0.5 font-mono-num text-[10px] font-black text-rose-700"
                            >
                              <Flame className="h-3 w-3 text-rose-600" />
                              {m.loadPct}%
                            </span>
                          )}
                        </div>

                        <div className="mt-2">
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-extrabold ${vis.pillCls}`}
                          >
                            <span className={`h-2 w-2 rounded-full ${vis.dotCls}`} />
                            {vis.badgeLabel}
                          </span>
                        </div>

                        {m.currentPoId ? (
                          <div className="mt-2 space-y-0.5 text-xs">
                            <div className="truncate font-mono-num font-bold text-blue-700">
                              {m.currentPoId} {m.currentNcId ? `· ${m.currentNcId}` : ''}
                            </div>
                            {m.currentProductName && (
                              <div className="truncate text-[11px] font-medium text-slate-700">
                                {m.currentProductName}
                              </div>
                            )}
                            {m.currentWorkerName && (
                              <div className="flex flex-wrap items-center gap-1.5 truncate text-[11px] font-semibold text-slate-800">
                                <span>👷 {m.currentWorkerName}</span>
                                {m.isDualMachine && (
                                  <span className="rounded border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-[10px] font-black text-amber-900 shadow-2xs">
                                    ⭐ Ghép 2 máy (+0.33)
                                  </span>
                                )}
                                {m.isOvertime && (
                                  <span className="inline-flex items-center gap-1 rounded border border-orange-400 bg-orange-100 px-1.5 py-0.5 text-[10px] font-black text-orange-950 shadow-2xs animate-pulse">
                                    <Flame className="h-3 w-3 text-orange-600" />
                                    TĂNG CA {m.overtimeHours ? `(+${m.overtimeHours}h)` : ''}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="mt-2 text-[11px] italic text-slate-400">
                            ⚪ Không hoạt động (Chưa bố trí thợ)
                          </div>
                        )}

                        {m.stopReason && m.status !== 'RUNNING' && (
                          <div className="mt-1.5 truncate rounded border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-bold text-rose-800">
                            🚨 {m.stopReason}
                          </div>
                        )}
                      </div>

                      {/* Load Bar & 1-Click Prompt */}
                      <div className="mt-2.5">
                        <div className="flex justify-between font-mono-num text-[10px] font-semibold text-slate-500">
                          <span>Tải KH</span>
                          <span>{m.loadPct}%</span>
                        </div>
                        <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                          <div
                            className={`h-full rounded-full ${
                              m.loadPct > 100
                                ? 'bg-rose-600'
                                : m.loadPct >= 85
                                  ? 'bg-amber-500'
                                  : 'bg-blue-600'
                            }`}
                            style={{ width: `${Math.min(100, m.loadPct)}%` }}
                          />
                        </div>

                        <div className="mt-2 pt-1 border-t border-slate-200/50 flex items-center justify-between text-[10px] font-extrabold text-blue-700 group-hover:text-blue-800">
                          <span>⚡ Xem chi tiết &amp; xử lý</span>
                          <ArrowRight className="h-3 w-3 text-blue-600 transition-transform group-hover:translate-x-0.5" />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* RIGHT COLUMN IN ALL_ZONES (OR DEDICATED SLIDE IN CAROUSEL) */}
          {(showZone2 || showZone3) && (
            <div
              className={`flex flex-col gap-3.5 ${
                displayMode === 'ALL_ZONES' ? 'xl:col-span-5' : ''
              }`}
            >
              {/* ZONE 2: URGENT & OVERDUE PURCHASE ORDERS */}
              {showZone2 && (
                <section
                  aria-label="Cảnh báo đơn hàng PO gấp"
                  className="rounded-2xl border border-slate-200 bg-white/95 p-3.5 shadow-card"
                >
                  <div className="mb-2.5 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Activity className="h-5 w-5 text-amber-600" />
                      <h2 className="text-sm font-black uppercase tracking-wider text-slate-900 sm:text-base">
                        Vùng 2 · Đơn Hàng PO Khẩn &amp; Sắp Đến Hạn
                      </h2>
                    </div>
                    <Badge variant="warning">{urgentOrders.length} PO ưu tiên</Badge>
                  </div>

                  <div className="space-y-2">
                    {urgentOrders.slice(0, displayMode === 'ALL_ZONES' ? 6 : 12).map((po) => (
                      <div
                        key={po.poId}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedPo(po)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            setSelectedPo(po);
                          }
                        }}
                        title={`Bấm để xem chi tiết PO & giải quyết cho đơn ${po.poId}`}
                        className={`group rounded-xl border p-2.5 shadow-sm transition-all cursor-pointer hover:shadow-lg hover:border-blue-400 hover:-translate-y-0.5 active:scale-[0.99] ${
                          po.isOverdue
                            ? 'border-rose-300 bg-rose-50/50'
                            : 'border-slate-200 bg-white'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-1.5">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono-num text-xs font-black text-blue-700 group-hover:underline">
                              {po.poId}
                            </span>
                            <span className="text-xs font-bold text-slate-600">
                              · {po.customer}
                            </span>
                            {po.isOverdue && (
                              <span className="rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-black text-white">
                                QUÁ HẠN
                              </span>
                            )}
                          </div>
                          <span className="font-mono-num text-xs font-semibold text-slate-600">
                            Giao: {formatDateVn(po.dueDate)}
                          </span>
                        </div>

                        <div className="mt-1 truncate text-xs font-bold text-slate-900 sm:text-sm">
                          {po.productName}
                        </div>

                        <div className="mt-1.5 flex items-center gap-2.5">
                          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-200">
                            <div
                              className={`h-full rounded-full ${
                                po.progressPct >= 80
                                  ? 'bg-emerald-500'
                                  : po.isOverdue
                                    ? 'bg-rose-600'
                                    : 'bg-blue-600'
                              }`}
                              style={{ width: `${po.progressPct}%` }}
                            />
                          </div>
                          <span className="font-mono-num shrink-0 text-xs font-extrabold text-slate-800">
                            {po.finishedQty}/{po.qtyPo} SP ({po.progressPct}%)
                          </span>
                        </div>

                        <div className="mt-2 pt-1 border-t border-slate-200/50 flex items-center justify-between text-[11px] font-black text-blue-700 group-hover:text-blue-800">
                          <span>📦 Bấm mở PO &amp; đưa vào kế hoạch</span>
                          <ArrowRight className="h-3.5 w-3.5 text-blue-600 transition-transform group-hover:translate-x-0.5" />
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* ZONE 3: TOP WORKER STANDARD-HOUR LEADERBOARD (STRICT PRIVACY) */}
              {showZone3 && (
                <section
                  aria-label="Bảng vàng thi đua thợ xuất sắc"
                  className="rounded-2xl border border-slate-200 bg-white/95 p-3.5 shadow-card"
                >
                  <div className="mb-2.5 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Trophy className="h-5 w-5 text-amber-500" />
                      <h2 className="text-sm font-black uppercase tracking-wider text-slate-900 sm:text-base">
                        Vùng 3 · 🏆 Bảng Vàng Giờ Chuẩn Định Mức
                      </h2>
                    </div>
                    <Badge variant="info">Chỉ hiện Giờ ĐM &amp; % KPI</Badge>
                  </div>

                  <div className="space-y-2">
                    {leaderboard.slice(0, displayMode === 'ALL_ZONES' ? 6 : 10).map((lb) => {
                      const medal =
                        lb.rank === 1
                          ? '🥇'
                          : lb.rank === 2
                            ? '🥈'
                            : lb.rank === 3
                              ? '🥉'
                              : `#${lb.rank}`;
                      const rankBadgeCls =
                        lb.rank === 1
                          ? 'bg-amber-100 text-amber-800 border-amber-200'
                          : lb.rank === 2
                            ? 'bg-slate-200 text-slate-800 border-slate-300'
                            : lb.rank === 3
                              ? 'bg-orange-100 text-orange-800 border-orange-200'
                              : 'bg-slate-100 text-slate-700 border-slate-200';
                      const rowCls =
                        lb.rank === 1
                          ? 'border-amber-300 bg-amber-50/30 shadow-sm'
                          : lb.rank === 2
                            ? 'border-slate-300 bg-slate-50/70 shadow-sm'
                            : lb.rank === 3
                              ? 'border-orange-300 bg-orange-50/30 shadow-sm'
                              : 'border-slate-200 bg-white shadow-sm';

                      const matchedWorker = data?.workersStatus?.find(
                        (ws) => ws.workerId === lb.workerId || ws.name === lb.workerName
                      ) || {
                        workerId: lb.workerId,
                        name: lb.workerName,
                        role: 'Thợ tiện / phay CNC',
                        assignedShift: 'Ca 1' as const,
                        isCurrentShiftActive: true,
                        status: 'ACTIVE' as const,
                        statusLabel: `Hiệu suất ${lb.kpiPct}% (${lb.earnedStdHours}h ĐM)`,
                      };

                      return (
                        <div
                          key={lb.workerId}
                          data-testid={`leaderboard-row-${lb.workerId}`}
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedWorker(matchedWorker)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              setSelectedWorker(matchedWorker);
                            }
                          }}
                          title={`Bấm để xem chi tiết & giải quyết cho thợ ${lb.workerName}`}
                          className={`group flex items-center justify-between gap-3 rounded-xl border px-3 py-2 cursor-pointer hover:shadow-md hover:border-blue-400 hover:-translate-y-0.5 transition-all ${rowCls}`}
                        >
                          <div className="flex min-w-0 items-center gap-2.5">
                            <span
                              className={`font-mono-num inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-sm font-black ${rankBadgeCls}`}
                            >
                              {medal}
                            </span>
                            <div className="min-w-0">
                              <div className="truncate text-sm font-extrabold text-slate-900 group-hover:text-blue-700 transition-colors">
                                {lb.workerName}
                              </div>
                              <div className="font-mono-num text-[11px] font-medium text-slate-600">
                                {lb.workerId} · Sản lượng: {formatNumber(lb.okQtyTotal)} SP
                              </div>
                            </div>
                          </div>

                          <div className="flex shrink-0 items-center gap-2 text-right">
                            <div>
                              <div className="font-mono-num tabular-nums text-sm font-black text-emerald-700 sm:text-base">
                                {formatNumber(lb.earnedStdHours, 1)} giờ ĐM
                              </div>
                              <div className="font-mono-num text-[11px] font-bold text-blue-700">
                                Hiệu suất {lb.kpiPct}% ĐM
                              </div>
                            </div>
                            <Award className="h-5 w-5 text-amber-500" />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ==================== WORKER RESOLUTION MODAL ==================== */}
      <Modal
        open={Boolean(selectedWorker)}
        onClose={() => setSelectedWorker(null)}
        title={`Chi Tiết & Giải Quyết Thợ: ${selectedWorker?.name || ''}`}
        subtitle={`Mã NV: ${selectedWorker?.workerId || ''} · ${selectedWorker?.title || selectedWorker?.role || ''} · ${selectedWorker?.assignedShift || ''}`}
        maxWidthClass="max-w-2xl"
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2 w-full">
            <span className="text-xs text-slate-500 italic">Chọn hành động trực tiếp bên dưới để xử lý triệt để</span>
            <Button variant="ghost" onClick={() => setSelectedWorker(null)}>Đóng</Button>
          </div>
        }
      >
        {selectedWorker && (
          <div className="space-y-4 text-slate-800">
            {/* Status banner */}
            <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div>
                <span className="text-[11px] font-bold text-slate-500 uppercase">Trạng thái ca trực</span>
                <div className="text-base font-black text-slate-900 mt-0.5">
                  {selectedWorker.status === 'ACTIVE'
                    ? '🟢 Đang làm việc trong ca'
                    : selectedWorker.status === 'OVERTIME'
                    ? '🔥 Đang tăng cường tăng ca'
                    : selectedWorker.status === 'OFF'
                    ? '⚪ Báo nghỉ / Chưa gán máy'
                    : selectedWorker.status === 'SUPERVISOR'
                    ? '👔 Quản đốc điều hành sản xuất'
                    : '💤 Nghỉ ca theo lịch luân chuyển'}
                </div>
              </div>
              <span className="rounded-lg px-2.5 py-1 text-xs font-black bg-blue-100 text-blue-800 border border-blue-200">
                {selectedWorker.assignedShift}
              </span>
            </div>

            {/* Assignment Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 space-y-1">
                <div className="text-xs font-bold text-emerald-800 uppercase">⚙️ Máy gia công chính</div>
                <div className="text-sm font-black text-slate-900">
                  {selectedWorker.primaryMachine || 'Chưa gán máy chính'}
                </div>
              </div>

              <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 space-y-1">
                <div className="text-xs font-bold text-amber-800 uppercase">⭐ Ghép máy phụ (+0.33)</div>
                <div className="text-sm font-black text-slate-900">
                  {selectedWorker.secondaryMachine || 'Không ghép máy phụ'}
                </div>
              </div>
            </div>

            {/* Assigned Tasks */}
            <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
              <div className="text-xs font-black text-slate-700 uppercase border-b border-slate-100 pb-1">
                Nhiệm vụ sản xuất được giao hôm nay
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-slate-500">Sản phẩm / Bản vẽ:</span>
                  <div className="font-bold text-slate-900">{selectedWorker.productName || 'Chưa có phân công sản phẩm'}</div>
                </div>
                <div>
                  <span className="text-slate-500">Công đoạn / Nguyên công:</span>
                  <div className="font-bold text-slate-900">{selectedWorker.opName || '---'}</div>
                </div>
                <div>
                  <span className="text-slate-500">Kế hoạch ca:</span>
                  <div className="font-bold text-slate-900">
                    {selectedWorker.plannedQty !== undefined ? `${selectedWorker.plannedQty} SP` : '---'}
                  </div>
                </div>
                <div>
                  <span className="text-slate-500">Ghi chú phân công:</span>
                  <div className="font-bold text-slate-900">{selectedWorker.note || '---'}</div>
                </div>
              </div>
            </div>

            {/* 1-Click Resolution Actions */}
            <div className="space-y-2 pt-1">
              <div className="text-xs font-black text-slate-700 uppercase flex items-center gap-1.5">
                <Wrench className="h-4 w-4 text-blue-600" />
                <span>Giải pháp điều phối &amp; xử lý ngay:</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handleResolveWorkerSchedule(selectedWorker.name)}
                  className="flex items-center justify-between rounded-xl border border-blue-300 bg-blue-600 px-3.5 py-2.5 text-xs font-black text-white shadow-sm hover:bg-blue-700 active:scale-[0.99] transition-all"
                >
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    <span>Lập / Điều Chỉnh Kế Hoạch Cho Thợ</span>
                  </div>
                  <ArrowRight className="h-4 w-4" />
                </button>

                <button
                  type="button"
                  onClick={handleResolveWorkerQc}
                  className="flex items-center justify-between rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-xs font-black text-slate-800 shadow-sm hover:bg-slate-50 hover:border-slate-400 active:scale-[0.99] transition-all"
                >
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-slate-600" />
                    <span>Xem Nhật Ký Báo Cáo QC Của Thợ</span>
                  </div>
                  <ExternalLink className="h-4 w-4 text-slate-400" />
                </button>

                <button
                  type="button"
                  onClick={handleResolveWorkerPortal}
                  className="flex items-center justify-between rounded-xl border border-emerald-300 bg-emerald-50 px-3.5 py-2.5 text-xs font-black text-emerald-900 shadow-sm hover:bg-emerald-100 active:scale-[0.99] transition-all"
                >
                  <div className="flex items-center gap-2">
                    <Cpu className="h-4 w-4 text-emerald-600" />
                    <span>Mở Cổng Thợ Nhập Báo Cáo</span>
                  </div>
                  <ArrowRight className="h-4 w-4 text-emerald-700" />
                </button>

                <button
                  type="button"
                  onClick={() => handleResolveMachineCockpit()}
                  className="flex items-center justify-between rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-xs font-black text-amber-900 shadow-sm hover:bg-amber-100 active:scale-[0.99] transition-all"
                >
                  <div className="flex items-center gap-2">
                    <Flame className="h-4 w-4 text-amber-600" />
                    <span>Điều Độ &amp; Cân Bằng Tải Xưởng</span>
                  </div>
                  <ArrowRight className="h-4 w-4 text-amber-700" />
                </button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* ==================== MACHINE RESOLUTION MODAL ==================== */}
      <Modal
        open={Boolean(selectedMachine)}
        onClose={() => setSelectedMachine(null)}
        title={`Chi Tiết & Giải Quyết Máy: ${selectedMachine?.name || ''}`}
        subtitle={`Nhóm: ${selectedMachine?.group || ''} · Tải kế hoạch: ${selectedMachine?.loadPct || 0}% ${selectedMachine?.isBottleneck ? ' (Quá tải cổ chai)' : ''}`}
        maxWidthClass="max-w-2xl"
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2 w-full">
            <span className="text-xs text-slate-500 italic">Chọn hành động để xử lý triệt để sự cố hoặc điều phối máy</span>
            <Button variant="ghost" onClick={() => setSelectedMachine(null)}>Đóng</Button>
          </div>
        }
      >
        {selectedMachine && (() => {
          const vis = resolveMachineVisualState(selectedMachine);
          return (
            <div className="space-y-4 text-slate-800">
              {/* Status card */}
              <div className={`flex items-center justify-between rounded-xl border p-3 ${vis.cardCls}`}>
                <div>
                  <span className="text-[11px] font-bold text-slate-600 uppercase">Trạng thái vận hành</span>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-black ${vis.pillCls}`}>
                      <span className={`h-2.5 w-2.5 rounded-full ${vis.dotCls}`} />
                      {vis.badgeLabel}
                    </span>
                    {selectedMachine.isBottleneck && (
                      <span className="rounded bg-rose-600 px-2 py-0.5 text-xs font-black text-white">
                        🔥 Cổ chai quá tải ({selectedMachine.loadPct}%)
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-[11px] font-bold text-slate-500 uppercase">Tải kế hoạch</span>
                  <div className="font-mono-num text-xl font-black text-slate-900">{selectedMachine.loadPct}%</div>
                </div>
              </div>

              {/* Stop Reason Alert if stopped */}
              {selectedMachine.stopReason && (
                <div className="rounded-xl border-2 border-rose-300 bg-rose-50 p-3 space-y-1">
                  <div className="flex items-center gap-2 text-xs font-black text-rose-800 uppercase">
                    <AlertTriangle className="h-4 w-4 text-rose-600" />
                    <span>Cảnh báo sự cố / Dừng máy:</span>
                  </div>
                  <div className="text-sm font-bold text-rose-950">
                    {selectedMachine.stopReason}
                  </div>
                </div>
              )}

              {/* Current Operation details */}
              <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
                <div className="text-xs font-black text-slate-700 uppercase border-b border-slate-100 pb-1">
                  Đơn hàng &amp; Thợ đang phụ trách máy
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-slate-500">Lệnh SX / PO:</span>
                    <div className="font-mono font-bold text-blue-700">
                      {selectedMachine.currentPoId || 'Chưa gán đơn hàng'}
                    </div>
                  </div>
                  <div>
                    <span className="text-slate-500">Thợ vận hành:</span>
                    <div className="font-bold text-slate-900">
                      {selectedMachine.currentWorkerName ? `👷 ${selectedMachine.currentWorkerName}` : 'Chưa bố trí thợ'}
                      {selectedMachine.isDualMachine ? ' (⭐ Ghép máy phụ +0.33)' : ''}
                      {selectedMachine.isOvertime ? ` (🔥 Tăng ca ${selectedMachine.overtimeHours || ''}h)` : ''}
                    </div>
                  </div>
                  <div>
                    <span className="text-slate-500">Sản phẩm / Bản vẽ:</span>
                    <div className="font-bold text-slate-900">
                      {selectedMachine.currentProductName || '---'}
                    </div>
                  </div>
                  <div>
                    <span className="text-slate-500">Nguyên công / Bước:</span>
                    <div className="font-bold text-slate-900">
                      {selectedMachine.currentNcId || ''} {selectedMachine.currentOpName ? `· ${selectedMachine.currentOpName}` : '---'}
                    </div>
                  </div>
                </div>
              </div>

              {/* 1-Click Resolution Actions */}
              <div className="space-y-2 pt-1">
                <div className="text-xs font-black text-slate-700 uppercase flex items-center gap-1.5">
                  <Wrench className="h-4 w-4 text-blue-600" />
                  <span>Giải pháp điều phối &amp; khắc phục:</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => handleResolveMachineCockpit(selectedMachine.id)}
                    className="flex items-center justify-between rounded-xl border border-blue-300 bg-blue-600 px-3.5 py-2.5 text-xs font-black text-white shadow-sm hover:bg-blue-700 active:scale-[0.99] transition-all"
                  >
                    <div className="flex items-center gap-2">
                      <Cpu className="h-4 w-4" />
                      <span>Điều Độ &amp; Cân Bằng Tải Máy</span>
                    </div>
                    <ArrowRight className="h-4 w-4" />
                  </button>

                  <button
                    type="button"
                    onClick={() => handleResolveMachineSchedule(selectedMachine.currentWorkerName || selectedMachine.name)}
                    className="flex items-center justify-between rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-xs font-black text-slate-800 shadow-sm hover:bg-slate-50 hover:border-slate-400 active:scale-[0.99] transition-all"
                  >
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-slate-600" />
                      <span>Bố Trí / Sửa Kế Hoạch Cho Máy</span>
                    </div>
                    <ArrowRight className="h-4 w-4 text-slate-400" />
                  </button>

                  <button
                    type="button"
                    onClick={handleResolveWorkerPortal}
                    className="flex items-center justify-between rounded-xl border border-rose-300 bg-rose-50 px-3.5 py-2.5 text-xs font-black text-rose-900 shadow-sm hover:bg-rose-100 active:scale-[0.99] transition-all"
                  >
                    <div className="flex items-center gap-2">
                      <AlertOctagon className="h-4 w-4 text-rose-600" />
                      <span>Báo Cáo Dừng / Báo Sự Cố Máy</span>
                    </div>
                    <ArrowRight className="h-4 w-4 text-rose-700" />
                  </button>

                  {selectedMachine.currentPoId ? (
                    <button
                      type="button"
                      onClick={() => handleResolveMachinePo(selectedMachine.currentPoId!)}
                      className="flex items-center justify-between rounded-xl border border-emerald-300 bg-emerald-50 px-3.5 py-2.5 text-xs font-black text-emerald-900 shadow-sm hover:bg-emerald-100 active:scale-[0.99] transition-all"
                    >
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-emerald-600" />
                        <span>Vào Đơn Hàng PO ({selectedMachine.currentPoId})</span>
                      </div>
                      <ArrowRight className="h-4 w-4 text-emerald-700" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleResolvePoOrders('')}
                      className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs font-black text-slate-700 shadow-sm hover:bg-slate-100 active:scale-[0.99] transition-all"
                    >
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-slate-500" />
                        <span>Chọn Đơn PO Để Gán Vào Máy</span>
                      </div>
                      <ArrowRight className="h-4 w-4 text-slate-400" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* ==================== PO RESOLUTION MODAL ==================== */}
      <Modal
        open={Boolean(selectedPo)}
        onClose={() => setSelectedPo(null)}
        title={`Chi Tiết & Giải Quyết PO: ${selectedPo?.poId || ''}`}
        subtitle={`Khách hàng: ${selectedPo?.customer || ''} · Hạn giao: ${selectedPo ? formatDateVn(selectedPo.dueDate) : ''}`}
        maxWidthClass="max-w-2xl"
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2 w-full">
            <span className="text-xs text-slate-500 italic">Chọn hành động xử lý đơn hàng khẩn hoặc đưa vào sản xuất</span>
            <Button variant="ghost" onClick={() => setSelectedPo(null)}>Đóng</Button>
          </div>
        }
      >
        {selectedPo && (
          <div className="space-y-4 text-slate-800">
            {/* Overdue alert */}
            {selectedPo.isOverdue && (
              <div className="flex items-center justify-between rounded-xl border-2 border-rose-300 bg-rose-50 p-3">
                <div className="flex items-center gap-2 text-rose-800">
                  <AlertTriangle className="h-5 w-5 text-rose-600 shrink-0" />
                  <div className="text-sm font-black">CẢNH BÁO ĐƠN HÀNG QUÁ HẠN GIAO!</div>
                </div>
                <span className="rounded bg-rose-600 px-2 py-0.5 text-xs font-black text-white">
                  Hạn: {formatDateVn(selectedPo.dueDate)}
                </span>
              </div>
            )}

            {/* Product info */}
            <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
              <div className="text-xs font-black text-slate-700 uppercase border-b border-slate-100 pb-1">
                Thông tin sản phẩm &amp; Khách hàng
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-slate-500">Khách hàng:</span>
                  <div className="font-bold text-slate-900">{selectedPo.customer}</div>
                </div>
                <div>
                  <span className="text-slate-500">Hạn giao hàng:</span>
                  <div className="font-bold text-slate-900">{formatDateVn(selectedPo.dueDate)}</div>
                </div>
                <div className="sm:col-span-2">
                  <span className="text-slate-500">Chi tiết sản phẩm / Bản vẽ:</span>
                  <div className="font-bold text-slate-900 text-sm">{selectedPo.productName}</div>
                </div>
              </div>
            </div>

            {/* Progress & Quantities */}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
              <div className="flex justify-between items-center text-xs font-black text-slate-700 uppercase">
                <span>Tiến độ hoàn thành: {selectedPo.progressPct}%</span>
                <span className="font-mono-num">{selectedPo.finishedQty} / {selectedPo.qtyPo} SP</span>
              </div>
              <div className="h-3 w-full overflow-hidden rounded-full bg-slate-200">
                <div
                  className={`h-full rounded-full ${
                    selectedPo.progressPct >= 80
                      ? 'bg-emerald-500'
                      : selectedPo.isOverdue
                      ? 'bg-rose-600'
                      : 'bg-blue-600'
                  }`}
                  style={{ width: `${selectedPo.progressPct}%` }}
                />
              </div>
              <div className="grid grid-cols-3 gap-2 text-center text-xs pt-1">
                <div className="rounded-lg bg-white p-2 border border-slate-200">
                  <div className="text-slate-500">Tổng đặt</div>
                  <div className="font-mono-num font-black text-slate-900">{selectedPo.qtyPo}</div>
                </div>
                <div className="rounded-lg bg-emerald-50 p-2 border border-emerald-200">
                  <div className="text-emerald-700">Đã xong (OK)</div>
                  <div className="font-mono-num font-black text-emerald-800">{selectedPo.finishedQty}</div>
                </div>
                <div className="rounded-lg bg-rose-50 p-2 border border-rose-200">
                  <div className="text-rose-700">Còn thiếu</div>
                  <div className="font-mono-num font-black text-rose-800">{selectedPo.remainQty}</div>
                </div>
              </div>
            </div>

            {/* 1-Click Resolution Actions */}
            <div className="space-y-2 pt-1">
              <div className="text-xs font-black text-slate-700 uppercase flex items-center gap-1.5">
                <Wrench className="h-4 w-4 text-blue-600" />
                <span>Giải pháp xử lý đơn hàng:</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handleResolvePoOrders(selectedPo.poId)}
                  className="flex items-center justify-between rounded-xl border border-blue-300 bg-blue-600 px-3.5 py-2.5 text-xs font-black text-white shadow-sm hover:bg-blue-700 active:scale-[0.99] transition-all"
                >
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    <span>Vào Đơn Hàng PO &amp; In Phiếu QR</span>
                  </div>
                  <ArrowRight className="h-4 w-4" />
                </button>

                <button
                  type="button"
                  onClick={() => handleResolvePoSchedule(selectedPo.productName || selectedPo.poId)}
                  className="flex items-center justify-between rounded-xl border border-emerald-300 bg-emerald-50 px-3.5 py-2.5 text-xs font-black text-emerald-900 shadow-sm hover:bg-emerald-100 active:scale-[0.99] transition-all"
                >
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-emerald-600" />
                    <span>Ưu Tiên Đưa Vào Kế Hoạch Hôm Nay</span>
                  </div>
                  <ArrowRight className="h-4 w-4 text-emerald-700" />
                </button>

                <button
                  type="button"
                  onClick={() => handleResolvePoTrace(selectedPo.poId)}
                  className="flex items-center justify-between rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-xs font-black text-slate-800 shadow-sm hover:bg-slate-50 hover:border-slate-400 active:scale-[0.99] transition-all"
                >
                  <div className="flex items-center gap-2">
                    <ExternalLink className="h-4 w-4 text-slate-500" />
                    <span>Truy Vết Tiến Độ &amp; Nhật Ký Sản Xuất</span>
                  </div>
                  <ArrowRight className="h-4 w-4 text-slate-400" />
                </button>

                <button
                  type="button"
                  onClick={() => handleResolveMachineCockpit()}
                  className="flex items-center justify-between rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-xs font-black text-amber-900 shadow-sm hover:bg-amber-100 active:scale-[0.99] transition-all"
                >
                  <div className="flex items-center gap-2">
                    <Cpu className="h-4 w-4 text-amber-600" />
                    <span>Cân Bằng Tải Xưởng &amp; Bố Trí Máy</span>
                  </div>
                  <ArrowRight className="h-4 w-4 text-amber-700" />
                </button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* ==================== BOTTOM LIVE ALERT TICKER ==================== */}
      <footer className="sticky bottom-0 z-20 border-t border-slate-300 bg-white px-4 py-2.5 shadow-sm">
        <div className="mx-auto flex max-w-[1920px] items-center gap-3 overflow-hidden">
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-rose-600 px-2.5 py-1 text-xs font-black uppercase tracking-wider text-white">
            <AlertOctagon className="h-4 w-4" />
            ANDON LIVE
          </span>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-6 gap-y-1 text-xs font-bold text-slate-800 sm:text-sm">
            {tickerItems.map((msg, idx) => (
              <span key={idx} className="truncate">
                {msg}
              </span>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}

export default AndonTvBoard;
