import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import type { AppRole, AuthSessionUser } from '../../shared/types';
import { removeVietnameseTones } from '../../shared/vnSearch';

const SCRYPT_PARAMS = { N: 4096, r: 8, p: 1 };
const KEY_LEN = 32;
export const SESSION_COOKIE_NAME = 'gcck_session';

export function hashPin(pin: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(String(pin), salt, KEY_LEN, SCRYPT_PARAMS).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPin(pin: string, storedHash: string): boolean {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, expectedHex] = storedHash.split(':');
  if (!salt || !expectedHex) return false;
  const actualBuf = scryptSync(String(pin), salt, KEY_LEN, SCRYPT_PARAMS);
  const expectedBuf = Buffer.from(expectedHex, 'hex');
  if (actualBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(actualBuf, expectedBuf);
}

export function mapLegacyRoleToAppRole(role: string, title?: string): AppRole {
  const r = String(role || '').trim().toUpperCase();
  const t = removeVietnameseTones(title || '').toLowerCase();
  if (r === 'QĐ' || r === 'QD' || r === 'ADMIN') return 'ADMIN';
  if (r === 'DIRECTOR') return 'DIRECTOR';
  if (r === 'KT') {
    if (t.includes('quan ly') || t.includes('ky su truong')) return 'DIRECTOR';
    if (t.includes('qc')) return 'QC';
    return 'SHIFT_LEADER';
  }
  if (r === 'QC') return 'QC';
  if (r === 'TC' || r === 'SHIFT_LEADER') return 'SHIFT_LEADER';
  return 'WORKER';
}

export interface SessionTokenPayload {
  workerId: string;
  iat: number;
  exp: number;
}

export function signSessionToken(workerId: string, secret: string, ttlDays: number = 30): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const payload: SessionTokenPayload = {
    workerId,
    iat: nowSec,
    exp: nowSec + ttlDays * 86400,
  };
  const b64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = createHmac('sha256', secret).update(b64).digest('base64url');
  return `${b64}.${sig}`;
}

export function verifySessionToken(token: string | undefined, secret: string): SessionTokenPayload | null {
  if (!token || !token.includes('.')) return null;
  const [b64, sig] = token.split('.');
  if (!b64 || !sig) return null;

  const expectedSig = createHmac('sha256', secret).update(b64).digest('base64url');
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expectedSig, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8')) as SessionTokenPayload;
    const nowSec = Math.floor(Date.now() / 1000);
    if (!parsed.workerId || parsed.exp < nowSec) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) {
      const k = part.slice(0, idx).trim();
      const v = decodeURIComponent(part.slice(idx + 1).trim());
      out[k] = v;
    }
  }
  return out;
}

export function getSessionSecret(db: DatabaseSync): string {
  const row = db
    .prepare('SELECT value FROM system_config WHERE key = ?')
    .get('SESSION_HMAC_SECRET') as { value?: string } | undefined;
  if (row?.value) return row.value;
  const generated = randomBytes(32).toString('hex');
  db.prepare('INSERT OR REPLACE INTO system_config (key, value) VALUES (?, ?)').run(
    'SESSION_HMAC_SECRET',
    generated
  );
  return generated;
}

export function loadUserById(db: DatabaseSync, workerId: string): AuthSessionUser | null {
  const normId = String(workerId || '').trim();
  const aliasId = normId === 'NV00112' ? 'NV00214' : normId;

  const row = db
    .prepare(
      `SELECT id, name, username, role, title, salary_mode, base_salary, cost_per_sec, chat_id, is_linked, is_active
       FROM workers WHERE id = ? OR id = ?`
    )
    .get(normId, aliasId) as Record<string, any> | undefined;

  if (!row || Number(row.is_active) === 0) return null;

  return {
    workerId: String(row.id),
    name: String(row.name),
    username: String(row.username),
    role: String(row.role),
    appRole: mapLegacyRoleToAppRole(String(row.role), String(row.title)),
    title: String(row.title),
    salaryMode: String(row.salary_mode),
    baseSalary: Number(row.base_salary),
    costPerSec: Number(row.cost_per_sec),
    chatId: row.chat_id ? String(row.chat_id) : null,
    isLinked: Number(row.is_linked) === 1 && Boolean(row.chat_id),
  };
}

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthSessionUser | null;
    }
  }
}

export function createAuthMiddleware(db: DatabaseSync) {
  return function attachSession(req: Request, _res: Response, next: NextFunction): void {
    const secret = getSessionSecret(db);
    const cookies = parseCookies(req.headers.cookie);
    const authHdr = req.headers.authorization;
    const bearer =
      authHdr && authHdr.startsWith('Bearer ') ? authHdr.slice(7).trim() : undefined;
    const customToken =
      typeof req.headers['x-gcck-token'] === 'string' ? req.headers['x-gcck-token'] : undefined;

    const rawToken = bearer || customToken || cookies[SESSION_COOKIE_NAME];
    const verified = verifySessionToken(rawToken, secret);
    req.authUser = verified ? loadUserById(db, verified.workerId) : null;
    next();
  };
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.authUser) {
    res.status(401).json({ error: 'Vui lòng đăng nhập hoặc chọn vai trò để tiếp tục.' });
    return;
  }
  next();
}

export function requireRoles(...allowed: AppRole[]) {
  return function checkRole(req: Request, res: Response, next: NextFunction): void {
    if (!req.authUser) {
      res.status(401).json({ error: 'Chưa xác thực phiên làm việc.' });
      return;
    }
    if (!allowed.includes(req.authUser.appRole)) {
      res.status(403).json({
        error: `Tài khoản ${req.authUser.name} (${req.authUser.appRole}) không có quyền truy cập mục này.`,
      });
      return;
    }
    next();
  };
}

export function setSessionCookie(res: Response, token: string): void {
  const maxAge = 30 * 86400;
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`
  );
}

export function clearSessionCookie(res: Response): void {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  );
}
