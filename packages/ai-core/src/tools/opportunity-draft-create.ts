import { z } from 'zod';
import {
  CreateOpportunityDraftRequestSchema,
  TOOL_PERMISSIONS,
} from '@aven/contracts';
import type { ToolActor, ToolDefinition } from '../tools.js';

export const OpportunityDraftCreateInputSchema = CreateOpportunityDraftRequestSchema;

export const OpportunityDraftCreateResultSchema = z
  .object({
    actionId: z.uuid(),
    status: z.literal('pending_confirmation'),
    actionType: z.literal('opportunity.create'),
    preview: z.record(z.string(), z.unknown()),
  })
  .strict();

export type OpportunityDraftCreateInput = z.infer<typeof OpportunityDraftCreateInputSchema>;
export type OpportunityDraftCreateResult = z.infer<typeof OpportunityDraftCreateResultSchema>;

export type OpportunityDraftCreateContext = {
  actor: ToolActor;
  requestId: string;
  signal?: AbortSignal;
};

export interface OpportunityDraftCreateService {
  createDraft(
    input: OpportunityDraftCreateInput,
    context: OpportunityDraftCreateContext,
  ): Promise<OpportunityDraftCreateResult>;
}

export function createOpportunityDraftCreateTool(
  service: OpportunityDraftCreateService,
): ToolDefinition<OpportunityDraftCreateInput, OpportunityDraftCreateResult> {
  return {
    name: 'opportunity_draft.create',
    description:
      'Propose an opportunity draft action for the organization. High-impact action requiring confirmation.',
    parameters: OpportunityDraftCreateInputSchema,
    result: OpportunityDraftCreateResultSchema,
    requiredPermissions: [TOOL_PERMISSIONS.opportunityWriteOrg],
    timeoutMs: 5000,
    maxRetries: 0,
    idempotent: false,
    audit: { action: 'opportunity_draft.create', resourceType: 'action' },
    execute: async (input, context) =>
      service.createDraft(input, {
        actor: context.actor,
        requestId: context.requestId,
        ...(context.signal ? { signal: context.signal } : {}),
      }),
  };
}
