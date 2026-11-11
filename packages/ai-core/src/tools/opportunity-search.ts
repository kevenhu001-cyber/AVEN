import { z } from 'zod';
import {
  OpportunityStageSchema,
  OpportunityStatusSchema,
  OpportunityVisibilitySchema,
  TOOL_PERMISSIONS,
} from '@aven/contracts';
import type { ToolActor, ToolDefinition } from '../tools.js';

export const OpportunitySearchInputSchema = z
  .object({
    query: z.string().trim().max(500).default(''),
    status: OpportunityStatusSchema.optional(),
    limit: z.number().int().min(1).max(20).default(10),
  })
  .strict();

export const OpportunitySearchResultItemSchema = z
  .object({
    id: z.uuid(),
    title: z.string().max(200),
    summary: z.string().max(2000),
    stage: OpportunityStageSchema,
    status: OpportunityStatusSchema,
    visibility: OpportunityVisibilitySchema,
    headcount: z.number().int(),
    deadline: z.string().nullable().optional(),
  })
  .strict();

export const OpportunitySearchResultSchema = z
  .object({
    items: z.array(OpportunitySearchResultItemSchema).max(20),
  })
  .strict();

export type OpportunitySearchInput = z.infer<typeof OpportunitySearchInputSchema>;
export type OpportunitySearchResultItem = z.infer<typeof OpportunitySearchResultItemSchema>;
export type OpportunitySearchResult = z.infer<typeof OpportunitySearchResultSchema>;

export type OpportunitySearchContext = {
  actor: ToolActor;
  requestId: string;
  signal?: AbortSignal;
};

export interface OpportunitySearchService {
  search(
    input: OpportunitySearchInput,
    context: OpportunitySearchContext,
  ): Promise<OpportunitySearchResult>;
}

export function createOpportunitySearchTool(
  service: OpportunitySearchService,
): ToolDefinition<OpportunitySearchInput, OpportunitySearchResult> {
  return {
    name: 'opportunity.search',
    description: 'Search opportunities belonging to the current organization.',
    parameters: OpportunitySearchInputSchema,
    result: OpportunitySearchResultSchema,
    requiredPermissions: [TOOL_PERMISSIONS.opportunityReadOrg],
    timeoutMs: 3000,
    maxRetries: 1,
    idempotent: true,
    audit: { action: 'opportunity.search', resourceType: 'opportunity' },
    execute: async (input, context) =>
      service.search(input, {
        actor: context.actor,
        requestId: context.requestId,
        ...(context.signal ? { signal: context.signal } : {}),
      }),
  };
}
