import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { CheckCircle2, Delete, KeyRound, Lock, ShieldCheck, UserCheck } from 'lucide-react';
import type {
  AuthMode,
  AuthSessionResponse,
  AuthSessionUser,
  QuickSwitchProfile,
} from '@shared/types';
import { apiClient, setStoredAuthToken } from '../lib/apiClient';
import { getFallbackUser, setCustomPin } from '../lib/clientFallbackStore';
import { Button, Modal, useToast } from '../components/ui/IndustrialPrimitives';

const REMEMBERED_WORKER_KEY = 'GCCK_ACTIVE_WORKER_ID';

interface AuthContextValue {
  user: AuthSessionUser | null;
  authMode: AuthMode;
  loading: boolean;
  quickSwitchProfiles: QuickSwitchProfile[];
  loginWithPin: (workerIdOrUsername: string, pin: string) => Promise<AuthSessionUser>;
  changePin: (currentPin: string, newPin: string) => Promise<void>;
  quickSwitch: (params: { workerId?: string; role?: string }) => Promise<AuthSessionUser | null>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
  openPinModal: (preselectedWorkerId?: string) => void;
  closePinModal: () => void;
  openChangePinModal: () => void;
  closeChangePinModal: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthSessionUser | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>('DEMO_QUICK');
  const [quickSwitchProfiles, setQuickSwitchProfiles] = useState<QuickSwitchProfile[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [pinModalOpen, setPinModalOpen] = useState<boolean>(false);
  const [changePinModalOpen, setChangePinModalOpen] = useState<boolean>(false);
  const [preselectedId, setPreselectedId] = useState<string>('');
  const toast = useToast();

  const quickSwitch = useCallback(
    async (params: { workerId?: string; role?: string }): Promise<AuthSessionUser | null> => {
      try {
        const res = await apiClient.post<{
          token: string;
          user: AuthSessionUser;
          authMode: AuthMode;
        }>('/auth/quick-switch', params);
        if (res.token) setStoredAuthToken(res.token);
        setUser(res.user);
        setAuthMode(res.authMode);
        try {
          localStorage.setItem(REMEMBERED_WORKER_KEY, res.user.workerId);
        } catch {}
        return res.user;
      } catch (err) {
        console.warn('apiClient quick-switch error, using local fallback:', err);
        const targetId = params.workerId || (params.role === 'ADMIN' ? 'NV00053' : 'NV00266');
        const fallbackUser = getFallbackUser(targetId);
        setUser(fallbackUser);
        setAuthMode('DEMO_QUICK');
        try {
          localStorage.setItem(REMEMBERED_WORKER_KEY, fallbackUser.workerId);
        } catch {}
        return fallbackUser;
      }
    },
    []
  );

  const refreshSession = useCallback(async () => {
    try {
      const sess = await apiClient.get<AuthSessionResponse>('/auth/session');
      setAuthMode(sess.authMode);
      setQuickSwitchProfiles(sess.quickSwitchProfiles || []);

      if (sess.user) {
        setUser(sess.user);
        try {
          localStorage.setItem(REMEMBERED_WORKER_KEY, sess.user.workerId);
        } catch {}
      } else {
        const remembered = typeof window !== 'undefined' ? localStorage.getItem(REMEMBERED_WORKER_KEY) : null;
        if (remembered) {
          const fallbackUser = getFallbackUser(remembered);
          setUser(fallbackUser);
        } else if (sess.authMode === 'DEMO_QUICK') {
          const path =
            typeof window !== 'undefined'
              ? window.location.hash && window.location.hash.startsWith('#/')
                ? window.location.hash.slice(1)
                : window.location.pathname
              : '/worker';
          if (path.startsWith('/admin')) {
            const targetId = path.includes('logs_qc') ? 'NV00266' : 'NV00053';
            await quickSwitch({ workerId: targetId });
          } else if (!path.startsWith('/andon') && !path.startsWith('/print')) {
            await quickSwitch({ workerId: 'NV00214' });
          }
        } else {
          setUser(null);
        }
      }
    } catch {
      // Offline fallback keeps UI usable
      setAuthMode('DEMO_QUICK');
      const remembered = typeof window !== 'undefined' ? localStorage.getItem(REMEMBERED_WORKER_KEY) : null;
      if (remembered) {
        const fallbackUser = getFallbackUser(remembered);
        setUser(fallbackUser);
      } else {
        const path =
          typeof window !== 'undefined'
            ? window.location.hash && window.location.hash.startsWith('#/')
              ? window.location.hash.slice(1)
              : window.location.pathname
            : '/worker';
        if (path.startsWith('/admin')) {
          const targetId = path.includes('logs_qc') ? 'NV00266' : 'NV00053';
          await quickSwitch({ workerId: targetId });
        } else {
          await quickSwitch({ workerId: 'NV00214' });
        }
      }
    } finally {
      setLoading(false);
    }
  }, [quickSwitch]);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  const loginWithPin = useCallback(
    async (workerIdOrUsername: string, pin: string): Promise<AuthSessionUser> => {
      const res = await apiClient.post<{
        token: string;
        user: AuthSessionUser;
        authMode: AuthMode;
      }>('/auth/login', {
        workerId: workerIdOrUsername,
        pin,
      });
      if (res.token) setStoredAuthToken(res.token);
      try {
        localStorage.setItem(REMEMBERED_WORKER_KEY, res.user.workerId);
      } catch {}
      setUser(res.user);
      setAuthMode(res.authMode);
      setPinModalOpen(false);
      toast.success(`Xin chào ${res.user.name} (${res.user.title})`);
      return res.user;
    },
    [toast]
  );

  const changePin = useCallback(
    async (currentPin: string, newPin: string): Promise<void> => {
      if (!user) throw new Error('Vui lòng đăng nhập trước khi đổi mật khẩu.');
      await apiClient.post('/auth/change-pin', {
        workerId: user.workerId,
        currentPin,
        newPin,
      });
      setCustomPin(user.workerId, newPin);
      toast.success('Đã đổi mật khẩu thành công! Hãy ghi nhớ mật khẩu mới của bạn.');
      setChangePinModalOpen(false);
    },
    [user, toast]
  );

  const logout = useCallback(async () => {
    try {
      await apiClient.post('/auth/logout', {});
    } catch {
      // ignore
    }
    setStoredAuthToken(null);
    try {
      localStorage.removeItem(REMEMBERED_WORKER_KEY);
    } catch {}
    setUser(null);
    toast.info('Đã đăng xuất phiên làm việc.');
    setPinModalOpen(true);
  }, [toast]);

  const openPinModal = useCallback(
    (workerId?: string) => {
      setPreselectedId(workerId || user?.workerId || '');
      setPinModalOpen(true);
    },
    [user?.workerId]
  );

  const closePinModal = useCallback(() => setPinModalOpen(false), []);

  const openChangePinModal = useCallback(() => {
    setChangePinModalOpen(true);
  }, []);

  const closeChangePinModal = useCallback(() => {
    setChangePinModalOpen(false);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        authMode,
        loading,
        quickSwitchProfiles,
        loginWithPin,
        changePin,
        quickSwitch,
        logout,
        refreshSession,
        openPinModal,
        closePinModal,
        openChangePinModal,
        closeChangePinModal,
      }}
    >
      {children}
      <PinLoginModal
        open={pinModalOpen}
        onClose={closePinModal}
        initialWorkerId={preselectedId}
        onSubmit={loginWithPin}
      />
      <ChangePinModal
        open={changePinModalOpen}
        onClose={closeChangePinModal}
        currentUser={user}
        onSubmit={changePin}
      />
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}

// ==================== DEDICATED PERSONAL LOGIN MODAL ====================
interface PinLoginModalProps {
  open: boolean;
  onClose: () => void;
  initialWorkerId: string;
  onSubmit: (workerId: string, pin: string) => Promise<AuthSessionUser>;
}

export function PinLoginModal({
  open,
  onClose,
  initialWorkerId,
  onSubmit,
}: PinLoginModalProps) {
  const [workerId, setWorkerId] = useState(initialWorkerId || '');
  const [pin, setPin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errMsg, setErrMsg] = useState('');

  useEffect(() => {
    if (open) {
      setWorkerId(initialWorkerId || '');
      setPin('');
      setErrMsg('');
    }
  }, [open, initialWorkerId]);

  const appendDigit = (d: string) => {
    setErrMsg('');
    setPin((prev) => (prev.length < 16 ? prev + d : prev));
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!workerId.trim() || !pin.trim()) {
      setErrMsg('Vui lòng nhập Mã nhân viên / Tên đăng nhập và Mật khẩu.');
      return;
    }
    setSubmitting(true);
    setErrMsg('');
    try {
      await onSubmit(workerId.trim(), pin.trim());
    } catch (err: any) {
      setErrMsg(err?.message || 'Mã nhân viên hoặc mật khẩu không chính xác.');
    } finally {
      setSubmitting(false);
    }
  };

