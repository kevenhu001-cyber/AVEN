import {
  AIError,
  InMemoryToolAuditSink,
  MemorySearchInputSchema,
  MemorySearchResultSchema,
  OpenAICompatibleProvider,
  ToolExecutor,
  ToolRegistry,
  createAIProvider,
  createMemorySearchTool,
  parseAIProviderConfig,
  type MemorySearchResult,
  type ToolActor,
  type ToolAuditSink,
  type ToolDefinition,
  type ToolExecutionContext,
} from '../packages/ai-core/dist/index.js';
import {
  TOOL_PERMISSIONS,
  type ContextUse,
  type ToolPermission,
} from '../packages/contracts/dist/index.js';

let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${detail}`}`);
  if (!ok) failed += 1;
}

async function expectCode(fn: () => Promise<unknown>, code: string): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch (error) {
    return error instanceof AIError && error.code === code;
  }
}

function syncErrorCode(fn: () => void): string | undefined {
  try {
    fn();
    return undefined;
  } catch (error) {
    return error instanceof AIError ? error.code : undefined;
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeOpenAI(fetchImpl: typeof fetch, timeoutMs = 1000): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    baseUrl: 'https://ai.example.test/v1',
    apiKey: 'test-key',
    model: 'test-model',
    timeoutMs,
    fetch: fetchImpl,
  });
}

function makeActor(
  permissions: ToolPermission[] = [TOOL_PERMISSIONS.memoryReadSelf],
  uses: ContextUse[] = ['self_ai'],
): ToolActor {
  return {
    principalId: 'b434644d-d195-4978-b457-765c6d9b755e',
    userId: 'b434644d-d195-4978-b457-765c6d9b755e',
    permissions: new Set(permissions),
    allowedUses: new Set(uses),
  };
}

function makeContext(audit: ToolAuditSink, actor = makeActor()): ToolExecutionContext {
  return { actor, requestId: 'ai-verify', audit };
}

