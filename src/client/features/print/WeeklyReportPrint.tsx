import React, { useEffect, useState } from 'react';
import { ArrowLeft, Printer, Download } from 'lucide-react';
import type { WeeklyReportData } from '@shared/types';
import { apiClient } from '../../lib/apiClient';
import { formatDateVn, formatNumber, formatVnd } from '../../lib/formatters';
import { navigateTo } from '../../lib/navigation';
import { VicoLogo } from '../../components/VicoLogo';
import { downloadWeeklyReportExcel } from '../../lib/excelService';

export function WeeklyReportPrint() {
  const [weekStart, setWeekStart] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      return url.searchParams.get('weekStart') || '2026-10-15';
    }
    return '2026-10-15';
  });

  const [report, setReport] = useState<WeeklyReportData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      try {
        const res = await apiClient.get<WeeklyReportData>(
          `/reports/weekly?weekStart=${encodeURIComponent(weekStart)}`
        );
        if (mounted) {
          setReport(res);
        }
      } catch (err) {
        console.error('Failed to load weekly report print data', err);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void load();
    return () => {
      mounted = false;
    };
  }, [weekStart]);

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
            <span className="text-xs font-bold text-slate-700">Tuần bắt đầu (Thứ 5):</span>
            <input
              type="date"
              value={weekStart}
              onChange={(e) => setWeekStart(e.target.value)}
              className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-bold text-slate-900"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => report && void downloadWeeklyReportExcel(report)}
            disabled={!report}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-xs font-bold text-emerald-800 shadow-sm hover:bg-emerald-100 disabled:opacity-50"
          >
            <Download className="h-4 w-4 text-emerald-700" />
            Xuất File Excel (BM: GCCK.BC.02)
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-blue-700"
          >
            <Printer className="h-4 w-4" />
            In Báo Cáo Tuần (Ctrl + P)
          </button>
        </div>
      </div>

      {loading || !report ? (
        <div className="py-20 text-center text-sm font-semibold text-slate-500">
          Đang tải dữ liệu báo cáo tuần...
        </div>
      ) : (
        /* Main A4 Printable Document Container */
        <div className="mx-auto max-w-[1200px] bg-white p-6 shadow-md print:max-w-none print:p-2 print:shadow-none space-y-6">
          {/* Header Block matching VICO ISO Standard */}
          <div className="border border-black">
            <div className="grid grid-cols-12 border-b border-black text-center">
              {/* Logo VICO */}
              <div className="col-span-2 flex items-center justify-center border-r border-black p-2">
                <VicoLogo className="h-10 w-auto object-contain" />
              </div>

              {/* Title */}
              <div className="col-span-8 flex flex-col items-center justify-center p-2">
                <h1 className="text-xl font-black uppercase tracking-wider text-slate-900">
                  BÁO CÁO TỔNG HỢP SẢN XUẤT TUẦN &amp; CÂN BẰNG NĂNG LỰC TẢI
                </h1>
                <div className="text-xs font-bold text-slate-700 mt-1">
                  Chu kỳ: Thứ 5 ({formatDateVn(report.weekStart)}) &rarr; Thứ 4 ({formatDateVn(report.weekEnd)})
                </div>
              </div>

              {/* Form Metadata */}
              <div className="col-span-2 flex flex-col justify-center border-l border-black p-2 text-left text-[11px] leading-tight">
                <div><strong>Mã BM:</strong> GCCK.BC.02</div>
                <div><strong>Lần BH:</strong> 01</div>
                <div><strong>Ngày in:</strong> {new Date().toLocaleDateString('vi-VN')}</div>
              </div>
            </div>

            {/* Quick KPI Banner */}
            <div className="grid grid-cols-4 divide-x divide-black bg-slate-50 p-2 text-center text-xs">
              <div>
                <span className="text-slate-600">Tổng SL Kế Hoạch:</span>{' '}
                <strong className="text-slate-900">{formatNumber(report.summary.totalPlannedQty)} SP</strong>
              </div>
              <div>
                <span className="text-slate-600">Thực Tế Đạt:</span>{' '}
                <strong className="text-blue-700">{formatNumber(report.summary.totalActualQty)} SP</strong>
              </div>
              <div>
                <span className="text-slate-600">Tỷ Lệ Hoàn Thành:</span>{' '}
                <strong className={report.summary.completionPct >= 90 ? 'text-emerald-700' : 'text-amber-700'}>
                  {report.summary.completionPct}%
                </strong>
              </div>
              <div>
                <span className="text-slate-600">Đơn Hàng Chậm:</span>{' '}
                <strong className={report.summary.delayedPoCount > 0 ? 'text-rose-600' : 'text-emerald-600'}>
                  {report.summary.delayedPoCount} ĐH
                </strong>
              </div>
            </div>
          </div>

          {/* KHỐI 1: TỔNG HỢP SẢN LƯỢNG & TIẾN ĐỘ THEO KHÁCH HÀNG */}
          <div>
            <h2 className="text-xs font-black uppercase tracking-wider text-slate-900 border-b border-black pb-1 mb-2">
              Khối 1: Tổng Hợp Sản Lượng &amp; Tiến Độ Theo Khách Hàng
            </h2>
            <table className="w-full border-collapse border border-black text-xs text-slate-900">
              <thead>
                <tr className="bg-slate-100 font-bold uppercase text-[11px] text-center">
                  <th className="border border-black px-2 py-1 w-10">STT</th>
                  <th className="border border-black px-3 py-1 text-left">Khách Hàng</th>
                  <th className="border border-black px-2 py-1">Số Chi Tiết SP</th>
                  <th className="border border-black px-2 py-1">Kế Hoạch (SP)</th>
                  <th className="border border-black px-2 py-1">Thực Tế (SP)</th>
                  <th className="border border-black px-2 py-1">Tỷ Lệ Đạt</th>
                </tr>
              </thead>
              <tbody>
                {report.customerStats.map((c, idx) => (
                  <tr key={c.customer} className="text-center">
                    <td className="border border-black px-2 py-1 font-bold">{idx + 1}</td>
                    <td className="border border-black px-3 py-1 text-left font-bold">{c.customer}</td>
                    <td className="border border-black px-2 py-1">{c.productCount}</td>
                    <td className="border border-black px-2 py-1 font-mono-num">{formatNumber(c.plannedQty)}</td>
                    <td className="border border-black px-2 py-1 font-mono-num font-bold text-blue-800">{formatNumber(c.actualQty)}</td>
                    <td className="border border-black px-2 py-1 font-bold">{c.completionPct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* KHỐI 2: TỔNG HỢP GIỜ CÔNG & LAO ĐỘNG (DỰA THEO PHÂN HỆ CHẤM CÔNG) */}
          <div>
            <div className="flex items-center justify-between border-b border-black pb-1 mb-2">
              <h2 className="text-xs font-black uppercase tracking-wider text-slate-900">
                Khối 2: Tổng Hợp Giờ Công &amp; Lao Động (Dựa Theo Phân Hệ Chấm Công)
              </h2>
              <span className="text-[10px] italic text-slate-600">
                * Trích xuất trực tiếp từ bảng chấm công 7 ngày trong tuần
              </span>
            </div>
            <table className="w-full border-collapse border border-black text-xs text-slate-900">
              <thead>
                <tr className="bg-slate-100 font-bold uppercase text-[11px] text-center">
                  <th className="border border-black px-2 py-1 w-10">STT</th>
                  <th className="border border-black px-3 py-1 text-left">Họ Và Tên</th>
                  <th className="border border-black px-2 py-1">Công Chuẩn (Ca)</th>
                  <th className="border border-black px-2 py-1">Thêm Giờ (OT h)</th>
                  <th className="border border-black px-2 py-1">Tăng Ca CN (h)</th>
                  <th className="border border-black px-2 py-1">Nghỉ / Phép</th>
                  <th className="border border-black px-2 py-1">Tổng Công Quy Đổi</th>
                  <th className="border border-black px-2 py-1">Sản Lượng SP Làm Ra</th>
                </tr>
              </thead>
              <tbody>
                {report.workerLaborStats.map((w, idx) => (
                  <tr key={w.workerId} className="text-center">
                    <td className="border border-black px-2 py-1 font-bold">{idx + 1}</td>
                    <td className="border border-black px-3 py-1 text-left font-bold">{w.workerName}</td>
                    <td className="border border-black px-2 py-1 font-mono-num">{w.standardShifts} ca</td>
                    <td className="border border-black px-2 py-1 font-mono-num">{w.otHours > 0 ? `+${w.otHours}h` : '—'}</td>
                    <td className="border border-black px-2 py-1 font-mono-num">{w.sundayHours > 0 ? `${w.sundayHours}h` : '—'}</td>
                    <td className="border border-black px-2 py-1 font-mono-num">
                      {w.offDays > 0 || w.pDays > 0 ? `${w.offDays + w.pDays}d` : '0'}
                    </td>
                    <td className="border border-black px-2 py-1 font-mono-num font-black text-emerald-900">
                      {w.totalConvertedShifts} công
                    </td>
                    <td className="border border-black px-2 py-1 font-mono-num font-bold text-blue-800">
                      {w.actualCompletedPieces} SP
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* KHỐI 3: SỰ CỐ THIẾT BỊ & DỪNG MÁY TRONG TUẦN */}
          <div>
            <h2 className="text-xs font-black uppercase tracking-wider text-slate-900 border-b border-black pb-1 mb-2">
              Khối 3: Thống Kê Sự Cố Thiết Bị &amp; Thời Gian Dừng Máy (Downtime)
            </h2>
            {report.downtimeIncidents.length === 0 ? (
              <div className="border border-dashed border-slate-300 p-2 text-center text-xs text-slate-600">
                Không ghi nhận sự cố dừng máy kỹ thuật trong chu kỳ tuần này.
              </div>
            ) : (
              <table className="w-full border-collapse border border-black text-xs text-slate-900">
                <thead>
                  <tr className="bg-slate-100 font-bold uppercase text-[11px] text-center">
                    <th className="border border-black px-2 py-1 w-10">STT</th>
                    <th className="border border-black px-2 py-1">Ngày</th>
                    <th className="border border-black px-3 py-1 text-left">Thiết Bị / Máy</th>
                    <th className="border border-black px-2 py-1">Thời Gian Dừng</th>
                    <th className="border border-black px-3 py-1 text-left">Nguyên Nhân / Khắc Phục</th>
                  </tr>
                </thead>
                <tbody>
                  {report.downtimeIncidents.map((inc, idx) => (
                    <tr key={inc.id} className="text-center">
                      <td className="border border-black px-2 py-1 font-bold">{idx + 1}</td>
                      <td className="border border-black px-2 py-1">{formatDateVn(inc.date)}</td>
                      <td className="border border-black px-3 py-1 text-left font-bold">{inc.machineName}</td>
                      <td className="border border-black px-2 py-1 font-mono-num font-bold text-rose-700">{inc.stopMinutes} phút</td>
                      <td className="border border-black px-3 py-1 text-left">{inc.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* KHỐI 4: KẾ HOẠCH TUẦN TỚI & ĐỀ XUẤT GIA CÔNG NGOÀI */}
          <div>
            <h2 className="text-xs font-black uppercase tracking-wider text-slate-900 border-b border-black pb-1 mb-2">
              Khối 4: Kế Hoạch Tuần Tới &amp; Đề Xuất Gia Công Ngoài (Outsource)
            </h2>
            <div className="border border-black p-2 mb-2 text-xs">
              <div className="font-bold">
                Tình trạng cân bằng tải máy:{' '}
                <span className={report.nextWeekForecast.isOverloaded ? 'text-rose-700 font-black' : 'text-emerald-700 font-black'}>
                  {report.nextWeekForecast.isOverloaded ? 'VƯỢT NĂNG LỰC PHÂN XƯỞNG' : 'ĐỦ NĂNG LỰC ĐÁP ỨNG KẾ HOẠCH'}
                </span>
              </div>
              <div className="text-[11px] text-slate-700 mt-0.5">
                Bù đơn hàng thiếu tuần trước: <strong>{report.nextWeekForecast.carryoverBacklogQty} SP</strong> &bull; Tổng giờ gia công yêu cầu: <strong>{report.nextWeekForecast.totalRequiredHours}h</strong> / Năng lực phân xưởng: <strong>{report.nextWeekForecast.machineCapacityHours}h</strong>.
              </div>
            </div>

            {report.nextWeekForecast.outsourceRecommendations.length > 0 && (
              <table className="w-full border-collapse border border-black text-xs text-slate-900">
                <thead>
                  <tr className="bg-slate-100 font-bold uppercase text-[11px] text-center">
                    <th className="border border-black px-2 py-1 w-10">STT</th>
                    <th className="border border-black px-3 py-1 text-left">Đơn Hàng / Chi Tiết</th>
                    <th className="border border-black px-3 py-1 text-left">Khách Hàng</th>
                    <th className="border border-black px-2 py-1">SL Đề Xuất Chuyển</th>
                    <th className="border border-black px-3 py-1 text-left">Lý Do Đề Xuất</th>
                    <th className="border border-black px-3 py-1 text-right">Chi Phí Dự Kiến</th>
                  </tr>
                </thead>
                <tbody>
                  {report.nextWeekForecast.outsourceRecommendations.map((rec, idx) => (
                    <tr key={rec.poId} className="text-center">
                      <td className="border border-black px-2 py-1 font-bold">{idx + 1}</td>
                      <td className="border border-black px-3 py-1 text-left font-bold">{rec.poId} - {rec.productName}</td>
                      <td className="border border-black px-3 py-1 text-left">{rec.customer}</td>
                      <td className="border border-black px-2 py-1 font-mono-num font-bold text-purple-900">{rec.suggestedOutsourceQty} SP</td>
                      <td className="border border-black px-3 py-1 text-left">{rec.reason}</td>
                      <td className="border border-black px-3 py-1 text-right font-mono-num font-bold">{formatVnd(rec.estimatedOutsourceCost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* KHỐI 5: CÁC ĐỀ XUẤT & KIẾN NGHỊ KHÁC */}
          <div>
            <h2 className="text-xs font-black uppercase tracking-wider text-slate-900 border-b border-black pb-1 mb-2">
              Khối 5: Các Đề Xuất &amp; Kiến Nghị Khác
            </h2>
            {report.proposals && report.proposals.length > 0 ? (
              <table className="w-full border-collapse border border-black text-xs text-slate-900">
                <thead>
                  <tr className="bg-slate-100 font-bold uppercase text-[11px] text-center">
                    <th className="border border-black px-2 py-1 w-10">STT</th>
                    <th className="border border-black px-2 py-1">Phân Loại</th>
                    <th className="border border-black px-3 py-1 text-left">Người Đề Xuất</th>
                    <th className="border border-black px-4 py-1 text-left">Nội Dung Đề Xuất / Kiến Nghị</th>
                    <th className="border border-black px-2 py-1">Mức Độ</th>
                    <th className="border border-black px-2 py-1">Trạng Thái</th>
                  </tr>
                </thead>
                <tbody>
                  {report.proposals.map((p, idx) => (
                    <tr key={p.id} className="text-center">
                      <td className="border border-black px-2 py-1 font-bold">{idx + 1}</td>
                      <td className="border border-black px-2 py-1 font-bold text-slate-700">{p.category}</td>
                      <td className="border border-black px-3 py-1 text-left font-bold">{p.proposer || 'Phân xưởng'}</td>
                      <td className="border border-black px-4 py-1 text-left">{p.content}</td>
                      <td className="border border-black px-2 py-1 font-bold">{p.priority}</td>
                      <td className="border border-black px-2 py-1 font-bold">
                        {p.status === 'APPROVED' ? 'Đã duyệt' : p.status === 'REJECTED' ? 'Từ chối' : 'Chờ duyệt'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="border border-dashed border-slate-300 p-2 text-center text-xs text-slate-600">
                Không có đề xuất hoặc kiến nghị phát sinh trong tuần này.
              </div>
            )}
          </div>

          {/* SIGNATURES BLOCK */}
          <div className="grid grid-cols-3 pt-6 text-center text-xs font-bold text-slate-900">
            <div>
              <div className="uppercase">Người Lập Biểu</div>
              <div className="text-[11px] font-normal italic text-slate-500">(Ký, ghi rõ họ tên)</div>
              <div className="h-20" />
            </div>
            <div>
              <div className="uppercase">Quản Đốc Phân Xưởng</div>
              <div className="text-[11px] font-normal italic text-slate-500">(Ký, ghi rõ họ tên)</div>
              <div className="h-20" />
            </div>
            <div>
              <div className="uppercase">Ban Giám Đốc Phê Duyệt</div>
              <div className="text-[11px] font-normal italic text-slate-500">(Ký, ghi rõ họ tên)</div>
              <div className="h-20" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

