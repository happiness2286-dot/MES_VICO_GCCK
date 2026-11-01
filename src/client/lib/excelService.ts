import type ExcelJS from 'exceljs';
import type {
  DailyPlanRow,
  DailyQualityReportData,
  EmployeeAttSummary,
  Payroll3PRow,
  ProductCostingSummary,
  ProductionLogDto,
} from '@shared/types';
import { normalizeVn } from '@shared/vnSearch';

async function createExcelWorkbook(): Promise<ExcelJS.Workbook> {
  const mod = await import('exceljs');
  const Lib = ((mod as any).default || mod) as typeof ExcelJS;
  return new Lib.Workbook();
}

export interface MasterPurchaseOrderImportRow {
  poId: string;
  customer: string;
  productName: string;
  qtyPo: number;
  dueDate: string;
  materialLot?: string;
  supplierName?: string;
  castDate?: string;
  note?: string;
}

export interface MasterOperationImportRow {
  customer: string;
  productName: string;
  opName: string;
  stdSeconds: number;
  stage: string;
  defaultMachine: string;
  toolCode: string;
}

/**
 * Neutralizes CSV/Excel Formula Injection on untrusted strings starting with '=', '@',
 * or '+/-' followed by letters (e.g. +SUM, -HYPERLINK), while keeping valid shopfloor
 * attendance codes like '+2', '-1.5', 'C2+2', 'C2/2-0.75' as pure string text.
 */
export function sanitizeForExcel(value: unknown): string | number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (value === null || value === undefined) {
    return '';
  }
  const s = String(value);
  if (!s) return '';
  if (/^\s*[=@]/.test(s) || /^\s*[+-]\s*[a-zA-Z]/.test(s)) {
    return `'${s}`;
  }
  return s;
}

function toExactArrayBuffer(input: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (input instanceof Uint8Array) {
    const copy = new Uint8Array(input.byteLength);
    copy.set(input);
    return copy.buffer;
  }
  return input;
}

async function workbookToBytes(wb: ExcelJS.Workbook): Promise<Uint8Array> {
  const raw: unknown = await wb.xlsx.writeBuffer();
  if (raw instanceof Uint8Array) {
    return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  }
  return new Uint8Array(raw as ArrayBuffer);
}

function appendSafeRow(
  ws: ExcelJS.Worksheet,
  values: Array<string | number | null | undefined>,
  options: { isHeader?: boolean; forceAllTextFromCol?: number } = {}
): ExcelJS.Row {
  const row = ws.addRow([]);
  values.forEach((raw, idx) => {
    const colNum = idx + 1;
    const cell = row.getCell(colNum);
    const forceText =
      options.forceAllTextFromCol !== undefined && colNum >= options.forceAllTextFromCol;

    if (forceText) {
      const strVal = sanitizeForExcel(raw === null || raw === undefined ? '' : String(raw));
      cell.value = String(strVal);
      cell.numFmt = '@';
    } else {
      const safeVal = sanitizeForExcel(raw);
      cell.value = safeVal;
      if (typeof safeVal === 'string') {
        cell.numFmt = '@';
      }
    }

    if (options.isHeader) {
      cell.font = { bold: true, color: { argb: 'FFF8FAFC' }, size: 10 };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF0F172A' },
      };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF334155' } },
        left: { style: 'thin', color: { argb: 'FF334155' } },
        bottom: { style: 'thin', color: { argb: 'FF38BDF8' } },
        right: { style: 'thin', color: { argb: 'FF334155' } },
      };
    }
  });
  if (options.isHeader) {
    row.height = 26;
  }
  return row;
}

function autoFitColumns(ws: ExcelJS.Worksheet, minWidth = 10, maxWidth = 42): void {
  ws.columns.forEach((col) => {
    let best = minWidth;
    col.eachCell?.({ includeEmpty: false }, (cell) => {
      const len = String(cell.value ?? '').length;
      if (len + 3 > best) best = Math.min(maxWidth, len + 3);
    });
    col.width = best;
  });
}

