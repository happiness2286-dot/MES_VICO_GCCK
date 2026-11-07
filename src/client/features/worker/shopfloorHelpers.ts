import type { OperationMeta, PurchaseOrderInfo } from '@shared/types';
import { normalizeVn, removeVietnameseTones } from '@shared/vnSearch';

export interface ParsedTravelerQr {
  valid: boolean;
  poId: string | null;
  ncId: string | null;
  spId?: string | null;
  customer?: string | null;
  productName?: string | null;
  raw: string;
}

export interface ResolvedQrSelection {
  poId: string;
  ncId: string;
  spId: string | null;
  customer: string;
  productName: string;
  defaultMachine: string;
  toolCode: string;
  reconciledWarning: string | null;
}

export interface StopTimerState {
  isRunning: boolean;
  startedAt: number | null;
  accumulatedMs: number;
}

export interface StopTimerSnapshot {
  elapsedSeconds: number;
  elapsedMinutes: number;
  formattedClock: string;
}

export interface ToolEdgesState {
  edgesUsed: number;
  isEdgesDirty: boolean;
}

export const STOP_TIMER_STORAGE_KEY = 'GCCK_PERSISTENT_STOP_TIMER_V1';
export const RUN_TIMER_STORAGE_KEY = 'GCCK_PERSISTENT_RUN_TIMER_V1';

/**
 * Parses GCCK Shop Traveler QR and Barcode strings:
 * - Standard GCCK QR: GCCK|<poId>|<ncId>
 * - Schedule QR: GCCK|<customer>|<productName>|<workerName>
 * - Single 1D barcodes: DH-343, PO485-01, PO2611-193-01, NC098, NC835, SP370...
 * - URLs containing ?qr=GCCK|... or /print/traveler/<poId>
 */
