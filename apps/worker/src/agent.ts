import { providerForRun } from './run-provider.js';
import type { ExternalRunIdentity } from './external-preflight.js';
import { createHash, randomBytes } from 'node:crypto';
import {
  AIError,
  ToolExecutor,
  ToolRegistry,
  buildPersonalContextMessages,
  buildOrganizationContextMessages,
  createMemorySearchTool,
  createOpportunitySearchTool,
  createOrganizationContextSearchTool,
  createOpportunityDraftCreateTool,
  matchPersonalMemory,
  type AIMessage,
  type AIProvider,
  type MemorySearchResult,
  type OpportunitySearchResult,
  type OrganizationContextSearchResult,
  type ToolActor,
  type ToolAuditSink,
} from '@aven/ai-core';
import {
  TOOL_PERMISSIONS,
  type AgentRunStatus,
  type CreateOpportunityDraftRequest,
} from '@aven/contracts';
import type { LogWriter } from '@aven/config/logger';
import type { DatabasePool } from '@aven/database';

type RunContextRow = {
  run_id: string;
  principal_id: string;
  initiated_by_user_id: string;
  conversation_id: string;
  input_message_id: string;
  input_body: string;
  status: AgentRunStatus;
  provider: string;
  model: string;
  cancel_requested_at: Date | null;
};

type MemoryRow = {
  id: string;
  title: string;
  content: string;
  version: number;
  policy_version: number;
};

type OrgContextRow = {
  id: string;
  name: string;
  description: string | null;
  website_url: string | null;
  logo_url: string | null;
  campus_name: string | null;
  member_count: number;
};

type OrgOpportunityRow = {
  id: string;
  title: string;
  summary: string;
  stage: 'undergraduate' | 'master' | 'phd' | 'postdoc' | 'any';
  status: 'draft' | 'open' | 'paused' | 'closed' | 'expired';
  visibility: 'organization' | 'campus' | 'public';
  headcount: number;
  deadline: Date | null;
};

export type AgentRunProcessorOptions = {
  deltaDelayMs?: number;
  cancelPollMs?: number;
  userProvider?: (runId: string) => Promise<AIProvider>;
  authorizeExternal?: (identity: ExternalRunIdentity) => Promise<boolean>;
};

export type AgentRunProcessResult = 'completed' | 'failed' | 'cancelled' | 'skipped';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startRun(
  pool: DatabasePool,
  runId: string,
): Promise<{ status: AgentRunStatus; claimed: boolean } | undefined> {
  const result = await pool.query<{ status: AgentRunStatus; claimed: boolean }>(
    'SELECT * FROM app.start_agent_run($1)',
    [runId],
  );
  return result.rows[0];
}

async function getRunContext(
  pool: DatabasePool,
  runId: string,
): Promise<RunContextRow | undefined> {
  const result = await pool.query<RunContextRow>('SELECT * FROM app.get_agent_run_for_worker($1)', [
    runId,
  ]);
  return result.rows[0];
}

async function appendEvent(
  pool: DatabasePool,
  runId: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await pool.query('SELECT app.append_agent_run_event($1, $2, $3)', [
    runId,
    eventType,
    JSON.stringify(payload),
  ]);
}

async function bindSource(
  pool: DatabasePool,
  runId: string,
  sourceId: string,
  sourceVersion: string,
  policyVersion: number,
): Promise<void> {
  await pool.query('SELECT app.bind_agent_run_source($1, $2, $3, $4, $5, $6)', [
    runId,
    'memory_item',
    sourceId,
    sourceVersion,
    policyVersion,
    null,
  ]);
}

async function appendMessage(pool: DatabasePool, runId: string, body: string): Promise<string> {
  const result = await pool.query<{ id: string }>('SELECT app.append_agent_message($1, $2) AS id', [
    runId,
    body,
  ]);
  const id = result.rows[0]?.id;
  if (!id) throw new Error('AGENT_MESSAGE_CREATE_FAILED');
  return id;
}