async function main(): Promise<void> {
  const messages = [{ role: 'user' as const, content: '你好' }];
  const memoryItems: MemorySearchResult = {
    items: [
      {
        id: 'b434644d-d195-4978-b457-765c6d9b755e',
        title: '具身智能',
        content: '关注具身智能与机器人学习',
      },
    ],
  };

  const mockConfig = parseAIProviderConfig({});
  check('default provider config is mock', mockConfig.provider === 'mock');
  const mock = createAIProvider(mockConfig);
  check(
    'mock provider is explicitly marked',
    mock.metadata.mock === true && mock.metadata.provider === 'mock',
  );

  const mockText1 = await mock.generateText({ messages });
  const mockText2 = await mock.generateText({ messages });
  check(
    'mock text is deterministic',
    mockText1.text === mockText2.text && mockText1.text.length > 0,
  );
  const mockObject = await mock.generateObject({
    messages,
    schema: MemorySearchInputSchema,
    mockValue: { query: '具身智能' },
  });
  check('mock structured output applies schema defaults', mockObject.value.limit === 5);
  check(
    'mock structured output requires a value',
    await expectCode(
      () => mock.generateObject({ messages, schema: MemorySearchInputSchema }),
      'MOCK_RESULT_REQUIRED',
    ),
  );
  const mockStream: string[] = [];
  let mockDone = false;
  for await (const event of mock.streamText({ messages })) {
    if (event.type === 'text_delta') mockStream.push(event.text);
    if (event.type === 'done') mockDone = true;
  }
  check('mock stream ends with done', mockDone && mockStream.join('').length > 0);
  const mockEmbedding1 = await mock.generateEmbedding({ values: ['a', 'b'], dimensions: 8 });
  const mockEmbedding2 = await mock.generateEmbedding({ values: ['a', 'b'], dimensions: 8 });
  check(
    'mock embeddings are deterministic',
    JSON.stringify(mockEmbedding1.embeddings) === JSON.stringify(mockEmbedding2.embeddings) &&
      mockEmbedding1.embeddings[0]?.length === 8,
  );

  const openaiConfig = parseAIProviderConfig({
    AI_PROVIDER: 'openai_compatible',
    AI_BASE_URL: 'https://ai.example.test/v1',
    AI_API_KEY: 'test-key',
    AI_MODEL: 'test-model',
    AI_TIMEOUT_MS: '1000',
  });
  check('openai-compatible config parses', openaiConfig.provider === 'openai_compatible');
  const successProvider = makeOpenAI(async () =>
    jsonResponse({
      choices: [{ message: { content: '你好' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
  );
  const openaiText = await successProvider.generateText({ messages });
  check('openai-compatible text parses', openaiText.text === '你好' && openaiText.mock === false);
  check(
    'openai-compatible rate limit maps',
    await expectCode(
      () => makeOpenAI(async () => jsonResponse({}, 429)).generateText({ messages }),
      'PROVIDER_RATE_LIMITED',
    ),
  );
  check(
    'openai-compatible auth maps',
    await expectCode(
      () => makeOpenAI(async () => jsonResponse({}, 401)).generateText({ messages }),
      'PROVIDER_AUTH_FAILED',
    ),
  );
  check(
    'openai-compatible timeout maps',
    await expectCode(
      () =>
        makeOpenAI(
          (_input, init) =>
            new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () =>
                reject(new DOMException('aborted', 'AbortError')),
              );
            }),
          10,
        ).generateText({ messages }),
      'PROVIDER_TIMEOUT',
    ),
  );
  const objectProvider = makeOpenAI(async () =>
    jsonResponse({ choices: [{ message: { content: '{"query":"具身智能"}' } }] }),
  );
  const objectResult = await objectProvider.generateObject({
    messages,
    schema: MemorySearchInputSchema,
  });
  check('openai-compatible structured output validates', objectResult.value.limit === 5);
  const embeddingProvider = makeOpenAI(async () =>
    jsonResponse({
      data: [{ embedding: [0.1, 0.2] }],
      usage: { prompt_tokens: 1, total_tokens: 1 },
    }),
  );
  const embeddingResult = await embeddingProvider.generateEmbedding({ values: ['hello'] });
  check('openai-compatible embeddings parse', embeddingResult.embeddings[0]?.[0] === 0.1);
  const streamProvider = makeOpenAI(
    async () =>
      new Response('data: {"choices":[{"delta":{"content":"你"}}]}\ndata: [DONE]\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
  );
  const streamEvents: string[] = [];
  for await (const event of streamProvider.streamText({ messages })) {
    streamEvents.push(event.type);
  }
  check(
    'openai-compatible stream emits text and done',
    streamEvents.includes('text_delta') && streamEvents.at(-1) === 'done',
  );
  let authError: unknown;
  try {
    await makeOpenAI(async () => jsonResponse({}, 401)).generateText({ messages });
  } catch (error) {
    authError = error;
  }
  check('provider errors do not echo the API key', !JSON.stringify(authError).includes('test-key'));

  let searchCalls = 0;
  const service = {
    search: async () => {
      searchCalls += 1;
      return memoryItems;
    },
  };
  const registry = new ToolRegistry();
  registry.register(createMemorySearchTool(service));
  check(
    'tool descriptor exposes JSON schema',
    registry.listForModel()[0]?.parameters.type === 'object',
  );
  const executor = new ToolExecutor(registry, { retryDelayMs: () => 0 });
  const audit = new InMemoryToolAuditSink();
  const result = await executor.execute<MemorySearchResult>(
    'memory.search',
    { query: '具身智能' },
    makeContext(audit),
  );
  check('tool executes and validates result', result.value.items.length === 1);
  check(
    'tool audit records success without content',
    audit.events[0]?.status === 'succeeded' && !JSON.stringify(audit.events).includes('具身智能'),
  );
  check(
    'forged tool parameters are rejected',
    await expectCode(
      () =>
        executor.execute(
          'memory.search',
          { query: '具身智能', extra: 'secret' },
          makeContext(new InMemoryToolAuditSink()),
        ),
      'TOOL_VALIDATION_FAILED',
    ),
  );
  check('forged parameters never execute', searchCalls === 1);
  check(
    'missing permission is denied',
    await expectCode(
      () =>
        executor.execute(
          'memory.search',
          { query: '具身智能' },
          makeContext(new InMemoryToolAuditSink(), makeActor([], ['self_ai'])),
        ),
      'TOOL_PERMISSION_DENIED',
    ),
  );
  check(
    'missing scope is denied',
    await expectCode(
      () =>
        executor.execute(
          'memory.search',
          { query: '具身智能' },
          makeContext(
            new InMemoryToolAuditSink(),
            makeActor([TOOL_PERMISSIONS.memoryReadSelf], []),
          ),
        ),
      'TOOL_SCOPE_DENIED',
    ),
  );

  const timeoutTool: ToolDefinition<{ query: string; limit: number }, MemorySearchResult> = {
    name: 'test.timeout',
    description: 'Timeout test tool.',
    parameters: MemorySearchInputSchema,
    result: MemorySearchResultSchema,
    requiredPermissions: [TOOL_PERMISSIONS.memoryReadSelf],
    requiredUses: ['self_ai'],
    timeoutMs: 100,
    maxRetries: 0,
    idempotent: true,
    audit: { action: 'test.timeout', resourceType: 'test_item' },
    execute: () => new Promise<MemorySearchResult>(() => undefined),
  };
  let retryCalls = 0;
  const retryTool: ToolDefinition<{ query: string; limit: number }, MemorySearchResult> = {
    name: 'test.retry',
    description: 'Retry test tool.',
    parameters: MemorySearchInputSchema,
    result: MemorySearchResultSchema,
    requiredPermissions: [TOOL_PERMISSIONS.memoryReadSelf],
    requiredUses: ['self_ai'],
    timeoutMs: 1000,
    maxRetries: 2,
    idempotent: true,
    audit: { action: 'test.retry', resourceType: 'test_item' },
    execute: async () => {
      retryCalls += 1;
      if (retryCalls < 3) {
        throw new AIError('TOOL_EXECUTION_FAILED', 'temporary', { retryable: true });
      }
      return memoryItems;
    },
  };
  const invalidResultTool: ToolDefinition<{ query: string; limit: number }, MemorySearchResult> = {
    name: 'test.invalid_result',
    description: 'Invalid result test tool.',
    parameters: MemorySearchInputSchema,
    result: MemorySearchResultSchema,
    requiredPermissions: [TOOL_PERMISSIONS.memoryReadSelf],
    requiredUses: ['self_ai'],
    timeoutMs: 1000,
    maxRetries: 0,
    idempotent: true,
    audit: { action: 'test.invalid_result', resourceType: 'test_item' },
    execute: async () => ({ items: 'not-an-array' }) as unknown as MemorySearchResult,
  };
  registry.register(timeoutTool);
  registry.register(retryTool);
  registry.register(invalidResultTool);
  check(
    'tool timeout is enforced',
    await expectCode(
      () =>
        executor.execute('test.timeout', { query: 'x' }, makeContext(new InMemoryToolAuditSink())),
      'TOOL_TIMEOUT',
    ),
  );
  const retryAudit = new InMemoryToolAuditSink();
  const retryResult = await executor.execute<MemorySearchResult>(
    'test.retry',
    { query: 'x' },
    makeContext(retryAudit),
  );
  check(
    'idempotent tool retries to success',
    retryResult.attempts === 3 &&
      retryAudit.events.map((event) => event.status).join(',') === 'failed,failed,succeeded',
  );
  check(
    'invalid tool result is rejected',
    await expectCode(
      () =>
        executor.execute(
          'test.invalid_result',
          { query: 'x' },
          makeContext(new InMemoryToolAuditSink()),
        ),
      'TOOL_RESULT_INVALID',
    ),
  );
  const failingAudit: ToolAuditSink = {
    record: () => {
      throw new Error('audit down');
    },
  };
  check(
    'audit failure is surfaced',
    await expectCode(
      () => executor.execute('memory.search', { query: 'x' }, makeContext(failingAudit)),
      'TOOL_AUDIT_FAILED',
    ),
  );
  const invalidRegistry = new ToolRegistry();
  check(
    'duplicate tool names are rejected',
    syncErrorCode(() => {
      invalidRegistry.register(createMemorySearchTool(service));
      invalidRegistry.register(createMemorySearchTool(service));
    }) === 'TOOL_VALIDATION_FAILED',
  );

  if (failed) {
    console.error(`\n${failed} AI check(s) failed.`);
    process.exitCode = 1;
    return;
  }
  console.log('\nAll AI provider and tool checks passed.');
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'AI verification failed.');
  process.exitCode = 1;
});
