import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  CoordinateEventResponseSchema,
  type CoordinateEventRequest,
  type CoordinateEventResponse,
} from '@aven/contracts';
import {
  createAIProvider,
  extractEventConstraints,
  isAIError,
  MockProvider,
  parseAIProviderConfig,
  type AIProvider,
} from '@aven/ai-core';
import { coordinateEventSchedule, resolveCoordinationConstraints } from '@aven/domain';
import type { AuthContext } from '../auth/auth.types.js';
import { AvailabilityService } from '../availability/availability.service.js';
import { ApiCodeException } from '../http-errors.js';

export const EVENT_COORDINATION_AI_PROVIDER = Symbol('EVENT_COORDINATION_AI_PROVIDER');

function defaultProvider(): AIProvider {
  try {
    return createAIProvider(parseAIProviderConfig(process.env));
  } catch {
    return new MockProvider();
  }
}

@Injectable()
export class EventCoordinationService {
  private readonly provider: AIProvider;

  constructor(
    @Inject(AvailabilityService) private readonly availability: AvailabilityService,
    @Optional() @Inject(EVENT_COORDINATION_AI_PROVIDER) provider?: AIProvider,
  ) {
    this.provider = provider ?? defaultProvider();
  }

  async coordinate(
    auth: AuthContext,
    input: CoordinateEventRequest,
    providerOverride?: AIProvider,
  ): Promise<CoordinateEventResponse> {
    const provider = providerOverride ?? this.provider;
    const referenceNow = input.referenceNow ?? new Date().toISOString();
    const uniqueParticipantIds = Array.from(new Set(input.participantIds));

    let extraction;
    try {
      extraction = await extractEventConstraints({
        provider,
        prompt: input.prompt,
        referenceNow,
        defaultTimezone: input.defaultTimezone,
      });
    } catch (error) {
      if (isAIError(error)) {
        if (error.code === 'PROVIDER_TIMEOUT') {
          throw new ApiCodeException('PROVIDER_TIMEOUT', 504, 'AI provider timed out.', true);
        }
        if (error.code === 'PROVIDER_RATE_LIMITED') {
          throw new ApiCodeException('RATE_LIMITED', 429, 'AI provider rate limit exceeded.', true);
        }
        throw new ApiCodeException(
          'PROVIDER_UNAVAILABLE',
          503,
          'AI provider could not extract constraints.',
          error.retryable,
        );
      }
      throw error;
    }

    const preliminary = resolveCoordinationConstraints(
      extraction.constraints,
      input.overrides,
      input.defaultTimezone,
    );

    if (preliminary.missingConstraints.length > 0) {
      return CoordinateEventResponseSchema.parse({
        status: 'needs_clarification',
        provider: extraction.provider,
        model: extraction.model,
        mock: extraction.mock,
        extractedConstraints: preliminary.constraints,
        missingConstraints: preliminary.missingConstraints,
        clarificationPrompts: preliminary.clarificationPrompts,
        candidates: [],
        externalCalendarsModified: false,
      });
    }

    const windowStart = preliminary.constraints.windowStart as string;
    const windowEnd = preliminary.constraints.windowEnd as string;

    // Query authorized availability projections (M6-01R fail-closed: 403 if any participant has not shared).
    const blocks = await this.availability.queryWindow(auth, {
      principalIds: uniqueParticipantIds,
      startAt: windowStart,
      endAt: windowEnd,
    });

    const busyIntervals = blocks
      .filter((b) => b.status === 'busy' || b.status === 'tentative')
      .map((b) => ({
        start: new Date(b.startAt),
        end: new Date(b.endAt),
      }));

    const solved = coordinateEventSchedule({
      extracted: extraction.constraints,
      ...(input.overrides ? { overrides: input.overrides } : {}),
      defaultTimezone: input.defaultTimezone,
      participantIds: uniqueParticipantIds,
      ...(input.participantTimezones ? { participantTimezones: input.participantTimezones } : {}),
      busyIntervals,
      maxCandidates: input.maxCandidates,
    });

    return CoordinateEventResponseSchema.parse({
      status: solved.status,
      provider: extraction.provider,
      model: extraction.model,
      mock: extraction.mock,
      extractedConstraints: solved.resolvedConstraints,
      missingConstraints: solved.missingConstraints,
      clarificationPrompts: solved.clarificationPrompts,
      candidates: solved.candidates,
      externalCalendarsModified: false,
    });
  }
}