  const keypadDigits = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Đăng Nhập Tài Khoản Cá Nhân"
      subtitle="Mỗi người sử dụng tài khoản & mật khẩu riêng để bảo mật dữ liệu sản xuất và tiền công"
      maxWidthClass="max-w-md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-700">
            Mã nhân viên / Tên đăng nhập
          </label>
          <div className="relative">
            <UserCheck className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={workerId}
              onChange={(e) => {
                setErrMsg('');
                setWorkerId(e.target.value);
              }}
              placeholder="VD: NV00214 hoặc vanquynh, NV00053..."
              autoCapitalize="none"
              autoCorrect="off"
              className="min-h-[48px] w-full rounded-xl border border-slate-300 bg-white pl-10 pr-3 text-sm font-bold text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
            />
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            Nhập mã thẻ cá nhân (NV00xxx) hoặc tên tài khoản được xưởng cấp.
          </p>
        </div>

        <div>
          <label className="mb-1.5 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-700">
            <span>Mã PIN / Mật khẩu</span>
            <span className="text-[11px] font-normal normal-case text-slate-500">
              Mặc định: 1234
            </span>
          </label>

          <div className="relative">
            <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="password"
              value={pin}
              onChange={(e) => {
                setErrMsg('');
                setPin(e.target.value);
              }}
              placeholder="Nhập mã PIN hoặc mật khẩu..."
              className="font-mono-num min-h-[50px] w-full rounded-xl border border-slate-300 bg-white pl-10 pr-4 text-center text-lg font-bold tracking-[0.2em] text-slate-900 shadow-sm placeholder:tracking-normal placeholder:font-sans placeholder:text-sm placeholder:font-medium placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
            />
          </div>
        </div>

