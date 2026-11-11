import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  Res,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  AgentCancelResponseSchema,
  AgentRunSchema,
  AgentTurnRequestSchema,
  AgentTurnResponseSchema,
  RequestIdSchema,
} from '@aven/contracts';
import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth } from '../auth/current-auth.decorator.js';
import { ApiCodeException } from '../http-errors.js';
import { parse } from '../http-validation.js';
import { AgentService, formatAgentSafeFailure, parseLastEventId } from './agent.service.js';

function parseId(value: string): string {
  const parsed = RequestIdSchema.safeParse(value);
  if (!parsed.success) throw new UnprocessableEntityException('Invalid identifier.');
  return parsed.data;
}

function requireIdempotencyKey(value: string | undefined): string {
  const key = value?.trim();
  if (!key || key.length > 200) {
    throw new UnprocessableEntityException('Idempotency-Key is required.');
  }
  return key;
}

@Controller('api/v1/agent')
@UseGuards(AuthGuard)
export class AgentController {
  constructor(@Inject(AgentService) private readonly agent: AgentService) {}

  @Post('turns')
  @HttpCode(201)
  async createTurn(
    @CurrentAuth() auth: AuthContext,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    const input = parse(AgentTurnRequestSchema, body);
    return AgentTurnResponseSchema.parse(
      await this.agent.createTurn(auth, input, requireIdempotencyKey(idempotencyKey)),
    );
  }

  @Get('runs/:id')
  async getRun(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    return AgentRunSchema.parse(await this.agent.getRun(auth, parseId(id)));
  }

  @Post('runs/:id/cancel')
  async cancel(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.agent.cancel(
      auth,
      parseId(id),
      requireIdempotencyKey(idempotencyKey),
    );
    response.status(result.accepted ? 202 : 200);
    return AgentCancelResponseSchema.parse({
      runId: result.runId,
      status: result.status,
    });
  }

  @Get('runs/:id/events')
  async streamEvents(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Headers('last-event-id') lastEventIdHeader: string | undefined,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const runId = parseId(id);
    const lastEventId = parseLastEventId(lastEventIdHeader);
    const context = await this.agent.getStreamContext(auth, runId);
    this.agent.assertStreamAllowed(context, lastEventId);

    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    response.flushHeaders();

    const controller = new AbortController();
    const onClose = (): void => controller.abort();
    request.on('close', onClose);
    let lastSequence = lastEventId;
    try {
      for await (const chunk of this.agent.streamEvents(
        auth,
        runId,
        lastEventId,
        controller.signal,
      )) {
        if (response.writableEnded) break;
        response.write(chunk.data);
        if (chunk.sequence !== undefined) lastSequence = chunk.sequence;
      }
    } catch (error) {
      if (!response.writableEnded) {
        const code = error instanceof ApiCodeException ? error.code : 'RUNTIME_UNAVAILABLE';
        response.write(formatAgentSafeFailure(runId, lastSequence, code));
      }
    } finally {
      request.off('close', onClose);
      response.end();
    }
  }
}
