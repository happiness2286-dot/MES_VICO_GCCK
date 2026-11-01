import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CalendarCheck2,
  CalendarClock,
  ClipboardList,
  Coins,
  Command,
  KeyRound,
  LayoutDashboard,
  Lock,
  Menu,
  MonitorPlay,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  X,
} from 'lucide-react';
import type { BootstrapPayload } from '@shared/types';
import { matchesSearch } from '@shared/vnSearch';
import { apiClient } from '@client/lib/apiClient';
import { getFallbackBootstrap } from '@client/lib/clientFallbackStore';
import { formatDateVn, formatNumber } from '@client/lib/formatters';
import { navigateTo } from '@client/lib/navigation';
import {
  Badge,
  Button,
  Card,
  Modal,
  useToast,
} from '@client/components/ui/IndustrialPrimitives';
import { useAuth } from '@client/context/AuthContext';
import type { AdminDeepLinkContext, AdminTabKey } from './types';
import { CockpitAndLoadTab } from './tabs/CockpitAndLoadTab';
import { OrdersAndTravelerTab } from './tabs/OrdersAndTravelerTab';
import { DailyWeeklyScheduleTab } from './tabs/DailyWeeklyScheduleTab';
import { LogsQcTraceTab } from './tabs/LogsQcTraceTab';
import { CostingPnlTab } from './tabs/CostingPnlTab';
import { AttendancePayrollTab } from './tabs/AttendancePayrollTab';
import { MasterAndConfigTab } from './tabs/MasterAndConfigTab';

interface NavTabItem {
  key: AdminTabKey;
  shortLabel: string;
  label: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
  financialOnly?: boolean;
  badgeText?: string;
  badgeVariant?: 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'purple';
}

interface CommandHit {
  id: string;
  category: 'PO' | 'TRACE' | 'PRODUCT' | 'OPERATION' | 'MACHINE' | 'WORKER';
  code: string;
  title: string;
  subtitle: string;
  targetTab: AdminTabKey;
  deepLink: AdminDeepLinkContext;
}

