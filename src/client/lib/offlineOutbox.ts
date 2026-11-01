import type { ReportSubmitPayload, ReportSubmitResponse } from '@shared/types';
import { apiFetch, ApiError } from './apiClient';
import { submitDirectToGoogleAppsScript } from './clientFallbackStore';
import { isSupabaseConnected, pushLogToSupabase } from './supabaseClient';

const OUTBOX_STORAGE_KEY = 'GCCK_OFFLINE_OUTBOX_V1';
const OUTBOX_EVENT_NAME = 'gcck:outbox-changed';

export interface QueuedOfflineReport {
  recordUid: string;
  queuedAt: string;
  payload: ReportSubmitPayload;
  attempts: number;
  lastError?: string;
}

function emitOutboxChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(OUTBOX_EVENT_NAME));
  }
}

export function getOfflineOutbox(): QueuedOfflineReport[] {
  try {
    const raw = localStorage.getItem(OUTBOX_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveOfflineOutbox(items: QueuedOfflineReport[]): void {
  try {
    localStorage.setItem(OUTBOX_STORAGE_KEY, JSON.stringify(items));
    emitOutboxChanged();
  } catch {
    // ignore storage errors
  }
}

export function generateIdempotentRecordUid(ncId: string = 'NC'): string {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const randPart =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8).toUpperCase()
      : Math.random().toString(36).slice(2, 10).toUpperCase();
  return `GCCK-${datePart}-${ncId}-${randPart}`;
}

export function enqueueOfflineReport(payload: ReportSubmitPayload): QueuedOfflineReport {
  const recordUid = payload.recordUid || generateIdempotentRecordUid(payload.ncId || 'NC');
  const enrichedPayload: ReportSubmitPayload = { ...payload, recordUid };
  const items = getOfflineOutbox();
  const existingIdx = items.findIndex((i) => i.recordUid === recordUid);

  const entry: QueuedOfflineReport = {
    recordUid,
    queuedAt: new Date().toISOString(),
    payload: enrichedPayload,
    attempts: existingIdx >= 0 ? items[existingIdx].attempts : 0,
  };

  if (existingIdx >= 0) {
    items[existingIdx] = entry;
  } else {
    items.push(entry);
  }
  saveOfflineOutbox(items);
  return entry;
}

export function removeOfflineReport(recordUid: string): void {
  const filtered = getOfflineOutbox().filter((i) => i.recordUid !== recordUid);
  saveOfflineOutbox(filtered);
}

let isFlushing = false;

export async function flushOfflineOutbox(): Promise<{ synced: number; remaining: number }> {
  if (isFlushing) {
    return { synced: 0, remaining: getOfflineOutbox().length };
  }
  const items = getOfflineOutbox();
  if (items.length === 0) return { synced: 0, remaining: 0 };

  isFlushing = true;
  let synced = 0;
  const remainingItems: QueuedOfflineReport[] = [];

  try {
    for (const item of items) {
      try {
        await apiFetch<ReportSubmitResponse>('/api/v1/reports', {
          method: 'POST',
          json: item.payload,
          timeoutMs: 12000,
        });
        synced++;
      } catch (err: any) {
        // Try direct GAS sync if backend unavailable
        try {
          await submitDirectToGoogleAppsScript(item.payload);
          synced++;
        } catch {
          const isValidationErr = err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 404;
          const nextAttempts = item.attempts + 1;
          if (!isValidationErr || nextAttempts < 3) {
            remainingItems.push({
              ...item,
              attempts: nextAttempts,
              lastError: String(err?.message || err),
            });
          }
        }
      }
    }
    saveOfflineOutbox(remainingItems);
    return { synced, remaining: remainingItems.length };
  } finally {
    isFlushing = false;
  }
}

export async function submitReportWithOfflineFallback(
  payload: ReportSubmitPayload
): Promise<{ queuedOffline: boolean; response?: ReportSubmitResponse; queuedItem?: QueuedOfflineReport }> {
  const recordUid = payload.recordUid || generateIdempotentRecordUid(payload.ncId || 'NC');
  const finalPayload: ReportSubmitPayload = { ...payload, recordUid };

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    const queuedItem = enqueueOfflineReport(finalPayload);
    return { queuedOffline: true, queuedItem };
  }

  try {
    const response = await apiFetch<ReportSubmitResponse>('/api/v1/reports', {
      method: 'POST',
      json: finalPayload,
    });
    // If Supabase Cloud is configured, also push log for remote / GitHub Pages viewers
    if (response?.log && isSupabaseConnected()) {
      void pushLogToSupabase(response.log).catch((err) =>
        console.warn('Background Supabase sync notice:', err)
      );
    }
    return { queuedOffline: false, response };
  } catch {
    // If backend 404 (GitHub Pages) or offline, submit directly to Google Apps Script
    try {
      const gasResp = await submitDirectToGoogleAppsScript(finalPayload);
      return { queuedOffline: false, response: gasResp };
    } catch {
      const queuedItem = enqueueOfflineReport(finalPayload);
      return { queuedOffline: true, queuedItem };
    }
  }
}

export function subscribeOfflineOutbox(onUpdate: (items: QueuedOfflineReport[]) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = () => onUpdate(getOfflineOutbox());
  const onlineHandler = () => {
    void flushOfflineOutbox();
  };
  window.addEventListener(OUTBOX_EVENT_NAME, handler);
  window.addEventListener('storage', handler);
  window.addEventListener('online', onlineHandler);
  return () => {
    window.removeEventListener(OUTBOX_EVENT_NAME, handler);
    window.removeEventListener('storage', handler);
    window.removeEventListener('online', onlineHandler);
  };
}
