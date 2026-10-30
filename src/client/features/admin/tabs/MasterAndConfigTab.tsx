import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Calculator,
  CheckCircle2,
  CloudUpload,
  Cpu,
  Download,
  Edit3,
  Eye,
  EyeOff,
  FileSpreadsheet,
  KeyRound,
  Lock,
  Plus,
  Printer,
  RefreshCw,
  Repeat,
  Save,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  Upload,
  Users,
  Wrench,
  Database,
  Zap,
} from 'lucide-react';
import type {
  CuttingTool,
  MachineInfo,
  MachineStatus,
  OperationMeta,
  SyncOutboxItem,
  WorkerDto,
} from '@shared/types';
import { matchesSearch } from '@shared/vnSearch';
import { apiClient } from '@client/lib/apiClient';
import {
  downloadOperationsTemplateExcel,
  fileToUint8Array,
  type MasterOperationImportRow,
  parseOperationsWorkbookBuffer,
} from '@client/lib/excelService';
import { formatDurationSec, formatNumber, formatVnd } from '@client/lib/formatters';
import {
  getStoredSupabaseConfig,
  saveStoredSupabaseConfig,
  isSupabaseConnected,
} from '@client/lib/supabaseClient';
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

type MasterSubTab = 'OPS' | 'MACHINES_TOOLS' | 'WORKERS' | 'CONFIG' | 'TRAINING_SOP';

interface ToolSwapSessionRecord {
  id: number;
  time: string;
  toolCode: string;
  toolName: string;
  machineName: string;
  qtyIssued: number;
  oldInsertReturned: boolean;
  reason: string;
  remainingStock: number;
}

const QUICK_OP_CHIPS: Array<{ label: string; line: string }> = [
  { label: '1. Tiện thô mặt đầu (900s)', line: '1. Tiện thô mặt đầu & vát mép | 900' },
  { label: '2. Tiện tinh ren CNC (1500s)', line: '2. Tiện tinh biên dạng & tiện ren CNC | 1500' },
  { label: '3. Phay rãnh then (1800s)', line: '3. Phay mặt phẳng & rãnh then CNC | 1800' },
  { label: '4. Khoan taro lỗ (1200s)', line: '4. Khoan tâm & taro hệ lỗ M8/M10 | 1200' },
  { label: '5. Cắt dây EDM (3600s)', line: '5. Cắt dây EDM biên dạng chính xác | 3600' },
  { label: '6. Nhiệt luyện (5400s)', line: '6. Nhiệt luyện tôi chân không đạt HRC | 5400' },
  { label: '7. Mài tròn tinh (2100s)', line: '7. Mài tròn ngoài / phẳng đạt dung sai ±0.01 | 2100' },
  { label: '8. QC & Đóng gói (600s)', line: '8. Làm sạch bavia, đo OQC & chống gỉ | 600' },
];

const SAMPLE_4_NC = [
  '1. Tiện thô phôi rèn / đúc & khoan tâm | 1200',
  '2. Tiện tinh CNC cổ trục dung sai ±0.015 | 1800',
  '3. Phay rãnh then & khoan taro 4 lỗ M8 | 1500',
  '4. Nguội sửa bavia, đo kiểm OQC & bôi dầu | 480',
].join('\n');

const SAMPLE_10_NC = [
  '1. Cưa cắt phôi thép hợp kim SCM440 | 420',
  '2. Tiện thô mặt đầu & đường kính ngoài Lần 1 | 1200',
  '3. Tiện thô đảo đầu & khoan lỗ suốt Ø28 | 1350',
  '4. Phay thô hốc & bậc định vị CNC 4 trục | 2100',
  '5. Nhiệt luyện thấm tôi đạt độ cứng 52-55 HRC | 5400',
  '6. Tiện cứng CBN chuẩn định vị sau nhiệt | 1500',
  '7. Phay tinh CNC biên dạng 3D & hệ lỗ định vị H7 | 2700',
  '8. Cắt dây EDM rãnh then hoa chính xác | 3600',
  '9. Mài tròn trong & ngoài đạt độ bóng Ra 0.4 | 2400',
  '10. Kiểm tra 100% panme đồng hồ so & đóng gói xuất xưởng | 600',
].join('\n');

const TOOL_SWAP_REASONS = [
  'Mòn hết tuổi bền cạnh cắt theo định mức',
  'Mẻ mảnh chíp do phôi đúc cứng / rỗ xỉ',
  'Chuyển bước gia công tinh yêu cầu bóng bề mặt',
  'Gãy dao / vỡ mảnh sự cố (cần lập biên bản)',
];

const MACHINE_STATUS_LABELS: Record<
  MachineStatus,
  { label: string; badge: 'success' | 'warning' | 'danger' | 'neutral' | 'purple' }
> = {
  RUNNING: { label: 'ĐANG CHẠY', badge: 'success' },
  SETUP: { label: 'ĐANG GÁ ĐẶT', badge: 'warning' },
  STOPPED: { label: 'DỪNG SỰ CỐ', badge: 'danger' },
  IDLE: { label: 'CHỜ PHÔI / RẢNH', badge: 'neutral' },
  MAINTENANCE: { label: 'BẢO TRÌ ĐỊNH KỲ', badge: 'purple' },
};

