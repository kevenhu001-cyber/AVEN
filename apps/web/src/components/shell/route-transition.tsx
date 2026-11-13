import type { ReactNode } from 'react';

/**
 * Remounted by Next.js on every navigation inside a route group, so the enter
 * animation runs once per page change without touching provider state.
 */
export function RouteTransition({ children }: { children: ReactNode }) {
  return <div className="route-enter">{children}</div>;
}
