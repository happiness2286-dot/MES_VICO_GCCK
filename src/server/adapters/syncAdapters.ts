import type { DatabaseSync } from 'node:sqlite';
import type { SyncOutboxItem } from '../../shared/types';

export function escapeTelegramHtml(raw: string): string {
  return String(raw ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function enqueueOutboxEvent(
  db: DatabaseSync,
  channel: 'GAS_WEBHOOK' | 'TELEGRAM',
  eventType: string,
  payload: Record<string, unknown>
): number {
  const res = db
    .prepare(
      `INSERT INTO sync_outbox (channel, event_type, payload_json, status)
       VALUES (?, ?, ?, 'PENDING')`
    )
    .run(channel, eventType, JSON.stringify(payload));
  return Number(res.lastInsertRowid);
}

export async function flushPendingOutbox(
  db: DatabaseSync,
  limit: number = 25
): Promise<{ processed: number; sent: number; skipped: number; failed: number }> {
  const rows = db
    .prepare(
      `SELECT id, channel, event_type, payload_json, attempts
       FROM sync_outbox
       WHERE status IN ('PENDING', 'FAILED') AND attempts < 3
       ORDER BY id ASC
       LIMIT ?`
    )
    .all(limit) as Array<Record<string, any>>;

  const cfgRows = db.prepare('SELECT key, value FROM system_config').all() as Array<{
    key: string;
    value: string;
  }>;
  const cfg = Object.fromEntries(cfgRows.map((r) => [r.key, r.value]));

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const r of rows) {
    const id = Number(r.id);
    const channel = String(r.channel);
    const attempts = Number(r.attempts) + 1;

    try {
      if (channel === 'TELEGRAM') {
        const botToken = (cfg.TELEGRAM_BOT_TOKEN || '').trim();
        const parsed = JSON.parse(String(r.payload_json || '{}'));
        const eventType = String(r.event_type || '');
        // Không dùng fallback MANAGER_CHAT_ID cho biên nhận cá nhân thợ để tránh spam máy Quản Đốc
        const targetChatId = parsed.chatId
          ? String(parsed.chatId).trim()
          : (eventType !== 'WORKER_RECEIPT' ? (cfg.MANAGER_CHAT_ID || '').trim() : '');

        if (!botToken || !targetChatId) {
          db.prepare(
            `UPDATE sync_outbox SET status = 'SKIPPED', attempts = ?, last_error = 'Bỏ qua tin nhắn không có Chat ID hợp lệ' WHERE id = ?`
          ).run(attempts, id);
          skipped++;
          continue;
        }
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 4000);
        try {
          const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: targetChatId,
              text: escapeTelegramHtml(String(parsed.text || '')),
              parse_mode: 'HTML',
            }),
            signal: ctrl.signal,
          });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          db.prepare(
            `UPDATE sync_outbox SET status = 'SENT', attempts = ?, sent_at = datetime('now'), last_error = NULL WHERE id = ?`
          ).run(attempts, id);
          sent++;
        } finally {
          clearTimeout(timer);
        }
      } else if (channel === 'GAS_WEBHOOK') {
        const webAppUrl = (cfg.WEB_APP_URL || '').trim();
        const syncEnabled = cfg.GAS_SYNC_ENABLED !== '0';
        if (!webAppUrl || !syncEnabled) {
          db.prepare(
            `UPDATE sync_outbox SET status = 'SKIPPED', attempts = ?, last_error = 'Đồng bộ GAS đang tắt hoặc chưa cấu hình URL' WHERE id = ?`
          ).run(attempts, id);
          skipped++;
          continue;
        }
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 5000);
        try {
          const resp = await fetch(webAppUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: String(r.payload_json),
            signal: ctrl.signal,
          });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          db.prepare(
            `UPDATE sync_outbox SET status = 'SENT', attempts = ?, sent_at = datetime('now'), last_error = NULL WHERE id = ?`
          ).run(attempts, id);
          sent++;
        } finally {
          clearTimeout(timer);
        }
      }
    } catch (err: any) {
      db.prepare(
        `UPDATE sync_outbox SET status = 'FAILED', attempts = ?, last_error = ? WHERE id = ?`
      ).run(attempts, String(err?.message || err), id);
      failed++;
    }
  }

  return { processed: rows.length, sent, skipped, failed };
}

export function listOutboxItems(db: DatabaseSync, limit: number = 50): SyncOutboxItem[] {
  const rows = db
    .prepare(
      `SELECT id, channel, event_type, payload_json, status, attempts, last_error, created_at, sent_at
       FROM sync_outbox ORDER BY id DESC LIMIT ?`
    )
    .all(limit) as Array<Record<string, any>>;

  return rows.map((r) => ({
    id: Number(r.id),
    channel: r.channel as 'GAS_WEBHOOK' | 'TELEGRAM',
    eventType: String(r.event_type),
    payloadJson: String(r.payload_json),
    status: r.status as SyncOutboxItem['status'],
    attempts: Number(r.attempts),
    lastError: r.last_error ? String(r.last_error) : null,
    createdAt: String(r.created_at),
    sentAt: r.sent_at ? String(r.sent_at) : null,
  }));
}
