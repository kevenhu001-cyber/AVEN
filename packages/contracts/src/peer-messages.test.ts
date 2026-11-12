import { describe, expect, it } from 'vitest';
import {
  SendPeerMessageRequestSchema,
  PeerMessageSchema,
  ListPeerMessagesQuerySchema,
  ListPeerMessagesResponseSchema,
  DeletePeerMessageResponseSchema,
} from './index.js';

describe('Peer Messages Contracts', () => {
  const connectionId = 'f1a23456-789a-4bcd-8f01-23456789abcd';
  const senderUserId = 'a1111111-1111-4111-a111-111111111111';
  const clientMessageId = 'c9a1d3f5-6218-4e89-8d72-88ef5f3d43a1';
  const messageId = 'b3e21820-80a5-42d4-bb3f-21f48641198c';

  describe('SendPeerMessageRequestSchema', () => {
    it('accepts valid input', () => {
      const parsed = SendPeerMessageRequestSchema.parse({
        content: '  Hello there!  ',
        clientMessageId,
      });
      expect(parsed).toEqual({
        content: 'Hello there!',
        clientMessageId,
      });
    });

    it('rejects empty content or whitespace only', () => {
      expect(SendPeerMessageRequestSchema.safeParse({ content: '', clientMessageId }).success).toBe(
        false,
      );
      expect(
        SendPeerMessageRequestSchema.safeParse({ content: '   ', clientMessageId }).success,
      ).toBe(false);
    });

    it('rejects content exceeding 4000 characters', () => {
      const longContent = 'a'.repeat(4001);
      expect(
        SendPeerMessageRequestSchema.safeParse({ content: longContent, clientMessageId }).success,
      ).toBe(false);
    });

    it('rejects invalid clientMessageId', () => {
      expect(
        SendPeerMessageRequestSchema.safeParse({ content: 'valid', clientMessageId: 'not-a-uuid' })
          .success,
      ).toBe(false);
    });
  });

  describe('PeerMessageSchema', () => {
    it('accepts valid peer message', () => {
      const message = {
        id: messageId,
        connectionId,
        senderUserId,
        content: 'Hello',
        clientMessageId,
        createdAt: '2026-11-12T11:40:00.000Z',
      };
      expect(PeerMessageSchema.parse(message)).toEqual(message);
    });
  });

  describe('ListPeerMessagesQuerySchema', () => {
    it('uses defaults when query is empty', () => {
      const parsed = ListPeerMessagesQuerySchema.parse({});
      expect(parsed.limit).toBe(20);
      expect(parsed.cursorCreatedAt).toBeUndefined();
      expect(parsed.cursorId).toBeUndefined();
    });

    it('validates custom limit within 1..50', () => {
      expect(ListPeerMessagesQuerySchema.parse({ limit: '5' }).limit).toBe(5);
      expect(ListPeerMessagesQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
      expect(ListPeerMessagesQuerySchema.safeParse({ limit: '51' }).success).toBe(false);
    });

    it('requires cursorCreatedAt and cursorId to be passed together', () => {
      expect(
        ListPeerMessagesQuerySchema.safeParse({
          cursorCreatedAt: '2026-11-12T11:40:00.000Z',
        }).success,
      ).toBe(false);

      expect(
        ListPeerMessagesQuerySchema.safeParse({
          cursorId: messageId,
        }).success,
      ).toBe(false);

      expect(
        ListPeerMessagesQuerySchema.safeParse({
          cursorCreatedAt: '2026-11-12T11:40:00.000Z',
          cursorId: messageId,
        }).success,
      ).toBe(true);
    });
  });

  describe('ListPeerMessagesResponseSchema', () => {
    it('validates paginated list response with next cursor', () => {
      const response = {
        connectionId,
        messages: [
          {
            id: messageId,
            connectionId,
            senderUserId,
            content: 'Hello',
            clientMessageId,
            createdAt: '2026-11-12T11:40:00.000Z',
          },
        ],
        nextCursor: {
          createdAt: '2026-11-12T11:40:00.000Z',
          id: messageId,
        },
      };
      expect(ListPeerMessagesResponseSchema.parse(response)).toEqual(response);
    });

    it('validates empty messages list with null nextCursor', () => {
      const response = {
        connectionId,
        messages: [],
        nextCursor: null,
      };
      expect(ListPeerMessagesResponseSchema.parse(response)).toEqual(response);
    });
  });

  describe('DeletePeerMessageResponseSchema', () => {
    it('validates delete response', () => {
      const response = {
        success: true,
        messageId,
      };
      expect(DeletePeerMessageResponseSchema.parse(response)).toEqual(response);
    });
  });
});
