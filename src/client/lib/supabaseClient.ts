import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { ProductionLogDto, DailyPlanRow } from '@shared/types';
import { calculateTurnPayroll, DEFAULT_PAYROLL_CONFIG } from '@shared/payrollEngine';
import { mergePlanWithBaseline, isUnmodifiedBaselinePlan } from './baselinePlan';
import bundledCloudConfig from '../config/cloudConfig.json';
import seedData from '../../../data/seed_gcck_1233.json';

const GAS_CLOUD_SYNC_URL =
  'https://script.google.com/macros/s/AKfycbx3YEacwHuxAdYb2yN1qckG4tmydnmmK4f8C_KVtQmUWmpBvJYUh_Jc1DrFZpTeM-bruQ/exec';

let supabaseQuotaRestricted = false;
let gasInitDataCache: { ts: number; data: any } | null = null;
let gasInitDataPromise: Promise<any> | null = null;
let gasPlansMapCache: Record<string, any[]> = {};

async function fetchGasInitData(forceRefresh = false): Promise<any | null> {
  const now = Date.now();
  if (!forceRefresh && gasInitDataCache && now - gasInitDataCache.ts < 8000) {
    return gasInitDataCache.data;
  }
  if (!forceRefresh && gasInitDataPromise) {
    return gasInitDataPromise;
  }
  gasInitDataPromise = (async () => {
    try {
      const resp = await fetch(`${GAS_CLOUD_SYNC_URL}?action=getAppInitData&_t=${now}`, {
        method: 'GET',
        redirect: 'follow',
      });
      if (!resp.ok) return null;
      const json = await resp.json();
      if (json && typeof json === 'object') {
        gasInitDataCache = { ts: Date.now(), data: json };
        // Extract PLAN_SYNC map from NV00053's chatId if present
        const haWorker = Array.isArray(json.workers)
          ? json.workers.find((w: any) => String(w.id || '') === 'NV00053')
          : null;
        const chatStr = String(haWorker?.chatId || '');
        if (chatStr.startsWith('PLAN_SYNC:')) {
          try {
            const parsedMap = JSON.parse(chatStr.slice('PLAN_SYNC:'.length));
            if (parsedMap && typeof parsedMap === 'object' && !parsedMap.test) {
              gasPlansMapCache = { ...gasPlansMapCache, ...parsedMap };
            }
          } catch { }
        }
        return json;
      }
      return null;
    } catch {
      return null;
    } finally {
      gasInitDataPromise = null;
    }
  })();
  return gasInitDataPromise;
}

function getLocalOperationsLookup(): Map<string, any> {
  const map = new Map<string, any>();
  const seedOps = (seedData as any).operations || [];
  for (const o of seedOps) {
    if (o && o.ncId) map.set(String(o.ncId).toUpperCase(), o);
  }
  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem('GCCK_LOCAL_OPERATIONS_V2');
      if (raw) {
        const stored = JSON.parse(raw);
        if (Array.isArray(stored)) {
          for (const o of stored) {
            if (o && o.ncId) map.set(String(o.ncId).toUpperCase(), o);
          }
        }
      }
    } catch { }
  }
  return map;
}

function getLocalWorkersLookup(): Map<string, any> {
  const map = new Map<string, any>();
  const seedWorkers = (seedData as any).workers || [];
  for (const w of seedWorkers) {
    if (w && w.id) map.set(String(w.id).toUpperCase(), w);
  }
  return map;
}

function getLocalDeletedLogKeys(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem('GCCK_DELETED_LOG_KEYS_V1');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return new Set(parsed.map(String));
    }
  } catch { }
  return new Set();
}

