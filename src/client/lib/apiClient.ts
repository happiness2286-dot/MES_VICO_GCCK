import {
  getAllFallbackLogs,
  getFallbackAndonLive,
  getFallbackBootstrap,
  getFallbackHandovers,
  getFallbackSession,
  getFallbackTraveler,
  getFallbackUser,
  getFallbackWeeklyReport,
  saveFallbackHandover,
  submitDirectToGoogleAppsScript,
  FALLBACK_PRODUCTS,
} from './clientFallbackStore';
import { isStaticHost } from './navigation';

export const AUTH_TOKEN_STORAGE_KEY = 'GCCK_SESSION_TOKEN';

export class ApiError extends Error {
  status: number;
  data: unknown;

  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

export function getStoredAuthToken(): string | null {
  try {
    return localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredAuthToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    }
  } catch {
    // ignore storage quota/privacy errors
  }
}

function resolveApiUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('/api/')) {
    return path;
  }
  if (path.startsWith('/')) {
    return `/api/v1${path}`;
  }
  return `/api/v1/${path}`;
}

export interface ApiFetchOptions extends RequestInit {
  timeoutMs?: number;
  json?: unknown;
}

export async function apiFetch<T = any>(
  path: string,
  options: ApiFetchOptions = {}
): Promise<T> {
  // If running on static host (GitHub Pages), resolve directly with client fallback without network latency or 405 errors
  if (isStaticHost()) {
    const fallback = handleClientFallback<T>(path, options);
    if (fallback !== null) return fallback;
  }

  const { timeoutMs = 15000, json, headers, ...rest } = options;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  const reqHeaders = new Headers(headers || undefined);
  const storedToken = getStoredAuthToken();
  if (storedToken && !reqHeaders.has('Authorization')) {
    reqHeaders.set('Authorization', `Bearer ${storedToken}`);
  }

  let body = rest.body;
  if (json !== undefined) {
    reqHeaders.set('Content-Type', 'application/json');
    body = JSON.stringify(json);
  } else if (body && typeof body === 'string' && !reqHeaders.has('Content-Type')) {
    reqHeaders.set('Content-Type', 'application/json');
  }

  try {
    const resp = await fetch(resolveApiUrl(path), {
      ...rest,
      headers: reqHeaders,
      body,
      credentials: 'include',
      signal: ctrl.signal,
    });

    const contentType = resp.headers.get('content-type') || '';
    const payload = contentType.includes('application/json')
      ? await resp.json()
      : await resp.text();

    if (!resp.ok) {
      const fallback = handleClientFallback<T>(path, options);
      if (fallback !== null) return fallback;

      const msg =
        (payload && typeof payload === 'object' && 'error' in payload && String((payload as any).error)) ||
        `Lỗi kết nối máy chủ (HTTP ${resp.status})`;
      throw new ApiError(msg, resp.status, payload);
    }

    return payload as T;
  } catch (err: any) {
    const fallback = handleClientFallback<T>(path, options);
    if (fallback !== null) return fallback;

    if (err instanceof ApiError) throw err;
    if (err?.name === 'AbortError') {
      throw new ApiError('Quá thời gian phản hồi từ máy chủ (Timeout).', 0);
    }
    throw new ApiError(
      err?.message || 'Mất kết nối mạng xưởng Wi-Fi.',
      0
    );
  } finally {
    clearTimeout(timer);
  }
}

