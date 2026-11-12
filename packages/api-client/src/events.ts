import {
  CoordinateEventRequestSchema,
  CoordinateEventResponseSchema,
  type CoordinateEventRequest,
  type CoordinateEventResponse,
} from '@aven/contracts';
import { authenticatedOptions, type ApiRequest, type ConnectionCallOptions } from './connections';

export type EventCallOptions = ConnectionCallOptions;

export type EventsClient = ReturnType<typeof createEventsClient>;

export function createEventsClient(request: ApiRequest, invalidRequest: () => Error) {
  return {
    async coordinate(
      input: CoordinateEventRequest,
      options: EventCallOptions,
    ): Promise<CoordinateEventResponse> {
      const parsed = CoordinateEventRequestSchema.safeParse(input);
      if (!parsed.success) throw invalidRequest();
      const transport = authenticatedOptions(options, 'POST', invalidRequest);
      return request(
        '/api/v1/events/coordinate',
        (value) => CoordinateEventResponseSchema.parse(value),
        { ...transport, body: parsed.data },
      );
    },
  };
}
