import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { ProductionLogDto, DailyPlanRow } from '@shared/types';
import { mergePlanWithBaseline } from './baselinePlan';
import bundledCloudConfig from '../config/cloudConfig.json';

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
      photo_url: log.photoUrl || '',
      handover_note: log.handoverNote || '',
      material_lot: log.materialLot || '',
      note: log.note || '',
      is_voided: log.isVoided || 0,
    };

    const { error } = await sb.from('production_logs').insert([row]);
    if (error) {
      console.warn('Supabase insert warning:', error);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('Error pushing log to Supabase:', err);
    return false;
  }
}

/**
 * Fetches recent logs from Supabase cloud database.
 */
export async function fetchLogsFromSupabase(): Promise<ProductionLogDto[] | null> {
  const sb = getSupabase();
  if (!sb) return null;

  try {
    const { data, error } = await sb
      .from('production_logs')
      .select('*')
      .neq('is_voided', 1)
      .order('id', { ascending: false })
      .limit(200);

    if (error || !data) return null;

    return data.map((r: any) => ({
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
      photoUrl: r.photo_url || '',
      handoverNote: r.handover_note || '',
      materialLot: r.material_lot || '',
      note: r.note || '',
      isVoided: Number(r.is_voided || 0),
    }));
  } catch (err) {
    console.warn('Failed to fetch logs from Supabase:', err);
    return null;
  }
}

export async function deleteAllLogsFromSupabase(): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
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
  if (!sb) return false;
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
  if (!sb) return false;
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
  if (!sb) return null;

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

/**
 * Push daily plan rows for a specific date to Supabase table `daily_schedule_rows`.
 */
export async function pushDailyPlanToSupabase(workDate: string, rows: DailyPlanRow[]): Promise<boolean> {
  const sb = getSupabase();
  if (!sb || !workDate) return false;

  try {
    // 1. Delete previous rows for this workDate
    const { error: delError } = await sb
      .from('daily_schedule_rows')
      .delete()
      .eq('work_date', workDate);
    if (delError) {
      console.warn('Supabase delete daily plan error:', delError);
    }

    if (!rows || rows.length === 0) return true;

    // Bulletproof safeguard: ensure we never wipe out the full factory roster
    const fullRows = mergePlanWithBaseline(rows, workDate);

    // 2. Map rows to Supabase table schema
    const dbRows = fullRows.map((r, idx) => ({
      work_date: workDate,
      shift_type: r.shiftType || 'Ca 2',
      stt: Number(r.stt) || (idx + 1),
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

    // Insert in batches of 50 to avoid payload limits
    for (let i = 0; i < dbRows.length; i += 50) {
      const batch = dbRows.slice(i, i + 50);
      const { error: insError } = await sb.from('daily_schedule_rows').insert(batch);
      if (insError) {
        console.warn('Supabase insert daily plan batch error:', insError);
        return false;
      }
    }

    return true;
  } catch (err) {
    console.warn('Failed to push daily plan to Supabase:', err);
    return false;
  }
}

/**
 * Fetch daily plan rows from Supabase cloud table `daily_schedule_rows`.
 */
export async function fetchDailyPlanFromSupabase(workDate: string): Promise<DailyPlanRow[] | null> {
  const sb = getSupabase();
  if (!sb || !workDate) return null;

  try {
    const { data, error } = await sb
      .from('daily_schedule_rows')
      .select('*')
      .eq('work_date', workDate)
      .order('stt', { ascending: true })
      .order('id', { ascending: true });

    if (error || !data || data.length === 0) return null;

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
        : (/tăng ca/i.test(r.note || '') ? 2 : undefined),
    }));

    return mergePlanWithBaseline(mapped, workDate);
  } catch (err) {
    console.warn('Failed to fetch daily plan from Supabase:', err);
    return null;
  }
}

/**
 * Fetch available dates that have daily schedules from Supabase.
 */
export async function fetchDailyDatesFromSupabase(): Promise<{ workDate: string; rowCount: number; workerCount: number }[] | null> {
  const sb = getSupabase();
  if (!sb) return null;

  try {
    const { data, error } = await sb
      .from('daily_schedule_rows')
      .select('work_date, worker_name')
      .order('work_date', { ascending: false });

    if (error || !data || data.length === 0) return null;

    const dateMap = new Map<string, { rows: number; workers: Set<string> }>();
    for (const row of data) {
      const d = row.work_date;
      if (!d) continue;
      const entry = dateMap.get(d) || { rows: 0, workers: new Set<string>() };
      entry.rows += 1;
      if (row.worker_name) entry.workers.add(row.worker_name);
      dateMap.set(d, entry);
    }

    return Array.from(dateMap.entries())
      .map(([workDate, meta]) => ({
        workDate,
        rowCount: meta.rows,
        workerCount: meta.workers.size,
      }))
      .sort((a, b) => b.workDate.localeCompare(a.workDate));
  } catch (err) {
    console.warn('Failed to fetch daily dates from Supabase:', err);
    return null;
  }
}

/**
 * Delete daily plan for a specific date from Supabase.
 */
export async function deleteDailyPlanFromSupabase(workDate: string): Promise<boolean> {
  const sb = getSupabase();
  if (!sb || !workDate) return false;

  try {
    const { error } = await sb.from('daily_schedule_rows').delete().eq('work_date', workDate);
    return !error;
  } catch {
    return false;
  }
}

/**
 * Subscribes to real-time additions/updates on `daily_schedule_rows`.
 */
export function subscribeSupabaseDailyPlanChanges(onChange: () => void): (() => void) | null {
  const sb = getSupabase();
  if (!sb) return null;

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


