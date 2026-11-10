import { describe, expect, it } from 'vitest';
import { SampleTaskEventSchema, SampleTaskPayloadSchema } from './sample-task.js';

const taskId = 'b434644d-d195-4978-b457-765c6d9b755e';
describe('sample task contract', () => {
  it('accepts a known simulation mode', () => {
    expect(
      SampleTaskPayloadSchema.parse({ taskId, title: 'probe', simulate: 'unknown' }).simulate,
    ).toBe('unknown');
  });
  it('rejects unknown fields and simulation modes', () => {
    expect(
      SampleTaskPayloadSchema.safeParse({ taskId, title: 'probe', simulate: 'other' }).success,
    ).toBe(false);
    expect(
      SampleTaskPayloadSchema.safeParse({ taskId, title: 'probe', secret: true }).success,
    ).toBe(false);
  });
  it('requires the known event type', () => {
    expect(
      SampleTaskEventSchema.safeParse({
        id: taskId,
        eventType: 'sample_task.created',
        payload: { taskId, title: 'probe' },
      }).success,
    ).toBe(true);
    expect(
      SampleTaskEventSchema.safeParse({
        id: taskId,
        eventType: 'other',
        payload: { taskId, title: 'probe' },
      }).success,
    ).toBe(false);
  });
});