function convertGasRecentLogs(gasLogs: any[]): ProductionLogDto[] {
  if (!Array.isArray(gasLogs) || gasLogs.length === 0) return [];
  const opsMap = getLocalOperationsLookup();
  const workersMap = getLocalWorkersLookup();
  const deletedKeys = getLocalDeletedLogKeys();
  const seenSigs = new Set<string>();
  const result: ProductionLogDto[] = [];

  for (let i = 0; i < gasLogs.length; i++) {
    const r = gasLogs[i];
    if (!r) continue;
    const wId = String(r.workerId || '').trim();
    const wName = String(r.workerName || '').trim();
    if (!wId && !wName) continue;
    if (wId === 'TEST' || wName === 'TEST') continue;

    const rowNum = Number(r.rowNum || i + 1);
    const recordUid = `GAS-ROW-${rowNum}`;
    const numId = 900000 + rowNum;
    if (deletedKeys.has(recordUid) || deletedKeys.has(String(numId))) continue;

    const workDate = String(r.workDate || '2026-11-16').slice(0, 10);
    const timeStr = String(r.timeStr || '').trim();
    const machineName = String(r.machineName || 'Máy Tiện CNC 1').trim();
    const ncId = String(r.ncId || 'NC001').trim();
    const okQty = Number(r.okQty || 0);
    const reworkQty = Number(r.reworkQty || 0);
    const scrapQty = Number(r.scrapQty || 0);
    const stopMinutes = Number(r.stopMinutes || 0);

    // Deduplicate consecutive duplicate rows from double-post
    const dedupSig = `${workDate}|${(wId || wName).toUpperCase()}|${machineName.toLowerCase()}|${ncId.toUpperCase()}|${okQty}|${reworkQty}|${scrapQty}|${timeStr.slice(0, 10)}`;
    if (seenSigs.has(dedupSig)) continue;
    seenSigs.add(dedupSig);

    // Parse createdAt from timeStr (e.g. "17/11 06:44")
    let createdAt = `${workDate}T12:00:00+07:00`;
    const mTime = timeStr.match(/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/);
    if (mTime) {
      const dd = mTime[1].padStart(2, '0');
      const mm = mTime[2].padStart(2, '0');
      const hh = mTime[3].padStart(2, '0');
      const min = mTime[4].padStart(2, '0');
      const yr = workDate.slice(0, 4) || '2026';
      createdAt = `${yr}-${mm}-${dd}T${hh}:${min}:00+07:00`;
    }

    const rawNote = String(r.note || '');
    const mPo = rawNote.match(/\[PO:\s*([^\]]+)\]/i);
    const poId = mPo ? mPo[1].trim() : 'PO-THEO-KH';
    const mCa = rawNote.match(/\[Ca:\s*(\d{2}:\d{2})-(\d{2}:\d{2})\]/i);
    const startTime = mCa ? mCa[1] : '06:00';
    const endTime = mCa ? mCa[2] : '14:00';
    const mImg = rawNote.match(/\[Ảnh:\s*([^\]]+)\]/i);
    const extractedPhotoUrl = mImg
      ? mImg[1].trim()
      : String(r.photoUrl || '').trim();
    const cleanNote = rawNote
      .replace(/\[PO:[^\]]*\]/gi, '')
      .replace(/\[Ca:[^\]]*\]/gi, '')
      .replace(/\[Rework:[^\]]*\]/gi, '')
      .replace(/\[Ảnh:[^\]]*\]/gi, '')
      .trim();

    const op = opsMap.get(ncId.toUpperCase());
    const worker = workersMap.get(wId.toUpperCase());
    const stdSeconds = Number(op?.stdSeconds || 1800);
    const costPerSec = Number(worker?.costPerSec || 13.37);
    const isSecond = /ghép|\+33%|0\.33|máy phụ|cắt dây/i.test(
      `${r.kpiStatus || ''} ${machineName}`
    );
    const machineMode: 'FIRST' | 'SECOND' = isSecond ? 'SECOND' : 'FIRST';
    const shiftType = String(r.shift || r.shiftType || 'Ca 1 (Sáng 06h-14h)');
    const isSunday = new Date(`${workDate}T12:00:00Z`).getUTCDay() === 0;

    const calcPayroll = calculateTurnPayroll(
      {
        workerId: wId || 'NV_GCCK',
        salaryMode: worker?.salaryMode || 'Khoán 1 + 0.33 máy',
        costPerSec,
        workDate,
        shiftType,
        startTime,
        endTime,
        overtimeMinutes: 0,
        isSunday,
        isLightsOut: shiftType.includes('Ca 3'),
        machineName,
        machineMode,
        machineCostPerHour: 250000,
        stdSeconds,
        stdEdgesPerPcs: Number(op?.stdEdgesPerPcs || 0),
        costPerEdge: Number(op?.costPerEdge || 0),
        okQty,
        reworkQty,
        scrapQty,
        defectType: scrapQty > 0 ? 'Lỗi gia công' : '',
        damageValue: 0,
        stopMinutes,
        stopReason: stopMinutes > 0 ? 'Dừng máy kỹ thuật' : 'Không có dừng máy',
      },
      {},
      DEFAULT_PAYROLL_CONFIG
    );

    result.push({
      id: numId,
      recordUid,
      createdAt,
      timeStr: timeStr || '08:00',
      workDate,
      shiftType,
      startTime,
      endTime,
      overtimeMinutes: 0,
      isSunday: isSunday ? 1 : 0,
      isLightsOut: shiftType.includes('Ca 3') ? 1 : 0,
      workerId: wId,
      workerName: wName || worker?.name || 'Công nhân GCCK',
      machineId: 'M01',
      machineName,
      machineMode,
      poId,
      spId: op?.spId || null,
      customer: String(r.customer || op?.customer || 'Vico - Nội bộ / Khách lẻ'),
      productName: String(r.productName || op?.productName || ''),
      ncId,
      opName: String(r.opName || op?.opName || ''),
      stage: String(r.stage || op?.stage || 'End'),
      stepOrder: Number(op?.stepOrder || 1),
      isFinalOp: Number(op?.isFinalOp ?? 1),
      stdSeconds,
      okQty,
      reworkQty,
      scrapQty,
      defectType: scrapQty > 0 ? 'Lỗi gia công' : '',
      damageValue: 0,
      stopMinutes,
      stopReason: stopMinutes > 0 ? 'Dừng máy kỹ thuật' : 'Không có dừng máy',
      toolCode: String(op?.toolCode || 'T03'),
      edgesUsed: calcPayroll.edgesConsumed || 0,
      selfCheckOk: 1,
      qcStatus: 'PASSED',
      pieceWage: calcPayroll.pieceWage,
      otBonusWage: calcPayroll.otBonusWage,
      waitWage: calcPayroll.waitWage,
      mealAllowance: calcPayroll.mealAllowance,
      scrapPenalty: calcPayroll.scrapPenalty,
      income: calcPayroll.turnTotalIncome,
      directPieceIncome: calcPayroll.directPieceIncome,
      batchCost: calcPayroll.batchCost,
      kpiPct: calcPayroll.kpiPct,
      kpiStatus: calcPayroll.kpiStatus,
      photoUrl: extractedPhotoUrl,
      handoverNote: cleanNote,
      materialLot: '',
      note: cleanNote,
      isVoided: 0,
    });
  }

  return result;
}

