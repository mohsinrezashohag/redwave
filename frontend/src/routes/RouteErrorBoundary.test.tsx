// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { RouteErrorBoundary } from './RouteErrorBoundary';

afterEach(cleanup);

function Boom(): never {
  throw new Error('kaboom in render');
}

describe('RouteErrorBoundary — friendly panel instead of the raw RR error screen', () => {
  it('renders the design-system panel + a retry when a route throws on render', async () => {
    // The boundary (and RR) log the caught error — silence it so the test output stays clean.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const router = createMemoryRouter([{ path: '/', element: <Boom />, errorElement: <RouteErrorBoundary /> }], {
      initialEntries: ['/'],
    });

    render(<RouterProvider router={router} />);

    expect(await screen.findByText('Something went wrong on this page')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Back to dashboard' })).toBeTruthy();
    // NOT React Router's raw fallback.
    expect(screen.queryByText(/Unexpected Application Error/i)).toBeNull();

    spy.mockRestore();
  });
});