function handleClientFallback<T>(path: string, options: ApiFetchOptions): T | null {
  const norm = path.toLowerCase();

  if (norm.includes('/auth/session')) {
    return getFallbackSession() as unknown as T;
  }
  if (norm.includes('/auth/quick-switch')) {
    const body = options.json as any;
    const workerId = body?.workerId || 'NV_KT02';
    const user = getFallbackUser(workerId);
    return {
      token: `client-demo-token-${workerId}`,
      user,
      authMode: 'DEMO_QUICK',
    } as unknown as T;
  }
  if (norm.includes('/auth/login')) {
    const body = options.json as any;
    const workerId = body?.workerId || 'NV00053';
    const user = getFallbackUser(workerId);
    return {
      token: `client-demo-token-${workerId}`,
      user,
      authMode: 'DEMO_QUICK',
    } as unknown as T;
  }
  if (norm.includes('/bootstrap')) {
    return getFallbackBootstrap() as unknown as T;
  }
  if (norm.includes('/schedules/daily-dates')) {
    return {
      success: true,
      dates: [
        { workDate: '2026-10-21', rowCount: 39, workerCount: 13 },
        { workDate: '2026-10-22', rowCount: 39, workerCount: 13 },
      ],
    } as unknown as T;
  }
  if (norm.includes('/schedules/daily')) {
    return { success: true, rows: [] } as unknown as T;
  }
  if (norm.includes('/andon/live')) {
    return getFallbackAndonLive() as unknown as T;
  }
  if (norm.includes('/costing')) {
    return FALLBACK_PRODUCTS as unknown as T;
  }
  if (norm.includes('/logs')) {
    if (options.method === 'PATCH' || options.method === 'DELETE') {
      return { success: true } as unknown as T;
    }
    return { items: getAllFallbackLogs() } as unknown as T;
  }
  if (norm.includes('/qc/inspections')) {
    return [] as unknown as T;
  }
  if (norm.includes('/traveler')) {
    const parts = path.split('/').filter(Boolean);
    const poIdx = parts.indexOf('orders');
    const poId = poIdx >= 0 && parts[poIdx + 1] ? decodeURIComponent(parts[poIdx + 1]) : 'PO485-01';
    return getFallbackTraveler(poId) as unknown as T;
  }
  if (norm.includes('/reports/weekly')) {
    if (options.method === 'POST' || options.method === 'DELETE' || options.method === 'PATCH') {
      return { success: true } as unknown as T;
    }
    const urlParams = new URLSearchParams(path.split('?')[1] || '');
    const wStart = urlParams.get('weekStart') || '2026-10-15';
    return getFallbackWeeklyReport(wStart) as unknown as T;
  }
  if (norm.includes('/reports/preview')) {
    return {
      payroll: {
        effectiveMachineMode: 'FIRST',
        machRate: 1,
        shiftMult: 1,
        isSunday: false,
        effectiveOtMinutes: 0,
        unpaidOtMinutes: 0,
        effectivePaidStopMinutes: 0,
        isMonthlyStaff: false,
        unitPiecePrice: 35000,
        earnedStdSeconds: 1800,
        netWorkSeconds: 28800,
        basePieceWage: 35000,
        otBonusWage: 0,
        waitWage: 0,
        pieceWage: 35000,
        directPieceIncome: 35000,
        mealAllowance: 0,
        scrapPenalty: 0,
        turnTotalIncome: 35000,
        costingLaborCost: 35000,
        costingMachCost: 0,
        costingToolCost: 0,
        costingScrapLoss: 0,
        batchCost: 35000,
        kpiPct: 100,
        kpiStatus: 'DAT_MUC',
        edgesConsumed: 0,
      },
      warnings: [],
    } as unknown as T;
  }
  if (norm.includes('/master/tools/swap')) {
    return { success: true, message: 'Đã đổi dao thành công' } as unknown as T;
  }
  if (norm.includes('/reports') && options.method === 'POST') {
    const body = (options.json || {}) as any;
    void submitDirectToGoogleAppsScript(body);
    const mockRes = submitDirectToGoogleAppsScript(body);
    return mockRes as unknown as T;
  }
  if (norm.includes('/handovers')) {
    if (options.method === 'POST') {
      const body = options.json as any;
      if (body) saveFallbackHandover(body);
      return { success: true, item: body } as unknown as T;
    }
    return getFallbackHandovers() as unknown as T;
  }

  return null;
}

export const apiClient = {
  get: <T = any>(path: string, opts?: ApiFetchOptions) =>
    apiFetch<T>(path, { ...opts, method: 'GET' }),
  post: <T = any>(path: string, json?: unknown, opts?: ApiFetchOptions) =>
    apiFetch<T>(path, { ...opts, method: 'POST', json }),
  put: <T = any>(path: string, json?: unknown, opts?: ApiFetchOptions) =>
    apiFetch<T>(path, { ...opts, method: 'PUT', json }),
  patch: <T = any>(path: string, json?: unknown, opts?: ApiFetchOptions) =>
    apiFetch<T>(path, { ...opts, method: 'PATCH', json }),
  delete: <T = any>(path: string, opts?: ApiFetchOptions) =>
    apiFetch<T>(path, { ...opts, method: 'DELETE' }),
};
