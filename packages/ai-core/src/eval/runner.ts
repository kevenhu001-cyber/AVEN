import { TOOL_PERMISSIONS } from '@aven/contracts';
import { AIError } from '../errors.js';
import type { AIProvider, AIUsage } from '../provider.js';
import { ToolExecutor } from '../tool-executor.js';
import { InMemoryToolAuditSink, ToolRegistry, type ToolActor } from '../tools.js';
import { createMemorySearchTool } from '../tools/memory-search.js';
import type { EvalCase, EvalDataset } from './dataset.js';
import {
  buildPersonalContextMessages,
  countTagOccurrences,
  matchPersonalMemory,
  PERSONAL_CONTEXT_CLOSE,
  PERSONAL_CONTEXT_OPEN,
} from './pipeline.js';

export type EvalCheckStatus = 'pass' | 'fail' | 'skipped';

export type EvalCheck = {
  name: string;
  status: EvalCheckStatus;
  detail?: string;
};

export type EvalCaseMetrics = {
  latencyMs: number;
  toolCalls: number;
  totalTokens: number;
  costUsd?: number;
};

export type EvalCaseResult = {
  id: string;
  category: EvalCase['category'];
  blocking: boolean;
  status: 'pass' | 'fail';
  checks: EvalCheck[];
  metrics: EvalCaseMetrics;
  outputChars: number;
  outputText: string;
};

export type EvalRunOptions = {
  provider: AIProvider;
  dataset: EvalDataset;
  requestId?: string;
  now?: () => number;
};

function idsEqual(expected: readonly string[], actual: readonly string[]): boolean {
  if (expected.length !== actual.length) return false;
  const expectedSet = new Set(expected);
  return actual.every((id) => expectedSet.has(id));
}

function check(name: string, ok: boolean, detail?: string): EvalCheck {
  return { name, status: ok ? 'pass' : 'fail', ...(detail === undefined ? {} : { detail }) };
}

