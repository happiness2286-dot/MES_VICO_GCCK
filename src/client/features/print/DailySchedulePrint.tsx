import React, { useEffect, useState } from 'react';
import { ArrowLeft, Printer } from 'lucide-react';
import type { DailyPlanRow } from '@shared/types';
import { apiClient } from '../../lib/apiClient';
import { navigateTo } from '../../lib/navigation';
import { VicoLogo } from '../../components/VicoLogo';

export function DailySchedulePrint() {
  const [workDate, setWorkDate] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      return url.searchParams.get('date') || '2026-10-21';
    }
    return '2026-10-21';
  });

  const [rows, setRows] = useState<DailyPlanRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      try {
        const res = await apiClient.get<{ success: boolean; rows: DailyPlanRow[] }>(
          `/schedules/daily?date=${encodeURIComponent(workDate)}`
        );
        if (mounted) {
          setRows(res.rows || []);
        }
      } catch (err) {
        console.error('Failed to load schedule print data', err);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void load();
    return () => {
      mounted = false;
    };
  }, [workDate]);

  const [y, m, d] = (workDate || '').split('-');
  const displayDateStr = d && m && y ? `${d}/${m}/${y}` : workDate;

  // Group by shift
  const shiftGroups = ['Ca 1', 'Ca 2', 'Ca 3', 'Ca Hành chính', 'Tăng ca'].filter((s) =>
    rows.some((r) => r.shiftType === s)
  );

  return (
    <div className="min-h-screen bg-slate-100 p-4 sm:p-6 print:bg-white print:p-0">
      {/* Top action toolbar (hidden on print) */}
      <div className="no-print mx-auto mb-4 flex max-w-[1200px] flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigateTo('/admin')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
          >
            <ArrowLeft className="h-4 w-4" />
            Về Quản Trị
          </button>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-700">Ngày kế hoạch:</span>
            <input
              type="date"
              value={workDate}
              onChange={(e) => setWorkDate(e.target.value)}
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
        {/* Header Block matching VICO Form GCCK.QT.01.BM01 */}
        <div className="border border-black">
          <div className="grid grid-cols-12 border-b border-black text-center">
            {/* Logo VICO */}
            <div className="col-span-2 flex items-center justify-center border-r border-black p-2">
              <VicoLogo className="h-10 w-auto object-contain" />
            </div>

            {/* Title */}
            <div className="col-span-8 flex flex-col items-center justify-center p-2">
              <h1 className="text-2xl font-black uppercase tracking-wider text-slate-900">
                KẾ HOẠCH SẢN XUẤT
              </h1>
            </div>

            {/* Meta Code & Date */}
            <div className="col-span-2 flex flex-col justify-between border-l border-black p-1.5 text-right font-mono text-[11px] font-bold">
              <div>GCCK.QT.01.BM01</div>
              <div className="text-slate-800">NGÀY {displayDateStr}</div>
            </div>
          </div>

          {/* Table Content */}
          <table className="w-full border-collapse text-left text-[11px] text-slate-900">
            <thead>
              <tr className="border-b border-black bg-slate-100 text-center font-extrabold uppercase">
                <th className="w-12 border-r border-black py-1.5">Ca</th>
                <th className="w-8 border-r border-black py-1.5">STT</th>
                <th className="w-36 border-r border-black px-2 py-1.5">HỌ VÀ TÊN</th>
                <th className="border-r border-black px-2 py-1.5">SẢN PHẨM / BẢN VẼ</th>
                <th className="w-32 border-r border-black px-2 py-1.5">KHÁCH HÀNG</th>
                <th className="border-r border-black px-2 py-1.5">CÔNG ĐOẠN HT</th>
                <th className="w-16 border-r border-black py-1.5">KẾ HOẠCH</th>
                <th className="w-40 border-r border-black px-2 py-1.5">MÁY / CA</th>
                <th className="w-20 border-r border-black py-1.5">MÃ QR</th>
                <th className="w-28 px-2 py-1.5">Ghi chú</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={10} className="p-8 text-center text-slate-500">
                    Đang tải dữ liệu biểu mẫu kế hoạch...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="p-8 text-center text-slate-500">
                    Chưa có kế hoạch nào được lập cho ngày {displayDateStr}.
                  </td>
                </tr>
              ) : (
                shiftGroups.map((shift) => {
                  const shiftRows = rows.filter((r) => r.shiftType === shift);
                  return shiftRows.map((row, idx) => {
                    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=70x70&data=${encodeURIComponent(
                      `GCCK|${row.customer || 'VICO'}|${row.productName}|${row.workerName}`
                    )}`;

                    return (
                      <tr
                        key={row.id || `${shift}-${idx}`}
                        className="border-b border-black hover:bg-slate-50"
                      >
                        {idx === 0 && (
                          <td
                            rowSpan={shiftRows.length}
                            className="border-r border-black text-center font-extrabold italic text-slate-900"
                          >
                            {shift}
                          </td>
                        )}
                        <td className="border-r border-black text-center font-mono font-bold">
                          {row.stt || idx + 1}
                        </td>
                        <td className="border-r border-black px-2 py-1 font-bold">
                          {row.workerName}
                        </td>
                        <td className="border-r border-black px-2 py-1 font-semibold">
                          {row.productName}
                        </td>
                        <td className="border-r border-black px-2 py-1">{row.customer}</td>
                        <td className="border-r border-black px-2 py-1">{row.opName}</td>
                        <td className="border-r border-black text-center font-mono font-bold">
                          {row.plannedQty}
                        </td>
                        <td className="border-r border-black px-2 py-1 font-semibold text-slate-800">
                          {row.machineName}
                        </td>
                        <td className="border-r border-black p-0.5 text-center">
                          <img
                            src={qrUrl}
                            alt="QR Scan"
                            className="mx-auto h-11 w-11 object-contain"
                            loading="lazy"
                          />
                        </td>
                        <td className="px-2 py-1 text-[10px] font-semibold text-amber-900">
                          {row.note}
                        </td>
                      </tr>
                    );
                  });
                })
              )}
            </tbody>
          </table>

          {/* Footer Safety Regulations in Red (Matching the user's Excel) */}
          <div className="border-t border-black bg-white p-3 font-semibold text-red-600">
            <div className="text-xs font-bold leading-relaxed">
              <div>Note: 1. Tuân thủ theo kế hoạch đề ra</div>
              <div>2. Bất thường báo cáo theo quy trình sản xuất đến trưởng ca, Quản Đốc</div>
              <div>3. Báo cáo bàn giao ca theo quy định.</div>
            </div>

            {/* Signatures */}
            <div className="mt-6 grid grid-cols-3 text-center text-xs text-slate-900">
              <div>
                <div className="font-bold">Người Lập Biểu</div>
                <div className="mt-12 font-medium">(Ký &amp; Ghi rõ họ tên)</div>
              </div>
              <div>
                <div className="font-bold">Trưởng Ca Vận Hành</div>
                <div className="mt-12 font-medium">(Ký &amp; Ghi rõ họ tên)</div>
              </div>
              <div>
                <div className="font-bold">Quản Đốc Phân Xưởng</div>
                <div className="mt-12 font-medium">(Ký &amp; Phê duyệt)</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
