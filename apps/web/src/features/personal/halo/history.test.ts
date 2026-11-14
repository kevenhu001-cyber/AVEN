import { describe, expect, it } from 'vitest';
import { pairConversationTurns, type HistoryMessage } from './history';

const message = (
  id: string,
  body: string,
  derivedFromRunId: string | null = null,
  at = '2026-11-14T08:00:00.000Z',
): HistoryMessage => ({ id, body, derivedFromRunId, createdAt: at });

describe('conversation history pairing', () => {
  it('pairs each user message with its derived reply', () => {
    const turns = pairConversationTurns([
      message('u1', '昨晚 CI 挂了什么？'),
      message('a1', '只挂了 1 个。', '11111111-1111-4111-8111-111111111111'),
      message('u2', '帮我修一下'),
      message('a2', '已修好。', '22222222-2222-4222-8222-222222222222'),
    ]);
    expect(turns.map((turn) => [turn.input, turn.answer, turn.runId])).toEqual([
      ['昨晚 CI 挂了什么？', '只挂了 1 个。', '11111111-1111-4111-8111-111111111111'],
      ['帮我修一下', '已修好。', '22222222-2222-4222-8222-222222222222'],
    ]);
    expect(turns.every((turn) => turn.complete)).toBe(true);
    expect(turns[0]!.createdAt).toBe(Date.parse('2026-11-14T08:00:00.000Z'));
  });

  it('marks a user turn without a reply as incomplete', () => {
    const turns = pairConversationTurns([
      message('u1', '还在生成'),
      message('a1', '后续回复', '22222222-2222-4222-8222-222222222222'),
      message('u2', '后面一条'),
    ]);
    expect(turns.map((turn) => [turn.complete, turn.input])).toEqual([
      [true, '还在生成'],
      [false, '后面一条'],
    ]);
  });

  it('keeps a stray derived reply readable instead of dropping it', () => {
    const turns = pairConversationTurns([
      message('a0', '孤儿回复', '33333333-3333-4333-8333-333333333333'),
    ]);
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ input: '', answer: '孤儿回复', complete: true });
  });

  it('returns nothing for an empty feed', () => {
    expect(pairConversationTurns([])).toEqual([]);
  });
});
