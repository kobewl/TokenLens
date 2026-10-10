import { useCallback, useEffect, useState } from "react";

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Preferences are optional. */
  }
};

/** localStorage-backed state with validation, so a corrupted value falls back to the default. */
export function usePref<T extends string | number | boolean>(
  key: string,
  fallback: T,
  valid: (v: unknown) => v is T,
): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    const raw = read(key);
    if (raw === null) return fallback;
    const parsed: unknown = typeof fallback === "number" ? Number(raw) : typeof fallback === "boolean" ? raw === "true" : raw;
    return valid(parsed) ? parsed : fallback;
  });
  useEffect(() => write(key, String(value)), [key, value]);
  const set = useCallback((v: T) => setValue(v), []);
  return [value, set];
}

export const oneOf =
  <T extends string | number>(...allowed: T[]) =>
  (v: unknown): v is T =>
    allowed.includes(v as T);
export const isBool = (v: unknown): v is boolean => typeof v === "boolean";

export type Theme = "light" | "dark" | "system";
export const readJson = <T,>(key: string, fallback: T): T => {
  const raw = read(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};
export const writeJson = (key: string, value: unknown) => write(key, JSON.stringify(value));
