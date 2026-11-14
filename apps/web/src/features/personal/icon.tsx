import {
  ArrowUp,
  AudioLines,
  BadgeCheck,
  Bell,
  Brain,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleUserRound,
  Clock,
  CloudSun,
  Copy,
  Ellipsis,
  FolderSearch,
  Globe,
  Grid2x2Plus,
  Hash,
  Inbox,
  Link2,
  LoaderCircle,
  LogOut,
  Mail,
  MapPin,
  Menu,
  MessageCircle,
  MessageCirclePlus,
  Mic,
  Monitor,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  Plus,
  Puzzle,
  RotateCcw,
  Search,
  Share,
  ShoppingBag,
  Sparkles,
  Square,
  Store,
  ThumbsDown,
  ThumbsUp,
  Upload,
  Users,
  Volume2,
  Wrench,
  X,
} from 'lucide-react';

const icons = {
  menu: Menu,
  ellipsis: Ellipsis,
  'arrow-up': ArrowUp,
  square: Square,
  x: X,
  plug: Plug,
  plus: Plus,
  search: Search,
  apps: Grid2x2Plus,
  share: Share,
  back: ChevronLeft,
  chevron: ChevronRight,
  down: ChevronDown,
  up: ChevronUp,
  library: FolderSearch,
  computer: Monitor,
  slack: Hash,
  clock: Clock,
  profile: CircleUserRound,
  upload: Upload,
  mic: Mic,
  wave: AudioLines,
  check: Check,
  verified: BadgeCheck,
  mail: Mail,
  map: MapPin,
  shop: ShoppingBag,
  calendar: CalendarDays,
  users: Users,
  weather: CloudSun,
  store: Store,
  puzzle: Puzzle,
  bell: Bell,
  link: Link2,
  logout: LogOut,
  wrench: Wrench,
  spinner: LoaderCircle,
  refresh: RotateCcw,
  inbox: Inbox,
  copy: Copy,
  'new-chat': MessageCirclePlus,
  chat: MessageCircle,
  'panel-left-open': PanelLeftOpen,
  'panel-left-close': PanelLeftClose,
  brain: Brain,
  globe: Globe,
  sparkles: Sparkles,
  'thumbs-up': ThumbsUp,
  'thumbs-down': ThumbsDown,
  volume: Volume2,
} as const;

export type IconName = keyof typeof icons;

import type { CSSProperties } from 'react';

export function Icon({
  name,
  size = 20,
  className,
  style,
}: {
  name: IconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const Component = icons[name];
  return (
    <Component
      size={size}
      strokeWidth={1.75}
      aria-hidden={true}
      className={className}
      style={style}
    />
  );
}
