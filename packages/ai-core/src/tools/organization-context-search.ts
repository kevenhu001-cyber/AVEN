import { z } from 'zod';
import { TOOL_PERMISSIONS } from '@aven/contracts';
import type { ToolActor, ToolDefinition } from '../tools.js';

export const OrganizationContextSearchInputSchema = z
  .object({
    query: z.string().trim().max(500).default(''),
  })
  .strict();

export const OrganizationContextSearchResultSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    description: z.string().nullable(),
    websiteUrl: z.string().nullable(),
    campusName: z.string().nullable(),
    memberCount: z.number().int(),
    domains: z.array(z.string()).default([]),
  })
  .strict();

export type OrganizationContextSearchInput = z.infer<typeof OrganizationContextSearchInputSchema>;
export type OrganizationContextSearchResult = z.infer<typeof OrganizationContextSearchResultSchema>;

export type OrganizationContextSearchContext = {
  actor: ToolActor;
  requestId: string;
  signal?: AbortSignal;
};

export interface OrganizationContextSearchService {
  search(
    input: OrganizationContextSearchInput,
    context: OrganizationContextSearchContext,
  ): Promise<OrganizationContextSearchResult>;
}

export function createOrganizationContextSearchTool(
  service: OrganizationContextSearchService,
): ToolDefinition<OrganizationContextSearchInput, OrganizationContextSearchResult> {
  return {
    name: 'organization_context.search',
    description: 'Retrieve profile and organizational context for the current organization.',
    parameters: OrganizationContextSearchInputSchema,
    result: OrganizationContextSearchResultSchema,
    requiredPermissions: [TOOL_PERMISSIONS.organizationReadContext],
    timeoutMs: 3000,
    maxRetries: 1,
    idempotent: true,
    audit: { action: 'organization_context.search', resourceType: 'organization' },
    execute: async (input, context) =>
      service.search(input, {
        actor: context.actor,
        requestId: context.requestId,
        ...(context.signal ? { signal: context.signal } : {}),
      }),
  };
}