        {/* 56px Shopfloor Numeric Keypad for fast touchscreen PIN input */}
        <div className="grid grid-cols-3 gap-2">
          {keypadDigits.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => appendDigit(d)}
              className="font-mono-num flex h-12 min-h-[48px] items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-lg font-black text-slate-800 shadow-sm transition-all hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 active:scale-95"
            >
              {d}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setPin('')}
            className="flex h-12 min-h-[48px] items-center justify-center rounded-xl border border-amber-200 bg-amber-50 text-xs font-black text-amber-800 transition-all hover:border-amber-300 hover:bg-amber-100 active:scale-95"
          >
            XÓA
          </button>
          <button
            type="button"
            onClick={() => appendDigit('0')}
            className="font-mono-num flex h-12 min-h-[48px] items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-lg font-black text-slate-800 shadow-sm transition-all hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 active:scale-95"
          >
            0
          </button>
          <button
            type="button"
            onClick={() => setPin((p) => p.slice(0, -1))}
            className="flex h-12 min-h-[48px] items-center justify-center rounded-xl border border-slate-200 bg-slate-100 text-slate-700 transition-all hover:border-slate-300 hover:bg-slate-200 hover:text-slate-900 active:scale-95"
            aria-label="Xóa 1 ký tự"
          >
            <Delete className="h-4 w-4" />
          </button>
        </div>

        {errMsg && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
            {errMsg}
          </div>
        )}

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-600">
          💡 <span className="font-semibold text-slate-800">Lưu ý bảo mật:</span> Sau khi đăng nhập lần đầu, hãy dùng nút <span className="font-bold text-blue-700">"Đổi PIN / Mật khẩu"</span> để đổi sang mật khẩu riêng của bạn nhằm tránh người khác xem được tiền công.
        </div>

        <Button
          type="submit"
          variant="primary"
          size="touch"
          disabled={submitting}
          className="w-full"
        >
          <ShieldCheck className="h-5 w-5" />
          {submitting ? 'ĐANG XÁC THỰC...' : 'ĐĂNG NHẬP PHIÊN CÁ NHÂN'}
        </Button>
      </form>
    </Modal>
  );
}

