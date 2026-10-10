import { invoke, isTauri } from "@tauri-apps/api/core";

/** True inside the Tauri desktop shell; false in a plain browser (demo mode). */
export const isDesktop = isTauri();

/**
 * Single entry point for backend calls (Java analogy: the service-facade).
 * Desktop: real Rust commands. Browser: clearly labeled fabricated demo data,
 * which makes the UI explorable and screenshot-able without any local logs.
 */
export async function call<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  if (isDesktop) return invoke<T>(command, args);
  const { demoCall } = await import("./demo");
  return demoCall<T>(command, args);
}

export async function onUsageRefreshed(handler: () => void): Promise<() => void> {
  if (!isDesktop) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen("usage-refreshed", handler);
}

export const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