const STORAGE_KEY_URL = 'GCCK_SUPABASE_URL';
const STORAGE_KEY_KEY = 'GCCK_SUPABASE_ANON_KEY';

export function getStoredSupabaseConfig(): { url: string; anonKey: string } {
  if (typeof window === 'undefined') {
    return {
      url: bundledCloudConfig.supabaseUrl || '',
      anonKey: bundledCloudConfig.supabaseAnonKey || '',
    };
  }

  // 1. Auto-extract from URL query parameters (search or hash) so scanning QR or opening shared link auto-connects this phone/device
  try {
    const searchParams = new URLSearchParams(window.location.search);
    let hashParams: URLSearchParams | null = null;
    const hashIdx = window.location.hash.indexOf('?');
    if (hashIdx >= 0) {
      hashParams = new URLSearchParams(window.location.hash.slice(hashIdx + 1));
    }

    const qUrl = searchParams.get('sb_url') || hashParams?.get('sb_url');
    const qKey = searchParams.get('sb_key') || hashParams?.get('sb_key');

    if (qUrl && qKey) {
      saveStoredSupabaseConfig(qUrl, qKey);
      return { url: qUrl.trim(), anonKey: qKey.trim() };
    }
  } catch (err) {
    console.warn('URL Supabase config parse error:', err);
  }

  // 2. Check localStorage
  const localUrl = localStorage.getItem(STORAGE_KEY_URL) || '';
  const localKey = localStorage.getItem(STORAGE_KEY_KEY) || '';
  if (localUrl && localKey) {
    return { url: localUrl, anonKey: localKey };
  }

  // 3. Check Vite build-time environment variables
  const envUrl = (import.meta as any).env?.VITE_SUPABASE_URL || '';
  const envKey = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || '';
  if (envUrl && envKey) {
    return { url: envUrl, anonKey: envKey };
  }

  // 4. Check bundled configuration file
  const bundledUrl = bundledCloudConfig.supabaseUrl || '';
  const bundledKey = bundledCloudConfig.supabaseAnonKey || '';
  if (bundledUrl && bundledKey) {
    return { url: bundledUrl, anonKey: bundledKey };
  }

  return {
    url: localUrl || envUrl || bundledUrl,
    anonKey: localKey || envKey || bundledKey,
  };
}

export function generateSupabaseConnectUrl(overrideUrl?: string, overrideKey?: string): string {
  if (typeof window === 'undefined') return '';
  const cfg = getStoredSupabaseConfig();
  const url = overrideUrl || cfg.url;
  const key = overrideKey || cfg.anonKey;
  if (!url || !key) return '';

  const origin = window.location.origin;
  const pathname = window.location.pathname.replace(/\/$/, '');
  const baseUrl = `${origin}${pathname}`;
  return `${baseUrl}/?sb_url=${encodeURIComponent(url)}&sb_key=${encodeURIComponent(key)}#/worker`;
}

export function saveStoredSupabaseConfig(url: string, anonKey: string): void {
  if (typeof window === 'undefined') return;
  if (url.trim()) {
    localStorage.setItem(STORAGE_KEY_URL, url.trim());
  } else {
    localStorage.removeItem(STORAGE_KEY_URL);
  }
  if (anonKey.trim()) {
    localStorage.setItem(STORAGE_KEY_KEY, anonKey.trim());
  } else {
    localStorage.removeItem(STORAGE_KEY_KEY);
  }
  // Reset cached client
  cachedClient = null;
}

