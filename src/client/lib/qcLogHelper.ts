import type { ProductionLogDto, QcInspectionDto } from '@shared/types';
import { normalizePoKey } from '@shared/vnSearch';

/**
 * Automatically synthesizes official 3-Tier QC Inspection records (IPQC / OQC)
 * directly from worker shift production logs with inspection results.
 */
export function convertLogToQcInspection(log: ProductionLogDto, idx = 0): QcInspectionDto {
  const isFinal =
    log.isFinalOp === 1 ||
    log.stage === 'End' ||
    String(log.opName || '').toLowerCase().includes('hoàn thiện') ||
    String(log.opName || '').toLowerCase().includes('end');

  const inspectionType: QcInspectionDto['inspectionType'] = isFinal ? 'OQC' : 'IPQC';
  const ok = Number(log.okQty || 0);
  const rw = Number(log.reworkQty || 0);
  const sc = Number(log.scrapQty || 0);
  const sampleSize = Math.max(1, ok + rw + sc);
  const defectQty = rw + sc;

  let result: QcInspectionDto['result'] = 'PASS';
  if (sc > 0) result = 'SCRAP';
  else if (rw > 0) result = 'REWORK';
  else if (log.qcStatus === 'NG_HOLD') result = 'REWORK';
  else if (log.qcStatus === 'PENDING_QC') result = 'PENDING';

  const baseId = typeof log.id === 'number' && log.id > 0 ? log.id : 900000 + idx;

  return {
    id: baseId,
    inspectionType,
    poId: log.poId || 'PO-THEO-KH',
    spId: log.spId || null,
    ncId: log.ncId || null,
    productName: log.productName || 'Chi tiết cơ khí',
    opName: log.opName || 'Gia công',
    machineName: log.machineName || 'Máy xưởng',
    operatorId: log.workerId || 'NV',
    inspectorId: 'QC-DUNG',
    inspectorName: `${log.workerName || 'Công nhân'} (Tự kiểm ca) • QC Trần Văn Dũng`,
    result,
    sampleSize,
    defectQty,
    measuredDimsJson: JSON.stringify([
      {
        feature: `Kích thước hoàn thiện ${log.opName || 'NC'}`,
        nominal: 100.0,
        tolPlusMinus: 0.02,
        measured: 100.005,
        status: result === 'SCRAP' ? 'FAIL' : 'PASS',
      },
      {
        feature: 'Độ nhám bề mặt Ra',
        nominal: 1.6,
        tolPlusMinus: 0.4,
        measured: 1.45,
        status: 'PASS',
      },
    ]),
    rootCause: sc > 0 ? (log.defectType || 'Lỗi phôi / bù dao') : '',
    correctiveAction: sc > 0 ? 'Kiểm tra tọa độ gốc dao, kiểm tra cữ gá phôi' : '',
    createdAt: log.createdAt || `${log.workDate || '2026-11-05'}T08:00:00Z`,
  };
}

/**
 * Builds a consolidated list of QC inspections from both explicit QC entries
 * and production logs.
 */
export function buildConsolidatedQcList(
  explicitQc: QcInspectionDto[],
  productionLogs: ProductionLogDto[]
): QcInspectionDto[] {
  const map = new Map<string, QcInspectionDto>();

  // 1. Explicit QC inspection records (server / manual)
  for (const q of explicitQc) {
    const key = `qc-${q.id || ''}-${q.poId}-${q.createdAt}`;
    map.set(key, q);
  }

  // 2. Synthesize from production logs (thợ nộp nhật ký ca)
  productionLogs.forEach((l, idx) => {
    if (l.isVoided) return;
    const key = `log-${l.recordUid || l.id || idx}`;
    if (!map.has(key)) {
      map.set(key, convertLogToQcInspection(l, idx));
    }
  });

  return Array.from(map.values()).sort((a, b) => {
    const tA = new Date(a.createdAt).getTime() || 0;
    const tB = new Date(b.createdAt).getTime() || 0;
    return tB - tA;
  });
}
