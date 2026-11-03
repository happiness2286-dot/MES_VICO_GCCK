import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Printer, RefreshCw } from 'lucide-react';
import type { HandoverSlipRow } from '@shared/types';
import { apiClient } from '../../lib/apiClient';
import { navigateTo } from '../../lib/navigation';
import { VicoLogo } from '../../components/VicoLogo';
import { getFallbackHandovers, FALLBACK_ORDERS } from '../../lib/clientFallbackStore';

export function HandoverSlipPrint() {
  const [dateStr, setDateStr] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      return url.searchParams.get('date') || new Date().toISOString().slice(0, 10);
    }
    return new Date().toISOString().slice(0, 10);
  });

  const [handovers, setHandovers] = useState<HandoverSlipRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      try {
        const data = await apiClient.get<HandoverSlipRow[]>(`/handovers?date=${dateStr}`);
        if (mounted) {
          setHandovers(data && data.length > 0 ? data : getFallbackHandovers(dateStr));
        }
      } catch {
        if (mounted) {
          setHandovers(getFallbackHandovers(dateStr));
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void load();
    return () => {
      mounted = false;
    };
  }, [dateStr]);

  const [y, m, d] = (dateStr || '').split('-');

  // Always display at least 10 rows matching the ISO template
  const paddedRows = useMemo(() => {
    const list = [...handovers];
    while (list.length < 10) {
      list.push({
        id: `empty-${list.length}`,
        handoverDate: dateStr,
        fromDept: 'PX_GIA_CONG',
        toDept: 'PX_HOAN_THIEN',
        productName: '',
        customer: '',
        unit: '',
        prodQtyTransferred: 0,
        prodQtyDefect: 0,
        prodQtyMissing: 0,
        rawQtyTransferred: 0,
        rawQtyDefect: 0,
        rawQtyMissing: 0,
        createdAt: '',
      });
    }
    return list;
  }, [handovers, dateStr]);

  return (
    <div className="min-h-screen bg-slate-100 p-4 sm:p-6 print:min-h-0 print:bg-white print:p-0">
      {/* Top action toolbar (hidden on print) */}
      <div className="no-print mx-auto mb-4 flex max-w-[1200px] flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigateTo('/admin?tab=logs_qc')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
          >
            <ArrowLeft className="h-4 w-4" />
            Về Sổ Bàn Giao (QC)
          </button>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-700">Ngày bàn giao:</span>
            <input
              type="date"
              value={dateStr}
              onChange={(e) => setDateStr(e.target.value)}
              className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-bold text-slate-900"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-blue-700"
          >
            <Printer className="h-4 w-4" />
            In Biểu Mẫu A4 (Ctrl + P)
          </button>
        </div>
      </div>

      {/* Main A4 Printable Document Container */}
      <div className="mx-auto max-w-[1200px] bg-white p-6 shadow-md print:max-w-none print:p-2 print:shadow-none">
        {loading ? (
          <div className="flex h-64 items-center justify-center gap-2 text-slate-500">
            <RefreshCw className="h-5 w-5 animate-spin text-blue-600" />
            <span>Đang tải Sổ chuyển giao công đoạn...</span>
          </div>
        ) : (
          <div className="border-2 border-black text-black">
            {/* Top 3-block Header matching exact Form BM.GC.01.02 */}
            <div className="grid grid-cols-12 border-b-2 border-black">
              {/* Left: Company Name & Logo */}
              <div className="col-span-3 flex flex-col items-center justify-center border-r-2 border-black p-3 text-center">
                <VicoLogo className="h-10 w-auto object-contain mb-1.5" />
                <div className="text-xs font-black uppercase tracking-wider text-slate-900 leading-tight">
                  CÔNG TY TNHH THẮNG LỢI
                </div>
              </div>

              {/* Center: Title */}
              <div className="col-span-6 flex flex-col items-center justify-center border-r-2 border-black p-3 text-center">
                <h1 className="text-xl sm:text-2xl font-black uppercase tracking-wider text-slate-900">
                  SỔ CHUYỂN GIAO CÔNG ĐOẠN
                </h1>
                <div className="text-lg sm:text-xl font-black uppercase tracking-wider text-slate-900">
                  GIA CÔNG
                </div>
              </div>

              {/* Right: BM Form Code and Date */}
              <div className="col-span-3 flex flex-col justify-between p-2 text-center">
                <div className="border-b border-black pb-2 text-sm font-black tracking-wider text-slate-900">
                  BM.GC.01.02
                </div>
                <div className="pt-2 text-xs font-semibold text-slate-800">
                  Ngày <strong className="font-mono-num">{d}</strong> Tháng <strong className="font-mono-num">{m}</strong> Năm <strong className="font-mono-num">{y}</strong>
                </div>
              </div>
            </div>

            {/* Table Header with exact 2-level structure */}
            <table className="w-full border-collapse text-center text-xs">
              <thead>
                <tr className="border-b-2 border-black font-bold text-slate-900">
                  <th rowSpan={2} className="w-[38px] border-r border-black p-2 bg-slate-50">STT</th>
                  <th rowSpan={2} className="min-w-[180px] border-r border-black p-2 bg-slate-50">Tên sản phẩm</th>
                  <th rowSpan={2} className="w-[120px] border-r border-black p-2 bg-slate-50">Khách hàng</th>
                  <th rowSpan={2} className="w-[50px] border-r border-black p-2 bg-slate-50">ĐVT</th>
                  <th colSpan={3} className="border-r border-black p-1.5 bg-slate-50">Chuyển giao sản phẩm</th>
                  <th colSpan={3} className="border-r border-black p-1.5 bg-slate-50">Chuyển giao phôi</th>
                  <th rowSpan={2} className="min-w-[120px] border-r border-black p-2 bg-slate-50">Ghi chú</th>
                  <th colSpan={2} className="p-1.5 bg-slate-50">Xác Nhận</th>
                </tr>
                <tr className="border-b-2 border-black text-[11px] font-bold text-slate-800 bg-slate-50">
                  <th className="w-[60px] border-r border-black p-1">Số chuyển</th>
                  <th className="w-[55px] border-r border-black p-1">SP lỗi</th>
                  <th className="w-[55px] border-r border-black p-1">Số thiếu</th>
                  <th className="w-[60px] border-r border-black p-1">Số chuyển</th>
                  <th className="w-[55px] border-r border-black p-1">SP lỗi</th>
                  <th className="w-[55px] border-r border-black p-1">Số thiếu</th>
                  <th className="w-[85px] border-r border-black p-1">Người Nhận</th>
                  <th className="w-[85px] p-1">Người Giao</th>
                </tr>
              </thead>
              <tbody>
                {paddedRows.map((row, idx) => {
                  const hasData = Boolean(row.productName);
                  const matchingPo = hasData
                    ? FALLBACK_ORDERS.find(
                        (o) =>
                          (row.poId && o.poId.toLowerCase() === row.poId.toLowerCase()) ||
                          (row.productName && o.productName.trim().toLowerCase() === row.productName.trim().toLowerCase())
                      )
                    : null;
                  const printProdMissing =
                    row.prodQtyMissing > 0
                      ? row.prodQtyMissing
                      : matchingPo && matchingPo.qtyPo > 0
                      ? Math.max(0, matchingPo.qtyPo - (row.prodQtyTransferred || 0) - (row.prodQtyDefect || 0)) || ''
                      : '';
                  const printRawMissing =
                    row.rawQtyMissing > 0
                      ? row.rawQtyMissing
                      : matchingPo && matchingPo.qtyPo > 0
                      ? Math.max(0, matchingPo.qtyPo - (row.rawQtyTransferred || 0) - (row.rawQtyDefect || 0)) || ''
                      : '';

                  return (
                    <tr
                      key={row.id || idx}
                      className="border-b border-black text-slate-900 min-h-[38px] h-[38px]"
                    >
                      <td className="border-r border-black p-1.5 font-bold font-mono-num">{idx + 1}</td>
                      <td className="border-r border-black p-1.5 text-left font-semibold">
                        {row.productName}
                      </td>
                      <td className="border-r border-black p-1.5 text-left text-[11px]">
                        {row.customer}
                      </td>
                      <td className="border-r border-black p-1.5">{row.unit || (hasData ? 'Cái' : '')}</td>
                      <td className="border-r border-black p-1.5 font-mono-num font-bold">
                        {hasData && row.prodQtyTransferred > 0 ? row.prodQtyTransferred : ''}
                      </td>
                      <td className="border-r border-black p-1.5 font-mono-num text-rose-700 font-bold">
                        {hasData && row.prodQtyDefect > 0 ? row.prodQtyDefect : ''}
                      </td>
                      <td className="border-r border-black p-1.5 font-mono-num text-amber-700 font-bold">
                        {hasData ? (printProdMissing || '') : ''}
                      </td>
                      <td className="border-r border-black p-1.5 font-mono-num font-bold">
                        {hasData && row.rawQtyTransferred > 0 ? row.rawQtyTransferred : ''}
                      </td>
                      <td className="border-r border-black p-1.5 font-mono-num text-rose-700 font-bold">
                        {hasData && row.rawQtyDefect > 0 ? row.rawQtyDefect : ''}
                      </td>
                      <td className="border-r border-black p-1.5 font-mono-num text-amber-700 font-bold">
                        {hasData ? (printRawMissing || '') : ''}
                      </td>
                      <td className="border-r border-black p-1.5 text-left text-[11px]">
                        {row.note}
                      </td>
                      <td className="border-r border-black p-1.5 text-[11px] font-semibold">
                        {row.receiverName}
                      </td>
                      <td className="p-1.5 text-[11px] font-semibold">
                        {row.senderName}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* 4 Bottom Signature Blocks matching exact Form BM.GC.01.02 */}
            <div className="grid grid-cols-4 border-t-2 border-black text-center text-xs">
              <div className="border-r border-black p-3 pb-24">
                <div className="font-black uppercase tracking-wider text-slate-900">
                  PX GIA CÔNG
                </div>
                <div className="mt-1 text-[10px] italic text-slate-600">(Ký, họ tên)</div>
              </div>
              <div className="border-r border-black p-3 pb-24">
                <div className="font-black uppercase tracking-wider text-slate-900">
                  PX HOÀN THIỆN
                </div>
                <div className="mt-1 text-[10px] italic text-slate-600">(Ký, họ tên)</div>
              </div>
              <div className="border-r border-black p-3 pb-24">
                <div className="font-black uppercase tracking-wider text-slate-900">
                  PX NHIỆT LUYỆN
                </div>
                <div className="mt-1 text-[10px] italic text-slate-600">(Ký, họ tên)</div>
              </div>
              <div className="p-3 pb-24">
                <div className="font-black uppercase tracking-wider text-slate-900">
                  PHÒNG KHVT
                </div>
                <div className="mt-1 text-[10px] italic text-slate-600">(Ký, họ tên)</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default HandoverSlipPrint;

