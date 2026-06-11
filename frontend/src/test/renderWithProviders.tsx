/**
 * Test-only render helper — wraps a UI tree in the providers the app gives every screen (QueryClient +
 * Router + Tooltip + Toast), with a fresh retry-disabled QueryClient per render. Used by the jsdom render
 * tests (the previously-crashing list pages). NOT a test file itself (no `.test.`), so vitest won't run it.
 * Installs the handful of jsdom polyfills Radix needs (matchMedia / ResizeObserver / scrollIntoView).
 */
import type { ReactElement, ReactNode } from 'react';
import { render, type RenderResult } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { TooltipProvider } from '../components/ui/Tooltip';
import { ToastProvider } from '../components/ui/ToastProvider';

/** Radix primitives expect a few browser APIs jsdom doesn't ship. No-op shims keep render from throwing. */
function installJsdomPolyfills(): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as Record<string, unknown>;
  if (!w.matchMedia) {
    w.matchMedia = (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
  }
  if (!w.ResizeObserver) {
    w.ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  }
  if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
}

/** A QueryClient tuned for tests: no retries, no caching between tests. */
export function makeTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
}

export type RenderWithProvidersResult = RenderResult & { client: QueryClient };

export function renderWithProviders(ui: ReactElement, opts: { route?: string } = {}): RenderWithProvidersResult {
  installJsdomPolyfills();
  const client = makeTestQueryClient();
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[opts.route ?? '/']}>
        <TooltipProvider delayDuration={0}>
          <ToastProvider>{children}</ToastProvider>
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
  // Object.assign (not spread) so RTL's mapped query methods survive on the returned type.
  return Object.assign(render(ui, { wrapper: Wrapper }), { client });
}