// ==================== 1. ATTENDANCE 4-SHEET WORKBOOK ====================
export async function buildAttendanceWorkbook(params: {
  yearMonth: string;
  dows: string[];
  employees: EmployeeAttSummary[];
}): Promise<Uint8Array> {
  const wb = await createExcelWorkbook();
  wb.creator = 'GCCK Thắng Lợi Lean MES';
  wb.created = new Date();

  const dayHeaders = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0'));
  const dows31 = Array.from({ length: 31 }, (_, i) => params.dows[i] || '-');

  // Sheet 1: 1_BANG_NHAP_THANG (36 columns)
  const ws1 = wb.addWorksheet('1_BANG_NHAP_THANG', {
    views: [{ state: 'frozen', xSplit: 3, ySplit: 2 }],
  });
  appendSafeRow(
    ws1,
    ['STT', 'Mã NV', 'Nhân viên', 'Loại công', 'Ca mặc định', ...dayHeaders],
    { isHeader: true }
  );
  appendSafeRow(ws1, ['', '', '', '', '', ...dows31], {
    isHeader: true,
    forceAllTextFromCol: 6,
  });

  params.employees.forEach((emp, i) => {
    const days31 = Array.from({ length: 31 }, (_, d) => emp.days?.[d] ?? '');
    appendSafeRow(
      ws1,
      [
        i + 1,
        emp.empId,
        emp.name,
        emp.workType || 'Công',
        emp.defaultShift || 'Ca 1',
        ...days31,
      ],
      { forceAllTextFromCol: 6 }
    );
  });
  autoFitColumns(ws1, 6, 28);

  // Sheet 2: 2_TONG_HOP_CONG_TC (16 columns)
  const ws2 = wb.addWorksheet('2_TONG_HOP_CONG_TC', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  appendSafeRow(
    ws2,
    [
      'STT',
      'Mã nhân viên',
      'Tên nhân viên',
      'Nhận diện thông minh & Cảnh báo',
      'Số giờ hưởng 100% lương',
      'Số công tính AB',
      'A,B',
      'Công thường',
      'Công ca 3',
      'TC x1.5',
      'TC x2',
      'TC x3',
      'Phụ cấp ăn ca',
      'Tổng nghỉ',
      'Muộn/sớm',
      'Ô lỗi',
    ],
    { isHeader: true }
  );
  params.employees.forEach((emp, i) => {
    appendSafeRow(ws2, [
      i + 1,
      emp.empId,
      emp.name,
      emp.badgeText || '',
      emp.hours100,
      emp.abDays,
      emp.grade,
      emp.regDays,
      emp.s3Days,
      emp.ot15,
      emp.ot20,
      emp.ot30,
      emp.mealTotal,
      emp.offDays,
      emp.lateHours,
      emp.errCount,
    ]);
  });
  autoFitColumns(ws2, 10, 38);

  // Sheet 3: 3_PHU_CAP_AN_CA (35 columns)
  const ws3 = wb.addWorksheet('3_PHU_CAP_AN_CA', {
    views: [{ state: 'frozen', xSplit: 3, ySplit: 1 }],
  });
  appendSafeRow(
    ws3,
    ['STT', 'Mã nhân viên', 'Tên nhân viên', ...dayHeaders, 'Tổng Phụ Cấp Ăn Ca'],
    { isHeader: true }
  );
  params.employees.forEach((emp, i) => {
    const meals31 = Array.from({ length: 31 }, (_, d) => Number(emp.dailyMeals?.[d] ?? 0));
    appendSafeRow(ws3, [i + 1, emp.empId, emp.name, ...meals31, emp.mealTotal]);
  });
  autoFitColumns(ws3, 8, 28);

  // Sheet 4: 4_TONG_HOP_NAM_12T (24 columns)
  const ws4 = wb.addWorksheet('4_TONG_HOP_NAM_12T', {
    views: [{ state: 'frozen', xSplit: 3, ySplit: 1 }],
  });
  appendSafeRow(
    ws4,
    [
      'STT',
      'Mã NV',
      'Tên nhân viên',
      'Ca mặc định',
      'T1',
      'T2',
      'T3',
      'T4',
      'T5',
      'T6',
      'T7',
      'T8',
      'T9',
      'T10',
      'T11',
      'T12',
      'Tổng Công Thường Năm',
      'Tổng Giờ Tăng Ca Năm (h)',
      'Quỹ Phép Năm (12 ngày)',
      'Đã Nghỉ Phép Thực Tế (P)',
      'Phép Còn Lại',
      'Tổng Nghỉ KP Thực Tế',
      'Tổng Giờ Muộn/Sớm Thực Tế',
      'Xếp Loại & Nhận Diện',
    ],
    { isHeader: true }
  );
  params.employees.forEach((emp, i) => {
    const yr = emp.yearly;
    const months12 = Array.from({ length: 12 }, (_, m) => Number(yr?.months?.[m] ?? 0));
    appendSafeRow(ws4, [
      i + 1,
      emp.empId,
      emp.name,
      emp.defaultShift || 'Ca 1',
      ...months12,
      yr?.totalYearDays ?? emp.regDays,
      yr?.totalYearOt ?? emp.totalOt,
      yr?.annualLeaveQuota ?? 12,
      yr?.usedLeaveDays ?? emp.pDays,
      yr?.remainingLeaveDays ?? Math.max(0, 12 - emp.pDays),
      emp.kpDays,
      emp.lateHours,
      yr?.yearRank || 'Đạt Chuẩn A',
    ]);
  });
  autoFitColumns(ws4, 8, 34);

  return workbookToBytes(wb);
}

// ==================== 2. COSTING & PNL 19-COLUMN WORKBOOK ====================
export async function buildCostingPnlWorkbook(
  items: ProductCostingSummary[]
): Promise<Uint8Array> {
  const wb = await createExcelWorkbook();
  wb.creator = 'GCCK Thắng Lợi Lean MES';
  const ws = wb.addWorksheet('BAO_GIA_LO_LAI_SP', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  appendSafeRow(
    ws,
    [
      'Mã SP',
      'Khách Hàng',
      'Tên Thành Phẩm Cuối Cùng',
      'Số NC',
      'Quy Trình Công Nghệ',
      'Tổng Giây ĐM (s)',
      'Tổng Giờ ĐM (h)',
      'Chi Phí Nhân Công ĐM',
      'Chi Phí Máy ĐM',
      'Chi Phí Dao Cụ ĐM',
      'Quản Lý 10% + Phôi & GCN',
      'TỔNG GIÁ VỐN ĐM / 1 SP',
      'ĐƠN GIÁ BÁO GIÁ KHÁCH / 1 SP',
      'SL Đã SX',
      'GIÁ THÀNH THỰC TẾ / 1 SP',
      'LÃI / LỖ TRÊN 1 SP',
      'TỔNG LÃI / LỖ CẢ LÔ',
      '% BIÊN LỢI NHUẬN',
      'KẾT LUẬN',
    ],
    { isHeader: true }
  );

  items.forEach((c) => {
    const status =
      c.unitProfit < 0
        ? 'CẢNH BÁO LỖ'
        : c.marginPct < 10
          ? 'LÃI MỎNG (<10%)'
          : 'LÃI TỐT';
    const overheadPlusMat =
      (Number(c.stdOverhead) || 0) +
      (Number(c.rawMaterialCost) || 0) +
      (Number(c.outsourceCost) || 0);

    appendSafeRow(ws, [
      c.spId,
      c.customer,
      c.productName,
      c.opCount,
      c.opsSummary,
      c.totalSec,
      c.totalHours,
      c.stdLabor,
      c.stdMach,
      c.stdTool,
      overheadPlusMat,
      c.totalStdCost,
      c.quotedPrice,
      c.finishedQty,
      c.actualUnitCost,
      c.unitProfit,
      c.totalBatchProfit,
      `${c.marginPct}%`,
      status,
    ]);
  });

  autoFitColumns(ws, 11, 44);
  return workbookToBytes(wb);
}

// ==================== 3. DAILY LOGS 17-COLUMN WORKBOOK ====================
export async function buildDailyLogsWorkbook(
  logs: ProductionLogDto[]
): Promise<Uint8Array> {
  const wb = await createExcelWorkbook();
  wb.creator = 'GCCK Thắng Lợi Lean MES';
  const ws = wb.addWorksheet('NHAT_KY_SAN_LUONG', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  appendSafeRow(
    ws,
    [
      'Thời gian',
      'Ngày làm',
      'Ca',
      'Mã NV',
      'Họ tên',
      'Máy',
      'Khách hàng',
      'Sản phẩm',
      'Mã NC',
      'Nguyên công',
      'SL OK',
      'SL Rework',
      'SL Hủy',
      'Phút dừng',
      'Lương ca (VNĐ)',
      'Đánh giá KPI',
      'Ghi chú',
    ],
    { isHeader: true }
  );

  logs.forEach((l) => {
    appendSafeRow(ws, [
      l.timeStr,
      l.workDate,
      l.shiftType,
      l.workerId,
      l.workerName,
      l.machineName,
      l.customer,
      l.productName,
      l.ncId,
      l.opName,
      l.okQty,
      l.reworkQty,
      l.scrapQty,
      l.stopMinutes,
      l.income,
      l.kpiStatus,
      l.note,
    ]);
  });

  autoFitColumns(ws, 10, 42);
  return workbookToBytes(wb);
}

// ==================== DAILY PRODUCTION SCHEDULE WORKBOOK (FORM VICO QT.01.BM01) ====================
export async function buildDailyScheduleWorkbook(
  workDate: string,
  rows: DailyPlanRow[]
): Promise<Uint8Array> {
  const wb = await createExcelWorkbook();
  wb.creator = 'GCCK Thắng Lợi Lean MES';
  const ws = wb.addWorksheet('KE_HOACH_NGAY', {
    views: [{ state: 'frozen', ySplit: 4 }],
  });

  // Title rows
  const [y, m, d] = workDate.split('-');
  const displayDate = d && m && y ? `${d}/${m}/${y}` : workDate;

  const r1 = ws.addRow(['CÔNG TY CỔ PHẦN CƠ KHÍ CHÍNH XÁC THẮNG LỢI (VICO)']);
  r1.font = { bold: true, size: 12, color: { argb: 'FF1E3A8A' } };

  const r2 = ws.addRow([`KẾ HOẠCH SẢN XUẤT NGÀY ${displayDate} (FORM VICO GCCK.QT.01.BM01)`]);
  r2.font = { bold: true, size: 13, color: { argb: 'FF0F172A' } };

  ws.addRow([]); // Blank spacer

  appendSafeRow(
    ws,
    [
      'STT',
      'Ca Làm Việc',
      'Người Thực Hiện (Thợ)',
      'Khách Hàng',
      'Tên Sản Phẩm / Bản Vẽ',
      'Công Đoạn / Nguyên Công',
      'Số Lượng Kế Hoạch',
      'Máy Thực Hiện',
      'Số Lượng Thực Tế',
      'Ghi Chú',
    ],
    { isHeader: true }
  );

  let stt = 1;
  rows.forEach((r) => {
    appendSafeRow(ws, [
      r.stt || stt++,
      r.shiftType || 'Ca 2',
      r.workerName,
      r.customer,
      r.productName,
      r.opName,
      r.plannedQty || 0,
      r.machineName,
      r.actualQty || 0,
      r.note || '',
    ]);
  });

  const totalPlanned = rows.reduce((sum, r) => sum + Number(r.plannedQty || 0), 0);
  const totalActual = rows.reduce((sum, r) => sum + Number(r.actualQty || 0), 0);

  const sumRow = appendSafeRow(ws, [
    'TỔNG CỘNG',
    '',
    '',
    '',
    '',
    '',
    totalPlanned,
    '',
    totalActual,
    '',
  ]);
  sumRow.font = { bold: true };
  sumRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFF1F5F9' },
  };

  autoFitColumns(ws, 8, 38);
  return workbookToBytes(wb);
}

// ==================== 4. MASTER OPERATIONS 7-COL TEMPLATE & PARSER ====================
export async function buildOperationsTemplateWorkbook(): Promise<Uint8Array> {
  const wb = await createExcelWorkbook();
  wb.creator = 'GCCK Thắng Lợi Lean MES';
  const ws = wb.addWorksheet('MAU_NAP_NGUYEN_CONG', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  appendSafeRow(
    ws,
    [
      'KhachHang',
      'TenSanPham',
      'TenNguyenCong',
      'DinhMucGiay',
      'BuocCongDoan',
      'MayMacDinh',
      'MaDaoCu',
    ],
    { isHeader: true }
  );

  appendSafeRow(ws, [
    'Vico - QLTB',
    'Bích thép D320 mẫu',
    'NC1: Tiện thô 2 mặt',
    2700,
    '1',
    'Máy Tiện CNC 1',
    'T01',
  ]);
  appendSafeRow(ws, [
    'Vico - QLTB',
    'Bích thép D320 mẫu',
    'NC2: Khoan 8 lỗ M16',
    1800,
    'End',
    'Máy Phay CNC 1',
    'DR14',
  ]);

  autoFitColumns(ws, 14, 38);
  return workbookToBytes(wb);
}

function cellValueToCleanString(val: ExcelJS.CellValue): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'object') {
    if ('text' in val && typeof val.text === 'string') return normalizeVn(val.text);
    if ('richText' in val && Array.isArray(val.richText)) {
      return normalizeVn(val.richText.map((r) => r.text).join(''));
    }
    if ('result' in val && val.result !== undefined) return normalizeVn(String(val.result));
  }
  const s = normalizeVn(String(val));
  return s.startsWith("'") && s.length > 1 && /^[=@+-]/.test(s.slice(1)) ? s.slice(1) : s;
}

export async function parseOperationsWorkbookBuffer(
  buffer: ArrayBuffer | Uint8Array
): Promise<MasterOperationImportRow[]> {
  const wb = await createExcelWorkbook();
  await wb.xlsx.load(toExactArrayBuffer(buffer));
  const ws = wb.worksheets[0];
  if (!ws) {
    throw new Error('File Excel không có sheet dữ liệu.');
  }

  const headers: string[] = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber] = cellValueToCleanString(cell.value);
  });

  const rows: MasterOperationImportRow[] = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const obj: Record<string, string> = {};
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const key = headers[colNumber] || `col_${colNumber}`;
      const cleaned = cellValueToCleanString(cell.value);
      obj[key] = cleaned;
      obj[`col_${colNumber}`] = cleaned;
    });

    const productName =
      obj.TenSanPham ||
      obj['Tên Sản Phẩm'] ||
      obj['Tên sản phẩm'] ||
      obj.Product ||
      obj.col_2 ||
      '';
    if (!productName) return;

    const customer =
      obj.KhachHang ||
      obj['Khách hàng'] ||
      obj['Khách Hàng'] ||
      obj.Customer ||
      obj.col_1 ||
      'Vico - Nội bộ / Khách lẻ';

    const opName =
      obj.TenNguyenCong ||
      obj['Tên Nguyên Công'] ||
      obj['Tên nguyên công'] ||
      obj.Operation ||
      obj.col_3 ||
      'Gia công';

    const rawSec =
      obj.DinhMucGiay ||
      obj['Định mức giây (s)'] ||
      obj['Định mức giây'] ||
      obj.Seconds ||
      obj.col_4 ||
      '1800';
    const stdSeconds = Math.max(60, Math.round(Number(rawSec) || 1800));

    const stage =
      obj.BuocCongDoan || obj['Bước'] || obj['Bước công đoạn'] || obj.col_5 || 'End';

    const defaultMachine =
      obj.MayMacDinh ||
      obj['Máy mặc định'] ||
      obj.Machine ||
      obj.col_6 ||
      'Máy Tiện CNC 1';

    const toolCode =
      obj.MaDaoCu || obj['Mã Dao'] || obj['Mã dao cụ'] || obj.col_7 || 'T01';

    rows.push({
      customer,
      productName,
      opName,
      stdSeconds,
      stage,
      defaultMachine,
      toolCode,
    });
  });

  return rows;
}