let cachedClient: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (cachedClient) return cachedClient;
  const { url, anonKey } = getStoredSupabaseConfig();
  if (!url || !anonKey) return null;

  try {
    cachedClient = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    });
    return cachedClient;
  } catch (err) {
    console.error('Failed to initialize Supabase client:', err);
    return null;
  }
}

export function isSupabaseConnected(): boolean {
  return Boolean(getSupabase());
}

/**
 * Pushes a newly created production log directly to Supabase cloud table `production_logs`.
 */
export async function pushLogToSupabase(log: Partial<ProductionLogDto>): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;

  try {
    const row = {
      record_uid: log.recordUid || `GCCK-${Date.now()}`,
      time_str: log.timeStr || '',
      work_date: log.workDate || new Date().toISOString().slice(0, 10),
      shift_type: log.shiftType || 'Ca 1 (Sáng 06h-14h)',
      start_time: log.startTime || '07:30',
      end_time: log.endTime || '16:30',
      overtime_minutes: log.overtimeMinutes || 0,
      is_sunday: log.isSunday || 0,
      is_lights_out: log.isLightsOut || 0,
      worker_id: log.workerId || '',
      worker_name: log.workerName || '',
      machine_id: log.machineId || 'M01',
      machine_name: log.machineName || '',
      machine_mode: log.machineMode || 'FIRST',
      po_id: log.poId || 'PO-THEO-KH',
      sp_id: log.spId || null,
      customer: log.customer || '',
      product_name: log.productName || '',
      nc_id: log.ncId || 'NC001',
      op_name: log.opName || '',
      stage: log.stage || 'End',
      step_order: log.stepOrder || 1,
      is_final_op: log.isFinalOp || 1,
      std_seconds: log.stdSeconds || 1800,
      ok_qty: log.okQty || 0,
      rework_qty: log.reworkQty || 0,
      scrap_qty: log.scrapQty || 0,
      defect_type: log.defectType || '',
      damage_value: log.damageValue || 0,
      stop_minutes: log.stopMinutes || 0,
      stop_reason: log.stopReason || 'Không có dừng máy',
      tool_code: log.toolCode || '',
      edges_used: log.edgesUsed || 0,
      self_check_ok: log.selfCheckOk ?? 1,
      qc_status: log.qcStatus || 'PASSED',
      piece_wage: log.pieceWage || 0,
      ot_bonus_wage: log.otBonusWage || 0,
      wait_wage: log.waitWage || 0,
      meal_allowance: log.mealAllowance || 0,
      scrap_penalty: log.scrapPenalty || 0,
      income: log.income || 0,
      direct_piece_income: log.directPieceIncome || 0,
      batch_cost: log.batchCost || 0,
      kpi_pct: log.kpiPct || 100,
      kpi_status: log.kpiStatus || 'Đạt 100% ĐM',
      // Tuyệt đối không lưu chuỗi ảnh base64 nặng vào Supabase để tránh tràn băng thông Egress (ảnh đã lưu trên Google Drive qua GAS)
      photo_url: log.photoUrl && !String(log.photoUrl).startsWith('data:') ? log.photoUrl : '',
      handover_note: log.handoverNote || '',
      material_lot: log.materialLot || '',
      note: log.note || '',
      is_voided: log.isVoided || 0,
    };

    // Làm mới cache GAS để lần tải kế tiếp lấy ngay bản ghi mới nhất
    gasInitDataCache = null;

    if (!supabaseQuotaRestricted) {
      const { error } = await sb.from('production_logs').insert([row]);
      if (!error) return true;
      if (String(error?.message || '').includes('exceed_egress_quota') || String(error?.message || '').includes('restricted')) {
        supabaseQuotaRestricted = true;
      }
    }
    return true;
  } catch (err) {
    console.warn('Error pushing log to Supabase:', err);
    return true;
  }
}

/**
 * Fetches recent logs from Supabase cloud database AND Google Apps Script Cloud.
 */