export function MasterAndConfigTab({
  bootstrap,
  onRefreshBootstrap,
  deepLink,
}: AdminTabCommonProps) {
  const toast = useToast();
  const { user, authMode, quickSwitch, openPinModal, refreshSession } = useAuth();

  const isAdmin = user?.appRole === 'ADMIN';
  const canManageOps =
    user?.appRole === 'ADMIN' ||
    user?.appRole === 'DIRECTOR' ||
    user?.appRole === 'SHIFT_LEADER';
  const canDeleteOpsOrAddMachine =
    user?.appRole === 'ADMIN' || user?.appRole === 'DIRECTOR';

  const [subTab, setSubTab] = useState<MasterSubTab>(deepLink?.masterSubTab || 'OPS');

  // ==================== LOCAL DATA MIRRORS ====================
  const [operations, setOperations] = useState<OperationMeta[]>(bootstrap.operations || []);
  const [machines, setMachines] = useState<MachineInfo[]>(bootstrap.machines || []);
  const [tools, setTools] = useState<CuttingTool[]>(bootstrap.toolsList || []);
  const [workers, setWorkers] = useState<WorkerDto[]>(bootstrap.workers || []);

  useEffect(() => {
    setOperations(bootstrap.operations || []);
    setMachines(bootstrap.machines || []);
    setTools(bootstrap.toolsList || []);
    setWorkers(bootstrap.workers || []);
  }, [bootstrap]);

  useEffect(() => {
    if (deepLink?.masterSubTab) {
      setSubTab(deepLink.masterSubTab);
    }
    if (deepLink?.masterSearch !== undefined) {
      setOpSearch(deepLink.masterSearch);
      setMachSearch(deepLink.masterSearch);
      setToolSearch(deepLink.masterSearch);
      setWorkerSearch(deepLink.masterSearch);
    }
  }, [deepLink]);

  // ==================== SUB-TAB 1: OPERATIONS (627+ NC) ====================
  const [opSearch, setOpSearch] = useState(deepLink?.masterSearch || '');
  const [opCustomerFilter, setOpCustomerFilter] = useState('ALL');
  const [opMachineFilter, setOpMachineFilter] = useState('ALL');
  const [opCriticalOnly, setOpCriticalOnly] = useState(false);
  const [opPage, setOpPage] = useState(1);
  const [opPageSize, setOpPageSize] = useState(50);

  // Quick Multi-Op Creator Modal
  const [createOpOpen, setCreateOpOpen] = useState(false);
  const [newOpCustomer, setNewOpCustomer] = useState('Vico - Nội bộ / Khách lẻ');
  const [newOpProductName, setNewOpProductName] = useState('');
  const [newOpMatName, setNewOpMatName] = useState('Thép hợp kim SCM440');
  const [newOpMachine, setNewOpMachine] = useState('Máy Tiện CNC 1');
  const [newOpToolCode, setNewOpToolCode] = useState('T01');
  const [newOpCuttingRec, setNewOpCuttingRec] = useState('Vc=120m/p | f=0.15mm/v | ap=1.5mm');
  const [newOpRawLines, setNewOpRawLines] = useState(SAMPLE_4_NC);
  const [calcSetupSec, setCalcSetupSec] = useState(1800);
  const [calcBatchQty, setCalcBatchQty] = useState(50);
  const [calcCycleSec, setCalcCycleSec] = useState(420);
  const [calcOpTitle, setCalcOpTitle] = useState('Gia công tinh CNC');
  const [submittingNewOps, setSubmittingNewOps] = useState(false);

  // Edit Single NC Modal
  const [editingOp, setEditingOp] = useState<OperationMeta | null>(null);
  const [editOpName, setEditOpName] = useState('');
  const [editStdSeconds, setEditStdSeconds] = useState(1800);
  const [editDefaultMachine, setEditDefaultMachine] = useState('');
  const [editCuttingRec, setEditCuttingRec] = useState('');
  const [editIsCritical, setEditIsCritical] = useState(false);
  const [editSetupSec, setEditSetupSec] = useState(1200);
  const [editBatchQty, setEditBatchQty] = useState(50);
  const [editCycleSec, setEditCycleSec] = useState(360);
  const [savingEditOp, setSavingEditOp] = useState(false);

  // Delete NC Confirmation Modal
  const [deletingOp, setDeletingOp] = useState<OperationMeta | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);

  // Excel (.xlsx) Import Preview Modal
  const xlsxInputRef = useRef<HTMLInputElement | null>(null);
  const [importPreviewOpen, setImportPreviewOpen] = useState(false);
  const [importFileName, setImportFileName] = useState('');
  const [importRows, setImportRows] = useState<MasterOperationImportRow[]>([]);
  const [importingBusy, setImportingBusy] = useState(false);

  const uniqueCustomers = useMemo(() => {
    const s = new Set<string>();
    operations.forEach((o) => {
      if (o.customer) s.add(o.customer);
    });
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'vi'));
  }, [operations]);

  const filteredOperations = useMemo(() => {
    return operations.filter((op) => {
      if (opCustomerFilter !== 'ALL' && op.customer !== opCustomerFilter) return false;
      if (opMachineFilter !== 'ALL' && op.defaultMachine !== opMachineFilter) return false;
      if (opCriticalOnly && !op.isCriticalCheck) return false;
      if (
        opSearch.trim() &&
        !matchesSearch(
          `${op.ncId} ${op.spId} ${op.customer} ${op.productName} ${op.opName} ${op.defaultMachine} ${op.toolCode} ${op.matName}`,
          opSearch
        )
      ) {
        return false;
      }
      return true;
    });
  }, [operations, opCustomerFilter, opMachineFilter, opCriticalOnly, opSearch]);

  useEffect(() => {
    setOpPage(1);
  }, [opCustomerFilter, opMachineFilter, opCriticalOnly, opSearch, opPageSize]);

  const pagedOperations = useMemo(() => {
    const start = (opPage - 1) * opPageSize;
    return filteredOperations.slice(start, start + opPageSize);
  }, [filteredOperations, opPage, opPageSize]);

  const openEditOpModal = (op: OperationMeta) => {
    setEditingOp(op);
    setEditOpName(op.opName);
    setEditStdSeconds(op.stdSeconds);
    setEditDefaultMachine(op.defaultMachine);
    setEditCuttingRec(op.cuttingRec || '');
    setEditIsCritical(Boolean(op.isCriticalCheck));
    setEditCycleSec(Math.max(30, op.stdSeconds - 60));
    setEditSetupSec(1800);
    setEditBatchQty(30);
  };

  const handleSaveEditOp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingOp) return;
    setSavingEditOp(true);
    try {
      const res = await apiClient.patch<{ success: boolean; item?: OperationMeta }>(
        `/master/operations/${encodeURIComponent(editingOp.ncId)}`,
        {
          opName: editOpName.trim(),
          stdSeconds: Math.max(10, Math.round(Number(editStdSeconds) || 60)),
          defaultMachine: editDefaultMachine,
          cuttingRec: editCuttingRec.trim(),
          isCriticalCheck: editIsCritical,
        }
      );
      if (res.item) {
        setOperations((prev) =>
          prev.map((o) => (o.ncId === res.item!.ncId ? res.item! : o))
        );
      }
      toast.success(`Đã cập nhật nguyên công ${editingOp.ncId}.`);
      setEditingOp(null);
      await onRefreshBootstrap();
    } catch (err: any) {
      toast.error(err?.message || 'Lỗi cập nhật nguyên công.');
    } finally {
      setSavingEditOp(false);
    }
  };

  const handleConfirmDeleteOp = async () => {
    if (!deletingOp) return;
    setDeletingBusy(true);
    try {
      await apiClient.delete(
        `/master/operations/${encodeURIComponent(deletingOp.ncId)}`
      );
      setOperations((prev) => prev.filter((o) => o.ncId !== deletingOp.ncId));
      toast.success(`Đã xóa nguyên công ${deletingOp.ncId} và đánh số lại quy trình.`);
      setDeletingOp(null);
      await onRefreshBootstrap();
    } catch (err: any) {
      toast.error(err?.message || 'Không thể xóa nguyên công.');
    } finally {
      setDeletingBusy(false);
    }
  };

  const computedSetupPlusCycle = useMemo(() => {
    const lot = Math.max(1, Number(calcBatchQty) || 1);
    const setupPerPcs = Math.round((Number(calcSetupSec) || 0) / lot);
    return Math.max(60, setupPerPcs + Math.max(10, Math.round(Number(calcCycleSec) || 0)));
  }, [calcSetupSec, calcBatchQty, calcCycleSec]);

  const appendCalculatedOpLine = () => {
    const title = calcOpTitle.trim() || 'Gia công CNC';
    const nextLine = `${title} | ${computedSetupPlusCycle}`;
    setNewOpRawLines((prev) => (prev.trim() ? `${prev.trim()}\n${nextLine}` : nextLine));
    toast.info(`Đã chèn dòng: "${nextLine}s"`);
  };

  const handleCreateMultiOps = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOpProductName.trim()) {
      toast.warning('Vui lòng nhập Tên sản phẩm cần khai báo quy trình.');
      return;
    }
    if (!newOpRawLines.trim()) {
      toast.warning('Vui lòng nhập ít nhất 1 dòng nguyên công.');
      return;
    }
    setSubmittingNewOps(true);
    try {
      const res = await apiClient.post<{
        success: boolean;
        createdIds: string[];
        items: OperationMeta[];
      }>('/master/operations', {
        customer: newOpCustomer.trim() || 'Vico - Nội bộ / Khách lẻ',
        productName: newOpProductName.trim(),
        matName: newOpMatName.trim(),
        defaultMachine: newOpMachine,
        toolCode: newOpToolCode,
        cuttingRec: newOpCuttingRec.trim(),
        rawLines: newOpRawLines,
      });
      setOperations(res.items || []);
      toast.success(
        `Đã khởi tạo thành công ${res.createdIds.length} nguyên công (${res.createdIds.join(', ')}).`
      );
      setCreateOpOpen(false);
      setNewOpProductName('');
      await onRefreshBootstrap();
    } catch (err: any) {
      toast.error(err?.message || 'Không thể tạo nguyên công.');
    } finally {
      setSubmittingNewOps(false);
    }
  };

  const handleExcelFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const bytes = await fileToUint8Array(file);
      const parsed = await parseOperationsWorkbookBuffer(bytes);
      if (parsed.length === 0) {
        toast.warning('File Excel không có dòng nguyên công hợp lệ (cần tối thiểu cột Tên Sản Phẩm).');
        return;
      }
      setImportFileName(file.name);
      setImportRows(parsed);
      setImportPreviewOpen(true);
    } catch (err: any) {
      toast.error(err?.message || 'Không đọc được file Excel (.xlsx).');
    }
  };

  const handleConfirmExcelImport = async () => {
    if (importRows.length === 0) return;
    setImportingBusy(true);
    try {
      const res = await apiClient.post<{
        success: boolean;
        importedCount: number;
        message: string;
      }>('/master/operations/import-xlsx', {
        excelRows: importRows,
      });
      toast.success(res.message || `Đã nạp ${res.importedCount} nguyên công.`);
      setImportPreviewOpen(false);
      setImportRows([]);
      await onRefreshBootstrap();
    } catch (err: any) {
      toast.error(err?.message || 'Lỗi nạp danh mục từ Excel.');
    } finally {
      setImportingBusy(false);
    }
  };

  // ==================== SUB-TAB 2: MACHINES (23+) & TOOLS SWAP (118+) ====================
  const [machSearch, setMachSearch] = useState('');
  const [machStatusFilter, setMachStatusFilter] = useState<'ALL' | MachineStatus>('ALL');
  const [machPage, setMachPage] = useState(1);
  const [machPageSize, setMachPageSize] = useState(25);

  const [addMachOpen, setAddMachOpen] = useState(false);
  const [newMachId, setNewMachId] = useState('');
  const [newMachName, setNewMachName] = useState('');
  const [newMachGroup, setNewMachGroup] = useState('Tiện CNC');
  const [newMachCostHour, setNewMachCostHour] = useState(350000);
  const [savingNewMach, setSavingNewMach] = useState(false);

  const [editingMach, setEditingMach] = useState<MachineInfo | null>(null);
  const [editMachStatus, setEditMachStatus] = useState<MachineStatus>('IDLE');
  const [editMachCostHour, setEditMachCostHour] = useState(350000);
  const [editMachStopReason, setEditMachStopReason] = useState('');
  const [savingEditMach, setSavingEditMach] = useState(false);

  const [toolSearch, setToolSearch] = useState('');
  const [toolGroupFilter, setToolGroupFilter] = useState('ALL');
  const [toolLowStockOnly, setToolLowStockOnly] = useState(false);
  const [toolPage, setToolPage] = useState(1);
  const [toolPageSize, setToolPageSize] = useState(25);

  const [swapToolModal, setSwapToolModal] = useState<CuttingTool | null>(null);
  const [swapMachineName, setSwapMachineName] = useState('Máy Tiện CNC 1');
  const [swapQty, setSwapQty] = useState(1);
  const [swapOldReturned, setSwapOldReturned] = useState(true);
  const [swapReason, setSwapReason] = useState(TOOL_SWAP_REASONS[0]);
  const [swappingBusy, setSwappingBusy] = useState(false);
  const [sessionSwaps, setSessionSwaps] = useState<ToolSwapSessionRecord[]>([]);

  const filteredMachines = useMemo(() => {
    return machines.filter((m) => {
      const st = (m.status || 'IDLE') as MachineStatus;
      if (machStatusFilter !== 'ALL' && st !== machStatusFilter) return false;
      if (
        machSearch.trim() &&
        !matchesSearch(
          `${m.id} ${m.name} ${m.group} ${m.currentWorkerName || ''} ${m.currentPoId || ''} ${m.stopReason || ''}`,
          machSearch
        )
      ) {
        return false;
      }
      return true;
    });
  }, [machines, machStatusFilter, machSearch]);

  const pagedMachines = useMemo(() => {
    const start = (machPage - 1) * machPageSize;
    return filteredMachines.slice(start, start + machPageSize);
  }, [filteredMachines, machPage, machPageSize]);

  const toolGroups = useMemo(() => {
    const s = new Set<string>();
    tools.forEach((t) => {
      if (t.group) s.add(t.group);
    });
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'vi'));
  }, [tools]);

  const filteredTools = useMemo(() => {
    return tools.filter((t) => {
      if (toolGroupFilter !== 'ALL' && t.group !== toolGroupFilter) return false;
      if (toolLowStockOnly && Number(t.stockQty ?? 0) > 10) return false;
      if (
        toolSearch.trim() &&
        !matchesSearch(`${t.code} ${t.group} ${t.name}`, toolSearch)
      ) {
        return false;
      }
      return true;
    });
  }, [tools, toolGroupFilter, toolLowStockOnly, toolSearch]);

  useEffect(() => {
    setToolPage(1);
  }, [toolGroupFilter, toolLowStockOnly, toolSearch, toolPageSize]);

  const pagedTools = useMemo(() => {
    const start = (toolPage - 1) * toolPageSize;
    return filteredTools.slice(start, start + toolPageSize);
  }, [filteredTools, toolPage, toolPageSize]);

  const handleAddMachine = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMachName.trim()) {
      toast.warning('Vui lòng nhập Tên máy mới.');
      return;
    }
    setSavingNewMach(true);
    try {
      const res = await apiClient.post<{ success: boolean; items: MachineInfo[] }>(
        '/master/machines',
        {
          id: newMachId.trim() || undefined,
          name: newMachName.trim(),
          group: newMachGroup.trim() || 'Gia công CNC',
          costPerHour: Math.max(50000, Number(newMachCostHour) || 250000),
        }
      );
      setMachines(res.items || []);
      toast.success(`Đã thêm máy ${newMachName.trim()} vào xưởng.`);
      setAddMachOpen(false);
      setNewMachId('');
      setNewMachName('');
      await onRefreshBootstrap();
    } catch (err: any) {
      toast.error(err?.message || 'Không thể thêm máy mới.');
    } finally {
      setSavingNewMach(false);
    }
  };

  const openEditMachineModal = (m: MachineInfo) => {
    setEditingMach(m);
    setEditMachStatus((m.status || 'IDLE') as MachineStatus);
    setEditMachCostHour(m.costPerHour || 250000);
    setEditMachStopReason(m.stopReason || '');
  };

  const handleSaveEditMachine = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMach) return;
    setSavingEditMach(true);
    try {
      const res = await apiClient.patch<{ success: boolean; items: MachineInfo[] }>(
        `/master/machines/${encodeURIComponent(editingMach.id)}`,
        {
          status: editMachStatus,
          costPerHour: Math.max(50000, Number(editMachCostHour) || 250000),
          stopReason:
            editMachStatus === 'STOPPED' || editMachStatus === 'MAINTENANCE'
              ? editMachStopReason.trim()
              : '',
        }
      );
      setMachines(res.items || []);
      toast.success(`Đã cập nhật trạng thái & đơn giá giờ máy ${editingMach.name}.`);
      setEditingMach(null);
      await onRefreshBootstrap();
    } catch (err: any) {
      toast.error(err?.message || 'Lỗi cập nhật máy.');
    } finally {
      setSavingEditMach(false);
    }
  };

  const openSwapModal = (t: CuttingTool) => {
    setSwapToolModal(t);
    setSwapMachineName(machines[0]?.name || 'Máy Tiện CNC 1');
    setSwapQty(1);
    setSwapOldReturned(true);
    setSwapReason(TOOL_SWAP_REASONS[0]);
  };

  const handleSubmitToolSwap = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!swapToolModal) return;
    setSwappingBusy(true);
    try {
      const res = await apiClient.post<{
        success: boolean;
        message: string;
        tool: { code: string; stockQty: number };
      }>('/master/tools/swap', {
        toolCode: swapToolModal.code,
        machineName: swapMachineName,
        oldInsertReturned: swapOldReturned,
        qtyIssued: Math.max(1, Math.round(Number(swapQty) || 1)),
        reason: swapReason.trim() || TOOL_SWAP_REASONS[0],
      });

      setTools((prev) =>
        prev.map((item) =>
          item.code === res.tool.code ? { ...item, stockQty: res.tool.stockQty } : item
        )
      );
      setSessionSwaps((prev) => [
        {
          id: Date.now(),
          time: new Date().toLocaleTimeString('vi-VN'),
          toolCode: swapToolModal.code,
          toolName: swapToolModal.name,
          machineName: swapMachineName,
          qtyIssued: Math.max(1, Math.round(Number(swapQty) || 1)),
          oldInsertReturned: swapOldReturned,
          reason: swapReason,
          remainingStock: res.tool.stockQty,
        },
        ...prev,
      ]);
      toast.success(res.message);
      setSwapToolModal(null);
      await onRefreshBootstrap();
    } catch (err: any) {
      toast.error(err?.message || 'Cấp đổi mảnh dao thất bại.');
    } finally {
      setSwappingBusy(false);
    }
  };

  // ==================== SUB-TAB 3: WORKERS & PIN ACCOUNTS (16+) ====================
  const [workerSearch, setWorkerSearch] = useState('');
  const [workerModalOpen, setWorkerModalOpen] = useState(false);
  const [editingWorkerMode, setEditingWorkerMode] = useState(false);
  const [wId, setWId] = useState('');
  const [wUsername, setWUsername] = useState('');
  const [wName, setWName] = useState('');
  const [wRole, setWRole] = useState<'CN' | 'TC' | 'KT' | 'QĐ'>('CN');
  const [wTitle, setWTitle] = useState('Công nhân đứng máy CNC');
  const [wSalaryMode, setWSalaryMode] = useState<'Khoán 1 + 0.33 máy' | 'Hành chính (Tháng)'>(
    'Khoán 1 + 0.33 máy'
  );
  const [wBaseSalary, setWBaseSalary] = useState(400000);
  const [wChatId, setWChatId] = useState('');
  const [wPin, setWPin] = useState('');
  const [savingWorker, setSavingWorker] = useState(false);

  const filteredWorkers = useMemo(() => {
    return workers.filter((w) => {
      if (
        workerSearch.trim() &&
        !matchesSearch(
          `${w.id} ${w.name} ${w.username} ${w.role} ${w.title} ${w.salaryMode}`,
          workerSearch
        )
      ) {
        return false;
      }
      return true;
    });
  }, [workers, workerSearch]);

  const openCreateWorkerModal = () => {
    setEditingWorkerMode(false);
    setWId(`NV00${String(workers.length + 300)}`);
    setWUsername('');
    setWName('');
    setWRole('CN');
    setWTitle('Công nhân đứng máy CNC');
    setWSalaryMode('Khoán 1 + 0.33 máy');
    setWBaseSalary(400000);
    setWChatId('');
    setWPin('1234');
    setWorkerModalOpen(true);
  };

  const openEditWorkerModal = (w: WorkerDto) => {
    setEditingWorkerMode(true);
    setWId(w.id);
    setWUsername(w.username || w.id.toLowerCase());
    setWName(w.name);
    const mappedRole =
      w.role === 'QĐ' || w.role === 'TC' || w.role === 'KT' ? w.role : 'CN';
    setWRole(mappedRole);
    setWTitle(w.title || 'Công nhân');
    setWSalaryMode(
      w.salaryMode?.includes('Hành chính')
        ? 'Hành chính (Tháng)'
        : 'Khoán 1 + 0.33 máy'
    );
    setWBaseSalary(Number(w.baseSalary || 400000));
    setWChatId(w.chatId || '');
    setWPin('');
    setWorkerModalOpen(true);
  };

  const handleSaveWorker = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wId.trim() || !wName.trim()) {
      toast.warning('Vui lòng nhập đầy đủ Mã NV và Họ tên.');
      return;
    }
    setSavingWorker(true);
    try {
      const res = await apiClient.post<{ success: boolean; workers: WorkerDto[] }>(
        '/master/workers',
        {
          id: wId.trim(),
          username: wUsername.trim() || wId.trim().toLowerCase(),
          name: wName.trim(),
          role: wRole,
          title: wTitle.trim(),
          salaryMode: wSalaryMode,
          baseSalary: Math.max(100000, Number(wBaseSalary) || 385000),
          chatId: wChatId.trim(),
          pin: wPin.trim(),
        }
      );
      setWorkers(res.workers || []);
      toast.success(
        editingWorkerMode
          ? `Đã cập nhật hồ sơ nhân sự ${wName.trim()}${wPin.trim() ? ' & đổi mã PIN mới' : ''}.`
          : `Đã tạo tài khoản nhân sự ${wName.trim()} (${wId.trim()}).`
      );
      setWorkerModalOpen(false);
      await onRefreshBootstrap();
    } catch (err: any) {
      toast.error(err?.message || 'Lỗi lưu thông tin nhân sự.');
    } finally {
      setSavingWorker(false);
    }
  };

  // ==================== SUB-TAB 4: SYSTEM CONFIG & OPTIONAL INTEGRATIONS ====================
  const [cfgLoading, setCfgLoading] = useState(false);
  const [savingCfg, setSavingCfg] = useState(false);
  const [showBotToken, setShowBotToken] = useState(false);
  const [cfgMap, setCfgMap] = useState<Record<string, string>>({
    AUTH_MODE: String(bootstrap.config?.AUTH_MODE || bootstrap.authMode || 'DEMO_QUICK'),
    SECONDS_PER_SHIFT: String(bootstrap.config?.SECONDS_PER_SHIFT || '28800'),
    SECOND_MACHINE_RATE: String(bootstrap.config?.SECOND_MACHINE_RATE || '0.33'),
    MEAL_SHIFT_2_3: String(bootstrap.config?.MEAL_SHIFT_2_3 || '25000'),
    MEAL_OT_2H: String(bootstrap.config?.MEAL_OT_2H || '30000'),
    MEAL_SUNDAY: String(bootstrap.config?.MEAL_SUNDAY || '25000'),
    KPI_WARNING_THRESHOLD: String(bootstrap.config?.KPI_WARNING_THRESHOLD || '0.85'),
    WEB_APP_URL: String(bootstrap.config?.WEB_APP_URL || ''),
    GAS_SYNC_ENABLED: String(bootstrap.config?.GAS_SYNC_ENABLED || '0'),
    TELEGRAM_BOT_TOKEN: '',
    TELEGRAM_BOT_USERNAME: String(bootstrap.config?.TELEGRAM_BOT_USERNAME || ''),
    MANAGER_CHAT_ID: String(bootstrap.config?.MANAGER_CHAT_ID || ''),
  });
  const [outboxItems, setOutboxItems] = useState<SyncOutboxItem[]>([]);
  const [supabaseUrl, setSupabaseUrl] = useState(() => getStoredSupabaseConfig().url);
  const [supabaseKey, setSupabaseKey] = useState(() => getStoredSupabaseConfig().anonKey);
  const [showSupabaseKey, setShowSupabaseKey] = useState(false);
  const [supabaseConnected, setSupabaseConnected] = useState(() => isSupabaseConnected());

  const handleSaveSupabaseConfig = (e: React.FormEvent) => {
    e.preventDefault();
    saveStoredSupabaseConfig(supabaseUrl, supabaseKey);
    const connected = isSupabaseConnected();
    setSupabaseConnected(connected);
    if (connected) {
      toast.success('Đã lưu cấu hình Supabase Cloud! Dữ liệu được đồng bộ realtime đa thiết bị.');
    } else {
      toast.warning('Đã xóa cấu hình Supabase (hệ thống sẽ lưu tạm cục bộ offline).');
    }
  };
  const [flushingOutbox, setFlushingOutbox] = useState(false);

  const loadAdminConfigAndOutbox = async () => {
    if (!isAdmin) return;
    setCfgLoading(true);
    try {
      const [cfgRes, outboxRes] = await Promise.all([
        apiClient.get<{ config: Record<string, string> }>('/config'),
        apiClient.get<{ items: SyncOutboxItem[] }>('/sync/outbox'),
      ]);
      setCfgMap((prev) => ({ ...prev, ...(cfgRes.config || {}) }));
      setOutboxItems(outboxRes.items || []);
    } catch (err: any) {
      toast.error(err?.message || 'Không thể tải cấu hình hệ thống.');
    } finally {
      setCfgLoading(false);
    }
  };

  useEffect(() => {
    if (subTab === 'CONFIG' && isAdmin) {
      void loadAdminConfigAndOutbox();
    }
  }, [subTab, isAdmin]);

  const handleSaveSystemConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    setSavingCfg(true);
    try {
      const res = await apiClient.put<{
        success: boolean;
        config: Record<string, string>;
      }>('/config', cfgMap);
      setCfgMap((prev) => ({ ...prev, ...(res.config || {}) }));
      toast.success('Đã lưu toàn bộ Cấu hình Hệ thống, Phụ cấp Ăn ca & Chế độ Bảo mật PIN.');
      await refreshSession();
      await onRefreshBootstrap();
    } catch (err: any) {
      toast.error(err?.message || 'Không thể lưu cấu hình hệ thống.');
    } finally {
      setSavingCfg(false);
    }
  };

  const handleToggleAuthModeQuick = async (nextMode: 'DEMO_QUICK' | 'STRICT_PIN') => {
    if (!isAdmin) return;
    const updated = { ...cfgMap, AUTH_MODE: nextMode };
    setCfgMap(updated);
    try {
      await apiClient.put('/config', { AUTH_MODE: nextMode });
      toast.success(
        nextMode === 'STRICT_PIN'
          ? '🔒 Đã BẬT chế độ Strict PIN Mode (Bắt buộc nhập PIN thực tế tại xưởng).'
          : '⚡ Đã chuyển sang chế độ Demo Quick-Switch (1 chạm đổi vai trò).'
      );
      await refreshSession();
      await onRefreshBootstrap();
    } catch (err: any) {
      toast.error(err?.message || 'Lỗi chuyển đổi chế độ xác thực.');
    }
  };

  const handleFlushOutbox = async () => {
    if (!isAdmin) return;
    setFlushingOutbox(true);
    try {
      const res = await apiClient.post<{
        success: boolean;
        sentCount?: number;
        skippedCount?: number;
        failedCount?: number;
        items: SyncOutboxItem[];
      }>('/sync/flush', {});
      setOutboxItems(res.items || []);
      toast.success(
        `Đồng bộ đám mây hoàn tất: Gửi ${res.sentCount ?? 0} | Bỏ qua ${res.skippedCount ?? 0} | Lỗi ${res.failedCount ?? 0}`
      );
    } catch (err: any) {
      toast.error(err?.message || 'Lỗi đẩy hàng đợi đồng bộ đám mây.');
    } finally {
      setFlushingOutbox(false);
    }
  };

  const fieldInputCls =
    'min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15';

  return (
    <div className="space-y-4">
      {/* SUB-TAB NAVIGATION BAR */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-2 shadow-card">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSubTab('OPS')}
            className={`inline-flex min-h-[40px] items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-bold transition-colors ${
              subTab === 'OPS'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <Wrench className="h-4 w-4" />
            1. Định Mức Công Nghệ ({operations.length} NC)
          </button>

          <button
            type="button"
            onClick={() => setSubTab('MACHINES_TOOLS')}
            className={`inline-flex min-h-[40px] items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-bold transition-colors ${
              subTab === 'MACHINES_TOOLS'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <Cpu className="h-4 w-4" />
            2. Máy Móc ({machines.length}) &amp; Tủ Dao ({tools.length} mã)
          </button>

          <button
            type="button"
            onClick={() => setSubTab('WORKERS')}
            className={`inline-flex min-h-[40px] items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-bold transition-colors ${
              subTab === 'WORKERS'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <Users className="h-4 w-4" />
            3. Nhân Sự &amp; Tài Khoản PIN ({workers.length})
          </button>

          <button
            type="button"
            onClick={() => setSubTab('CONFIG')}
            className={`inline-flex min-h-[40px] items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-bold transition-colors ${
              subTab === 'CONFIG'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            ⚙️ 4. Cấu Hình Hệ Thống
          </button>

          <button
            type="button"
            onClick={() => setSubTab('TRAINING_SOP')}
            className={`inline-flex min-h-[40px] items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-bold transition-colors ${
              subTab === 'TRAINING_SOP'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-amber-800 bg-amber-50/70 hover:bg-amber-100 border border-amber-200'
            }`}
          >
            📖 5. Hướng Dẫn &amp; Đào Tạo (SOP)
          </button>
        </div>

        <div className="flex items-center gap-2 px-2 text-xs text-slate-600">
          <Badge variant={authMode === 'STRICT_PIN' ? 'warning' : 'info'}>
            {authMode === 'STRICT_PIN' ? '🔒 STRICT PIN' : '⚡ DEMO QUICK'}
          </Badge>
        </div>
      </div>

      {/* ==================== SUB-TAB 1: OPERATIONS 627+ NC ==================== */}
      {subTab === 'OPS' && (
        <div className="space-y-4">
          <Card className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Danh Mục Quy Trình &amp; Định Mức Nguyên Công ({operations.length} NC)
                </h2>
                <p className="text-xs text-slate-500">
                  Tự động đánh thứ tự Bước 1..N, khóa chốt Thành phẩm tại bước cuối cùng và tính đơn
                  giá tiêu chuẩn Giờ công / Máy / Dao cụ.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    void downloadOperationsTemplateExcel()
                      .then(() =>
                        toast.success('Đã tải file Excel mẫu nạp nguyên công (7 cột chuẩn).')
                      )
                      .catch((e) => toast.error(String(e)));
                  }}
                >
                  <Download className="h-4 w-4 text-emerald-600" />
                  📄 Tải File Excel Mẫu (7 cột)
                </Button>

                {canManageOps && (
                  <>
                    <input
                      ref={xlsxInputRef}
                      type="file"
                      accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                      onChange={handleExcelFileSelected}
                      className="hidden"
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => xlsxInputRef.current?.click()}
                    >
                      <Upload className="h-4 w-4 text-blue-600" />
                      Nạp từ Excel (.xlsx)
                    </Button>

                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => setCreateOpOpen(true)}
                    >
                      <Plus className="h-4 w-4" />
                      Khai Báo Nhanh Nhiều NC
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* Search & Filters */}
            <div className="grid grid-cols-1 gap-2.5 md:grid-cols-12">
              <div className="relative md:col-span-5">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  value={opSearch}
                  onChange={(e) => setOpSearch(e.target.value)}
                  placeholder="Tìm không dấu: mã NC, SP, tên chi tiết, nguyên công, máy, dao cụ..."
                  className="min-h-[40px] w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
                />
              </div>

              <div className="md:col-span-3">
                <select
                  value={opCustomerFilter}
                  onChange={(e) => setOpCustomerFilter(e.target.value)}
                  className="min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-800 focus:border-blue-600 focus:outline-none"
                >
                  <option value="ALL">Tất cả Khách hàng ({uniqueCustomers.length})</option>
                  {uniqueCustomers.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-2">
                <select
                  value={opMachineFilter}
                  onChange={(e) => setOpMachineFilter(e.target.value)}
                  className="min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-800 focus:border-blue-600 focus:outline-none"
                >
                  <option value="ALL">Tất cả Máy ({machines.length})</option>
                  {machines.map((m) => (
                    <option key={m.id} value={m.name}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-2">
                <button
                  type="button"
                  onClick={() => setOpCriticalOnly((v) => !v)}
                  className={`flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-lg border px-2.5 text-xs font-bold transition-colors ${
                    opCriticalOnly
                      ? 'border-amber-500 bg-amber-50 text-amber-800'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <Star className="h-3.5 w-3.5 text-amber-500" />
                  Điểm đo ★ Kiểm chặt
                </button>
              </div>
            </div>
          </Card>

          <Card noPadding className="overflow-hidden">
            <div className="max-h-[620px] overflow-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="sticky top-0 z-20 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-600 shadow-sm">
                  <tr className="border-b border-slate-200">
                    <th className="px-3 py-2.5">Mã NC / SP</th>
                    <th className="px-3 py-2.5">Khách hàng &amp; Tên Sản Phẩm</th>
                    <th className="px-3 py-2.5">Thứ tự &amp; Tên Nguyên Công</th>
                    <th className="px-3 py-2.5 text-right">ĐM Giây (Giờ)</th>
                    <th className="px-3 py-2.5">Máy Mặc Định</th>
                    <th className="px-3 py-2.5">Dao Cụ &amp; Chế Độ Cắt</th>
                    <th className="px-3 py-2.5 text-right">Đơn Giá ĐM/SP</th>
                    <th className="px-3 py-2.5 text-center">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {pagedOperations.map((op) => {
                    const stdUnitSum =
                      Number(op.stdLaborCost || 0) +
                      Number(op.stdMachCost || 0) +
                      Number(op.stdToolCost || 0);
                    return (
                      <tr
                        key={op.ncId}
                        className="transition-colors hover:bg-blue-50/50"
                      >
                        <td className="whitespace-nowrap px-3 py-2.5">
                          <div className="font-mono-num font-bold text-blue-700">
                            {op.ncId}
                          </div>
                          <div className="font-mono-num text-[11px] text-slate-500">
                            {op.spId}
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="font-semibold text-slate-900">
                            {op.productName}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {op.customer} · {op.matName}
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge variant="neutral">Bước {op.stepOrder}</Badge>
                            {Boolean(op.isFinalOp) && (
                              <Badge variant="success">Chốt TP</Badge>
                            )}
                            {Boolean(op.isCriticalCheck) && (
                              <Badge variant="warning">★ Kiểm chặt ±0.01</Badge>
                            )}
                          </div>
                          <div className="mt-1 font-medium text-slate-800">
                            {op.opName}
                          </div>
                        </td>
                        <td className="font-mono-num whitespace-nowrap px-3 py-2.5 text-right">
                          <div className="font-bold text-emerald-700">
                            {formatNumber(op.stdSeconds)}s
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {(op.stdSeconds / 3600).toFixed(2)}h
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5">
                          <Badge variant="info">{op.defaultMachine}</Badge>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="font-mono-num font-semibold text-amber-800">
                            {op.toolCode}{' '}
                            {op.toolName ? (
                              <span className="font-sans font-normal text-slate-600">
                                — {op.toolName}
                              </span>
                            ) : null}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {op.cuttingRec || 'Vc=100m/p | f=0.15mm/v'}
                          </div>
                        </td>
                        <td className="font-mono-num whitespace-nowrap px-3 py-2.5 text-right">
                          <div className="font-semibold text-slate-900">
                            {formatVnd(stdUnitSum)}
                          </div>
                          <div className="text-[10px] text-slate-500">
                            Công {formatNumber(op.stdLaborCost)} | Máy{' '}
                            {formatNumber(op.stdMachCost)}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-center">
                          <div className="inline-flex items-center gap-1">
                            {canManageOps && (
                              <button
                                type="button"
                                onClick={() => openEditOpModal(op)}
                                className="inline-flex h-7 items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 text-[11px] font-semibold text-blue-700 transition-colors hover:bg-blue-100"
                                title="Sửa định mức & máy mặc định"
                              >
                                <Edit3 className="h-3 w-3" /> Sửa
                              </button>
                            )}
                            {canDeleteOpsOrAddMachine && (
                              <button
                                type="button"
                                onClick={() => setDeletingOp(op)}
                                className="inline-flex h-7 items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2 text-[11px] font-semibold text-rose-700 transition-colors hover:bg-rose-100"
                                title="Xóa nguyên công"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {pagedOperations.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-10 text-center text-sm text-slate-500">
                        Không tìm thấy nguyên công phù hợp bộ lọc.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <PaginationBar
              totalItems={filteredOperations.length}
              page={opPage}
              pageSize={opPageSize}
              onPageChange={setOpPage}
              onPageSizeChange={setOpPageSize}
            />
          </Card>
        </div>
      )}

      {/* ==================== SUB-TAB 2: MACHINES & 1-FOR-1 TOOL CABINET ==================== */}
      {subTab === 'MACHINES_TOOLS' && (
        <div className="space-y-5">
          {/* SECTION A: MACHINES */}
          <Card noPadding className="overflow-hidden">
            <div className="space-y-3 border-b border-slate-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    Danh Mục Máy Gia Công &amp; Đơn Giá Giờ Máy ({machines.length} Máy)
                  </h2>
                  <p className="text-xs text-slate-500">
                    Công suất chuẩn 2 ca: <strong className="text-slate-800">16h / ngày</strong>{' '}
                    (96h / tuần 6 ngày). Dùng để tính tải nghẽn cổ chai &amp; khấu hao chi phí giờ
                    máy thực tế.
                  </p>
                </div>
                {canDeleteOpsOrAddMachine && (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => setAddMachOpen(true)}
                  >
                    <Plus className="h-4 w-4" />
                    Thêm Máy Mới
                  </Button>
                )}
              </div>

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-12">
                <div className="relative sm:col-span-7">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    value={machSearch}
                    onChange={(e) => {
                      setMachSearch(e.target.value);
                      setMachPage(1);
                    }}
                    placeholder="Tìm tên máy, mã máy, nhóm công nghệ, người đang chạy..."
                    className="min-h-[38px] w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
                  />
                </div>
                <div className="sm:col-span-5">
                  <select
                    value={machStatusFilter}
                    onChange={(e) => {
                      setMachStatusFilter(e.target.value as 'ALL' | MachineStatus);
                      setMachPage(1);
                    }}
                    className="min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-800 focus:border-blue-600 focus:outline-none"
                  >
                    <option value="ALL">Tất cả Trạng thái Máy ({machines.length})</option>
                    <option value="RUNNING">🟢 ĐANG CHẠY (RUNNING)</option>
                    <option value="SETUP">🟡 ĐANG GÁ ĐẶT (SETUP)</option>
                    <option value="STOPPED">🔴 DỪNG SỰ CỐ (STOPPED)</option>
                    <option value="IDLE">⚪ CHỜ PHÔI / RẢNH (IDLE)</option>
                    <option value="MAINTENANCE">🟣 BẢO TRÌ (MAINTENANCE)</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="max-h-[400px] overflow-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="sticky top-0 z-10 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-600">
                  <tr className="border-b border-slate-200">
                    <th className="px-3 py-2.5">Mã</th>
                    <th className="px-3 py-2.5">Tên Thiết Bị / Máy</th>
                    <th className="px-3 py-2.5">Nhóm Công Nghệ</th>
                    <th className="px-3 py-2.5 text-right">Đơn Giá Giờ Máy</th>
                    <th className="px-3 py-2.5 text-center">Công Suất Chuẩn</th>
                    <th className="px-3 py-2.5">Trạng Thái Hiện Tại</th>
                    <th className="px-3 py-2.5">Phiên Đứng Máy / Cảnh Báo</th>
                    <th className="px-3 py-2.5 text-center">Cập nhật</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {pagedMachines.map((m) => {
                    const st = (m.status || 'IDLE') as MachineStatus;
                    const meta = MACHINE_STATUS_LABELS[st] || MACHINE_STATUS_LABELS.IDLE;
                    return (
                      <tr key={m.id} className="transition-colors hover:bg-blue-50/50">
                        <td className="font-mono-num px-3 py-2.5 font-bold text-blue-700">
                          {m.id}
                        </td>
                        <td className="px-3 py-2.5 font-semibold text-slate-900">
                          {m.name}
                        </td>
                        <td className="px-3 py-2.5 text-slate-700">{m.group}</td>
                        <td className="font-mono-num px-3 py-2.5 text-right font-bold text-emerald-700">
                          {formatVnd(m.costPerHour)}/h
                        </td>
                        <td className="font-mono-num px-3 py-2.5 text-center text-slate-600">
                          16h/ngày · 96h/tuần
                        </td>
                        <td className="px-3 py-2.5">
                          <Badge variant={meta.badge}>{meta.label}</Badge>
                        </td>
                        <td className="px-3 py-2.5 text-slate-700">
                          {m.currentWorkerName ? (
                            <span>
                              👷 <strong>{m.currentWorkerName}</strong>{' '}
                              {m.currentPoId ? `(${m.currentPoId})` : ''}
                            </span>
                          ) : m.stopReason ? (
                            <span className="font-semibold text-rose-700">⚠️ {m.stopReason}</span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {canManageOps && (
                            <button
                              type="button"
                              onClick={() => openEditMachineModal(m)}
                              className="inline-flex h-7 items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2.5 text-[11px] font-semibold text-blue-700 transition-colors hover:bg-blue-100"
                            >
                              <Edit3 className="h-3 w-3" /> Cấu hình
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <PaginationBar
              totalItems={filteredMachines.length}
              page={machPage}
              pageSize={machPageSize}
              onPageChange={setMachPage}
              onPageSizeChange={setMachPageSize}
            />
          </Card>

          {/* SECTION B: 118+ CUTTING TOOLS & 1-FOR-1 INSERT SWAP */}
          <Card noPadding className="overflow-hidden">
            <div className="space-y-3 border-b border-slate-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    Tủ Dao Cụ CNC &amp; Sổ Cấp Đổi Mảnh Chíp 1-Đổi-1 ({tools.length} Mã Dao)
                  </h2>
                  <p className="text-xs text-slate-500">
                    Kiểm soát chặt hao phí mảnh hợp kim: Thu hồi xác mảnh mòn/vỡ cũ trước khi xuất
                    mảnh mới ra máy.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2.5 md:grid-cols-12">
                <div className="relative md:col-span-6">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    value={toolSearch}
                    onChange={(e) => setToolSearch(e.target.value)}
                    placeholder="Tìm mã dao (T01..T63, TP, DR), tên chíp tiện/phay/khoan, ký hiệu ISO..."
                    className="min-h-[38px] w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
                  />
                </div>
                <div className="md:col-span-4">
                  <select
                    value={toolGroupFilter}
                    onChange={(e) => setToolGroupFilter(e.target.value)}
                    className="min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-800 focus:border-blue-600 focus:outline-none"
                  >
                    <option value="ALL">Tất cả Nhóm Dao Cụ ({toolGroups.length})</option>
                    {toolGroups.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-2">
                  <button
                    type="button"
                    onClick={() => setToolLowStockOnly((v) => !v)}
                    className={`flex min-h-[38px] w-full items-center justify-center gap-1.5 rounded-lg border px-2.5 text-xs font-bold transition-colors ${
                      toolLowStockOnly
                        ? 'border-rose-500 bg-rose-50 text-rose-700'
                        : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                    Sắp hết (&le;10)
                  </button>
                </div>
              </div>
            </div>

            <div className="max-h-[440px] overflow-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="sticky top-0 z-10 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-600">
                  <tr className="border-b border-slate-200">
                    <th className="px-3 py-2.5">Mã Dao</th>
                    <th className="px-3 py-2.5">Nhóm</th>
                    <th className="px-3 py-2.5">Tên Mảnh Hợp Kim / Dao Cụ</th>
                    <th className="px-3 py-2.5 text-right">Giá Mua / Mảnh</th>
                    <th className="px-3 py-2.5 text-center">Số Góc / Mảnh</th>
                    <th className="px-3 py-2.5 text-right">Đơn Giá / Góc Cắt</th>
                    <th className="px-3 py-2.5 text-center">Tồn Tủ Dao</th>
                    <th className="px-3 py-2.5 text-center">Cấp Đổi 1-1</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {pagedTools.map((t) => {
                    const stock = Number(t.stockQty ?? 0);
                    return (
                      <tr key={t.code} className="transition-colors hover:bg-blue-50/50">
                        <td className="font-mono-num px-3 py-2.5 font-bold text-amber-800">
                          {t.code}
                        </td>
                        <td className="px-3 py-2.5 text-slate-600">{t.group}</td>
                        <td className="px-3 py-2.5 font-semibold text-slate-900">
                          {t.name}
                        </td>
                        <td className="font-mono-num px-3 py-2.5 text-right text-slate-700">
                          {formatVnd(t.buyPrice)}
                        </td>
                        <td className="font-mono-num px-3 py-2.5 text-center text-slate-600">
                          {t.edges} góc
                        </td>
                        <td className="font-mono-num px-3 py-2.5 text-right font-bold text-blue-700">
                          {formatVnd(t.costPerEdge)}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <Badge
                            variant={
                              stock <= 5
                                ? 'danger'
                                : stock <= 12
                                  ? 'warning'
                                  : 'success'
                            }
                            className="font-mono-num"
                          >
                            {stock} mảnh
                          </Badge>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <button
                            type="button"
                            onClick={() => openSwapModal(t)}
                            className="inline-flex h-7 items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 text-[11px] font-bold text-emerald-700 transition-colors hover:bg-emerald-100"
                          >
                            <Repeat className="h-3.5 w-3.5" /> Cấp 1-Đổi-1
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <PaginationBar
              totalItems={filteredTools.length}
              page={toolPage}
              pageSize={toolPageSize}
              onPageChange={setToolPage}
              onPageSizeChange={setToolPageSize}
            />
          </Card>

          {sessionSwaps.length > 0 && (
            <Card className="space-y-2.5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-700">
                Nhật Ký Vừa Xuất Đổi Mảnh Tại Tủ Dao Trong Ca ({sessionSwaps.length})
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                    <tr>
                      <th className="py-1.5 pr-3">Giờ cấp</th>
                      <th className="py-1.5 pr-3">Mã Dao</th>
                      <th className="py-1.5 pr-3">Máy nhận</th>
                      <th className="py-1.5 pr-3 text-center">SL cấp</th>
                      <th className="py-1.5 pr-3">Thu hồi xác cũ</th>
                      <th className="py-1.5 pr-3">Lý do</th>
                      <th className="py-1.5 text-right">Tồn còn lại</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {sessionSwaps.map((s) => (
                      <tr key={s.id}>
                        <td className="font-mono-num py-1.5 pr-3 text-slate-500">
                          {s.time}
                        </td>
                        <td className="font-mono-num py-1.5 pr-3 font-bold text-amber-800">
                          {s.toolCode} — {s.toolName}
                        </td>
                        <td className="py-1.5 pr-3 font-medium text-slate-800">{s.machineName}</td>
                        <td className="font-mono-num py-1.5 pr-3 text-center font-bold text-emerald-700">
                          {s.qtyIssued}
                        </td>
                        <td className="py-1.5 pr-3">
                          {s.oldInsertReturned ? (
                            <Badge variant="success">Đã thu xác cũ 1-1</Badge>
                          ) : (
                            <Badge variant="warning">Ngoại lệ Quản đốc</Badge>
                          )}
                        </td>
                        <td className="py-1.5 pr-3 text-slate-700">{s.reason}</td>
                        <td className="font-mono-num py-1.5 text-right font-bold text-blue-700">
                          {s.remainingStock} mảnh
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ==================== SUB-TAB 3: WORKERS & PIN ACCOUNTS ==================== */}
      {subTab === 'WORKERS' && (
        <div className="space-y-4">
          {!isAdmin && (
            <Card className="flex flex-wrap items-center justify-between gap-3 border-amber-200 bg-amber-50/70">
              <div className="flex items-center gap-3">
                <Lock className="h-5 w-5 shrink-0 text-amber-600" />
                <div className="text-xs text-amber-900">
                  <strong>Phân quyền Bảo mật Lương &amp; PIN:</strong> Chỉ Quản đốc / Admin mới được
                  xem đơn giá lương cơ bản 8h và cấp đổi mã PIN đăng nhập của nhân sự.
                </div>
              </div>
              <div className="flex items-center gap-2">
                {authMode === 'DEMO_QUICK' && (
                  <Button
                    variant="warning"
                    size="sm"
                    onClick={() => void quickSwitch({ workerId: 'NV00053' })}
                  >
                    Chuyển 1-Click sang Quản đốc (NV00053)
                  </Button>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => openPinModal('NV00053')}
                >
                  <KeyRound className="h-3.5 w-3.5" /> Mở khóa PIN Admin
                </Button>
              </div>
            </Card>
          )}

          <Card className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Danh Sách Nhân Sự Xưởng &amp; Tài Khoản PIN ({workers.length} Nhân Sự)
                </h2>
                <p className="text-xs text-slate-500">
                  Quản lý hồ sơ nhân viên đứng máy, tổ/bộ phận, đơn giá lương P1 (ca 8h) và cấp đổi
                  mã PIN bảo mật cá nhân.
                </p>
              </div>
              {isAdmin && (
                <Button variant="primary" size="sm" onClick={openCreateWorkerModal}>
                  <Plus className="h-4 w-4" />
                  Thêm Nhân Sự Mới
                </Button>
              )}
            </div>

            <div className="relative max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={workerSearch}
                onChange={(e) => setWorkerSearch(e.target.value)}
                placeholder="Tìm Mã NV, Họ tên, Chức danh, Chế độ lương..."
                className="min-h-[40px] w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
              />
            </div>
          </Card>

          <Card noPadding className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="sticky top-0 z-10 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-600">
                  <tr className="border-b border-slate-200">
                    <th className="px-3 py-2.5">Mã NV</th>
                    <th className="px-3 py-2.5">Họ &amp; Tên</th>
                    <th className="px-3 py-2.5">Tổ / Bộ Phận</th>
                    <th className="px-3 py-2.5">Vai Trò &amp; Chế Độ Lương</th>
                    <th className="px-3 py-2.5 text-right">Lương P1 (Ca 8h)</th>
                    <th className="px-3 py-2.5 text-center">Trạng Thái PIN</th>
                    <th className="px-3 py-2.5 text-center">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {filteredWorkers.map((w) => (
                    <tr key={w.id} className="transition-colors hover:bg-blue-50/50">
                      <td className="font-mono-num px-3 py-2.5 font-bold text-blue-700">
                        {w.id}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="font-semibold text-slate-900">{w.name}</div>
                        <div className="font-mono-num text-[11px] text-slate-500">
                          @{w.username}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 font-medium text-slate-700">{w.title}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge
                            variant={
                              w.appRole === 'ADMIN'
                                ? 'purple'
                                : w.appRole === 'SHIFT_LEADER'
                                  ? 'warning'
                                  : w.appRole === 'QC'
                                    ? 'info'
                                    : 'neutral'
                            }
                          >
                            {w.role}
                          </Badge>
                          <Badge
                            variant={
                              w.salaryMode?.includes('Hành chính') ? 'info' : 'success'
                            }
                          >
                            {w.salaryMode}
                          </Badge>
                        </div>
                      </td>
                      <td className="font-mono-num px-3 py-2.5 text-right">
                        <div className="font-bold text-emerald-700">
                          {w.baseSalary !== undefined ? formatVnd(w.baseSalary) : '🔒 Bảo mật'}
                        </div>
                        {w.costPerSec !== undefined && (
                          <div className="text-[11px] text-slate-500">{w.costPerSec} đ/s</div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <Badge variant="success">🔒 Đã kích hoạt PIN</Badge>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {isAdmin ? (
                          <button
                            type="button"
                            onClick={() => openEditWorkerModal(w)}
                            className="inline-flex h-7 items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2.5 text-[11px] font-semibold text-blue-700 transition-colors hover:bg-blue-100"
                          >
                            <Edit3 className="h-3 w-3" /> Sửa / Đổi PIN
                          </button>
                        ) : (
                          <span className="text-[11px] text-slate-500">Chỉ Admin</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* ==================== SUB-TAB 4: SYSTEM CONFIG ==================== */}
      {subTab === 'CONFIG' && (
        <div className="space-y-4">
          {!isAdmin ? (
            <Card className="space-y-3 border-amber-200 bg-amber-50/70">
              <div className="flex items-center gap-3">
                <Lock className="h-6 w-6 text-amber-600" />
                <div>
                  <h3 className="text-sm font-bold text-amber-900">
                    Khu Vực Cấu Hình Hệ Thống &amp; Bảo Mật Xưởng (Yêu cầu Quyền Quản Đốc / Admin)
                  </h3>
                  <p className="text-xs text-amber-800">
                    Vui lòng xác thực tài khoản Quản đốc (
                    <code className="font-mono-num font-bold">NV00053</code>) để cấu hình chế độ
                    Strict PIN và thông số định mức lương / ăn ca toàn xưởng.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {authMode === 'DEMO_QUICK' && (
                  <Button
                    variant="warning"
                    size="sm"
                    onClick={() => void quickSwitch({ workerId: 'NV00053' })}
                  >
                    ⚡ Chuyển nhanh sang Quản đốc (NV00053)
                  </Button>
                )}
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => openPinModal('NV00053')}
                >
                  <KeyRound className="h-4 w-4" /> Đăng nhập PIN Quản đốc
                </Button>
              </div>
            </Card>
          ) : (
            <>
              {/* SUPABASE CLOUD SYNC CARD */}
              <Card className="border-l-4 border-l-indigo-600 bg-white shadow-sm">
                <form noValidate onSubmit={handleSaveSupabaseConfig} className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 border border-indigo-200">
                        <Zap className="h-4 w-4 fill-indigo-500 text-indigo-600" />
                      </div>
                      <div>
                        <h3 className="text-base font-bold text-slate-900">
                          Cơ Sở Dữ Liệu Đám Mây Supabase (Đồng Bộ Đa Thiết Bị &amp; GitHub Pages)
                        </h3>
                        <p className="text-xs text-slate-500">
                          Kết nối Database PostgreSQL đám mây miễn phí để đồng bộ Báo cáo sản lượng giữa Điện thoại công nhân và Máy tính Quản đốc.
                        </p>
                      </div>
                    </div>
                    <div>
                      {supabaseConnected ? (
                        <Badge variant="success">● Đã kết nối Supabase Cloud</Badge>
                      ) : (
                        <Badge variant="warning">○ Chưa cấu hình (Lưu trữ cục bộ Offline)</Badge>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">
                        Supabase Project URL *
                      </label>
                      <input
                        type="url"
                        value={supabaseUrl}
                        onChange={(e) => setSupabaseUrl(e.target.value)}
                        placeholder="https://xyzcompany.supabase.co"
                        className="font-mono-num min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-900 placeholder:text-slate-400 focus:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-600/15"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">
                        Supabase Anon Key (Public Key) *
                      </label>
                      <div className="relative">
                        <input
                          type={showSupabaseKey ? 'text' : 'password'}
                          value={supabaseKey}
                          onChange={(e) => setSupabaseKey(e.target.value)}
                          placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI..."
                          className="font-mono-num min-h-[40px] w-full rounded-lg border border-slate-300 bg-white pl-3 pr-10 text-xs font-medium text-slate-900 placeholder:text-slate-400 focus:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-600/15"
                        />
                        <button
                          type="button"
                          onClick={() => setShowSupabaseKey((v) => !v)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-900"
                          aria-label="Ẩn/Hiện Supabase Key"
                        >
                          {showSupabaseKey ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <p className="text-[11px] text-slate-500">
                      💡 <strong>Mẹo:</strong> File khởi tạo bảng CSDL có sẵn tại <code className="rounded bg-slate-100 px-1 font-mono-num text-slate-700 font-bold">supabase_schema.sql</code> ở thư mục gốc mã nguồn.
                    </p>
                    <div className="flex items-center gap-2">
                      {supabaseConnected && (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setSupabaseUrl('');
                            setSupabaseKey('');
                            saveStoredSupabaseConfig('', '');
                            setSupabaseConnected(false);
                            toast.warning('Đã ngắt kết nối Supabase Cloud.');
                          }}
                        >
                          Ngắt kết nối
                        </Button>
                      )}
                      <Button
                        type="submit"
                        variant="primary"
                        size="sm"
                        className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold"
                      >
                        <Save className="h-4 w-4" />
                        Lưu Cấu Hình Supabase
                      </Button>
                    </div>
                  </div>
                </form>
              </Card>

              {/* DATABASE BACKUP CARD */}
              <Card className="border-l-4 border-l-emerald-600 bg-white">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="max-w-2xl space-y-1">
                    <div className="flex items-center gap-2">
                      <Download className="h-5 w-5 text-emerald-600" />
                      <h3 className="text-base font-bold text-slate-900">
                        Sao Lưu &amp; Bảo Vệ Cơ Sở Dữ Liệu Xưởng (Database Backup)
                      </h3>
                    </div>
                    <p className="text-xs leading-relaxed text-slate-600">
                      Tải ngay toàn bộ cơ sở dữ liệu SQLite chứa toàn bộ Lệnh PO, Nhật ký sản lượng, Bảng lương và Định mức của xưởng về máy tính hoặc USB để lưu trữ an toàn.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="success"
                    size="md"
                    onClick={() => {
                      const link = document.createElement('a');
                      link.href = '/api/v1/system/backup';
                      link.download = 'gcck_mes_backup.sqlite';
                      document.body.appendChild(link);
                      link.click();
                      document.body.removeChild(link);
                      toast.success('Đang tải về bản sao lưu CSDL (.sqlite)...');
                    }}
                    className="font-bold shadow-sm"
                  >
                    <Download className="h-4 w-4" />
                    📥 Tải Bản Sao Lưu (.sqlite)
                  </Button>
                </div>
              </Card>

              {/* PROMINENT STRICT PIN MODE SWITCH CARD */}
              <Card className="border-l-4 border-l-blue-600">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="max-w-2xl space-y-1">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="h-5 w-5 text-blue-600" />
                      <h3 className="text-base font-bold text-slate-900">
                        Chế Độ Xác Thực Vận Hành Tại Xưởng (Authentication Mode)
                      </h3>
                    </div>
                    <p className="text-xs leading-relaxed text-slate-600">
                      • <strong>⚡ DEMO QUICK-SWITCH:</strong> Vào thẳng không cần mật khẩu, cho
                      phép chuyển nhanh 1 chạm giữa Công nhân / QC / Trưởng ca / Quản đốc để chạy
                      thử nghiệm.
                      <br />• <strong>🔒 STRICT PIN MODE (Vận hành thực tế):</strong> Tắt chuyển
                      nhanh, bắt buộc mọi cá nhân nhập đúng Mã PIN cá nhân (lưu phiên an toàn 30
                      ngày).
                    </p>
                  </div>

                  <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-100 p-1.5">
                    <button
                      type="button"
                      onClick={() => void handleToggleAuthModeQuick('DEMO_QUICK')}
                      className={`min-h-[42px] rounded-lg px-4 text-xs font-bold transition-all ${
                        cfgMap.AUTH_MODE !== 'STRICT_PIN'
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'text-slate-600 hover:bg-white hover:text-slate-900'
                      }`}
                    >
                      ⚡ Demo Quick-Switch
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleToggleAuthModeQuick('STRICT_PIN')}
                      className={`min-h-[42px] rounded-lg px-4 text-xs font-bold transition-all ${
                        cfgMap.AUTH_MODE === 'STRICT_PIN'
                          ? 'bg-amber-500 text-slate-950 shadow-sm'
                          : 'text-slate-600 hover:bg-white hover:text-slate-900'
                      }`}
                    >
                      🔒 Bật Strict PIN Mode
                    </button>
                  </div>
                </div>
              </Card>

              {/* UNIFIED PAYROLL / MEAL FORM + COLLAPSED OPTIONAL INTEGRATIONS */}
              <form noValidate onSubmit={handleSaveSystemConfig} className="space-y-4">
                <Card className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">
                        1. Định Mức Lương Khoán, Giờ Chuẩn Ca &amp; Phụ Cấp Ăn Ca Toàn Xưởng
                      </h3>
                      <p className="mt-0.5 text-xs text-slate-500">
                        Áp dụng thống nhất tức thì cho cả Báo cáo Sản lượng, Bảng chấm công 31 ngày
                        và Bảng lương KPI 3P.
                      </p>
                    </div>
                    <Badge variant="success">Đồng bộ cả Nhật ký &amp; Bảng công</Badge>
                  </div>

                  <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">
                        Ăn ca Đêm / Chiều (Ca 2 &amp; Ca 3) (VNĐ)
                      </label>
                      <input
                        type="number"
                        step="any"
                        value={cfgMap.MEAL_SHIFT_2_3 || '25000'}
                        onChange={(e) =>
                          setCfgMap((p) => ({ ...p, MEAL_SHIFT_2_3: e.target.value }))
                        }
                        className="font-mono-num min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-emerald-700 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">
                        Ăn tăng ca ngày thường (&ge; 2 giờ OT) (VNĐ)
                      </label>
                      <input
                        type="number"
                        step="any"
                        value={cfgMap.MEAL_OT_2H || '30000'}
                        onChange={(e) =>
                          setCfgMap((p) => ({ ...p, MEAL_OT_2H: e.target.value }))
                        }
                        className="font-mono-num min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-emerald-700 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">
                        Phụ cấp Ăn ca Chủ Nhật (&ge; 4 giờ) (VNĐ)
                      </label>
                      <input
                        type="number"
                        step="any"
                        value={cfgMap.MEAL_SUNDAY || '25000'}
                        onChange={(e) =>
                          setCfgMap((p) => ({ ...p, MEAL_SUNDAY: e.target.value }))
                        }
                        className="font-mono-num min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-emerald-700 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">
                        Hệ số Đứng Máy Thứ 2 (Khoán 1 + X máy)
                      </label>
                      <input
                        type="number"
                        step="any"
                        value={cfgMap.SECOND_MACHINE_RATE || '0.33'}
                        onChange={(e) =>
                          setCfgMap((p) => ({ ...p, SECOND_MACHINE_RATE: e.target.value }))
                        }
                        className="font-mono-num min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-blue-700 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">
                        Số giây chuẩn / Ca 8h (Mặc định 28800s)
                      </label>
                      <input
                        type="number"
                        step="any"
                        value={cfgMap.SECONDS_PER_SHIFT || '28800'}
                        onChange={(e) =>
                          setCfgMap((p) => ({ ...p, SECONDS_PER_SHIFT: e.target.value }))
                        }
                        className="font-mono-num min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">
                        Ngưỡng cảnh báo chưa đạt ĐM (Hệ số, VD: 0.85 = 85%)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0.1"
                        max="2"
                        value={cfgMap.KPI_WARNING_THRESHOLD || '0.85'}
                        onChange={(e) =>
                          setCfgMap((p) => ({ ...p, KPI_WARNING_THRESHOLD: e.target.value }))
                        }
                        className="font-mono-num min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-amber-800 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-end border-t border-slate-100 pt-3">
                    <Button type="submit" variant="primary" disabled={savingCfg || cfgLoading}>
                      <Save className="h-4 w-4" />
                      {savingCfg ? 'Đang lưu cấu hình...' : '💾 Lưu Cấu Hình Hệ Thống'}
                    </Button>
                  </div>
                </Card>

                {/* COLLAPSED OPTIONAL INTEGRATIONS ACCORDION (DEFAULT-CLOSED) */}
                <details className="rounded-2xl border border-slate-200 bg-white shadow-card">
                  <summary className="cursor-pointer select-none px-5 py-4 text-sm font-bold text-slate-700 transition-colors hover:text-slate-900">
                    🔌 Kết nối mở rộng: Telegram Bot, Google Sheets Webhook &amp; Đồng bộ Đám mây
                    (Tùy chọn — Cài đặt sau)
                  </summary>

                  <div className="space-y-5 border-t border-slate-200 p-5">
                    <div className="space-y-3.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h4 className="text-sm font-bold text-slate-900">
                          A. Kết Nối Google Apps Script Webhook &amp; Telegram Bot (Phía Máy Chủ)
                        </h4>
                        <Badge variant="info">Bảo mật khóa kết nối tại máy chủ</Badge>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5">
                        <div>
                          <div className="text-xs font-bold text-slate-900">
                            Đồng bộ tự động lên Google Sheets (Apps Script /exec)
                          </div>
                          <div className="text-[11px] text-slate-500">
                            Lưu cơ sở dữ liệu nội bộ tức thì, sau đó đẩy nền bất đồng bộ lên đám mây
                          </div>
                        </div>
                        <select
                          value={cfgMap.GAS_SYNC_ENABLED || '0'}
                          onChange={(e) =>
                            setCfgMap((p) => ({ ...p, GAS_SYNC_ENABLED: e.target.value }))
                          }
                          className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-bold text-blue-700 focus:border-blue-600 focus:outline-none"
                        >
                          <option value="0">Tắt (Chỉ lưu nội bộ tại xưởng)</option>
                          <option value="1">Bật Đồng Bộ Đám Mây</option>
                        </select>
                      </div>

                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <div>
                          <label className="mb-1 block text-xs font-semibold text-slate-700">
                            Google Apps Script Web App URL (/exec)
                          </label>
                          <input
                            type="url"
                            value={cfgMap.WEB_APP_URL || ''}
                            onChange={(e) =>
                              setCfgMap((p) => ({ ...p, WEB_APP_URL: e.target.value }))
                            }
                            placeholder="https://script.google.com/macros/s/.../exec"
                            className="font-mono-num min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
                          />
                        </div>

                        <div>
                          <label className="mb-1 block text-xs font-semibold text-slate-700">
                            Telegram Bot Token
                          </label>
                          <div className="relative">
                            <input
                              type={showBotToken ? 'text' : 'password'}
                              value={cfgMap.TELEGRAM_BOT_TOKEN || ''}
                              onChange={(e) =>
                                setCfgMap((p) => ({ ...p, TELEGRAM_BOT_TOKEN: e.target.value }))
                              }
                              placeholder="123456789:AAH..."
                              className="font-mono-num min-h-[38px] w-full rounded-lg border border-slate-300 bg-white pl-3 pr-10 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => setShowBotToken((v) => !v)}
                              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-900"
                              aria-label="Ẩn/Hiện Bot Token"
                            >
                              {showBotToken ? (
                                <EyeOff className="h-4 w-4" />
                              ) : (
                                <Eye className="h-4 w-4" />
                              )}
                            </button>
                          </div>
                        </div>

                        <div>
                          <label className="mb-1 block text-xs font-semibold text-slate-700">
                            Username Bot (@...)
                          </label>
                          <input
                            type="text"
                            value={cfgMap.TELEGRAM_BOT_USERNAME || ''}
                            onChange={(e) =>
                              setCfgMap((p) => ({
                                ...p,
                                TELEGRAM_BOT_USERNAME: e.target.value,
                              }))
                            }
                            placeholder="ThangLoiMesBot"
                            className="font-mono-num min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
                          />
                        </div>

                        <div>
                          <label className="mb-1 block text-xs font-semibold text-slate-700">
                            Chat ID Nhóm Quản Đốc / QC
                          </label>
                          <input
                            type="text"
                            value={cfgMap.MANAGER_CHAT_ID || ''}
                            onChange={(e) =>
                              setCfgMap((p) => ({ ...p, MANAGER_CHAT_ID: e.target.value }))
                            }
                            placeholder="-100192837465"
                            className="font-mono-num min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
                          />
                        </div>
                      </div>

                      <div className="flex justify-end">
                        <Button
                          type="submit"
                          variant="secondary"
                          size="sm"
                          disabled={savingCfg || cfgLoading}
                        >
                          <Save className="h-4 w-4" />
                          Lưu Cấu Hình Kết Nối Mở Rộng
                        </Button>
                      </div>
                    </div>

                    {/* CLOUD SYNC QUEUE VIEWER */}
                    <div className="overflow-hidden rounded-xl border border-slate-200">
                      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
                        <div>
                          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                            B. Hàng Đợi Đồng Bộ Đám Mây ({outboxItems.length} bản ghi gần nhất)
                          </h4>
                          <p className="text-[11px] text-slate-500">
                            Đảm bảo công nhân bấm Gửi Báo Cáo không bao giờ bị treo chờ mạng ngoài.
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={cfgLoading}
                            onClick={() => void loadAdminConfigAndOutbox()}
                          >
                            <RefreshCw className="h-3.5 w-3.5" /> Làm mới
                          </Button>
                          <Button
                            variant="success"
                            size="sm"
                            disabled={flushingOutbox}
                            onClick={() => void handleFlushOutbox()}
                          >
                            <Send className="h-3.5 w-3.5" />
                            {flushingOutbox ? 'Đang đẩy...' : '🚀 Đẩy Đồng Bộ Ngay'}
                          </Button>
                        </div>
                      </div>

                      <div className="max-h-[280px] overflow-auto bg-white">
                        <table className="w-full border-collapse text-left text-xs">
                          <thead className="sticky top-0 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-600">
                            <tr className="border-b border-slate-200">
                              <th className="px-3 py-2">ID</th>
                              <th className="px-3 py-2">Kênh Đích</th>
                              <th className="px-3 py-2">Sự Kiện</th>
                              <th className="px-3 py-2 text-center">Trạng Thái</th>
                              <th className="px-3 py-2 text-center">Lần Thử</th>
                              <th className="px-3 py-2">Thời Gian Tạo / Gửi</th>
                              <th className="px-3 py-2">Chi Tiết / Phản Hồi</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200">
                            {outboxItems.map((item) => (
                              <tr key={item.id} className="hover:bg-slate-50">
                                <td className="font-mono-num px-3 py-2 text-slate-500">
                                  #{item.id}
                                </td>
                                <td className="px-3 py-2">
                                  <Badge
                                    variant={
                                      item.channel === 'GAS_WEBHOOK' ? 'info' : 'purple'
                                    }
                                  >
                                    {item.channel}
                                  </Badge>
                                </td>
                                <td className="font-mono-num px-3 py-2 font-semibold text-slate-800">
                                  {item.eventType}
                                </td>
                                <td className="px-3 py-2 text-center">
                                  <Badge
                                    variant={
                                      item.status === 'SENT'
                                        ? 'success'
                                        : item.status === 'PENDING'
                                          ? 'warning'
                                          : item.status === 'FAILED'
                                            ? 'danger'
                                            : 'neutral'
                                    }
                                  >
                                    {item.status}
                                  </Badge>
                                </td>
                                <td className="font-mono-num px-3 py-2 text-center text-slate-700">
                                  {item.attempts}
                                </td>
                                <td className="font-mono-num px-3 py-2 text-[11px] text-slate-500">
                                  <div>Tạo: {item.createdAt}</div>
                                  {item.sentAt && <div>Gửi: {item.sentAt}</div>}
                                </td>
                                <td className="max-w-xs truncate px-3 py-2 text-[11px] text-slate-700">
                                  {item.lastError || 'OK'}
                                </td>
                              </tr>
                            ))}
                            {outboxItems.length === 0 && (
                              <tr>
                                <td colSpan={7} className="py-8 text-center text-slate-500">
                                  Hàng đợi đồng bộ đám mây hiện đang trống.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </details>
              </form>
            </>
          )}
        </div>
      )}

      {/* ==================== SUB-TAB 5: HƯỚNG DẪN & ĐÀO TẠO (SOP) ==================== */}
      {subTab === 'TRAINING_SOP' && (
        <div className="space-y-6">
          <Card className="border-l-4 border-l-amber-500 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500 text-white font-black text-sm">SOP</span>
                  <h2 className="text-base font-extrabold text-slate-900">
                    Trung Tâm Đào Tạo Thực Chiến &amp; Quy Trình Vận Hành Tiêu Chuẩn (SOP)
                  </h2>
                </div>
                <p className="mt-1 text-xs text-slate-600">
                  Tài liệu quy trình chuẩn hóa dành cho Công nhân đứng máy, Tổ trưởng QC và Quản đốc xưởng Cơ khí Chính xác Thắng Lợi.
                </p>
              </div>

              <Button
                variant="secondary"
                size="sm"
                onClick={() => window.print()}
                className="font-bold text-slate-800 border-slate-300"
              >
                <Printer className="h-4 w-4 text-blue-600" />
                🖨️ In Tài Liệu A4 Dán Xưởng
              </Button>
            </div>
          </Card>

          {/* Module 1: Worker 8 Steps */}
          <Card className="space-y-4 border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <span className="rounded-lg bg-emerald-100 px-2.5 py-1 text-xs font-black text-emerald-800">
                  PHẦN 1
                </span>
                <h3 className="text-sm font-black text-slate-900 uppercase">
                  👷 Cẩm Nang 8 Bước Báo Cáo Nhanh Cho Công Nhân Đứng Máy (&le;20 giây)
                </h3>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-3.5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-black text-white">BƯỚC 1</span>
                  <span className="text-[11px] font-bold text-blue-700">Khách Hàng &amp; SP</span>
                </div>
                <div className="text-xs font-bold text-slate-900">Chọn Sản Phẩm / Bản Vẽ</div>
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  Bấm chọn tên Khách hàng (Đại Phú, TFG, Win-Win...) ➔ Chọn tên bản vẽ chi tiết mà không cần gõ phím.
                </p>
              </div>

              <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3.5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-black text-white">BƯỚC 2</span>
                  <span className="text-[11px] font-bold text-emerald-700">Máy Vận Hành</span>
                </div>
                <div className="text-xs font-bold text-slate-900">Chọn Máy CNC Đứng Ca</div>
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  Chọn đúng máy bạn đang làm việc (Máy tiện FUJI, Doosan...). Chú ý Banner Vàng nếu ca trước có bàn giao gá đặt!
                </p>
              </div>

              <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-3.5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="rounded bg-indigo-600 px-1.5 py-0.5 text-[10px] font-black text-white">BƯỚC 3</span>
                  <span className="text-[11px] font-bold text-indigo-700">Nguyên Công</span>
                </div>
                <div className="text-xs font-bold text-slate-900">Chọn Bước Công Nghệ</div>
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  Các nguyên công của chi tiết đang chọn sẽ tự đưa lên đầu. Chạm chọn đúng bước NC01, NC02 bạn thực hiện.
                </p>
              </div>

              <div className="rounded-xl border border-purple-200 bg-purple-50/50 p-3.5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="rounded bg-purple-600 px-1.5 py-0.5 text-[10px] font-black text-white">BƯỚC 4</span>
                  <span className="text-[11px] font-bold text-purple-700">Ghép Máy</span>
                </div>
                <div className="text-xs font-bold text-slate-900">Chọn Chế Độ Ghép Máy</div>
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  Đứng 1 máy chọn &ldquo;Máy chính (100%)&rdquo;. Trông thêm máy 2 chạy thô chọn &ldquo;Ghép máy 2 (33%)&rdquo; để cộng thêm thu nhập.
                </p>
              </div>

              <div className="rounded-xl border border-sky-200 bg-sky-50/50 p-3.5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="rounded bg-sky-600 px-1.5 py-0.5 text-[10px] font-black text-white">BƯỚC 5</span>
                  <span className="text-[11px] font-bold text-sky-700">Sản Lượng</span>
                </div>
                <div className="text-xs font-bold text-slate-900">Nhập Số Lượng Làm Được</div>
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  Bấm các nút nhanh [+1] [+5] [+10] để cộng dồn sản lượng đạt. Nếu có hàng hỏng, nhập vào ô Phế phẩm để cấp bù phôi.
                </p>
              </div>

              <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3.5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="rounded bg-amber-600 px-1.5 py-0.5 text-[10px] font-black text-white">BƯỚC 6</span>
                  <span className="text-[11px] font-bold text-amber-700">Ca Làm Việc</span>
                </div>
                <div className="text-xs font-bold text-slate-900">Chọn Ca (Nhận Ăn Ca)</div>
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  Chọn Ca 1, Ca 2 hoặc Ca 3. Với Ca 2 và Ca 3, hệ thống sẽ tự động cộng phụ cấp ăn ca 25.000 đ vào lương.
                </p>
              </div>

              <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-3.5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-black text-white">BƯỚC 7</span>
                  <span className="text-[11px] font-bold text-rose-700">Tiêu Hao Dao</span>
                </div>
                <div className="text-xs font-bold text-slate-900">Ghi Nhận Số Cạnh Dao</div>
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  Nhập số cạnh chíp thực tế đã tiêu hao. Tiết kiệm dao hơn định mức sẽ được xét thưởng tiết kiệm dao cụ cuối tháng!
                </p>
              </div>

              <div className="rounded-xl border border-teal-200 bg-teal-50/50 p-3.5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="rounded bg-teal-600 px-1.5 py-0.5 text-[10px] font-black text-white">BƯỚC 8</span>
                  <span className="text-[11px] font-bold text-teal-700">Gửi Báo Cáo</span>
                </div>
                <div className="text-xs font-bold text-slate-900">🚀 Gửi Báo Cáo Sản Lượng</div>
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  Xem số tiền lượt này được cộng ở góc trên và bấm nút màu xanh to nhất màn hình. Dữ liệu nhảy ngay lên TV Andon xưởng!
                </p>
              </div>
            </div>
          </Card>

          {/* Module 2: QC & Shift Leader */}
          <Card className="space-y-4 border-slate-200 bg-white p-5">
            <div className="flex items-center gap-2.5 border-b border-slate-100 pb-3">
              <span className="rounded-lg bg-amber-100 px-2.5 py-1 text-xs font-black text-amber-900">
                PHẦN 2
              </span>
              <h3 className="text-sm font-black text-slate-900 uppercase">
                🔍 Quy Trình Tổ Trưởng &amp; QA/QC (3 Tầng Kiểm Soát)
              </h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
                <div className="text-xs font-black text-blue-700 uppercase">1. Duyệt Con Đầu (FAI)</div>
                <p className="text-xs text-slate-700 leading-relaxed">
                  Lô từ 5 SP trở lên bắt buộc QC ký duyệt sản phẩm đầu tiên trước khi chạy hàng loạt. Tránh rủi ro gia công sai cả lô phôi.
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
                <div className="text-xs font-black text-amber-700 uppercase">2. Tự Kiểm Dung Sai (★)</div>
                <p className="text-xs text-slate-700 leading-relaxed">
                  Công nhân đo kiểm và tích chọn dung sai đạt tại các điểm đo quan trọng. Tổ trưởng kiểm tra ngẫu nhiên và duyệt biên bản trong tab Nhật Ký &amp; QC.
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
                <div className="text-xs font-black text-emerald-700 uppercase">3. Sổ Bàn Giao BM.GC.01.02</div>
                <p className="text-xs text-slate-700 leading-relaxed">
                  Khi chuyển hàng sang Phân xưởng Hoàn Thiện hoặc Nhiệt Luyện, người nhận vào tab <strong>Sổ Bàn Giao</strong> kiểm đếm và bấm &ldquo;✓ Nhận đủ&rdquo; để xác nhận kế hoạch đạt chuẩn.
                </p>
              </div>
            </div>
          </Card>

          {/* Module 3: Admin & Director */}
          <Card className="space-y-4 border-slate-200 bg-white p-5">
            <div className="flex items-center gap-2.5 border-b border-slate-100 pb-3">
              <span className="rounded-lg bg-blue-100 px-2.5 py-1 text-xs font-black text-blue-900">
                PHẦN 3
              </span>
              <h3 className="text-sm font-black text-slate-900 uppercase">
                🛡️ Quy Trình Quản Đốc &amp; Ban Giám Đốc (Lập Kế Hoạch &amp; Đối Soát P&amp;L)
              </h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
                <div className="text-xs font-black text-blue-700 uppercase">Lập Kế Hoạch Ngày Form VICO BM01</div>
                <p className="text-xs text-slate-700 leading-relaxed">
                  Mở tab <strong>&ldquo;Kế Hoạch &amp; Tuần&rdquo;</strong>, phân công mặt hàng và sản lượng cho 13 thợ. Bấm <strong>&ldquo;Gửi Nhóm Zalo&rdquo;</strong> để gửi thông báo ca cho anh em công nhân chuẩn bị trước.
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
                <div className="text-xs font-black text-indigo-700 uppercase">Đối Soát Báo Giá &amp; Lãi/Lỗ (P&amp;L)</div>
                <p className="text-xs text-slate-700 leading-relaxed">
                  Định mức chuẩn tính theo công thức: <code>Tổng thời gian &divide; Sản lượng ngày</code>. Phân hệ Báo giá tự động tính giá thành thực tế so với giá chào khách để cảnh báo các đơn hàng bị lỗ.
                </p>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* ==================== MODAL: QUICK MULTI-OP CREATOR ==================== */}
      <Modal
        open={createOpOpen}
        onClose={() => setCreateOpOpen(false)}
        title="Khai Báo Nhanh Chuỗi Nguyên Công Gia Công"
        subtitle="Tự động khởi tạo Mã SP (nếu chưa có), sinh mã NC tuần tự và khóa chốt Thành phẩm bước cuối"
        maxWidthClass="max-w-3xl"
      >
        <form noValidate onSubmit={handleCreateMultiOps} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">
                Khách hàng
              </label>
              <input
                type="text"
                value={newOpCustomer}
                onChange={(e) => setNewOpCustomer(e.target.value)}
                list="gcck-customer-list"
                className={fieldInputCls}
              />
              <datalist id="gcck-customer-list">
                {uniqueCustomers.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">
                Tên Sản Phẩm / Bản Vẽ Chi Tiết *
              </label>
              <input
                type="text"
                required
                value={newOpProductName}
                onChange={(e) => setNewOpProductName(e.target.value)}
                placeholder="VD: Trục vít tải L=450 Ø45 SCM440"
                className={`${fieldInputCls} font-semibold`}
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">
                Máy gia công mặc định
              </label>
              <select
                value={newOpMachine}
                onChange={(e) => setNewOpMachine(e.target.value)}
                className={fieldInputCls}
              >
                {machines.map((m) => (
                  <option key={m.id} value={m.name}>
                    {m.name} ({formatVnd(m.costPerHour)}/h)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">
                Mã Dao Cụ Chủ Đạo
              </label>
              <select
                value={newOpToolCode}
                onChange={(e) => setNewOpToolCode(e.target.value)}
                className={fieldInputCls}
              >
                {tools.map((t) => (
                  <option key={t.code} value={t.code}>
                    {t.code} — {t.name} ({formatVnd(t.costPerEdge)}/góc)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">
                Mác Vật Liệu Phôi
              </label>
              <input
                type="text"
                value={newOpMatName}
                onChange={(e) => setNewOpMatName(e.target.value)}
                className={fieldInputCls}
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">
                Chế Độ Cắt Khuyến Nghị (Vc / f / ap)
              </label>
              <input
                type="text"
                value={newOpCuttingRec}
                onChange={(e) => setNewOpCuttingRec(e.target.value)}
                className={fieldInputCls}
              />
            </div>
          </div>

          {/* Setup + Cycle Calculator Box */}
          <div className="space-y-2.5 rounded-xl border border-blue-200 bg-blue-50/70 p-3">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-bold text-blue-800">
                <Calculator className="h-4 w-4 text-blue-600" />
                Bộ Tính Nhanh Định Mức Giây Chuẩn = (Setup ÷ Cỡ Lô) + Cycle Time
              </span>
              <span className="font-mono-num text-xs font-bold text-emerald-700">
                Kết quả: {computedSetupPlusCycle}s / pcs
              </span>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-12">
              <input
                type="text"
                value={calcOpTitle}
                onChange={(e) => setCalcOpTitle(e.target.value)}
                placeholder="Tên bước NC..."
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 sm:col-span-4"
              />
              <input
                type="number"
                value={calcSetupSec}
                onChange={(e) => setCalcSetupSec(Number(e.target.value))}
                placeholder="Setup (s)"
                title="Thời gian gá đặt Setup (giây)"
                className="font-mono-num rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 sm:col-span-2"
              />
              <input
                type="number"
                value={calcBatchQty}
                onChange={(e) => setCalcBatchQty(Number(e.target.value))}
                placeholder="Cỡ lô"
                title="Số lượng chi tiết trong lô"
                className="font-mono-num rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 sm:col-span-2"
              />
              <input
                type="number"
                value={calcCycleSec}
                onChange={(e) => setCalcCycleSec(Number(e.target.value))}
                placeholder="Cycle (s)"
                title="Chu kỳ chạy máy 1 chi tiết (giây)"
                className="font-mono-num rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 sm:col-span-2"
              />
              <Button
                variant="secondary"
                size="sm"
                className="sm:col-span-2"
                onClick={appendCalculatedOpLine}
              >
                + Chèn dòng
              </Button>
            </div>
          </div>

          {/* 8 Quick Chips & 4/10 Presets */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-700">
                8 Thẻ Gợi Ý Nhanh &amp; Mẫu Quy Trình Chuẩn:
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setNewOpRawLines(SAMPLE_4_NC)}
                  className="rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 transition-colors hover:bg-emerald-100"
                >
                  <Sparkles className="mr-1 inline h-3 w-3" />
                  Mẫu 4 NC Tiêu Chuẩn
                </button>
                <button
                  type="button"
                  onClick={() => setNewOpRawLines(SAMPLE_10_NC)}
                  className="rounded-md border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] font-bold text-violet-700 transition-colors hover:bg-violet-100"
                >
                  🚀 Mẫu 10 NC Phức Hợp
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {QUICK_OP_CHIPS.map((chip) => (
                <button
                  key={chip.label}
                  type="button"
                  onClick={() =>
                    setNewOpRawLines((prev) =>
                      prev.trim() ? `${prev.trim()}\n${chip.line}` : chip.line
                    )
                  }
                  className="rounded-md border border-slate-300 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-700 transition-colors hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700"
                >
                  + {chip.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">
              Danh sách Nguyên công (Mỗi dòng theo cú pháp:{' '}
              <code className="font-bold text-blue-700">Tên Nguyên Công | Định mức giây</code>)
            </label>
            <textarea
              rows={6}
              value={newOpRawLines}
              onChange={(e) => setNewOpRawLines(e.target.value)}
              className="font-mono-num w-full rounded-xl border border-slate-300 bg-slate-50 p-3 text-xs leading-relaxed text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600/15"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setCreateOpOpen(false)}>
              Hủy
            </Button>
            <Button type="submit" variant="primary" disabled={submittingNewOps}>
              <CheckCircle2 className="h-4 w-4" />
              {submittingNewOps ? 'Đang khởi tạo...' : 'Khởi Tạo Quy Trình Nguyên Công'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ==================== MODAL: EDIT SINGLE OPERATION ==================== */}
      <Modal
        open={Boolean(editingOp)}
        onClose={() => setEditingOp(null)}
        title={`Hiệu Chỉnh Nguyên Công ${editingOp?.ncId || ''}`}
        subtitle={editingOp ? `${editingOp.productName} (${editingOp.customer})` : ''}
        maxWidthClass="max-w-lg"
      >
        <form noValidate onSubmit={handleSaveEditOp} className="space-y-3.5">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">
              Tên Nguyên Công
            </label>
            <input
              type="text"
              required
              value={editOpName}
              onChange={(e) => setEditOpName(e.target.value)}
              className={`${fieldInputCls} font-semibold`}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">
                Định mức thời gian chuẩn (Giây/SP)
              </label>
              <input
                type="number"
                min={10}
                required
                value={editStdSeconds}
                onChange={(e) => setEditStdSeconds(Number(e.target.value))}
                className="font-mono-num min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-emerald-700 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
              />
              <div className="mt-1 text-[11px] text-slate-500">
                Quy đổi: {formatDurationSec(editStdSeconds)}
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">
                Máy mặc định phân tải
              </label>
              <select
                value={editDefaultMachine}
                onChange={(e) => setEditDefaultMachine(e.target.value)}
                className={fieldInputCls}
              >
                {machines.map((m) => (
                  <option key={m.id} value={m.name}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Inline Setup + Cycle helper */}
          <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
            <div className="text-[11px] font-semibold text-slate-600">
              Tính nhanh ĐM Giây từ Setup (s) ÷ Lô + Cycle (s):
            </div>
            <div className="grid grid-cols-4 gap-2">
              <input
                type="number"
                value={editSetupSec}
                onChange={(e) => setEditSetupSec(Number(e.target.value))}
                className="font-mono-num rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900"
                title="Setup giây"
              />
              <input
                type="number"
                value={editBatchQty}
                onChange={(e) => setEditBatchQty(Number(e.target.value))}
                className="font-mono-num rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900"
                title="Số lượng lô"
              />
              <input
                type="number"
                value={editCycleSec}
                onChange={(e) => setEditCycleSec(Number(e.target.value))}
                className="font-mono-num rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900"
                title="Cycle giây"
              />
              <button
                type="button"
                onClick={() => {
                  const next =
                    Math.round(editSetupSec / Math.max(1, editBatchQty)) +
                    Math.max(10, Math.round(editCycleSec));
                  setEditStdSeconds(next);
                }}
                className="rounded border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-bold text-blue-700 hover:bg-blue-100"
              >
                Áp dụng
              </button>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">
              Chế độ cắt &amp; Hướng dẫn gá đặt
            </label>
            <input
              type="text"
              value={editCuttingRec}
              onChange={(e) => setEditCuttingRec(e.target.value)}
              className={fieldInputCls}
            />
          </div>

          <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <input
              type="checkbox"
              checked={editIsCritical}
              onChange={(e) => setEditIsCritical(e.target.checked)}
              className="h-4 w-4 rounded accent-amber-600"
            />
            <span className="text-xs font-semibold text-amber-900">
              ★ Đánh dấu Điểm Đo Quan Trọng (Bắt buộc Công nhân tích Tự Kiểm dung sai trước khi Gửi
              Báo Cáo)
            </span>
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setEditingOp(null)}>
              Đóng
            </Button>
            <Button type="submit" variant="primary" disabled={savingEditOp}>
              <Save className="h-4 w-4" />
              {savingEditOp ? 'Đang lưu...' : 'Lưu Thay Đổi'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ==================== MODAL: DELETE OPERATION CONFIRMATION ==================== */}
      <Modal
        open={Boolean(deletingOp)}
        onClose={() => setDeletingOp(null)}
        title="Xác Nhận Xóa Nguyên Công Khỏi Quy Trình"
        maxWidthClass="max-w-md"
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs leading-relaxed text-rose-900">
            Bạn có chắc chắn muốn xóa nguyên công{' '}
            <strong className="font-mono-num text-rose-700">{deletingOp?.ncId}</strong> —{' '}
            <strong>{deletingOp?.opName}</strong> của sản phẩm{' '}
            <strong>{deletingOp?.productName}</strong>?<br />
            Hệ thống sẽ tự động đánh lại thứ tự các bước còn lại và gán lại cờ Chốt Thành Phẩm.
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeletingOp(null)}>
              Hủy
            </Button>
            <Button
              variant="danger"
              disabled={deletingBusy}
              onClick={() => void handleConfirmDeleteOp()}
            >
              <Trash2 className="h-4 w-4" />
              {deletingBusy ? 'Đang xóa...' : 'Xác Nhận Xóa'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ==================== MODAL: EXCEL IMPORT PREVIEW ==================== */}
      <Modal
        open={importPreviewOpen}
        onClose={() => setImportPreviewOpen(false)}
        title={`Xem Trước Dữ Liệu Nạp Excel (${importRows.length} Nguyên Công)`}
        subtitle={`Tệp nguồn: ${importFileName}`}
        maxWidthClass="max-w-4xl"
      >
        <div className="space-y-4">
          <div className="max-h-[420px] overflow-auto rounded-xl border border-slate-200">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="sticky top-0 bg-slate-50 text-[11px] font-bold uppercase text-slate-600">
                <tr className="border-b border-slate-200">
                  <th className="px-2.5 py-2">#</th>
                  <th className="px-2.5 py-2">Khách Hàng</th>
                  <th className="px-2.5 py-2">Tên Sản Phẩm</th>
                  <th className="px-2.5 py-2">Tên Nguyên Công</th>
                  <th className="px-2.5 py-2 text-right">ĐM Giây</th>
                  <th className="px-2.5 py-2">Máy Mặc Định</th>
                  <th className="px-2.5 py-2">Mã Dao</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {importRows.map((r, idx) => (
                  <tr key={idx}>
                    <td className="font-mono-num px-2.5 py-1.5 text-slate-500">
                      {idx + 1}
                    </td>
                    <td className="px-2.5 py-1.5 text-slate-700">{r.customer}</td>
                    <td className="px-2.5 py-1.5 font-semibold text-slate-900">
                      {r.productName}
                    </td>
                    <td className="px-2.5 py-1.5 font-medium text-blue-700">{r.opName}</td>
                    <td className="font-mono-num px-2.5 py-1.5 text-right font-bold text-emerald-700">
                      {formatNumber(r.stdSeconds)}s
                    </td>
                    <td className="px-2.5 py-1.5 text-slate-700">{r.defaultMachine}</td>
                    <td className="font-mono-num px-2.5 py-1.5 font-semibold text-amber-800">
                      {r.toolCode}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-slate-600">
              <FileSpreadsheet className="mr-1 inline h-4 w-4 text-emerald-600" />
              Đã kiểm tra tính hợp lệ cấu trúc biểu mẫu 7 cột chuẩn.
            </span>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setImportPreviewOpen(false)}>
                Hủy
              </Button>
              <Button
                variant="success"
                disabled={importingBusy}
                onClick={() => void handleConfirmExcelImport()}
              >
                <CloudUpload className="h-4 w-4" />
                {importingBusy
                  ? 'Đang ghi vào CSDL...'
                  : `Xác Nhận Nạp ${importRows.length} Nguyên Công`}
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      {/* ==================== MODAL: ADD MACHINE ==================== */}
      <Modal
        open={addMachOpen}
        onClose={() => setAddMachOpen(false)}
        title="Khai Báo Thiết Bị / Máy Gia Công Mới"
        maxWidthClass="max-w-md"
      >
        <form noValidate onSubmit={handleAddMachine} className="space-y-3.5">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">
              Mã Máy (Tùy chọn — Để trống sẽ tự sinh M24, M25...)
            </label>
            <input
              type="text"
              value={newMachId}
              onChange={(e) => setNewMachId(e.target.value)}
              placeholder="VD: M24"
              className={`font-mono-num ${fieldInputCls}`}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">
              Tên Máy Gia Công *
            </label>
            <input
              type="text"
              required
              value={newMachName}
              onChange={(e) => setNewMachName(e.target.value)}
              placeholder="VD: Máy Phay CNC 5 Trục Mazak"
              className={`${fieldInputCls} font-semibold`}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">
              Nhóm Công Nghệ
            </label>
            <input
              type="text"
              value={newMachGroup}
              onChange={(e) => setNewMachGroup(e.target.value)}
              className={fieldInputCls}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">
              Đơn Giá Giờ Máy Khấu Hao &amp; Điện Năng (VNĐ/giờ)
            </label>
            <input
              type="number"
              step="any"
              min={50000}
              value={newMachCostHour}
              onChange={(e) => setNewMachCostHour(Number(e.target.value))}
              className="font-mono-num min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-emerald-700 focus:border-blue-600 focus:outline-none"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setAddMachOpen(false)}>
              Hủy
            </Button>
            <Button type="submit" variant="primary" disabled={savingNewMach}>
              {savingNewMach ? 'Đang thêm...' : 'Lưu Thiết Bị'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ==================== MODAL: EDIT MACHINE ==================== */}
      <Modal
        open={Boolean(editingMach)}
        onClose={() => setEditingMach(null)}
        title={`Cấu Hình Máy: ${editingMach?.name || ''}`}
        maxWidthClass="max-w-md"
      >
        <form noValidate onSubmit={handleSaveEditMachine} className="space-y-3.5">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">
              Trạng Thái Vận Hành Hiện Tại (Hiển thị tức thì lên Andon TV)
            </label>
            <select
              value={editMachStatus}
              onChange={(e) => setEditMachStatus(e.target.value as MachineStatus)}
              className={`${fieldInputCls} font-semibold`}
            >
              <option value="RUNNING">🟢 RUNNING — Đang chạy cắt gọt</option>
              <option value="SETUP">🟡 SETUP — Đang gá đặt phôi / rà dao</option>
              <option value="IDLE">⚪ IDLE — Chờ lệnh / Rảnh</option>
              <option value="STOPPED">🔴 STOPPED — Dừng sự cố khẩn</option>
              <option value="MAINTENANCE">🟣 MAINTENANCE — Bảo trì định kỳ</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">
              Đơn Giá Giờ Máy (VNĐ/giờ)
            </label>
            <input
              type="number"
              step="any"
              min={50000}
              value={editMachCostHour}
              onChange={(e) => setEditMachCostHour(Number(e.target.value))}
              className="font-mono-num min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-emerald-700 focus:border-blue-600 focus:outline-none"
            />
          </div>

          {(editMachStatus === 'STOPPED' || editMachStatus === 'MAINTENANCE') && (
            <div>
              <label className="mb-1 block text-xs font-semibold text-amber-800">
                Nguyên nhân dừng máy / Nội dung bảo trì
              </label>
              <input
                type="text"
                value={editMachStopReason}
                onChange={(e) => setEditMachStopReason(e.target.value)}
                placeholder="VD: Quá nhiệt trục chính / Thay dầu thủy lực..."
                className={fieldInputCls}
              />
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setEditingMach(null)}>
              Hủy
            </Button>
            <Button type="submit" variant="primary" disabled={savingEditMach}>
              {savingEditMach ? 'Đang lưu...' : 'Cập Nhật Máy'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ==================== MODAL: 1-FOR-1 CUTTING TOOL INSERT SWAP ==================== */}
      <Modal
        open={Boolean(swapToolModal)}
        onClose={() => setSwapToolModal(null)}
        title={`Cấp Đổi Mảnh Dao 1-Đổi-1: ${swapToolModal?.code || ''}`}
        subtitle={
          swapToolModal
            ? `${swapToolModal.name} — Tồn kho hiện tại: ${swapToolModal.stockQty ?? 0} mảnh`
            : ''
        }
        maxWidthClass="max-w-md"
      >
        <form noValidate onSubmit={handleSubmitToolSwap} className="space-y-3.5">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">
              Cấp cho Máy Gia Công
            </label>
            <select
              value={swapMachineName}
              onChange={(e) => setSwapMachineName(e.target.value)}
              className="min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-900 focus:border-blue-600 focus:outline-none"
            >
              {machines.map((m) => (
                <option key={m.id} value={m.name}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">
              Số lượng mảnh mới xuất kho
            </label>
            <input
              type="number"
              min={1}
              max={20}
              value={swapQty}
              onChange={(e) => setSwapQty(Number(e.target.value))}
              className="font-mono-num min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 text-base font-bold text-emerald-700 focus:border-blue-600 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">
              Lý do cấp đổi mảnh
            </label>
            <select
              value={swapReason}
              onChange={(e) => setSwapReason(e.target.value)}
              className="min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-900 focus:border-blue-600 focus:outline-none"
            >
              {TOOL_SWAP_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
            <input
              type="checkbox"
              checked={swapOldReturned}
              onChange={(e) => setSwapOldReturned(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded accent-emerald-600"
            />
            <span className="text-xs font-semibold leading-snug text-emerald-900">
              Đã kiểm đếm &amp; thu hồi đủ xác mảnh hợp kim mòn/vỡ cũ theo quy tắc 1-đổi-1 tại tủ
              dao
            </span>
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setSwapToolModal(null)}>
              Hủy
            </Button>
            <Button type="submit" variant="success" disabled={swappingBusy}>
              <Repeat className="h-4 w-4" />
              {swappingBusy ? 'Đang xuất kho...' : 'Xác Nhận Xuất Đổi Mảnh'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ==================== MODAL: CREATE / EDIT WORKER & PIN ==================== */}
      <Modal
        open={workerModalOpen}
        onClose={() => setWorkerModalOpen(false)}
        title={
          editingWorkerMode
            ? `Cập Nhật Hồ Sơ & Mã PIN Nhân Sự (${wId})`
            : 'Thêm Nhân Sự Mới & Cấp Mã PIN'
        }
        maxWidthClass="max-w-lg"
      >
        <form noValidate onSubmit={handleSaveWorker} className="space-y-3.5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">
                Mã Nhân Viên *
              </label>
              <input
                type="text"
                required
                disabled={editingWorkerMode}
                value={wId}
                onChange={(e) => setWId(e.target.value)}
                className="font-mono-num min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-blue-700 disabled:bg-slate-100 disabled:opacity-70"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">
                Họ &amp; Tên *
              </label>
              <input
                type="text"
                required
                value={wName}
                onChange={(e) => setWName(e.target.value)}
                placeholder="Nguyễn Văn A"
                className={`${fieldInputCls} font-semibold`}
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">
                Vai Trò Phân Quyền (RBAC)
              </label>
              <select
                value={wRole}
                onChange={(e) => {
                  const next = e.target.value as 'CN' | 'TC' | 'KT' | 'QĐ';
                  setWRole(next);
                  if (next === 'QĐ') setWTitle('Quản đốc Xưởng');
                  else if (next === 'TC') setWTitle('Trưởng ca sản xuất');
                  else if (next === 'KT') setWTitle('Kỹ thuật / QC');
                  else setWTitle('Công nhân đứng máy CNC');
                }}
                className={fieldInputCls}
              >
                <option value="CN">CN — Công nhân đứng máy</option>
                <option value="TC">TC — Trưởng ca sản xuất</option>
                <option value="KT">KT — Kỹ thuật / Kiểm soát QC</option>
                <option value="QĐ">QĐ — Quản đốc / Admin</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">
                Tổ / Bộ Phận &amp; Chức Danh
              </label>
              <input
                type="text"
                value={wTitle}
                onChange={(e) => setWTitle(e.target.value)}
                className={fieldInputCls}
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">
                Chế Độ Tính Lương 3P
              </label>
              <select
                value={wSalaryMode}
                onChange={(e) =>
                  setWSalaryMode(
                    e.target.value as 'Khoán 1 + 0.33 máy' | 'Hành chính (Tháng)'
                  )
                }
                className={fieldInputCls}
              >
                <option value="Khoán 1 + 0.33 máy">Khoán 1 + 0.33 máy</option>
                <option value="Hành chính (Tháng)">Hành chính (Tháng)</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">
                Lương Cơ Bản Ca 8h (VNĐ)
              </label>
              <input
                type="number"
                step="any"
                min={100000}
                value={wBaseSalary}
                onChange={(e) => setWBaseSalary(Number(e.target.value))}
                className="font-mono-num min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-emerald-700 focus:border-blue-600 focus:outline-none"
              />
              <div className="font-mono-num mt-0.5 text-[10px] text-slate-500">
                Đơn giá giây: {(wBaseSalary / 28800).toFixed(2)} đ/s
              </div>
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-semibold text-slate-700">
                Mã PIN Đăng Nhập{' '}
                {editingWorkerMode ? '(Để trống nếu giữ nguyên)' : '*'}
              </label>
              <input
                type="password"
                value={wPin}
                onChange={(e) => setWPin(e.target.value)}
                placeholder={editingWorkerMode ? 'Giữ nguyên PIN cũ...' : 'VD: 1234'}
                className="font-mono-num min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold tracking-widest text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
              />
            </div>
          </div>

          <details className="rounded-xl border border-slate-200 bg-slate-50">
            <summary className="cursor-pointer select-none px-3.5 py-2.5 text-xs font-bold text-slate-700 hover:text-slate-900">
              Tùy chọn nâng cao: Liên kết Telegram cá nhân (Cài đặt sau)
            </summary>
            <div className="border-t border-slate-200 p-3.5">
              <label className="mb-1 block text-xs font-semibold text-slate-700">
                Telegram Chat ID Cá Nhân
              </label>
              <input
                type="text"
                value={wChatId}
                onChange={(e) => setWChatId(e.target.value)}
                placeholder="VD: 582910384"
                className={`font-mono-num ${fieldInputCls}`}
              />
            </div>
          </details>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setWorkerModalOpen(false)}>
              Hủy
            </Button>
            <Button type="submit" variant="primary" disabled={savingWorker}>
              <Save className="h-4 w-4" />
              {savingWorker ? 'Đang lưu...' : 'Lưu Hồ Sơ Nhân Sự'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
