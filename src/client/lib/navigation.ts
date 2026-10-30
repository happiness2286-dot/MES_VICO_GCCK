import { useEffect, useState } from 'react';

export const NAV_EVENT = 'gcck:navigate';

export function getBasePath(): string {
  if (typeof window === 'undefined') return '';
  const pathname = window.location.pathname;
  if (window.location.hostname.includes('github.io')) {
    const segments = pathname.split('/').filter(Boolean);
    if (segments.length > 0) {
      return `/${segments[0]}`;
    }
  }
  if (pathname.startsWith('/sanluonggcck')) {
    return '/sanluonggcck';
  }
  if (pathname.toLowerCase().startsWith('/sanluong2026')) {
    return pathname.slice(0, '/sanluong2026'.length);
  }
  if (pathname.toLowerCase().startsWith('/quanlygcck')) {
    return pathname.slice(0, '/quanlygcck'.length);
  }
  return '';
}

export function isStaticHost(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.location.hostname.includes('github.io') ||
    window.location.protocol === 'file:' ||
    Boolean(getBasePath())
  );
}

export function normalizePath(path: string): string {
  if (typeof window !== 'undefined' && window.location.hash && window.location.hash.startsWith('#/')) {
    return window.location.hash.slice(1);
  }
  const base = getBasePath();
  if (base && path.startsWith(base)) {
    const stripped = path.slice(base.length);
    return stripped ? (stripped.startsWith('/') ? stripped : `/${stripped}`) : '/';
  }
  return path || '/';
}

export function navigateTo(path: string): void {
  if (typeof window === 'undefined') return;
  const base = getBasePath();
  const normalized = path.startsWith('/') ? path : `/${path}`;

  // On GitHub Pages or static host, use hash routing so refreshing/direct links never return 404
  if (isStaticHost() || (window.location.hash && window.location.hash.startsWith('#/'))) {
    const targetHash = `#${normalized}`;
    if (window.location.hash !== targetHash) {
      window.location.hash = targetHash;
    }
    window.dispatchEvent(new CustomEvent(NAV_EVENT));
    try { window.scrollTo(0, 0); } catch {}
    return;
  }

  const fullPath = base ? `${base}${normalized}` : normalized;
  const currentFull = window.location.pathname + window.location.search;
  if (currentFull === fullPath) return;
  window.history.pushState({}, '', fullPath);
  window.dispatchEvent(new CustomEvent(NAV_EVENT));
  try { window.scrollTo(0, 0); } catch {}
}

export function useLocationPath(): string {
  const getFullNormPath = () => {
    if (typeof window === 'undefined') return '/worker';
    if (window.location.hash && window.location.hash.startsWith('#/')) {
      return window.location.hash.slice(1);
    }
    return normalizePath(window.location.pathname) + window.location.search;
  };

  const [pathname, setPathname] = useState<string>(getFullNormPath);

  useEffect(() => {
    const sync = () => {
      setPathname(getFullNormPath());
    };
    window.addEventListener('popstate', sync);
    window.addEventListener('hashchange', sync);
    window.addEventListener(NAV_EVENT, sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener('hashchange', sync);
      window.removeEventListener(NAV_EVENT, sync);
    };
  }, []);

  return pathname;
}
