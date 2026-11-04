import type { DailyPlanRow } from '@shared/types';

/**
 * Baseline 22-row schedule adhering strictly to factory structure:
 * - Ca 1: Tráng (Trưởng ca 1, T630 + Cắt Dây 24/24), Quỳnh (Phay CNC1 + Phay OKK1), Đông (Tiện CNC 1), Thắng (Tiện đứng T1516 + OT 2h), Hùng (Luân chuyển, OKUMA)
 * - Ca 2: Dũng (Trưởng ca 2, Phay CNC2 + Phay OKK2), Thanh (Tiện CNC 2 + Cắt Dây 24/24), Thuận (Tiện FUJI + OT 2h), Long (Cố định Ca 2, 3 chi tiết FUJI + Ghép Cắt Dây DK7745-1)
 * - Ca 3: Phúc (Trưởng ca 3, Phay CNC1), Sam (Tiện CNC 1 + Cắt Dây 24/24), Nhận (Tiện CNC 2)
 * - Quản đốc: Hoàng Ngọc Hà (Chỉ đạo 3 ca, không tham gia đứng máy)
 */
export function getBaselineDailyPlan(workDate: string): DailyPlanRow[] {
  return [
    // ========== CA 1 (06:00 - 14:00) ==========
    // Thợ 1: Phạm Văn Tráng (NV00215 - Trưởng ca 1, Máy tiện T630 + Ghép Máy Cắt Dây 24/24)
    {
      workDate,
      shiftType: 'Ca 1',
      stt: 1,
      workerName: 'Phạm Văn Tráng',
      customer: 'Win-Win',
      spId: 'PO471-1',
      productName: 'SFP216',
      ncId: 'NC006',
      opName: 'Gia công tiện tinh mặt côn',
      plannedQty: 18,
      machineName: 'Máy tiện T630',
      note: 'Trưởng ca 1 - Máy chính',
      actualQty: 0,
      status: 'PLANNED',
    },
    {
      workDate,
      shiftType: 'Ca 1',
      stt: 2,
      workerName: 'Phạm Văn Tráng',
      customer: 'Vico - Nội bộ',
      spId: 'PO485-01',
      productName: 'ALKTOP 1342 M',
      ncId: 'NC050',
      opName: 'G/c cắt dây mài hoàn thiện',
      plannedQty: 12,
      machineName: 'Máy Cắt Dây DK7745 - 1',
      note: 'Ghép 2 máy (+0.33) - Cắt dây tự động 24/24',
      actualQty: 0,
      status: 'PLANNED',
    },
    // Thợ 2: Trần Văn Quỳnh (NV00214 - Chuyên máy Phay CNC 1, ghép Phay OKK1)
    {
      workDate,
      shiftType: 'Ca 1',
      stt: 3,
      workerName: 'Trần Văn Quỳnh',
      customer: 'Win-Win',
      spId: 'PO475-01',
      productName: 'ISHIZUE 267.4-700',
      ncId: 'NC002',
      opName: 'Phay mặt đầu & phay hốc (Chu kỳ dài)',
      plannedQty: 10,
      machineName: 'Máy Phay CNC1',
      note: 'Chuyên máy Phay CNC 1 - NC dài',
      actualQty: 0,
      status: 'PLANNED',
    },
    {
      workDate,
      shiftType: 'Ca 1',
      stt: 4,
      workerName: 'Trần Văn Quỳnh',
      customer: 'Win-Win',
      spId: 'PO475-02',
      productName: 'ISHIZUE 267.4-800',
      ncId: 'NC001',
      opName: 'Phay rãnh then cơ (Chu kỳ ngắn)',
      plannedQty: 8,
      machineName: 'Máy phay OKK1',
      note: 'Ghép 2 máy (+0.33) - Phay OKK1 NC ngắn',
      actualQty: 0,
      status: 'PLANNED',
    },
    // Thợ 3: Nguyễn Trung Đông (NV00218 - Ca 1)
    {
      workDate,
      shiftType: 'Ca 1',
      stt: 5,
      workerName: 'Nguyễn Trung Đông',
      customer: 'Win-Win',
      spId: 'PO483-01',
      productName: 'ISHIZUEOMEGA T267.4-950',
      ncId: 'NC003',
      opName: 'Tiện CNC thô & tinh mặt bích',
      plannedQty: 14,
      machineName: 'Máy Tiện CNC 1',
      note: 'Máy chính',
      actualQty: 0,
      status: 'PLANNED',
    },
    // Thợ 4: Phùng Công Thắng (NV00219 - Ca 1)
    {
      workDate,
      shiftType: 'Ca 1',
      stt: 6,
      workerName: 'Phùng Công Thắng',
      customer: 'TFG',
      spId: 'PO-2026-015',
      productName: 'Pattern Drawing No 2CG00382',
      ncId: 'NC005',
      opName: 'Tiện đứng chi tiết lớn',
      plannedQty: 6,
      machineName: 'Máy tiện đứng T1516',
      note: 'Máy chính',
      actualQty: 0,
      status: 'PLANNED',
    },
    {
      workDate,
      shiftType: 'Ca 1',
      stt: 7,
      workerName: 'Phùng Công Thắng',
      customer: 'TFG',
      spId: 'PO-2026-015',
      productName: 'Pattern Drawing No 2CG00382',
      ncId: 'NC005',
      opName: 'Tiện đứng hoàn thiện gá phôi',
      plannedQty: 2,
      machineName: 'Máy tiện đứng T1516',
      note: '🔥 Tăng ca 2h (14:00 - 16:00)',
      isOvertime: true,
      overtimeHours: 2,
      actualQty: 0,
      status: 'PLANNED',
    },

    // ========== LUÂN CHUYỂN CA 1 & CA 2 ==========
    // Thợ 5: Phùng Đình Hùng (NV00282 - Thợ luân chuyển Ca 1 & Ca 2 tùy bố trí xưởng)
    {
      workDate,
      shiftType: 'Ca 1',
      stt: 8,
      workerName: 'Phùng Đình Hùng',
      customer: 'Win-Win',
      spId: 'PO475-03',
      productName: 'ISHIZUEOMEGA S216.3-550',
      ncId: 'NC004',
      opName: 'Tiện bán tinh chi tiết',
      plannedQty: 12,
      machineName: 'Máy tiện OKUMA',
      note: 'Thợ luân chuyển Ca 1 & Ca 2 theo điều động xưởng',
      actualQty: 0,
      status: 'PLANNED',
    },

    // ========== CA 2 (14:00 - 22:00) ==========
    // Thợ 6: Trần Văn Dũng (NV00266 - Trưởng ca 2, chuyên máy Phay CNC 2, ghép Phay OKK2)
    {
      workDate,
      shiftType: 'Ca 2',
      stt: 9,
      workerName: 'Trần Văn Dũng',
      customer: 'Win-Win',
      spId: 'PO475-04',
      productName: 'ISHIZUEOMEGA S216.3-650',
      ncId: 'NC007',
      opName: 'Phay mặt phẳng & hốc sâu',
      plannedQty: 12,
      machineName: 'Máy Phay CNC2',
      note: 'Trưởng ca 2 - Chuyên máy Phay CNC 2',
      actualQty: 0,
      status: 'PLANNED',
    },
    {
      workDate,
      shiftType: 'Ca 2',
      stt: 10,
      workerName: 'Trần Văn Dũng',
      customer: 'Win-Win',
      spId: 'PO475-05',
      productName: 'ISHIZUEOMEGA S267.4-700',
      ncId: 'NC008',
      opName: 'Phay cơ khoan lỗ định vị',
      plannedQty: 8,
      machineName: 'Máy phay OKK2',
      note: 'Ghép 2 máy (+0.33) - Phay OKK2',
      actualQty: 0,
      status: 'PLANNED',
    },
    // Thợ 7: Nguyễn Văn Thanh (NV00216 - Ca 2, ghép Tiện CNC 2 + Cắt Dây 24/24)
    {
      workDate,
      shiftType: 'Ca 2',
      stt: 11,
      workerName: 'Nguyễn Văn Thanh',
      customer: 'Win-Win',
      spId: 'PO475-03',
      productName: 'ISHIZUEOMEGA S216.3-550',
      ncId: 'NC004',
      opName: 'Tiện CNC bán tinh',
      plannedQty: 16,
      machineName: 'Máy Tiện CNC 2',
      note: 'Máy chính',
      actualQty: 0,
      status: 'PLANNED',
    },
    {
      workDate,
      shiftType: 'Ca 2',
      stt: 12,
      workerName: 'Nguyễn Văn Thanh',
      customer: 'Vico - Nội bộ',
      spId: 'PO485-01',
      productName: 'ALKTOP 1342 M',
      ncId: 'NC050',
      opName: 'G/c cắt dây mài hoàn thiện',
      plannedQty: 10,
      machineName: 'Máy Cắt Dây DK7745 - 1',
      note: 'Ghép 2 máy (+0.33) - Cắt dây tự động 24/24',
      actualQty: 0,
      status: 'PLANNED',
    },
    // Thợ 8: Vũ Tiến Thuận (NV00283 - Ca 2)
    {
      workDate,
      shiftType: 'Ca 2',
      stt: 13,
      workerName: 'Vũ Tiến Thuận',
      customer: 'Win-Win',
      spId: 'PO487-03',
      productName: 'ALKTOP II 1950H',
      ncId: 'NC009',
      opName: 'Tiện CNC 2 trục hoàn thiện',
      plannedQty: 15,
      machineName: 'Máy tiện FUJI',
      note: 'Máy chính',
      actualQty: 0,
      status: 'PLANNED',
    },
    {
      workDate,
      shiftType: 'Ca 2',
      stt: 14,
      workerName: 'Vũ Tiến Thuận',
      customer: 'Win-Win',
      spId: 'PO487-03',
      productName: 'ALKTOP II 1950H',
      ncId: 'NC009',
      opName: 'Tiện hoàn thiện lô gấp',
      plannedQty: 4,
      machineName: 'Máy tiện FUJI',
      note: '🔥 Tăng ca 2h (22:00 - 24:00)',
      isOvertime: true,
      overtimeHours: 2,
      actualQty: 0,
      status: 'PLANNED',
    },
    // Thợ 9: Đặng Ngọc Long (NV00261 - Cố định Ca 2, Máy tiện FUJI 3 chi tiết + Ghép Cắt Dây DK7745-1)
    {
      workDate,
      shiftType: 'Ca 2',
      stt: 15,
      workerName: 'Đặng Ngọc Long',
      customer: 'Win-Win',
      spId: 'SP044',
      productName: 'ISHIZUE 406Dw850',
      ncId: 'NC061',
      opName: 'G/c hoàn thiện',
      plannedQty: 1,
      machineName: 'Máy tiện FUJI',
      note: 'Máy chính',
      actualQty: 0,
      status: 'PLANNED',
    },
    {
      workDate,
      shiftType: 'Ca 2',
      stt: 16,
      workerName: 'Đặng Ngọc Long',
      customer: 'Win-Win',
      spId: 'SP043',
      productName: 'ISHIZUE 457Dw950',
      ncId: 'NC060',
      opName: 'G/c hoàn thiện',
      plannedQty: 2,
      machineName: 'Máy tiện FUJI',
      note: 'Máy chính',
      actualQty: 0,
      status: 'PLANNED',
    },
    {
      workDate,
      shiftType: 'Ca 2',
      stt: 17,
      workerName: 'Đặng Ngọc Long',
      customer: 'Win-Win',
      spId: 'SP026',
      productName: 'ISHIZUE 355Dw750',
      ncId: 'NC043',
      opName: 'G/c hoàn thiện',
      plannedQty: 4,
      machineName: 'Máy tiện FUJI',
      note: 'Máy chính',
      actualQty: 0,
      status: 'PLANNED',
    },
    {
      workDate,
      shiftType: 'Ca 2',
      stt: 18,
      workerName: 'Đặng Ngọc Long',
      customer: 'Vico - Nội bộ / Khách lẻ',
      spId: 'SP001',
      productName: 'Mẫu Thử',
      ncId: 'NC050',
      opName: 'G/c cắt dây',
      plannedQty: 6,
      machineName: 'Máy Cắt Dây DK7745 - 1',
      note: 'Ghép 2 máy (+0.33)',
      actualQty: 0,
      status: 'PLANNED',
    },

    // ========== CA 3 (22:00 - 06:00 Lights-out) ==========
    // Thợ 10: Phùng Gia Phúc (NV00267 - Trưởng ca 3, chạy tự động Phay CNC1 qua đêm)
    {
      workDate,
      shiftType: 'Ca 3',
      stt: 19,
      workerName: 'Phùng Gia Phúc',
      customer: 'Win-Win',
      spId: 'PO475-01',
      productName: 'ISHIZUE 267.4-700',
      ncId: 'NC002',
      opName: 'Phay chạy tự động qua đêm',
      plannedQty: 10,
      machineName: 'Máy Phay CNC1',
      note: 'Trưởng ca 3 - Ca đêm Lights-out',
      actualQty: 0,
      status: 'PLANNED',
    },
    // Thợ 11: Phạm Văn Sam (NV00265 - Ca 3, ghép Tiện CNC 1 + Cắt dây 24/24)
    {
      workDate,
      shiftType: 'Ca 3',
      stt: 20,
      workerName: 'Phạm Văn Sam',
      customer: 'Win-Win',
      spId: 'PO471-1',
      productName: 'SFP216',
      ncId: 'NC006',
      opName: 'Gia công tiện chi tiết dài qua đêm',
      plannedQty: 12,
      machineName: 'Máy Tiện CNC 1',
      note: 'Ca đêm Lights-out - Chu kỳ dài',
      actualQty: 0,
      status: 'PLANNED',
    },
    {
      workDate,
      shiftType: 'Ca 3',
      stt: 21,
      workerName: 'Phạm Văn Sam',
      customer: 'Vico - Nội bộ',
      spId: 'PO485-01',
      productName: 'ALKTOP 1342 M',
      ncId: 'NC050',
      opName: 'G/c cắt dây mài hoàn thiện',
      plannedQty: 8,
      machineName: 'Máy Cắt Dây DK7745 - 1',
      note: 'Ghép 2 máy (+0.33) - Cắt dây tự động 24/24',
      actualQty: 0,
      status: 'PLANNED',
    },
    // Thợ 12: Đinh Văn Nhận (NV00279 - Ca 3)
    {
      workDate,
      shiftType: 'Ca 3',
      stt: 22,
      workerName: 'Đinh Văn Nhận',
      customer: 'Win-Win',
      spId: 'PO475-03',
      productName: 'ISHIZUEOMEGA S216.3-550',
      ncId: 'NC004',
      opName: 'Tiện tự động chi tiết lô lớn qua đêm',
      plannedQty: 14,
      machineName: 'Máy Tiện CNC 2',
      note: 'Ca đêm Lights-out',
      actualQty: 0,
      status: 'PLANNED',
    },
  ];
}