export async function fetchLogsFromSupabase(): Promise<ProductionLogDto[] | null> {
  const sb = getSupabase();
  let sbLogs: ProductionLogDto[] = [];

  if (sb && !supabaseQuotaRestricted) {
    try {
      const { data, error } = await sb
        .from('production_logs')
        .select(
          'id,record_uid,created_at,time_str,work_date,shift_type,start_time,end_time,overtime_minutes,is_sunday,is_lights_out,worker_id,worker_name,machine_id,machine_name,machine_mode,po_id,sp_id,customer,product_name,nc_id,op_name,stage,step_order,is_final_op,std_seconds,ok_qty,rework_qty,scrap_qty,defect_type,damage_value,stop_minutes,stop_reason,tool_code,edges_used,self_check_ok,qc_status,piece_wage,ot_bonus_wage,wait_wage,meal_allowance,scrap_penalty,income,direct_piece_income,batch_cost,kpi_pct,kpi_status,handover_note,material_lot,note,is_voided'
        )
        .order('id', { ascending: false })
        .limit(250);

      if (error) {
        if (
          String(error.message || '').includes('exceed_egress_quota') ||
          String(error.message || '').includes('restricted')
        ) {
          supabaseQuotaRestricted = true;
        }
      } else if (data && data.length > 0) {
        sbLogs = data.map((r: any) => ({
          id: Number(r.id),
          recordUid: r.record_uid,
          createdAt: r.created_at,
          timeStr: r.time_str || (r.created_at ? new Date(r.created_at).toLocaleTimeString('vi-VN') : ''),
          workDate: r.work_date,
          shiftType: r.shift_type,
          startTime: r.start_time,
          endTime: r.end_time,
          overtimeMinutes: Number(r.overtime_minutes || 0),
          isSunday: Number(r.is_sunday || 0),
          isLightsOut: Number(r.is_lights_out || 0),
          workerId: r.worker_id,
          workerName: r.worker_name,
          machineId: r.machine_id,
          machineName: r.machine_name,
          machineMode: r.machine_mode,
          poId: r.po_id,
          spId: r.sp_id,
          customer: r.customer,
          productName: r.product_name,
          ncId: r.nc_id,
          opName: r.op_name,
          stage: r.stage,
          stepOrder: Number(r.step_order || 1),
          isFinalOp: Number(r.is_final_op || 1),
          stdSeconds: Number(r.std_seconds || 0),
          okQty: Number(r.ok_qty || 0),
          reworkQty: Number(r.rework_qty || 0),
          scrapQty: Number(r.scrap_qty || 0),
          defectType: r.defect_type || '',
          damageValue: Number(r.damage_value || 0),
          stopMinutes: Number(r.stop_minutes || 0),
          stopReason: r.stop_reason || '',
          toolCode: r.tool_code || '',
          edgesUsed: Number(r.edges_used || 0),
          selfCheckOk: Number(r.self_check_ok || 1),
          qcStatus: r.qc_status || 'PASSED',
          pieceWage: Number(r.piece_wage || 0),
          otBonusWage: Number(r.ot_bonus_wage || 0),
          waitWage: Number(r.wait_wage || 0),
          mealAllowance: Number(r.meal_allowance || 0),
          scrapPenalty: Number(r.scrap_penalty || 0),
          income: Number(r.income || 0),
          directPieceIncome: Number(r.direct_piece_income || 0),
          batchCost: Number(r.batch_cost || 0),
          kpiPct: Number(r.kpi_pct || 100),
          kpiStatus: r.kpi_status || '',
          photoUrl: '',
          handoverNote: r.handover_note || '',
          materialLot: r.material_lot || '',
          note: r.note || '',
          isVoided: Number(r.is_voided || 0),
        }));
      }
    } catch (err) {
      console.warn('Failed to fetch logs from Supabase:', err);
    }
  }

  // Always fetch and merge recentLogs from Google Apps Script Cloud (which holds all 13/11 -> 17/11+ reports)
  let gasLogs: ProductionLogDto[] = [];
  try {
    const gasData = await fetchGasInitData();
    if (gasData && Array.isArray(gasData.recentLogs)) {
      gasLogs = convertGasRecentLogs(gasData.recentLogs);
    }
  } catch (err) {
    console.warn('GAS recentLogs fetch error:', err);
  }

  if (sbLogs.length === 0 && gasLogs.length === 0) return null;

  const deletedKeys = getLocalDeletedLogKeys();
  const mergedMap = new Map<string, ProductionLogDto>();
  const sigSet = new Set<string>();

  for (const l of [...gasLogs, ...sbLogs]) {
    if (!l || l.isVoided === 1) continue;
    const key = String(l.recordUid || l.id);
    if (deletedKeys.has(key) || deletedKeys.has(String(l.id))) continue;
    const sig = `${l.workDate}|${(l.workerId || l.workerName || '').toUpperCase()}|${(l.machineName || '').toLowerCase()}|${(l.ncId || l.opName || '').toUpperCase()}|${l.okQty}|${l.reworkQty}|${l.scrapQty}|${String(l.timeStr || '').trim().slice(0, 10)}`;
    if (sigSet.has(sig)) continue;
    sigSet.add(sig);
    mergedMap.set(key, l);
  }

  return Array.from(mergedMap.values()).sort((a, b) => {
    const dA = String(a.workDate || '').slice(0, 10);
    const dB = String(b.workDate || '').slice(0, 10);
    if (dA !== dB) return dB.localeCompare(dA);
    const tA = new Date(a.createdAt || a.workDate).getTime() || 0;
    const tB = new Date(b.createdAt || b.workDate).getTime() || 0;
    if (tA !== tB) return tB - tA;
    return (Number(b.id) || 0) - (Number(a.id) || 0);
  });
}

