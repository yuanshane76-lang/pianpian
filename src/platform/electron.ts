export interface ZhiyanBridge {
  invoke<T = unknown>(channel: string, payload?: unknown): Promise<T>;
  on?<T = unknown>(channel: string, handler: (payload: T) => void): () => void;
  stream?<T = string>(
    channel: string,
    payload: unknown,
    onDelta: (delta: string) => void,
    onAbort?: (cancel: () => void) => (() => void),
  ): Promise<T>;
}

declare global {
  interface Window {
    zhiyan?: ZhiyanBridge;
  }
}

export function getDesktopBridge(): ZhiyanBridge | null {
  return typeof window !== "undefined" ? window.zhiyan ?? null : null;
}