/**
 * Intelligently merges any partial daily plan (e.g. from cloud or local storage)
 * with the full factory roster so that NO workers are ever lost or erased.
 * If existingRows is missing workers (fewer than 11 distinct workers),
 * the missing workers are automatically restored from the baseline roster.
 */
export function mergePlanWithBaseline(
  existingRows: DailyPlanRow[],
  workDate: string
): DailyPlanRow[] {
  const baseline = getBaselineDailyPlan(workDate);
  if (!existingRows || existingRows.length === 0) return baseline;

  const existingWorkers = new Set(
    existingRows
      .map((r) => r.workerName?.trim())
      .filter((n): n is string => Boolean(n))
  );

  // If existingRows already contains all 12 factory workers, keep it intact
  if (existingWorkers.size >= 11) {
    return existingRows;
  }

  // Otherwise, some workers were missing!
  // Retain existing rows for workers present in existingRows,
  // and pull in baseline rows for workers that were missing.
  const merged: DailyPlanRow[] = [];
  const handledWorkers = new Set<string>();

  for (const bRow of baseline) {
    const wName = bRow.workerName?.trim();
    if (!wName) continue;
    if (existingWorkers.has(wName)) {
      if (!handledWorkers.has(wName)) {
        const wRows = existingRows.filter((r) => r.workerName?.trim() === wName);
        merged.push(...wRows);
        handledWorkers.add(wName);
      }
    } else {
      merged.push({ ...bRow, workDate });
    }
  }

  // Also include any extra workers in existingRows that weren't in baseline
  for (const eRow of existingRows) {
    const wName = eRow.workerName?.trim();
    if (wName && !handledWorkers.has(wName)) {
      merged.push(eRow);
      handledWorkers.add(wName);
    }
  }

  // Reassign STT cleanly 1..N
  return merged.map((r, idx) => ({ ...r, stt: idx + 1, workDate }));
}