export async function deleteAllLogsFromSupabase(): Promise<boolean> {
  const sb = getSupabase();
  if (!sb || supabaseQuotaRestricted) return true;
  try {
    const { error } = await sb.from('production_logs').delete().gt('id', 0);
    if (error) {
      console.warn('Failed to clear Supabase logs:', error);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('Failed to delete logs from Supabase:', err);
    return false;
  }
}

export async function updateLogOnSupabase(
  id: number | string,
  recordUid: string | undefined,
  updates: Record<string, any>
): Promise<boolean> {
  const sb = getSupabase();
  if (!sb || supabaseQuotaRestricted) return true;
  try {
    const numId = Number(id);
    if (!Number.isNaN(numId) && numId > 0 && numId < 1e11) {
      const { data, error } = await sb
        .from('production_logs')
        .update(updates)
        .eq('id', numId)
        .select('id');
      if (!error && data && data.length > 0) {
        return true;
      }
    }
    if (recordUid) {
      const { error } = await sb
        .from('production_logs')
        .update(updates)
        .eq('record_uid', recordUid);
      if (error) {
        console.warn('Failed to update log on Supabase by record_uid:', error);
        return false;
      }
      return true;
    }
    return false;
  } catch (err) {
    console.warn('updateLogOnSupabase error:', err);
    return false;
  }
}

export async function deleteLogFromSupabase(
  id: number | string,
  recordUid?: string
): Promise<boolean> {
  const sb = getSupabase();
  if (!sb || supabaseQuotaRestricted) return true;
  try {
    let query = sb.from('production_logs').delete();
    if (recordUid) {
      query = query.eq('record_uid', recordUid);
    } else {
      query = query.eq('id', Number(id));
    }
    const { error } = await query;
    if (error) {
      console.warn('Failed to delete log from Supabase:', error);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('deleteLogFromSupabase error:', err);
    return false;
  }
}

export async function voidLogOnSupabase(
  id: number | string,
  recordUid?: string
): Promise<boolean> {
  return deleteLogFromSupabase(id, recordUid);
}

/**
 * Subscribes to real-time additions on `production_logs`.
 */
export function subscribeSupabaseLogChanges(onChange: () => void): (() => void) | null {
  const sb = getSupabase();
  if (!sb || supabaseQuotaRestricted) return null;

  try {
    const channel = sb
      .channel('public:production_logs')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'production_logs' },
        () => {
          onChange();
        }
      )
      .subscribe();

    return () => {
      void sb.removeChannel(channel);
    };
  } catch {
    return null;
  }
}

function packPlanRowsCompact(rows: DailyPlanRow[]): any[] {
  return rows.map((r, idx) => [
    r.shiftType || 'Ca 1',
    Number(r.stt) || idx + 1,
    (r.workerName || '').trim(),
    (r.customer || '').trim(),
    r.spId || '',
    (r.productName || '').trim(),
    r.ncId || '',
    (r.opName || '').trim(),
    Number(r.plannedQty) || 0,
    (r.machineName || '').trim(),
    (r.note || '').trim(),
  ]);
}

function unpackPlanRowsCompact(workDate: string, compactList: any[]): DailyPlanRow[] {
  if (!Array.isArray(compactList)) return [];
  return compactList.map((item, idx) => {
    if (Array.isArray(item)) {
      const note = String(item[10] || '');
      return {
        workDate,
        shiftType: String(item[0] || 'Ca 1'),
        stt: Number(item[1]) || idx + 1,
        workerName: String(item[2] || ''),
        customer: String(item[3] || ''),
        spId: String(item[4] || ''),
        productName: String(item[5] || ''),
        ncId: String(item[6] || ''),
        opName: String(item[7] || ''),
        plannedQty: Number(item[8] || 0),
        machineName: String(item[9] || ''),
        note,
        actualQty: 0,
        status: 'PLANNED',
        isOvertime: /tăng ca/i.test(note),
        overtimeHours: /tăng ca\s*(\d+)h/i.test(note)
          ? Number(RegExp.$1)
          : /tăng ca/i.test(note)
            ? 2
            : undefined,
      };
    }
    return {
      ...item,
      workDate: item.workDate || workDate,
      stt: Number(item.stt) || idx + 1,
    };
  });
}