// ==================== 5. 3P MONTHLY PAYROLL WORKBOOK ====================
export async function buildPayroll3PWorkbook(
  yearMonth: string,
  rows: Payroll3PRow[]
): Promise<Uint8Array> {
  const wb = await createExcelWorkbook();
  wb.creator = 'GCCK Thắng Lợi Lean MES';
  const ws = wb.addWorksheet(`LUONG_3P_${yearMonth.replace('-', '_')}`, {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  appendSafeRow(
    ws,
    [
      'STT',
      'Mã NV',
      'Họ & Tên',
      'Chức danh',
      'Chế độ lương',
      'Lương CB 8h',
      'Công thường',
      'Giờ 100%',
      'Tổng OT (h)',
      'Xếp loại',
      'Giờ ĐM Sản phẩm (h)',
      'P1: Lương Vị trí / Phép',
      'P2: Thưởng Chuyên cần A/B',
      'P3: Lương Khoán / Vượt ĐM',
      'Phụ cấp Ăn ca',
      'Khấu trừ NG',
      'THỰC LĨNH CUỐI THÁNG',
      'Ghi chú diễn giải',
    ],
    { isHeader: true }
  );

  rows.forEach((r, idx) => {
    appendSafeRow(ws, [
      idx + 1,
      r.workerId,
      r.name,
      r.title,
      r.salaryMode,
      r.baseSalary,
      r.regDays,
      r.hours100,
      r.totalOt,
      r.grade,
      r.earnedStdHours,
      r.p1PositionPay,
      r.p2PersonBonus,
      r.p3PerformancePay,
      r.mealAllowance,
      r.scrapPenalty,
      r.netPay,
      r.note,
    ]);
  });

  autoFitColumns(ws, 10, 42);
  return workbookToBytes(wb);
}

// ==================== BROWSER DOWNLOAD & FILE HELPERS ====================
export function downloadWorkbookBytes(bytes: Uint8Array, filename: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy.buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function downloadAttendanceExcel(params: {
  yearMonth: string;
  dows: string[];
  employees: EmployeeAttSummary[];
}): Promise<void> {
  const bytes = await buildAttendanceWorkbook(params);
  downloadWorkbookBytes(
    bytes,
    `GCCK_ThangLoi_ChamCong_4Bang_${params.yearMonth}.xlsx`
  );
}

export async function downloadCostingPnlExcel(
  items: ProductCostingSummary[]
): Promise<void> {
  const bytes = await buildCostingPnlWorkbook(items);
  downloadWorkbookBytes(bytes, 'GCCK_ThangLoi_BaoGia_DoiSoat_LoLai_19Cot.xlsx');
}

export async function downloadDailyLogsExcel(
  logs: ProductionLogDto[],
  dateSuffix = ''
): Promise<void> {
  const bytes = await buildDailyLogsWorkbook(logs);
  const suffix = dateSuffix ? `_${dateSuffix}` : '';
  downloadWorkbookBytes(bytes, `GCCK_ThangLoi_BaoCao_SanLuong_17Cot${suffix}.xlsx`);
}

export async function downloadDailyScheduleExcel(
  workDate: string,
  rows: DailyPlanRow[]
): Promise<void> {
  const bytes = await buildDailyScheduleWorkbook(workDate, rows);
  downloadWorkbookBytes(
    bytes,
    `GCCK_ThangLoi_KeHoach_Ngay_${workDate}_VICO_BM01.xlsx`
  );
}


export async function buildPurchaseOrdersTemplateWorkbook(): Promise<Uint8Array> {
  const wb = await createExcelWorkbook();
  wb.creator = 'GCCK Thắng Lợi Lean MES';
  const ws = wb.addWorksheet('DON_HANG_PO_MAU', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  appendSafeRow(
    ws,
    [
      'Mã Đơn Hàng / Lệnh PO (*)',
      'Khách Hàng (*)',
      'Tên Sản Phẩm / Chi Tiết Bản Vẽ (*)',
      'Số Lượng Đặt Hàng (*)',
      'Hạn Giao Hàng (dd/mm/yyyy)',
      'Mã Lô Phôi Đầu Vào',
      'Nhà Cung Cấp Phôi',
      'Ngày Nhập / Đúc Phôi',
      'Ghi Chú Đơn Hàng',
    ],
    { isHeader: true }
  );

  // Sample data demonstrating multiple line items in 1 PO
  const sampleItems = [
    ['P02610-190-01', 'BOZ Industrial', 'CI-AU-Pan Dead Plate', 20, '15/11/2026', 'LOT-VICO-261101-190', 'Xưởng Đúc VICO Thắng Lợi', '01/11/2026', 'Mặt đáy mài bóng Ra 1.6'],
    ['P02610-190-02', 'BOZ Industrial', 'CI-AU-Side Guide Plate', 15, '15/11/2026', 'LOT-VICO-261101-190', 'Xưởng Đúc VICO Thắng Lợi', '01/11/2026', 'Phay tinh 4 cạnh'],
    ['P02610-190-03', 'BOZ Industrial', 'CI-AU-Roller Bushing', 40, '20/11/2026', 'LOT-VICO-261101-190', 'Xưởng Đúc VICO Thắng Lợi', '01/11/2026', 'Tiện tinh lỗ H7'],
    ['PO485-01', 'Win-Win - PO485', 'ALKTOP 1342 M', 90, '25/11/2026', 'LOT-2026-VC', 'Xưởng Đúc VICO Thắng Lợi', '10/10/2026', 'Đơn hàng định kỳ tháng 11'],
    ['PO485-02', 'Win-Win - PO485', 'ALKTOP 2155 H', 28, '25/11/2026', 'LOT-2026-VC', 'Xưởng Đúc VICO Thắng Lợi', '10/10/2026', 'Kiểm tra FAI 100%'],
  ];

  for (const item of sampleItems) {
    appendSafeRow(ws, item);
  }

  autoFitColumns(ws, 16, 42);
  return workbookToBytes(wb);
}

export async function downloadPurchaseOrdersTemplateExcel(): Promise<void> {
  const bytes = await buildPurchaseOrdersTemplateWorkbook();
  downloadWorkbookBytes(bytes, 'Mau_Nhap_Don_Hang_PO_GCCK.xlsx');
}

export async function parsePurchaseOrdersWorkbookBuffer(
  buffer: ArrayBuffer | Uint8Array
): Promise<MasterPurchaseOrderImportRow[]> {
  const wb = await createExcelWorkbook();
  await wb.xlsx.load(toExactArrayBuffer(buffer));
  const ws = wb.worksheets[0];
  if (!ws) {
    throw new Error('File Excel không có sheet dữ liệu.');
  }

  const headers: string[] = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber] = cellValueToCleanString(cell.value);
  });

  const rows: MasterPurchaseOrderImportRow[] = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const obj: Record<string, string> = {};
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const key = headers[colNumber] || `col_${colNumber}`;
      const cleaned = cellValueToCleanString(cell.value);
      obj[key] = cleaned;
      obj[`col_${colNumber}`] = cleaned;
    });

    const poId =
      obj['Mã Đơn Hàng / Lệnh PO (*)'] ||
      obj['Mã Đơn Hàng'] ||
      obj['Mã PO'] ||
      obj.MaPO ||
      obj.PO ||
      obj.col_1 ||
      '';

    const customer =
      obj['Khách Hàng (*)'] ||
      obj['Khách Hàng'] ||
      obj['Khách hàng'] ||
      obj.KhachHang ||
      obj.Customer ||
      obj.col_2 ||
      'Nội bộ';

    const productName =
      obj['Tên Sản Phẩm / Chi Tiết Bản Vẽ (*)'] ||
      obj['Tên Sản Phẩm'] ||
      obj['Tên sản phẩm'] ||
      obj['Sản Phẩm'] ||
      obj.TenSanPham ||
      obj.Product ||
      obj.col_3 ||
      '';

    if (!poId || !productName) return;

    const rawQty =
      obj['Số Lượng Đặt Hàng (*)'] ||
      obj['Số Lượng'] ||
      obj['Số lượng'] ||
      obj.SoLuong ||
      obj.Qty ||
      obj.col_4 ||
      '1';

    const qtyPo = Math.max(1, Math.round(Number(String(rawQty).replace(/[^0-9.]/g, '')) || 1));

    let dueDate =
      obj['Hạn Giao Hàng (dd/mm/yyyy)'] ||
      obj['Hạn Giao Hàng'] ||
      obj['Hạn giao'] ||
      obj.HanGiao ||
      obj.DueDate ||
      obj.col_5 ||
      '';

    // Normalize date format if dd/mm/yyyy
    if (dueDate.includes('/')) {
      const parts = dueDate.split('/');
      if (parts.length === 3) {
        const d = parts[0].padStart(2, '0');
        const m = parts[1].padStart(2, '0');
        const y = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
        dueDate = `${y}-${m}-${d}`;
      }
    } else if (!dueDate || dueDate.length < 8) {
      dueDate = '2026-11-30';
    }

    const materialLot =
      obj['Mã Lô Phôi Đầu Vào'] ||
      obj['Mã Lô Phôi'] ||
      obj['Lô phôi'] ||
      obj.MaLoPhoi ||
      obj.Lot ||
      obj.col_6 ||
      `LOT-VICO-${Date.now().toString().slice(-4)}`;

    const supplierName =
      obj['Nhà Cung Cấp Phôi'] ||
      obj['Nhà cung cấp'] ||
      obj.NhaCungCap ||
      obj.Supplier ||
      obj.col_7 ||
      'Xưởng Đúc VICO Thắng Lợi';

    let castDate =
      obj['Ngày Nhập / Đúc Phôi'] ||
      obj['Ngày đúc phôi'] ||
      obj['Ngày nhập'] ||
      obj.NgayDuc ||
      obj.col_8 ||
      '';

    if (castDate.includes('/')) {
      const parts = castDate.split('/');
      if (parts.length === 3) {
        const d = parts[0].padStart(2, '0');
        const m = parts[1].padStart(2, '0');
        const y = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
        castDate = `${y}-${m}-${d}`;
      }
    } else if (!castDate || castDate.length < 8) {
      castDate = '2026-11-01';
    }

    const note =
      obj['Ghi Chú Đơn Hàng'] ||
      obj['Ghi Chú'] ||
      obj['Ghi chú'] ||
      obj.GhiChu ||
      obj.Note ||
      obj.col_9 ||
      '';

    rows.push({
      poId,
      customer,
      productName,
      qtyPo,
      dueDate,
      materialLot,
      supplierName,
      castDate,
      note,
    });
  });

  return rows;
}