/**
 * Tính sản lượng kế hoạch định mức chuẩn theo công đoạn (1 ca làm việc tiêu chuẩn 8h = 28.800s).
 * - Nếu chi tiết chu kỳ bình thường (stdSeconds <= 28800): tính số lượng SP / ca làm tròn nguyên.
 * - Nếu chi tiết lớn / chu kỳ dài (> 28800s / SP): tính theo phân đoạn ca (0.75, 0.5, 0.33, 0.25).
 */
export function calculateOpStandardPlanQty(op?: { stdSeconds?: number } | null): number {
  if (!op || !op.stdSeconds || op.stdSeconds <= 0) return 1;

  const shiftSeconds = 8 * 3600; // 28.800 giây cho 1 ca làm việc tiêu chuẩn 8 tiếng
  const rawRatio = shiftSeconds / op.stdSeconds;

  if (rawRatio >= 1) {
    // Gia công hoàn thành >= 1 SP trong ca: làm tròn số nguyên gần nhất (tối thiểu 1)
    return Math.max(1, Math.round(rawRatio));
  }

  // Nếu chi tiết lớn / chu kỳ dài (> 1 ca / SP): quy về phân đoạn chuẩn
  if (rawRatio >= 0.7) return 0.75;
  if (rawRatio >= 0.4) return 0.5;
  if (rawRatio >= 0.28) return 0.33;
  return 0.25;
}


