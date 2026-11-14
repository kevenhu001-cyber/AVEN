import { Icon, type IconName } from '../icon';

const brandIcons: Record<string, string> = {
  'aven.weather': 'aven-weather',
  'aven.compare': 'aven-compare',
  'aven.social': 'aven-social',
  'aven.calendar': 'aven-calendar',
  'taobao.commerce': 'aven-commerce',
  'jd.commerce': 'aven-commerce',
  'taobao_flash.commerce': 'aven-commerce',
  'meituan.lifestyle': 'aven-commerce',
  slack: 'slack',
  gitlab: 'gitlab',
  discord: 'discord',
  todoist: 'todoist',
  ticktick: 'ticktick',
  feishu: 'feishu',
  arxiv: 'arxiv',
  zotero: 'zotero',
  baidu: 'baidu',
  baidu_maps: 'baidu_maps',
  feishu_custom_bot: 'feishu_custom_bot',
  'gmail.mail': 'gmail',
  'qqmail.mail': 'qq_mail',
  'amap.maps': 'amap',
  gmail: 'gmail',
  outlook: 'outlook',
  googledrive: 'googledrive',
  googlecalendar: 'googlecalendar',
  'googlecalendar.calendar': 'googlecalendar',
};

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
  const brand = brandIcons[id];
  const icon: IconName = id === 'aven.weather' ? 'weather' : (byCategory[category] ?? 'puzzle');
  return (
    <span className={`halo-logo halo-logo-${size}`} data-plugin={id} aria-hidden="true">
      {brand ? (
        // Local, inspected SVG assets; no remote logo request or inline markup injection.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/connector-icons/${brand}.svg`}
          alt=""
          width={size === 'lg' ? 28 : 24}
          height={size === 'lg' ? 28 : 24}
          style={{ objectFit: 'contain' }}
        />
      ) : (
        <Icon name={icon} size={size === 'lg' ? 28 : 24} />
      )}
    </span>
  );
}
