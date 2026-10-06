// node has no window: the editor store's storage module looks for window.nkw
;(globalThis as Record<string, unknown>).window ??= globalThis
export {}
