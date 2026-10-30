import React, { useEffect, useState } from 'react';
import { ClipboardCheck, KeyRound, ShieldAlert, UserCheck } from 'lucide-react';
import type {
  AuthMode,
  AuthSessionUser,
  OperationMeta,
  PurchaseOrderInfo,
} from '@shared/types';
import { apiClient } from '../../lib/apiClient';
import { Button, Modal, useToast } from '../../components/ui/IndustrialPrimitives';

export interface FaiInspectionModalProps {
  open: boolean;
  onClose: () => void;
  po: PurchaseOrderInfo | null;
  operations: OperationMeta[];
  user: AuthSessionUser | null;
  authMode: AuthMode;
  onSwitchToQc: () => Promise<void>;
  onOpenPinForQc: () => void;
  onSuccess: () => Promise<void> | void;
}

export function FaiInspectionModal({
  open,
  onClose,
  po,
  operations,
  user,
  authMode,
  onSwitchToQc,
  onOpenPinForQc,
  onSuccess,
}: FaiInspectionModalProps) {
  const toast = useToast();
  const [ncId, setNcId] = useState('');
  const [result, setResult] = useState<'PASS' | 'CONCESSION' | 'REWORK'>('PASS');
  const [sampleSize, setSampleSize] = useState<number>(1);
  const [dim1Spec, setDim1Spec] = useState('Kích thước chuẩn bản vẽ #1');
  const [dim1Val, setDim1Val] = useState('Đạt dung sai');
  const [dim2Spec, setDim2Spec] = useState('Độ nhám / Đồng tâm #2');
  const [dim2Val, setDim2Val] = useState('Ra 1.6 - Đạt');
  const [note, setNote] = useState('Đạt chuẩn chi tiết đầu tiên (FAI), cho phép chạy loạt.');
  const [submitting, setSubmitting] = useState(false);

  const poOps = po
    ? operations.filter((o) =>
        po.spId ? o.spId === po.spId : o.productName === po.productName
      )
    : [];

  useEffect(() => {
    if (open && po) {
      setNcId(poOps[0]?.ncId || '');
      setResult('PASS');
      setSampleSize(1);
      setNote('Đạt chuẩn chi tiết đầu tiên (FAI), cho phép chạy loạt.');
    }
  }, [open, po?.poId]);

  if (!po) return null;

  const canApproveQc =
    user &&
    (user.appRole === 'QC' ||
      user.appRole === 'SHIFT_LEADER' ||
      user.appRole === 'DIRECTOR' ||
      user.appRole === 'ADMIN');

  const selectedOp = poOps.find((o) => o.ncId === ncId) || poOps[0];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canApproveQc) {
      toast.warning('Chỉ Tổ Trưởng / KCS (QC) / Quản Đốc mới có quyền ký duyệt biên bản FAI.');
      return;
    }

    setSubmitting(true);
    try {
      await apiClient.post('/qc', {
        inspectionType: 'FAI',
        poId: po.poId,
        ncId: selectedOp?.ncId || null,
        productName: po.productName,
        opName: selectedOp?.opName || 'Kiểm tra chi tiết đầu tiên',
        machineName: selectedOp?.defaultMachine || 'Máy xưởng CK',
        operatorId: user?.workerId || '',
        result,
        sampleSize,
        defectQty: result === 'REWORK' ? 1 : 0,
        measuredDims: [
          { dim: dim1Spec, spec: 'Theo bản vẽ', measured: dim1Val, ok: result !== 'REWORK' },
          { dim: dim2Spec, spec: 'Theo bản vẽ', measured: dim2Val, ok: result !== 'REWORK' },
        ],
        correctiveAction: note,
      });

      toast.success(`Đã ký duyệt biên bản FAI cho Lệnh SX ${po.poId}!`);
      await onSuccess();
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Lỗi gửi biên bản FAI.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`✅ Duyệt Chi Tiết Đầu Tiên (FAI) — ${po.poId}`}
      subtitle={`${po.customer} · ${po.productName} (SL lô: ${po.qtyPo} SP)`}
      maxWidthClass="max-w-lg"
    >
      <div className="space-y-4 text-slate-900">
        {!canApproveQc && (
          <div className="space-y-2.5 rounded-xl border border-amber-300 bg-amber-50 p-3.5 text-xs text-amber-900">
            <div className="flex items-center gap-2 font-bold text-amber-800">
              <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600" />
              <span>Yêu cầu chữ ký số Tổ Trưởng / KCS (QC)</span>
            </div>
            <p>
              Phiên hiện tại đang là Công nhân (<strong>{user?.name || 'Chưa đăng nhập'}</strong>).
              Theo quy trình ISO xưởng, lô từ 5 chi tiết trở lên cần Tổ Trưởng hoặc QC xác nhận con
              đầu trước khi chạy loạt.
            </p>
            {authMode === 'DEMO_QUICK' ? (
              <Button
                type="button"
                variant="warning"
                size="lg"
                onClick={() => void onSwitchToQc()}
                className="w-full"
              >
                <UserCheck className="h-4 w-4" />
                Chuyển nhanh sang Tổ Trưởng / QC (NV00266) để ký duyệt
              </Button>
            ) : (
              <Button
                type="button"
                variant="warning"
                size="lg"
                onClick={onOpenPinForQc}
                className="w-full"
              >
                <KeyRound className="h-4 w-4" />
                Đăng nhập PIN Tổ Trưởng / QC để ký duyệt
              </Button>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          {poOps.length > 0 && (
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-700">
                Nguyên công kiểm tra mẫu đầu
              </label>
              <select
                value={ncId}
                onChange={(e) => setNcId(e.target.value)}
                className="min-h-[48px] w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-900 shadow-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
              >
                {poOps.map((op) => (
                  <option key={op.ncId} value={op.ncId}>
                    Bước {op.stepOrder}: {op.ncId} — {op.opName} ({op.defaultMachine})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">
                Chỉ tiêu đo #1
              </label>
              <input
                type="text"
                value={dim1Spec}
                onChange={(e) => setDim1Spec(e.target.value)}
                className="min-h-[48px] w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-xs font-medium text-slate-900 shadow-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">
                Giá trị thực đo #1
              </label>
              <input
                type="text"
                value={dim1Val}
                onChange={(e) => setDim1Val(e.target.value)}
                className="font-mono-num min-h-[48px] w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-xs font-bold text-emerald-700 shadow-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">
                Chỉ tiêu đo #2
              </label>
              <input
                type="text"
                value={dim2Spec}
                onChange={(e) => setDim2Spec(e.target.value)}
                className="min-h-[48px] w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-xs font-medium text-slate-900 shadow-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">
                Giá trị thực đo #2
              </label>
              <input
                type="text"
                value={dim2Val}
                onChange={(e) => setDim2Val(e.target.value)}
                className="font-mono-num min-h-[48px] w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-xs font-bold text-emerald-700 shadow-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {(
              [
                { val: 'PASS', label: '✅ ĐẠT CHUẨN', cls: 'border-emerald-400 bg-emerald-50 text-emerald-800 shadow-sm' },
                { val: 'CONCESSION', label: '🟡 NHÂN NHƯỢNG', cls: 'border-amber-400 bg-amber-50 text-amber-800 shadow-sm' },
                { val: 'REWORK', label: '🔴 SỬA LẠI', cls: 'border-rose-400 bg-rose-50 text-rose-800 shadow-sm' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.val}
                type="button"
                onClick={() => setResult(opt.val)}
                className={`min-h-[48px] rounded-xl border px-2 text-xs font-extrabold transition-colors ${
                  result === opt.val
                    ? opt.cls
                    : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700">
              Nhận xét kỹ thuật &amp; hướng dẫn chạy loạt
            </label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="min-h-[48px] w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
            />
          </div>

          <Button
            type="submit"
            variant="success"
            size="touch"
            disabled={submitting || !canApproveQc}
            className="w-full"
          >
            <ClipboardCheck className="h-5 w-5" />
            {submitting ? 'ĐANG GHI NHẬN FAI...' : 'XÁC NHẬN KÝ DUYỆT MẪU ĐẦU (FAI)'}
          </Button>
        </form>
      </div>
    </Modal>
  );
}