async function pushDailyPlanToGasCloud(workDate: string, rows: DailyPlanRow[]): Promise<boolean> {
  try {
    // Do not overwrite a real cloud plan with an unmodified default baseline
    if (isUnmodifiedBaselinePlan(rows)) {
      const existingCompact = gasPlansMapCache[workDate];
      if (existingCompact && existingCompact.length > 0) {
        const existingRows = unpackPlanRowsCompact(workDate, existingCompact);
        if (!isUnmodifiedBaselinePlan(existingRows)) {
          return true;
        }
      }
    }

    if (Object.keys(gasPlansMapCache).length === 0 && !gasInitDataCache) {
      await fetchGasInitData();
    }
    const nextMap: Record<string, any[]> = { ...gasPlansMapCache };
    if (!rows || rows.length === 0) {
      delete nextMap[workDate];
    } else {
      nextMap[workDate] = packPlanRowsCompact(rows);
    }

    // Keep at most 6 most recent dates so cell size stays well below 30KB
    const sortedDates = Object.keys(nextMap)
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort((a, b) => b.localeCompare(a))
      .slice(0, 6);
    const trimmedMap: Record<string, any[]> = {};
    for (const d of sortedDates) {
      trimmedMap[d] = nextMap[d];
    }
    gasPlansMapCache = trimmedMap;

    const resp = await fetch(GAS_CLOUD_SYNC_URL, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'saveWorkerChatIdManual',
        payload: {
          workerId: 'NV00053',
          manualChatId: 'PLAN_SYNC:' + JSON.stringify(trimmedMap),
        },
      }),
    });
    return resp.ok;
  } catch (err) {
    console.warn('GAS daily plan sync warning:', err);
    return false;
  }
}

/**
 * Push daily plan rows for a specific date to Supabase table `daily_schedule_rows` AND Google Apps Script Cloud.
 */
export async function pushDailyPlanToSupabase(workDate: string, rows: DailyPlanRow[]): Promise<boolean> {
  if (!workDate) return false;
  const fullRows = rows && rows.length > 0 ? mergePlanWithBaseline(rows, workDate) : [];

  // 1. Push to Google Apps Script Cloud (always available, unlimited quota)
  const gasOkPromise = pushDailyPlanToGasCloud(workDate, fullRows);

  // 2. Also push to Supabase if available and not quota-restricted
  let sbOk = false;
  const sb = getSupabase();
  if (sb && !supabaseQuotaRestricted) {
    try {
      const { error: delError } = await sb
        .from('daily_schedule_rows')
        .delete()
        .eq('work_date', workDate);
      if (delError) {
        if (
          String(delError.message || '').includes('exceed_egress_quota') ||
          String(delError.message || '').includes('restricted')
        ) {
          supabaseQuotaRestricted = true;
        }
      } else if (fullRows.length > 0) {
        const dbRows = fullRows.map((r, idx) => ({
          work_date: workDate,
          shift_type: r.shiftType || 'Ca 2',
          stt: Number(r.stt) || idx + 1,
          worker_name: (r.workerName || '').trim(),
          customer: (r.customer || '').trim(),
          sp_id: r.spId || '',
          product_name: (r.productName || '').trim(),
          nc_id: r.ncId || '',
          op_name: (r.opName || '').trim(),
          planned_qty: Number(r.plannedQty) || 0,
          machine_name: (r.machineName || '').trim(),
          note: (r.note || '').trim(),
          actual_qty: Number(r.actualQty) || 0,
          drawing_url: r.drawingUrl || '',
          status: r.status || 'PLANNED',
        }));

        let allBatchesOk = true;
        for (let i = 0; i < dbRows.length; i += 50) {
          const batch = dbRows.slice(i, i + 50);
          const { error: insError } = await sb.from('daily_schedule_rows').insert(batch);
          if (insError) {
            allBatchesOk = false;
            break;
          }
        }
        sbOk = allBatchesOk;
      } else {
        sbOk = true;
      }
    } catch {
      sbOk = false;
    }
  }

  const gasOk = await gasOkPromise;
  return sbOk || gasOk;
}

/**
 * Fetch daily plan rows from Supabase cloud table `daily_schedule_rows` OR Google Apps Script Cloud.
 */
