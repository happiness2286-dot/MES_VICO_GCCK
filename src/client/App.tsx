import React, { Suspense, useEffect } from 'react';
import { ToastProvider } from './components/ui/IndustrialPrimitives';
import { AuthProvider, useAuth } from './context/AuthContext';
import { TopRoleBar } from './components/TopRoleBar';
import { navigateTo, useLocationPath } from './lib/navigation';
import { getTravelerPoIdFromLocation } from './lib/formatters';
import { AndonTvBoard } from './features/andon/AndonTvBoard';
import { JobTravelerPrint } from './features/print/JobTravelerPrint';
import { DailySchedulePrint } from './features/print/DailySchedulePrint';
import { WeeklyReportPrint } from './features/print/WeeklyReportPrint';
import { HandoverSlipPrint } from './features/print/HandoverSlipPrint';

const WorkerView = React.lazy(() =>
  import('./features/worker/WorkerPortal').then((m) => ({
    default: (m.WorkerPortal || (m as any).default) as React.ComponentType<any>,
  }))
);
const AdminView = React.lazy(() =>
  import('./features/admin/AdminPortal').then((m) => ({
    default: (m.AdminPortal || (m as any).default) as React.ComponentType<any>,
  }))
);

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('MES Client View Error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-[60vh] flex-col items-center justify-center p-6 text-center">
          <div className="max-w-md rounded-2xl border border-rose-200 bg-white p-6 shadow-sm">
            <div className="mb-3 text-3xl">⚠️</div>
            <h2 className="text-base font-bold text-slate-900">Không thể tải phân hệ MES</h2>
            <p className="mt-1 text-xs text-slate-600">
              {this.state.error?.message || 'Đã xảy ra sự cố trong quá trình nạp giao diện.'}
            </p>
            <div className="mt-4 flex justify-center gap-2">
              <button
                type="button"
                onClick={() => {
                  this.setState({ hasError: false, error: null });
                  window.location.reload();
                }}
                className="rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-bold text-white shadow hover:bg-blue-700"
              >
                🔄 Tải lại trang
              </button>
              <button
                type="button"
                onClick={() => {
                  this.setState({ hasError: false, error: null });
                  navigateTo('/worker');
                }}
                className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
              >
                Về cổng Công nhân
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function ShellRouter() {
  const pathname = useLocationPath();
  const { user, loading } = useAuth();

  // Strict role guard: Workers can only view worker portal
  useEffect(() => {
    if (!loading && user?.appRole === 'WORKER') {
      if (pathname.startsWith('/admin') || pathname.startsWith('/andon')) {
        navigateTo('/worker');
      }
    }
  }, [loading, user?.appRole, pathname]);

  useEffect(() => {
    if (pathname === '/') {
      const target =
        typeof window !== 'undefined' && window.innerWidth >= 1280
          ? (user?.appRole === 'WORKER' ? '/worker' : '/admin')
          : '/worker';
      navigateTo(target);
    }
  }, [pathname, user?.appRole]);

  let content: React.ReactNode;
  if (user?.appRole === 'WORKER' && (pathname.startsWith('/admin') || pathname.startsWith('/andon'))) {
    content = <WorkerView />;
  } else if (pathname.startsWith('/admin')) {
    content = <AdminView />;
  } else if (pathname.startsWith('/andon')) {
    content = <AndonTvBoard />;
  } else if (pathname.startsWith('/print/daily-schedule')) {
    content = <DailySchedulePrint />;
  } else if (pathname.startsWith('/print/weekly-report')) {
    content = <WeeklyReportPrint />;
  } else if (pathname.startsWith('/print/handover')) {
    content = <HandoverSlipPrint />;
  } else if (pathname.startsWith('/print/traveler')) {
    const poId = getTravelerPoIdFromLocation(pathname);
    content = <JobTravelerPrint poId={poId} />;
  } else {
    content = <WorkerView />;
  }

  return (
    <div className="min-h-screen w-full max-w-full bg-industrial-canvas text-slate-900">
      <TopRoleBar currentPath={pathname} />
      <ErrorBoundary>
        <Suspense
          fallback={
            <div className="flex min-h-[60vh] items-center justify-center px-4 text-sm font-semibold text-slate-600">
              Đang tải phân hệ MES...
            </div>
          }
        >
          {content}
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}

export function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <ShellRouter />
      </AuthProvider>
    </ToastProvider>
  );
}

export default App;
