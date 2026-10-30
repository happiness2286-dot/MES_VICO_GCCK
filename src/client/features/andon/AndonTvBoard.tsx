import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertOctagon,
  Award,
  Clock,
  Cpu,
  Flame,
  LayoutGrid,
  Maximize2,
  Minimize2,
  Pin,
  PlayCircle,
  RefreshCw,
  Trophy,
} from 'lucide-react';
import type { AndonLivePayload } from '@shared/types';
import { removeVietnameseTones } from '@shared/vnSearch';
import { apiClient } from '../../lib/apiClient';
import { getFallbackAndonLive } from '../../lib/clientFallbackStore';
import { formatDateVn, formatNumber } from '../../lib/formatters';
import { Badge } from '../../components/ui/IndustrialPrimitives';

type AndonDisplayMode = 'ALL_ZONES' | 'CAROUSEL';
type AndonSlideIndex = 0 | 1 | 2;

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
      badgeLabel: '🔴 DỪNG SỰ CỐ / HỎNG',
      cardCls: 'border-rose-200 border-l-4 border-l-rose-600 bg-rose-50/40 shadow-sm',
      pillCls: 'border-rose-200 bg-rose-100/80 text-rose-800',
      dotCls: 'bg-rose-600 animate-ping',
    };
  }

  return {
    badgeLabel: '⚪ ĐANG NGHỈ',
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

  const fetchAndon = useCallback(async (silent = true) => {
    if (!silent) setLoading(true);
    try {
      const payload = await apiClient.get<AndonLivePayload>('/andon/live', { timeoutMs: 9000 });
      setData(payload);
    } catch {
      // Keep last known live board on transient network hiccup
    } finally {
      setLoading(false);
    }
  }, []);

  // Poll /andon/live every 10s
  useEffect(() => {
    void fetchAndon(false);
    const pollId = window.setInterval(() => {
      void fetchAndon(true);
    }, 10000);
    return () => window.clearInterval(pollId);
  }, [fetchAndon]);

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
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs font-bold sm:text-sm">
              <span className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-blue-700">
                {shiftLabel}
              </span>
              <span className="font-mono-num text-slate-600">
                Ngày {formatDateVn(data?.vietnamDate)}
              </span>
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

            {/* Kiosk Controls */}
            <div className="flex flex-wrap items-center gap-1.5">
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
        {/* ==================== SUMMARY KPI STRIP ==================== */}
        <section
          aria-label="Tóm tắt trạng thái máy công cụ"
          className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5"
        >
          <div className="flex items-center justify-between rounded-xl border border-slate-200 border-l-4 border-l-emerald-500 bg-white px-3.5 py-2 shadow-sm">
            <div>
              <div className="text-[11px] font-bold uppercase text-slate-600">Đang chạy</div>
              <div className="text-xs font-semibold text-emerald-700">🟢 Hoạt động tốt</div>
            </div>
            <span className="font-mono-num text-2xl font-black text-emerald-700">
              {data?.summary?.runningCount ?? 0}
            </span>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-slate-200 border-l-4 border-l-amber-500 bg-white px-3.5 py-2 shadow-sm">
            <div>
              <div className="text-[11px] font-bold uppercase text-slate-600">Setup / Đo kiểm</div>
              <div className="text-xs font-semibold text-amber-800">🟡 Chuẩn bị gá</div>
            </div>
            <span className="font-mono-num text-2xl font-black text-amber-700">
              {data?.summary?.setupCount ?? 0}
            </span>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-slate-200 border-l-4 border-l-rose-600 bg-white px-3.5 py-2 shadow-sm">
            <div>
              <div className="text-[11px] font-bold uppercase text-slate-600">Sự cố / Dừng</div>
              <div className="text-xs font-semibold text-rose-700">🔴 Cần xử lý</div>
            </div>
            <span className="font-mono-num text-2xl font-black text-rose-700">
              {data?.summary?.stoppedCount ?? 0}
            </span>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-slate-200 border-l-4 border-l-violet-500 bg-white px-3.5 py-2 shadow-sm">
            <div>
              <div className="text-[11px] font-bold uppercase text-slate-600">Trong đó: Đêm / Chờ phôi</div>
              <div className="text-xs font-semibold text-violet-700">🟣 Lights-out</div>
            </div>
            <span className="font-mono-num text-2xl font-black text-violet-700">
              {lightsOutOrWaitCount}
            </span>
          </div>

          <div className="col-span-2 flex items-center justify-between rounded-xl border border-slate-200 border-l-4 border-l-slate-400 bg-white px-3.5 py-2 shadow-sm sm:col-span-1">
            <div>
              <div className="text-[11px] font-bold uppercase text-slate-600">Đang nghỉ</div>
              <div className="text-xs font-semibold text-slate-600">⚪ Chờ điều độ</div>
            </div>
            <span className="font-mono-num text-2xl font-black text-slate-700">
              {data?.summary?.idleCount ?? 0}
            </span>
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
                    Vùng 1 · Trạng Thái {machines.length} Máy Gia Công Cơ Khí
                  </h2>
                </div>

                {/* Color Legend */}
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold">
                  <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-700">
                    🟢 Chạy: {data?.summary?.runningCount ?? 0}
                  </span>
                  <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-800">
                    🟡 Setup: {data?.summary?.setupCount ?? 0}
                  </span>
                  <span className="rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 text-rose-700">
                    🔴 Sự cố: {data?.summary?.stoppedCount ?? 0}
                  </span>
                  <span className="rounded-md border border-violet-200 bg-violet-50 px-2 py-0.5 text-violet-700">
                    🟣 Chờ phôi / Đêm
                  </span>
                  <span className="rounded-md border border-slate-200 bg-slate-100 px-2 py-0.5 text-slate-700">
                    ⚪ Nghỉ: {data?.summary?.idleCount ?? 0}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {machines.map((m) => {
                  const vis = resolveMachineVisualState(m);
                  return (
                    <div
                      key={m.id}
                      data-testid={`andon-machine-${m.id}`}
                      className={`flex flex-col justify-between rounded-xl border p-2.5 transition-all ${vis.cardCls}`}
                    >
                      <div>
                        <div className="flex items-start justify-between gap-1.5">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-black text-slate-900">
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
                              <div className="truncate text-[11px] font-semibold text-slate-700">
                                👷 {m.currentWorkerName}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="mt-2 text-[11px] italic text-slate-500">
                            Sẵn sàng nhận lệnh điều độ
                          </div>
                        )}

                        {m.stopReason && m.status !== 'RUNNING' && (
                          <div className="mt-1.5 truncate rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-800">
                            ⚠️ {m.stopReason}
                          </div>
                        )}
                      </div>

                      {/* Load Bar */}
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
                        className={`rounded-xl border p-2.5 shadow-sm ${
                          po.isOverdue
                            ? 'border-rose-300 bg-rose-50/50'
                            : 'border-slate-200 bg-white'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-1.5">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono-num text-xs font-black text-blue-700">
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
                    {leaderboard.slice(0, displayMode === 'ALL_ZONES' ? 6 : 10).map((w) => {
                      const medal =
                        w.rank === 1
                          ? '🥇'
                          : w.rank === 2
                            ? '🥈'
                            : w.rank === 3
                              ? '🥉'
                              : `#${w.rank}`;
                      const rankBadgeCls =
                        w.rank === 1
                          ? 'bg-amber-100 text-amber-800 border-amber-200'
                          : w.rank === 2
                            ? 'bg-slate-200 text-slate-800 border-slate-300'
                            : w.rank === 3
                              ? 'bg-orange-100 text-orange-800 border-orange-200'
                              : 'bg-slate-100 text-slate-700 border-slate-200';
                      const rowCls =
                        w.rank === 1
                          ? 'border-amber-300 bg-amber-50/30 shadow-sm'
                          : w.rank === 2
                            ? 'border-slate-300 bg-slate-50/70 shadow-sm'
                            : w.rank === 3
                              ? 'border-orange-300 bg-orange-50/30 shadow-sm'
                              : 'border-slate-200 bg-white shadow-sm';

                      return (
                        <div
                          key={w.workerId}
                          data-testid={`leaderboard-row-${w.workerId}`}
                          className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2 ${rowCls}`}
                        >
                          <div className="flex min-w-0 items-center gap-2.5">
                            <span
                              className={`font-mono-num inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-sm font-black ${rankBadgeCls}`}
                            >
                              {medal}
                            </span>
                            <div className="min-w-0">
                              <div className="truncate text-sm font-extrabold text-slate-900">
                                {w.workerName}
                              </div>
                              <div className="font-mono-num text-[11px] font-medium text-slate-600">
                                {w.workerId} · Sản lượng: {formatNumber(w.okQtyTotal)} SP
                              </div>
                            </div>
                          </div>

                          <div className="flex shrink-0 items-center gap-2 text-right">
                            <div>
                              <div className="font-mono-num tabular-nums text-sm font-black text-emerald-700 sm:text-base">
                                {formatNumber(w.earnedStdHours, 1)} giờ ĐM
                              </div>
                              <div className="font-mono-num text-[11px] font-bold text-blue-700">
                                Hiệu suất {w.kpiPct}% ĐM
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
