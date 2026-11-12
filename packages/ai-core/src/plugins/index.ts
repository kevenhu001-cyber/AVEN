export {
  PluginRegistry,
  buildPluginManifest,
  buildPluginToolName,
  type PluginActionContext,
  type PluginActionExecutionResult,
  type PluginActionHandler,
  type PluginConnector,
  type PluginInvokeRuntimeOptions,
} from './registry.js';
export { sanitizeExternalPluginUrl } from './url-safety.js';
export {
  AmapGeocodeInputSchema,
  AmapLocationOutputSchema,
  AmapPoiSearchInputSchema,
  createAmapPlugin,
  type AmapGeocodeInput,
  type AmapLiveAdapter,
  type AmapLocationOutput,
  type AmapPluginOptions,
  type AmapPoiSearchInput,
} from './amap-plugin.js';
export {
  CommerceSearchInputSchema,
  CommerceSearchOutputSchema,
  createJdPlugin,
  createTaobaoPlugin,
  type CommerceLiveAdapter,
  type CommercePluginOptions,
  type CommerceSearchInput,
  type CommerceSearchOutput,
} from './commerce-plugin.js';
export {
  MailDraftInputSchema,
  MailSearchInputSchema,
  MailSearchOutputSchema,
  MailSendInputSchema,
  createGmailPlugin,
  createQqMailPlugin,
  type MailboxLiveAdapter,
  type MailboxPluginOptions,
  type MailDraftInput,
  type MailSearchInput,
  type MailSendInput,
} from './mail-plugin.js';
export {
  InstantSearchInputSchema,
  InstantSearchOutputSchema,
  LocalDealSearchInputSchema,
  LocalDealSearchOutputSchema,
  createMeituanPlugin,
  createTaobaoFlashPlugin,
  type InstantSearchInput,
  type LocalDealSearchInput,
  type MeituanPluginOptions,
  type TaobaoFlashPluginOptions,
} from './lifestyle-plugin.js';
export {
  CalendarPluginInputSchema,
  CalendarPluginOutputSchema,
  SocialPreviewInputSchema,
  SocialStatusInputSchema,
  WeatherForecastInputSchema,
  createAvenCalendarPlugin,
  createAvenSocialPlugin,
  createAvenWeatherPlugin,
} from './aven-native-plugins.js';
export {
  CrossCompareInputSchema,
  CrossCompareOutputSchema,
  createCrossPlatformComparePlugin,
} from './cross-compare-plugin.js';
export {
  McpPluginManager,
  type McpToolCallResult,
  type McpTransportAdapter,
  type RegisteredMcpServerRecord,
} from './mcp-manager.js';

import { createAmapPlugin, type AmapPluginOptions } from './amap-plugin.js';
import {
  createAvenCalendarPlugin,
  createAvenSocialPlugin,
  createAvenWeatherPlugin,
} from './aven-native-plugins.js';
import {
  createJdPlugin,
  createTaobaoPlugin,
  type CommercePluginOptions,
} from './commerce-plugin.js';
import { createCrossPlatformComparePlugin } from './cross-compare-plugin.js';
import {
  createMeituanPlugin,
  createTaobaoFlashPlugin,
  type MeituanPluginOptions,
  type TaobaoFlashPluginOptions,
} from './lifestyle-plugin.js';
import { createGmailPlugin, createQqMailPlugin, type MailboxPluginOptions } from './mail-plugin.js';
import { PluginRegistry } from './registry.js';

export type DefaultPluginRegistryOptions = {
  amap?: AmapPluginOptions;
  taobao?: CommercePluginOptions;
  jd?: CommercePluginOptions;
  taobaoFlash?: TaobaoFlashPluginOptions;
  meituan?: MeituanPluginOptions;
  gmail?: MailboxPluginOptions;
  qqmail?: MailboxPluginOptions;
};

export function createDefaultPluginRegistry(
  options: DefaultPluginRegistryOptions = {},
): PluginRegistry {
  const registry = new PluginRegistry();
  registry.register(createAmapPlugin(options.amap));
  registry.register(createTaobaoPlugin(options.taobao));
  registry.register(createJdPlugin(options.jd));
  registry.register(createTaobaoFlashPlugin(options.taobaoFlash));
  registry.register(createMeituanPlugin(options.meituan));
  registry.register(createGmailPlugin(options.gmail));
  registry.register(createQqMailPlugin(options.qqmail));
  registry.register(createAvenSocialPlugin());
  registry.register(createAvenCalendarPlugin());
  registry.register(createAvenWeatherPlugin());
  registry.register(createCrossPlatformComparePlugin(() => registry));
  return registry;
}
