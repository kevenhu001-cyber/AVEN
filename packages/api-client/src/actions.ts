import {
  ActionSchema,
  ActionCreateRequestSchema,
  ActionCreateResponseSchema,
  ActionConfirmRequestSchema,
  RequestIdSchema,
  type ActionCreateRequest,
} from '@aven/contracts';
import { authenticatedOptions, type ApiRequest, type ConnectionCallOptions } from './connections';
export function createActionsClient(request: ApiRequest, invalid: () => Error) {
  const path = (value: string) => {
    const parsed = RequestIdSchema.safeParse(value);
    if (!parsed.success) throw invalid();
    return `/api/v1/actions/${parsed.data}`;
  };
  function keyed(key: string, call: ConnectionCallOptions) {
    if (!key.trim() || key.length > 200 || /[\r\n]/.test(key)) throw invalid();
    const init = authenticatedOptions(call, true, invalid);
    return { ...init, headers: { ...init.headers, 'Idempotency-Key': key } };
  }
  return {
    create(input: ActionCreateRequest, call: ConnectionCallOptions) {
      const parsed = ActionCreateRequestSchema.safeParse(input);
      if (!parsed.success) throw invalid();
      return request('/api/v1/actions', ActionCreateResponseSchema.parse, {
        ...authenticatedOptions(call, true, invalid),
        body: parsed.data,
      });
    },
    get(id: string, call: ConnectionCallOptions) {
      return request(path(id), ActionSchema.parse, authenticatedOptions(call, false, invalid));
    },
    confirm(
      id: string,
      input: { expectedDraftVersion: number; confirmationToken: string },
      key: string,
      call: ConnectionCallOptions,
    ) {
      const parsed = ActionConfirmRequestSchema.safeParse(input);
      if (!parsed.success) throw invalid();
      return request(`${path(id)}/confirm`, ActionSchema.parse, {
        ...keyed(key, call),
        body: parsed.data,
      });
    },
    cancel(id: string, key: string, call: ConnectionCallOptions) {
      return request(`${path(id)}/cancel`, ActionSchema.parse, keyed(key, call));
    },
  };
}
