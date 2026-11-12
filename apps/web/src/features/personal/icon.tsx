import { ArrowUp, Ellipsis, Menu, Square, X } from 'lucide-react';

export function Icon({ name }: { name: 'menu' | 'ellipsis' | 'arrow-up' | 'square' | 'x' }) {
  const props = {
    size: 20,
    strokeWidth: 2,
    'aria-hidden': true as const,
  };
  switch (name) {
    case 'menu':
      return <Menu {...props} />;
    case 'ellipsis':
      return <Ellipsis {...props} />;
    case 'arrow-up':
      return <ArrowUp {...props} />;
    case 'square':
      return <Square {...props} />;
    case 'x':
      return <X {...props} />;
  }
}
