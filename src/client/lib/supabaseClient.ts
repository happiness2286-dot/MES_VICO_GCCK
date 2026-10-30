import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { ProductionLogDto } from '@shared/types';

const STORAGE_KEY_URL = 'GCCK_SUPABASE_URL';
const STORAGE_KEY_KEY = 'GCCK_SUPABASE_ANON_KEY';

export function getStoredSupabaseConfig(): { url: string; anonKey: string } {
  if (typeof window === 'undefined') {
    return { url: '', anonKey: '' };
  }
  const envUrl = (import.meta as any).env?.VITE_SUPABASE_URL || '';
  const envKey = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || '';

  const localUrl = localStorage.getItem(STORAGE_KEY_URL) || '';
  const localKey = localStorage.getItem(STORAGE_KEY_KEY) || '';

  return {
    url: localUrl || envUrl,
    anonKey: localKey || envKey,
  };
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
