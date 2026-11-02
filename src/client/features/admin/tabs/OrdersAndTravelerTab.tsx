import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Edit3,
  FileSpreadsheet,
  Trash2,
  FileSearch,
  Package,
  Plus,
  Printer,
  QrCode,
  Search,
  Truck,
  Wrench,
} from 'lucide-react';
import type { DeliveryLogDto, PurchaseOrderInfo } from '@shared/types';
import { matchesSearch, normalizeVn, removeVietnameseTones } from '@shared/vnSearch';
import { canonicalizeCustomerName } from '@shared/customerNormalization';
import { apiClient } from '@client/lib/apiClient';
import {
  downloadPurchaseOrdersTemplateExcel,
  parsePurchaseOrdersWorkbookBuffer,
  fileToUint8Array,
  type MasterPurchaseOrderImportRow,
} from '@client/lib/excelService';
import { formatDateVn, formatNumber } from '@client/lib/formatters';
import { navigateTo } from '@client/lib/navigation';
import {
  Badge,
  Button,
  Card,
  Modal,
  PaginationBar,
  useToast,
} from '@client/components/ui/IndustrialPrimitives';
import type { AdminTabCommonProps } from '../types';

type PoFilterKey =
  | 'ALL'
  | 'OVERDUE'
  | 'IN_PROGRESS'
  | 'READY_SHIP'
  | 'DELIVERED'
  | 'NO_ROUTING';