async function finishRun(
  pool: DatabasePool,
  runId: string,
  status: AgentRunStatus,
  terminalEventType: string,
  payload: Record<string, unknown>,
  outputSummary: string | null,
  errorCode: string | null,
): Promise<void> {
  await pool.query('SELECT app.finish_agent_run($1, $2, $3, $4, $5, $6)', [
    runId,
    status,
    terminalEventType,
    JSON.stringify(payload),
    outputSummary,
    errorCode,
  ]);
}

async function isCancelRequested(pool: DatabasePool, runId: string): Promise<boolean> {
  const result = await pool.query<{ cancelled: boolean }>(
    'SELECT app.is_agent_run_cancel_requested($1) AS cancelled',
    [runId],
  );
  return result.rows[0]?.cancelled ?? false;
}

async function listMemory(pool: DatabasePool, ownerId: string): Promise<MemoryRow[]> {
  const result = await pool.query<MemoryRow>(
    "SELECT * FROM app.list_memory_for_use_for_worker($1, 'self_ai', 20)",
    [ownerId],
  );
  return result.rows;
}

function createMemoryService(pool: DatabasePool, runId: string, ownerId: string) {
  return {
    async search(input: { query: string; limit: number }): Promise<MemorySearchResult> {
      const rows = await listMemory(pool, ownerId);
      const matches = matchPersonalMemory(rows, input, 'self_ai');
      for (const item of matches) {
        await bindSource(pool, runId, item.id, String(item.version), item.policy_version);
      }
      return {
        items: matches.map((item) => ({
          id: item.id,
          title: item.title,
          content: item.content,
        })),
      };
    },
  };
}

async function getOrgContext(
  pool: DatabasePool,
  orgId: string,
): Promise<OrgContextRow | undefined> {
  const result = await pool.query<OrgContextRow>(
    'SELECT * FROM app.get_organization_for_worker($1)',
    [orgId],
  );
  return result.rows[0];
}

async function listOrgOpportunities(
  pool: DatabasePool,
  orgId: string,
  limit: number,
): Promise<OrgOpportunityRow[]> {
  const result = await pool.query<OrgOpportunityRow>(
    'SELECT * FROM app.list_organization_opportunities_for_worker($1, $2)',
    [orgId, limit],
  );
  return result.rows;
}

async function createOrgActionDraft(
  pool: DatabasePool,
  orgId: string,
  userId: string,
  runId: string,
  payload: CreateOpportunityDraftRequest,
): Promise<{
  id: string;
  status: 'pending_confirmation';
  action_type: 'opportunity.create';
  draft_payload: Record<string, unknown>;
}> {
  const token = randomBytes(24).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const result = await pool.query<{
    id: string;
    status: 'pending_confirmation';
    action_type: 'opportunity.create';
    draft_payload: Record<string, unknown>;
  }>('SELECT * FROM app.create_organization_action_for_worker($1, $2, $3, $4, $5, $6, $7)', [
    orgId,
    userId,
    runId,
    'opportunity.create',
    JSON.stringify(payload),
    600,
    tokenHash,
  ]);
  const row = result.rows[0];
  if (!row) throw new Error('CREATE_ORG_ACTION_DRAFT_FAILED');
  return row;
}

