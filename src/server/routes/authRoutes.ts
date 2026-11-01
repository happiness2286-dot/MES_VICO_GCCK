import { Router } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import type { AuthMode, QuickSwitchProfile } from '../../shared/types';
import {
  clearSessionCookie,
  getSessionSecret,
  hashPin,
  loadUserById,
  mapLegacyRoleToAppRole,
  requireAuth,
  setSessionCookie,
  signSessionToken,
  verifyPin,
} from '../auth/security';
import { getConfigMap } from '../db/queries';
import { normalizeVn } from '../../shared/vnSearch';

const LOGIN_LOCK_WINDOW_MS = 5 * 60 * 1000;
const MAX_LOGIN_FAILURES = 5;
const loginFailures = new Map<string, { count: number; firstFailedAt: number }>();

export function resetLoginRateLimiter(): void {
  loginFailures.clear();
}

export function createAuthRoutes(db: DatabaseSync): Router {
  const router = Router();

  function getAuthMode(): AuthMode {
    const cfg = getConfigMap(db);
    return cfg.AUTH_MODE === 'STRICT_PIN' ? 'STRICT_PIN' : 'DEMO_QUICK';
  }

  function getQuickSwitchProfiles(): QuickSwitchProfile[] {
    const rows = db
      .prepare(
        `SELECT id, name, role, title, salary_mode FROM workers WHERE is_active = 1 ORDER BY rowid ASC`
      )
      .all() as Array<Record<string, any>>;

    return rows.map((r) => ({
      workerId: String(r.id),
      name: String(r.name),
      role: String(r.role),
      appRole: mapLegacyRoleToAppRole(String(r.role), String(r.title)),
      title: String(r.title),
      salaryMode: String(r.salary_mode),
    }));
  }

  router.get('/auth/session', (req, res) => {
    const authMode = getAuthMode();
    res.json({
      authenticated: Boolean(req.authUser),
      authMode,
      user: req.authUser ?? null,
      quickSwitchProfiles: getQuickSwitchProfiles(),
    });
  });

  router.post('/auth/login', (req, res) => {
    const rawId = normalizeVn(
      req.body?.workerId || req.body?.workerIdOrUsername || req.body?.username || ''
    );
    const pin = String(req.body?.pin ?? '').trim();

    if (!rawId || !pin) {
      res.status(400).json({ error: 'Vui lòng nhập Mã nhân viên và mã PIN.' });
      return;
    }

    const clientIp = String(req.ip || req.socket?.remoteAddress || 'local');
    const rateKey = `${clientIp}:${rawId.toUpperCase()}`;
    const now = Date.now();
    const attemptEntry = loginFailures.get(rateKey);
    if (attemptEntry) {
      if (now - attemptEntry.firstFailedAt > LOGIN_LOCK_WINDOW_MS) {
        loginFailures.delete(rateKey);
      } else if (attemptEntry.count >= MAX_LOGIN_FAILURES) {
        res.status(429).json({
          error: 'Tạm khóa đăng nhập 5 phút do nhập sai PIN quá 5 lần',
        });
        return;
      }
    }

    const row = db
      .prepare(
        `SELECT id, pin_hash, is_active FROM workers
         WHERE (UPPER(id) = UPPER(?) OR LOWER(username) = LOWER(?) OR LOWER(name) = LOWER(?)) AND is_active = 1`
      )
      .get(rawId, rawId, rawId) as { id: string; pin_hash: string; is_active: number } | undefined;

    if (!row || !verifyPin(pin, String(row.pin_hash))) {
      const prev = loginFailures.get(rateKey);
      if (!prev || now - prev.firstFailedAt > LOGIN_LOCK_WINDOW_MS) {
        loginFailures.set(rateKey, { count: 1, firstFailedAt: now });
      } else {
        loginFailures.set(rateKey, { count: prev.count + 1, firstFailedAt: prev.firstFailedAt });
      }
      res.status(401).json({ error: 'Mã nhân viên hoặc mã PIN không chính xác.' });
      return;
    }

    const user = loadUserById(db, String(row.id));
    if (!user) {
      res.status(401).json({ error: 'Tài khoản đã bị khóa.' });
      return;
    }

    loginFailures.delete(rateKey);

    const secret = getSessionSecret(db);
    const token = signSessionToken(user.workerId, secret, 30);
    setSessionCookie(res, token);

    res.json({
      authenticated: true,
      authMode: getAuthMode(),
      token,
      user,
    });
  });

  router.post('/auth/quick-switch', (req, res) => {
    const authMode = getAuthMode();
    if (authMode !== 'DEMO_QUICK') {
      res.status(403).json({
        error: 'Chế độ Strict PIN đang bật. Vui lòng đăng nhập bằng mã PIN cá nhân.',
      });
      return;
    }

    let targetId = normalizeVn(req.body?.workerId || '');
    const roleHint = normalizeVn(req.body?.role || '').toUpperCase();

    if (targetId === 'NV00112') targetId = 'NV00214';

    if (!targetId) {
      if (roleHint === 'ADMIN' || roleHint === 'DIRECTOR' || roleHint === 'QĐ') {
        targetId = 'NV00053';
      } else if (roleHint === 'QC' || roleHint === 'SHIFT_LEADER' || roleHint === 'TC' || roleHint === 'KT') {
        targetId = 'NV00266';
      } else {
        targetId = 'NV00214';
      }
    }

    const user = loadUserById(db, targetId);
    if (!user) {
      res.status(404).json({ error: `Không tìm thấy nhân sự ${targetId}.` });
      return;
    }

    const secret = getSessionSecret(db);
    const token = signSessionToken(user.workerId, secret, 30);
    setSessionCookie(res, token);

    res.json({
      authenticated: true,
      authMode,
      token,
      user,
    });
  });

  router.post('/auth/change-pin', (req, res) => {
    const rawId = normalizeVn(
      req.body?.workerId || req.authUser?.workerId || ''
    );
    const currentPin = String(req.body?.currentPin ?? '').trim();
    const newPin = String(req.body?.newPin ?? '').trim();

    if (!rawId || !currentPin || !newPin) {
      res.status(400).json({ error: 'Vui lòng nhập đầy đủ Mã nhân viên, mật khẩu hiện tại và mật khẩu mới.' });
      return;
    }

    if (newPin.length < 4) {
      res.status(400).json({ error: 'Mật khẩu mới phải có tối thiểu 4 ký tự.' });
      return;
    }

    const row = db
      .prepare(
        `SELECT id, pin_hash, is_active FROM workers
         WHERE (UPPER(id) = UPPER(?) OR LOWER(username) = LOWER(?) OR LOWER(name) = LOWER(?)) AND is_active = 1`
      )
      .get(rawId, rawId, rawId) as { id: string; pin_hash: string; is_active: number } | undefined;

    if (!row || !verifyPin(currentPin, String(row.pin_hash))) {
      res.status(401).json({ error: 'Mật khẩu hiện tại không chính xác.' });
      return;
    }

    const newHash = hashPin(newPin);
    db.prepare('UPDATE workers SET pin_hash = ? WHERE id = ?').run(newHash, row.id);

    res.json({
      success: true,
      message: 'Đổi mật khẩu thành công! Hãy ghi nhớ mật khẩu mới của bạn.',
    });
  });

  router.post('/auth/logout', (_req, res) => {
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  router.post('/auth/telegram-link', requireAuth, (req, res) => {
    const chatId = normalizeVn(req.body?.chatId || '');
    const workerId = req.authUser!.workerId;
    db.prepare(`UPDATE workers SET chat_id = ?, is_linked = ? WHERE id = ?`).run(
      chatId || null,
      chatId ? 1 : 0,
      workerId
    );
    const updatedUser = loadUserById(db, workerId);
    res.json({ success: true, user: updatedUser });
  });

  return router;
}
