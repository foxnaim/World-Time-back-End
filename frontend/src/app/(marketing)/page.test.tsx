import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

// The page is an async server component: it reads the locale cookie and the
// signed-in user. Stub both as a signed-out visitor with no locale cookie.
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock('@/lib/auth-server', () => ({
  getServerUser: async () => null,
}));

// Stub landing sub-components so this stays a pure smoke test of the page shell.
vi.mock('@/components/landing/header', () => ({
  Header: ({ authenticated }: { authenticated: boolean }) => (
    <div data-testid="stub-header" data-authenticated={String(authenticated)} />
  ),
}));
vi.mock('@/components/landing/hero', () => ({
  Hero: () => (
    <section data-testid="stub-hero">
      <h1>TIME</h1>
    </section>
  ),
}));
vi.mock('@/components/landing/segments', () => ({
  Segments: () => <div data-testid="stub-segments" />,
}));
vi.mock('@/components/landing/how-it-works', () => ({
  HowItWorks: () => <div data-testid="stub-how" />,
}));
vi.mock('@/components/landing/features', () => ({
  Features: () => <div data-testid="stub-features" />,
}));
vi.mock('@/components/landing/pricing', () => ({
  Pricing: () => <div data-testid="stub-pricing" />,
}));
vi.mock('@/components/landing/footer', () => ({
  Footer: () => <div data-testid="stub-footer" />,
}));

import MarketingPage from './page';

describe('Marketing home page', () => {
  it('renders the main landing shell with all sections', async () => {
    const { getByTestId, container } = render(await MarketingPage());

    expect(container.querySelector('main')).toBeInTheDocument();
    expect(getByTestId('stub-header')).toHaveAttribute('data-authenticated', 'false');
    expect(getByTestId('stub-hero')).toBeInTheDocument();
    expect(getByTestId('stub-segments')).toBeInTheDocument();
    expect(getByTestId('stub-how')).toBeInTheDocument();
    expect(getByTestId('stub-features')).toBeInTheDocument();
    expect(getByTestId('stub-pricing')).toBeInTheDocument();
    expect(getByTestId('stub-footer')).toBeInTheDocument();
  });
});
