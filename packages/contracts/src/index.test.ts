import { describe, expect, it } from 'vitest';
import {
  ActionConfirmRequestSchema,
  ActionCreateRequestSchema,
  ActionSchema,
  AgentRunEventSchema,
  AgentTurnRequestSchema,
  AgentTurnResponseSchema,
  ApiErrorResponseSchema,
  AuthResponseSchema,
  CampusMembershipSchema,
  ConfirmMemoryRequestSchema,
  CreateMemoryRequestSchema,
  CreateOrganizationRequestSchema,
  ExtractMemoryRequestSchema,
  InviteOrganizationMemberRequestSchema,
  LivenessResponseSchema,
  LoginRequestSchema,
  MemoryItemSchema,
  MemoryEventSchema,
  OrganizationDetailSchema,
  PasswordSchema,
  ReadinessResponseSchema,
  RegisterRequestSchema,
  RejectMemoryRequestSchema,
  TOOL_PERMISSIONS,
  ToolPermissionSchema,
  UpdateMemoryRequestSchema,
  UpdateOpportunityRequestSchema,
  UpdateOrganizationRequestSchema,
  CreateOpportunityDraftRequestSchema,
  OpportunityDetailSchema,
  UpdateProfileRequestSchema,
} from './index';

const requestId = 'b434644d-d195-4978-b457-765c6d9b755e';
describe('public engineering contracts', () => {
  it('distinguishes live from business readiness', () => {
    expect(
      LivenessResponseSchema.parse({
        status: 'ok',
        service: 'api',
        stage: 'foundation',
        request_id: requestId,
      }).stage,
    ).toBe('foundation');
    expect(
      LivenessResponseSchema.safeParse({ status: 'ready', service: 'api', request_id: requestId })
        .success,
    ).toBe(false);
  });
  it('rejects accidental output additions and invalid request IDs', () => {
    expect(
      LivenessResponseSchema.safeParse({
        status: 'ok',
        service: 'api',
        stage: 'foundation',
        request_id: 'unsafe-id',
        token: 'private',
      }).success,
    ).toBe(false);
  });
  it('requires a known error code and retry semantics', () => {
    expect(
      ApiErrorResponseSchema.safeParse({
        error: { code: 'INTERNAL', message: 'Unavailable', request_id: requestId },
      }).success,
    ).toBe(false);
    expect(
      ApiErrorResponseSchema.parse({
        error: {
          code: 'SERVICE_NOT_READY',
          message: 'Not configured',
          request_id: requestId,
          retryable: false,
        },
      }).error.code,
    ).toBe('SERVICE_NOT_READY');
  });
  it('requires explicit readiness checks and rejects unknown ones', () => {
    expect(
      ReadinessResponseSchema.parse({
        status: 'ok',
        service: 'api',
        stage: 'foundation',
        checks: { database: true, redis: true, migrations: true },
        request_id: requestId,
      }).checks.database,
    ).toBe(true);
    expect(
      ReadinessResponseSchema.safeParse({
        status: 'ok',
        service: 'api',
        stage: 'foundation',
        checks: { database: true, redis: true, migrations: true, secret: true },
        request_id: requestId,
      }).success,
    ).toBe(false);
  });
  it('normalizes email and rejects short passwords', () => {
    const parsed = RegisterRequestSchema.parse({
      email: '  User@Example.Test ',
      password: 'Correct Horse Battery 42!',
      displayName: '张雨',
    });
    expect(parsed.email).toBe('user@example.test');
    expect(PasswordSchema.safeParse('too-short').success).toBe(false);
    expect(
      LoginRequestSchema.parse({
        email: 'user@example.test',
        password: 'x',
      }).client,
    ).toBe('web');
  });
  it('accepts either a CSRF token or a mobile session token, not unknown fields', () => {
    const base = {
      user: {
        id: requestId,
        displayName: '张雨',
        email: 'user@example.test',
        emailVerified: true,
        locale: 'zh-CN',
        timezone: 'Asia/Shanghai',
      },
      session: {
        id: requestId,
        client: 'web',
        userAgent: null,
        createdAt: '2026-11-11T00:00:00.000Z',
        lastSeenAt: '2026-11-11T00:00:00.000Z',
        expiresAt: '2026-12-11T00:00:00.000Z',
        revokedAt: null,
        current: true,
      },
    };
    expect(AuthResponseSchema.safeParse({ ...base, csrfToken: 'token' }).success).toBe(true);
    expect(AuthResponseSchema.safeParse({ ...base, sessionToken: 'token' }).success).toBe(true);
    expect(AuthResponseSchema.safeParse({ ...base, secret: 'token' }).success).toBe(false);
  });
  it('requires at least one valid profile field', () => {
    expect(UpdateProfileRequestSchema.parse({ displayName: '张雨' }).displayName).toBe('张雨');
    expect(UpdateProfileRequestSchema.safeParse({}).success).toBe(false);
    expect(UpdateProfileRequestSchema.safeParse({ timezone: 'Not/A_Timezone' }).success).toBe(
      false,
    );
    expect(
      UpdateProfileRequestSchema.safeParse({ locale: 'zh-CN', timezone: 'Asia/Shanghai' }).success,
    ).toBe(true);
  });
  it('requires explicit campus membership states', () => {
    expect(
      CampusMembershipSchema.safeParse({
        id: requestId,
        campusId: requestId,
        campusName: '西安交通大学（开发样例）',
        status: 'pending',
        verificationMethod: null,
        verifiedAt: null,
        createdAt: '2026-11-11T00:00:00.000Z',
      }).success,
    ).toBe(true);
    expect(
      CampusMembershipSchema.safeParse({
        id: requestId,
        campusId: requestId,
        campusName: '西安交通大学（开发样例）',
        status: 'self_verified',
        verificationMethod: null,
        verifiedAt: null,
        createdAt: '2026-11-11T00:00:00.000Z',
      }).success,
    ).toBe(false);
  });
  it('validates organization creation and invitation roles', () => {
    expect(
      CreateOrganizationRequestSchema.parse({
        name: '验证实验室',
        slug: 'verify-lab',
        type: 'lab',
      }).slug,
    ).toBe('verify-lab');
    expect(
      CreateOrganizationRequestSchema.safeParse({
        name: '验证实验室',
        slug: 'Verify Lab',
        type: 'lab',
      }).success,
    ).toBe(false);
    expect(
      InviteOrganizationMemberRequestSchema.safeParse({
        email: 'user@example.test',
        role: 'owner',
      }).success,
    ).toBe(false);
    expect(
      OrganizationDetailSchema.safeParse({
        id: requestId,
        name: '验证实验室',
        slug: 'verify-lab',
        description: null,
        type: 'lab',
        campusId: null,
        verificationStatus: 'unverified',
        role: 'owner',
        canRepresent: true,
        memberCount: 1,
      }).success,
    ).toBe(true);
  });
  it('validates memory audience, discoverability, and unique uses', () => {
    expect(
      CreateMemoryRequestSchema.parse({
        kind: 'skill',
        title: '机器人控制',
        content: '四足机器人步态控制',
        allowedUses: ['self_ai', 'matching'],
      }).allowedUses,
    ).toEqual(['self_ai', 'matching']);
    expect(
      CreateMemoryRequestSchema.safeParse({
        kind: 'skill',
        title: '机器人控制',
        content: '四足机器人步态控制',
        displayAudience: 'campus',
      }).success,
    ).toBe(false);
    expect(
      CreateMemoryRequestSchema.safeParse({
        kind: 'skill',
        title: '机器人控制',
        content: '四足机器人步态控制',
        discoverable: true,
      }).success,
    ).toBe(false);
    expect(
      CreateMemoryRequestSchema.safeParse({
        kind: 'skill',
        title: '机器人控制',
        content: '四足机器人步态控制',
        allowedUses: ['self_ai', 'self_ai'],
      }).success,
    ).toBe(false);
    expect(UpdateMemoryRequestSchema.safeParse({ expectedVersion: 1 }).success).toBe(false);
  });
  it('requires explicit memory policy fields', () => {
    expect(
      MemoryItemSchema.safeParse({
        id: requestId,
        kind: 'skill',
        title: '机器人控制',
        content: '四足机器人步态控制',
        structuredValue: null,
        sensitivity: 'normal',
        status: 'confirmed',
        version: 1,
        validFrom: '2026-11-11T00:00:00.000Z',
        validUntil: null,
        confirmedAt: '2026-11-11T00:00:00.000Z',
        createdAt: '2026-11-11T00:00:00.000Z',
        updatedAt: '2026-11-11T00:00:00.000Z',
        policy: {
          displayAudience: 'owner',
          discoverable: false,
          allowedUses: ['self_ai'],
          campusId: null,
          version: 1,
        },
        sourceCount: 1,
      }).success,
    ).toBe(true);
  });
  it('validates memory extraction and review requests', () => {
    expect(ExtractMemoryRequestSchema.parse({ text: '兴趣：具身智能' })).toMatchObject({
      sourceType: 'agent_extraction',
    });
    expect(
      ExtractMemoryRequestSchema.safeParse({ text: '兴趣：具身智能', sourceType: 'user_input' })
        .success,
    ).toBe(false);
    expect(ExtractMemoryRequestSchema.safeParse({ text: '' }).success).toBe(false);
    expect(ConfirmMemoryRequestSchema.parse({ expectedVersion: 1 }).expectedVersion).toBe(1);
    expect(
      ConfirmMemoryRequestSchema.safeParse({
        expectedVersion: 1,
        allowedUses: ['self_ai', 'self_ai'],
      }).success,
    ).toBe(false);
    expect(RejectMemoryRequestSchema.safeParse({ expectedVersion: 0 }).success).toBe(false);
  });
  it('validates metadata-only memory lifecycle events', () => {
    expect(
      MemoryEventSchema.parse({
        id: requestId,
        eventType: 'expired',
        actorType: 'system',
        fromStatus: 'confirmed',
        toStatus: 'expired',
        version: 2,
        metadata: { reason: 'valid_until_elapsed' },
        createdAt: '2026-11-11T00:00:00.000Z',
      }).eventType,
    ).toBe('expired');
    expect(
      MemoryEventSchema.safeParse({
        id: requestId,
        eventType: 'unknown',
        actorType: 'system',
        fromStatus: null,
        toStatus: null,
        version: 1,
        metadata: {},
        createdAt: '2026-11-11T00:00:00.000Z',
      }).success,
    ).toBe(false);
  });
  it('exposes stable AI tool permissions', () => {
    expect(TOOL_PERMISSIONS.memoryReadSelf).toBe('memory:read:self');
    expect(TOOL_PERMISSIONS.memoryWriteSelf).toBe('memory:write:self');
    expect(ToolPermissionSchema.safeParse('memory:read:self').success).toBe(true);
    expect(ToolPermissionSchema.safeParse('memory:delete:any').success).toBe(false);
  });
  it('validates agent turns and persisted events', () => {
    expect(AgentTurnRequestSchema.parse({ input: '你好' }).input).toBe('你好');
    expect(AgentTurnRequestSchema.safeParse({ input: '' }).success).toBe(false);
    expect(AgentTurnRequestSchema.safeParse({ input: '你好', extra: true }).success).toBe(false);
    expect(
      AgentTurnResponseSchema.parse({
        runId: requestId,
        conversationId: requestId,
        status: 'queued',
        streamUrl: '/api/v1/agent/runs/x/events',
      }).status,
    ).toBe('queued');
    expect(
      AgentRunEventSchema.parse({
        schemaVersion: 1,
        runId: requestId,
        sequence: 1,
        eventType: 'turn.started',
        payload: {},
        createdAt: '2026-11-11T00:00:00.000Z',
      }).eventType,
    ).toBe('turn.started');
    expect(
      AgentRunEventSchema.safeParse({
        schemaVersion: 2,
        runId: requestId,
        sequence: 1,
        eventType: 'turn.started',
        payload: {},
        createdAt: '2026-11-11T00:00:00.000Z',
      }).success,
    ).toBe(false);
  });
  it('validates action drafts and one-time confirmation requests', () => {
    const parsed = ActionCreateRequestSchema.parse({
      actionType: 'memory.create',
      payload: { kind: 'skill', title: '行动技能', content: '行动正文' },
    });
    expect(parsed.expiresInSeconds).toBe(600);
    expect(parsed.payload.allowedUses).toEqual([]);
    expect(
      ActionCreateRequestSchema.safeParse({
        actionType: 'memory.create',
        payload: { kind: 'skill', title: '', content: 'x' },
      }).success,
    ).toBe(false);
    expect(
      ActionCreateRequestSchema.safeParse({
        actionType: 'memory.create',
        payload: { kind: 'skill', title: 'x', content: 'x' },
        expiresInSeconds: 0,
      }).success,
    ).toBe(false);
    expect(ActionConfirmRequestSchema.safeParse({ expectedDraftVersion: 1 }).success).toBe(false);
    expect(
      ActionSchema.parse({
        id: requestId,
        actionType: 'memory.create',
        status: 'pending_confirmation',
        draftVersion: 1,
        runId: null,
        organizationId: null,
        preview: { title: '行动技能' },
        expiresAt: '2026-11-11T00:00:00.000Z',
        confirmedAt: null,
        executedAt: null,
        result: null,
        createdAt: '2026-11-11T00:00:00.000Z',
        updatedAt: '2026-11-11T00:00:00.000Z',
      }).status,
    ).toBe('pending_confirmation');
  });

  it('validates organization update and opportunity contracts', () => {
    const orgUpdate = UpdateOrganizationRequestSchema.parse({
      name: '交大智能机器人实验室',
      description: '实验室最新更新',
      websiteUrl: 'https://robotics.xjtu.edu.cn',
    });
    expect(orgUpdate.name).toBe('交大智能机器人实验室');

    expect(
      UpdateOrganizationRequestSchema.safeParse({
        name: ' ',
      }).success,
    ).toBe(false);

    const draft = CreateOpportunityDraftRequestSchema.parse({
      title: '具身智能系统研究助理',
      summary: '参与灵巧手遥操作与强化学习算法研究',
      description: '详细要求见实验室 wiki，需具备良好的 Python / C++ 基础与 ROS 经验。',
      domains: ['机器人', '强化学习'],
      requirements: ['Python', 'ROS2', 'PyTorch'],
      stage: 'undergraduate',
      commitmentHoursPerWeek: 15,
      headcount: 2,
      visibility: 'campus',
    });
    expect(draft.stage).toBe('undergraduate');
    expect(draft.headcount).toBe(2);
    expect(draft.commitmentHoursPerWeek).toBe(15);
    expect(draft.remoteOk).toBe(false);

    // Invalid headcount (> 100) or hours (> 40)
    expect(
      CreateOpportunityDraftRequestSchema.safeParse({
        title: '测试',
        summary: '摘要',
        description: '描述',
        headcount: 150,
      }).success,
    ).toBe(false);

    expect(
      CreateOpportunityDraftRequestSchema.safeParse({
        title: '测试',
        summary: '摘要',
        description: '描述',
        commitmentHoursPerWeek: 50,
      }).success,
    ).toBe(false);

    const detail = OpportunityDetailSchema.parse({
      id: requestId,
      organizationId: requestId,
      organizationName: '智能机器人实验室',
      organizationSlug: 'robotics-lab',
      campusId: requestId,
      title: '具身智能助理',
      summary: '强化学习研究',
      description: '负责控制策略训练',
      domains: ['机器人'],
      requirements: ['Python'],
      stage: 'undergraduate',
      commitmentHoursPerWeek: 10,
      location: '创新港 3 号巨构',
      remoteOk: false,
      headcount: 1,
      deadline: null,
      status: 'open',
      visibility: 'campus',
      version: 2,
      createdBy: requestId,
      contactUserId: requestId,
      publishedAt: '2026-11-11T00:00:00.000Z',
      closedAt: null,
      createdAt: '2026-11-11T00:00:00.000Z',
      updatedAt: '2026-11-11T00:00:00.000Z',
      isMember: true,
    });
    expect(detail.status).toBe('open');
    expect(detail.version).toBe(2);

    const updated = UpdateOpportunityRequestSchema.parse({
      expectedVersion: 1,
      title: '更新标题',
      commitmentHoursPerWeek: 15,
    });
    expect(updated.expectedVersion).toBe(1);
    expect(updated.title).toBe('更新标题');
  });
});
