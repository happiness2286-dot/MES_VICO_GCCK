import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Edit3,
  KeyRound,
  Lock,
  Plus,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Trash2,
  Unlock,
  UserCheck,
  Users,
} from 'lucide-react';
import type { AppRole, WorkerDto } from '@shared/types';
import { matchesSearch } from '@shared/vnSearch';
import { formatVnd } from '@client/lib/formatters';
import { apiClient } from '@client/lib/apiClient';
import { setCustomPin } from '@client/lib/clientFallbackStore';
import { useAuth } from '@client/context/AuthContext';
import {
  Badge,
  Button,
  Card,
  Modal,
  useToast,
} from '@client/components/ui/IndustrialPrimitives';
import type { AdminTabCommonProps } from '../types';

export function AccountManagementTab({
  bootstrap,
  onRefreshBootstrap,
  deepLink,
}: AdminTabCommonProps) {
  const toast = useToast();
  const { user, openPinModal } = useAuth();
  const isAdmin = user?.appRole === 'ADMIN' || user?.appRole === 'DIRECTOR';

  const [workers, setWorkers] = useState<WorkerDto[]>(bootstrap.workers || []);
  const [searchTerm, setSearchTerm] = useState(deepLink?.accountsSearch || '');
  const [roleFilter, setRoleFilter] = useState<'ALL' | 'ADMIN' | 'LEADER_QC' | 'WORKER' | 'LOCKED'>('ALL');

  // Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form Fields
  const [formId, setFormId] = useState('');
  const [formUsername, setFormUsername] = useState('');
  const [formName, setFormName] = useState('');
  const [formRole, setFormRole] = useState<'CN' | 'TC' | 'KT' | 'QĐ'>('CN');
  const [formTitle, setFormTitle] = useState('Công nhân đứng máy CNC');
  const [formSalaryMode, setFormSalaryMode] = useState<'Khoán 1 + 0.33 máy' | 'Hành chính (Tháng)'>('Khoán 1 + 0.33 máy');
  const [formBaseSalary, setFormBaseSalary] = useState(400000);
  const [formChatId, setFormChatId] = useState('');
  const [formPin, setFormPin] = useState('1234');

  // Reset PIN modal
  const [resetPinModalOpen, setResetPinModalOpen] = useState(false);
  const [resetPinTarget, setResetPinTarget] = useState<WorkerDto | null>(null);
  const [resetPinValue, setResetPinValue] = useState('1234');
  const [resettingPin, setResettingPin] = useState(false);

  // Sync when bootstrap updates
  React.useEffect(() => {
    setWorkers(bootstrap.workers || []);
  }, [bootstrap.workers]);

  // Statistics
  const stats = useMemo(() => {
    let adminCount = 0;
    let leaderQcCount = 0;
    let workerCount = 0;
    let lockedCount = 0;

    for (const w of workers) {
      if (w.isActive === 0) lockedCount++;
      if (w.appRole === 'ADMIN' || w.role === 'QĐ') adminCount++;
      else if (w.appRole === 'SHIFT_LEADER' || w.appRole === 'QC' || w.role === 'TC' || w.role === 'KT') leaderQcCount++;
      else workerCount++;
    }

    return {
      total: workers.length,
      admin: adminCount,
      leaderQc: leaderQcCount,
      worker: workerCount,
      locked: lockedCount,
    };
  }, [workers]);

  // Filtered list
  const filteredList = useMemo(() => {
    return workers.filter((w) => {
      // Role filter
      if (roleFilter === 'LOCKED' && w.isActive !== 0) return false;
      if (roleFilter === 'ADMIN' && !(w.appRole === 'ADMIN' || w.role === 'QĐ')) return false;
      if (
        roleFilter === 'LEADER_QC' &&
        !(w.appRole === 'SHIFT_LEADER' || w.appRole === 'QC' || w.role === 'TC' || w.role === 'KT')
      )
        return false;
      if (
        roleFilter === 'WORKER' &&
        (w.appRole === 'ADMIN' ||
          w.appRole === 'SHIFT_LEADER' ||
          w.appRole === 'QC' ||
          w.role === 'QĐ' ||
          w.role === 'TC' ||
          w.role === 'KT')
      )
        return false;

      // Search term
      if (searchTerm.trim()) {
        const text = `${w.id} ${w.name} ${w.username || ''} ${w.title || ''} ${w.role || ''} ${w.salaryMode || ''}`;
        if (!matchesSearch(text, searchTerm.trim())) return false;
      }

      return true;
    });
  }, [workers, roleFilter, searchTerm]);

  // Open Create Modal
  const handleOpenCreate = () => {
    setIsEditing(false);
    // Find next ID
    const maxNum = workers.reduce((acc, curr) => {
      const match = curr.id.match(/\d+/);
      return match ? Math.max(acc, parseInt(match[0], 10)) : acc;
    }, 200);
    const nextId = `NV${String(maxNum + 1).padStart(5, '0')}`;

    setFormId(nextId);
    setFormUsername(nextId.toLowerCase());
    setFormName('');
    setFormRole('CN');
    setFormTitle('Công nhân đứng máy CNC');
    setFormSalaryMode('Khoán 1 + 0.33 máy');
    setFormBaseSalary(400000);
    setFormChatId('');
    setFormPin('1234');
    setModalOpen(true);
  };

  // Open Edit Modal
  const handleOpenEdit = (w: WorkerDto) => {
    setIsEditing(true);
    setFormId(w.id);
    setFormUsername(w.username || w.id.toLowerCase());
    setFormName(w.name);
    const mappedRole = (['CN', 'TC', 'KT', 'QĐ'].includes(w.role) ? w.role : 'CN') as 'CN' | 'TC' | 'KT' | 'QĐ';
    setFormRole(mappedRole);
    setFormTitle(w.title || 'Công nhân');
    setFormSalaryMode(w.salaryMode?.includes('Hành chính') ? 'Hành chính (Tháng)' : 'Khoán 1 + 0.33 máy');
    setFormBaseSalary(Number(w.baseSalary || 400000));
    setFormChatId(w.chatId || '');
    setFormPin(''); // blank means do not change PIN
    setModalOpen(true);
  };

  // Open Quick Reset PIN Modal
  const handleOpenResetPin = (w: WorkerDto) => {
    setResetPinTarget(w);
    setResetPinValue('1234');
    setResetPinModalOpen(true);
  };

  // Submit Save Account
  const handleSubmitWorker = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formId.trim() || !formName.trim()) {
      toast.warning('Vui lòng nhập đầy đủ Mã nhân viên và Họ tên.');
      return;
    }
    setSaving(true);
    try {
      const res = await apiClient.post<{ success: boolean; workers: WorkerDto[] }>(
        '/master/workers',
        {
          id: formId.trim().toUpperCase(),
          username: formUsername.trim().toLowerCase() || formId.trim().toLowerCase(),
          name: formName.trim(),
          role: formRole,
          title: formTitle.trim(),
          salaryMode: formSalaryMode,
          baseSalary: Math.max(100000, Number(formBaseSalary) || 385000),
          chatId: formChatId.trim(),
          pin: formPin.trim(),
        }
      );

      // Local fallback sync if offline
      if (formPin.trim()) {
        setCustomPin(formId.trim().toUpperCase(), formPin.trim());
      }

      setWorkers(res.workers || []);
      toast.success(
        isEditing
          ? `Đã cập nhật tài khoản ${formName.trim()} (${formId.trim()})${formPin.trim() ? ' & đổi mã PIN mới' : ''}.`
          : `Đã tạo tài khoản mới: ${formName.trim()} (${formId.trim()}) - Mật khẩu PIN: ${formPin.trim() || '1234'}.`
      );
      setModalOpen(false);
      await onRefreshBootstrap();
    } catch (err: any) {
      toast.error(err?.message || 'Lỗi khi lưu thông tin tài khoản.');
    } finally {
      setSaving(false);
    }
  };

  // Submit Reset PIN
  const handleConfirmResetPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetPinTarget) return;
    if (!resetPinValue.trim()) {
      toast.warning('Vui lòng nhập mã PIN mới (ít nhất 4 ký tự).');
      return;
    }
    setResettingPin(true);
    try {
      const res = await apiClient.post<{ success: boolean; message: string; workers?: WorkerDto[] }>(
        `/master/workers/${resetPinTarget.id}/reset-pin`,
        { pin: resetPinValue.trim() }
      );
      setCustomPin(resetPinTarget.id, resetPinValue.trim());
      if (res.workers) setWorkers(res.workers);
      toast.success(res.message || `Đã đặt lại mã PIN cho ${resetPinTarget.name} thành "${resetPinValue.trim()}".`);
      setResetPinModalOpen(false);
    } catch (err: any) {
      // Local fallback
      setCustomPin(resetPinTarget.id, resetPinValue.trim());
      toast.success(`Đã cập nhật mã PIN ngoại tuyến cho ${resetPinTarget.name} thành "${resetPinValue.trim()}".`);
      setResetPinModalOpen(false);
    } finally {
      setResettingPin(false);
    }
  };

  // Toggle Lock/Unlock Account
  const handleToggleActive = async (w: WorkerDto) => {
    if (w.id === 'NV00053') {
      toast.warning('Không thể khóa tài khoản Quản trị viên tối cao NV00053.');
      return;
    }
    try {
      const res = await apiClient.post<{ success: boolean; isActive: number; message: string; workers?: WorkerDto[] }>(
        `/master/workers/${w.id}/toggle-active`,
        {}
      );
      if (res.workers) setWorkers(res.workers);
      else {
        setWorkers((prev) =>
          prev.map((item) => (item.id === w.id ? { ...item, isActive: res.isActive } : item))
        );
      }
      toast.success(res.message);
      await onRefreshBootstrap();
    } catch (err: any) {
      toast.error(err?.message || 'Không thể thay đổi trạng thái tài khoản.');
    }
  };

  // Delete Account
  const handleDeleteWorker = async (w: WorkerDto) => {
    if (w.id === 'NV00053') {
      toast.warning('Không thể xóa tài khoản Quản trị viên gốc.');
      return;
    }
    const confirmDel = window.confirm(
      `Bạn có chắc chắn muốn xóa tài khoản của "${w.name}" (${w.id}) không?\n\n(Nếu nhân sự đã có lịch sử sản xuất, hệ thống sẽ tự động chuyển sang trạng thái Tạm Khóa để bảo lưu hồ sơ truy xuất).`
    );
    if (!confirmDel) return;

    try {
      const res = await apiClient.delete<{ success: boolean; message: string; workers?: WorkerDto[] }>(
        `/master/workers/${w.id}`
      );
      if (res.workers) setWorkers(res.workers);
      else {
        setWorkers((prev) => prev.filter((item) => item.id !== w.id));
      }
      toast.success(res.message || `Đã xóa tài khoản ${w.name}.`);
      await onRefreshBootstrap();
    } catch (err: any) {
      toast.error(err?.message || 'Lỗi khi xóa tài khoản.');
    }
  };

  return (
    <div className="space-y-4">
      {/* Access Permission Warning for Non-Admin */}
      {!isAdmin && (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-amber-300 bg-amber-50">
          <div className="flex items-center gap-3">
            <ShieldAlert className="h-6 w-6 text-amber-600" />
            <div className="text-xs text-amber-900">
              <strong>Phân quyền Quản trị tài khoản:</strong> Bạn đang ở chế độ xem giới hạn. Chỉ
              Quản đốc / Admin mới có quyền tạo mới, cấp đổi mã PIN và phân quyền nhân viên.
            </div>
          </div>
          <Button variant="warning" size="sm" onClick={() => openPinModal('NV00053')}>
            <KeyRound className="h-3.5 w-3.5" /> Đăng nhập Admin
          </Button>
        </Card>
      )}

      {/* Overview Stat Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Card className="flex items-center gap-3 p-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
            <Users className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase text-slate-500">Tổng Tài Khoản</div>
            <div className="text-xl font-extrabold text-slate-900">{stats.total}</div>
            <div className="truncate text-[10px] text-slate-400">Nhân sự hệ thống</div>
          </div>
        </Card>

        <Card className="flex items-center gap-3 p-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-purple-100 text-purple-700">
            <Shield className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase text-slate-500">Quản Trị (Admin)</div>
            <div className="text-xl font-extrabold text-purple-700">{stats.admin}</div>
            <div className="truncate text-[10px] text-slate-400">Toàn quyền hệ thống</div>
          </div>
        </Card>

        <Card className="flex items-center gap-3 p-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
            <UserCheck className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase text-slate-500">Tổ Trưởng &amp; QC</div>
            <div className="text-xl font-extrabold text-amber-700">{stats.leaderQc}</div>
            <div className="truncate text-[10px] text-slate-400">Điều độ &amp; duyệt QC</div>
          </div>
        </Card>

        <Card className="flex items-center gap-3 p-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
            <Smartphone className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase text-slate-500">Công Nhân</div>
            <div className="text-xl font-extrabold text-emerald-700">{stats.worker}</div>
            <div className="truncate text-[10px] text-slate-400">Đứng máy sản xuất</div>
          </div>
        </Card>

        <Card
          className={`flex items-center gap-3 p-3 ${
            stats.locked > 0 ? 'border-rose-300 bg-rose-50/50' : ''
          }`}
        >
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
              stats.locked > 0 ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600'
            }`}
          >
            <Lock className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase text-slate-500">Đang Khóa</div>
            <div
              className={`text-xl font-extrabold ${
                stats.locked > 0 ? 'text-rose-700' : 'text-slate-700'
              }`}
            >
              {stats.locked}
            </div>
            <div className="truncate text-[10px] text-slate-400">
              {stats.locked > 0 ? 'Cần xem xét' : 'An toàn'}
            </div>
          </div>
        </Card>
      </div>

      {/* Main Table Card */}
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-extrabold text-slate-900">
              <Users className="h-5 w-5 text-blue-600" />
              <span>Quản Lý Tài Khoản Đăng Nhập &amp; Phân Quyền ({workers.length} nhân sự)</span>
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Cấp tài khoản, phân quyền đăng nhập theo vai trò (Admin toàn quyền / Tổ trưởng / Công
              nhân chỉ vào cổng công nhân) và cấp đổi mã PIN bảo mật.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void onRefreshBootstrap()}
              className="text-xs"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Làm mới
            </Button>
            {isAdmin && (
              <Button variant="primary" size="sm" onClick={handleOpenCreate} className="text-xs">
                <Plus className="h-4 w-4" /> Thêm Tài Khoản Mới
              </Button>
            )}
          </div>
        </div>

        {/* Filter & Search Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setRoleFilter('ALL')}
              className={`rounded-lg px-2.5 py-1 text-xs font-bold transition-all ${
                roleFilter === 'ALL'
                  ? 'bg-blue-600 text-white shadow-sm ring-1 ring-blue-300'
                  : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              Tất cả ({stats.total})
            </button>
            <button
              type="button"
              onClick={() => setRoleFilter('ADMIN')}
              className={`rounded-lg px-2.5 py-1 text-xs font-bold transition-all ${
                roleFilter === 'ADMIN'
                  ? 'bg-purple-600 text-white shadow-sm ring-1 ring-purple-300'
                  : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              🛡️ Admin ({stats.admin})
            </button>
            <button
              type="button"
              onClick={() => setRoleFilter('LEADER_QC')}
              className={`rounded-lg px-2.5 py-1 text-xs font-bold transition-all ${
                roleFilter === 'LEADER_QC'
                  ? 'bg-amber-600 text-white shadow-sm ring-1 ring-amber-300'
                  : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              🔍 Tổ Trưởng / QC ({stats.leaderQc})
            </button>
            <button
              type="button"
              onClick={() => setRoleFilter('WORKER')}
              className={`rounded-lg px-2.5 py-1 text-xs font-bold transition-all ${
                roleFilter === 'WORKER'
                  ? 'bg-emerald-600 text-white shadow-sm ring-1 ring-emerald-300'
                  : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              📱 Công Nhân ({stats.worker})
            </button>
            {stats.locked > 0 && (
              <button
                type="button"
                onClick={() => setRoleFilter('LOCKED')}
                className={`rounded-lg px-2.5 py-1 text-xs font-bold transition-all ${
                  roleFilter === 'LOCKED'
                    ? 'bg-rose-600 text-white shadow-sm ring-1 ring-rose-300'
                    : 'border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
                }`}
              >
                🔒 Đã Khóa ({stats.locked})
              </button>
            )}
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Tìm Mã NV, Họ tên, Username..."
              className="min-h-[36px] w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
            />
          </div>
        </div>

        {/* Table List */}
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-600">
              <tr className="border-b border-slate-200">
                <th className="px-3 py-2.5">Mã NV / Đăng Nhập</th>
                <th className="px-3 py-2.5">Họ &amp; Tên Nhân Sự</th>
                <th className="px-3 py-2.5">Phân Quyền &amp; Vai Trò</th>
                <th className="px-3 py-2.5">Tổ Máy / Vị Trí</th>
                <th className="px-3 py-2.5 text-right">Lương P1 (Ca 8h)</th>
                <th className="px-3 py-2.5 text-center">Trạng Thái</th>
                <th className="px-3 py-2.5 text-center">Thao Tác Bảo Mật</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white">
              {filteredList.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    Không tìm thấy tài khoản phù hợp với từ khóa &ldquo;{searchTerm}&rdquo;.
                  </td>
                </tr>
              ) : (
                filteredList.map((w) => {
                  const isLocked = w.isActive === 0;
                  const isSuperAdmin = w.id === 'NV00053';
                  const roleBadgeVariant =
                    w.appRole === 'ADMIN' || w.role === 'QĐ'
                      ? 'purple'
                      : w.appRole === 'SHIFT_LEADER' || w.role === 'TC'
                        ? 'warning'
                        : w.appRole === 'QC' || w.role === 'KT'
                          ? 'info'
                          : 'success';

                  const roleLabel =
                    w.appRole === 'ADMIN' || w.role === 'QĐ'
                      ? '🛡️ Quản Trị (Admin)'
                      : w.appRole === 'SHIFT_LEADER' || w.role === 'TC'
                        ? '⚡ Tổ Trưởng Ca'
                        : w.appRole === 'QC' || w.role === 'KT'
                          ? '🔍 Kỹ Thuật / QC'
                          : '📱 Công Nhân (Chỉ xem trang CN)';

                  return (
                    <tr
                      key={w.id}
                      className={`transition-colors hover:bg-blue-50/40 ${
                        isLocked ? 'bg-slate-50/70 text-slate-400 opacity-75' : ''
                      }`}
                    >
                      {/* Worker ID & Username */}
                      <td className="px-3 py-2.5 font-mono-num">
                        <div className="font-extrabold text-blue-700">{w.id}</div>
                        <div className="text-[11px] text-slate-500">
                          @{w.username || w.id.toLowerCase()}
                        </div>
                      </td>

                      {/* Name */}
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <div
                            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white shadow-sm ${
                              w.appRole === 'ADMIN' || w.role === 'QĐ'
                                ? 'bg-purple-600'
                                : w.appRole === 'SHIFT_LEADER' || w.role === 'TC'
                                  ? 'bg-amber-600'
                                  : w.appRole === 'QC' || w.role === 'KT'
                                    ? 'bg-cyan-600'
                                    : 'bg-emerald-600'
                            }`}
                          >
                            {w.name.slice(-2)}
                          </div>
                          <div className="min-w-0">
                            <div className="font-bold text-slate-900">{w.name}</div>
                            {w.isLinked && (
                              <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-sky-600">
                                ✈️ Đã gắn Telegram
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Role & Access Level */}
                      <td className="px-3 py-2.5">
                        <Badge variant={roleBadgeVariant}>{roleLabel}</Badge>
                      </td>

                      {/* Title & Machine Group */}
                      <td className="px-3 py-2.5 font-medium text-slate-700">
                        <div>{w.title}</div>
                        <div className="text-[11px] text-slate-500">{w.salaryMode}</div>
                      </td>

                      {/* Salary (Only visible to Admin) */}
                      <td className="px-3 py-2.5 text-right font-mono-num">
                        {isAdmin ? (
                          <>
                            <div className="font-bold text-emerald-700">
                              {w.baseSalary !== undefined ? formatVnd(w.baseSalary) : '—'}
                            </div>
                            {w.costPerSec !== undefined && (
                              <div className="text-[10px] text-slate-500">
                                ({w.costPerSec} đ/giây)
                              </div>
                            )}
                          </>
                        ) : (
                          <span className="text-slate-400">🔒 Bảo mật</span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="px-3 py-2.5 text-center">
                        {isLocked ? (
                          <Badge variant="danger">🔒 Đã khóa</Badge>
                        ) : (
                          <Badge variant="success">🟢 Hoạt động</Badge>
                        )}
                      </td>

                      {/* Security Actions */}
                      <td className="px-3 py-2.5 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {isAdmin ? (
                            <>
                              {/* Quick Reset PIN */}
                              <button
                                type="button"
                                title="Đặt lại mã PIN về 1234 hoặc mật khẩu mới"
                                onClick={() => handleOpenResetPin(w)}
                                className="inline-flex h-7 items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 text-[11px] font-bold text-amber-800 transition-colors hover:bg-amber-100"
                              >
                                <KeyRound className="h-3 w-3" /> Reset PIN
                              </button>

                              {/* Edit Profile */}
                              <button
                                type="button"
                                title="Sửa thông tin tài khoản"
                                onClick={() => handleOpenEdit(w)}
                                className="inline-flex h-7 items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 text-[11px] font-bold text-blue-700 transition-colors hover:bg-blue-100"
                              >
                                <Edit3 className="h-3 w-3" /> Sửa
                              </button>

                              {/* Lock / Unlock Toggle */}
                              {!isSuperAdmin && (
                                <button
                                  type="button"
                                  title={isLocked ? 'Mở khóa tài khoản' : 'Tạm khóa tài khoản'}
                                  onClick={() => void handleToggleActive(w)}
                                  className={`inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] font-bold transition-colors ${
                                    isLocked
                                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                                  }`}
                                >
                                  {isLocked ? (
                                    <>
                                      <Unlock className="h-3 w-3 text-emerald-600" /> Mở
                                    </>
                                  ) : (
                                    <>
                                      <Lock className="h-3 w-3 text-slate-500" /> Khóa
                                    </>
                                  )}
                                </button>
                              )}

                              {/* Delete */}
                              {!isSuperAdmin && (
                                <button
                                  type="button"
                                  title="Xóa tài khoản"
                                  onClick={() => void handleDeleteWorker(w)}
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-rose-200 bg-rose-50 text-rose-600 transition-colors hover:bg-rose-100"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              )}
                            </>
                          ) : (
                            <span className="text-[11px] text-slate-400">Chỉ Admin</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ==================== CREATE / EDIT ACCOUNT MODAL ==================== */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={isEditing ? `✏️ Chỉnh Sửa Tài Khoản: ${formName}` : '➕ Thêm Tài Khoản Đăng Nhập Mới'}
        maxWidthClass="max-w-2xl"
      >
        <form onSubmit={handleSubmitWorker} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">Mã Nhân Viên *</label>
              <input
                type="text"
                value={formId}
                onChange={(e) => setFormId(e.target.value.toUpperCase())}
                disabled={isEditing}
                placeholder="NV00xxx"
                required
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600 disabled:bg-slate-100"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">
                Tên Đăng Nhập (Username)
              </label>
              <input
                type="text"
                value={formUsername}
                onChange={(e) => setFormUsername(e.target.value.toLowerCase())}
                placeholder="vd: quynh.tv hoặc mã nv"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700">Họ và Tên Nhân Sự *</label>
            <input
              type="text"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="vd: Nguyễn Văn A"
              required
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
            />
          </div>

          {/* Role / Access Level */}
          <div>
            <label className="mb-1.5 block text-xs font-bold text-slate-700">
              Phân Quyền &amp; Cổng Truy Cập *
            </label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
              <label
                className={`flex cursor-pointer flex-col rounded-xl border p-2.5 transition-all ${
                  formRole === 'CN'
                    ? 'border-emerald-500 bg-emerald-50/80 ring-2 ring-emerald-300'
                    : 'border-slate-200 bg-white hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center gap-1.5 font-bold text-slate-900">
                  <input
                    type="radio"
                    name="acc_role"
                    checked={formRole === 'CN'}
                    onChange={() => {
                      setFormRole('CN');
                      setFormTitle('Công nhân đứng máy CNC');
                    }}
                    className="text-emerald-600"
                  />
                  <span>📱 Công Nhân</span>
                </div>
                <div className="mt-1 text-[11px] text-slate-500">
                  Chỉ vào được cổng Báo cáo sản xuất công nhân
                </div>
              </label>

              <label
                className={`flex cursor-pointer flex-col rounded-xl border p-2.5 transition-all ${
                  formRole === 'TC'
                    ? 'border-amber-500 bg-amber-50/80 ring-2 ring-amber-300'
                    : 'border-slate-200 bg-white hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center gap-1.5 font-bold text-slate-900">
                  <input
                    type="radio"
                    name="acc_role"
                    checked={formRole === 'TC'}
                    onChange={() => {
                      setFormRole('TC');
                      setFormTitle('Trưởng ca / Điều độ xưởng');
                    }}
                    className="text-amber-600"
                  />
                  <span>⚡ Tổ Trưởng Ca</span>
                </div>
                <div className="mt-1 text-[11px] text-slate-500">
                  Điều độ máy, phê duyệt QC và nhật ký ca
                </div>
              </label>

              <label
                className={`flex cursor-pointer flex-col rounded-xl border p-2.5 transition-all ${
                  formRole === 'KT'
                    ? 'border-cyan-500 bg-cyan-50/80 ring-2 ring-cyan-300'
                    : 'border-slate-200 bg-white hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center gap-1.5 font-bold text-slate-900">
                  <input
                    type="radio"
                    name="acc_role"
                    checked={formRole === 'KT'}
                    onChange={() => {
                      setFormRole('KT');
                      setFormTitle('Kỹ thuật công nghệ / KCS');
                    }}
                    className="text-cyan-600"
                  />
                  <span>🔍 Kỹ Thuật QC</span>
                </div>
                <div className="mt-1 text-[11px] text-slate-500">
                  Kiểm soát FAI, QC 3 tầng và quy trình NC
                </div>
              </label>

              <label
                className={`flex cursor-pointer flex-col rounded-xl border p-2.5 transition-all ${
                  formRole === 'QĐ'
                    ? 'border-purple-500 bg-purple-50/80 ring-2 ring-purple-300'
                    : 'border-slate-200 bg-white hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center gap-1.5 font-bold text-slate-900">
                  <input
                    type="radio"
                    name="acc_role"
                    checked={formRole === 'QĐ'}
                    onChange={() => {
                      setFormRole('QĐ');
                      setFormTitle('Quản đốc xưởng');
                    }}
                    className="text-purple-600"
                  />
                  <span>🛡️ Quản Trị (Admin)</span>
                </div>
                <div className="mt-1 text-[11px] text-slate-500">
                  Toàn quyền hệ thống, P&amp;L, lương &amp; tài khoản
                </div>
              </label>
            </div>
          </div>

          {/* Title & Salary */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">
                Chức Danh / Vị Trí Công Việc
              </label>
              <input
                type="text"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                placeholder="vd: Thợ tiện CNC đứng máy OKK1"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">Chế Độ Tính Lương</label>
              <select
                value={formSalaryMode}
                onChange={(e) => setFormSalaryMode(e.target.value as any)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
              >
                <option value="Khoán 1 + 0.33 máy">Khoán 1 + 0.33 máy (Sản phẩm khoán)</option>
                <option value="Hành chính (Tháng)">Hành chính (Tháng / Lương ngày)</option>
              </select>
            </div>
          </div>

          {/* Salary Base & PIN */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">
                Lương Cơ Bản P1 (Ca 8h - VNĐ)
              </label>
              <input
                type="number"
                min="100000"
                step="5000"
                value={formBaseSalary}
                onChange={(e) => setFormBaseSalary(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
              />
              <span className="mt-0.5 block text-[11px] text-slate-500">
                ≈ {Math.round(formBaseSalary / 28800)} đ/giây định mức
              </span>
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">
                {isEditing ? 'Đặt Mã PIN Mới (để trống nếu không đổi)' : 'Mật Khẩu PIN Đăng Nhập *'}
              </label>
              <input
                type="text"
                value={formPin}
                onChange={(e) => setFormPin(e.target.value)}
                placeholder={isEditing ? 'Nhập mã PIN mới nếu muốn đổi...' : 'Mặc định: 1234'}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
              />
              <span className="mt-0.5 block text-[11px] text-slate-500">
                Mã số cá nhân công nhân dùng để đăng nhập báo cáo ca
              </span>
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setModalOpen(false)}
            >
              Hủy
            </Button>
            <Button type="submit" variant="primary" size="sm" disabled={saving}>
              {saving ? 'Đang lưu...' : isEditing ? 'Cập Nhật Hồ Sơ' : 'Tạo Tài Khoản'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ==================== RESET PIN MODAL ==================== */}
      <Modal
        open={resetPinModalOpen}
        onClose={() => setResetPinModalOpen(false)}
        title={`🔑 Đặt Lại Mã PIN Đăng Nhập cho: ${resetPinTarget?.name}`}
        maxWidthClass="max-w-md"
      >
        <form onSubmit={handleConfirmResetPin} className="space-y-4">
          <p className="text-xs text-slate-600">
            Đặt lại mã PIN khi công nhân quên mật khẩu. Sau khi đặt lại, nhân viên có thể dùng mã PIN
            này để đăng nhập ngay lập tức.
          </p>

          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700">Mã PIN Mới *</label>
            <input
              type="text"
              value={resetPinValue}
              onChange={(e) => setResetPinValue(e.target.value)}
              placeholder="vd: 1234"
              required
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-base font-bold text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
            />
          </div>

          <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setResetPinModalOpen(false)}
            >
              Hủy
            </Button>
            <Button type="submit" variant="primary" size="sm" disabled={resettingPin}>
              {resettingPin ? 'Đang cập nhật...' : 'Xác Nhận Đổi PIN'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
