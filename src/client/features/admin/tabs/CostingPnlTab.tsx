import React, { useEffect, useMemo, useState } from 'react';
import {
  Calculator,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Coins,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  Info,
  Save,
  Search,
  SlidersHorizontal,
  TrendingDown,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { DEFAULT_DRIVE_FOLDER_URL } from '@shared/driveHelper';
import type { ProductCostingSummary } from '@shared/types';
import { matchesSearch } from '@shared/vnSearch';
import { apiClient } from '@client/lib/apiClient';
import { downloadCostingPnlExcel } from '@client/lib/excelService';
import { formatCompactVnd, formatNumber, formatVnd } from '@client/lib/formatters';
import {
  Badge,
  Button,
  Card,
  Modal,
  PaginationBar,
  useToast,
} from '@client/components/ui/IndustrialPrimitives';
import { GainsharingModal } from '../modals/GainsharingModal';
import type { AdminTabCommonProps } from '../types';

type CostingFilterMode = 'ALL' | 'ACTUAL' | 'LOSS' | 'PROFIT' | 'WIP_ONLY';
type CostingModelMode = 'ALL_IN' | 'DETAILED';

interface CostingApiResponse {
  items: ProductCostingSummary[];
  summary: {
    totalProducts: number;
    profitCount: number;
    lossCount: number;
    totalNetProfit: number;
  };
}

export function CostingPnlTab({
  bootstrap,
  deepLink,
  onRefreshBootstrap,
}: AdminTabCommonProps) {
  const toast = useToast();

  const [items, setItems] = useState<ProductCostingSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState(deepLink?.costingSearch || '');
  const [filterMode, setFilterMode] = useState<CostingFilterMode>('ALL');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [exporting, setExporting] = useState(false);

  // Trạng thái Thu Lên / Trải Xuống cho cả 4 mục P&L
  const [expandedByFilterMode, setExpandedByFilterMode] = useState<Record<CostingFilterMode, boolean>>({
    ALL: true,
    ACTUAL: true,
    LOSS: true,
    PROFIT: true,
    WIP_ONLY: true,
  });

  const toggleFilterModeExpanded = (mode: CostingFilterMode) => {
    setExpandedByFilterMode((prev) => ({
      ...prev,
      [mode]: !prev[mode],
    }));
  };

  const toggleAllModes = (expanded: boolean) => {
    setExpandedByFilterMode({
      ALL: expanded,
      ACTUAL: expanded,
      LOSS: expanded,
      PROFIT: expanded,
      WIP_ONLY: expanded,
    });
  };

  // Shopfloor pricing model: Default to All-in Machine Rate (800k/shift = 100k/h)
  const [costingModel, setCostingModel] = useState<CostingModelMode>('ALL_IN');

  // Inline quote edits map: spId -> number
  const [inlineQuotes, setInlineQuotes] = useState<Record<string, string>>({});
  const [savingSpId, setSavingSpId] = useState<string | null>(null);

  // Detailed Costing & Pricing Drawer/Modal
  const [detailItem, setDetailItem] = useState<ProductCostingSummary | null>(null);
  const [modalQuotedPrice, setModalQuotedPrice] = useState(0);
  const [modalRawMatCost, setModalRawMatCost] = useState(0);
  const [modalOutsourceCost, setModalOutsourceCost] = useState(0);
  const [modalDrawingUrl, setModalDrawingUrl] = useState('');
  const [modalTechDocUrl, setModalTechDocUrl] = useState('');
  const [savingModal, setSavingModal] = useState(false);

  // Gainsharing Simulator Modal
  const [showGainsharingModal, setShowGainsharingModal] = useState(false);
  const [gainsharingProduct, setGainsharingProduct] = useState<ProductCostingSummary | null>(null);

  // Quick Shift Performance & Loss/Profit Evaluator Modal
  const [quickCheckSp, setQuickCheckSp] = useState<ProductCostingSummary | null>(null);
  const [quickActualQty, setQuickActualQty] = useState<number>(8);

  useEffect(() => {
    if (deepLink?.costingSearch !== undefined) {
      setSearchQuery(deepLink.costingSearch);
      setPage(1);
    }
  }, [deepLink?.costingSearch]);

  const fetchCosting = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get<CostingApiResponse>('/costing');
      setItems(res.items || []);
    } catch (err: any) {
      toast.error(err?.message || 'Không thể tải dữ liệu Báo giá & Lãi/Lỗ.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchCosting();
  }, []);

  // Compute effective costing per product based on active costingModel
  const computedProductList = useMemo(() => {
    return items.map((c) => {
      const rawQuote = inlineQuotes[c.spId] !== undefined ? inlineQuotes[c.spId] : String(c.quotedPrice);
      const quoteVal = Number(rawQuote) || 0;

      // In All-in Machine mode: 800k/ca = 100k/h including labor, machine, electric, tools, overhead
      const allInCost =
        c.allInMachineCost ||
        Math.round((c.totalSec / 3600) * 100000) + (c.rawMaterialCost || 0) + (c.outsourceCost || 0);

      const effectiveStdCost = costingModel === 'ALL_IN' ? allInCost : c.totalStdCost;
      const effectiveUnitCost = c.hasActual ? c.actualUnitCost : effectiveStdCost;
      const effectiveProfit = quoteVal - effectiveUnitCost;
      const effectiveMargin = quoteVal > 0 ? Number(((effectiveProfit / quoteVal) * 100).toFixed(1)) : 0;
      const effectiveBatchProfit = c.hasActual ? effectiveProfit * c.finishedQty : 0;
      const quota8h = c.shiftQuota8h || (c.totalSec > 0 ? Math.floor(28800 / c.totalSec) : 8);

      return {
        ...c,
        quoteVal,
        effectiveStdCost,
        effectiveUnitCost,
        effectiveProfit,
        effectiveMargin,
        effectiveBatchProfit,
        quota8h,
      };
    });
  }, [items, inlineQuotes, costingModel]);

  const summary = useMemo(() => {
    const totalProducts = computedProductList.length;
    let profitCount = 0;
    let lossCount = 0;
    let breakEvenCount = 0;
    let totalNetProfit = 0;
    let wipOnlyCount = 0;

    for (const c of computedProductList) {
      if (c.effectiveProfit < 0) lossCount++;
      else if (c.effectiveProfit === 0) {
        breakEvenCount++;
        profitCount++;
      } else {
        profitCount++;
      }
      if (c.hasActual) totalNetProfit += c.effectiveBatchProfit;
      if (!c.hasActual && c.wipQty > 0) wipOnlyCount++;
    }

    return {
      totalProducts,
      profitCount,
      lossCount,
      breakEvenCount,
      totalNetProfit,
      wipOnlyCount,
      actualCount: computedProductList.filter((i) => i.hasActual).length,
    };
  }, [computedProductList]);

  const filteredItems = useMemo(() => {
    const list = computedProductList.filter((c) => {
      if (filterMode === 'ACTUAL' && !c.hasActual) return false;
      if (filterMode === 'LOSS' && c.effectiveProfit >= 0) return false;
      if (filterMode === 'PROFIT' && c.effectiveProfit < 0) return false;
      if (filterMode === 'WIP_ONLY' && (c.hasActual || c.wipQty <= 0)) return false;

      if (!searchQuery.trim()) return true;
      return matchesSearch(
        `${c.spId} ${c.customer} ${c.productName} ${c.opsSummary}`,
        searchQuery
      );
    });

    return list.sort((a, b) => {
      const aScore = a.hasActual ? 2 : a.wipQty > 0 ? 1 : 0;
      const bScore = b.hasActual ? 2 : b.wipQty > 0 ? 1 : 0;
      if (bScore !== aScore) return bScore - aScore;
      return a.spId.localeCompare(b.spId, 'en', { numeric: true });
    });
  }, [computedProductList, filterMode, searchQuery]);

  const pagedItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredItems.slice(start, start + pageSize);
  }, [filteredItems, page, pageSize]);

  const handleInlineSaveQuote = async (item: ProductCostingSummary) => {
    const rawVal = inlineQuotes[item.spId];
    if (rawVal === undefined) return;
    const num = Math.max(0, Number(rawVal) || 0);

    setSavingSpId(item.spId);
    try {
      const res = await apiClient.patch<{ item: ProductCostingSummary }>(
        `/costing/${encodeURIComponent(item.spId)}`,
        { quotedPrice: num }
      );
      if (res.item) {
        setItems((prev) => prev.map((it) => (it.spId === item.spId ? res.item : it)));
      }
      setInlineQuotes((prev) => {
        const copy = { ...prev };
        delete copy[item.spId];
        return copy;
      });
      toast.success(`Đã cập nhật Báo giá cho [${item.spId}] thành ${formatVnd(num)}.`);
      await onRefreshBootstrap();
    } catch (err: any) {
      toast.error(err?.message || 'Không thể lưu giá báo khách.');
    } finally {
      setSavingSpId(null);
    }
  };

  const openDetailModal = (item: ProductCostingSummary) => {
    setDetailItem(item);
    setModalQuotedPrice(item.quotedPrice);
    setModalRawMatCost(item.rawMaterialCost || 0);
    setModalOutsourceCost(item.outsourceCost || 0);
    setModalDrawingUrl(item.drawingUrl || '');
    setModalTechDocUrl(item.techDocUrl || '');
  };

  const handleSaveModal = async () => {
    if (!detailItem) return;
    setSavingModal(true);
    try {
      const res = await apiClient.patch<{ item: ProductCostingSummary }>(
        `/costing/${encodeURIComponent(detailItem.spId)}`,
        {
          quotedPrice: modalQuotedPrice,
          rawMaterialCost: modalRawMatCost,
          outsourceCost: modalOutsourceCost,
          drawingUrl: modalDrawingUrl,
          techDocUrl: modalTechDocUrl,
        }
      );
      if (res.item) {
        setItems((prev) => prev.map((it) => (it.spId === detailItem.spId ? res.item : it)));
        setDetailItem(res.item);
        setInlineQuotes((prev) => {
          const copy = { ...prev };
          delete copy[detailItem.spId];
          return copy;
        });
      }
      toast.success(
        `Đã cập nhật Báo giá, Chi phí Phôi & Gia công ngoài cho [${detailItem.spId}].`
      );
      await onRefreshBootstrap();
    } catch (err: any) {
      toast.error(err?.message || 'Không thể lưu định giá chi tiết.');
    } finally {
      setSavingModal(false);
    }
  };

  const handleExportExcel = async () => {
    setExporting(true);
    try {
      await downloadCostingPnlExcel(items);
      toast.success(`Đã xuất Excel 19 cột Báo Giá & Đối Soát Lãi/Lỗ (${items.length} SP).`);
    } catch (err: any) {
      toast.error(err?.message || 'Lỗi xuất file Excel Báo giá.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* ==================== 4 P&L SUMMARY CARDS (BẤM VÀO ĐỂ LỌC VÀ THU LÊN / TRẢI XUỐNG) ==================== */}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        {/* THẺ 1: TỔNG MÃ THÀNH PHẨM */}
        <Card
          role="button"
          tabIndex={0}
          onClick={() => {
            if (filterMode === 'ALL') {
              toggleFilterModeExpanded('ALL');
            } else {
              setFilterMode('ALL');
              setPage(1);
              setExpandedByFilterMode((p) => ({ ...p, ALL: true }));
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              if (filterMode === 'ALL') {
                toggleFilterModeExpanded('ALL');
              } else {
                setFilterMode('ALL');
                setPage(1);
                setExpandedByFilterMode((p) => ({ ...p, ALL: true }));
              }
            }
          }}
          title="Bấm để lọc toàn bộ 396 mã thành phẩm và thu lên / trải xuống danh sách"
          className={`cursor-pointer border-l-4 border-l-blue-600 transition-all hover:scale-[1.01] hover:shadow-md active:scale-[0.99] ${
            filterMode === 'ALL'
              ? 'ring-2 ring-blue-500 ring-offset-2 bg-blue-50/40'
              : 'hover:border-blue-300'
          }`}
        >
          <div className="flex items-start justify-between">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                1. Tổng Mã Thành Phẩm (Gộp NC)
              </div>
              <div className="font-mono-num mt-1.5 text-3xl font-black text-slate-900">
                {formatNumber(summary.totalProducts)}{' '}
                <span className="text-sm font-semibold text-slate-500">SP</span>
              </div>
              <div className="mt-1.5 text-xs text-slate-600">
                Đã có SX hoàn chỉnh:{' '}
                <strong className="font-mono-num text-slate-900">{summary.actualCount}</strong> |{' '}
                Đang WIP:{' '}
                <strong className="font-mono-num text-amber-700">{summary.wipOnlyCount}</strong>
              </div>
              <div className="mt-2 flex items-center gap-1 text-[11px] font-bold">
                {filterMode === 'ALL' ? (
                  <span className="inline-flex items-center gap-0.5 rounded bg-blue-100 px-1.5 py-0.5 text-blue-900">
                    {expandedByFilterMode.ALL ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    <span>{expandedByFilterMode.ALL ? 'Đang mở (Bấm thu)' : 'Thu gọn (Bấm trải)'}</span>
                  </span>
                ) : (
                  <span className="text-blue-700">🔍 Bấm lọc &amp; mở</span>
                )}
              </div>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-blue-200 bg-blue-50 text-blue-600">
              <Calculator className="h-6 w-6" />
            </div>
          </div>
        </Card>

        {/* THẺ 2: SỐ MÃ ĐẠT ĐỊNH MỨC / LÃI */}
        <Card
          role="button"
          tabIndex={0}
          onClick={() => {
            if (filterMode === 'PROFIT') {
              toggleFilterModeExpanded('PROFIT');
            } else {
              setFilterMode('PROFIT');
              setPage(1);
              setExpandedByFilterMode((p) => ({ ...p, PROFIT: true }));
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              if (filterMode === 'PROFIT') {
                toggleFilterModeExpanded('PROFIT');
              } else {
                setFilterMode('PROFIT');
                setPage(1);
                setExpandedByFilterMode((p) => ({ ...p, PROFIT: true }));
              }
            }
          }}
          title="Bấm để lọc riêng các mã đạt định mức / có lãi và thu lên / trải xuống danh sách"
          className={`cursor-pointer border-l-4 border-l-emerald-600 transition-all hover:scale-[1.01] hover:shadow-md active:scale-[0.99] ${
            filterMode === 'PROFIT'
              ? 'ring-2 ring-emerald-500 ring-offset-2 bg-emerald-50/50'
              : 'hover:border-emerald-300'
          }`}
        >
          <div className="flex items-start justify-between">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                2. Số Mã Đạt Định Mức / Lãi
              </div>
              <div className="font-mono-num mt-1.5 text-3xl font-black text-emerald-700">
                {formatNumber(summary.profitCount)}{' '}
                <span className="text-sm font-semibold text-slate-500">SP</span>
              </div>
              <div className="mt-1.5 text-xs font-medium text-emerald-700">
                Báo giá ≥ Giá máy trọn gói ({summary.breakEvenCount} mã chuẩn hòa vốn ca)
              </div>
              <div className="mt-2 flex items-center gap-1 text-[11px] font-bold">
                {filterMode === 'PROFIT' ? (
                  <span className="inline-flex items-center gap-0.5 rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-900">
                    {expandedByFilterMode.PROFIT ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    <span>{expandedByFilterMode.PROFIT ? 'Đang mở (Bấm thu)' : 'Thu gọn (Bấm trải)'}</span>
                  </span>
                ) : (
                  <span className="text-emerald-700">🟢 Bấm lọc &amp; mở</span>
                )}
              </div>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-600">
              <TrendingUp className="h-6 w-6" />
            </div>
          </div>
        </Card>

        {/* THẺ 3: SỐ MÃ CẢNH BÁO THIẾU / LỖ */}
        <Card
          role="button"
          tabIndex={0}
          onClick={() => {
            if (filterMode === 'LOSS') {
              toggleFilterModeExpanded('LOSS');
            } else {
              setFilterMode('LOSS');
              setPage(1);
              setExpandedByFilterMode((p) => ({ ...p, LOSS: true }));
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              if (filterMode === 'LOSS') {
                toggleFilterModeExpanded('LOSS');
              } else {
                setFilterMode('LOSS');
                setPage(1);
                setExpandedByFilterMode((p) => ({ ...p, LOSS: true }));
              }
            }
          }}
          title="Bấm để lọc riêng các mã cảnh báo thiếu/lỗ và thu lên / trải xuống danh sách"
          className={`cursor-pointer border-l-4 border-l-rose-500 transition-all hover:scale-[1.01] hover:shadow-md active:scale-[0.99] ${
            filterMode === 'LOSS'
              ? 'ring-2 ring-rose-500 ring-offset-2 bg-rose-50/50'
              : 'hover:border-rose-300'
          }`}
        >
          <div className="flex items-start justify-between">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                3. Số Mã Cảnh Báo Thiếu / Lỗ
              </div>
              <div className="font-mono-num mt-1.5 text-3xl font-black text-rose-700">
                {formatNumber(summary.lossCount)}{' '}
                <span className="text-sm font-semibold text-slate-500">SP</span>
              </div>
              <div className="mt-1.5 text-xs font-medium text-rose-700">
                Cần rà soát định mức hoặc nâng giá báo
              </div>
              <div className="mt-2 flex items-center gap-1 text-[11px] font-bold">
                {filterMode === 'LOSS' ? (
                  <span className="inline-flex items-center gap-0.5 rounded bg-rose-100 px-1.5 py-0.5 text-rose-900 font-extrabold">
                    {expandedByFilterMode.LOSS ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    <span>{expandedByFilterMode.LOSS ? 'Đang mở (Bấm thu)' : 'Thu gọn (Bấm trải)'}</span>
                  </span>
                ) : (
                  <span className="text-rose-700 font-extrabold animate-pulse">🔴 Bấm lọc &amp; mở</span>
                )}
              </div>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-rose-200 bg-rose-50 text-rose-600">
              <TrendingDown className="h-6 w-6" />
            </div>
          </div>
        </Card>

        {/* THẺ 4: TỔNG LỢI NHUẬN RÒNG THỰC TẾ */}
        <Card
          role="button"
          tabIndex={0}
          onClick={() => {
            if (filterMode === 'ACTUAL') {
              toggleFilterModeExpanded('ACTUAL');
            } else {
              setFilterMode('ACTUAL');
              setPage(1);
              setExpandedByFilterMode((p) => ({ ...p, ACTUAL: true }));
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              if (filterMode === 'ACTUAL') {
                toggleFilterModeExpanded('ACTUAL');
              } else {
                setFilterMode('ACTUAL');
                setPage(1);
                setExpandedByFilterMode((p) => ({ ...p, ACTUAL: true }));
              }
            }
          }}
          title="Bấm để lọc riêng các mã đã có sản lượng gia công thực tế và thu lên / trải xuống danh sách"
          className={`cursor-pointer border-l-4 border-l-amber-500 transition-all hover:scale-[1.01] hover:shadow-md active:scale-[0.99] ${
            filterMode === 'ACTUAL'
              ? 'ring-2 ring-amber-500 ring-offset-2 bg-amber-50/50'
              : 'hover:border-amber-300'
          }`}
        >
          <div className="flex items-start justify-between">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                4. Tổng Lợi Nhuận Ròng Thực Tế
              </div>
              <div className="font-mono-num mt-1.5 text-2xl font-black text-emerald-700">
                {formatVnd(summary.totalNetProfit)}
              </div>
              <div className="mt-1.5 text-xs text-slate-600">
                ({formatCompactVnd(summary.totalNetProfit)}) • Khử 100% lãi ảo bán TP
              </div>
              <div className="mt-2 flex items-center gap-1 text-[11px] font-bold">
                {filterMode === 'ACTUAL' ? (
                  <span className="inline-flex items-center gap-0.5 rounded bg-amber-100 px-1.5 py-0.5 text-amber-900">
                    {expandedByFilterMode.ACTUAL ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    <span>{expandedByFilterMode.ACTUAL ? 'Đang mở (Bấm thu)' : 'Thu gọn (Bấm trải)'}</span>
                  </span>
                ) : (
                  <span className="text-amber-800">⚡ Bấm lọc &amp; mở</span>
                )}
              </div>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-amber-200 bg-amber-50 text-amber-600">
              <Coins className="h-6 w-6" />
            </div>
          </div>
        </Card>
      </div>

      {/* ==================== MAIN COSTING TABLE ==================== */}
      <Card noPadding>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-extrabold uppercase tracking-wide text-slate-900">
                💰 Bảng Báo Giá Thành Phẩm &amp; Đối Soát Giá Vốn Định Mức vs Giá Thành Thực Tế (
                {filteredItems.length}/{items.length} SP)
              </h2>
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              Cơ chế <strong className="text-slate-700">Đơn Giá Máy Trọn Gói 800k/Ca (100k/h)</strong>: 1 ngày làm đủ định mức 8 cái hòa vốn ca máy; thiếu báo đỏ âm tiền, vượt tăng năng suất thưởng thợ.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Nút Thu Lên / Trải Xuống cụ thể của mục đang chọn */}
            <button
              type="button"
              onClick={() => toggleFilterModeExpanded(filterMode)}
              title={
                expandedByFilterMode[filterMode]
                  ? `Bấm để thu gọn danh sách ${filteredItems.length} sản phẩm mục này`
                  : `Bấm để trải xuống xem chi tiết ${filteredItems.length} sản phẩm mục này`
              }
              className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-black shadow-2xs transition-all active:scale-[0.98] ${
                expandedByFilterMode[filterMode]
                  ? 'border-blue-400 bg-blue-50 text-blue-900 hover:bg-blue-100'
                  : 'border-emerald-400 bg-emerald-50 text-emerald-900 ring-2 ring-emerald-200 hover:bg-emerald-100'
              }`}
            >
              {expandedByFilterMode[filterMode] ? (
                <>
                  <ChevronUp className="h-4 w-4 text-blue-700" />
                  <span>▲ Thu Lên</span>
                </>
              ) : (
                <>
                  <ChevronDown className="h-4 w-4 text-emerald-700" />
                  <span>▼ Trải Xuống ({filteredItems.length} SP)</span>
                </>
              )}
            </button>

            {/* Nút Thu Lên / Trải Xuống Tất Cả Cả 4 Mục */}
            <div className="flex items-center gap-1 border-l border-slate-300 pl-2">
              <button
                type="button"
                onClick={() => toggleAllModes(false)}
                title="Thu lên toàn bộ cả 4 mục"
                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-bold text-slate-700 shadow-2xs hover:bg-slate-100"
              >
                <ChevronUp className="h-3 w-3 text-slate-600" />
                <span>Thu cả 4 mục</span>
              </button>
              <button
                type="button"
                onClick={() => toggleAllModes(true)}
                title="Trải xuống toàn bộ cả 4 mục"
                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-bold text-slate-700 shadow-2xs hover:bg-slate-100"
              >
                <ChevronDown className="h-3 w-3 text-slate-600" />
                <span>Trải cả 4 mục</span>
              </button>
            </div>

            {/* Costing Method Switch */}
            <div className="flex items-center rounded-xl border border-slate-300 bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setCostingModel('ALL_IN')}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all ${
                  costingModel === 'ALL_IN'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-700 hover:text-slate-900'
                }`}
                title="Đơn giá máy trọn gói 800k/ca = 100k/h đã bao gồm nhân công, điện, máy, dao và phụ phí xưởng"
              >
                <span>🏭 1. Máy Trọn Gói (800k/ca)</span>
              </button>
              <button
                type="button"
                onClick={() => setCostingModel('DETAILED')}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all ${
                  costingModel === 'DETAILED'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-700 hover:text-slate-900'
                }`}
                title="Kế toán bóc tách từng khoản: NC + Máy + Dao + 10% Quản lý xưởng"
              >
                <span>📑 2. Kế Toán Bóc Tách</span>
              </button>
            </div>

            <Button
              variant="warning"
              size="sm"
              onClick={() => {
                setGainsharingProduct(null);
                setShowGainsharingModal(true);
              }}
              title="Mô phỏng cơ chế khoán chia thưởng năng suất thợ & lợi nhuận công ty"
            >
              <Zap className="h-4 w-4" />
              ⚡ Quyết Toán Khoán Năng Suất (Win - Win)
            </Button>
            <Button
              variant="success"
              size="sm"
              disabled={exporting || items.length === 0}
              onClick={() => void handleExportExcel()}
            >
              <Download className="h-4 w-4" />
              📥 Xuất Excel Báo Giá
            </Button>
          </div>
        </div>

        {/* Nội dung bảng: Thu gọn thành thanh biểu ngữ HOẶC Trải xuống chi tiết */}
        {!expandedByFilterMode[filterMode] ? (
          <div
            role="button"
            tabIndex={0}
            onClick={() => toggleFilterModeExpanded(filterMode)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') toggleFilterModeExpanded(filterMode);
            }}
            className="flex cursor-pointer items-center justify-between bg-slate-50/90 px-4 py-3.5 text-xs font-bold text-slate-700 hover:bg-blue-50/70 hover:text-blue-900 transition-colors"
          >
            <div className="flex items-center gap-2">
              <ChevronDown className="h-4 w-4 text-blue-600" />
              <span>
                Bảng chi tiết báo giá và đối soát lãi/lỗ của <strong>{filteredItems.length}</strong> sản phẩm mục này đang được <strong>thu gọn</strong> để tối ưu không gian làm việc.
              </span>
            </div>
            <span className="inline-flex items-center gap-1 rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-xs font-black text-blue-800 shadow-2xs hover:bg-blue-50">
              <span>Bấm để trải xuống ({filteredItems.length} SP)</span>
              <ChevronDown className="h-3.5 w-3.5" />
            </span>
          </div>
        ) : (
          <>
            {/* Filter & Search Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/80 px-4 py-2.5">
              <div className="flex flex-wrap items-center gap-1.5">
                {(
                  [
                    ['ALL', `Tất cả (${summary.totalProducts})`],
                    ['ACTUAL', `🔥 Đã có SX thực tế (${summary.actualCount})`],
                    ['LOSS', `🔴 Cảnh báo thiếu/lỗ (${summary.lossCount})`],
                    ['PROFIT', `🟢 Đạt ĐM / Có Lãi (${summary.profitCount})`],
                    ['WIP_ONLY', `⏳ Đang dở dang WIP (${summary.wipOnlyCount})`],
                  ] as Array<[CostingFilterMode, string]>
                ).map(([k, lbl]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => {
                      setFilterMode(k);
                      setPage(1);
                    }}
                    className={`rounded-lg border px-2.5 py-1.5 text-xs font-bold transition-colors ${
                      filterMode === k
                        ? 'border-blue-600 bg-blue-600 text-white shadow-sm'
                        : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900'
                    }`}
                  >
                    {lbl}
                  </button>
                ))}
              </div>

              <div className="relative min-w-[260px] flex-1 sm:max-w-sm">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setPage(1);
                  }}
                  placeholder="Gõ Mã SP (VD: SP095, SP002 Đĩa búa), Tên SP, Khách hàng..."
                  className="h-9 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-xs text-slate-900 placeholder:text-slate-500 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
                />
              </div>
            </div>

            <div className="max-h-[580px] overflow-auto">
          {loading ? (
            <div className="p-8 text-center text-sm text-slate-500">
              Đang tính toán giá vốn định mức &amp; giá thành thực tế 334+ sản phẩm...
            </div>
          ) : (
            <table className="w-full min-w-[1300px] border-collapse text-left text-xs">
              <thead className="sticky top-0 z-10 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-600 shadow-sm">
                <tr className="border-b border-slate-200">
                  <th className="px-3 py-2.5">Mã SP</th>
                  <th className="px-3 py-2.5">Khách Hàng</th>
                  <th className="px-3 py-2.5">Thành Phẩm &amp; Quy Trình Công Nghệ</th>
                  <th className="px-2.5 py-2.5 text-center">Tổng ĐM</th>
                  <th className="px-3 py-2.5 text-right">
                    {costingModel === 'ALL_IN' ? 'Giá Vốn ĐM (Trọn Gói)' : 'Giá Vốn ĐM / 1 SP'}
                    <div className="text-[10px] font-normal text-slate-500">
                      {costingModel === 'ALL_IN'
                        ? '(Máy 800k/ca = 100k/h gồm NC+M+D)'
                        : '(Lương+Máy+Dao+10%+Phôi)'}
                    </div>
                  </th>
                  <th className="px-3 py-2.5 text-right">
                    Giá Thực Tế &amp; SL Xong
                    <div className="text-[10px] font-normal text-slate-500">
                      (Chỉ tính bước End)
                    </div>
                  </th>
                  <th className="w-[190px] px-3 py-2.5 text-center">
                    Đơn Giá Báo Khách
                    <div className="text-[10px] font-normal text-blue-700">
                      (Lưu nhanh đơn giá)
                    </div>
                  </th>
                  <th className="w-[140px] px-2.5 py-2.5 text-center">
                    Chỉ Tiêu Ca 8h
                    <div className="text-[10px] font-normal text-slate-500">
                      (Định mức ca & Soát)
                    </div>
                  </th>
                  <th className="px-3 py-2.5 text-right">Lãi / Lỗ (/1 SP)</th>
                  <th className="px-3 py-2.5 text-center">Kết Luận P&amp;L</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {pagedItems.map((c) => {
                  const isLoss = c.effectiveProfit < 0;
                  const isBreakEven = c.effectiveProfit === 0;
                  const isWipOnly = c.finishedQty === 0 && c.wipQty > 0;
                  const quoteVal =
                    inlineQuotes[c.spId] !== undefined
                      ? inlineQuotes[c.spId]
                      : String(c.quotedPrice);

                  return (
                    <tr
                      key={c.spId}
                      className={`transition-colors hover:bg-blue-50/50 ${
                        isLoss ? 'bg-rose-50/40' : ''
                      }`}
                    >
                      <td className="font-mono-num px-3 py-2.5 font-extrabold text-slate-800">
                        {c.spId}
                      </td>
                      <td className="px-3 py-2.5 font-medium text-slate-700">{c.customer}</td>
                      <td className="px-3 py-2.5">
                        <button
                          type="button"
                          onClick={() => openDetailModal(c)}
                          className="text-left font-bold text-blue-700 hover:text-blue-800 hover:underline"
                        >
                          {c.productName}
                        </button>
                        <a
                          href={c.drawingUrl || DEFAULT_DRIVE_FOLDER_URL}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-800 font-bold ml-2 px-1.5 py-0.5 rounded bg-blue-50 border border-blue-200"
                          title="Mở Bản Vẽ Google Drive"
                        >
                          <FileText className="w-3 h-3" /> Bản vẽ
                        </a>
                        <div className="mt-0.5 max-w-[300px] truncate text-[11px] text-slate-500">
                          {c.opCount} NC: {c.opsSummary}
                        </div>
                        {(c.rawMaterialCost > 0 || c.outsourceCost > 0) && (
                          <div className="mt-0.5 flex flex-wrap gap-1 text-[10px]">
                            {c.rawMaterialCost > 0 && (
                              <Badge variant="neutral">Phôi: {formatVnd(c.rawMaterialCost)}</Badge>
                            )}
                            {c.outsourceCost > 0 && (
                              <Badge variant="purple">GCN: {formatVnd(c.outsourceCost)}</Badge>
                            )}
                          </div>
                        )}
                      </td>

                      <td className="font-mono-num px-2.5 py-2.5 text-center">
                        <div className="font-bold text-slate-900">{formatNumber(c.totalSec)}s</div>
                        <div className="text-[11px] text-slate-500">({c.totalHours}h)</div>
                      </td>

                      <td className="font-mono-num px-3 py-2.5 text-right">
                        <div className="font-bold text-slate-900">
                          {formatVnd(c.effectiveStdCost)}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          {costingModel === 'ALL_IN' ? (
                            <span className="text-blue-700 font-medium">
                              Máy 800k/ca ({formatNumber(Math.round((c.totalSec / 3600) * 100000))} đ)
                            </span>
                          ) : (
                            <span>
                              NC:{Math.round(c.stdLabor / 1000)}k | M:{Math.round(c.stdMach / 1000)}k |
                              D:{Math.round(c.stdTool / 1000)}k
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="font-mono-num px-3 py-2.5 text-right">
                        {c.hasActual ? (
                          <>
                            <div className="font-bold text-blue-700">
                              {formatVnd(c.actualUnitCost)}
                            </div>
                            <div className="text-[11px] font-semibold text-emerald-700">
                              Đã xong: {c.finishedQty} SP
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="text-slate-600">{formatVnd(c.effectiveStdCost)}</div>
                            {c.wipQty > 0 ? (
                              <div className="text-[10px] font-bold text-amber-700">
                                Đang WIP: {c.wipQty} (Xong: 0 SP)
                              </div>
                            ) : (
                              <div className="text-[10px] text-slate-500">Theo ĐM (0 SP)</div>
                            )}
                          </>
                        )}
                      </td>

                      {/* Quoted Price with inline quick edit */}
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            step="any"
                            min={0}
                            value={quoteVal}
                            onChange={(e) =>
                              setInlineQuotes((prev) => ({
                                ...prev,
                                [c.spId]: e.target.value,
                              }))
                            }
                            aria-label={`Đơn giá báo khách ${c.spId}`}
                            className="font-mono-num h-8 w-full rounded-lg border border-slate-300 bg-white px-2 text-right text-xs font-bold text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
                          />
                          <button
                            type="button"
                            disabled={savingSpId === c.spId}
                            onClick={() => void handleInlineSaveQuote(c)}
                            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 text-blue-700 transition-colors hover:bg-blue-100"
                            title="Lưu nhanh đơn giá báo khách"
                          >
                            <Save className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => openDetailModal(c)}
                            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 transition-colors hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700"
                            title="Cập nhật Chi phí Phôi, Gia công ngoài & Bóc tách từng NC"
                          >
                            <SlidersHorizontal className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>

                      {/* 8h Shift Quota & Quick Evaluator */}
                      <td className="px-2.5 py-2.5 text-center font-mono-num">
                        <div className="font-extrabold text-slate-800">
                          {c.quota8h} SP <span className="text-[10px] font-semibold text-slate-500">/ ca 8h</span>
                        </div>
                        <div className="text-[10px] text-slate-500">
                          ({formatNumber(c.quota8h * (Number(quoteVal) || 100000))} đ)
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setQuickCheckSp(c);
                            setQuickActualQty(c.quota8h);
                          }}
                          className="mt-1 inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-800 hover:bg-amber-100"
                          title="Soát sản lượng ca hôm nay: Thiếu báo đỏ âm tiền, vượt thưởng năng suất"
                        >
                          <Zap className="h-3 w-3 text-amber-600" /> Soát Ca
                        </button>
                      </td>

                      {/* Profit / Loss */}
                      <td className="font-mono-num px-3 py-2.5 text-right">
                        <div
                          className={`font-bold ${
                            isLoss
                              ? 'text-rose-700'
                              : isBreakEven
                              ? 'text-blue-700'
                              : 'text-emerald-700'
                          }`}
                        >
                          {c.effectiveProfit > 0 ? '+' : ''}
                          {formatVnd(c.effectiveProfit)}
                        </div>
                        {c.hasActual && (
                          <div
                            className={`text-[10px] font-semibold ${
                              isLoss ? 'text-rose-600' : 'text-emerald-600'
                            }`}
                          >
                            Lô: {c.effectiveBatchProfit > 0 ? '+' : ''}
                            {formatVnd(c.effectiveBatchProfit)}
                          </div>
                        )}
                      </td>

                      {/* Conclusion Badge */}
                      <td className="px-3 py-2.5 text-center">
                        {isWipOnly && !isLoss ? (
                          <Badge variant="info">⏳ ĐANG WIP (CHỜ CHỐT TP)</Badge>
                        ) : isBreakEven ? (
                          <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-800">
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                            ĐẠT ĐỊNH MỨC (0%)
                          </span>
                        ) : isLoss ? (
                          <span className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs font-bold text-rose-700">
                            <TrendingDown className="h-3.5 w-3.5 text-rose-600" />
                            THIẾU ({c.effectiveMargin}%)
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700">
                            <TrendingUp className="h-3.5 w-3.5 text-emerald-600" />
                            LÃI (+{c.effectiveMargin}%)
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination Bar */}
        <div className="border-t border-slate-200 p-3">
          <PaginationBar
            page={page}
            totalItems={filteredItems.length}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(sz) => {
              setPageSize(sz);
              setPage(1);
            }}
          />
        </div>
          </>
        )}
      </Card>

      {/* ==================== MODAL: CHI TIẾT ĐỊNH GIÁ & BẢN VẼ ==================== */}
      <Modal
        open={Boolean(detailItem)}
        onClose={() => setDetailItem(null)}
        title={`⚙️ Chi Tiết Báo Giá & Phân Rã Công Nghệ [${detailItem?.spId}]`}
        subtitle={`${detailItem?.customer} — ${detailItem?.productName}`}
        maxWidthClass="max-w-4xl"
        footer={
          <div className="flex w-full items-center justify-between">
            <div className="text-xs text-slate-500">
              Tổng thời gian gia công: <strong>{formatNumber(detailItem?.totalSec || 0)}s</strong> (
              {detailItem?.totalHours}h)
            </div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => setDetailItem(null)}>
                Đóng
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={savingModal}
                onClick={() => void handleSaveModal()}
              >
                <Save className="h-4 w-4" />
                {savingModal ? 'Đang lưu...' : 'Lưu Thay Đổi'}
              </Button>
            </div>
          </div>
        }
      >
        {detailItem && (
          <div className="space-y-4">
            {/* Input pricing row */}
            <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-3">
              <div>
                <label className="block text-xs font-bold text-slate-700">
                  Đơn Giá Báo Khách (VNĐ)
                </label>
                <input
                  type="number"
                  min={0}
                  value={modalQuotedPrice}
                  onChange={(e) => setModalQuotedPrice(Math.max(0, Number(e.target.value) || 0))}
                  className="font-mono-num mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-blue-700 focus:border-blue-600 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700">
                  Chi Phí Phôi / Vật Tư (VNĐ)
                </label>
                <input
                  type="number"
                  min={0}
                  value={modalRawMatCost}
                  onChange={(e) => setModalRawMatCost(Math.max(0, Number(e.target.value) || 0))}
                  className="font-mono-num mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-slate-800 focus:border-blue-600 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700">
                  Chi Phí Gia Công Ngoài (GCN)
                </label>
                <input
                  type="number"
                  min={0}
                  value={modalOutsourceCost}
                  onChange={(e) => setModalOutsourceCost(Math.max(0, Number(e.target.value) || 0))}
                  className="font-mono-num mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-slate-800 focus:border-blue-600 focus:outline-none"
                />
              </div>
            </div>

            {/* Step breakdown table */}
            <div>
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-700">
                Phân Rã Từng Bước Công Nghệ ({detailItem.stepBreakdowns.length} Nguyên Công)
              </h3>
              <div className="overflow-hidden rounded-xl border border-slate-200">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-100 text-[11px] font-bold uppercase text-slate-600">
                    <tr>
                      <th className="px-3 py-2">Bước</th>
                      <th className="px-3 py-2">Mã NC &amp; Nguyên Công</th>
                      <th className="px-3 py-2 text-right">ĐM Giây</th>
                      <th className="px-3 py-2 text-right">Giá Vốn ĐM (+10%)</th>
                      <th className="px-3 py-2 text-center">SL Đã Ghi Nhận</th>
                      <th className="px-3 py-2 text-right">Đơn Giá Áp Dụng</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white">
                    {detailItem.stepBreakdowns.map((st) => (
                      <tr key={st.ncId} className="hover:bg-slate-50">
                        <td className="px-3 py-2">
                          <Badge variant={st.isFinalOp === 1 ? 'success' : 'neutral'}>
                            {st.isFinalOp === 1 ? `🏁 End (${st.stepOrder})` : `B${st.stepOrder}`}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 font-semibold text-slate-900">
                          <span className="font-mono-num mr-1.5 font-bold text-blue-700">
                            {st.ncId}
                          </span>
                          {st.opName}
                        </td>
                        <td className="font-mono-num px-3 py-2 text-right text-slate-700">
                          {formatNumber(st.stdSeconds)}s
                        </td>
                        <td className="font-mono-num px-3 py-2 text-right text-slate-800">
                          {formatVnd(st.stdOpUnitCost)}
                        </td>
                        <td className="font-mono-num px-3 py-2 text-center font-bold text-emerald-700">
                          {st.loggedOkQty} OK
                        </td>
                        <td className="font-mono-num px-3 py-2 text-right">
                          <span className="font-bold text-blue-700">
                            {formatVnd(st.effectiveUnitCost)}
                          </span>
                          {st.usedStdFallback && (
                            <span className="ml-1 text-[10px] text-slate-500">(Bù ĐM)</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* ==================== MODAL: SOÁT NĂNG SUẤT CA MÁY (QUICK SHIFT EVALUATOR) ==================== */}
      {quickCheckSp && (
        <Modal
          open={Boolean(quickCheckSp)}
          onClose={() => setQuickCheckSp(null)}
          title="⚡ Soát Năng Suất Ca Máy & Hiệu Quả Tiền Theo Định Mức"
          subtitle={`Chi tiết: [${quickCheckSp.spId}] ${quickCheckSp.productName}`}
          maxWidthClass="max-w-xl"
          footer={
            <div className="flex w-full items-center justify-between">
              <span className="text-xs text-slate-500">
                Đơn giá máy trọn gói: <strong>800.000 đ/ca (100.000 đ/h)</strong>
              </span>
              <Button variant="primary" size="sm" onClick={() => setQuickCheckSp(null)}>
                Đóng
              </Button>
            </div>
          }
        >
          {(() => {
            const quota =
              quickCheckSp.shiftQuota8h ||
              (quickCheckSp.totalSec > 0 ? Math.floor(28800 / quickCheckSp.totalSec) : 8);
            const rawQuote =
              inlineQuotes[quickCheckSp.spId] !== undefined
                ? inlineQuotes[quickCheckSp.spId]
                : String(quickCheckSp.quotedPrice);
            const unitPrice = Number(rawQuote) || 100000;
            const diff = quickActualQty - quota;
            const diffMoney = diff * unitPrice;
            const completionPct = Math.round((quickActualQty / quota) * 100);

            return (
              <div className="space-y-4 text-slate-900">
                {/* Benchmark banner */}
                <div className="grid grid-cols-3 gap-2 rounded-xl border border-blue-200 bg-blue-50/70 p-3 text-center">
                  <div>
                    <div className="text-[11px] font-semibold text-slate-600">Định Mức Giờ</div>
                    <div className="font-mono-num text-sm font-black text-slate-900">
                      {formatNumber(quickCheckSp.totalSec)}s ({quickCheckSp.totalHours}h)
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold text-slate-600">Chỉ Tiêu Ca 8h</div>
                    <div className="font-mono-num text-sm font-black text-blue-700">
                      {quota} SP / ca
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold text-slate-600">Doanh Số Định Mức</div>
                    <div className="font-mono-num text-sm font-black text-slate-900">
                      {formatVnd(quota * unitPrice)}
                    </div>
                  </div>
                </div>

                {/* Actual Shift Qty Input */}
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-800">
                      Sản Lượng Công Nhân Đã Gia Công Xong Hôm Nay:
                    </label>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setQuickActualQty(Math.max(1, quota - 2))}
                        className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-bold text-rose-700 hover:bg-rose-50"
                      >
                        Thiếu 2 SP
                      </button>
                      <button
                        type="button"
                        onClick={() => setQuickActualQty(quota)}
                        className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-bold text-blue-700 hover:bg-blue-50"
                      >
                        Đủ {quota} SP
                      </button>
                      <button
                        type="button"
                        onClick={() => setQuickActualQty(quota + 2)}
                        className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-bold text-emerald-700 hover:bg-emerald-50"
                      >
                        Vượt +2 SP
                      </button>
                    </div>
                  </div>

                  <div className="mt-2 flex items-center gap-3">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={quickActualQty}
                      onChange={(e) => setQuickActualQty(Math.max(0, Number(e.target.value) || 0))}
                      className="font-mono-num h-12 w-32 rounded-xl border-2 border-blue-600 bg-white px-3 text-center text-2xl font-black text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                    />
                    <div className="flex-1 text-xs text-slate-600">
                      Đạt: <strong className="font-mono-num text-slate-900 text-sm">{completionPct}%</strong> định mức ca ({quickActualQty}/{quota} chiếc).
                      <div className="mt-0.5 text-[11px] text-slate-500">
                        Đơn giá báo khách: <strong className="font-mono-num text-slate-800">{formatVnd(unitPrice)}/SP</strong>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Outcome Statement Card */}
                {diff < 0 ? (
                  <div className="rounded-xl border-2 border-rose-300 bg-rose-50 p-4">
                    <div className="flex items-center gap-2 text-rose-800">
                      <TrendingDown className="h-5 w-5 shrink-0 text-rose-600" />
                      <div className="text-sm font-extrabold uppercase">
                        🔴 HỤT ĐỊNH MỨC CA: THIẾU {Math.abs(diff)} SP (-{Math.round((Math.abs(diff) / quota) * 100)}%)
                      </div>
                    </div>
                    <div className="font-mono-num mt-2 text-2xl font-black text-rose-700">
                      ÂM CHI PHÍ MÁY: {formatVnd(diffMoney)}
                    </div>
                    <div className="mt-2 text-xs text-rose-900 leading-relaxed">
                      💡 <strong>Giải thích thực tế xưởng</strong>: Chi phí cố định 1 ca máy là <strong>800.000 đ</strong> (gồm tiền lương thợ, tiền điện, khấu hao và dao). Thợ chỉ làm được {quickActualQty} sản phẩm (đạt {formatVnd(quickActualQty * unitPrice)}), do đó xưởng bị <strong>âm {formatVnd(Math.abs(diffMoney))}</strong> chi phí vận hành máy hôm nay!
                    </div>
                  </div>
                ) : diff === 0 ? (
                  <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50 p-4">
                    <div className="flex items-center gap-2 text-emerald-800">
                      <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
                      <div className="text-sm font-extrabold uppercase">
                        🟢 HOÀN THÀNH 100% ĐỊNH MỨC CA (800.000 Đ)
                      </div>
                    </div>
                    <div className="font-mono-num mt-2 text-2xl font-black text-emerald-700">
                      CHÊNH LỆCH: 0 đ (HÒA VỐN CA MÁY)
                    </div>
                    <div className="mt-2 text-xs text-emerald-900 leading-relaxed">
                      💡 <strong>Đánh giá</strong>: Thợ làm đúng định mức chuẩn {quota} sản phẩm trong ca 8 tiếng. Doanh thu vừa vặn bù đắp chi phí máy trọn gói 800.000 đ của ngày.
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border-2 border-emerald-400 bg-emerald-50 p-4">
                    <div className="flex items-center gap-2 text-emerald-800">
                      <Zap className="h-5 w-5 shrink-0 text-amber-500" />
                      <div className="text-sm font-extrabold uppercase">
                        🚀 TĂNG NĂNG SUẤT: VƯỢT +{diff} SP (+{Math.round((diff / quota) * 100)}%)
                      </div>
                    </div>
                    <div className="font-mono-num mt-2 text-2xl font-black text-emerald-700">
                      DƯƠNG GIÁ TRỊ CA: +{formatVnd(diffMoney)}
                    </div>
                    <div className="mt-2 text-xs text-emerald-900 leading-relaxed">
                      💡 <strong>Cơ chế thưởng khoán Win - Win</strong>:
                      <ul className="mt-1 list-disc pl-5 space-y-0.5">
                        <li>Thợ đứng máy được trích thưởng thêm: <strong>+{formatVnd(diffMoney * 0.4)}</strong> (40%).</li>
                        <li>Công ty hưởng lợi nhuận ròng tăng thêm: <strong>+{formatVnd(diffMoney * 0.6)}</strong> (60%).</li>
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </Modal>
      )}

      {/* Gainsharing & Productivity Incentive Simulator Modal */}
      <GainsharingModal
        open={showGainsharingModal}
        onClose={() => setShowGainsharingModal(false)}
        initialProduct={gainsharingProduct}
        allProducts={items}
        allMachines={bootstrap?.machines || []}
      />
    </div>
  );
}