export function OrdersAndTravelerTab({
  bootstrap,
  onRefreshBootstrap,
  onNavigateTab,
  deepLink,
}: AdminTabCommonProps) {
  const toast = useToast();

  const [orders, setOrders] = useState<PurchaseOrderInfo[]>(bootstrap.ordersList || []);
  const [deliveries, setDeliveries] = useState<DeliveryLogDto[]>([]);
  const [filterMode, setFilterMode] = useState<PoFilterKey>('ALL');
  const [customerFilter, setCustomerFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState(deepLink?.ordersSearch || '');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  // Create New PO Modal State
  const [createOpen, setCreateOpen] = useState(false);
  const [newPoId, setNewPoId] = useState('');
  const [newCustomer, setNewCustomer] = useState('Win-Win');
  const [customProductMode, setCustomProductMode] = useState(false);
  const [newProductName, setNewProductName] = useState('');
  const [newQtyPo, setNewQtyPo] = useState(20);
  const [newDueDate, setNewDueDate] = useState('2026-11-15');
  const [newMaterialLot, setNewMaterialLot] = useState('LOT-VICO-2610-088');
  const [newSupplierName, setNewSupplierName] = useState('Xưởng Đúc VICO Thắng Lợi');
  const [newCastDate, setNewCastDate] = useState(bootstrap.vietnamToday);
  const [newNote, setNewNote] = useState('');
  const [creatingPo, setCreatingPo] = useState(false);

  // Line Items for Multi-Item PO Creation
  interface PoLineItem {
    id: string;
    suffix: string;
    productName: string;
    spId?: string | null;
    qtyPo: number;
    dueDate: string;
    materialLot: string;
    note: string;
  }

  const [lineItems, setLineItems] = useState<PoLineItem[]>([
    {
      id: 'item-1',
      suffix: '-01',
      productName: '',
      spId: null,
      qtyPo: 20,
      dueDate: '2026-11-15',
      materialLot: '',
      note: '',
    },
  ]);

  // Excel Import Preview Modal State
  const xlsxInputRef = React.useRef<HTMLInputElement | null>(null);
  const [importPreviewOpen, setImportPreviewOpen] = useState(false);
  const [importFileName, setImportFileName] = useState('');
  const [importRows, setImportRows] = useState<MasterPurchaseOrderImportRow[]>([]);
  const [importingBusy, setImportingBusy] = useState(false);

  const handleXlsxFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buf = await fileToUint8Array(file);
      const rows = await parsePurchaseOrdersWorkbookBuffer(buf);
      if (rows.length === 0) {
        toast.warning('File Excel không có dòng dữ liệu đơn hàng hợp lệ.');
        return;
      }
      setImportFileName(file.name);
      setImportRows(rows);
      setImportPreviewOpen(true);
    } catch (err: any) {
      toast.error(err?.message || 'Không đọc được file Excel (.xlsx).');
    } finally {
      e.target.value = '';
    }
  };

  const handleConfirmImport = async () => {
    if (importRows.length === 0) return;
    setImportingBusy(true);
    try {
      const res = await apiClient.post<{ importedCount?: number; message?: string }>('/orders', {
        items: importRows,
      });
      toast.success(res.message || `Đã nạp ${res.importedCount || importRows.length} đơn hàng PO thành công.`);
      setImportPreviewOpen(false);
      setImportRows([]);
      await loadOrdersAndDeliveries();
      await onRefreshBootstrap();
    } catch (err: any) {
      toast.error(err?.message || 'Không thể nạp dữ liệu từ file Excel.');
    } finally {
      setImportingBusy(false);
    }
  };

  const handleAddLineItem = (count = 1) => {
    setLineItems((prev) => {
      const next = [...prev];
      for (let i = 0; i < count; i++) {
        const idx = next.length + 1;
        const sfx = `-${String(idx).padStart(2, '0')}`;
        next.push({
          id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          suffix: sfx,
          productName: productsForSelectedCustomer[0]?.productName || '',
          spId: productsForSelectedCustomer[0]?.spId || null,
          qtyPo: 20,
          dueDate: newDueDate,
          materialLot: newMaterialLot,
          note: '',
        });
      }
      return next;
    });
  };

  const handleRemoveLineItem = (id: string) => {
    if (lineItems.length <= 1) {
      toast.warning('Đơn hàng phải có ít nhất 1 danh mục chi tiết.');
      return;
    }
    setLineItems((prev) => prev.filter((item) => item.id !== id));
  };

  const handleUpdateLineItem = (id: string, patch: Partial<PoLineItem>) => {
    setLineItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...patch } : item))
    );
  };

  // Delivery Modal State
  const [deliverTargetPo, setDeliverTargetPo] = useState<PurchaseOrderInfo | null>(null);
  const [deliverQty, setDeliverQty] = useState(1);
  const [deliverNote, setDeliverNote] = useState('');
  const [submittingDelivery, setSubmittingDelivery] = useState(false);

  // Edit PO Modal State
  const [editTargetPo, setEditTargetPo] = useState<PurchaseOrderInfo | null>(null);
  const [editQtyPo, setEditQtyPo] = useState(1);
  const [editDueDate, setEditDueDate] = useState('');
  const [editMaterialLot, setEditMaterialLot] = useState('');
  const [editSupplierName, setEditSupplierName] = useState('');
  const [editPriority, setEditPriority] = useState(2);
  const [editNote, setEditNote] = useState('');
  const [editFinishedQty, setEditFinishedQty] = useState(0);
  const [editWipQty, setEditWipQty] = useState(0);
  const [editDeliveredQty, setEditDeliveredQty] = useState(0);
  const [savingEdit, setSavingEdit] = useState(false);

  useEffect(() => {
    setOrders(bootstrap.ordersList || []);
  }, [bootstrap.ordersList]);

  useEffect(() => {
    if (deepLink?.ordersSearch !== undefined) {
      setSearchQuery(deepLink.ordersSearch);
      setPage(1);
    }
  }, [deepLink?.ordersSearch]);

  const loadOrdersAndDeliveries = async () => {
    try {
      const res = await apiClient.get<{
        items: PurchaseOrderInfo[];
        deliveries: DeliveryLogDto[];
      }>('/orders');
      setOrders(res.items || []);
      setDeliveries(res.deliveries || []);
    } catch {
      // Keep bootstrap fallback
    }
  };

  useEffect(() => {
    void loadOrdersAndDeliveries();
  }, []);

  // Build operation routing lookup by spId & compact productName
  const opCountMap = useMemo(() => {
    const bySp = new Map<string, number>();
    const byProd = new Map<string, number>();
    for (const op of bootstrap.operations) {
      if (op.spId) bySp.set(op.spId, (bySp.get(op.spId) || 0) + 1);
      const compact = normalizeVn(op.productName).replace(/[^A-Z0-9]/gi, '').toUpperCase();
      if (compact) byProd.set(compact, (byProd.get(compact) || 0) + 1);
    }
    const prodSpMap = new Map<string, string>();
    for (const p of bootstrap.products) {
      const compact = normalizeVn(p.productName).replace(/[^A-Z0-9]/gi, '').toUpperCase();
      if (compact) prodSpMap.set(compact, p.spId);
    }
    return {
      getCount: (po: PurchaseOrderInfo) => {
        if (po.spId && bySp.has(po.spId)) return bySp.get(po.spId)!;
        const compact = normalizeVn(po.productName).replace(/[^A-Z0-9]/gi, '').toUpperCase();
        if (prodSpMap.has(compact)) {
          const spId = prodSpMap.get(compact)!;
          if (bySp.has(spId)) return bySp.get(spId)!;
        }
        if (byProd.has(compact)) return byProd.get(compact)!;
        for (const [c, count] of byProd.entries()) {
          if (c === compact || c.includes(compact) || compact.includes(c)) return count;
        }
        return 0;
      },
    };
  }, [bootstrap.operations, bootstrap.products]);

  const customersList = useMemo(() => {
    const set = new Set<string>();
    orders.forEach((o) => {
      const norm = canonicalizeCustomerName(o.customer || '');
      if (norm.customer) set.add(norm.customer);
    });
    bootstrap.products.forEach((p) => {
      const norm = canonicalizeCustomerName(p.customer || '');
      if (norm.customer) set.add(norm.customer);
    });
    return [...set].sort((a, b) => a.localeCompare(b, 'vi'));
  }, [orders, bootstrap.products]);

  const productsForSelectedCustomer = useMemo(() => {
    if (!newCustomer.trim()) return bootstrap.products;
    const target = canonicalizeCustomerName(newCustomer).customer.toLowerCase();
    const filtered = bootstrap.products.filter((p) => {
      const c = canonicalizeCustomerName(p.customer || '').customer.toLowerCase();
      return c === target || c.includes(target) || target.includes(c);
    });
    return filtered.length > 0 ? filtered : bootstrap.products;
  }, [bootstrap.products, newCustomer]);

  const classifyPoHelpers = (po: PurchaseOrderInfo) => {
    const statusAscii = removeVietnameseTones(po.status || '').toLowerCase();
    const isDelivered = po.remainQty <= 0 || statusAscii.includes('da giao du');
    const isOverdue = !isDelivered && po.dueDate < bootstrap.vietnamToday;
    const isReadyShip = !isDelivered && (po.stockQty > 0 || statusAscii.includes('cho giao'));
    const isInProgress =
      !isDelivered &&
      (statusAscii.includes('dang gia cong') ||
        (po.wipQty > 0 && po.finishedQty < po.qtyPo) ||
        (po.finishedQty > 0 && po.finishedQty < po.qtyPo));
    const opCount = opCountMap.getCount(po);
    const hasNoRouting = opCount === 0;
    return { isDelivered, isOverdue, isReadyShip, isInProgress, opCount, hasNoRouting };
  };

  const filterCounts = useMemo(() => {
    let overdue = 0;
    let inProgress = 0;
    let readyShip = 0;
    let delivered = 0;
    let noRouting = 0;
    for (const po of orders) {
      const c = classifyPoHelpers(po);
      if (c.isOverdue) overdue++;
      if (c.isInProgress) inProgress++;
      if (c.isReadyShip) readyShip++;
      if (c.isDelivered) delivered++;
      if (c.hasNoRouting) noRouting++;
    }
    return {
      all: orders.length,
      overdue,
      inProgress,
      readyShip,
      delivered,
      noRouting,
    };
  }, [orders, bootstrap.vietnamToday, opCountMap]);

  const filteredOrders = useMemo(() => {
    return orders.filter((po) => {
      if (customerFilter !== 'ALL') {
        const target = canonicalizeCustomerName(customerFilter).customer.toLowerCase();
        const poCust = canonicalizeCustomerName(po.customer || '').customer.toLowerCase();
        if (poCust !== target) return false;
      }
      const c = classifyPoHelpers(po);
      if (filterMode === 'OVERDUE' && !c.isOverdue) return false;
      if (filterMode === 'IN_PROGRESS' && !c.isInProgress) return false;
      if (filterMode === 'READY_SHIP' && !c.isReadyShip) return false;
      if (filterMode === 'DELIVERED' && !c.isDelivered) return false;
      if (filterMode === 'NO_ROUTING' && !c.hasNoRouting) return false;

      if (!searchQuery.trim()) return true;
      return matchesSearch(
        `${po.poId} ${po.customer} ${po.productName} ${po.spId || ''} ${po.materialLot || ''} ${po.supplierName || ''} ${po.note || ''}`,
        searchQuery
      );
    });
  }, [orders, customerFilter, filterMode, searchQuery, bootstrap.vietnamToday, opCountMap]);

  const pagedOrders = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredOrders.slice(start, start + pageSize);
  }, [filteredOrders, page, pageSize]);

  const openCreateModal = () => {
    const randSuffix = String(orders.length + 1).padStart(3, '0');
    setNewPoId(`PO2610-${randSuffix}`);
    const firstCust = customersList[0] || 'Win-Win';
    setNewCustomer(firstCust);
    const firstProd =
      bootstrap.products.find((p) => p.customer === firstCust)?.productName ||
      bootstrap.products[0]?.productName ||
      '';
    setNewProductName(firstProd);
    setCustomProductMode(false);
    setNewQtyPo(20);
    setNewMaterialLot(
      `LOT-VICO-${bootstrap.vietnamToday.replace(/-/g, '').slice(2)}-${randSuffix}`
    );
    setCreateOpen(true);
  };

  const handleCreatePo = async (e: React.FormEvent) => {
    e.preventDefault();
    const basePo = newPoId.trim();
    if (!basePo) {
      toast.warning('Vui lòng nhập Mã đơn hàng / Lệnh PO chung.');
      return;
    }

    if (lineItems.length === 0) {
      toast.warning('Vui lòng thêm ít nhất 1 danh mục hàng / chi tiết.');
      return;
    }

    // Validate all items
    for (let i = 0; i < lineItems.length; i++) {
      const it = lineItems[i];
      if (!it.productName.trim()) {
        toast.warning(`Dòng ${i + 1}: Vui lòng chọn hoặc nhập Tên sản phẩm / bản vẽ.`);
        return;
      }
      if (it.qtyPo <= 0) {
        toast.warning(`Dòng ${i + 1}: Số lượng đặt hàng phải lớn hơn 0.`);
        return;
      }
    }

    setCreatingPo(true);
    try {
      const payloadItems = lineItems.map((it) => {
        const fullPoId = lineItems.length === 1 && !it.suffix
          ? basePo
          : it.suffix.startsWith('-') || it.suffix.startsWith('_')
            ? `${basePo}${it.suffix}`
            : it.suffix
              ? `${basePo}-${it.suffix}`
              : basePo;

        const matchedProd = bootstrap.products.find(
          (p) => p.productName === it.productName && (!newCustomer || p.customer === newCustomer)
        );

        return {
          poId: fullPoId,
          customer: newCustomer,
          spId: it.spId || matchedProd?.spId || null,
          productName: it.productName.trim(),
          qtyPo: it.qtyPo,
          dueDate: it.dueDate || newDueDate,
          materialLot: (it.materialLot || newMaterialLot).trim(),
          supplierName: newSupplierName.trim(),
          castDate: newCastDate,
          note: (it.note || newNote).trim(),
        };
      });

      await apiClient.post('/orders', {
        items: payloadItems,
      });

      toast.success(
        `🎉 Đã tạo thành công đơn hàng ${basePo} với ${payloadItems.length} danh mục chi tiết!`
      );
      setCreateOpen(false);
      await loadOrdersAndDeliveries();
      await onRefreshBootstrap();
    } catch (err: any) {
      toast.error(err?.message || 'Không thể tạo đơn hàng PO mới.');
    } finally {
      setCreatingPo(false);
    }
  };

  const openDeliverModal = (po: PurchaseOrderInfo) => {
    setDeliverTargetPo(po);
    const defaultDeliver =
      po.stockQty > 0
        ? Math.min(po.stockQty, Math.max(1, po.remainQty))
        : Math.max(1, po.remainQty || 1);
    setDeliverQty(defaultDeliver);
    setDeliverNote(
      `Phiếu xuất kho giao hàng đợt ${deliveries.filter((d) => d.poId === po.poId).length + 1}`
    );
  };

  const handleRecordDelivery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deliverTargetPo) return;
    if (deliverQty <= 0) {
      toast.warning('Số lượng xuất giao phải lớn hơn 0.');
      return;
    }
    setSubmittingDelivery(true);
    try {
      const res = await apiClient.post<{ message: string; item?: PurchaseOrderInfo }>(
        `/orders/${encodeURIComponent(deliverTargetPo.poId)}/deliver`,
        {
          qtyDeliver: deliverQty,
          note: deliverNote.trim(),
        }
      );
      if (res.item) {
        setOrders((prev) =>
          prev.map((o) => (o.poId.toLowerCase() === deliverTargetPo.poId.toLowerCase() ? res.item! : o))
        );
      }
      toast.success(res.message || `Đã xuất giao ${deliverQty} SP cho ${deliverTargetPo.poId}.`);
      setDeliverTargetPo(null);
      await loadOrdersAndDeliveries();
      await onRefreshBootstrap();
    } catch (err: any) {
      toast.error(err?.message || 'Lỗi ghi nhận xuất kho giao hàng.');
    } finally {
      setSubmittingDelivery(false);
    }
  };

  const openEditModal = (po: PurchaseOrderInfo) => {
    setEditTargetPo(po);
    setEditQtyPo(po.qtyPo);
    setEditDueDate(po.dueDate);
    setEditMaterialLot(po.materialLot || '');
    setEditSupplierName(po.supplierName || '');
    setEditPriority(po.priority ?? 2);
    setEditNote(po.note || '');
    setEditFinishedQty(po.finishedQty || 0);
    setEditWipQty(po.wipQty || 0);
    setEditDeliveredQty(po.deliveredQty || 0);
  };

  const handleSaveEditPo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTargetPo) return;
    setSavingEdit(true);
    try {
      const res = await apiClient.patch<{ success: boolean; item?: PurchaseOrderInfo }>(
        `/orders/${encodeURIComponent(editTargetPo.poId)}`,
        {
          qtyPo: editQtyPo,
          dueDate: editDueDate,
          materialLot: editMaterialLot,
          supplierName: editSupplierName,
          priority: editPriority,
          note: editNote,
          finishedQty: editFinishedQty,
          wipQty: editWipQty,
          deliveredQty: editDeliveredQty,
        }
      );
      if (res.item) {
        setOrders((prev) =>
          prev.map((o) => (o.poId.toLowerCase() === editTargetPo.poId.toLowerCase() ? res.item! : o))
        );
      } else {
        const stockQty = Math.max(0, editFinishedQty - editDeliveredQty);
        const remainQty = Math.max(0, editQtyPo - editDeliveredQty);
        let status = '⏳ Đang chờ SX';
        if (editDeliveredQty >= editQtyPo) status = '✅ Đã giao đủ';
        else if (editFinishedQty >= editQtyPo) status = '📦 Xong CK - Chờ giao';
        else if (editWipQty > 0 || editFinishedQty > 0) status = '⚙️ Đang gia công';

        setOrders((prev) =>
          prev.map((o) =>
            o.poId.toLowerCase() === editTargetPo.poId.toLowerCase()
              ? {
                  ...o,
                  qtyPo: editQtyPo,
                  dueDate: editDueDate,
                  materialLot: editMaterialLot,
                  supplierName: editSupplierName,
                  priority: editPriority,
                  note: editNote,
                  finishedQty: editFinishedQty,
                  wipQty: editWipQty,
                  deliveredQty: editDeliveredQty,
                  stockQty,
                  remainQty,
                  status,
                }
              : o
          )
        );
      }
      toast.success(
        `Đã cập nhật Lệnh SX ${editTargetPo.poId} (Xong CK: ${editFinishedQty}/${editQtyPo} SP).`
      );
      setEditTargetPo(null);
      await loadOrdersAndDeliveries();
      await onRefreshBootstrap();
    } catch (err: any) {
      toast.error(err?.message || 'Không thể cập nhật PO.');
    } finally {
      setSavingEdit(false);
    }
  };

  const targetPoDeliveries = useMemo(() => {
    if (!deliverTargetPo) return [];
    return deliveries.filter((d) => d.poId === deliverTargetPo.poId);
  }, [deliveries, deliverTargetPo]);

  const modalInputCls =
    'h-10 w-full rounded-xl border border-slate-300 bg-white px-3 font-semibold text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/15';

  return (
    <div className="space-y-4">
      <Card noPadding>
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
          <div>
            <div className="flex items-center gap-2">
              <Package className="h-5 w-5 text-blue-600" />
              <h2 className="text-base font-extrabold uppercase tracking-wide text-slate-900">
                Quản Lý Đơn Hàng PO, Lô Phôi Đầu Vào, Xuất Giao Kho &amp; Phiếu Công Nghệ QR
              </h2>
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              Hiển thị 100% toàn bộ <strong className="text-blue-700">{orders.length} PO</strong>{' '}
              (không cắt cụt 60 dòng). Đối soát SL Hoàn thành công đoạn Cuối vs SL Đã Xuất Giao Kho
              &amp; In Lệnh SX QR 1-Click.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void downloadPurchaseOrdersTemplateExcel()}
              title="Tải biểu mẫu Excel (.xlsx) chuẩn để nhập nhanh đơn hàng nhiều danh mục"
            >
              <Download className="h-4 w-4 text-emerald-600" />
              📥 Tải File Mẫu Excel Nhập PO
            </Button>

            <input
              ref={xlsxInputRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(e) => void handleXlsxFileChange(e)}
            />

            <Button
              variant="secondary"
              size="sm"
              onClick={() => xlsxInputRef.current?.click()}
              title="Nhập hàng loạt đơn hàng PO từ tệp Excel (.xlsx)"
            >
              <FileSpreadsheet className="h-4 w-4 text-blue-600" />
              📤 Nạp Từ Excel (.xlsx)
            </Button>

            <Button variant="primary" size="sm" onClick={openCreateModal}>
              <Plus className="h-4 w-4" />
              + Tạo Đơn Hàng / PO Mới
            </Button>
          </div>
        </div>

        {/* Smart Filter Pills */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 bg-slate-50/70 px-4 py-2.5">
          {(
            [
              ['ALL', `Tất cả (${filterCounts.all})`],
              ['OVERDUE', `🔥 Trễ hạn (${filterCounts.overdue})`],
              ['IN_PROGRESS', `⚙️ Đang gia công (${filterCounts.inProgress})`],
              ['READY_SHIP', `📦 Xong CK - Chờ giao (${filterCounts.readyShip})`],
              ['DELIVERED', `✅ Đã giao đủ (${filterCounts.delivered})`],
              ['NO_ROUTING', `⚠️ Chưa có quy trình NC (${filterCounts.noRouting})`],
            ] as Array<[PoFilterKey, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setFilterMode(key);
                setPage(1);
              }}
              className={`rounded-lg border px-2.5 py-1.5 text-xs font-bold transition-colors ${
                filterMode === key
                  ? 'border-blue-600 bg-blue-600 text-white shadow-sm'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Search & Customer Filter */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
          <div className="relative min-w-[260px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              placeholder="Gõ Mã PO, Khách hàng, Tên bản vẽ SP (có hoặc không dấu), Mã lô phôi..."
              className="h-9 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/15"
            />
          </div>

          <select
            value={customerFilter}
            onChange={(e) => {
              setCustomerFilter(e.target.value);
              setPage(1);
            }}
            className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-800 focus:border-blue-500 focus:outline-none"
          >
            <option value="ALL">Tất cả Khách hàng ({customersList.length})</option>
            {customersList.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        {/* Full PO Table */}
        <div className="max-h-[600px] overflow-auto">
          <table className="w-full min-w-[1220px] border-collapse text-left text-xs">
            <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-600">
              <tr>
                <th className="px-3.5 py-2.5">Mã PO &amp; Lô Phôi</th>
                <th className="px-3 py-2.5">Khách Hàng</th>
                <th className="px-3 py-2.5">Sản Phẩm &amp; Quy Trình</th>
                <th className="px-2.5 py-2.5 text-center">SL Đặt</th>
                <th className="px-2.5 py-2.5 text-center">Đang SX (WIP)</th>
                <th className="px-2.5 py-2.5 text-center">Xong CK (End)</th>
                <th className="px-2.5 py-2.5 text-center">Tồn Kho TP</th>
                <th className="px-2.5 py-2.5 text-center">Đã Giao</th>
                <th className="px-2.5 py-2.5 text-center">Còn Nợ</th>
                <th className="px-3 py-2.5">Hạn Giao</th>
                <th className="px-3 py-2.5">Trạng Thái</th>
                <th className="px-3.5 py-2.5 text-right">Thao Tác (Giao / QR / Truy Vết)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {pagedOrders.map((po) => {
                const c = classifyPoHelpers(po);
                const statusVariant = c.isDelivered
                  ? 'success'
                  : c.isOverdue
                    ? 'danger'
                    : c.isReadyShip
                      ? 'info'
                      : c.isInProgress
                        ? 'warning'
                        : 'neutral';

                const finishRatioPct = Math.min(
                  100,
                  Math.max(
                    0,
                    Math.round(
                      ((Math.max(po.finishedQty, po.deliveredQty) || 0) /
                        Math.max(1, po.qtyPo || 1)) *
                        100
                    )
                  )
                );

                return (
                  <tr
                    key={po.poId}
                    className={`transition-colors ${
                      c.isOverdue
                        ? 'bg-rose-50/40 hover:bg-rose-50/70'
                        : 'hover:bg-blue-50/40'
                    }`}
                  >
                    <td className="px-3.5 py-2.5">
                      <div className="font-mono-num font-bold text-blue-700">{po.poId}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-slate-500">
                        <span>{po.materialLot || 'LOT-VICO'}</span>
                        {po.faiStatus === 'PENDING_FAI' && (
                          <Badge variant="warning" className="text-[10px]">
                            Chờ FAI
                          </Badge>
                        )}
                        {po.faiStatus === 'FAI_PASSED' && (
                          <Badge variant="success" className="text-[10px]">
                            FAI Đạt
                          </Badge>
                        )}
                      </div>
                    </td>

                    <td className="px-3 py-2.5">
                      <div className="font-bold text-slate-800">
                        {canonicalizeCustomerName(po.customer).customer}
                      </div>
                      {(po.contractRef || canonicalizeCustomerName(po.customer).contractRef) && (
                        <div className="text-[10px] font-mono-num font-semibold text-blue-600 truncate max-w-[130px]" title={po.contractRef || canonicalizeCustomerName(po.customer).contractRef}>
                          HĐ/PO: {po.contractRef || canonicalizeCustomerName(po.customer).contractRef}
                        </div>
                      )}
                    </td>

                    <td className="px-3 py-2.5">
                      <div className="font-bold text-slate-900">{po.productName}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                        {po.spId && <span className="font-mono-num text-slate-500">{po.spId}</span>}
                        {c.hasNoRouting ? (
                          <button
                            type="button"
                            onClick={() =>
                              onNavigateTab('master', {
                                masterSubTab: 'OPS',
                                masterSearch: po.productName,
                              })
                            }
                            className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 transition-colors hover:bg-amber-100"
                          >
                            <Wrench className="h-3 w-3" /> Chưa có NC (+ Khai báo)
                          </button>
                        ) : (
                          <span className="font-medium text-emerald-700">
                            {c.opCount} công đoạn NC
                          </span>
                        )}
                      </div>
                      <div className="mt-1.5 flex max-w-[180px] items-center gap-1.5">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className={`h-full rounded-full ${
                              finishRatioPct >= 100 || c.isDelivered
                                ? 'bg-emerald-500'
                                : 'bg-blue-600'
                            }`}
                            style={{ width: `${finishRatioPct}%` }}
                          />
                        </div>
                        <span className="font-mono-num text-[10px] font-semibold text-slate-500">
                          {finishRatioPct}%
                        </span>
                      </div>
                    </td>

                    <td className="font-mono-num px-2.5 py-2.5 text-center font-bold text-slate-900">
                      {formatNumber(po.qtyPo)}
                    </td>
                    <td
                      className={`font-mono-num px-2.5 py-2.5 text-center ${
                        po.wipQty > 0 ? 'font-semibold text-amber-700' : 'text-slate-400'
                      }`}
                    >
                      {formatNumber(po.wipQty)}
                    </td>
                    <td
                      className={`font-mono-num px-2.5 py-2.5 text-center ${
                        po.finishedQty > 0 ? 'font-bold text-emerald-700' : 'text-slate-400'
                      }`}
                    >
                      {formatNumber(po.finishedQty)}
                    </td>
                    <td
                      className={`font-mono-num px-2.5 py-2.5 text-center ${
                        po.stockQty > 0 ? 'font-bold text-blue-700' : 'text-slate-400'
                      }`}
                    >
                      {formatNumber(po.stockQty)}
                    </td>
                    <td
                      className={`font-mono-num px-2.5 py-2.5 text-center ${
                        po.deliveredQty > 0 ? 'font-bold text-indigo-700' : 'text-slate-400'
                      }`}
                    >
                      {formatNumber(po.deliveredQty)}
                    </td>
                    <td
                      className={`font-mono-num px-2.5 py-2.5 text-center ${
                        po.remainQty > 0 ? 'font-extrabold text-rose-700' : 'text-slate-400'
                      }`}
                    >
                      {formatNumber(po.remainQty)}
                    </td>

                    <td className="font-mono-num px-3 py-2.5">
                      <div className={c.isOverdue ? 'font-bold text-rose-700' : 'text-slate-700'}>
                        {formatDateVn(po.dueDate)}
                      </div>
                      {c.isOverdue && (
                        <div className="text-[10px] font-bold text-rose-600">🔥 Quá hạn giao</div>
                      )}
                    </td>

                    <td className="px-3 py-2.5">
                      <Badge variant={statusVariant}>{po.status}</Badge>
                    </td>

                    <td className="px-3.5 py-2.5 text-right">
                      <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                        <Button
                          variant="success"
                          size="sm"
                          onClick={() => openDeliverModal(po)}
                          title="Xuất kho giao hàng & Xem lịch sử đợt giao"
                        >
                          <Truck className="h-3.5 w-3.5" />
                          🚚 Xuất Giao
                        </Button>

                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            navigateTo(`/print/traveler/${encodeURIComponent(po.poId)}`)
                          }
                          title="In Phiếu Công Nghệ kèm Mã QR từng nguyên công"
                        >
                          <Printer className="h-3.5 w-3.5 text-blue-600" />
                          🖨️ In Phiếu QR
                        </Button>

                        <button
                          type="button"
                          onClick={() =>
                            onNavigateTab('logs_qc', {
                              logsSubView: 'TRACE',
                              tracePoId: po.poId,
                            })
                          }
                          className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 text-xs font-semibold text-violet-700 transition-colors hover:border-violet-400 hover:bg-violet-50"
                          title="Truy vết 100% phôi - FAI - máy - công nhân - giao hàng"
                        >
                          <FileSearch className="h-3.5 w-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => openEditModal(po)}
                          className="inline-flex h-8 items-center justify-center rounded-lg border border-slate-300 bg-white px-2 text-slate-600 transition-colors hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700"
                          title="Chỉnh sửa thông tin PO"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <PaginationBar
          totalItems={filteredOrders.length}
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(sz) => {
            setPageSize(sz);
            setPage(1);
          }}
        />
      </Card>

      {/* ==================== MODAL: CREATE NEW PO (MULTI-ITEM CAPABLE) ==================== */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="➕ Tạo Lệnh Sản Xuất / Đơn Hàng PO Mới (Nhiều Danh Mục)"
        subtitle="Hỗ trợ khai báo cùng lúc nhiều chi tiết cho 1 đơn hàng (hoặc nạp hàng loạt từ Excel .xlsx)"
        maxWidthClass="max-w-4xl"
      >
        <form noValidate onSubmit={handleCreatePo} className="space-y-4 text-xs">
          {/* Header Card: Base Order Information */}
          <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-3.5 space-y-3">
            <div className="text-[11px] font-black uppercase tracking-wider text-blue-900 flex items-center gap-1.5">
              <Package className="h-4 w-4 text-blue-600" />
              <span>1. Thông Tin Chung Của Đơn Hàng / Hợp Đồng Khách Hàng</span>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
              <div>
                <label className="mb-1 block font-bold uppercase text-slate-700">
                  Mã Đơn / PO Gốc (*)
                </label>
                <input
                  type="text"
                  required
                  value={newPoId}
                  onChange={(e) => setNewPoId(e.target.value)}
                  placeholder="VD: PO2610-190"
                  className={`${modalInputCls} font-mono-num font-extrabold text-blue-700`}
                />
              </div>

              <div>
                <label className="mb-1 block font-bold uppercase text-slate-700">
                  Khách Hàng (*)
                </label>
                <select
                  value={canonicalizeCustomerName(newCustomer).customer}
                  onChange={(e) => {
                    const chosen = e.target.value;
                    const canonical = canonicalizeCustomerName(chosen).customer;
                    setNewCustomer(canonical);
                    const matchProds = bootstrap.products.filter(
                      (p) => canonicalizeCustomerName(p.customer).customer === canonical
                    );
                    if (matchProds.length > 0) {
                      setLineItems((prev) =>
                        prev.map((it, idx) => ({
                          ...it,
                          productName: matchProds[idx % matchProds.length]?.productName || it.productName,
                          spId: matchProds[idx % matchProds.length]?.spId || it.spId,
                        }))
                      );
                    }
                  }}
                  className={`${modalInputCls} font-bold text-slate-900`}
                >
                  <option value="">-- Chọn Khách Hàng ({customersList.length}) --</option>
                  {customersList.map((c) => (
                    <option key={c} value={c}>
                      🏢 {c}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block font-bold uppercase text-slate-700">
                  Hạn Giao Chung (*)
                </label>
                <input
                  type="date"
                  required
                  value={newDueDate}
                  onChange={(e) => {
                    setNewDueDate(e.target.value);
                    setLineItems((prev) => prev.map((it) => ({ ...it, dueDate: e.target.value })));
                  }}
                  className={`${modalInputCls} font-mono-num`}
                />
              </div>

              <div>
                <label className="mb-1 block font-bold uppercase text-slate-700">
                  Ngày Nhập / Đúc Phôi
                </label>
                <input
                  type="date"
                  value={newCastDate}
                  onChange={(e) => setNewCastDate(e.target.value)}
                  className={`${modalInputCls} font-mono-num`}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block font-bold uppercase text-blue-800">
                  🧬 Mã Lô Phôi Đầu Vào
                </label>
                <input
                  type="text"
                  value={newMaterialLot}
                  onChange={(e) => {
                    setNewMaterialLot(e.target.value);
                    setLineItems((prev) =>
                      prev.map((it) => ({ ...it, materialLot: it.materialLot || e.target.value }))
                    );
                  }}
                  placeholder="VD: LOT-VICO-2610-088"
                  className="font-mono-num h-9 w-full rounded-lg border border-slate-300 bg-white px-3 font-semibold text-slate-900 focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block font-bold uppercase text-blue-800">
                  🏭 Nhà Cung Cấp Phôi
                </label>
                <input
                  type="text"
                  value={newSupplierName}
                  onChange={(e) => setNewSupplierName(e.target.value)}
                  placeholder="VD: Xưởng Đúc VICO Thắng Lợi"
                  className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 font-semibold text-slate-900 focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block font-bold uppercase text-slate-700">
                  Ghi Chú Đơn Hàng
                </label>
                <input
                  type="text"
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="Giao thành đợt, yêu cầu chứng chỉ..."
                  className={modalInputCls}
                />
              </div>
            </div>
          </div>

          {/* Line Items Section */}
          <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
              <div>
                <div className="text-[11px] font-black uppercase tracking-wider text-slate-900 flex items-center gap-1.5">
                  <Package className="h-4 w-4 text-emerald-600" />
                  <span>2. Bảng Danh Mục Các Chi Tiết / Sản Phẩm Trong Đơn ({lineItems.length} Mục)</span>
                </div>
                <p className="text-[11px] text-slate-500">
                  Một đơn hàng có thể gồm 5–10 chi tiết; hệ thống tự sinh mã con (-01, -02...).
                </p>
              </div>

              {/* Quick Add Buttons */}
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => handleAddLineItem(1)}
                  className="text-xs"
                >
                  <Plus className="h-3.5 w-3.5 text-blue-600" />
                  + Thêm 1 Chi Tiết
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => handleAddLineItem(5)}
                  className="text-xs"
                >
                  <Plus className="h-3.5 w-3.5 text-emerald-600" />
                  + Thêm 5 Dòng
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => handleAddLineItem(10)}
                  className="text-xs"
                >
                  <Plus className="h-3.5 w-3.5 text-purple-600" />
                  + Thêm 10 Dòng
                </Button>
              </div>
            </div>

            {/* Line Items Table */}
            <div className="max-h-[360px] overflow-auto border border-slate-200 rounded-lg">
              <table className="w-full min-w-[760px] border-collapse text-left text-xs">
                <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-600">
                  <tr>
                    <th className="px-2.5 py-2 w-10 text-center">STT</th>
                    <th className="px-2.5 py-2 w-36">Ký Hiệu / Mã Con</th>
                    <th className="px-2.5 py-2">Chi Tiết / Sản Phẩm (*)</th>
                    <th className="px-2.5 py-2 w-28 text-center">SL Đặt (*)</th>
                    <th className="px-2.5 py-2 w-32">Hạn Giao</th>
                    <th className="px-2.5 py-2 w-36">Lô Phôi Riêng</th>
                    <th className="px-2.5 py-2 w-10 text-center">Xóa</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {lineItems.map((item, idx) => {
                    const fullPo = lineItems.length === 1 && !item.suffix
                      ? newPoId.trim()
                      : item.suffix.startsWith('-') || item.suffix.startsWith('_')
                        ? `${newPoId.trim()}${item.suffix}`
                        : item.suffix
                          ? `${newPoId.trim()}-${item.suffix}`
                          : newPoId.trim();

                    return (
                      <tr key={item.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="px-2.5 py-2 text-center font-bold text-slate-400">
                          {idx + 1}
                        </td>

                        <td className="px-2.5 py-2">
                          <input
                            type="text"
                            value={item.suffix}
                            onChange={(e) => handleUpdateLineItem(item.id, { suffix: e.target.value })}
                            placeholder="-01"
                            className="font-mono-num h-8 w-full rounded border border-slate-300 px-2 font-bold text-blue-700 text-xs focus:border-blue-500 focus:outline-none"
                            title={`Mã đầy đủ sẽ là: ${fullPo}`}
                          />
                          <div className="text-[10px] font-mono-num text-slate-500 truncate" title={fullPo}>
                            {fullPo || '...'}
                          </div>
                        </td>

                        <td className="px-2.5 py-2">
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              list={`gcck-line-prod-${idx}`}
                              value={item.productName}
                              onChange={(e) => {
                                const val = e.target.value;
                                const matched = bootstrap.products.find(
                                  (p) =>
                                    p.productName.toLowerCase() === val.toLowerCase() ||
                                    p.spId.toLowerCase() === val.toLowerCase()
                                );
                                handleUpdateLineItem(item.id, {
                                  productName: matched ? matched.productName : val,
                                  spId: matched?.spId || null,
                                });
                              }}
                              placeholder="Chọn hoặc gõ tên sản phẩm..."
                              className="h-8 flex-1 rounded border border-slate-300 px-2 text-xs font-semibold text-slate-900 focus:border-blue-500 focus:outline-none"
                            />
                            <select
                              value={item.spId || ''}
                              onChange={(e) => {
                                const spId = e.target.value;
                                const matched = bootstrap.products.find((p) => p.spId === spId);
                                if (matched) {
                                  handleUpdateLineItem(item.id, {
                                    productName: matched.productName,
                                    spId: matched.spId,
                                  });
                                }
                              }}
                              title="Bấm để chọn nhanh sản phẩm từ danh mục khách hàng"
                              className="h-8 max-w-[130px] rounded border border-blue-300 bg-blue-50/70 px-1.5 text-[11px] font-bold text-blue-800 hover:bg-blue-100 focus:outline-none"
                            >
                              <option value="">▼ DS ({productsForSelectedCustomer.length} SP)</option>
                              {productsForSelectedCustomer.map((p) => (
                                <option key={p.spId} value={p.spId}>
                                  [{p.spId}] {p.productName}
                                </option>
                              ))}
                            </select>
                          </div>
                          <datalist id={`gcck-line-prod-${idx}`}>
                            {productsForSelectedCustomer.map((p) => (
                              <option key={p.spId} value={p.productName}>
                                [{p.spId}] {p.productName}
                              </option>
                            ))}
                          </datalist>
                          <div className="mt-0.5 flex items-center gap-1 text-[10px]">
                            {item.spId ? (
                              <span className="font-bold text-emerald-700">
                                ✓ Mã SP: {item.spId}
                              </span>
                            ) : item.productName ? (
                              <span className="text-amber-700 italic">
                                (Tên tự do / Chưa gán mã)
                              </span>
                            ) : (
                              <span className="text-slate-400">
                                (Chưa chọn sản phẩm)
                              </span>
                            )}
                          </div>
                        </td>

                        <td className="px-2.5 py-2">
                          <input
                            type="number"
                            min={1}
                            step="any"
                            value={item.qtyPo}
                            onChange={(e) =>
                              handleUpdateLineItem(item.id, {
                                qtyPo: Math.max(1, Number(e.target.value) || 1),
                              })
                            }
                            className="font-mono-num h-8 w-full rounded border border-slate-300 px-2 text-center font-bold text-emerald-700 text-xs focus:border-blue-500 focus:outline-none"
                          />
                        </td>

                        <td className="px-2.5 py-2">
                          <input
                            type="date"
                            value={item.dueDate || newDueDate}
                            onChange={(e) => handleUpdateLineItem(item.id, { dueDate: e.target.value })}
                            className="font-mono-num h-8 w-full rounded border border-slate-300 px-2 text-xs text-slate-800 focus:border-blue-500 focus:outline-none"
                          />
                        </td>

                        <td className="px-2.5 py-2">
                          <input
                            type="text"
                            value={item.materialLot || newMaterialLot}
                            onChange={(e) => handleUpdateLineItem(item.id, { materialLot: e.target.value })}
                            placeholder={newMaterialLot}
                            className="font-mono-num h-8 w-full rounded border border-slate-300 px-2 text-xs text-slate-700 focus:border-blue-500 focus:outline-none"
                          />
                        </td>

                        <td className="px-2.5 py-2 text-center">
                          <button
                            type="button"
                            disabled={lineItems.length <= 1}
                            onClick={() => handleRemoveLineItem(item.id)}
                            className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30 disabled:pointer-events-none transition-colors"
                            title="Xóa danh mục này"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Line Items Summary Footer */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 border border-slate-200">
              <span className="text-slate-600 font-semibold">
                Đơn hàng: <strong className="text-blue-700">{lineItems.length}</strong> danh mục chi tiết
              </span>
              <span className="font-mono-num font-extrabold text-slate-900">
                Tổng SL Đặt:{' '}
                <span className="text-emerald-700 text-sm">
                  {formatNumber(lineItems.reduce((acc, it) => acc + (Number(it.qtyPo) || 0), 0))}
                </span>{' '}
                SP
              </span>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Hủy
            </Button>
            <Button type="submit" variant="primary" disabled={creatingPo}>
              <QrCode className="h-4 w-4" />
              {creatingPo
                ? 'Đang tạo các đơn hàng...'
                : `Lưu Lệnh PO (${lineItems.length} Danh Mục)`}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ==================== MODAL: EXCEL IMPORT PREVIEW ==================== */}
      <Modal
        open={importPreviewOpen}
        onClose={() => setImportPreviewOpen(false)}
        title={`📥 Xem Trước Nạp Đơn Hàng PO Từ Excel (${importRows.length} Danh Mục)`}
        subtitle={`Tệp nguồn: ${importFileName} — Kiểm tra lại trước khi ghi vào hệ thống`}
        maxWidthClass="max-w-4xl"
      >
        <div className="space-y-4 text-xs">
          <div className="max-h-[420px] overflow-auto border border-slate-200 rounded-lg">
            <table className="w-full min-w-[800px] border-collapse text-left text-xs">
              <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-600">
                <tr>
                  <th className="px-3 py-2 w-10 text-center">STT</th>
                  <th className="px-3 py-2">Mã PO / Lệnh SX</th>
                  <th className="px-3 py-2">Khách Hàng</th>
                  <th className="px-3 py-2">Sản Phẩm / Bản Vẽ</th>
                  <th className="px-3 py-2 text-center">SL Đặt</th>
                  <th className="px-3 py-2">Hạn Giao</th>
                  <th className="px-3 py-2">Lô Phôi Đầu Vào</th>
                  <th className="px-3 py-2">Ghi Chú</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {importRows.map((r, idx) => (
                  <tr key={idx} className="hover:bg-slate-50 transition-colors">
                    <td className="px-3 py-2 text-center font-bold text-slate-400">{idx + 1}</td>
                    <td className="px-3 py-2 font-mono-num font-bold text-blue-700">{r.poId}</td>
                    <td className="px-3 py-2 font-semibold text-slate-800">{r.customer}</td>
                    <td className="px-3 py-2 font-bold text-slate-900">{r.productName}</td>
                    <td className="px-3 py-2 font-mono-num font-extrabold text-emerald-700 text-center">
                      {formatNumber(r.qtyPo)}
                    </td>
                    <td className="px-3 py-2 font-mono-num text-slate-600">{r.dueDate}</td>
                    <td className="px-3 py-2 font-mono-num text-slate-600">{r.materialLot || '—'}</td>
                    <td className="px-3 py-2 text-slate-500 truncate max-w-xs">{r.note || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3">
            <div className="font-semibold text-slate-700">
              Tổng số lượng đặt trong file Excel:{' '}
              <strong className="text-emerald-700 font-mono-num text-sm">
                {formatNumber(importRows.reduce((sum, r) => sum + (Number(r.qtyPo) || 0), 0))}
              </strong>{' '}
              sản phẩm
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setImportPreviewOpen(false)}>
                Hủy
              </Button>
              <Button
                variant="primary"
                disabled={importingBusy}
                onClick={() => void handleConfirmImport()}
              >
                <FileSpreadsheet className="h-4 w-4" />
                {importingBusy
                  ? 'Đang nạp vào hệ thống...'
                  : `Xác Nhận Nạp ${importRows.length} Đơn Hàng PO`}
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      {/* ==================== MODAL: DELIVERY & SHIPMENT HISTORY ==================== */}
      <Modal
        open={Boolean(deliverTargetPo)}
        onClose={() => setDeliverTargetPo(null)}
        title={`🚚 Xuất Kho Giao Hàng: ${deliverTargetPo?.poId || ''}`}
        subtitle={
          deliverTargetPo
            ? `${deliverTargetPo.customer} — ${deliverTargetPo.productName}`
            : ''
        }
        maxWidthClass="max-w-xl"
      >
        {deliverTargetPo && (
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-4 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-center">
              <div>
                <div className="text-[11px] font-medium text-slate-500">SL Đặt PO</div>
                <div className="font-mono-num text-base font-extrabold text-slate-900">
                  {deliverTargetPo.qtyPo}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-medium text-slate-500">Xong CK (End)</div>
                <div className="font-mono-num text-base font-extrabold text-emerald-700">
                  {deliverTargetPo.finishedQty}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-medium text-slate-500">Đã Xuất Giao</div>
                <div className="font-mono-num text-base font-extrabold text-blue-700">
                  {deliverTargetPo.deliveredQty}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-medium text-slate-500">Còn Nợ Khách</div>
                <div className="font-mono-num text-base font-extrabold text-rose-700">
                  {deliverTargetPo.remainQty}
                </div>
              </div>
            </div>

            {deliverQty > deliverTargetPo.stockQty && deliverTargetPo.stockQty >= 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <span>
                  Lưu ý: SL xuất giao ({deliverQty}) lớn hơn Tồn kho thành phẩm hiện ghi nhận ở công
                  đoạn cuối ({deliverTargetPo.stockQty} SP). Vẫn cho phép xuất nếu lấy từ tồn đầu kỳ.
                </span>
              </div>
            )}

            <form noValidate onSubmit={handleRecordDelivery} className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block font-bold uppercase text-slate-700">
                    SL Giao Đợt Này (*)
                  </label>
                  <input
                    type="number"
                    min={1}
                    step="any"
                    required
                    value={deliverQty}
                    onChange={(e) => setDeliverQty(Math.max(1, Number(e.target.value) || 1))}
                    className="font-mono-num h-10 w-full rounded-xl border border-emerald-400 bg-white px-3 text-base font-extrabold text-emerald-700 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/15"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block font-bold uppercase text-slate-700">
                    Số Phiếu Xuất / Biển Số Xe / Ghi Chú
                  </label>
                  <input
                    type="text"
                    value={deliverNote}
                    onChange={(e) => setDeliverNote(e.target.value)}
                    placeholder="VD: PXK-2610-09, Xe 15C-123.45 nhận hàng..."
                    className={modalInputCls}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setDeliverTargetPo(null)}>
                  Đóng
                </Button>
                <Button type="submit" variant="success" disabled={submittingDelivery}>
                  <CheckCircle2 className="h-4 w-4" />
                  {submittingDelivery ? 'Đang ghi sổ kho...' : 'Xác Nhận Xuất Giao Kho'}
                </Button>
              </div>
            </form>

            {/* Delivery History for this PO */}
            <div className="border-t border-slate-200 pt-3">
              <div className="mb-2 font-bold uppercase tracking-wider text-slate-600">
                📜 Lịch Sử Các Đợt Đã Xuất Giao ({targetPoDeliveries.length} đợt)
              </div>
              {targetPoDeliveries.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/60 p-3 text-center text-slate-500">
                  Chưa có đợt giao hàng nào được ghi nhận cho đơn {deliverTargetPo.poId}.
                </div>
              ) : (
                <div className="max-h-44 overflow-y-auto rounded-lg border border-slate-200 bg-white">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold text-slate-600">
                      <tr>
                        <th className="px-2.5 py-1.5">Thời gian xuất</th>
                        <th className="px-2.5 py-1.5 text-center">SL Giao</th>
                        <th className="px-2.5 py-1.5">Người xuất</th>
                        <th className="px-2.5 py-1.5">Ghi chú</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {targetPoDeliveries.map((d) => (
                        <tr key={d.id}>
                          <td className="font-mono-num px-2.5 py-1.5 text-slate-600">
                            {d.deliveredAt}
                          </td>
                          <td className="font-mono-num px-2.5 py-1.5 text-center font-bold text-emerald-700">
                            +{d.qtyDeliver}
                          </td>
                          <td className="px-2.5 py-1.5 font-medium text-slate-800">
                            {d.deliveredBy}
                          </td>
                          <td className="px-2.5 py-1.5 text-slate-500">{d.note || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* ==================== MODAL: EDIT PO ==================== */}
      <Modal
        open={Boolean(editTargetPo)}
        onClose={() => setEditTargetPo(null)}
        title={`✏️ Chỉnh Sửa Lệnh PO: ${editTargetPo?.poId || ''}`}
        subtitle={editTargetPo?.productName}
        maxWidthClass="max-w-lg"
      >
        <form noValidate onSubmit={handleSaveEditPo} className="space-y-3.5 text-xs">
          {/* Card: Bổ sung sản lượng đã gia công hoàn thành trước đó */}
          <div className="rounded-xl border border-emerald-300 bg-emerald-50/70 p-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-black uppercase text-emerald-900 flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <span>Bổ Sung Tiến Độ &amp; SL Đã Gia Công Xong Trước Đó</span>
              </span>
              <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded">
                Bổ sung nhanh
              </span>
            </div>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              <div>
                <label className="mb-1 block font-bold uppercase text-emerald-800 text-[10px]">
                  Đã Xong Trước Đó (Xong CK)
                </label>
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={editFinishedQty}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => setEditFinishedQty(Math.max(0, Number(e.target.value) || 0))}
                  className={`${modalInputCls} font-mono-num font-black text-emerald-700`}
                />
              </div>

              <div>
                <label className="mb-1 block font-bold uppercase text-amber-800 text-[10px]">
                  Đang Dở Dang (WIP)
                </label>
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={editWipQty}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => setEditWipQty(Math.max(0, Number(e.target.value) || 0))}
                  className={`${modalInputCls} font-mono-num font-bold text-amber-800`}
                />
              </div>

              <div>
                <label className="mb-1 block font-bold uppercase text-blue-800 text-[10px]">
                  Đã Xuất Giao Kho
                </label>
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={editDeliveredQty}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => setEditDeliveredQty(Math.max(0, Number(e.target.value) || 0))}
                  className={`${modalInputCls} font-mono-num font-bold text-blue-800`}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] font-semibold text-slate-700 border-t border-emerald-200/80 pt-2">
              <div>
                Tiến độ: <strong className="font-mono-num text-emerald-800">{editFinishedQty}</strong> / {editQtyPo} SP ({Math.min(100, Math.round((editFinishedQty / editQtyPo) * 100))}%)
              </div>
              <div>
                Tồn kho TP (Chờ giao):{' '}
                <strong className={`font-mono-num ${Math.max(0, editFinishedQty - editDeliveredQty) > 0 ? 'text-blue-700 font-black' : 'text-slate-600'}`}>
                  {Math.max(0, editFinishedQty - editDeliveredQty)} SP
                </strong>
                <span className="block text-[9.5px] text-slate-500 font-normal leading-tight">(= Xong CK − Đã giao)</span>
              </div>
              <div>
                Còn nợ giao:{' '}
                <strong className="font-mono-num text-amber-800">
                  {Math.max(0, editQtyPo - editDeliveredQty)} SP
                </strong>
                {editFinishedQty >= editQtyPo && (
                  <span className="ml-1.5 inline-flex items-center gap-1 rounded bg-emerald-600 px-1 py-0.2 text-[9.5px] font-black text-white">
                    ✓ Đủ SL đặt
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block font-bold uppercase text-slate-700">SL Đặt PO</label>
              <input
                type="number"
                min={1}
                step="any"
                value={editQtyPo}
                onFocus={(e) => e.target.select()}
                onChange={(e) => setEditQtyPo(Math.max(1, Number(e.target.value) || 1))}
                className={`${modalInputCls} font-mono-num font-bold`}
              />
            </div>
            <div>
              <label className="mb-1 block font-bold uppercase text-slate-700">Hạn Giao</label>
              <input
                type="date"
                value={editDueDate}
                onChange={(e) => setEditDueDate(e.target.value)}
                className={`${modalInputCls} font-mono-num`}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block font-bold uppercase text-slate-700">Mã Lô Phôi</label>
              <input
                type="text"
                value={editMaterialLot}
                onChange={(e) => setEditMaterialLot(e.target.value)}
                className={`${modalInputCls} font-mono-num`}
              />
            </div>
            <div>
              <label className="mb-1 block font-bold uppercase text-slate-700">
                Nhà Cung Cấp Phôi
              </label>
              <input
                type="text"
                value={editSupplierName}
                onChange={(e) => setEditSupplierName(e.target.value)}
                className={modalInputCls}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block font-bold uppercase text-slate-700">Độ ưu tiên</label>
              <select
                value={editPriority}
                onChange={(e) => setEditPriority(Number(e.target.value))}
                className={modalInputCls}
              >
                <option value={1}>1 — Khẩn cấp (VIP)</option>
                <option value={2}>2 — Bình thường</option>
                <option value={3}>3 — Dự trữ tồn kho</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="mb-1 block font-bold uppercase text-slate-700">Ghi chú</label>
              <input
                type="text"
                value={editNote}
                onChange={(e) => setEditNote(e.target.value)}
                className={modalInputCls}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setEditTargetPo(null)}>
              Hủy
            </Button>
            <Button type="submit" variant="primary" disabled={savingEdit}>
              {savingEdit ? 'Đang lưu...' : 'Lưu Thay Đổi'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
