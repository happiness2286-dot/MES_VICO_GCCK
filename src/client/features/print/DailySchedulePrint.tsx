import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Printer } from 'lucide-react';
import type { DailyPlanRow } from '@shared/types';
import { apiClient } from '../../lib/apiClient';
import { navigateTo } from '../../lib/navigation';
import { VicoLogo } from '../../components/VicoLogo';
import { sortDailyPlanRows } from '../../lib/baselinePlan';

export function DailySchedulePrint() {
  const [workDate, setWorkDate] = useState<string>(() => {
    const vnToday = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      return (
        url.searchParams.get('date') ||
        localStorage.getItem('GCCK_SELECTED_PLAN_DATE') ||
        vnToday
      );
    }
    return vnToday;
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
          setRows(sortDailyPlanRows(res.rows || []));
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
  const displayDateStr =
    d && m && y ? `${Number(d) || d}/${Number(m) || m}/${y}` : workDate;

  const sortedRows = useMemo(() => sortDailyPlanRows(rows), [rows]);

  // Precompute rowSpans for Ca Làm Việc (col 2) and Người Thực Hiện (col 3)
  const { shiftSpans, workerSpans } = useMemo(() => {
    const sSpans = new Array<number>(sortedRows.length).fill(0);
    const wSpans = new Array<number>(sortedRows.length).fill(0);

    let sStart = 0;
    for (let i = 1; i <= sortedRows.length; i++) {
      const prevShift = sortedRows[sStart]?.shiftType || 'Ca 1';
      const curShift = i < sortedRows.length ? sortedRows[i]?.shiftType || 'Ca 1' : null;
      if (curShift !== prevShift) {
        sSpans[sStart] = i - sStart;
        sStart = i;
      }
    }

    let wStart = 0;
    for (let i = 1; i <= sortedRows.length; i++) {
      const prev = sortedRows[wStart];
      const cur = i < sortedRows.length ? sortedRows[i] : null;
      const sameWorkerInShift =
        cur &&
        (cur.shiftType || 'Ca 1') === (prev?.shiftType || 'Ca 1') &&
        (cur.workerName || '').trim() === (prev?.workerName || '').trim();
      if (!sameWorkerInShift) {
        wSpans[wStart] = i - wStart;
        wStart = i;
      }
    }

    return { shiftSpans: sSpans, workerSpans: wSpans };
  }, [sortedRows]);

  return (
    <div className="min-h-screen bg-slate-100 p-4 sm:p-6 print:bg-white print:p-0">
      {/* Top action toolbar (hidden on print) */}
      <div className="no-print mx-auto mb-4 flex max-w-[1250px] flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
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
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#00B050] px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-700"
          >
            <Printer className="h-4 w-4" />
            In Biểu Mẫu A4 (Ctrl + P)
          </button>
        </div>
      </div>

      {/* Main A4 Printable Document Container */}
      <div className="mx-auto max-w-[1250px] bg-white p-6 shadow-md print:max-w-none print:p-2 print:shadow-none">
        {/* Header Block matching VICO Form GCCK.QT.01.BM01 */}
        <div className="border border-black">
          <div className="grid grid-cols-12 items-center border-b border-black py-2">
            {/* Logo VICO */}
            <div className="col-span-2 flex items-center justify-center px-2">
              <VicoLogo className="h-11 w-auto object-contain" />
            </div>

            {/* Title */}
            <div className="col-span-7 flex flex-col items-center justify-center px-2 text-center">
              <h1 className="text-2xl font-black uppercase tracking-wide text-black">
                KẾ HOẠCH SẢN XUẤT NGÀY
              </h1>
            </div>

            {/* Meta Date & Code matching I2 & J2 boxes */}
            <div className="col-span-3 flex items-end justify-end pr-2 pt-3">
              <div className="grid grid-cols-2 border border-black text-center text-[11px] font-bold text-black">
                <div className="border-r border-black px-2.5 py-1 italic">
                  NGÀY {displayDateStr}
                </div>
                <div className="px-2.5 py-1">GCCK.QT.01.BM01</div>
              </div>
            </div>
          </div>

          {/* Table Content matching exact 10 columns of user's Excel form */}
          <table className="w-full border-collapse text-left text-[11px] text-black">
            <thead>
              <tr
                className="border-b border-black bg-[#00B050] text-center font-bold text-white"
                style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
              >
                <th className="w-10 border-r border-black py-2">STT</th>
                <th className="w-20 border-r border-black py-2">Ca Làm Việc</th>
                <th className="w-36 border-r border-black px-2 py-2">Người Thực Hiện (Thợ)</th>
                <th className="w-40 border-r border-black px-2 py-2">Khách Hàng</th>
                <th className="border-r border-black px-2 py-2">Tên Sản Phẩm / Bản Vẽ</th>
                <th className="border-r border-black px-2 py-2">Công Đoạn / Nguyên Công</th>
                <th className="w-24 border-r border-black px-1 py-2">Số Lượng Kế Hoạch</th>
                <th className="w-36 border-r border-black px-2 py-2">Máy Thực Hiện</th>
                <th className="w-24 border-r border-black px-1 py-2">Số Lượng Thực Tế</th>
                <th className="w-36 px-2 py-2">Ghi Chú</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={10} className="p-8 text-center text-slate-500">
                    Đang tải dữ liệu biểu mẫu kế hoạch...
                  </td>
                </tr>
              ) : sortedRows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="p-8 text-center text-slate-500">
                    Chưa có kế hoạch nào được lập cho ngày {displayDateStr}.
                  </td>
                </tr>
              ) : (
                sortedRows.map((row, idx) => {
                  const noteStr = row.note || 'Máy chính';
                  const isSecondMachine = /ghép|0\.33|máy phụ/i.test(noteStr);
                  const rowTintStyle = {
                    backgroundColor: isSecondMachine ? '#FFFBEB' : '#F0F9FF',
                    WebkitPrintColorAdjust: 'exact' as const,
                    printColorAdjust: 'exact' as const,
                  };
                  const machineTintStyle = {
                    backgroundColor: isSecondMachine ? '#FEF3C7' : '#DFF2FE',
                    color: isSecondMachine ? '#92400E' : '#075985',
                    WebkitPrintColorAdjust: 'exact' as const,
                    printColorAdjust: 'exact' as const,
                  };

                  return (
                    <tr key={row.id || `row-${idx}`} className="border-b border-black">
                      <td className="border-r border-black py-1.5 text-center font-medium">
                        {idx + 1}
                      </td>
                      {shiftSpans[idx] > 0 && (
                        <td
                          rowSpan={shiftSpans[idx]}
                          className="border-r border-black bg-white px-1 py-1.5 text-center align-middle font-medium text-black"
                        >
                          {row.shiftType || 'Ca 1'}
                        </td>
                      )}
                      {workerSpans[idx] > 0 && (
                        <td
                          rowSpan={workerSpans[idx]}
                          className="border-r border-black bg-white px-2 py-1.5 text-center align-middle font-medium text-black"
                        >
                          {row.workerName}
                        </td>
                      )}
                      <td className="border-r border-black px-2 py-1.5" style={rowTintStyle}>
                        {row.customer}
                      </td>
                      <td className="border-r border-black px-2 py-1.5" style={rowTintStyle}>
                        {row.productName}
                      </td>
                      <td className="border-r border-black px-2 py-1.5" style={rowTintStyle}>
                        {row.opName}
                      </td>
                      <td
                        className="border-r border-black px-2 py-1.5 text-right font-medium"
                        style={rowTintStyle}
                      >
                        {String(Number(row.plannedQty || 0)).replace('.', ',')}
                      </td>
                      <td
                        className="border-r border-black px-2 py-1.5 font-medium"
                        style={machineTintStyle}
                      >
                        {row.machineName}
                      </td>
                      <td
                        className="border-r border-black px-2 py-1.5 text-right font-medium"
                        style={rowTintStyle}
                      >
                        {Number(row.actualQty || 0)}
                      </td>
                      <td
                        className="px-2 py-1.5 font-semibold"
                        style={machineTintStyle}
                      >
                        {noteStr}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>

          {/* Footer Safety Regulations in Red */}
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
