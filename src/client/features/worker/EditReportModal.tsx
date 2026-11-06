import React, { useState, useMemo } from 'react';
import {
  X,
  Check,
  Edit3,
  AlertTriangle,
  Calculator,
  Cpu,
  Layers,
  Coins,
  RefreshCw,
} from 'lucide-react';
import type { ProductionLogDto, OperationMeta, PurchaseOrderInfo } from '@shared/types';
import { apiClient } from '../../lib/apiClient';
import { updateLogOnSupabase } from '../../lib/supabaseClient';
import { updateFallbackLog } from '../../lib/clientFallbackStore';
import { formatVnd } from '../../lib/formatters';

interface EditReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  log: ProductionLogDto | null;
  operations: OperationMeta[];
  purchaseOrders: PurchaseOrderInfo[];
  costPerSec?: number;
  salaryMode?: string;
  currentTodayIncome?: number;
  onSaveSuccess: (updatedLog: ProductionLogDto, newTodayIncome: number) => void;
}

export function EditReportModal({
  isOpen,
  onClose,
  log,
  operations,
  purchaseOrders,
  costPerSec = 13.37,
  salaryMode = 'Khoán 1 + 0.33 máy',
  currentTodayIncome,
  onSaveSuccess,
}: EditReportModalProps) {
  if (!isOpen || !log) return null;

  const [selectedPoId, setSelectedPoId] = useState(log.poId || 'PO-THEO-KH');
  const [selectedNcId, setSelectedNcId] = useState(log.ncId);
  const [machineName, setMachineName] = useState(log.machineName || 'Máy phay OKK3');
  const [okQty, setOkQty] = useState(log.okQty);
  const [reworkQty, setReworkQty] = useState(log.reworkQty || 0);
  const [scrapQty, setScrapQty] = useState(log.scrapQty || 0);
  const [stopMinutes, setStopMinutes] = useState(log.stopMinutes || 0);
  const [stopReason, setStopReason] = useState(log.stopReason || '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Find currently selected operation
  const currentOp = useMemo(() => {
    return operations.find((o) => o.ncId === selectedNcId);
  }, [operations, selectedNcId]);

  // Operations filtered or sorted: current product's ops first, then others
  const relevantOps = useMemo(() => {
    const curSp = currentOp?.spId || log.spId;
    return [...operations].sort((a, b) => {
      const aMatch = curSp && a.spId === curSp ? 0 : 1;
      const bMatch = curSp && b.spId === curSp ? 0 : 1;
      if (aMatch !== bMatch) return aMatch - bMatch;
      return a.ncId.localeCompare(b.ncId);
    });
  }, [operations, currentOp, log.spId]);

  // Estimated new piece wage
  const estNewWage = useMemo(() => {
    const stdSec = Number(currentOp?.stdSeconds ?? log.stdSeconds ?? 0);
    const effCostPerSec = Number(costPerSec || 13.37);
    const pieceWage = Math.round(okQty * stdSec * effCostPerSec);
    return pieceWage;
  }, [currentOp, log.stdSeconds, costPerSec, okQty]);

  const diffWage = estNewWage - Number(log.income || 0);

  const handleSave = async () => {
    if (okQty < 0) {
      setErrorMsg('Số lượng OK không được âm.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg('');

    try {
      const payload = {
        poId: selectedPoId,
        ncId: selectedNcId,
        machineName,
        okQty,
        reworkQty,
        scrapQty,
        stopMinutes,
        stopReason: stopMinutes > 0 ? (stopReason || 'Dừng máy sự cố/điều chỉnh') : 'Không có dừng máy',
      };

      // 1. Try sending update to Backend API (if active)
      let res: any = null;
      try {
        res = await apiClient.patch<{
          success: boolean;
          message: string;
          log: ProductionLogDto;
          todayTotalIncome: number;
        }>(`/reports/${log.id}`, payload);
      } catch (patchErr) {
        console.warn('Backend API patch failed (likely static/serverless deployment), applying client/cloud sync directly:', patchErr);
      }

      const updatedLog: ProductionLogDto = res?.log || {
        ...log,
        poId: selectedPoId,
        ncId: selectedNcId,
        opName: currentOp?.opName || log.opName,
        spId: currentOp?.spId || log.spId,
        productName: currentOp?.productName || log.productName,
        machineName,
        okQty,
        reworkQty,
        scrapQty,
        stopMinutes,
        stopReason: stopMinutes > 0 ? (stopReason || 'Dừng máy sự cố/điều chỉnh') : 'Không có dừng máy',
        income: estNewWage,
        pieceWage: estNewWage,
        stdSeconds: Number(currentOp?.stdSeconds ?? log.stdSeconds ?? 0),
        kpiPct: 100,
        kpiStatus: 'DAT_MUC',
      };

      const newTodayIncome =
        res?.todayTotalIncome !== undefined
          ? res.todayTotalIncome
          : Math.max(0, (Number(currentTodayIncome ?? 0) - Number(log.income || 0)) + estNewWage);

      // 2. Sync to Supabase Cloud directly if active
      void updateLogOnSupabase(log.id, log.recordUid, {
        po_id: updatedLog.poId,
        nc_id: updatedLog.ncId,
        op_name: updatedLog.opName,
        sp_id: updatedLog.spId,
        product_name: updatedLog.productName,
        machine_name: updatedLog.machineName,
        ok_qty: updatedLog.okQty,
        rework_qty: updatedLog.reworkQty,
        scrap_qty: updatedLog.scrapQty,
        stop_minutes: updatedLog.stopMinutes,
        stop_reason: updatedLog.stopReason,
        income: updatedLog.income,
        piece_wage: updatedLog.pieceWage,
        kpi_pct: updatedLog.kpiPct,
        kpi_status: updatedLog.kpiStatus,
      });

      // 3. Update localStorage fallback
      updateFallbackLog(log.id, {
        ...payload,
        opName: updatedLog.opName,
        productName: updatedLog.productName,
        income: updatedLog.income,
        pieceWage: updatedLog.pieceWage,
        stdSeconds: updatedLog.stdSeconds,
      });

      onSaveSuccess(updatedLog, newTodayIncome);
      onClose();
    } catch (err: any) {
      setErrorMsg(String(err?.message || 'Có lỗi xảy ra khi lưu phiếu. Vui lòng thử lại!'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg rounded-2xl bg-white shadow-2xl overflow-hidden border border-slate-200 max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 bg-linear-to-r from-blue-700 to-indigo-800 px-4 py-3.5 text-white">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-white/20 p-1.5 backdrop-blur-xs">
              <Edit3 className="h-4 w-4 text-white" />
            </div>
            <div>
              <h3 className="text-sm font-extrabold text-white">Chỉnh Sửa Báo Cáo Sản Lượng</h3>
              <p className="text-[11px] text-blue-100">
                Phiếu: <span className="font-mono">{log.recordUid || `#${log.id}`}</span> · Ngày: {log.workDate}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-white/80 hover:bg-white/20 hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-3.5 overflow-y-auto flex-1 text-xs">
          {errorMsg && (
            <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-rose-700">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* PO & Máy */}
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Lệnh SX / PO
              </label>
              <select
                value={selectedPoId}
                onChange={(e) => setSelectedPoId(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-slate-50 px-2.5 py-2 font-semibold text-slate-800 focus:border-blue-600 focus:bg-white focus:outline-hidden"
              >
                <option value={log.poId}>{log.poId}</option>
                {purchaseOrders
                  .filter((p) => p.poId !== log.poId)
                  .map((p) => (
                    <option key={p.poId} value={p.poId}>
                      {p.poId} — {p.productName?.slice(0, 25)}
                    </option>
                  ))}
              </select>
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Máy Gia Công
              </label>
              <input
                type="text"
                value={machineName}
                onChange={(e) => setMachineName(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-slate-50 px-2.5 py-2 font-semibold text-slate-800 focus:border-blue-600 focus:bg-white focus:outline-hidden"
                placeholder="VD: Máy phay OKK3"
              />
            </div>
          </div>

          {/* NGUYÊN CÔNG (CRITICAL POINT) */}
          <div className="rounded-xl border-2 border-blue-200 bg-blue-50/50 p-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="font-extrabold text-blue-950 flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5 text-blue-700" />
                Nguyên Công Gia Công Thực Tế:
              </label>
              <span className="text-[11px] font-bold text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full">
                Định mức: {currentOp?.stdSeconds ?? log.stdSeconds ?? 0}s
              </span>
            </div>

            <select
              value={selectedNcId}
              onChange={(e) => setSelectedNcId(e.target.value)}
              className="w-full rounded-xl border-2 border-blue-300 bg-white px-3 py-2 text-xs font-extrabold text-slate-900 focus:border-blue-700 focus:outline-hidden shadow-xs"
            >
              {relevantOps.map((op) => {
                const estPrice = Math.round(Number(op.stdSeconds || 0) * costPerSec);
                return (
                  <option key={op.ncId} value={op.ncId}>
                    [{op.ncId}] {op.opName} — {op.productName?.slice(0, 30)} (~{formatVnd(estPrice)}/sp)
                  </option>
                );
              })}
            </select>
            <p className="text-[11px] text-slate-600 italic">
              💡 Đổi lại đúng nguyên công thực tế làm để hệ thống áp đúng đơn giá giây công nghệ chuẩn.
            </p>
          </div>

          {/* SỐ LƯỢNG SẢN XUẤT */}
          <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
            <span className="font-bold text-slate-800 block">Số lượng hoàn thành:</span>
            <div className="grid grid-cols-3 gap-2">
              {/* OK */}
              <div className="rounded-xl border border-emerald-300 bg-emerald-50/60 p-2 text-center">
                <label className="block text-[11px] font-bold text-emerald-800 mb-1">
                  Đạt (OK)
                </label>
                <div className="flex items-center justify-center gap-1">
                  <button
                    type="button"
                    onClick={() => setOkQty((v) => Math.max(0, v - 1))}
                    className="h-6 w-6 rounded-md bg-white text-emerald-800 font-extrabold border border-emerald-300"
                  >
                    -
                  </button>
                  <input
                    type="number"
                    value={okQty}
                    onChange={(e) => setOkQty(Math.max(0, Number(e.target.value)))}
                    className="w-14 rounded-md border border-emerald-400 bg-white py-1 text-center font-extrabold text-emerald-900 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setOkQty((v) => v + 1)}
                    className="h-6 w-6 rounded-md bg-white text-emerald-800 font-extrabold border border-emerald-300"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Sửa */}
              <div className="rounded-xl border border-amber-300 bg-amber-50/60 p-2 text-center">
                <label className="block text-[11px] font-bold text-amber-800 mb-1">
                  Sửa Lại
                </label>
                <input
                  type="number"
                  value={reworkQty}
                  onChange={(e) => setReworkQty(Math.max(0, Number(e.target.value)))}
                  className="w-full rounded-md border border-amber-400 bg-white py-1 text-center font-extrabold text-amber-900 text-sm"
                />
              </div>

              {/* Hủy */}
              <div className="rounded-xl border border-rose-300 bg-rose-50/60 p-2 text-center">
                <label className="block text-[11px] font-bold text-rose-800 mb-1">
                  Hỏng (NG)
                </label>
                <input
                  type="number"
                  value={scrapQty}
                  onChange={(e) => setScrapQty(Math.max(0, Number(e.target.value)))}
                  className="w-full rounded-md border border-rose-400 bg-white py-1 text-center font-extrabold text-rose-900 text-sm"
                />
              </div>
            </div>
          </div>

          {/* DỪNG MÁY */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Phút dừng sự cố (nếu có)
              </label>
              <input
                type="number"
                value={stopMinutes}
                onChange={(e) => setStopMinutes(Math.max(0, Number(e.target.value)))}
                className="w-full rounded-xl border border-slate-300 bg-slate-50 px-2.5 py-1.5 font-bold text-slate-800 focus:bg-white focus:outline-hidden"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Lý do dừng máy
              </label>
              <input
                type="text"
                value={stopReason}
                onChange={(e) => setStopReason(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-800 focus:bg-white focus:outline-hidden"
                placeholder="VD: Thay dao mòn, setup..."
              />
            </div>
          </div>

          {/* BẢNG SO SÁNH LƯƠNG TRƯỚC VÀ SAU KHI SỬA */}
          <div className="rounded-xl border-2 border-emerald-200 bg-linear-to-r from-emerald-50 to-teal-50 p-3 space-y-1.5">
            <div className="flex items-center justify-between text-xs font-bold text-slate-700">
              <span className="flex items-center gap-1 text-slate-800">
                <Calculator className="h-4 w-4 text-emerald-700" />
                Lương khoán trước sửa:
              </span>
              <span className="font-mono text-slate-500 line-through">
                +{formatVnd(log.income)}
              </span>
            </div>

            <div className="flex items-center justify-between text-sm font-extrabold">
              <span className="text-emerald-950">Lương khoán mới (Tính lại):</span>
              <span className="font-mono text-base text-emerald-700">
                +{formatVnd(estNewWage)}
              </span>
            </div>

            <div className="flex items-center justify-between border-t border-emerald-200/80 pt-1 text-[11px] font-bold">
              <span className="text-slate-600">Mức điều chỉnh:</span>
              <span className={diffWage < 0 ? 'text-amber-700' : 'text-emerald-700'}>
                {diffWage >= 0 ? `+${formatVnd(diffWage)}` : formatVnd(diffWage)}
              </span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 font-bold text-slate-700 hover:bg-slate-100 transition-colors"
          >
            Hủy Bỏ
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSubmitting}
            className="inline-flex items-center gap-1.5 rounded-xl bg-blue-700 px-5 py-2 font-extrabold text-white shadow-md hover:bg-blue-800 transition-all disabled:opacity-50"
          >
            {isSubmitting ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                Đang lưu...
              </>
            ) : (
              <>
                <Check className="h-4 w-4" />
                Lưu Thay Đổi
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
