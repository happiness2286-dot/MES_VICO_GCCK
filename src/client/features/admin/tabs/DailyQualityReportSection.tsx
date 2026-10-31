import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  CheckCircle2,
  Copy,
  Edit2,
  FileSpreadsheet,
  Plus,
  Printer,
  RefreshCw,
  Save,
  Trash2,
  XCircle,
  AlertTriangle,
} from 'lucide-react';
import type {
  BootstrapPayload,
  DailyQualityReportData,
  DailyQualityReportItem,
  ProductionLogDto,
} from '@shared/types';
import { apiClient } from '../../../lib/apiClient';
import { getAllFallbackLogs, FALLBACK_PRODUCTS } from '../../../lib/clientFallbackStore';
import { fetchLogsFromSupabase } from '../../../lib/supabaseClient';
import { formatDateVn, formatNumber } from '../../../lib/formatters';
import { downloadDailyQualityReportExcel } from '../../../lib/excelService';
import { Badge, Button, Card, Modal, useToast } from '../../../components/ui/IndustrialPrimitives';
import { VicoLogo } from '../../../components/VicoLogo';

export interface DailyQualityReportSectionProps {
  bootstrap: BootstrapPayload;
}

const STORAGE_PREFIX = 'GCCK_DAILY_QUALITY_REPORT_V1_';

