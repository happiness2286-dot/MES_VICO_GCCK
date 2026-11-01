import React, { useEffect, useState } from 'react';
import {
  BookOpen,
  CalendarClock,
  ChevronUp,
  CloudOff,
  Factory,
  KeyRound,
  LogOut,
  MonitorPlay,
  Printer,
  Shield,
  Smartphone,
  UserCheck,
  Users,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Badge, useToast } from './ui/IndustrialPrimitives';
import { navigateTo } from '../lib/navigation';
import {
  flushOfflineOutbox,
  getOfflineOutbox,
  subscribeOfflineOutbox,
} from '../lib/offlineOutbox';
import { VicoLogo } from './VicoLogo';
import { SopTrainingModal } from './SopTrainingModal';

export interface TopRoleBarProps {
  currentPath: string;
}

export function TopRoleBar({ currentPath }: TopRoleBarProps) {
  const { user, authMode, quickSwitch, openPinModal, openChangePinModal, logout } = useAuth();
  const toast = useToast();
  const [collapsedKiosk, setCollapsedKiosk] = useState(false);
  const [outboxCount, setOutboxCount] = useState<number>(() => getOfflineOutbox().length);
  const [guideOpen, setGuideOpen] = useState(false);

  useEffect(() => {
    return subscribeOfflineOutbox((items) => setOutboxCount(items.length));
  }, []);

  const isAndon = currentPath.startsWith('/andon');

  if (isAndon && collapsedKiosk) {
    return (
      <div className="no-print fixed right-3 top-2 z-50">
        <button
          type="button"
          onClick={() => setCollapsedKiosk(false)}
          className="rounded-lg border border-slate-300 bg-white/95 px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-card backdrop-blur transition-colors hover:border-blue-500 hover:bg-slate-50 hover:text-blue-700"
        >
          Hiện thanh chuyển cổng
        </button>
      </div>
    );
  }

  const isWorker = user?.appRole === 'WORKER';
  const isAdmin = user?.appRole === 'ADMIN' || user?.appRole === 'DIRECTOR';
  const isLeaderOrQc = user?.appRole === 'SHIFT_LEADER' || user?.appRole === 'QC';

  const handleRoleNav = async (
    targetPath: string,
    targetWorkerId?: string,
    label?: string,
    targetTab?: string
  ) => {
    try {
      // 1. Worker is strictly restricted to Worker portal only!
      if (isWorker && targetPath !== '/worker' && !targetPath.startsWith('/print/')) {
        toast.warning('⚠️ Tài khoản Công nhân chỉ có quyền truy cập Cổng Báo Cáo Công Nhân.');
        navigateTo('/worker');
        return;
      }

      // 2. Immediately route so the UI switches with zero delay
      navigateTo(targetPath);
      if (targetTab) {
        window.dispatchEvent(
          new CustomEvent('gcck:navigate', { detail: { path: targetPath, tab: targetTab } })
        );
      }

      // 3. Seamlessly switch role only if completely unauthenticated
      if (!user && targetWorkerId) {
        try {
          await quickSwitch({ workerId: targetWorkerId });
        } catch (swErr) {
          console.warn('Quick switch fallback:', swErr);
        }
      }

      if (label) toast.info(`Đã chuyển sang ${label}`);
    } catch {
      navigateTo(targetPath);
    }
  };

  const isWorkerActive = currentPath === '/' || currentPath.startsWith('/worker');
  const isScheduleActive =
    currentPath.includes('daily_schedule') || currentPath.startsWith('/print/daily-schedule');
  const isAccountsActive =
    currentPath.startsWith('/admin') &&
    (currentPath.includes('tab=accounts') || currentPath.includes('tab=master&sub=WORKERS'));
  const isQcActive =
    currentPath.startsWith('/admin') &&
    (currentPath.includes('logs_qc') || currentPath.includes('tab=logs_qc')) &&
    !isScheduleActive &&
    !isAccountsActive;
  const isAdminActive =
    currentPath.startsWith('/admin') && !isQcActive && !isScheduleActive && !isAccountsActive;
  const isPrintActive = currentPath.startsWith('/print/') && !currentPath.startsWith('/print/daily-schedule');

  const pillCls = (active: boolean) =>
    `inline-flex min-h-[32px] items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs transition-all ${
      active
        ? 'bg-white text-blue-700 shadow-sm ring-1 ring-slate-200 font-bold'
        : 'text-slate-600 hover:bg-white/60 hover:text-slate-900 font-semibold'
    }`;

  return (
    <header className="no-print relative lg:sticky lg:top-0 z-40 w-full max-w-full border-b border-slate-200 bg-white/95 backdrop-blur shadow-sm">
      <div className="mx-auto flex w-full max-w-[1920px] flex-wrap lg:flex-nowrap lg:h-[52px] items-center justify-between gap-2 px-2.5 py-1.5 lg:py-0 sm:px-4">
        {/* Brand Identity */}
        <div className="flex min-w-0 items-center gap-2">
          <VicoLogo className="h-8 w-auto object-contain" />
          <div className="min-w-0">
            <div className="truncate text-sm font-extrabold tracking-tight text-slate-900">
              GCCK Thắng Lợi
            </div>
          </div>
        </div>

        {/* 1-Click Role & Shell Switcher */}
        <nav
          aria-label="Chuyển nhanh cổng giao diện"
          className="flex flex-wrap lg:flex-nowrap items-center gap-1 rounded-xl bg-slate-100 p-1"
        >
          {/* Worker Portal - Visible to everyone */}
          <button
            type="button"
            onClick={() =>
              void handleRoleNav(
                '/worker',
                user?.workerId || undefined,
                '📱 Cổng Công Nhân'
              )
            }
            className={pillCls(isWorkerActive)}
          >
            <Smartphone className="h-3.5 w-3.5 text-emerald-600" />
            <span>Công Nhân</span>
          </button>

          {/* Shift Leader & QC Portal - Only for Leader, QC, or Admin */}
          {!isWorker && (
            <button
              type="button"
              onClick={() => void handleRoleNav('/admin?tab=logs_qc', 'NV00266', '🔍 Tổ Trưởng / QC', 'logs_qc')}
              className={pillCls(isQcActive)}
            >
              <UserCheck className="h-3.5 w-3.5 text-amber-600" />
              <span>Tổ Trưởng / QC</span>
            </button>
          )}

          {/* Admin Portal - Only for Admin */}
          {isAdmin && (
            <>
              <button
                type="button"
                onClick={() => void handleRoleNav('/admin?tab=cockpit', 'NV00053', '🛡️ Quản Trị Admin', 'cockpit')}
                className={pillCls(isAdminActive)}
              >
                <Shield className="h-3.5 w-3.5 text-blue-600" />
                <span>Quản Trị Admin</span>
              </button>

              <button
                type="button"
                onClick={() => void handleRoleNav('/admin?tab=accounts', 'NV00053', '👥 Quản Lý Tài Khoản', 'accounts')}
                className={pillCls(isAccountsActive)}
              >
                <Users className="h-3.5 w-3.5 text-purple-600" />
                <span>Quản Lý Tài Khoản</span>
              </button>
            </>
          )}

          {/* TV Andon 55" - Only for Managers / Leaders */}
          {!isWorker && (
            <button
              type="button"
              onClick={() => void handleRoleNav('/andon', undefined, '📺 TV Andon 55"')}
              className={pillCls(isAndon)}
            >
              <MonitorPlay className="h-3.5 w-3.5 text-violet-600" />
              <span>TV Andon 55&quot;</span>
            </button>
          )}

          {/* Daily Schedule - Only for Managers / Leaders */}
          {!isWorker && (
            <button
              type="button"
              onClick={() => void handleRoleNav('/admin?tab=daily_schedule', 'NV00053', '📅 Kế Hoạch & Báo Cáo', 'daily_schedule')}
              className={pillCls(isScheduleActive)}
            >
              <CalendarClock className="h-3.5 w-3.5 text-blue-600" />
              <span>Kế Hoạch &amp; Tuần</span>
            </button>
          )}

          {/* Print Traveler QR - For Managers / Leaders */}
          {!isWorker && (
            <button
              type="button"
              onClick={() =>
                void handleRoleNav('/print/traveler/PO485-01', undefined, '🖨️ Phiếu Công Nghệ QR')
              }
              className={pillCls(isPrintActive)}
            >
              <Printer className="h-3.5 w-3.5 text-slate-500" />
              <span>Phiếu QR</span>
            </button>
          )}

          {/* SOP Guide - Available to everyone */}
          <button
            type="button"
            onClick={() => setGuideOpen(true)}
            className="inline-flex min-h-[32px] items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-800 shadow-2xs transition-all hover:bg-amber-100"
            title="Mở cẩm nang hướng dẫn thao tác & quy trình vận hành xưởng (SOP)"
          >
            <BookOpen className="h-3.5 w-3.5 text-amber-600" />
            <span>📖 Hướng Dẫn</span>
          </button>
        </nav>

        {/* Active User & PIN / Offline Sync Status */}
        <div className="flex flex-wrap lg:flex-nowrap items-center gap-1.5">
          {outboxCount > 0 && (
            <button
              type="button"
              onClick={() => void flushOfflineOutbox()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-800 transition-colors hover:bg-amber-100"
              title="Nhấn để đồng bộ ngay dữ liệu lưu tạm ngoại tuyến"
            >
              <CloudOff className="h-3.5 w-3.5 text-amber-600" />
              <span className="font-mono-num">Đang đồng bộ ({outboxCount})</span>
            </button>
          )}

          {user ? (
            <>
              <button
                type="button"
                onClick={() => openPinModal(user.workerId)}
                title="Chạm để chuyển sang tài khoản người khác"
                className="inline-flex min-h-[32px] max-w-[240px] items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-800 shadow-2xs transition-all hover:border-emerald-400 hover:bg-emerald-100 active:scale-95"
              >
                <span className="truncate">
                  {user.name} ({user.workerId})
                </span>
                <span className="shrink-0 text-[10px] font-semibold text-emerald-600 underline">
                  Đổi người
                </span>
              </button>

              <button
                type="button"
                onClick={openChangePinModal}
                className="inline-flex min-h-[32px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:border-blue-500 hover:text-blue-700"
                title="Đổi mật khẩu / PIN cá nhân"
              >
                <KeyRound className="h-3.5 w-3.5 text-blue-600" />
                <span>Đổi PIN</span>
              </button>

              <button
                type="button"
                onClick={() => void logout()}
                className="inline-flex min-h-[32px] items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-bold text-rose-700 shadow-2xs transition-colors hover:bg-rose-100"
                title="Đăng xuất khỏi thiết bị này"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>Thoát</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => openPinModal()}
              className="inline-flex min-h-[32px] items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1 text-xs font-bold text-white shadow-sm transition-colors hover:bg-blue-700"
            >
              <KeyRound className="h-3.5 w-3.5" />
              <span>Đăng nhập cá nhân</span>
            </button>
          )}

          {isAndon && (
            <button
              type="button"
              onClick={() => setCollapsedKiosk(true)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-600 shadow-sm transition-colors hover:border-slate-400 hover:bg-slate-50 hover:text-slate-900"
              title="Thu gọn thanh trên TV Kiosk"
            >
              <ChevronUp className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <SopTrainingModal open={guideOpen} onClose={() => setGuideOpen(false)} />
    </header>
  );
}