export async function processAgentRun(
  pool: DatabasePool,
  runId: string,
  configuredProvider: AIProvider,
  log: LogWriter,
  options: AgentRunProcessorOptions = {},
): Promise<AgentRunProcessResult> {
  const start = await startRun(pool, runId);
  if (!start) return 'skipped';
  if (!start.claimed) {
    if (start.status === 'cancelling') {
      await finishRun(
        pool,
        runId,
        'cancelled',
        'turn.cancelled',
        { reason: 'user_cancelled' },
        null,
        null,
      );
      log({ level: 'info', event: 'agent.run.cancelled', run_id: runId });
      return 'cancelled';
    }
    return 'skipped';
  }

  log({ level: 'info', event: 'agent.run.started', run_id: runId });
  let controller: AbortController | undefined;
  let poller: ReturnType<typeof setInterval> | undefined;
  try {
    const run = await getRunContext(pool, runId);
    if (!run) throw new AIError('RUNTIME_FAILED', 'Agent run context is unavailable.');

    await appendEvent(pool, runId, 'turn.started', {});

    const isOrgRun = run.principal_id !== run.initiated_by_user_id;
    if (isOrgRun && run.provider !== 'mock')
      throw new AIError('TOOL_SCOPE_DENIED', 'External organization runs are not enabled.');

    const actor: ToolActor = isOrgRun
      ? {
          principalId: run.principal_id,
          userId: run.initiated_by_user_id,
          permissions: new Set([
            TOOL_PERMISSIONS.opportunityReadOrg,
            TOOL_PERMISSIONS.opportunityWriteOrg,
            TOOL_PERMISSIONS.organizationReadContext,
          ]),
          allowedUses: new Set([]),
        }
      : {
          principalId: run.principal_id,
          userId: run.initiated_by_user_id,
          permissions: new Set([TOOL_PERMISSIONS.memoryReadSelf]),
          allowedUses: new Set(['self_ai']),
        };

    const audit: ToolAuditSink = {
      record: (event) => {
        log({
          level: event.status === 'succeeded' ? 'info' : 'warn',
          event: 'agent.tool_audit',
          run_id: runId,
          tool_name: event.toolName,
          attempt: event.attempt,
          ...(event.errorCode === undefined ? {} : { error_code: event.errorCode }),
        });
      },
    };

    const registry = new ToolRegistry();
    if (isOrgRun) {
      registry.register(
        createOrganizationContextSearchTool({
          async search(_input) {
            const org = await getOrgContext(pool, run.principal_id);
            if (!org) throw new AIError('TOOL_EXECUTION_FAILED', 'Organization not found.');
            return {
              id: org.id,
              name: org.name,
              description: org.description,
              websiteUrl: org.website_url,
              campusName: org.campus_name,
              memberCount: org.member_count,
              domains: [],
            };
          },
        }),
      );
      registry.register(
        createOpportunitySearchTool({
          async search(input) {
            const rows = await listOrgOpportunities(pool, run.principal_id, input.limit ?? 10);
            return {
              items: rows.map((r) => ({
                id: r.id,
                title: r.title,
                summary: r.summary,
                stage: r.stage,
                status: r.status,
                visibility: r.visibility,
                headcount: r.headcount,
                deadline: r.deadline ? r.deadline.toISOString() : null,
              })),
            };
          },
        }),
      );
      registry.register(
        createOpportunityDraftCreateTool({
          async createDraft(input) {
            const row = await createOrgActionDraft(
              pool,
              run.principal_id,
              run.initiated_by_user_id,
              runId,
              input,
            );
            return {
              actionId: row.id,
              status: 'pending_confirmation',
              actionType: 'opportunity.create',
              preview: row.draft_payload,
            };
          },
        }),
      );
    } else {
      registry.register(createMemorySearchServiceTool(pool, runId, run.initiated_by_user_id));
    }

    const executor = new ToolExecutor(registry, { retryDelayMs: () => 0 });

    let messages: AIMessage[];
    if (isOrgRun) {
      await appendEvent(pool, runId, 'tool.started', { tool: 'organization_context.search' });
      const orgContextResult = await executor.execute<OrganizationContextSearchResult>(
        'organization_context.search',
        { query: run.input_body.slice(0, 500) },
        { actor, requestId: `run:${runId}`, audit },
      );
      await appendEvent(pool, runId, 'tool.completed', {
        tool: 'organization_context.search',
        status: 'succeeded',
      });

      await appendEvent(pool, runId, 'tool.started', { tool: 'opportunity.search' });
      const oppResult = await executor.execute<OpportunitySearchResult>(
        'opportunity.search',
        { query: run.input_body.slice(0, 500), limit: 10 },
        { actor, requestId: `run:${runId}`, audit },
      );
      await appendEvent(pool, runId, 'tool.completed', {
        tool: 'opportunity.search',
        status: 'succeeded',
        itemCount: oppResult.value.items.length,
      });

      messages = buildOrganizationContextMessages({
        userMessage: run.input_body,
        organization: orgContextResult.value,
        opportunities: oppResult.value.items,
      });
    } else {
      await appendEvent(pool, runId, 'tool.started', { tool: 'memory.search' });
      const toolResult = await executor.execute<MemorySearchResult>(
        'memory.search',
        { query: run.input_body.slice(0, 500) },
        { actor, requestId: `run:${runId}`, audit },
      );
      await appendEvent(pool, runId, 'tool.completed', {
        tool: 'memory.search',
        status: 'succeeded',
        itemCount: toolResult.value.items.length,
      });

      messages = buildPersonalContextMessages({
        userMessage: run.input_body,
        memories: toolResult.value.items,
      });
    }

    const provider =
      run.provider === 'user_openai_compatible'
        ? await options.userProvider?.(runId)
        : providerForRun(configuredProvider, {
            provider: run.provider,
            model: run.model,
            personal: !isOrgRun,
          });
    if (!provider || provider.metadata.model !== run.model)
      throw new AIError('PROVIDER_NOT_CONFIGURED', 'Personal provider configuration changed.');
    if (!provider.metadata.mock) {
      const allowed = await options.authorizeExternal?.({
        runId,
        userId: run.initiated_by_user_id,
        principalId: run.principal_id,
      });
      if (!allowed)
        throw new AIError('TOOL_SCOPE_DENIED', 'External input authorization is no longer valid.');
      if (await isCancelRequested(pool, runId))
        throw new AIError('PROVIDER_CANCELLED', 'The request was cancelled.');
    }
    controller = new AbortController();
    poller = setInterval(() => {
      void isCancelRequested(pool, runId)
        .then((cancelled) => {
          if (cancelled) controller?.abort();
        })
        .catch(() => undefined);
    }, options.cancelPollMs ?? 250);
    poller.unref();

    let output = '';
    let usage: { inputTokens: number; outputTokens: number; totalTokens: number } | undefined;
    for await (const event of provider.streamText({
      messages,
      model: run.model,
      maxTokens: 2048,
      signal: controller.signal,
    })) {
      if (event.type === 'text_delta') {
        output += event.text;
        await appendEvent(pool, runId, 'message.delta', { text: event.text });
        if (options.deltaDelayMs) await delay(options.deltaDelayMs);
      } else if (event.type === 'done') {
        usage = event.usage;
      } else if (event.type === 'error') {
        throw new AIError(event.error.code, event.error.message, {
          retryable: event.error.retryable,
        });
      }
    }

    if (await isCancelRequested(pool, runId)) {
      await finishRun(
        pool,
        runId,
        'cancelled',
        'turn.cancelled',
        { reason: 'user_cancelled' },
        null,
        null,
      );
      log({ level: 'info', event: 'agent.run.cancelled', run_id: runId });
      return 'cancelled';
    }
    if (output.trim().length === 0) {
      throw new AIError('PROVIDER_INVALID_OUTPUT', 'The AI provider returned no text.');
    }
    const messageId = await appendMessage(pool, runId, output);
    await finishRun(
      pool,
      runId,
      'completed',
      'turn.completed',
      { messageId, ...(usage === undefined ? {} : { usage }) },
      provider.metadata.mock ? 'mock_response' : 'assistant_response',
      null,
    );
    log({ level: 'info', event: 'agent.run.completed', run_id: runId });
    return 'completed';
  } catch (error) {
    const cancelled = await isCancelRequested(pool, runId).catch(() => false);
    if (cancelled || (error instanceof AIError && error.code === 'PROVIDER_CANCELLED')) {
      await finishRun(
        pool,
        runId,
        'cancelled',
        'turn.cancelled',
        { reason: 'user_cancelled' },
        null,
        null,
      ).catch(() => undefined);
      log({ level: 'info', event: 'agent.run.cancelled', run_id: runId });
      return 'cancelled';
    }
    const errorCode = error instanceof AIError ? error.code : 'RUNTIME_FAILED';
    await finishRun(
      pool,
      runId,
      'failed',
      'turn.failed',
      { error_code: errorCode },
      null,
      errorCode,
    ).catch(() => undefined);
    log({ level: 'error', event: 'agent.run.failed', run_id: runId, error_code: errorCode });
    return 'failed';
  } finally {
    if (poller) clearInterval(poller);
    controller?.abort();
  }
}

function createMemorySearchServiceTool(pool: DatabasePool, runId: string, ownerId: string) {
  return createMemorySearchTool(createMemoryService(pool, runId, ownerId));
}
