import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/**
 * jsdom kennt IntersectionObserver/ResizeObserver nicht — Embla (Banner-Slider)
 * instanziiert beide beim Mount. Ohne Stub wirft schon das Rendern.
 */
class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

if (!('IntersectionObserver' in globalThis)) {
  (globalThis as any).IntersectionObserver = NoopObserver;
}
if (!('ResizeObserver' in globalThis)) {
  (globalThis as any).ResizeObserver = NoopObserver;
}

afterEach(() => {
  cleanup();
});