// ==================== CHANGE PIN / PASSWORD MODAL ====================
interface ChangePinModalProps {
  open: boolean;
  onClose: () => void;
  currentUser: AuthSessionUser | null;
  onSubmit: (currentPin: string, newPin: string) => Promise<void>;
}

export function ChangePinModal({
  open,
  onClose,
  currentUser,
  onSubmit,
}: ChangePinModalProps) {
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errMsg, setErrMsg] = useState('');

  useEffect(() => {
    if (open) {
      setCurrentPin('');
      setNewPin('');
      setConfirmPin('');
      setErrMsg('');
    }
  }, [open]);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!currentPin.trim() || !newPin.trim()) {
      setErrMsg('Vui lòng nhập mật khẩu hiện tại và mật khẩu mới.');
      return;
    }
    if (newPin.trim().length < 4) {
      setErrMsg('Mật khẩu mới phải có tối thiểu 4 ký tự.');
      return;
    }
    if (newPin.trim() !== confirmPin.trim()) {
      setErrMsg('Xác nhận mật khẩu mới không khớp.');
      return;
    }

    setSubmitting(true);
    setErrMsg('');
    try {
      await onSubmit(currentPin.trim(), newPin.trim());
      onClose();
    } catch (err: any) {
      setErrMsg(err?.message || 'Mật khẩu hiện tại không chính xác.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Đổi Mã PIN / Mật Khẩu Cá Nhân"
      subtitle={`Tài khoản: ${currentUser?.name || 'Nhân sự'} (${currentUser?.workerId || '—'})`}
      maxWidthClass="max-w-md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-700">
            Mật khẩu / PIN hiện tại
          </label>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="password"
              value={currentPin}
              onChange={(e) => {
                setErrMsg('');
                setCurrentPin(e.target.value);
              }}
              placeholder="Nhập mật khẩu / PIN đang dùng (mặc định 1234)..."
              className="min-h-[48px] w-full rounded-xl border border-slate-300 bg-white pl-10 pr-3 text-sm font-bold text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
            />
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-700">
            Mật khẩu / PIN mới (Tối thiểu 4 ký tự)
          </label>
          <div className="relative">
            <KeyRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-blue-600" />
            <input
              type="password"
              value={newPin}
              onChange={(e) => {
                setErrMsg('');
                setNewPin(e.target.value);
              }}
              placeholder="Nhập mật khẩu mới của bạn..."
              className="min-h-[48px] w-full rounded-xl border border-slate-300 bg-white pl-10 pr-3 text-sm font-bold text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
            />
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-700">
            Xác nhận mật khẩu mới
          </label>
          <div className="relative">
            <CheckCircle2 className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-600" />
            <input
              type="password"
              value={confirmPin}
              onChange={(e) => {
                setErrMsg('');
                setConfirmPin(e.target.value);
              }}
              placeholder="Nhập lại mật khẩu mới để xác nhận..."
              className="min-h-[48px] w-full rounded-xl border border-slate-300 bg-white pl-10 pr-3 text-sm font-bold text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
            />
          </div>
        </div>

        {errMsg && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
            {errMsg}
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <Button
            type="button"
            variant="ghost"
            size="touch"
            onClick={onClose}
            className="flex-1"
          >
            Hủy bỏ
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="touch"
            disabled={submitting}
            className="flex-1"
          >
            <KeyRound className="h-4 w-4" />
            {submitting ? 'ĐANG LƯU...' : 'LƯU MẬT KHẨU MỚI'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