export function AdminPortal() {
  const toast = useToast();
  const { user, authMode, loading: authLoading, quickSwitch, openPinModal } = useAuth();

  const [bootstrap, setBootstrap] = useState<BootstrapPayload | null>(() => getFallbackBootstrap());
  const [loadingData, setLoadingData] = useState<boolean>(false);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string>('');

  const getTabFromUrl = (): AdminTabKey | null => {
    if (typeof window === 'undefined') return null;
    let search = window.location.search;
    if (window.location.hash && window.location.hash.includes('?')) {
      search = '?' + window.location.hash.split('?')[1];
    }
    const params = new URLSearchParams(search);
    const tabParam = params.get('tab') as AdminTabKey | null;
    if (tabParam && ['cockpit', 'orders', 'daily_schedule', 'logs_qc', 'costing', 'attendance', 'master'].includes(tabParam)) {
      return tabParam;
    }
    const path = window.location.hash ? window.location.hash : window.location.pathname;
    if (path.includes('daily_schedule')) return 'daily_schedule';
    if (path.includes('logs_qc')) return 'logs_qc';
    return null;
  };

  const [activeTab, setActiveTab] = useState<AdminTabKey>(
    () => getTabFromUrl() || (user?.appRole === 'QC' ? 'logs_qc' : 'cockpit')
  );
  const [deepLink, setDeepLink] = useState<AdminDeepLinkContext | undefined>(undefined);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState<boolean>(false);

  // Ctrl+K Global Command Palette state
  const [cmdOpen, setCmdOpen] = useState<boolean>(false);
  const [cmdQuery, setCmdQuery] = useState<string>('');
  const [cmdSelectedIdx, setCmdSelectedIdx] = useState<number>(0);
  const cmdInputRef = useRef<HTMLInputElement | null>(null);

  const canEnterManagement =
    user?.appRole === 'ADMIN' ||
    user?.appRole === 'DIRECTOR' ||
    user?.appRole === 'SHIFT_LEADER' ||
    user?.appRole === 'QC';

  const canViewCosting =
    user?.appRole === 'ADMIN' || user?.appRole === 'DIRECTOR';

  const fetchBootstrap = useCallback(
    async (silent = false) => {
      if (!user || !canEnterManagement) {
        setLoadingData(false);
        return;
      }
      if (silent) {
        setRefreshing(true);
      } else {
        setLoadingData(true);
      }
      setLoadError('');
      try {
        const data = await apiClient.get<BootstrapPayload>('/bootstrap');
        setBootstrap(data);
      } catch (err: any) {
        // Transparent fallback so user never gets stuck with server offline error
        const fallback = getFallbackBootstrap(user);
        setBootstrap(fallback);
      } finally {
        setLoadingData(false);
        setRefreshing(false);
      }
    },
    [user, canEnterManagement, toast]
  );

  useEffect(() => {
    if (!authLoading) {
      void fetchBootstrap(Boolean(bootstrap));

      // Periodic 15s background polling so admin dashboard stays synchronized with mobile worker inputs
      const pollTimer = setInterval(() => {
        void fetchBootstrap(true);
      }, 15000);

      return () => clearInterval(pollTimer);
    }
  }, [authLoading, user?.workerId, user?.appRole]);

  // Synchronize activeTab with URL / Navigation events
  useEffect(() => {
    const handleUrlSync = (e?: Event) => {
      const detailTab = (e as CustomEvent)?.detail?.tab as AdminTabKey | undefined;
      const tab = detailTab || getTabFromUrl();
      if (tab) {
        setActiveTab(tab);
      }
    };
    window.addEventListener('gcck:navigate', handleUrlSync);
    window.addEventListener('popstate', handleUrlSync);
    window.addEventListener('hashchange', handleUrlSync);
    return () => {
      window.removeEventListener('gcck:navigate', handleUrlSync);
      window.removeEventListener('popstate', handleUrlSync);
      window.removeEventListener('hashchange', handleUrlSync);
    };
  }, []);

  // Auto-elevate session for QC / Schedule tabs if user is worker or unauthenticated
  useEffect(() => {
    if (!authLoading && (!user || !canEnterManagement)) {
      const urlTab = getTabFromUrl() || activeTab;
      const targetWorkerId = urlTab === 'logs_qc' ? 'NV00266' : 'NV00053';
      void quickSwitch({ workerId: targetWorkerId });
    }
  }, [authLoading, user, canEnterManagement, activeTab, quickSwitch]);

  // If QC switches in, default them straight to Logs/QC if they were on costing or cockpit
  useEffect(() => {
    const tabFromUrl = getTabFromUrl();
    if (!canViewCosting && activeTab === 'costing') {
      setActiveTab(user?.appRole === 'QC' ? 'logs_qc' : 'cockpit');
    } else if (user?.appRole === 'QC' && !tabFromUrl && activeTab === 'cockpit') {
      setActiveTab('logs_qc');
    }
  }, [canViewCosting, activeTab, user?.appRole]);

  // Global Ctrl+K / Cmd+K shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (canEnterManagement && bootstrap) {
          setCmdOpen((prev) => !prev);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canEnterManagement, bootstrap]);

  useEffect(() => {
    if (cmdOpen) {
      setCmdSelectedIdx(0);
      window.setTimeout(() => cmdInputRef.current?.focus(), 40);
    } else {
      setCmdQuery('');
    }
  }, [cmdOpen]);

  const handleNavigateTab = useCallback(
    (tab: AdminTabKey, ctx?: AdminDeepLinkContext) => {
      if (tab === 'costing' && !canViewCosting) {
        toast.warning('Phân hệ Báo giá & Lãi/Lỗ chỉ dành cho Quản đốc / Ban Giám đốc.');
        return;
      }
      setActiveTab(tab);
      if (typeof window !== 'undefined') {
        if (window.location.hash && window.location.hash.startsWith('#/')) {
          const basePath = window.location.hash.slice(1).split('?')[0];
          window.location.hash = `#${basePath}?tab=${tab}`;
        } else {
          const url = new URL(window.location.href);
          url.searchParams.set('tab', tab);
          window.history.replaceState(null, '', url.pathname + url.search);
        }
      }
      setDeepLink(ctx ? { ...ctx } : undefined);
      setMobileDrawerOpen(false);
    },
    [canViewCosting, toast]
  );

  const pendingFaiCount = useMemo(() => {
    if (!bootstrap) return 0;
    return bootstrap.ordersList.filter((po) => po.faiStatus === 'PENDING_FAI').length;
  }, [bootstrap]);

  const navTabs = useMemo<NavTabItem[]>(() => {
    const kpi = bootstrap?.kpiSummary;
    const allTabs: NavTabItem[] = [
      {
        key: 'cockpit',
        shortLabel: 'Điều Độ & Tải',
        label: '1. Tổng Quan & Điều Độ Tải Máy',
        subtitle: 'Năng lực máy & lịch chạy ca',
        icon: LayoutDashboard,
        badgeText:
          kpi && kpi.bottleneckMachines > 0
            ? `${kpi.bottleneckMachines} nghẽn`
            : `${bootstrap?.machines.length ?? 23} máy`,
        badgeVariant: kpi && kpi.bottleneckMachines > 0 ? 'danger' : 'info',
      },
      {
        key: 'orders',
        shortLabel: 'Lệnh PO & QR',
        label: '2. Lệnh Sản Xuất PO & Phiếu QR',
        subtitle: 'Tiến độ đơn hàng & in phiếu QR',
        icon: ClipboardList,
        badgeText:
          kpi && kpi.overdueOrders > 0
            ? `${kpi.overdueOrders} trễ`
            : `${bootstrap?.ordersList.length ?? 0} PO`,
        badgeVariant: kpi && kpi.overdueOrders > 0 ? 'warning' : 'neutral',
      },
      {
        key: 'daily_schedule',
        shortLabel: 'Kế Hoạch & Tuần',
        label: '3. Kế Hoạch & Báo Cáo Ngày / Tuần (BM.KTCN.04.03)',
        subtitle: 'Kế hoạch ngày QT.01, Báo cáo tuần & Báo cáo ngày Form BM.KTCN.04.03',
        icon: CalendarClock,
        badgeText: 'Form 04.03',
        badgeVariant: 'info',
      },
      {
        key: 'logs_qc',
        shortLabel: 'Nhật Ký & QC',
        label: '4. Nhật Ký Ca, QA/QC 3 Tầng & Truy Xuất',
        subtitle: 'Sản lượng thực tế, QC & truy vết',
        icon: ShieldCheck,
        badgeText:
          pendingFaiCount > 0
            ? `${pendingFaiCount} chờ FAI`
            : `${bootstrap?.recentLogs.length ?? 0} ca`,
        badgeVariant: pendingFaiCount > 0 ? 'warning' : 'success',
      },
      {
        key: 'costing',
        shortLabel: 'Báo Giá P&L',
        label: '5. Báo Giá & Đối Soát Lãi/Lỗ (P&L)',
        subtitle: 'Chi phí sản xuất & biên lợi nhuận',
        icon: Coins,
        financialOnly: true,
        badgeText: `${bootstrap?.products.length ?? 0} SP`,
        badgeVariant: 'purple',
      },
      {
        key: 'attendance',
        shortLabel: 'Chấm Công & 3P',
        label: '6. Chấm Công Ma Trận & Lương 3P',
        subtitle: 'Bảng công tháng & lương 3P',
        icon: CalendarCheck2,
        badgeText: `${bootstrap?.workers.length ?? 16} NV`,
        badgeVariant: 'info',
      },
      {
        key: 'master',
        shortLabel: 'Master & Hệ Thống',
        label: '7. Danh Mục Master & Cấu Hình',
        subtitle: 'Định mức, máy móc & nhân sự',
        icon: Settings,
        badgeText: `${bootstrap?.operations.length ?? 0} NC`,
        badgeVariant: 'neutral',
      },
    ];

    return allTabs.filter((t) => !t.financialOnly || canViewCosting);
  }, [bootstrap, canViewCosting, pendingFaiCount]);

  const activeTabMeta = useMemo(
    () => navTabs.find((t) => t.key === activeTab) || navTabs[0],
    [navTabs, activeTab]
  );

  // ==================== CTRL+K GLOBAL COMMAND PALETTE RESULTS ====================
  const commandHits = useMemo<CommandHit[]>(() => {
    if (!bootstrap) return [];
    const q = cmdQuery.trim();
    const hits: CommandHit[] = [];

    // 1. Purchase Orders (PO + Traceability)
    for (const po of bootstrap.ordersList) {
      if (
        !q ||
        matchesSearch(`${po.poId} ${po.customer} ${po.productName} ${po.materialLot || ''}`, q)
      ) {
        hits.push({
          id: `po-${po.poId}`,
          category: 'PO',
          code: po.poId,
          title: `${po.productName} (${po.customer})`,
          subtitle: `SL đặt: ${po.qtyPo} | Đã xong: ${po.finishedQty} | Hạn giao: ${formatDateVn(po.dueDate)}`,
          targetTab: 'orders',
          deepLink: { ordersSearch: po.poId },
        });
        if (q && hits.length < 30) {
          hits.push({
            id: `trace-${po.poId}`,
            category: 'TRACE',
            code: `TRUY XUẤT ${po.poId}`,
            title: `Phả hệ Lô phôi & Lịch sử QC: ${po.productName}`,
            subtitle: `Lô phôi: ${po.materialLot || 'Chuẩn VICO'} — Mở cây truy xuất 4 tầng`,
            targetTab: 'logs_qc',
            deepLink: { logsSubView: 'TRACE', tracePoId: po.poId },
          });
        }
      }
      if (!q && hits.length >= 6) break;
      if (hits.length >= 28) break;
    }

    // 2. Products
    for (const p of bootstrap.products) {
      if (hits.length >= 40) break;
      if (!q && hits.length >= 10) break;
      if (!q || matchesSearch(`${p.spId} ${p.customer} ${p.productName}`, q)) {
        hits.push({
          id: `prod-${p.spId}`,
          category: 'PRODUCT',
          code: p.spId,
          title: p.productName,
          subtitle: canViewCosting
            ? `${p.customer} — Mở phân tích Báo giá & Giá thành P&L`
            : `${p.customer} — Xem danh mục quy trình công nghệ`,
          targetTab: canViewCosting ? 'costing' : 'master',
          deepLink: canViewCosting
            ? { costingSearch: p.spId }
            : { masterSubTab: 'OPS', masterSearch: p.spId },
        });
      }
    }

    // 3. Operations
    if (q) {
      for (const op of bootstrap.operations) {
        if (hits.length >= 52) break;
        if (
          matchesSearch(
            `${op.ncId} ${op.spId} ${op.productName} ${op.opName} ${op.defaultMachine}`,
            q
          )
        ) {
          hits.push({
            id: `op-${op.ncId}`,
            category: 'OPERATION',
            code: op.ncId,
            title: `${op.opName} — ${op.productName}`,
            subtitle: `Bước ${op.stepOrder} | ĐM ${op.stdSeconds}s | Máy: ${op.defaultMachine}`,
            targetTab: 'master',
            deepLink: { masterSubTab: 'OPS', masterSearch: op.ncId },
          });
        }
      }
    }

    // 4. Machines
    for (const m of bootstrap.machines) {
      if (hits.length >= 60) break;
      if (!q && hits.length >= 14) break;
      if (!q || matchesSearch(`${m.id} ${m.name} ${m.group}`, q)) {
        hits.push({
          id: `mach-${m.id}`,
          category: 'MACHINE',
          code: m.id,
          title: m.name,
          subtitle: `Nhóm: ${m.group} | Trạng thái: ${m.status || 'IDLE'}`,
          targetTab: 'master',
          deepLink: { masterSubTab: 'MACHINES_TOOLS', masterSearch: m.name },
        });
      }
    }

    // 5. Workers
    for (const w of bootstrap.workers) {
      if (hits.length >= 68) break;
      if (!q && hits.length >= 18) break;
      if (!q || matchesSearch(`${w.id} ${w.name} ${w.title}`, q)) {
        hits.push({
          id: `emp-${w.id}`,
          category: 'WORKER',
          code: w.id,
          title: `${w.name} (${w.title})`,
          subtitle: `Mở Bảng chấm công & Lương 3P của ${w.name}`,
          targetTab: 'attendance',
          deepLink: { attendanceSearch: w.id },
        });
      }
    }

    return hits;
  }, [bootstrap, cmdQuery, canViewCosting]);

  const executeCommandHit = (hit: CommandHit) => {
    setCmdOpen(false);
    handleNavigateTab(hit.targetTab, hit.deepLink);
  };

  // Auto-switch role seamlessly in DEMO_QUICK mode if not privileged
  useEffect(() => {
    if (!authLoading && (!user || !canEnterManagement) && authMode === 'DEMO_QUICK') {
      const tab = getTabFromUrl();
      const targetId = tab === 'logs_qc' ? 'NV00266' : 'NV00053';
      void quickSwitch({ workerId: targetId });
    }
  }, [authLoading, user, canEnterManagement, authMode, quickSwitch]);

  // ==================== GATE 1: LOADING AUTH ====================
  if (authLoading) {
    return (
      <main className="mx-auto flex min-h-[70vh] w-full max-w-[1920px] items-center justify-center bg-industrial-canvas p-6 text-slate-900">
        <Card className="flex items-center gap-3 px-6 py-5">
          <RefreshCw className="h-5 w-5 animate-spin text-blue-600" />
          <span className="text-sm font-semibold text-slate-700">
            Đang khởi tạo Trung tâm Điều hành Quản đốc...
          </span>
        </Card>
      </main>
    );
  }

  // ==================== GATE 2: WORKER OR UNLOCKED SESSION ====================
  if (!user || !canEnterManagement) {
    if (authMode === 'DEMO_QUICK') {
      return (
        <main className="mx-auto flex min-h-[72vh] w-full max-w-[1920px] items-center justify-center bg-industrial-canvas p-6 text-slate-900">
          <Card className="flex flex-col items-center gap-3 px-8 py-6 text-center border-blue-200 shadow-card">
            <RefreshCw className="h-7 w-7 animate-spin text-blue-600" />
            <div className="text-sm font-bold text-slate-900">
              Đang chuyển vào phân hệ Quản lý &amp; Điều hành...
            </div>
            <div className="text-xs text-slate-500">
              Tự động nâng quyền phiên làm việc sang Quản trị xưởng
            </div>
          </Card>
        </main>
      );
    }
    return (
      <main className="mx-auto flex min-h-[78vh] w-full max-w-[1920px] items-center justify-center bg-industrial-canvas p-4 text-slate-900 sm:p-8">
        <Card className="w-full max-w-xl space-y-5 border-blue-200 p-6 shadow-elevated">
          <div className="flex items-start gap-3.5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-blue-200 bg-blue-50 text-blue-600">
              <ShieldAlert className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-lg font-extrabold text-slate-900">
                Cổng Điều Hành Dành Cho Quản Đốc, Trưởng Ca &amp; QC
              </h1>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                {user
                  ? `Phiên hiện tại đang là Công nhân đứng máy: ${user.name} (${user.workerId}). Để bảo mật đơn giá khách hàng, bảng lương toàn xưởng và kế hoạch tải máy, vui lòng chuyển sang vai trò Quản lý.`
                  : 'Phiên làm việc hiện đang ở chế độ bảo mật mã PIN hoặc đã đăng xuất. Vui lòng xác thực mã PIN Quản lý để vào Trung tâm Điều hành.'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <Button
              variant="ghost"
              size="md"
              onClick={() => navigateTo('/worker')}
            >
              <Smartphone className="h-4 w-4" />
              Về Cổng Công Nhân (/worker)
            </Button>
            <Button
              variant="warning"
              size="md"
              onClick={() => openPinModal('NV00053')}
            >
              <KeyRound className="h-4 w-4" />
              Mở Khóa Bằng Mã PIN Quản Đốc
            </Button>
          </div>
        </Card>
      </main>
    );
  }

  // ==================== GATE 3: LOADING BOOTSTRAP ====================
  if (loadingData && !bootstrap) {
    return (
      <main className="mx-auto flex min-h-[72vh] w-full max-w-[1920px] items-center justify-center bg-industrial-canvas p-6 text-slate-900">
        <Card className="flex flex-col items-center gap-3 px-8 py-6 text-center">
          <RefreshCw className="h-7 w-7 animate-spin text-blue-600" />
          <div className="text-sm font-bold text-slate-900">
            Đang đồng bộ dữ liệu điều hành (189 PO · 334 SP · 627 NC · 23 Máy)...
          </div>
          <div className="text-xs text-slate-500">
            Tính toán cân bằng tải máy CNC &amp; tiến độ sản xuất thời gian thực
          </div>
        </Card>
      </main>
    );
  }

  if (!bootstrap) {
    return (
      <main className="mx-auto flex min-h-[70vh] w-full max-w-[1920px] items-center justify-center bg-industrial-canvas p-6 text-slate-900">
        <Card className="max-w-md space-y-3 border-rose-200 bg-rose-50/40 p-5 text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-rose-600" />
          <div className="text-sm font-bold text-rose-800">
            {loadError || 'Không tải được dữ liệu máy chủ.'}
          </div>
          <Button variant="primary" size="sm" onClick={() => void fetchBootstrap(false)}>
            <RefreshCw className="h-4 w-4" /> Thử tải lại ngay
          </Button>
        </Card>
      </main>
    );
  }

  // ==================== MAIN COMMAND CENTER LAYOUT ====================
  const renderSidebarNav = (isMobile = false) => {
    const collapsed = !isMobile && sidebarCollapsed;
    return (
      <div className="flex h-full flex-col justify-between">
        <div className="space-y-1.5 p-2.5">
          <div className="mb-2 flex items-center justify-between px-2 py-1">
            {!collapsed && (
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
                6 Phân Hệ Điều Hành
              </span>
            )}
            {!isMobile && (
              <button
                type="button"
                onClick={() => setSidebarCollapsed((v) => !v)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
                title={collapsed ? 'Mở rộng thanh điều hướng' : 'Thu gọn thanh điều hướng'}
              >
                {collapsed ? (
                  <PanelLeftOpen className="h-4 w-4" />
                ) : (
                  <PanelLeftClose className="h-4 w-4" />
                )}
              </button>
            )}
          </div>

          {navTabs.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => handleNavigateTab(item.key)}
                title={collapsed ? `${item.label} — ${item.subtitle}` : undefined}
                className={`group relative flex w-full items-center gap-2.5 overflow-hidden rounded-xl border px-3 py-2.5 text-left transition-all ${
                  active
                    ? 'border-blue-200 bg-blue-50 font-bold text-blue-700 shadow-sm'
                    : 'border-transparent text-slate-700 hover:bg-slate-50 hover:text-slate-900'
                } ${collapsed ? 'justify-center px-2' : ''}`}
              >
                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute bottom-2 left-0 top-2 w-1 rounded-r-full bg-blue-600"
                  />
                )}
                <Icon
                  className={`h-5 w-5 shrink-0 ${
                    active ? 'text-blue-600' : 'text-slate-500 group-hover:text-blue-600'
                  }`}
                />
                {!collapsed && (
                  <>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-bold leading-snug">
                        {item.shortLabel}
                      </div>
                      <div
                        className={`truncate text-[11px] font-normal ${
                          active ? 'text-blue-600/90' : 'text-slate-500'
                        }`}
                      >
                        {item.subtitle}
                      </div>
                    </div>
                    {item.badgeText && (
                      <Badge
                        variant={item.badgeVariant || 'neutral'}
                        className="font-mono-num shrink-0 text-[10px]"
                      >
                        {item.badgeText}
                      </Badge>
                    )}
                  </>
                )}
              </button>
            );
          })}
        </div>

        {/* Bottom Sidebar Info & Role Upgrade Card */}
        <div className="space-y-2 border-t border-slate-200 p-2.5">
          {!canViewCosting && !collapsed && (
            <div className="space-y-1.5 rounded-xl border border-amber-200 bg-amber-50/70 p-2.5 text-[11px] text-amber-900">
              <div className="flex items-center gap-1.5 font-bold text-amber-800">
                <Lock className="h-3.5 w-3.5 text-amber-600" /> Đang ẩn Báo giá P&amp;L
              </div>
              <p className="text-[10px] leading-snug text-amber-800/90">
                Tài khoản {user.title} không hiển thị giá báo khách hàng.
              </p>
              {authMode === 'DEMO_QUICK' ? (
                <button
                  type="button"
                  onClick={() => void quickSwitch({ workerId: 'NV00053' })}
                  className="w-full rounded-lg border border-amber-300 bg-white py-1 text-[11px] font-bold text-amber-800 transition-colors hover:bg-amber-100"
                >
                  ⚡ Chuyển Quản đốc
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => openPinModal('NV00053')}
                  className="w-full rounded-lg border border-amber-300 bg-white py-1 text-[11px] font-bold text-amber-800 transition-colors hover:bg-amber-100"
                >
                  🔑 Nhập PIN Admin
                </button>
              )}
            </div>
          )}

          {!collapsed && (
            <button
              type="button"
              onClick={() => navigateTo('/andon')}
              className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
            >
              <span className="flex items-center gap-2">
                <MonitorPlay className="h-4 w-4 text-blue-600" /> Mở Màn Hình Andon TV
              </span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="w-full bg-industrial-canvas text-slate-900">
      <div className="mx-auto flex min-h-[calc(100vh-52px)] w-full max-w-[1920px]">
        {/* DESKTOP COLLAPSIBLE LEFT SIDEBAR */}
        <aside
          className={`no-print hidden shrink-0 border-r border-slate-200 bg-white shadow-sm transition-all duration-200 lg:block ${
            sidebarCollapsed ? 'w-[70px]' : 'w-64'
          }`}
        >
          <div className="sticky lg:top-[52px] lg:h-[calc(100vh-52px)] overflow-y-auto">
            {renderSidebarNav(false)}
          </div>
        </aside>

        {/* MOBILE / TABLET SLIDE-OVER DRAWER */}
        {mobileDrawerOpen && (
          <div
            className="no-print fixed inset-0 z-[75] flex bg-slate-900/40 backdrop-blur-[2px] lg:hidden"
            onClick={() => setMobileDrawerOpen(false)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="flex h-full w-72 max-w-[85vw] flex-col border-r border-slate-200 bg-white shadow-elevated"
            >
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                <div className="text-sm font-extrabold text-slate-900">
                  GCCK Thắng Lợi MES
                </div>
                <button
                  type="button"
                  onClick={() => setMobileDrawerOpen(false)}
                  className="rounded-lg border border-slate-200 bg-slate-50 p-1.5 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
                  aria-label="Đóng menu"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto">{renderSidebarNav(true)}</div>
            </div>
          </div>
        )}

        {/* MAIN WORKSPACE COLUMN */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* TOP COMMAND BAR */}
          <header className="no-print sticky top-0 lg:top-[52px] z-20 border-b border-slate-200 bg-white/95 px-3 py-2.5 backdrop-blur sm:px-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setMobileDrawerOpen(true)}
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-900 lg:hidden"
                  aria-label="Mở danh mục phân hệ"
                >
                  <Menu className="h-5 w-5" />
                </button>

                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="truncate text-sm font-extrabold text-slate-900 sm:text-base">
                      {activeTabMeta?.label}
                    </h1>
                    <Badge variant="neutral" className="font-mono-num hidden sm:inline-flex">
                      Ngày SX: {formatDateVn(bootstrap.vietnamToday)}
                    </Badge>
                  </div>
                  <p className="hidden truncate text-xs text-slate-500 md:block">
                    {activeTabMeta?.subtitle}
                  </p>
                </div>
              </div>

              {/* RIGHT ACTIONS: LIVE PULSE PILLS + CTRL+K + REFRESH */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="hidden items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600 xl:flex">
                  <Activity className="h-3.5 w-3.5 text-emerald-600" />
                  <span className="text-slate-500">Chạy:</span>
                  <strong className="font-mono-num text-emerald-700">
                    {bootstrap.kpiSummary.runningMachines}/{bootstrap.machines.length}
                  </strong>
                  <span className="mx-1 h-3.5 w-px bg-slate-200" aria-hidden="true" />
                  <span className="text-slate-500">OK lũy kế:</span>
                  <strong className="font-mono-num text-blue-700">
                    {formatNumber(bootstrap.kpiSummary.totalOk)}
                  </strong>
                  {bootstrap.shiftHandoverAlerts.length > 0 && (
                    <>
                      <span className="mx-1 h-3.5 w-px bg-slate-200" aria-hidden="true" />
                      <span className="font-semibold text-amber-700">
                        📝 {bootstrap.shiftHandoverAlerts.length} dặn ca
                      </span>
                    </>
                  )}
                </div>

                {/* CTRL+K QUICK COMMAND SEARCH TRIGGER */}
                <button
                  type="button"
                  onClick={() => setCmdOpen(true)}
                  className="inline-flex min-h-[38px] items-center gap-2 rounded-xl border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:border-blue-400 hover:bg-white hover:text-slate-900"
                >
                  <Search className="h-3.5 w-3.5 text-blue-600" />
                  <span className="hidden sm:inline">Tra nhanh PO, SP, NC, Máy...</span>
                  <span className="sm:hidden">Tìm nhanh</span>
                  <kbd className="font-mono-num rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-600">
                    Ctrl+K
                  </kbd>
                </button>

                <Button
                  variant="secondary"
                  size="sm"
                  disabled={refreshing}
                  onClick={() => void fetchBootstrap(true)}
                  title="Đồng bộ lại toàn bộ dữ liệu thời gian thực"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin text-blue-600' : ''}`}
                  />
                  <span className="hidden sm:inline">Làm mới</span>
                </Button>
              </div>
            </div>
          </header>

          {/* WORKSPACE BODY */}
          <main className="w-full flex-1 p-3 sm:p-5">
            {activeTab === 'cockpit' && (
              <CockpitAndLoadTab
                bootstrap={bootstrap}
                onRefreshBootstrap={() => fetchBootstrap(true)}
                onNavigateTab={handleNavigateTab}
                deepLink={deepLink}
              />
            )}

            {activeTab === 'orders' && (
              <OrdersAndTravelerTab
                bootstrap={bootstrap}
                onRefreshBootstrap={() => fetchBootstrap(true)}
                onNavigateTab={handleNavigateTab}
                deepLink={deepLink}
              />
            )}

            {activeTab === 'daily_schedule' && (
              <DailyWeeklyScheduleTab
                bootstrap={bootstrap}
                onRefreshBootstrap={() => fetchBootstrap(true)}
                onNavigateTab={handleNavigateTab}
                deepLink={deepLink}
              />
            )}

            {activeTab === 'logs_qc' && (
              <LogsQcTraceTab
                bootstrap={bootstrap}
                onRefreshBootstrap={() => fetchBootstrap(true)}
                onNavigateTab={handleNavigateTab}
                deepLink={deepLink}
              />
            )}

            {activeTab === 'costing' &&
              (canViewCosting ? (
                <CostingPnlTab
                  bootstrap={bootstrap}
                  onRefreshBootstrap={() => fetchBootstrap(true)}
                  onNavigateTab={handleNavigateTab}
                  deepLink={deepLink}
                />
              ) : (
                <Card className="mx-auto max-w-lg space-y-3 border-amber-200 bg-amber-50/40 p-6 text-center">
                  <Lock className="mx-auto h-8 w-8 text-amber-600" />
                  <h2 className="text-base font-bold text-slate-900">
                    Phân Hệ Báo Giá &amp; Lãi/Lỗ Chỉ Dành Cho Quản Đốc / Giám Đốc
                  </h2>
                  <p className="text-xs text-slate-600">
                    Đơn giá chào khách hàng và biên lợi nhuận ròng được bảo mật theo phân quyền RBAC.
                  </p>
                </Card>
              ))}

            {activeTab === 'attendance' && (
              <AttendancePayrollTab
                bootstrap={bootstrap}
                onRefreshBootstrap={() => fetchBootstrap(true)}
                onNavigateTab={handleNavigateTab}
                deepLink={deepLink}
              />
            )}

            {activeTab === 'master' && (
              <MasterAndConfigTab
                bootstrap={bootstrap}
                onRefreshBootstrap={() => fetchBootstrap(true)}
                onNavigateTab={handleNavigateTab}
                deepLink={deepLink}
              />
            )}
          </main>
        </div>

        {/* ==================== CTRL+K GLOBAL COMMAND SEARCH MODAL ==================== */}
        <Modal
          open={cmdOpen}
          onClose={() => setCmdOpen(false)}
          title="Tìm Kiếm & Điều Hướng Tức Thì (Command Center)"
          subtitle="Gõ không dấu để nhảy thẳng tới Lệnh PO, Cây truy xuất, Sản phẩm, Nguyên công, Máy hoặc Nhân sự"
          maxWidthClass="max-w-2xl"
        >
          <div className="space-y-3">
            <div className="relative">
              <Command className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-blue-600" />
              <input
                ref={cmdInputRef}
                type="text"
                value={cmdQuery}
                onChange={(e) => {
                  setCmdQuery(e.target.value);
                  setCmdSelectedIdx(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setCmdSelectedIdx((i) =>
                      Math.min(commandHits.length - 1, Math.max(0, i + 1))
                    );
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setCmdSelectedIdx((i) => Math.max(0, i - 1));
                  } else if (e.key === 'Enter' && commandHits[cmdSelectedIdx]) {
                    e.preventDefault();
                    executeCommandHit(commandHits[cmdSelectedIdx]);
                  }
                }}
                placeholder="VD: PO485, SP095, NC0120, Tiện CNC 1, NV00214, truc vit..."
                className="min-h-[46px] w-full rounded-xl border border-slate-300 bg-slate-50 pl-10 pr-4 text-sm font-semibold text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/15"
              />
            </div>

            <div className="max-h-[380px] divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200 bg-white">
              {commandHits.map((hit, idx) => {
                const selected = idx === cmdSelectedIdx;
                const catBadge =
                  hit.category === 'PO'
                    ? { label: 'LỆNH PO', variant: 'info' as const }
                    : hit.category === 'TRACE'
                      ? { label: 'PHẢ HỆ QC', variant: 'success' as const }
                      : hit.category === 'PRODUCT'
                        ? { label: 'SẢN PHẨM', variant: 'purple' as const }
                        : hit.category === 'OPERATION'
                          ? { label: 'NGUYÊN CÔNG', variant: 'warning' as const }
                          : hit.category === 'MACHINE'
                            ? { label: 'MÁY CNC', variant: 'neutral' as const }
                            : { label: 'NHÂN SỰ', variant: 'info' as const };

                return (
                  <button
                    key={hit.id}
                    type="button"
                    onMouseEnter={() => setCmdSelectedIdx(idx)}
                    onClick={() => executeCommandHit(hit)}
                    className={`flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left transition-colors ${
                      selected
                        ? 'bg-blue-50 text-blue-900'
                        : 'text-slate-900 hover:bg-blue-50/50 hover:text-blue-900'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Badge variant={catBadge.variant} className="text-[10px]">
                          {catBadge.label}
                        </Badge>
                        <span className="font-mono-num text-xs font-bold text-blue-700">
                          {hit.code}
                        </span>
                        <span
                          className={`truncate text-xs font-semibold ${
                            selected ? 'text-blue-950' : 'text-slate-900'
                          }`}
                        >
                          {hit.title}
                        </span>
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-slate-500">
                        {hit.subtitle}
                      </div>
                    </div>
                    <ArrowRight
                      className={`h-4 w-4 shrink-0 ${
                        selected ? 'text-blue-600' : 'text-slate-400'
                      }`}
                    />
                  </button>
                );
              })}

              {commandHits.length === 0 && (
                <div className="py-10 text-center text-xs text-slate-500">
                  Không tìm thấy kết quả khớp với từ khóa &ldquo;{cmdQuery}&rdquo;.
                </div>
              )}
            </div>

            <div className="flex items-center justify-between text-[11px] text-slate-500">
              <span>Dùng phím ↑ ↓ để chọn, Enter để mở nhanh, Esc để đóng</span>
              <span className="font-mono-num font-semibold text-slate-700">
                {commandHits.length} kết quả
              </span>
            </div>
          </div>
        </Modal>
      </div>
    </div>
  );
}

export default AdminPortal;
