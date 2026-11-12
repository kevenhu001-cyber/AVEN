import {
  NotificationDeadListSchema,
  NotificationListQuerySchema,
  NotificationListSchema,
  NotificationPreferencesSchema,
  NotificationRetryResultSchema,
  NotificationSchema,
  RequestIdSchema,
  RetryNotificationSchema,
  UpdateNotificationPreferencesSchema,
} from '@aven/contracts';
import { authenticatedOptions, type ApiRequest, type ConnectionCallOptions } from './connections';
export type NotificationCallOptions = ConnectionCallOptions;

export function createNotificationsClient(request: ApiRequest, invalid: () => Error) {
  const base = '/api/v1/notifications';
  const options = (call: NotificationCallOptions, write = false) =>
    authenticatedOptions(call, write, invalid);
  function id(value: string) {
    const result = RequestIdSchema.safeParse(value);
    if (!result.success) throw invalid();
    return result.data;
  }
  return {
    async list(
      query: { limit?: number; cursorCreatedAt?: string; cursorId?: string },
      call: NotificationCallOptions,
    ) {
      const parsed = NotificationListQuerySchema.safeParse(query);
      if (!parsed.success) throw invalid();
      const params = new URLSearchParams({ limit: String(parsed.data.limit) });
      if (parsed.data.cursorCreatedAt && parsed.data.cursorId) {
        params.set('cursorCreatedAt', parsed.data.cursorCreatedAt);
        params.set('cursorId', parsed.data.cursorId);
      }
      return request(`${base}?${params}`, NotificationListSchema.parse, options(call));
    },
    async read(notificationId: string, call: NotificationCallOptions) {
      return request(
        `${base}/${id(notificationId)}/read`,
        NotificationSchema.parse,
        options(call, true),
      );
    },
    async getPreferences(call: NotificationCallOptions) {
      return request(`${base}/preferences`, NotificationPreferencesSchema.parse, options(call));
    },
    async updatePreferences(
      input: {
        connectionInvitations?: boolean;
        connectionUpdates?: boolean;
        eventInvitations?: boolean;
        eventUpdates?: boolean;
        expectedVersion: number;
      },
      call: NotificationCallOptions,
    ) {
      const parsed = UpdateNotificationPreferencesSchema.safeParse(input);
      if (!parsed.success) throw invalid();
      return request(`${base}/preferences`, NotificationPreferencesSchema.parse, {
        ...options(call, true),
        body: parsed.data,
      });
    },
    async listDead(call: NotificationCallOptions) {
      return request(`${base}/deliveries/dead`, NotificationDeadListSchema.parse, options(call));
    },
    async retry(deliveryId: string, expectedGeneration: number, call: NotificationCallOptions) {
      const parsed = RetryNotificationSchema.safeParse({ expectedGeneration });
      if (!parsed.success) throw invalid();
      return request(
        `${base}/deliveries/${id(deliveryId)}/retry`,
        NotificationRetryResultSchema.parse,
        { ...options(call, true), body: parsed.data },
      );
    },
  };
}