export function DailyQualityReportSection({ bootstrap }: DailyQualityReportSectionProps) {
  const toast = useToast();

  const getTodayStr = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
  const getYesterdayStr = () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
  };

  const [selectedDate, setSelectedDate] = useState<string>(getTodayStr);
  const [reportCode] = useState('BM.KTCN.04.03');
  const [issueNo] = useState('01');
  const [effectiveDate] = useState('28/03/2026');
  const [workshop] = useState('GIA CÔNG CƠ KHÍ');
  const [companyName] = useState('CÔNG TY TNHH THẮNG LỢI');

  const [items, setItems] = useState<DailyQualityReportItem[]>([]);
  const [loadingSync, setLoadingSync] = useState(false);

  // Edit / Add Item Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<DailyQualityReportItem | null>(null);
  const [formProdName, setFormProdName] = useState('');
  const [formCustomer, setFormCustomer] = useState('');
  const [formSteelGrade, setFormSteelGrade] = useState('');
  const [formAssessedQty, setFormAssessedQty] = useState(0);
  const [formOkQty, setFormOkQty] = useState(0);
  const [formReworkQty, setFormReworkQty] = useState(0);
  const [formReworkReason, setFormReworkReason] = useState('');
  const [formScrapQty, setFormScrapQty] = useState(0);
  const [formScrapReason, setFormScrapReason] = useState('');
  const [formNote, setFormNote] = useState('');

  // Load saved report from localStorage or auto-synthesize
  const loadReportForDate = useCallback(
    (targetDate: string) => {
      try {
        const raw = localStorage.getItem(`${STORAGE_PREFIX}${targetDate}`);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed?.items)) {
            setItems(parsed.items);
            return;
          }
        }
      } catch {}

      // If no saved report, try to auto synthesize from current logs
      void synthesizeFromLogs(targetDate, true);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  useEffect(() => {
    loadReportForDate(selectedDate);
  }, [selectedDate, loadReportForDate]);

  // Save current report to localStorage
  const handleSaveReport = () => {
    const reportData: DailyQualityReportData = {
      reportDate: selectedDate,
      reportCode,
      issueNo,
      effectiveDate,
      workshop,
      companyName,
      items,
      preparedBy: 'Trần Văn Dũng',
      qcBy: 'Trần Văn Dũng (QC)',
      approvedBy: 'Quản Đốc Phân Xưởng',
    };
    try {
      localStorage.setItem(`${STORAGE_PREFIX}${selectedDate}`, JSON.stringify(reportData));
      toast.success(`Đã lưu Báo Cáo Ngày ${formatDateVn(selectedDate)} (BM.KTCN.04.03) thành công!`);
    } catch {
      toast.error('Lỗi khi lưu báo cáo vào bộ nhớ.');
    }
  };

  // Synthesize from production logs
  const synthesizeFromLogs = async (targetDate: string, silent = false) => {
    if (!silent) setLoadingSync(true);
    try {
      let allLogs: ProductionLogDto[] = [];

      // 1. Try Supabase cloud logs
      const sbLogs = await fetchLogsFromSupabase();
      if (sbLogs && sbLogs.length > 0) {
        allLogs = sbLogs;
      } else {
        // 2. Try REST API
        try {
          const res = await apiClient.get<{ items: ProductionLogDto[] }>('/logs?includeVoided=0');
          if (res?.items?.length) allLogs = res.items;
        } catch {
          // 3. Fallback store
          allLogs = getAllFallbackLogs();
        }
      }

      const dayLogs = allLogs.filter((l) => l.workDate === targetDate && !l.isVoided);

      if (dayLogs.length === 0) {
        if (!silent) {
          toast.warning(`Không có nhật ký sản lượng nào trong ngày ${formatDateVn(targetDate)}. Đang tạo dữ liệu mẫu.`);
        }
        // Default sample if empty
        const sample: DailyQualityReportItem[] = [
          {
            id: 'sample-1',
            orderNumber: 1,
            productName: 'ALKTOP 1342 M',
            customer: 'Win-Win',
            steelGrade: 'Thép hợp kim SCM440',
            assessedQty: 25,
            okQty: 25,
            okPct: 100,
            reworkQty: 0,
            reworkPct: 0,
            reworkReason: '',
            scrapQty: 0,
            scrapPct: 0,
            scrapReason: '',
            note: '',
          },
        ];
        setItems(sample);
        return;
      }

      // Group day logs by productName
      const map = new Map<string, {
        customer: string;
        steelGrade: string;
        okQty: number;
        reworkQty: number;
        scrapQty: number;
        reworkReasons: Set<string>;
        scrapReasons: Set<string>;
      }>();

      dayLogs.forEach((l) => {
        const pName = l.productName || 'Chi tiết gia công';
        const entry = map.get(pName) || {
          customer: l.customer || 'Vico',
          steelGrade: '',
          okQty: 0,
          reworkQty: 0,
          scrapQty: 0,
          reworkReasons: new Set<string>(),
          scrapReasons: new Set<string>(),
        };

        entry.okQty += Number(l.okQty) || 0;
        entry.reworkQty += Number(l.reworkQty) || 0;
        entry.scrapQty += Number(l.scrapQty) || 0;

        if (Number(l.reworkQty) > 0 && l.defectType) {
          entry.reworkReasons.add(l.defectType);
        }
        if (Number(l.scrapQty) > 0 && l.defectType) {
          entry.scrapReasons.add(l.defectType);
        }

        // Try to match steel grade from products list
        const meta =
          bootstrap.products?.find((p: any) => p.productName === pName) ||
          FALLBACK_PRODUCTS.find((p) => p.productName === pName);
        if (meta?.matName) {
          entry.steelGrade = meta.matName;
        }

        map.set(pName, entry);
      });

      const synthesized: DailyQualityReportItem[] = Array.from(map.entries()).map(([pName, data], idx) => {
        const assessed = data.okQty + data.reworkQty + data.scrapQty;
        const okP = assessed > 0 ? (data.okQty / assessed) * 100 : 100;
        const rwP = assessed > 0 ? (data.reworkQty / assessed) * 100 : 0;
        const scP = assessed > 0 ? (data.scrapQty / assessed) * 100 : 0;

        return {
          id: `item-${Date.now()}-${idx}`,
          orderNumber: idx + 1,
          productName: pName,
          customer: data.customer || 'Win-Win',
          steelGrade: data.steelGrade || 'Thép SCM440',
          assessedQty: assessed,
          okQty: data.okQty,
          okPct: Math.round(okP),
          reworkQty: data.reworkQty,
          reworkPct: Math.round(rwP),
          reworkReason: Array.from(data.reworkReasons).join('; '),
          scrapQty: data.scrapQty,
          scrapPct: Math.round(scP),
          scrapReason: Array.from(data.scrapReasons).join('; '),
          note: '',
        };
      });

      setItems(synthesized);
      if (!silent) {
        toast.success(`Đã tổng hợp ${synthesized.length} sản phẩm từ nhật ký ngày ${formatDateVn(targetDate)}!`);
      }
    } catch (err: any) {
      if (!silent) toast.error('Không thể tổng hợp từ nhật ký sản lượng.');
    } finally {
      if (!silent) setLoadingSync(false);
    }
  };

  // Open modal to add or edit item
  const handleOpenAddModal = () => {
    setEditingItem(null);
    setFormProdName(bootstrap.products?.[0]?.productName || 'ALKTOP 1342 M');
    setFormCustomer(bootstrap.products?.[0]?.customer || 'Win-Win');
    setFormSteelGrade(bootstrap.products?.[0]?.matName || 'Thép hợp kim SCM440');
    setFormAssessedQty(10);
    setFormOkQty(10);
    setFormReworkQty(0);
    setFormReworkReason('');
    setFormScrapQty(0);
    setFormScrapReason('');
    setFormNote('');
    setModalOpen(true);
  };

  const handleOpenEditModal = (item: DailyQualityReportItem) => {
    setEditingItem(item);
    setFormProdName(item.productName);
    setFormCustomer(item.customer);
    setFormSteelGrade(item.steelGrade);
    setFormAssessedQty(item.assessedQty);
    setFormOkQty(item.okQty);
    setFormReworkQty(item.reworkQty);
    setFormReworkReason(item.reworkReason);
    setFormScrapQty(item.scrapQty);
    setFormScrapReason(item.scrapReason);
    setFormNote(item.note);
    setModalOpen(true);
  };

  const handleSaveModalItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formProdName.trim()) {
      toast.warning('Vui lòng nhập tên sản phẩm.');
      return;
    }

    const assessed = Math.max(0, Number(formAssessedQty) || 0);
    const ok = Math.max(0, Number(formOkQty) || 0);
    const rw = Math.max(0, Number(formReworkQty) || 0);
    const sc = Math.max(0, Number(formScrapQty) || 0);

    const okP = assessed > 0 ? (ok / assessed) * 100 : 100;
    const rwP = assessed > 0 ? (rw / assessed) * 100 : 0;
    const scP = assessed > 0 ? (sc / assessed) * 100 : 0;

    const newItem: DailyQualityReportItem = {
      id: editingItem ? editingItem.id : `manual-${Date.now()}`,
      orderNumber: editingItem ? editingItem.orderNumber : items.length + 1,
      productName: formProdName.trim(),
      customer: formCustomer.trim() || 'Khách hàng',
      steelGrade: formSteelGrade.trim() || 'Thép C45',
      assessedQty: assessed,
      okQty: ok,
      okPct: Math.round(okP),
      reworkQty: rw,
      reworkPct: Math.round(rwP),
      reworkReason: formReworkReason.trim(),
      scrapQty: sc,
      scrapPct: Math.round(scP),
      scrapReason: formScrapReason.trim(),
      note: formNote.trim(),
    };

    if (editingItem) {
      setItems((prev) => prev.map((it) => (it.id === editingItem.id ? newItem : it)));
      toast.success(`Đã cập nhật sản phẩm "${newItem.productName}"`);
    } else {
      setItems((prev) => [...prev, newItem]);
      toast.success(`Đã thêm sản phẩm "${newItem.productName}" vào báo cáo`);
    }
    setModalOpen(false);
  };

  const handleDeleteItem = (id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id).map((it, idx) => ({ ...it, orderNumber: idx + 1 })));
    toast.info('Đã xóa dòng sản phẩm khỏi báo cáo.');
  };

  // KPI Calculations
  const totals = useMemo(() => {
    const sumAssessed = items.reduce((acc, it) => acc + (Number(it.assessedQty) || 0), 0);
    const sumOk = items.reduce((acc, it) => acc + (Number(it.okQty) || 0), 0);
    const sumRework = items.reduce((acc, it) => acc + (Number(it.reworkQty) || 0), 0);
    const sumScrap = items.reduce((acc, it) => acc + (Number(it.scrapQty) || 0), 0);

    const okPct = sumAssessed > 0 ? Math.round((sumOk / sumAssessed) * 100) : 100;
    const rwPct = sumAssessed > 0 ? Math.round((sumRework / sumAssessed) * 100) : 0;
    const scPct = sumAssessed > 0 ? Math.round((sumScrap / sumAssessed) * 100) : 0;

    return {
      sumAssessed,
      sumOk,
      okPct,
      sumRework,
      rwPct,
      sumScrap,
      scPct,
    };
  }, [items]);

  // Build full report data
  const currentReportData: DailyQualityReportData = useMemo(() => {
    return {
      reportDate: selectedDate,
      reportCode,
      issueNo,
      effectiveDate,
      workshop,
      companyName,
      items,
      preparedBy: 'Trần Văn Dũng',
      qcBy: 'Trần Văn Dũng (QC)',
      approvedBy: 'Quản Đốc Phân Xưởng',
    };
  }, [selectedDate, reportCode, issueNo, effectiveDate, workshop, companyName, items]);

  // Copy Zalo text report
  const handleCopyZalo = () => {
    const lines = [
      `📊 BÁO CÁO NGÀY GIA CÔNG CƠ KHÍ (${reportCode})`,
      `📅 Ngày: ${formatDateVn(selectedDate)} · ${workshop} - ${companyName}`,
      `---------------------------------------`,
      `⭐ TỔNG ĐÁNH GIÁ: ${formatNumber(totals.sumAssessed)} chi tiết`,
      `🟢 ĐẠT YÊU CẦU: ${formatNumber(totals.sumOk)} SP (${totals.okPct}%)`,
      `🟡 HÀNG CẦN XỬ LÝ: ${formatNumber(totals.sumRework)} SP (${totals.rwPct}%)`,
      `🔴 PHẾ PHẨM (HỎNG): ${formatNumber(totals.sumScrap)} SP (${totals.scPct}%)`,
      `---------------------------------------`,
      `CHI TIẾT TỪNG SẢN PHẨM:`,
    ];

    items.forEach((it, idx) => {
      lines.push(
        `${idx + 1}. ${it.productName} (${it.customer}): Đạt ${it.okQty}/${it.assessedQty} (${it.okPct}%)` +
          (it.reworkQty > 0 ? ` · Sửa: ${it.reworkQty} (${it.reworkReason || 'Lỗi'})` : '') +
          (it.scrapQty > 0 ? ` · Hỏng: ${it.scrapQty} (${it.scrapReason || 'Phế phẩm'})` : '')
      );
    });

    lines.push(`---------------------------------------`);
    lines.push(`👉 Xem chi tiết và in biểu mẫu trên phần mềm MES Thắng Lợi.`);

    const fullText = lines.join('\n');
    void navigator.clipboard.writeText(fullText);
    toast.success('Đã sao chép nội dung Báo cáo ngày để gửi Zalo xưởng!');
  };

  // Export Excel
  const handleExportExcel = async () => {
    try {
      await downloadDailyQualityReportExcel(currentReportData);
      toast.success(`Đã xuất file Excel Form ${reportCode} thành công!`);
    } catch (err: any) {
      toast.error('Lỗi khi xuất file Excel.');
    }
  };

  // Print A4 Landscape
  const handlePrintNow = () => {
    if (typeof window !== 'undefined') {
      window.print();
    }
  };

  return (
    <div className="space-y-4">
      {/* Dynamic @page CSS rule for A4 Landscape print */}
      <style>{`
        @media print {
          @page {
            size: A4 landscape;
            margin: 8mm 6mm;
          }
          body {
            background-color: white !important;
            color: black !important;
          }
          .no-print {
            display: none !important;
          }
          .print-landscape-sheet {
            box-shadow: none !important;
            border: none !important;
            padding: 0 !important;
            max-width: 100% !important;
            width: 100% !important;
          }
        }
      `}</style>

      {/* ==================== CONTROL ACTION BAR ==================== */}
      <Card className="no-print space-y-3 border-slate-200 bg-white p-3.5 shadow-sm sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Date Selector Row */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-slate-700">Ngày Báo Cáo:</span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setSelectedDate(getYesterdayStr())}
              className={selectedDate === getYesterdayStr() ? 'border-blue-600 bg-blue-50 text-blue-700 font-bold' : ''}
            >
              Hôm qua (Hôm trước)
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setSelectedDate(getTodayStr())}
              className={selectedDate === getTodayStr() ? 'border-blue-600 bg-blue-50 text-blue-700 font-bold' : ''}
            >
              Hôm nay
            </Button>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => e.target.value && setSelectedDate(e.target.value)}
              className="font-mono-num rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-bold text-slate-800 shadow-2xs focus:border-blue-600 focus:outline-none"
            />

            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={loadingSync}
              onClick={() => void synthesizeFromLogs(selectedDate, false)}
              className="font-bold text-blue-700 hover:bg-blue-50"
              title="Quét toàn bộ nhật ký sản lượng thợ nộp trong ngày để tự động tổng hợp vào bảng"
            >
              <RefreshCw className={`h-3.5 w-3.5 text-blue-600 ${loadingSync ? 'animate-spin' : ''}`} />
              <span>Tổng Hợp Từ Nhật Ký</span>
            </Button>

            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleOpenAddModal}
              className="font-bold text-emerald-700 hover:bg-emerald-50"
            >
              <Plus className="h-3.5 w-3.5 text-emerald-600" />
              <span>Thêm Sản Phẩm</span>
            </Button>
          </div>

          {/* Action buttons: Copy Zalo, Export Excel, Print A4, Save */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleCopyZalo}
              className="font-semibold text-slate-700 hover:text-slate-900"
              title="Sao chép tóm tắt để gửi vào nhóm chat Zalo phân xưởng"
            >
              <Copy className="h-3.5 w-3.5 text-blue-600" />
              <span>Copy Báo Cáo Zalo</span>
            </Button>

            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void handleExportExcel()}
              className="font-semibold text-emerald-800 hover:bg-emerald-50"
              title="Tải file Excel mẫu BM.KTCN.04.03 chuẩn"
            >
              <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
              <span>Xuất File Excel (BM.KTCN.04.03)</span>
            </Button>

            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handlePrintNow}
              className="border-slate-300 bg-slate-50 font-bold text-slate-800 hover:bg-slate-100"
              title="In bản in A4 nằm ngang chuẩn gửi Quản đốc và Giám đốc ký"
            >
              <Printer className="h-3.5 w-3.5 text-slate-700" />
              <span>In Biểu Mẫu A4</span>
            </Button>

            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={handleSaveReport}
              className="bg-blue-600 font-bold text-white shadow hover:bg-blue-700"
            >
              <Save className="h-3.5 w-3.5" />
              <span>Lưu Báo Cáo</span>
            </Button>
          </div>
        </div>
      </Card>

      {/* ==================== 4 KPI SUMMARY CARDS ==================== */}
      <section
        aria-label="Tóm tắt chất lượng ngày"
        className="no-print grid grid-cols-2 gap-3 sm:grid-cols-4"
      >
        <Card className="border-l-4 border-l-slate-400 bg-white p-3.5 shadow-sm">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            Tổng Đánh Giá
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="font-mono-num text-2xl font-black text-slate-900">
              {formatNumber(totals.sumAssessed)}
            </span>
            <span className="text-xs font-semibold text-slate-500">chi tiết</span>
          </div>
        </Card>

        <Card className="border-l-4 border-l-emerald-500 bg-white p-3.5 shadow-sm">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            Đạt Yêu Cầu (OK)
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="font-mono-num text-2xl font-black text-emerald-700">
              {formatNumber(totals.sumOk)}
            </span>
            <span className="font-mono-num text-xs font-bold text-emerald-700">
              ({totals.okPct}%)
            </span>
          </div>
        </Card>

        <Card className="border-l-4 border-l-amber-500 bg-white p-3.5 shadow-sm">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            Hàng Cần Xử Lý
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="font-mono-num text-2xl font-black text-amber-700">
              {formatNumber(totals.sumRework)}
            </span>
            <span className="font-mono-num text-xs font-bold text-amber-700">
              ({totals.rwPct}%)
            </span>
          </div>
        </Card>

        <Card className="border-l-4 border-l-rose-500 bg-white p-3.5 shadow-sm">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            Phế Phẩm (Hỏng)
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="font-mono-num text-2xl font-black text-rose-700">
              {formatNumber(totals.sumScrap)}
            </span>
            <span className="font-mono-num text-xs font-bold text-rose-700">
              ({totals.scPct}%)
            </span>
          </div>
        </Card>
      </section>

      {/* ==================== A4 LANDSCAPE PRINTABLE REPORT SHEET ==================== */}
      <article
        data-testid="daily-quality-report-sheet"
        className="print-landscape-sheet mx-auto w-full max-w-[1280px] rounded-2xl border border-slate-200 bg-white p-6 shadow-card text-slate-900"
      >
        {/* Header section with Vico Logo, Title, and ISO Code */}
        <header className="border-b-2 border-black pb-3">
          <div className="flex items-center justify-between">
            {/* Left: Vico Logo */}
            <div className="flex items-center gap-2.5">
              <VicoLogo className="h-10 w-auto object-contain" />
              <div className="hidden sm:block">
                <div className="text-xs font-extrabold uppercase tracking-tight text-neutral-800">
                  {companyName}
                </div>
                <div className="text-[10px] font-semibold text-neutral-600">
                  HỆ THỐNG QUẢN LÝ CHẤT LƯỢNG ISO 9001
                </div>
              </div>
            </div>

            {/* Center: Title */}
            <div className="text-center">
              <div className="text-xs font-bold uppercase tracking-wider text-neutral-600 sm:text-sm">
                {companyName}
              </div>
              <h1 className="text-xl font-black uppercase tracking-wide text-black sm:text-2xl">
                BÁO CÁO NGÀY
              </h1>
            </div>

            {/* Right: Form Metadata */}
            <div className="text-right font-mono text-[11px] text-neutral-800">
              <div>Mã số: <strong>{reportCode}</strong></div>
              <div>Lần ban hành: <strong>{issueNo}</strong></div>
              <div>Ngày hiệu lực: <strong>{effectiveDate}</strong></div>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs font-bold">
            <div>Phân xưởng: <strong className="uppercase text-blue-900">{workshop}</strong></div>
            <div>Ngày báo cáo: <strong className="font-mono-num text-black">{formatDateVn(selectedDate)}</strong></div>
          </div>
        </header>

        {/* Data Table */}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse border border-black text-center text-xs text-black">
            <thead>
              <tr className="bg-slate-100 font-bold print:bg-neutral-100">
                <th rowSpan={2} className="border border-black px-2 py-2 w-10">TT</th>
                <th rowSpan={2} className="border border-black px-3 py-2 text-left">Tên Sản Phẩm</th>
                <th rowSpan={2} className="border border-black px-2.5 py-2">Khách Hàng</th>
                <th rowSpan={2} className="border border-black px-2.5 py-2">Mác Thép</th>
                <th rowSpan={2} className="border border-black px-2 py-2 w-20">
                  Số lượng<br />Đánh giá
                </th>
                <th colSpan={2} className="border border-black px-2 py-1">Đạt</th>
                <th colSpan={3} className="border border-black px-2 py-1">Xử lý</th>
                <th colSpan={3} className="border border-black px-2 py-1">Hỏng</th>
                <th rowSpan={2} className="border border-black px-2.5 py-2">Ghi chú</th>
                <th rowSpan={2} className="no-print border border-black px-2 py-2 w-16">Thao tác</th>
              </tr>
              <tr className="bg-slate-100 text-[11px] font-bold print:bg-neutral-100">
                <th className="border border-black px-2 py-1 w-14">Số lượng</th>
                <th className="border border-black px-1.5 py-1 w-12">%</th>
                <th className="border border-black px-2 py-1 w-14">Số lượng</th>
                <th className="border border-black px-1.5 py-1 w-12">%</th>
                <th className="border border-black px-2 py-1">Tình trạng lỗi</th>
                <th className="border border-black px-2 py-1 w-14">Số lượng</th>
                <th className="border border-black px-1.5 py-1 w-12">%</th>
                <th className="border border-black px-2 py-1">Tình trạng hỏng</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={15} className="border border-black py-8 text-center text-slate-500 italic">
                    Chưa có sản phẩm nào trong báo cáo ngày {formatDateVn(selectedDate)}.
                    Bấm &quot;Tổng Hợp Từ Nhật Ký&quot; hoặc &quot;Thêm Sản Phẩm&quot; ở trên.
                  </td>
                </tr>
              ) : (
                items.map((it, idx) => (
                  <tr key={it.id} className="hover:bg-slate-50 transition-colors">
                    <td className="border border-black p-1.5 font-mono-num font-bold">{idx + 1}</td>
                    <td className="border border-black p-1.5 text-left font-bold">{it.productName}</td>
                    <td className="border border-black p-1.5 font-medium">{it.customer}</td>
                    <td className="border border-black p-1.5 font-medium">{it.steelGrade || '—'}</td>
                    <td className="border border-black p-1.5 font-mono-num font-bold">{formatNumber(it.assessedQty)}</td>
                    
                    {/* Đạt */}
                    <td className="border border-black p-1.5 font-mono-num font-bold text-emerald-800">
                      {formatNumber(it.okQty)}
                    </td>
                    <td className="border border-black p-1.5 font-mono-num font-semibold text-emerald-800">
                      {it.okPct}%
                    </td>

                    {/* Xử lý */}
                    <td className="border border-black p-1.5 font-mono-num font-bold text-amber-800">
                      {it.reworkQty > 0 ? formatNumber(it.reworkQty) : '0'}
                    </td>
                    <td className="border border-black p-1.5 font-mono-num font-semibold text-amber-800">
                      {it.reworkPct}%
                    </td>
                    <td className="border border-black p-1.5 text-left text-[11px] text-amber-900">
                      {it.reworkReason || ''}
                    </td>

                    {/* Hỏng */}
                    <td className="border border-black p-1.5 font-mono-num font-bold text-rose-800">
                      {it.scrapQty > 0 ? formatNumber(it.scrapQty) : '0'}
                    </td>
                    <td className="border border-black p-1.5 font-mono-num font-semibold text-rose-800">
                      {it.scrapPct}%
                    </td>
                    <td className="border border-black p-1.5 text-left text-[11px] text-rose-900">
                      {it.scrapReason || ''}
                    </td>

                    <td className="border border-black p-1.5 text-left text-[11px]">{it.note || ''}</td>

                    {/* Action buttons (hidden on print) */}
                    <td className="no-print border border-black p-1.5">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleOpenEditModal(it)}
                          className="rounded p-1 text-blue-600 hover:bg-blue-50 hover:text-blue-800"
                          title="Sửa dòng sản phẩm"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteItem(it.id)}
                          className="rounded p-1 text-rose-600 hover:bg-rose-50 hover:text-rose-800"
                          title="Xóa dòng này"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}

              {/* TỔNG CỘNG ROW */}
              <tr className="bg-slate-100 font-bold text-black print:bg-neutral-100">
                <td colSpan={4} className="border border-black p-2 text-center uppercase tracking-wider">
                  TỔNG CỘNG
                </td>
                <td className="border border-black p-2 font-mono-num text-base font-black">
                  {formatNumber(totals.sumAssessed)}
                </td>
                <td className="border border-black p-2 font-mono-num text-base font-black text-emerald-800">
                  {formatNumber(totals.sumOk)}
                </td>
                <td className="border border-black p-2 font-mono-num font-bold text-emerald-800">
                  {totals.okPct}%
                </td>
                <td className="border border-black p-2 font-mono-num text-base font-black text-amber-800">
                  {formatNumber(totals.sumRework)}
                </td>
                <td className="border border-black p-2 font-mono-num font-bold text-amber-800">
                  {totals.rwPct}%
                </td>
                <td className="border border-black p-2" />
                <td className="border border-black p-2 font-mono-num text-base font-black text-rose-800">
                  {formatNumber(totals.sumScrap)}
                </td>
                <td className="border border-black p-2 font-mono-num font-bold text-rose-800">
                  {totals.scPct}%
                </td>
                <td className="border border-black p-2" />
                <td className="border border-black p-2" />
                <td className="no-print border border-black p-2" />
              </tr>
            </tbody>
          </table>
        </div>

        {/* 3-Column Signatures Block matching ISO Form BM.KTCN.04.03 */}
        <footer className="mt-8 grid grid-cols-3 gap-6 text-center text-xs text-black">
          <div>
            <div className="font-bold uppercase tracking-wider">Người Lập Biểu</div>
            <div className="mt-0.5 text-[10px] italic text-neutral-600">(Ký &amp; ghi rõ họ tên)</div>
            <div className="mt-14 font-semibold">Trần Văn Dũng</div>
          </div>

          <div>
            <div className="font-bold uppercase tracking-wider">Tổ Trưởng / QC</div>
            <div className="mt-0.5 text-[10px] italic text-neutral-600">(Ký &amp; ghi rõ họ tên)</div>
            <div className="mt-14 font-semibold">Trần Văn Dũng</div>
          </div>

          <div>
            <div className="font-bold uppercase tracking-wider">Quản Đốc Phân Xưởng</div>
            <div className="mt-0.5 text-[10px] italic text-neutral-600">(Ký &amp; đóng dấu)</div>
            <div className="mt-14 font-semibold">Hoàng Ngọc Hà</div>
          </div>
        </footer>
      </article>

      {/* ==================== ADD / EDIT PRODUCT MODAL ==================== */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingItem ? 'Sửa Sản Phẩm Báo Cáo Ngày' : 'Thêm Sản Phẩm Vào Báo Cáo Ngày'}
        subtitle="Form BM.KTCN.04.03 — Đánh giá chất lượng và sản lượng chi tiết"
      >
        <form onSubmit={handleSaveModalItem} className="space-y-3.5 text-xs">
          <div>
            <label className="mb-1 block font-bold text-slate-800">Tên Sản Phẩm / Chi Tiết *</label>
            <input
              type="text"
              required
              value={formProdName}
              onChange={(e) => setFormProdName(e.target.value)}
              placeholder="VD: ALKTOP 1342 M, Đĩa búa Φ735..."
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-900 focus:border-blue-600 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block font-bold text-slate-800">Khách Hàng</label>
              <input
                type="text"
                value={formCustomer}
                onChange={(e) => setFormCustomer(e.target.value)}
                placeholder="VD: Win-Win, Đại Phú..."
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block font-bold text-slate-800">Mác Thép / Vật Liệu</label>
              <input
                type="text"
                value={formSteelGrade}
                onChange={(e) => setFormSteelGrade(e.target.value)}
                placeholder="VD: Thép hợp kim SCM440, C45..."
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 border-t border-slate-200 pt-3">
            <div>
              <label className="mb-1 block font-bold text-slate-800">Số Lượng Đánh Giá</label>
              <input
                type="number"
                min={0}
                value={formAssessedQty}
                onChange={(e) => setFormAssessedQty(Number(e.target.value))}
                className="font-mono-num w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-900 focus:border-blue-600 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block font-bold text-emerald-800">Đạt Yêu Cầu (OK)</label>
              <input
                type="number"
                min={0}
                value={formOkQty}
                onChange={(e) => setFormOkQty(Number(e.target.value))}
                className="font-mono-num w-full rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-900 focus:border-emerald-600 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 border-t border-slate-200 pt-3">
            <div>
              <label className="mb-1 block font-bold text-amber-800">Hàng Cần Xử Lý (Rework)</label>
              <input
                type="number"
                min={0}
                value={formReworkQty}
                onChange={(e) => setFormReworkQty(Number(e.target.value))}
                className="font-mono-num w-full rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900 focus:border-amber-600 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block font-bold text-amber-800">Tình Trạng Lỗi Xử Lý</label>
              <input
                type="text"
                value={formReworkReason}
                onChange={(e) => setFormReworkReason(e.target.value)}
                placeholder="VD: Dư kích thước moay ơ, bavia..."
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-amber-600 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 border-t border-slate-200 pt-3">
            <div>
              <label className="mb-1 block font-bold text-rose-800">Phế Phẩm (Hỏng / Scrap)</label>
              <input
                type="number"
                min={0}
                value={formScrapQty}
                onChange={(e) => setFormScrapQty(Number(e.target.value))}
                className="font-mono-num w-full rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-900 focus:border-rose-600 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block font-bold text-rose-800">Tình Trạng Hỏng</label>
              <input
                type="text"
                value={formScrapReason}
                onChange={(e) => setFormScrapReason(e.target.value)}
                placeholder="VD: Âm kích thước then, mẻ dao..."
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-rose-600 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block font-bold text-slate-800">Ghi Chú Thêm</label>
            <input
              type="text"
              value={formNote}
              onChange={(e) => setFormNote(e.target.value)}
              placeholder="Ghi chú thêm về lô hàng, công đoạn..."
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setModalOpen(false)}>
              Hủy
            </Button>
            <Button type="submit" variant="primary" size="sm" className="bg-blue-600 font-bold text-white hover:bg-blue-700">
              Lưu Sản Phẩm
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export default DailyQualityReportSection;