export async function downloadOperationsTemplateExcel(): Promise<void> {
  const bytes = await buildOperationsTemplateWorkbook();
  downloadWorkbookBytes(bytes, 'GCCK_ThangLoi_Mau_Nap_Nguyen_Cong_7Cot.xlsx');
}

export async function downloadPayroll3PExcel(
  yearMonth: string,
  rows: Payroll3PRow[]
): Promise<void> {
  const bytes = await buildPayroll3PWorkbook(yearMonth, rows);
  downloadWorkbookBytes(bytes, `GCCK_ThangLoi_BangChotLuong_KPI_3P_${yearMonth}.xlsx`);
}

// ==================== DAILY QUALITY REPORT WORKBOOK (FORM BM.KTCN.04.03) ====================
export async function buildDailyQualityReportWorkbook(
  report: DailyQualityReportData
): Promise<Uint8Array> {
  const wb = await createExcelWorkbook();
  wb.creator = 'GCCK Thắng Lợi Lean MES';
  const ws = wb.addWorksheet('BAO_CAO_NGAY', {
    pageSetup: {
      orientation: 'landscape',
      paperSize: 9, // A4
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
    },
    views: [{ state: 'frozen', ySplit: 6 }],
  });

  const [y, m, d] = report.reportDate.split('-');
  const displayDate = d && m && y ? `${d}/${m}/${y}` : report.reportDate;

  // Header top row
  const r1 = ws.addRow([
    report.companyName || 'CÔNG TY TNHH THẮNG LỢI',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    `Mã số: ${report.reportCode || 'BM.KTCN.04.03'}`,
  ]);
  r1.font = { bold: true, size: 11, color: { argb: 'FF1E293B' } };

  const r2 = ws.addRow([
    '',
    '',
    '',
    '',
    'BÁO CÁO NGÀY',
    '',
    '',
    '',
    '',
    '',
    '',
    `Lần ban hành: ${report.issueNo || '01'}`,
  ]);
  r2.font = { bold: true, size: 14, color: { argb: 'FF0F172A' } };

  const r3 = ws.addRow([
    `Phân xưởng: ${report.workshop || 'GIA CÔNG CƠ KHÍ'}`,
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    `Ngày hiệu lực: ${report.effectiveDate || '28/03/2026'}`,
  ]);
  r3.font = { bold: false, size: 10, italic: true, color: { argb: 'FF475569' } };

  const r4 = ws.addRow([`Ngày báo cáo: ${displayDate}`]);
  r4.font = { bold: true, size: 11, color: { argb: 'FF1E3A8A' } };

  ws.addRow([]); // Spacer

  // Table Column Headers (2 rows for merged subcolumns)
  const headerRow1 = [
    'TT',
    'Tên Sản Phẩm',
    'Khách Hàng',
    'Mác Thép',
    'Số lượng Đánh giá',
    'Đạt',
    '',
    'Xử lý',
    '',
    '',
    'Hỏng',
    '',
    '',
    'Ghi chú',
  ];
  const headerRow2 = [
    '',
    '',
    '',
    '',
    '',
    'Số lượng',
    '%',
    'Số lượng',
    '%',
    'Tình trạng lỗi',
    'Số lượng',
    '%',
    'Tình trạng hỏng',
    '',
  ];

  const hr1 = ws.addRow(headerRow1);
  const hr2 = ws.addRow(headerRow2);

  [hr1, hr2].forEach((row) => {
    row.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
    row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    row.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1E40AF' }, // Navy blue
      };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF94A3B8' } },
        left: { style: 'thin', color: { argb: 'FF94A3B8' } },
        bottom: { style: 'thin', color: { argb: 'FF94A3B8' } },
        right: { style: 'thin', color: { argb: 'FF94A3B8' } },
      };
    });
  });

  // Merge headers
  // Row 6 and Row 7
  ws.mergeCells('A6:A7'); // TT
  ws.mergeCells('B6:B7'); // Tên SP
  ws.mergeCells('C6:C7'); // KH
  ws.mergeCells('D6:D7'); // Mác Thép
  ws.mergeCells('E6:E7'); // SL Đánh giá
  ws.mergeCells('F6:G6'); // Đạt (SL, %)
  ws.mergeCells('H6:J6'); // Xử lý (SL, %, Lỗi)
  ws.mergeCells('K6:M6'); // Hỏng (SL, %, Hỏng)
  ws.mergeCells('N6:N7'); // Ghi chú

  let sumAssessed = 0;
  let sumOk = 0;
  let sumRework = 0;
  let sumScrap = 0;

  report.items.forEach((item, idx) => {
    sumAssessed += item.assessedQty;
    sumOk += item.okQty;
    sumRework += item.reworkQty;
    sumScrap += item.scrapQty;

    const row = ws.addRow([
      idx + 1,
      sanitizeForExcel(item.productName),
      sanitizeForExcel(item.customer),
      sanitizeForExcel(item.steelGrade),
      item.assessedQty,
      item.okQty,
      `${Math.round(item.okPct)}%`,
      item.reworkQty,
      `${Math.round(item.reworkPct)}%`,
      sanitizeForExcel(item.reworkReason),
      item.scrapQty,
      `${Math.round(item.scrapPct)}%`,
      sanitizeForExcel(item.scrapReason),
      sanitizeForExcel(item.note),
    ]);

    row.font = { size: 10, color: { argb: 'FF0F172A' } };
    row.alignment = { vertical: 'middle' };
    row.eachCell((cell, colNum) => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      };
      if ([1, 5, 6, 7, 8, 9, 11, 12].includes(colNum)) {
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      }
    });
  });

  // Summary Row
  const overallOkPct = sumAssessed > 0 ? Math.round((sumOk / sumAssessed) * 100) : 100;
  const overallRwPct = sumAssessed > 0 ? Math.round((sumRework / sumAssessed) * 100) : 0;
  const overallScrapPct = sumAssessed > 0 ? Math.round((sumScrap / sumAssessed) * 100) : 0;

  const sumRow = ws.addRow([
    'TỔNG CỘNG',
    '',
    '',
    '',
    sumAssessed,
    sumOk,
    `${overallOkPct}%`,
    sumRework,
    `${overallRwPct}%`,
    '',
    sumScrap,
    `${overallScrapPct}%`,
    '',
    '',
  ]);

  ws.mergeCells(`A${sumRow.number}:D${sumRow.number}`);
  sumRow.font = { bold: true, size: 10, color: { argb: 'FF0F172A' } };
  sumRow.eachCell((cell, colNum) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF1F5F9' },
    };
    cell.border = {
      top: { style: 'medium', color: { argb: 'FF0F172A' } },
      left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      bottom: { style: 'medium', color: { argb: 'FF0F172A' } },
      right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    };
    if (colNum >= 5) {
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    }
  });

  ws.addRow([]); // Spacer
  ws.addRow([]); // Spacer

  // Signatures Row
  const sigRow1 = ws.addRow(['', 'Người Lập Biểu', '', '', '', 'Tổ Trưởng / QC', '', '', '', 'Quản Đốc Phân Xưởng', '', '']);
  sigRow1.font = { bold: true, size: 11, color: { argb: 'FF0F172A' } };
  sigRow1.alignment = { horizontal: 'center' };

  const sigRow2 = ws.addRow(['', '(Ký, họ tên)', '', '', '', '(Ký, họ tên)', '', '', '', '(Ký, đóng dấu)', '', '']);
  sigRow2.font = { italic: true, size: 9, color: { argb: 'FF64748B' } };
  sigRow2.alignment = { horizontal: 'center' };

  autoFitColumns(ws, 8, 36);
  return workbookToBytes(wb);
}

export async function downloadDailyQualityReportExcel(
  report: DailyQualityReportData
): Promise<void> {
  const bytes = await buildDailyQualityReportWorkbook(report);
  downloadWorkbookBytes(
    bytes,
    `BM.KTCN.04.03_BaoCaoNgay_${report.reportDate}.xlsx`
  );
}

export function fileToUint8Array(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(new Uint8Array(reader.result));
      } else {
        reject(new Error('Không thể đọc dữ liệu nhị phân của file Excel.'));
      }
    };
    reader.onerror = () => reject(new Error('Lỗi đọc file Excel từ thiết bị.'));
    reader.readAsArrayBuffer(file);
  });
}
