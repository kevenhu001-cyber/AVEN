import { z } from 'zod';
import { TOOL_PERMISSIONS } from '@aven/contracts';
import type { ToolActor, ToolDefinition } from '../tools.js';

export const MemorySearchInputSchema = z
  .object({
    query: z.string().trim().min(1).max(500),
    limit: z.number().int().min(1).max(20).default(5),
  })
  .strict();

export const MemorySearchResultSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            id: z.uuid(),
            title: z.string().max(160),
            content: z.string().max(20000),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();

export type MemorySearchInput = z.infer<typeof MemorySearchInputSchema>;
export type MemorySearchResult = z.infer<typeof MemorySearchResultSchema>;

export type MemorySearchContext = {
  actor: ToolActor;
  requestId: string;
  signal?: AbortSignal;
};

export interface MemorySearchService {
  search(input: MemorySearchInput, context: MemorySearchContext): Promise<MemorySearchResult>;
}

export function createMemorySearchTool(
  service: MemorySearchService,
): ToolDefinition<MemorySearchInput, MemorySearchResult> {
  return {
    name: 'memory.search',
    description:
      'Search the current user confirmed memories that are explicitly allowed for self AI use.',
    parameters: MemorySearchInputSchema,
    result: MemorySearchResultSchema,
    requiredPermissions: [TOOL_PERMISSIONS.memoryReadSelf],
    requiredUses: ['self_ai'],
    timeoutMs: 3000,
    maxRetries: 1,
    idempotent: true,
    audit: { action: 'memory.search', resourceType: 'memory_item' },
    execute: async (input, context) =>
      service.search(input, {
        actor: context.actor,
        requestId: context.requestId,
        ...(context.signal ? { signal: context.signal } : {}),
      }),
  };
}
