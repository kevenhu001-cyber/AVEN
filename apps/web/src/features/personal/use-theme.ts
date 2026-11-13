'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'aven-theme';
const SYSTEM_QUERY = '(prefers-color-scheme: light)';
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function readPreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system';
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
}

function systemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia(SYSTEM_QUERY).matches ? 'light' : 'dark';
}

function subscribe(onChange: () => void) {
  if (typeof window === 'undefined') return () => undefined;
  listeners.add(onChange);
  const query = window.matchMedia(SYSTEM_QUERY);
  const onSystem = () => emit();
  query.addEventListener('change', onSystem);
  return () => {
    listeners.delete(onChange);
    query.removeEventListener('change', onSystem);
  };
}

function apply(theme: ResolvedTheme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.avenTheme = theme;
  root.style.colorScheme = theme;
}

/**
 * Theme preference shared by the workspace. The resolved theme is written to
 * `html[data-aven-theme]` so CSS variables switch without re-rendering the tree.
 * `system` follows the OS and reacts to live changes.
 */
export function useTheme() {
  const preference = useSyncExternalStore<ThemePreference>(
    subscribe,
    readPreference,
    () => 'system',
  );
  const system = useSyncExternalStore<ResolvedTheme>(subscribe, systemTheme, () => 'dark');
  const theme: ResolvedTheme = preference === 'system' ? system : preference;

  useEffect(() => {
    apply(theme);
  }, [theme]);

  const setPreference = useCallback((next: ThemePreference) => {
    try {
      if (next === 'system') window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage can be unavailable in private contexts; the store still updates in memory.
    }
    emit();
  }, []);

  const toggle = useCallback(() => {
    setPreference(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setPreference]);

  return { preference, theme, setPreference, toggle };
}