export function parseTravelerQrPayload(rawInput: string | null | undefined): ParsedTravelerQr {
  const raw = String(rawInput ?? '').trim();
  if (!raw) {
    return { valid: false, poId: null, ncId: null, raw: '' };
  }

  let candidate = raw;
  try {
    if (raw.includes('://') || raw.startsWith('/')) {
      const urlObj = new URL(raw, 'https://mes.gcck.local');
      const qrParam = urlObj.searchParams.get('qr');
      if (qrParam) {
        candidate = decodeURIComponent(qrParam).trim();
      } else {
        const travelerMatch = /\/print\/traveler\/([^/?#]+)/i.exec(urlObj.pathname);
        if (travelerMatch) {
          const poId = normalizeVn(decodeURIComponent(travelerMatch[1])).toUpperCase();
          return poId
            ? { valid: true, poId, ncId: null, raw }
            : { valid: false, poId: null, ncId: null, raw };
        }
      }
    }
  } catch {
    // Fallback to direct string parsing
  }

  // Check pipe delimited tokens
  if (candidate.includes('|')) {
    const parts = candidate.split('|').map((s) => normalizeVn(s).trim());
    if (parts.length >= 2 && parts[0].toUpperCase() === 'GCCK') {
      const p1 = parts[1] ? parts[1].toUpperCase() : '';
      const p2 = parts[2] ? parts[2].toUpperCase() : '';

      // Check if p1 looks like a PO code (starts with PO, DH-, or is PO-THEO-KH)
      if (p1.startsWith('PO') || p1.startsWith('DH') || p1 === 'PO-THEO-KH' || /^DH\b/i.test(p1)) {
        return { valid: true, poId: p1, ncId: p2 || null, raw };
      }

      // Check if p1 is an NC code
      if (p1.startsWith('NC')) {
        return { valid: true, poId: p2 || null, ncId: p1, raw };
      }

      // If parts has customer | product | worker (Daily Schedule QR format)
      if (parts.length >= 3) {
        return {
          valid: true,
          poId: null,
          ncId: null,
          customer: parts[1],
          productName: parts[2],
          raw,
        };
      }

      if (p1) {
        return { valid: true, poId: p1, ncId: p2 || null, raw };
      }
    } else if (parts.length >= 2) {
      // Pipe separated without GCCK prefix (e.g. DH-343|NC835)
      const p0 = parts[0].toUpperCase();
      const p1 = parts[1].toUpperCase();
      if (p0.startsWith('NC')) {
        return { valid: true, poId: p1 || null, ncId: p0, raw };
      }
      return { valid: true, poId: p0, ncId: p1 || null, raw };
    }
  }

  // Single code / 1D Barcode scanning (e.g. DH-343, PO485-01, NC098, SP370)
  const clean = candidate.trim();
  const upper = clean.toUpperCase();

  if (upper.startsWith('NC') && upper.length >= 3) {
    // Direct Operation barcode
    return { valid: true, poId: null, ncId: upper, raw };
  }

  if (upper.startsWith('SP') && upper.length >= 3) {
    // Direct Product / Drawing barcode
    return { valid: true, poId: null, ncId: null, spId: upper, raw };
  }

  if (upper.startsWith('PO') || upper.startsWith('DH') || upper === 'PO-THEO-KH' || /^DH-/i.test(upper)) {
    // Direct PO / Traveler barcode
    return { valid: true, poId: upper, ncId: null, raw };
  }

  // Any non-empty barcode / text scanned on shopfloor
  if (clean.length >= 2) {
    return { valid: true, poId: clean, ncId: null, raw };
  }

  return { valid: false, poId: null, ncId: null, raw };
}

/**
 * Resolves a parsed QR / barcode against live PurchaseOrders & Operations,
 * reconciling mismatched PO/NC pairs safely so report submission never fails DB validation.
 */
export function resolveQrToShopfloorSelection(
  parsed: ParsedTravelerQr,
  orders: PurchaseOrderInfo[],
  operations: OperationMeta[]
): ResolvedQrSelection | null {
  if (!parsed.valid) return null;

  // Case 1: An explicit Operation (NC) was scanned / parsed
  if (parsed.ncId) {
    const cleanNc = parsed.ncId.trim().toUpperCase();
    const matchedOp = operations.find((op) => op.ncId.toUpperCase() === cleanNc) ?? null;

    if (matchedOp) {
      let resolvedPoId = parsed.poId ? parsed.poId.toUpperCase() : '';
      let matchedPo = resolvedPoId && resolvedPoId !== 'PO-THEO-KH'
        ? orders.find((o) => o.poId.toUpperCase() === resolvedPoId) ?? null
        : null;

      // Reconcile if PO doesn't match this operation's product (prioritize earliest due date)
      if (!matchedPo || (matchedOp.spId && matchedPo.spId && matchedPo.spId !== matchedOp.spId)) {
        const compatiblePo = orders
          .filter(
            (o) =>
              ((matchedOp.spId && o.spId === matchedOp.spId) ||
                (matchedOp.productName &&
                  o.productName.trim().toLowerCase() === matchedOp.productName.trim().toLowerCase())) &&
              o.status !== '✅ Đã giao đủ' &&
              o.remainQty > 0
          )
          .sort((a, b) => (a.dueDate || '9999-12-31').localeCompare(b.dueDate || '9999-12-31'))[0];
        resolvedPoId = compatiblePo ? compatiblePo.poId : (matchedPo ? matchedPo.poId : 'PO-THEO-KH');
      }

      return {
        poId: resolvedPoId || 'PO-THEO-KH',
        ncId: matchedOp.ncId,
        spId: matchedOp.spId,
        customer: matchedOp.customer,
        productName: matchedOp.productName,
        defaultMachine: matchedOp.defaultMachine,
        toolCode: matchedOp.toolCode,
        reconciledWarning: null,
      };
    }
  }

  // Case 2: A PO ID was scanned (e.g. DH-343, PO485-01, PO2611-193-01)
  if (parsed.poId) {
    const cleanPo = parsed.poId.trim().toUpperCase();
    const matchedPo =
      cleanPo === 'PO-THEO-KH'
        ? null
        : orders.find((o) => o.poId.toUpperCase() === cleanPo) ||
          orders.find((o) => o.poId.toUpperCase().includes(cleanPo) || cleanPo.includes(o.poId.toUpperCase())) ||
          null;

    if (matchedPo) {
      const prodOps = matchedPo.spId
        ? operations
            .filter((o) => o.spId === matchedPo.spId)
            .sort((a, b) => a.stepOrder - b.stepOrder)
        : operations.filter(
            (o) =>
              normalizeVn(o.productName).replace(/\s+/g, '').toUpperCase() ===
              normalizeVn(matchedPo.productName).replace(/\s+/g, '').toUpperCase()
          );

      const firstOp = prodOps[0] || operations.find((o) => o.productName.toLowerCase().includes(matchedPo.productName.toLowerCase()));
      if (firstOp) {
        return {
          poId: matchedPo.poId,
          ncId: firstOp.ncId,
          spId: matchedPo.spId || firstOp.spId,
          customer: matchedPo.customer || firstOp.customer,
          productName: matchedPo.productName || firstOp.productName,
          defaultMachine: firstOp.defaultMachine,
          toolCode: firstOp.toolCode,
          reconciledWarning: null,
        };
      }

      return {
        poId: matchedPo.poId,
        ncId: 'NC001',
        spId: matchedPo.spId || null,
        customer: matchedPo.customer,
        productName: matchedPo.productName,
        defaultMachine: 'Máy Tiện CNC 1',
        toolCode: '',
        reconciledWarning: null,
      };
    }

    // What if the scanned code in poId was actually an NC code or Product code?
    const asOp = operations.find((o) => o.ncId.toUpperCase() === cleanPo);
    if (asOp) {
      return {
        poId: 'PO-THEO-KH',
        ncId: asOp.ncId,
        spId: asOp.spId,
        customer: asOp.customer,
        productName: asOp.productName,
        defaultMachine: asOp.defaultMachine,
        toolCode: asOp.toolCode,
        reconciledWarning: null,
      };
    }
  }

  // Case 3: Schedule QR format (customer & productName)
  if (parsed.productName) {
    const cleanProd = parsed.productName.trim().toLowerCase();
    const matchedOp = operations.find(
      (o) =>
        o.productName.trim().toLowerCase() === cleanProd ||
        o.productName.toLowerCase().includes(cleanProd) ||
        cleanProd.includes(o.productName.toLowerCase())
    );

    const matchedPo = orders
      .filter(
        (o) =>
          (o.productName.trim().toLowerCase() === cleanProd ||
            o.productName.toLowerCase().includes(cleanProd) ||
            cleanProd.includes(o.productName.toLowerCase())) &&
          o.status !== '✅ Đã giao đủ'
      )
      .sort((a, b) => (a.dueDate || '9999-12-31').localeCompare(b.dueDate || '9999-12-31'))[0];

    if (matchedOp) {
      return {
        poId: matchedPo ? matchedPo.poId : 'PO-THEO-KH',
        ncId: matchedOp.ncId,
        spId: matchedOp.spId,
        customer: matchedOp.customer || parsed.customer || 'Khách hàng',
        productName: matchedOp.productName,
        defaultMachine: matchedOp.defaultMachine,
        toolCode: matchedOp.toolCode,
        reconciledWarning: null,
      };
    }
  }

  // Case 4: Product / Drawing ID (e.g. SP370)
  if (parsed.spId) {
    const cleanSp = parsed.spId.trim().toUpperCase();
    const matchedOp = operations.find((o) => (o.spId || '').toUpperCase() === cleanSp);
    const matchedPo = orders.find((o) => (o.spId || '').toUpperCase() === cleanSp);
    if (matchedOp) {
      return {
        poId: matchedPo ? matchedPo.poId : 'PO-THEO-KH',
        ncId: matchedOp.ncId,
        spId: matchedOp.spId,
        customer: matchedOp.customer,
        productName: matchedOp.productName,
        defaultMachine: matchedOp.defaultMachine,
        toolCode: matchedOp.toolCode,
        reconciledWarning: null,
      };
    }
  }

  // Fallback fuzzy search on raw text across POs and Operations
  if (parsed.raw) {
    const rawClean = parsed.raw.trim().toLowerCase();
    const opByProd = operations.find((o) => o.productName.toLowerCase().includes(rawClean) || rawClean.includes(o.productName.toLowerCase()));
    if (opByProd) {
      return {
        poId: 'PO-THEO-KH',
        ncId: opByProd.ncId,
        spId: opByProd.spId,
        customer: opByProd.customer,
        productName: opByProd.productName,
        defaultMachine: opByProd.defaultMachine,
        toolCode: opByProd.toolCode,
        reconciledWarning: null,
      };
    }
  }

  return null;
}

export function createInitialStopTimerState(): StopTimerState {
  return {
    isRunning: false,
    startedAt: null,
    accumulatedMs: 0,
  };
}

export function startPersistentStopTimer(
  prev: StopTimerState,
  nowMs: number = Date.now()
): StopTimerState {
  if (prev.isRunning && prev.startedAt !== null) return prev;
  return {
    isRunning: true,
    startedAt: nowMs,
    accumulatedMs: Math.max(0, Number(prev.accumulatedMs) || 0),
  };
}

export function pausePersistentStopTimer(
  prev: StopTimerState,
  nowMs: number = Date.now()
): StopTimerState {
  if (!prev.isRunning || prev.startedAt === null) return prev;
  const delta = Math.max(0, nowMs - prev.startedAt);
  return {
    isRunning: false,
    startedAt: null,
    accumulatedMs: Math.max(0, Number(prev.accumulatedMs) || 0) + delta,
  };
}

export function resetPersistentStopTimer(): StopTimerState {
  return createInitialStopTimerState();
}

export function computeStopTimerElapsed(
  state: StopTimerState,
  nowMs: number = Date.now()
): StopTimerSnapshot {
  const baseMs = Math.max(0, Number(state.accumulatedMs) || 0);
  const liveMs =
    state.isRunning && state.startedAt !== null ? Math.max(0, nowMs - state.startedAt) : 0;
  const totalMs = baseMs + liveMs;
  const elapsedSeconds = Math.floor(totalMs / 1000);
  const elapsedMinutes =
    elapsedSeconds === 0 ? 0 : Math.max(1, Math.round(elapsedSeconds / 60));

  const hrs = Math.floor(elapsedSeconds / 3600);
  const mins = Math.floor((elapsedSeconds % 3600) / 60);
  const secs = elapsedSeconds % 60;

  const pad = (n: number) => String(n).padStart(2, '0');
  const formattedClock =
    hrs > 0 ? `${pad(hrs)}:${pad(mins)}:${pad(secs)}` : `${pad(mins)}:${pad(secs)}`;

  return {
    elapsedSeconds,
    elapsedMinutes,
    formattedClock,
  };
}

export function loadStopTimerFromStorage(key: string = STOP_TIMER_STORAGE_KEY): StopTimerState {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return createInitialStopTimerState();
    const parsed = JSON.parse(raw);
    return {
      isRunning: Boolean(parsed?.isRunning),
      startedAt: typeof parsed?.startedAt === 'number' ? parsed.startedAt : null,
      accumulatedMs: Math.max(0, Number(parsed?.accumulatedMs) || 0),
    };
  } catch {
    return createInitialStopTimerState();
  }
}

export function saveStopTimerToStorage(
  state: StopTimerState,
  key: string = STOP_TIMER_STORAGE_KEY
): void {
  try {
    if (!state.isRunning && state.accumulatedMs === 0) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify(state));
    }
  } catch {
    // ignore storage errors
  }
}

