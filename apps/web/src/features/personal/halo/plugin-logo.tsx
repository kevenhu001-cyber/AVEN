import { Icon, type IconName } from '../icon';

/*
 * Neutral app tiles. Official third-party logos are not bundled (no brand-asset licence in the
 * repo), so each tile shows a Lucide glyph for the connector's category on a white tile.
 */
const byCategory: Record<string, IconName> = {
  mail: 'mail',
  maps: 'map',
  commerce: 'shop',
  lifestyle: 'store',
  calendar: 'calendar',
  social: 'users',
  productivity: 'puzzle',
  mcp: 'puzzle',
};

export function PluginLogo({
  id,
  category,
  size = 'md',
}: {
  id: string;
  category: string;
  size?: 'md' | 'lg';
}) {
  const icon: IconName = id === 'aven.weather' ? 'weather' : (byCategory[category] ?? 'puzzle');
  return (
    <span className={`halo-logo halo-logo-${size}`} data-plugin={id} aria-hidden="true">
      <Icon name={icon} size={size === 'lg' ? 28 : 24} />
    </span>
  );
}
