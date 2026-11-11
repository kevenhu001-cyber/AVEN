import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import {
  EventParticipantSchema,
  EventSchema,
  type CancelEventRequest,
  type CreateEventDraftRequest,
  type Event,
  type EventParticipant,
  type EventParticipantResponse,
  type EventStatus,
  type ProposeEventTimeRequest,
  type RespondEventParticipantRequest,
} from '@aven/contracts';
import { createApplicationPool, withRequestContext, type DatabasePool } from '@aven/database';
import type { AuthContext } from '../auth/auth.types.js';

type EventRow = {
  id: string;
  organizer_principal_id: string;
  organizer_name?: string;
  relationship_id: string | null;
  organization_id: string | null;
  title: string;
  description: string | null;
  location: string | null;
  start_at: Date;
  end_at: Date;
  timezone: string;
  status: EventStatus;
  version: number;
  my_response?: EventParticipantResponse;
  created_at: Date;
  updated_at?: Date;
};

type ParticipantRow = {
  id: string;
  event_id: string;
  principal_id: string;
  role: string;
  response: EventParticipantResponse;
  responded_at: Date | null;
};

function mapParticipant(row: ParticipantRow): EventParticipant {
  return EventParticipantSchema.parse({
    id: row.id,
    eventId: row.event_id,
    principalId: row.principal_id,
    role: row.role,
    response: row.response,
    respondedAt: row.responded_at ? new Date(row.responded_at).toISOString() : null,
  });
}

function mapEvent(row: EventRow, participants?: EventParticipant[]): Event {
  return EventSchema.parse({
    id: row.id,
    organizerPrincipalId: row.organizer_principal_id,
    organizerName: row.organizer_name,
    relationshipId: row.relationship_id ?? null,
    organizationId: row.organization_id ?? null,
    title: row.title,
    description: row.description ?? null,
    location: row.location ?? null,
    startAt: new Date(row.start_at).toISOString(),
    endAt: new Date(row.end_at).toISOString(),
    timezone: row.timezone,
    status: row.status,
    version: row.version,
    myResponse: row.my_response,
    participants: participants ?? [],
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : new Date(row.created_at).toISOString(),
  });
}

@Injectable()
export class EventService implements OnModuleDestroy {
  private pool: DatabasePool | null = null;

  private getPool(): DatabasePool {
    if (!this.pool) {
      this.pool = createApplicationPool();
    }
    return this.pool;
  }

  private context(auth: AuthContext) {
    return { principalId: auth.principalId, userId: auth.userId };
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  async createDraft(auth: AuthContext, input: CreateEventDraftRequest): Promise<Event> {
    const eventId = await withRequestContext(this.getPool(), this.context(auth), async (client) => {
      const res = await client.query<EventRow>(
        `SELECT * FROM app.create_event_draft(
          $1, $2, $3, $4, $5, $6, $7, $8, $9::uuid[]
        )`,
        [
          input.title,
          input.description ?? null,
          input.location ?? null,
          input.startAt ? new Date(input.startAt) : null,
          input.endAt ? new Date(input.endAt) : null,
          input.timezone,
          input.relationshipId ?? null,
          input.organizationId ?? null,
          input.attendeePrincipalIds,
        ],
      );
      const row = res.rows[0];
      if (!row) throw new NotFoundException('Failed to create event draft.');
      return row.id;
    });

    return this.get(auth, eventId);
  }

  async get(auth: AuthContext, eventId: string): Promise<Event> {
    return withRequestContext(this.getPool(), this.context(auth), async (client) => {
      const res = await client.query<EventRow>(
        'SELECT * FROM app.get_event($1)',
        [eventId],
      );
      const row = res.rows[0];
      if (!row) throw new NotFoundException('Event not found.');

      // Fetch participants
      const partRes = await client.query<ParticipantRow>(
        'SELECT * FROM public.event_participants WHERE event_id = $1 ORDER BY created_at ASC',
        [eventId],
      );
      const participants = partRes.rows.map(mapParticipant);

      return mapEvent(row, participants);
    });
  }

  async listMine(auth: AuthContext, status?: EventStatus): Promise<Event[]> {
    return withRequestContext(this.getPool(), this.context(auth), async (client) => {
      const res = await client.query<EventRow>(
        'SELECT * FROM app.list_my_events($1)',
        [status ?? null],
      );
      return res.rows.map((r) => mapEvent(r));
    });
  }

  async proposeTime(auth: AuthContext, eventId: string, input: ProposeEventTimeRequest): Promise<Event> {
    await withRequestContext(this.getPool(), this.context(auth), async (client) => {
      try {
        await client.query(
          'SELECT * FROM app.propose_event_time($1, $2, $3, $4, $5)',
          [
            eventId,
            new Date(input.startAt),
            new Date(input.endAt),
            input.timezone,
            input.expectedVersion,
          ],
        );
      } catch (err) {
        if (err instanceof Error && 'code' in err && (err as { code: string }).code === '40001') {
          throw new ConflictException('Event version conflict.');
        }
        throw err;
      }
    });

    return this.get(auth, eventId);
  }

  async respond(auth: AuthContext, eventId: string, input: RespondEventParticipantRequest): Promise<Event> {
    await withRequestContext(this.getPool(), this.context(auth), async (client) => {
      try {
        await client.query(
          'SELECT * FROM app.respond_event_participant($1, $2::public.event_participant_response, $3)',
          [eventId, input.response, input.expectedVersion ?? null],
        );
      } catch (err) {
        if (err instanceof Error && 'code' in err && (err as { code: string }).code === '40001') {
          throw new ConflictException('Event version conflict.');
        }
        throw err;
      }
    });

    return this.get(auth, eventId);
  }

  async cancel(auth: AuthContext, eventId: string, input: CancelEventRequest): Promise<Event> {
    await withRequestContext(this.getPool(), this.context(auth), async (client) => {
      await client.query(
        'SELECT app.cancel_event($1, $2)',
        [eventId, input.reason ?? 'Cancelled by participant'],
      );
    });

    return this.get(auth, eventId);
  }
}
