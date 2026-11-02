import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ChevronDown, FileCheck2, Printer, QrCode, RefreshCw, Smartphone } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import type { BootstrapPayload, JobTravelerDto, PurchaseOrderInfo } from '@shared/types';
import { apiClient } from '../../lib/apiClient';
import { getFallbackTraveler } from '../../lib/clientFallbackStore';
import { formatDateVn, getTravelerPoIdFromLocation } from '../../lib/formatters';
import { navigateTo } from '../../lib/navigation';
import { Button, useToast } from '../../components/ui/IndustrialPrimitives';
import { PickerOptionItem, SearchablePickerSheet } from '../worker/SearchablePickerSheet';
import { VicoLogo } from '../../components/VicoLogo';

export interface JobTravelerPrintProps {
  poId?: string;
}

type PaperSize = 'A4' | 'A5';

export function JobTravelerPrint({ poId }: JobTravelerPrintProps) {
  const toast = useToast();
  const initialPoId = poId || getTravelerPoIdFromLocation() || 'PO485-01';
  const [activePoId, setActivePoId] = useState<string>(initialPoId);
  const [paperSize, setPaperSize] = useState<PaperSize>('A4');
  const [traveler, setTraveler] = useState<JobTravelerDto>(() => getFallbackTraveler(initialPoId));
  const [ordersList, setOrdersList] = useState<PurchaseOrderInfo[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [poPickerOpen, setPoPickerOpen] = useState<boolean>(false);

  useEffect(() => {
    if (poId && poId !== activePoId) {
      setActivePoId(poId);
    }
  }, [poId]);

  // Load PO list once for quick switching
  useEffect(() => {
    let mounted = true;
    apiClient
      .get<BootstrapPayload>('/bootstrap')
      .then((res) => {
        if (mounted && res?.ordersList?.length) setOrdersList(res.ordersList);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const loadTraveler = useCallback(async (targetPo: string) => {
    setErrorMsg('');
    try {
      const dto = await apiClient.get<JobTravelerDto>(
        `/orders/${encodeURIComponent(targetPo)}/traveler`
      );
      if (dto && dto.po) {
        setTraveler(dto);
      }
    } catch {
      // Gracefully fall back to local seed traveler data with full ISO spec
      setTraveler(getFallbackTraveler(targetPo));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTraveler(activePoId);
  }, [activePoId, loadTraveler]);

  const handleSelectPo = (nextPoId: string) => {
    setActivePoId(nextPoId);
    navigateTo(`/print/traveler/${encodeURIComponent(nextPoId)}`);
  };

  const poOptions = useMemo<PickerOptionItem[]>(() => {
    return ordersList.map((p) => ({
      id: p.poId,
      primaryText: p.productName,
      secondaryText: `KH: ${p.customer} · Đặt: ${p.qtyPo} SP · Hạn: ${formatDateVn(p.dueDate)} · Lô: ${p.materialLot || '—'}`,
      metaBadge: p.poId,
      metaVariant: p.remainQty > 0 ? 'sky' : 'emerald',
      rightText: p.status,
      searchKeywords: `${p.poId} ${p.customer} ${p.productName}`,
    }));
  }, [ordersList]);

  const handlePrintNow = () => {
    if (typeof window !== 'undefined') {
      window.print();
    }
  };

  const firstQrPayload =
    traveler?.operations[0]?.qrPayload || (traveler ? `GCCK|${traveler.po.poId}` : '');

  const isA5 = paperSize === 'A5';

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-slate-100 pb-12 text-slate-900 print:min-h-0 print:bg-white print:pb-0">
      {/* Dynamic @page size rule: A5 is Landscape (Khổ Ngang), A4 is Portrait (Khổ Dọc) */}
      <style>{`
        @media print {
          @page {
            size: ${isA5 ? 'A5 landscape' : 'A4 portrait'};
            margin: ${isA5 ? '4mm 6mm' : '8mm'};
          }
          body {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .print-sheet {
            width: 100% !important;
            max-width: 100% !important;
            margin: 0 !important;
            padding: ${isA5 ? '2mm 3mm' : '6mm 8mm'} !important;
            border: ${isA5 ? '1.5px solid black' : '2px solid black'} !important;
            box-shadow: none !important;
          }
        }
      `}</style>

      {/* ==================== NON-PRINTING CONTROL BAR ==================== */}
      <section className="no-print border-b border-slate-200 bg-white/95 px-3 py-3 shadow-sm backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="lg"
              onClick={() => navigateTo('/admin?tab=orders')}
              title="Quay lại phân hệ Quản Trị Admin"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>Quản Trị PO</span>
            </Button>

            <Button
              type="button"
              variant="secondary"
              size="lg"
              onClick={() => navigateTo('/worker')}
              title="Về Cổng Công Nhân"
            >
              <span>Cổng Thợ</span>
            </Button>

            {/* Searchable PO Switcher */}
            <button
              type="button"
              onClick={() => setPoPickerOpen(true)}
              className="inline-flex min-h-[48px] items-center gap-2 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-left text-sm font-bold text-slate-800 shadow-sm transition-colors hover:border-blue-500 hover:bg-blue-50/50"
            >
              <QrCode className="h-4 w-4 text-blue-600" />
              <span>
                Lệnh SX: <strong className="font-mono-num text-blue-700">{activePoId}</strong>
              </span>
              <ChevronDown className="h-4 w-4 text-slate-500" />
            </button>

            {/* A4 (Dọc) / A5 (Ngang) Toggle */}
            <div className="inline-flex rounded-xl border border-slate-200 bg-slate-100 p-1">
              {(['A4', 'A5'] as const).map((sz) => (
                <button
                  key={sz}
                  type="button"
                  onClick={() => {
                    setPaperSize(sz);
                    toast.info(`Đã chuyển bố cục bản in sang khổ giấy ${sz === 'A5' ? 'A5 (Khổ Ngang)' : 'A4 (Khổ Dọc)'}`);
                  }}
                  className={`min-h-[40px] rounded-lg px-3 text-xs font-extrabold transition-all ${
                    paperSize === sz
                      ? 'bg-white text-blue-700 shadow-sm ring-1 ring-slate-200'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {sz === 'A5' ? 'Khổ A5 (Ngang)' : 'Khổ A4 (Dọc)'}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {firstQrPayload && (
              <Button
                type="button"
                variant="secondary"
                size="lg"
                onClick={() => navigateTo(`/worker?qr=${encodeURIComponent(firstQrPayload)}`)}
              >
                <Smartphone className="h-4 w-4 text-emerald-600" />
                <span>Giả lập quét trên ĐT</span>
              </Button>
            )}

            <Button
              type="button"
              variant="success"
              size="lg"
              onClick={handlePrintNow}
              disabled={!traveler}
            >
              <Printer className="h-5 w-5" />
              <span>IN PHIẾU CÔNG NGHỆ NGAY</span>
            </Button>
          </div>
        </div>
      </section>

      {/* ==================== PRINTABLE ISO SHEET ==================== */}
      <main className="mx-auto mt-4 px-2 sm:px-4 print:mt-0 print:px-0">
        {loading ? (
          <div className="no-print mx-auto flex max-w-3xl items-center justify-center gap-2.5 rounded-2xl border border-slate-200 bg-white p-12 text-sm font-medium text-slate-600 shadow-card">
            <RefreshCw className="h-5 w-5 animate-spin text-blue-600" />
            <span>Đang dựng Phiếu Công Nghệ chuẩn ISO cho {activePoId}...</span>
          </div>
        ) : errorMsg || !traveler ? (
          <div className="no-print mx-auto max-w-3xl rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center text-rose-800 shadow-card">
            <p className="font-bold">{errorMsg || 'Không tìm thấy dữ liệu Lệnh SX.'}</p>
            <Button
              type="button"
              variant="primary"
              size="lg"
              onClick={() => handleSelectPo('PO485-01')}
              className="mt-3"
            >
              Mở Lệnh Mẫu PO485-01
            </Button>
          </div>
        ) : (
          <article
            data-testid="job-traveler-sheet"
            className={`print-sheet mx-auto w-full rounded-none border-2 border-black bg-white text-black shadow-2xl print:max-w-none print:border print:shadow-none ${
              isA5 ? 'max-w-[840px] p-3 text-[10.5px] leading-tight' : 'max-w-[860px] p-5 sm:p-6 text-xs'
            }`}
          >
            {/* 1. ISO HEADER FRAME */}
            <header className="grid grid-cols-12 border-2 border-black">
              <div className={`col-span-12 border-b border-black sm:col-span-4 sm:border-b-0 sm:border-r ${isA5 ? 'p-1.5' : 'p-2.5'}`}>
                <div className="flex items-center gap-2 mb-1">
                  <VicoLogo className={isA5 ? "h-6 w-auto object-contain" : "h-8 w-auto object-contain"} />
                  <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-700">
                    CÔNG TY CP VICO
                  </div>
                </div>
                <div className={`mt-0.5 font-black uppercase leading-tight ${isA5 ? 'text-xs' : 'text-xs sm:text-sm'}`}>
                  XƯỞNG CƠ KHÍ CHÍNH XÁC THẮNG LỢI (GCCK)
                </div>
                <div className="mt-1 font-mono text-[9px] font-semibold">
                  Biểu mẫu: BM-GCCK-SX-01 · Lần BH: 02
                </div>
              </div>

              <div className={`col-span-8 flex flex-col items-center justify-center border-r border-black text-center sm:col-span-5 ${isA5 ? 'p-1.5' : 'p-2.5'}`}>
                <h1
                  className={`font-black uppercase tracking-tight text-black ${
                    isA5 ? 'text-xs sm:text-sm leading-snug' : 'text-base sm:text-lg'
                  }`}
                >
                  PHIẾU CÔNG NGHỆ &amp; THEO DÕI GIA CÔNG
                </h1>
                <div className="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-neutral-800">
                  (SHOP FLOOR JOB TRAVELER — QUÉT QR 5 GIÂY)
                </div>
                <div className={`mt-0.5 inline-block border border-black font-mono font-black ${isA5 ? 'px-1.5 py-0.5 text-[11px]' : 'px-2 py-0.5 text-xs'}`}>
                  MÃ LỆNH SX: {traveler.po.poId}
                </div>
              </div>

              <div className={`col-span-4 flex flex-col items-center justify-center text-center sm:col-span-3 ${isA5 ? 'p-1' : 'p-2'}`}>
                <QRCodeSVG
                  value={`GCCK|${traveler.po.poId}`}
                  size={isA5 ? 54 : 74}
                  level="M"
                  bgColor="#FFFFFF"
                  fgColor="#000000"
                />
                <span className="mt-0.5 font-mono text-[9px] font-bold">
                  GCCK|{traveler.po.poId}
                </span>
              </div>
            </header>

            {/* 2. ORDER & MATERIAL LOT METADATA TABLE */}
            <section className={`border-2 border-black ${isA5 ? 'mt-1.5' : 'mt-2.5'}`}>
              <div className="grid grid-cols-2 divide-x divide-y divide-black sm:grid-cols-4">
                <div className={isA5 ? "p-1 sm:p-1.5" : "p-2"}>
                  <div className="text-[9px] font-bold uppercase text-neutral-700">
                    Mã Lệnh / PO
                  </div>
                  <div className={`font-mono font-black ${isA5 ? 'text-xs' : 'text-sm'}`}>{traveler.po.poId}</div>
                </div>
                <div className={isA5 ? "p-1 sm:p-1.5" : "p-2"}>
                  <div className="text-[9px] font-bold uppercase text-neutral-700">
                    Khách hàng
                  </div>
                  <div className="font-bold truncate">{traveler.po.customer}</div>
                </div>
                <div className={isA5 ? "p-1 sm:p-1.5" : "p-2"}>
                  <div className="text-[9px] font-bold uppercase text-neutral-700">
                    Số lượng đặt
                  </div>
                  <div className={`font-mono font-black ${isA5 ? 'text-xs' : 'text-sm'}`}>{traveler.po.qtyPo} SP</div>
                </div>
                <div className={isA5 ? "p-1 sm:p-1.5" : "p-2"}>
                  <div className="text-[9px] font-bold uppercase text-neutral-700">
                    Hạn giao hàng
                  </div>
                  <div className={`font-mono font-black ${isA5 ? 'text-xs' : 'text-sm'}`}>
                    {formatDateVn(traveler.po.dueDate)}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 divide-y divide-black border-t border-black sm:grid-cols-12 sm:divide-x sm:divide-y-0">
                <div className={`sm:col-span-6 ${isA5 ? "p-1 sm:p-1.5" : "p-2"}`}>
                  <div className="text-[9px] font-bold uppercase text-neutral-700">
                    Tên chi tiết / Bản vẽ kỹ thuật ({traveler.po.spId || 'SP'})
                  </div>
                  <div className={`mt-0.5 break-words font-black leading-snug ${isA5 ? 'text-xs' : 'text-sm'}`}>
                    {traveler.po.productName}
                  </div>
                </div>
                <div className={`sm:col-span-3 ${isA5 ? "p-1 sm:p-1.5" : "p-2"}`}>
                  <div className="text-[9px] font-bold uppercase text-neutral-700">
                    Mã Lô Phôi / Vật liệu
                  </div>
                  <div className="font-mono font-bold">
                    {traveler.po.materialLot || 'LOT-2026-VC'}
                  </div>
                  <div className="text-[10px] truncate">
                    {traveler.product?.matName ||
                      traveler.operations[0]?.matName ||
                      'Thép hợp kim cơ khí'}
                  </div>
                </div>
                <div className={`sm:col-span-3 ${isA5 ? "p-1 sm:p-1.5" : "p-2"}`}>
                  <div className="text-[9px] font-bold uppercase text-neutral-700">
                    Nguồn phôi &amp; Ngày đúc
                  </div>
                  <div className="font-semibold truncate">
                    {traveler.po.supplierName || 'Xưởng Đúc VICO Thắng Lợi'}
                  </div>
                  <div className="font-mono text-[10px]">
                    Ngày phôi: {formatDateVn(traveler.po.castDate)}
                  </div>
                </div>
              </div>
            </section>

            {/* 3. SEQUENTIAL OPERATION ROUTING TABLE WITH INDIVIDUAL SVG QR CODES */}
            <section className={isA5 ? "mt-1.5" : "mt-3"}>
              <div className="mb-0.5 flex items-center justify-between">
                <h2 className={`font-black uppercase tracking-wide ${isA5 ? 'text-[11px]' : 'text-xs'}`}>
                  QUY TRÌNH NGUYÊN CÔNG TUẦN TỰ (QUÉT MÃ QR TỪNG BƯỚC ĐỂ BÁO CÁO SẢN LƯỢNG)
                </h2>
                <span className="font-mono text-[10px] font-bold">
                  Tổng: {traveler.operations.length} nguyên công
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full border-collapse border-2 border-black text-left">
                  <thead>
                    <tr className="border-b-2 border-black bg-neutral-100 text-[10px] font-black uppercase">
                      <th className="w-12 border-r border-black p-1.5 text-center">Bước</th>
                      <th className="w-28 border-r border-black p-1.5 text-center">Mã QR NC</th>
                      <th className="border-r border-black p-1.5">
                        Nguyên Công · Máy Chỉ Định · Định Mức
                      </th>
                      <th className="border-r border-black p-1.5">
                        Dao Cụ &amp; Chế Độ Cắt (Vc / f)
                      </th>
                      <th className="w-24 border-r border-black p-1.5 text-center">
                        Tự Kiểm ★
                      </th>
                      <th className="w-24 border-r border-black p-1.5 text-center">
                        SL OK / NG
                      </th>
                      <th className="w-24 p-1.5 text-center">Chữ Ký Thợ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black">
                    {traveler.operations.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="p-4 text-center font-semibold">
                          Chưa khai báo danh mục nguyên công cho sản phẩm này. Quét mã QR tổng{' '}
                          <code className="font-mono font-bold">GCCK|{traveler.po.poId}</code> để báo cáo.
                        </td>
                      </tr>
                    ) : (
                      traveler.operations.map((op) => (
                        <tr key={op.ncId} className="align-top">
                          <td className={`border-r border-black text-center font-mono ${isA5 ? 'p-1' : 'p-1.5'}`}>
                            <div className={`font-black ${isA5 ? 'text-xs' : 'text-sm'}`}>{op.stepOrder}</div>
                            <div className="mt-0.5 inline-block border border-black px-1 text-[8px] sm:text-[9px] font-extrabold uppercase">
                              {op.isFinalOp === 1 ? 'END' : 'WIP'}
                            </div>
                          </td>

                          <td className={`border-r border-black text-center ${isA5 ? 'p-1' : 'p-1.5'}`}>
                            <div className="flex flex-col items-center justify-center">
                              <QRCodeSVG
                                value={op.qrPayload || `GCCK|${traveler?.po?.poId || 'PO'}|${op.ncId}`}
                                size={isA5 ? 46 : 66}
                                level="M"
                                bgColor="#FFFFFF"
                                fgColor="#000000"
                              />
                              <span className="mt-0.5 break-words font-mono text-[8.5px] sm:text-[9px] font-bold leading-tight">
                                {(op.qrPayload || `GCCK|${traveler?.po?.poId || 'PO'}|${op.ncId}`).replace(/\|/g, '|\u200B')}
                              </span>
                            </div>
                          </td>

                          <td className={`border-r border-black ${isA5 ? 'p-1' : 'p-1.5'}`}>
                            <div className="font-black">
                              [{op.ncId}] {op.opName}
                            </div>
                            <div className={`mt-0.5 font-semibold ${isA5 ? 'text-[10px]' : 'text-[11px]'}`}>
                              Máy: <strong>{op.defaultMachine}</strong>
                            </div>
                            <div className="mt-0.5 font-mono text-[9.5px]">
                              ĐM: Setup {traveler.product?.setupMinutesStd ?? 15}p + Chu kỳ{' '}
                              <strong>{op.stdSeconds}s</strong>/SP
                            </div>
                            {op.isFinalOp === 1 && (
                              <div className="mt-0.5 inline-block border border-black px-1 text-[8.5px] font-black uppercase">
                                ★ Công đoạn cuối — Cộng tồn kho TP
                              </div>
                            )}
                          </td>

                          <td className={`border-r border-black ${isA5 ? 'p-1 text-[10px]' : 'p-1.5 text-[11px]'}`}>
                            <div className="font-bold truncate">
                              {op.toolCode ? `${op.toolCode} — ${op.toolName}` : 'Dao tiêu chuẩn xưởng'}
                            </div>
                            <div className="mt-0.5 font-mono text-[9px] font-semibold">
                              {op.cuttingRec || 'Vc/f theo hướng dẫn gá đặt'}
                            </div>
                            <div className="mt-0.5 text-[9px] text-neutral-700">
                              ĐM cạnh: {op.stdEdgesPerPcs} cạnh/SP
                            </div>
                          </td>

                          <td className={`border-r border-black text-center ${isA5 ? 'p-1 text-[9px]' : 'p-1.5 text-[10px]'}`}>
                            {op.isCriticalCheck === 1 ? (
                              <div className="font-black">★ BẮT BUỘC ĐO</div>
                            ) : (
                              <div className="font-semibold">Ngoại quan</div>
                            )}
                            <div className={`border-t border-dotted border-black text-left text-[8.5px] ${isA5 ? 'mt-1.5 pt-0.5' : 'mt-3 pt-1'}`}>
                              Đo: ..............
                            </div>
                          </td>

                          <td className={`border-r border-black text-center font-mono ${isA5 ? 'p-1 text-[9px]' : 'p-1.5 text-[10px]'}`}>
                            {op.doneOkQty > 0 && (
                              <div className="mb-0.5 border border-black px-1 py-0.2 font-bold text-[8.5px]">
                                MES: {op.doneOkQty} OK
                              </div>
                            )}
                            <div className="mt-0.5 text-left leading-normal sm:leading-loose">
                              <div>OK: .........</div>
                              <div>NG: .........</div>
                            </div>
                          </td>

                          <td className={isA5 ? "p-1 text-[9px]" : "p-1.5 text-[10px]"}>
                            <div className={`border-b border-dotted border-black ${isA5 ? 'h-6 sm:h-7' : 'h-12'}`} />
                            <div className="mt-0.5 text-center text-[8.5px]">Ca / Ngày</div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            {/* 4. FIRST ARTICLE INSPECTION (FAI - QC) SIGN-OFF FRAME */}
            <section className={`border-2 border-black ${isA5 ? 'mt-1.5 p-1.5' : 'mt-3 p-2.5'}`}>
              <div className="flex flex-wrap items-center justify-between gap-1 border-b border-black pb-1">
                <div className={`flex items-center gap-1 font-black uppercase ${isA5 ? 'text-[10px]' : 'text-xs'}`}>
                  <FileCheck2 className="h-3.5 w-3.5" />
                  <span>
                    XÁC NHẬN KIỂM TRA CHI TIẾT ĐẦU TIÊN (FIRST ARTICLE INSPECTION — FAI)
                  </span>
                </div>
                <span className="font-mono text-[9px] font-bold">
                  {traveler.po.qtyPo >= 5
                    ? '★ BẮT BUỘC DUYỆT CON ĐẦU (LÔ >= 5 SP)'
                    : 'Lô < 5 SP: Khuyến khích tự kiểm 100%'}
                </span>
              </div>

              {traveler.faiRecords.length > 0 && (
                <div className={`mt-1 border border-black bg-neutral-50 px-1.5 py-0.5 ${isA5 ? 'text-[9.5px]' : 'text-[11px]'}`}>
                  <strong>Trạng thái trên MES:</strong> Đã ký duyệt điện tử ({traveler.faiRecords[0].result}) bởi{' '}
                  <strong>{traveler.faiRecords[0].inspectorName}</strong> —{' '}
                  {traveler.faiRecords[0].correctiveAction}
                </div>
              )}

              <div className={`grid grid-cols-1 gap-1.5 sm:grid-cols-12 ${isA5 ? 'mt-1 text-[10px]' : 'mt-2 text-[11px]'}`}>
                <div className={`space-y-1 border border-black p-1.5 sm:col-span-5 ${isA5 ? 'text-[9.5px]' : ''}`}>
                  <div className="font-bold uppercase">Kích thước thực đo mẫu đầu:</div>
                  <div>1. KT chính #1: .............................. [Đạt / K.Đạt]</div>
                  <div>2. KT lắp ghép #2: ........................... [Đạt / K.Đạt]</div>
                  <div>3. Độ nhám / Ren: ............................ [Đạt / K.Đạt]</div>
                </div>

                <div className="grid grid-cols-3 divide-x divide-black border border-black text-center sm:col-span-7">
                  <div className={`flex flex-col justify-between ${isA5 ? 'p-1' : 'p-2'}`}>
                    <div className="text-[9px] font-black uppercase">Thợ Đứng Máy</div>
                    <div className={isA5 ? "h-6 sm:h-7" : "h-12"} />
                    <div className="border-t border-dotted border-black pt-0.5 text-[8.5px]">
                      Ký &amp; ghi rõ họ tên
                    </div>
                  </div>
                  <div className={`flex flex-col justify-between ${isA5 ? 'p-1' : 'p-2'}`}>
                    <div className="text-[9px] font-black uppercase">Tổ Trưởng / QC (FAI)</div>
                    <div className={isA5 ? "h-6 sm:h-7" : "h-12"} />
                    <div className="border-t border-dotted border-black pt-0.5 text-[8.5px]">
                      [ ] Cho phép chạy loạt
                    </div>
                  </div>
                  <div className={`flex flex-col justify-between ${isA5 ? 'p-1' : 'p-2'}`}>
                    <div className="text-[9px] font-black uppercase">Quản Đốc / Nhập Kho</div>
                    <div className={isA5 ? "h-6 sm:h-7" : "h-12"} />
                    <div className="border-t border-dotted border-black pt-0.5 text-[8.5px]">
                      SL nhập kho: ........ SP
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Footer Timestamp */}
            <footer className="mt-2 flex flex-wrap items-center justify-between text-[10px] font-semibold text-neutral-700">
              <span>
                Lưu ý: Giữ phiếu trong túi nilon sạch cạnh máy · Chuyển phiếu kèm pallet bán thành phẩm sang bước kế tiếp.
              </span>
              <span className="font-mono">
                In từ GCCK Lean MES: {new Date(traveler.printedAt).toLocaleString('vi-VN')}
              </span>
            </footer>
          </article>
        )}
      </main>

      {/* Searchable PO Picker Sheet */}
      <SearchablePickerSheet
        open={poPickerOpen}
        onClose={() => setPoPickerOpen(false)}
        title="Chọn Lệnh Sản Xuất (PO) Để In Phiếu Công Nghệ QR"
        subtitle={`Danh mục ${ordersList.length} Lệnh SX trong hệ thống`}
        options={poOptions}
        selectedId={activePoId}
        onSelect={handleSelectPo}
      />
    </div>
  );
}

export default JobTravelerPrint;
