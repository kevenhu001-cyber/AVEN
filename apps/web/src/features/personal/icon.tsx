import {
  ArrowUp,
  ArrowRight,
  ArrowDown,
  Bell,
  Check,
  Copy,
  Ellipsis,
  History,
  Layers,
  LayoutGrid,
  Link,
  Menu,
  MessageCircle,
  Plus,
  Plug,
  Settings,
  Square,
  SquarePen,
  X,
} from 'lucide-react';
const icons = {
  menu: Menu,
  ellipsis: Ellipsis,
  'arrow-up': ArrowUp,
  'arrow-right': ArrowRight,
  'arrow-down': ArrowDown,
  square: Square,
  x: X,
  plug: Plug,
  plus: Plus,
  message: MessageCircle,
  layers: Layers,
  link: Link,
  bell: Bell,
  grid: LayoutGrid,
  history: History,
  settings: Settings,
  compose: SquarePen,
  copy: Copy,
  check: Check,
};
export type IconName = keyof typeof icons;
export function Icon({ name }: { name: IconName }) {
  const Glyph = icons[name];
  return <Glyph size={22} strokeWidth={1.75} aria-hidden="true" />;
}
