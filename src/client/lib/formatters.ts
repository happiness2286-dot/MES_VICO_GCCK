/**
 * Industrial Precision Number, Currency, Date & Safe Excel Formula Formatters
 */

export function formatVnd(amount: number | null | undefined, suffix: string = 'đ'): string {
  const n = Math.round(Number(amount) || 0);
  const formatted = n.toLocaleString('vi-VN');
  return suffix ? `${formatted} ${suffix}` : formatted;
}

export function formatCompactVnd(amount: number | null | undefined): string {
  const n = Number(amount) || 0;
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000_000) {
    return `${sign}${(abs / 1_000_000_000).toFixed(2)} tỷ`;
  }
  if (abs >= 1_000_000) {
    return `${sign}${(abs / 1_000_000).toFixed(2)} tr`;
  }
  if (abs >= 1_000) {
    return `${sign}${Math.round(abs / 1_000)}k`;
  }
  return `${n} đ`;
}

export function formatNumber(val: number | null | undefined, maxDecimals: number = 2): string {
  const n = Number(val) || 0;
  return n.toLocaleString('vi-VN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDecimals,
  });
}

export function formatDurationSec(seconds: number | null | undefined): string {
  const sec = Math.max(0, Math.round(Number(seconds) || 0));
  const hrs = (sec / 3600).toFixed(2);
  return `${sec.toLocaleString('vi-VN')}s (${hrs}h)`;
}

export function formatDateVn(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr).trim());
  if (!m) return String(dateStr);
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/**
 * Prevents CSV/Excel Formula Injection on untrusted strings starting with '=' or '@',
 * while preserving legitimate attendance strings like '+2' or '-1.5' when stored as explicit text.
 */
export function sanitizeExcelCellValue(val: unknown): string | number {
  if (typeof val === 'number') {
    return Number.isFinite(val) ? val : 0;
  }
  const s = String(val ?? '');
  if (!s) return '';
  if (/^[=@]/.test(s) || /^[+-]\s*[a-zA-Z]/.test(s)) {
    return `'${s}`;
  }
  return s;
}

export function getTravelerPoIdFromLocation(pathname?: string): string {
  const current =
    pathname ||
    (typeof window !== 'undefined'
      ? (window.location.hash || window.location.pathname)
      : '');
  const m = /(?:^|[/#])(?:print\/)?traveler\/([^/?#]+)/i.exec(current);
  return m ? decodeURIComponent(m[1]) : 'PO485-01';
}

export interface NormalizedQcDim {
  label: string;
  specText: string;
  measuredText: string;
  ok: boolean;
}

export function normalizeQcMeasuredDims(raw: string | undefined): NormalizedQcDim[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((d: Record<string, any>, idx: number) => {
      const label = String(d?.feature || d?.dim || `KT${idx + 1}`);
      const hasExplicitSpec = d?.spec !== undefined && String(d.spec).trim() !== '';
      const nom = d?.nominal;
      const tol = d?.tolPlusMinus ?? d?.tol ?? 0.01;
      const specText = hasExplicitSpec
        ? String(d.spec)
        : nom !== undefined
          ? `${nom}±${tol}`
          : '';
      const actRaw = d?.measured ?? d?.actual ?? nom ?? '';
      const measuredText = String(actRaw);

      let ok = true;
      if (d?.ok !== undefined) {
        ok = Boolean(d.ok);
      } else if (d?.pass !== undefined) {
        ok = Boolean(d.pass);
      } else if (nom !== undefined && actRaw !== '' && !Number.isNaN(Number(actRaw))) {
        ok = Math.abs(Number(actRaw) - Number(nom)) <= Number(tol) + 1e-6;
      }

      return { label, specText, measuredText, ok };
    });
  } catch {
    return [];
  }
}
