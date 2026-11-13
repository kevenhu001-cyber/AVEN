import type { ReactNode } from 'react';
import { RouteTransition } from '@/components/shell/route-transition';

export default function PlatformTemplate({ children }: { children: ReactNode }) {
  return <RouteTransition>{children}</RouteTransition>;
}