export async function fetchDailyPlanFromSupabase(workDate: string): Promise<DailyPlanRow[] | null> {
  if (!workDate) return null;

  // 1. Check Google Apps Script Cloud first (or alongside Supabase)
  try {
    await fetchGasInitData();
    const compact = gasPlansMapCache[workDate];
    if (Array.isArray(compact) && compact.length > 0) {
      const unpacked = unpackPlanRowsCompact(workDate, compact);
      if (unpacked.length > 0) {
        return mergePlanWithBaseline(unpacked, workDate);
      }
    }
  } catch { }

  // 2. Check Supabase if not quota-restricted
  const sb = getSupabase();
  if (!sb || supabaseQuotaRestricted) return null;

  try {
    const { data, error } = await sb
      .from('daily_schedule_rows')
      .select('*')
      .eq('work_date', workDate)
      .order('stt', { ascending: true })
      .order('id', { ascending: true });

    if (error) {
      if (
        String(error.message || '').includes('exceed_egress_quota') ||
        String(error.message || '').includes('restricted')
      ) {
        supabaseQuotaRestricted = true;
      }
      return null;
    }
    if (!data || data.length === 0) return null;

    const mapped = data.map((r: any) => ({
      id: Number(r.id),
      workDate: r.work_date,
      shiftType: r.shift_type || 'Ca 2',
      stt: Number(r.stt || 1),
      workerName: r.worker_name || '',
      customer: r.customer || '',
      spId: r.sp_id || '',
      productName: r.product_name || '',
      ncId: r.nc_id || '',
      opName: r.op_name || '',
      plannedQty: Number(r.planned_qty || 0),
      machineName: r.machine_name || '',
      note: r.note || '',
      actualQty: Number(r.actual_qty || 0),
      drawingUrl: r.drawing_url || '',
      status: r.status || 'PLANNED',
      isOvertime: /tăng ca/i.test(r.note || ''),
      overtimeHours: /tăng ca\s*(\d+)h/i.test(r.note || '')
        ? Number(RegExp.$1)
        : /tăng ca/i.test(r.note || '')
          ? 2
          : undefined,
    }));

    return mergePlanWithBaseline(mapped, workDate);
  } catch (err) {
    console.warn('Failed to fetch daily plan from Supabase:', err);
    return null;
  }
}

/**
 * Fetch available dates that have daily schedules from Supabase OR Google Apps Script Cloud.
 */
export async function fetchDailyDatesFromSupabase(): Promise<
  { workDate: string; rowCount: number; workerCount: number }[] | null
> {
  const dateMap = new Map<string, { rows: number; workers: Set<string> }>();

  try {
    await fetchGasInitData();
    for (const [d, compact] of Object.entries(gasPlansMapCache)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !Array.isArray(compact) || compact.length === 0) continue;
      const unpacked = unpackPlanRowsCompact(d, compact);
      const workers = new Set<string>();
      for (const r of unpacked) {
        if (r.workerName) workers.add(r.workerName);
      }
      dateMap.set(d, { rows: unpacked.length, workers });
    }
  } catch { }

  const sb = getSupabase();
  if (sb && !supabaseQuotaRestricted) {
    try {
      const { data, error } = await sb
        .from('daily_schedule_rows')
        .select('work_date, worker_name')
        .order('work_date', { ascending: false });

      if (error) {
        if (
          String(error.message || '').includes('exceed_egress_quota') ||
          String(error.message || '').includes('restricted')
        ) {
          supabaseQuotaRestricted = true;
        }
      } else if (data && data.length > 0) {
        for (const row of data) {
          const d = row.work_date;
          if (!d || dateMap.has(d)) continue;
          const entry = dateMap.get(d) || { rows: 0, workers: new Set<string>() };
          entry.rows += 1;
          if (row.worker_name) entry.workers.add(row.worker_name);
          dateMap.set(d, entry);
        }
      }
    } catch { }
  }

  if (dateMap.size === 0) return null;

  return Array.from(dateMap.entries())
    .map(([workDate, meta]) => ({
      workDate,
      rowCount: meta.rows,
      workerCount: meta.workers.size,
    }))
    .sort((a, b) => b.workDate.localeCompare(a.workDate));
}

/**
 * Delete daily plan for a specific date from Supabase AND Google Apps Script Cloud.
 */
export async function deleteDailyPlanFromSupabase(workDate: string): Promise<boolean> {
  if (!workDate) return false;
  void pushDailyPlanToGasCloud(workDate, []);
  const sb = getSupabase();
  if (!sb || supabaseQuotaRestricted) return true;

  try {
    const { error } = await sb.from('daily_schedule_rows').delete().eq('work_date', workDate);
    return !error;
  } catch {
    return true;
  }
}

/**
 * Subscribes to real-time additions/updates on `daily_schedule_rows`.
 */
export function subscribeSupabaseDailyPlanChanges(onChange: () => void): (() => void) | null {
  const sb = getSupabase();
  if (!sb || supabaseQuotaRestricted) return null;

  try {
    const channel = sb
      .channel('public:daily_schedule_rows')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'daily_schedule_rows' },
        () => {
          onChange();
        }
      )
      .subscribe();

    return () => {
      void sb.removeChannel(channel);
    };
  } catch {
    return null;
  }
}