async function runCase(testCase: EvalCase, options: EvalRunOptions): Promise<EvalCaseResult> {
  const now = options.now ?? Date.now;
  const started = now();
  const audit = new InMemoryToolAuditSink();
  const actor: ToolActor = {
    principalId: 'e0000000-0000-4000-8000-000000000000',
    userId: 'e0000000-0000-4000-8000-000000000000',
    permissions: testCase.expectToolDenied ? new Set() : new Set([TOOL_PERMISSIONS.memoryReadSelf]),
    allowedUses: new Set(['self_ai']),
  };
  const registry = new ToolRegistry();
  registry.register(
    createMemorySearchTool({
      async search(input) {
        const matches = matchPersonalMemory(testCase.memories, input, 'self_ai');
        return {
          items: matches.map((item) => ({
            id: item.id,
            title: item.title,
            content: item.content,
          })),
        };
      },
    }),
  );
  const executor = new ToolExecutor(registry, { retryDelayMs: () => 0 });

  let boundSourceIds: string[] = [];
  let deniedCode: string | undefined;
  let toolCalls = 0;
  try {
    toolCalls += 1;
    const result = await executor.execute<{
      items: { id: string; title: string; content: string }[];
    }>(
      'memory.search',
      { query: testCase.input.slice(0, 500), limit: 5 },
      { actor, requestId: options.requestId ?? 'eval', audit },
    );
    boundSourceIds = result.value.items.map((item) => item.id);
  } catch (error) {
    deniedCode = error instanceof AIError ? error.code : 'UNKNOWN';
  }

  const memories = boundSourceIds.map((id) => {
    const memory = testCase.memories.find((item) => item.id === id);
    return { title: memory?.title ?? '', content: memory?.content ?? '' };
  });
  const messages = buildPersonalContextMessages({
    userMessage: testCase.input,
    memories,
  });
  const prompt = messages.map((message) => message.content).join('\n');

  let output = '';
  let usage: AIUsage | undefined;
  let providerError: string | undefined;
  try {
    for await (const event of options.provider.streamText({
      messages,
      purpose: 'general',
    })) {
      if (event.type === 'text_delta') {
        output += event.text;
      } else if (event.type === 'done') {
        usage = event.usage;
      } else if (event.type === 'error') {
        throw new AIError(event.error.code, event.error.message, {
          retryable: event.error.retryable,
        });
      }
    }
  } catch (error) {
    providerError = error instanceof AIError ? error.code : 'PROVIDER_ERROR';
  }
  const latencyMs = Math.max(0, now() - started);
  const metrics: EvalCaseMetrics = {
    latencyMs,
    toolCalls,
    totalTokens: usage?.totalTokens ?? 0,
    ...(usage?.costUsd === undefined ? {} : { costUsd: usage.costUsd }),
  };

  const checks: EvalCheck[] = [];
  checks.push(
    check(
      'provider_call',
      providerError === undefined,
      providerError === undefined ? 'completed' : `error=${providerError}`,
    ),
  );
  const retrievalOk =
    idsEqual(testCase.expected.boundSourceIds, boundSourceIds) &&
    (testCase.expected.retrievalEmpty ? boundSourceIds.length === 0 : true);
  checks.push(
    check(
      'retrieval_scope',
      retrievalOk,
      deniedCode === undefined
        ? `expected=${testCase.expected.boundSourceIds.length} actual=${boundSourceIds.length}`
        : `tool_error=${deniedCode} expected=${testCase.expected.boundSourceIds.length} actual=${boundSourceIds.length}`,
    ),
  );
  if (testCase.expectToolDenied) {
    checks.push(
      check(
        'tool_permission',
        deniedCode === 'TOOL_PERMISSION_DENIED',
        deniedCode === undefined ? 'tool was not denied' : `code=${deniedCode}`,
      ),
    );
  }

  const missing = testCase.expected.promptMustContain.filter((marker) => !prompt.includes(marker));
  const leaked = testCase.expected.promptMustNotContain.filter((marker) => prompt.includes(marker));
  checks.push(
    check(
      'prompt_boundary',
      missing.length === 0 && leaked.length === 0,
      `missing=${missing.length} leaked=${leaked.length}`,
    ),
  );

  const openCount = countTagOccurrences(prompt, PERSONAL_CONTEXT_OPEN);
  const closeCount = countTagOccurrences(prompt, PERSONAL_CONTEXT_CLOSE);
  checks.push(
    check(
      'context_tags_balanced',
      openCount <= 1 && closeCount <= 1 && openCount === closeCount,
      `open=${openCount} close=${closeCount}`,
    ),
  );

  if (providerError !== undefined) {
    checks.push({
      name: 'output_safety',
      status: 'skipped',
      detail: 'provider_call_failed',
    });
  } else if (options.provider.metadata.mock) {
    checks.push({
      name: 'output_safety',
      status: 'skipped',
      detail: 'mock_provider_cannot_exercise_model_behavior',
    });
  } else {
    const unsafe = testCase.expected.outputMustNotContain.filter((marker) =>
      output.includes(marker),
    );
    checks.push(
      check(
        'output_safety',
        unsafe.length === 0,
        unsafe.length === 0 ? 'clean' : `markers=${unsafe.length}`,
      ),
    );
  }

  checks.push(
    check(
      'budget_latency',
      metrics.latencyMs <= testCase.budget.maxLatencyMs,
      `${metrics.latencyMs}ms <= ${testCase.budget.maxLatencyMs}ms`,
    ),
    check(
      'budget_tool_calls',
      metrics.toolCalls <= testCase.budget.maxToolCalls,
      `${metrics.toolCalls} <= ${testCase.budget.maxToolCalls}`,
    ),
    check(
      'budget_tokens',
      metrics.totalTokens <= testCase.budget.maxTotalTokens,
      `${metrics.totalTokens} <= ${testCase.budget.maxTotalTokens}`,
    ),
  );
  if (testCase.budget.maxCostUsd !== undefined) {
    checks.push({
      name: 'budget_cost',
      status:
        metrics.costUsd === undefined
          ? 'skipped'
          : metrics.costUsd <= testCase.budget.maxCostUsd
            ? 'pass'
            : 'fail',
      detail:
        metrics.costUsd === undefined
          ? 'provider_did_not_report_cost'
          : `${metrics.costUsd} <= ${testCase.budget.maxCostUsd}`,
    });
  }

  return {
    id: testCase.id,
    category: testCase.category,
    blocking: testCase.blocking,
    status: checks.some((item) => item.status === 'fail') ? 'fail' : 'pass',
    checks,
    metrics,
    outputChars: output.length,
    outputText: output,
  };
}

export async function runEvaluation(options: EvalRunOptions): Promise<EvalCaseResult[]> {
  const results: EvalCaseResult[] = [];
  for (const testCase of options.dataset.cases) {
    results.push(await runCase(testCase, options));
  }
  return results;
}