/**
 * Recalculates tool edges consumed automatically ONLY when isEdgesDirty is false
 * (or when forceReset is true, e.g. switching operation).
 */
export function syncAutoToolEdges(
  current: ToolEdgesState,
  okQty: number,
  stdEdgesPerPcs: number,
  forceReset: boolean = false
): ToolEdgesState {
  if (!forceReset && current.isEdgesDirty) {
    return current;
  }
  const safeQty = Math.max(0, Number(okQty) || 0);
  const safeStd = Math.max(0, Number(stdEdgesPerPcs) || 0);
  const calculated = Number((safeQty * safeStd).toFixed(2));
  return {
    edgesUsed: calculated,
    isEdgesDirty: false,
  };
}

export function applyManualToolEdges(
  _current: ToolEdgesState,
  manualEdges: number
): ToolEdgesState {
  const safeManual = Math.max(0, Number(Number(manualEdges || 0).toFixed(2)));
  return {
    edgesUsed: safeManual,
    isEdgesDirty: true,
  };
}

export function estimateScrapDamageValue(
  scrapQty: number,
  op: Pick<OperationMeta, 'stdLaborCost' | 'stdMachCost' | 'stdToolCost'> | null | undefined
): number {
  const qty = Math.max(0, Math.round(Number(scrapQty) || 0));
  if (qty <= 0 || !op) return 0;
  const unitStdCost =
    Math.max(0, Number(op.stdLaborCost) || 0) +
    Math.max(0, Number(op.stdMachCost) || 0) +
    Math.max(0, Number(op.stdToolCost) || 0);
  return Math.round(qty * Math.max(50000, unitStdCost));
}

export function getShiftPresetTimes(shiftType: string): { startTime: string; endTime: string } {
  const ascii = removeVietnameseTones(shiftType || '').toLowerCase();
  if (ascii.includes('ca 2')) {
    return { startTime: '14:00', endTime: '22:00' };
  }
  if (ascii.includes('ca 3')) {
    return { startTime: '22:00', endTime: '06:00' };
  }
  if (ascii.includes('hanh chinh')) {
    return { startTime: '07:30', endTime: '16:30' };
  }
  return { startTime: '06:00', endTime: '14:00' };
}
