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
      {/* Dynamic @page size rule */}
      <style>{`
        @media print {
          @page {
            size: ${isA5 ? 'A5 portrait' : 'A4 portrait'};
            margin: ${isA5 ? '6mm' : '8mm'};
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

            {/* A4 / A5 Toggle */}
            <div className="inline-flex rounded-xl border border-slate-200 bg-slate-100 p-1">
              {(['A4', 'A5'] as const).map((sz) => (
                <button
                  key={sz}
                  type="button"
                  onClick={() => {
                    setPaperSize(sz);
                    toast.info(`Đã chuyển bố cục bản in sang khổ giấy ${sz}`);
                  }}
                  className={`min-h-[40px] rounded-lg px-3 text-xs font-extrabold transition-all ${
                    paperSize === sz
                      ? 'bg-white text-blue-700 shadow-sm ring-1 ring-slate-200'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Khổ {sz}
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
              isA5 ? 'max-w-[560px] p-3.5 text-[11px]' : 'max-w-[860px] p-5 sm:p-6 text-xs'
            }`}
          >
            {/* 1. ISO HEADER FRAME */}
            <header className="grid grid-cols-12 border-2 border-black">
              <div className="col-span-12 border-b border-black p-2.5 sm:col-span-4 sm:border-b-0 sm:border-r">
                <div className="flex items-center gap-2 mb-1">
                  <VicoLogo className="h-8 w-auto object-contain" />
                  <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-700">
                    CÔNG TY CP VICO
                  </div>
                </div>
                <div className="mt-0.5 text-xs font-black uppercase leading-tight sm:text-sm">
                  XƯỞNG CƠ KHÍ CHÍNH XÁC THẮNG LỢI (GCCK)
                </div>
                <div className="mt-1.5 font-mono text-[10px] font-semibold">
                  Biểu mẫu: BM-GCCK-SX-01 · Lần BH: 02
                </div>
              </div>

              <div className="col-span-8 flex flex-col items-center justify-center border-r border-black p-2.5 text-center sm:col-span-5">
                <h1
                  className={`font-black uppercase tracking-tight text-black ${
                    isA5 ? 'text-sm' : 'text-base sm:text-lg'
                  }`}
                >
                  PHIẾU CÔNG NGHỆ &amp; THEO DÕI GIA CÔNG
                </h1>
                <div className="mt-0.5 text-[11px] font-bold uppercase tracking-wide text-neutral-800">
                  (SHOP FLOOR JOB TRAVELER — QUÉT QR 5 GIÂY)
                </div>
                <div className="mt-1 inline-block border border-black px-2 py-0.5 font-mono text-xs font-black">
                  MÃ LỆNH SX: {traveler.po.poId}
                </div>
              </div>

              <div className="col-span-4 flex flex-col items-center justify-center p-2 text-center sm:col-span-3">
                <QRCodeSVG
                  value={`GCCK|${traveler.po.poId}`}
                  size={isA5 ? 58 : 74}
                  level="M"
                  bgColor="#FFFFFF"
                  fgColor="#000000"
                />
                <span className="mt-1 font-mono text-[10px] font-bold">
                  GCCK|{traveler.po.poId}
                </span>
              </div>
            </header>

            {/* 2. ORDER & MATERIAL LOT METADATA TABLE */}
            <section className="mt-2.5 border-2 border-black">
              <div className="grid grid-cols-2 divide-x divide-y divide-black sm:grid-cols-4">
                <div className="p-2">
                  <div className="text-[10px] font-bold uppercase text-neutral-700">
                    Mã Lệnh / PO
                  </div>
                  <div className="font-mono text-sm font-black">{traveler.po.poId}</div>
                </div>
                <div className="p-2">
                  <div className="text-[10px] font-bold uppercase text-neutral-700">
                    Khách hàng
                  </div>
                  <div className="font-bold">{traveler.po.customer}</div>
                </div>
                <div className="p-2">
                  <div className="text-[10px] font-bold uppercase text-neutral-700">
                    Số lượng đặt
                  </div>
                  <div className="font-mono text-sm font-black">{traveler.po.qtyPo} SP</div>
                </div>
                <div className="p-2">
                  <div className="text-[10px] font-bold uppercase text-neutral-700">
                    Hạn giao hàng
                  </div>
                  <div className="font-mono text-sm font-black">
                    {formatDateVn(traveler.po.dueDate)}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 divide-y divide-black border-t border-black sm:grid-cols-12 sm:divide-x sm:divide-y-0">
                <div className="p-2 sm:col-span-6">
                  <div className="text-[10px] font-bold uppercase text-neutral-700">
                    Tên chi tiết / Bản vẽ kỹ thuật ({traveler.po.spId || 'SP'})
                  </div>
                  <div className="mt-0.5 break-words text-sm font-black leading-snug">
                    {traveler.po.productName}
                  </div>
                </div>
                <div className="p-2 sm:col-span-3">
                  <div className="text-[10px] font-bold uppercase text-neutral-700">
                    Mã Lô Phôi / Vật liệu
                  </div>
                  <div className="font-mono font-bold">
                    {traveler.po.materialLot || 'LOT-VICO-2610'}
                  </div>
                  <div className="text-[11px]">
                    {traveler.product?.matName ||
                      traveler.operations[0]?.matName ||
                      'Thép hợp kim cơ khí'}
                  </div>
                </div>
                <div className="p-2 sm:col-span-3">
                  <div className="text-[10px] font-bold uppercase text-neutral-700">
                    Nguồn phôi &amp; Ngày đúc
                  </div>
                  <div className="font-semibold">
                    {traveler.po.supplierName || 'Xưởng Đúc VICO Thắng Lợi'}
                  </div>
                  <div className="font-mono text-[11px]">
                    Ngày phôi: {formatDateVn(traveler.po.castDate)}
                  </div>
                </div>
              </div>
            </section>

            {/* 3. SEQUENTIAL OPERATION ROUTING TABLE WITH INDIVIDUAL SVG QR CODES */}
            <section className="mt-3">
              <div className="mb-1 flex items-center justify-between">
                <h2 className="text-xs font-black uppercase tracking-wide">
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
                          <td className="border-r border-black p-1.5 text-center font-mono">
                            <div className="text-sm font-black">{op.stepOrder}</div>
                            <div className="mt-0.5 inline-block border border-black px-1 text-[9px] font-extrabold uppercase">
                              {op.isFinalOp === 1 ? 'END' : 'WIP'}
                            </div>
                          </td>

                          <td className="border-r border-black p-1.5 text-center">
                            <div className="flex flex-col items-center justify-center">
                              <QRCodeSVG
                                value={op.qrPayload || `GCCK|${traveler?.po?.poId || 'PO'}|${op.ncId}`}
                                size={isA5 ? 52 : 66}
                                level="M"
                                bgColor="#FFFFFF"
                                fgColor="#000000"
                              />
                              <span className="mt-1 break-words font-mono text-[9px] font-bold leading-tight">
                                {(op.qrPayload || `GCCK|${traveler?.po?.poId || 'PO'}|${op.ncId}`).replace(/\|/g, '|\u200B')}
                              </span>
                            </div>
                          </td>

                          <td className="border-r border-black p-1.5">
                            <div className="font-black">
                              [{op.ncId}] {op.opName}
                            </div>
                            <div className="mt-0.5 text-[11px] font-semibold">
                              Máy: <strong>{op.defaultMachine}</strong>
                            </div>
                            <div className="mt-0.5 font-mono text-[10px]">
                              ĐM: Setup {traveler.product?.setupMinutesStd ?? 15}p + Chu kỳ{' '}
                              <strong>{op.stdSeconds}s</strong>/SP
                            </div>
                            {op.isFinalOp === 1 && (
                              <div className="mt-1 inline-block border border-black px-1 text-[9px] font-black uppercase">
                                ★ Công đoạn cuối — Cộng tồn kho TP
                              </div>
                            )}
                          </td>

                          <td className="border-r border-black p-1.5 text-[11px]">
                            <div className="font-bold">
                              {op.toolCode ? `${op.toolCode} — ${op.toolName}` : 'Dao tiêu chuẩn xưởng'}
                            </div>
                            <div className="mt-0.5 font-mono text-[10px] font-semibold">
                              {op.cuttingRec || 'Vc/f theo hướng dẫn gá đặt'}
                            </div>
                            <div className="mt-0.5 text-[10px] text-neutral-700">
                              ĐM cạnh: {op.stdEdgesPerPcs} cạnh/SP
                            </div>
                          </td>

                          <td className="border-r border-black p-1.5 text-center text-[10px]">
                            {op.isCriticalCheck === 1 ? (
                              <div className="font-black">★ BẮT BUỘC ĐO</div>
                            ) : (
                              <div className="font-semibold">Ngoại quan</div>
                            )}
                            <div className="mt-3 border-t border-dotted border-black pt-1 text-left text-[9px]">
                              Đo: ..............
                            </div>
                          </td>

                          <td className="border-r border-black p-1.5 text-center font-mono text-[10px]">
                            {op.doneOkQty > 0 && (
                              <div className="mb-1 border border-black px-1 py-0.5 font-bold">
                                MES: {op.doneOkQty} OK
                              </div>
                            )}
                            <div className="mt-1 text-left leading-loose">
                              <div>OK: .........</div>
                              <div>NG: .........</div>
                            </div>
                          </td>

                          <td className="p-1.5 text-[10px]">
                            <div className="h-12 border-b border-dotted border-black" />
                            <div className="mt-1 text-center text-[9px]">Ca / Ngày</div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            {/* 4. FIRST ARTICLE INSPECTION (FAI - QC) SIGN-OFF FRAME */}
            <section className="mt-3 border-2 border-black p-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-black pb-1.5">
                <div className="flex items-center gap-1.5 font-black uppercase">
                  <FileCheck2 className="h-4 w-4" />
                  <span>
                    XÁC NHẬN KIỂM TRA CHI TIẾT ĐẦU TIÊN (FIRST ARTICLE INSPECTION — FAI)
                  </span>
                </div>
                <span className="font-mono text-[10px] font-bold">
                  {traveler.po.qtyPo >= 5
                    ? '★ BẮT BUỘC DUYỆT CON ĐẦU (LÔ >= 5 SP)'
                    : 'Lô < 5 SP: Khuyến khích tự kiểm 100%'}
                </span>
              </div>

              {traveler.faiRecords.length > 0 && (
                <div className="mt-1.5 border border-black bg-neutral-50 px-2 py-1 text-[11px]">
                  <strong>Trạng thái trên MES:</strong> Đã ký duyệt điện tử ({traveler.faiRecords[0].result}) bởi{' '}
                  <strong>{traveler.faiRecords[0].inspectorName}</strong> —{' '}
                  {traveler.faiRecords[0].correctiveAction}
                </div>
              )}

              <div className="mt-2 grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-12">
                <div className="space-y-1.5 border border-black p-2 sm:col-span-5">
                  <div className="font-bold uppercase">Kích thước thực đo mẫu đầu:</div>
                  <div>1. KT chính #1: ................................. [Đạt / K.Đạt]</div>
                  <div>2. KT lắp ghép #2: .............................. [Đạt / K.Đạt]</div>
                  <div>3. Độ nhám / Ren: ............................... [Đạt / K.Đạt]</div>
                </div>

                <div className="grid grid-cols-3 divide-x divide-black border border-black text-center sm:col-span-7">
                  <div className="flex flex-col justify-between p-2">
                    <div className="text-[10px] font-black uppercase">Thợ Đứng Máy</div>
                    <div className="h-12" />
                    <div className="border-t border-dotted border-black pt-1 text-[9px]">
                      Ký &amp; ghi rõ họ tên
                    </div>
                  </div>
                  <div className="flex flex-col justify-between p-2">
                    <div className="text-[10px] font-black uppercase">Tổ Trưởng / QC (FAI)</div>
                    <div className="h-12" />
                    <div className="border-t border-dotted border-black pt-1 text-[9px]">
                      [ ] Cho phép chạy loạt
                    </div>
                  </div>
                  <div className="flex flex-col justify-between p-2">
                    <div className="text-[10px] font-black uppercase">Quản Đốc / Nhập Kho</div>
                    <div className="h-12" />
                    <div className="border-t border-dotted border-black pt-1 text-[9px]">
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
