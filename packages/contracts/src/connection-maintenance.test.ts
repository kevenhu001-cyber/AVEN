import { describe, expect, it } from 'vitest';
import { ConnectionMaintenanceBatchSchema, ConnectionMaintenanceResultSchema } from './index.js';

describe('connection maintenance boundaries', () => {
  it('defaults and bounds the environment batch size', () => {
    expect(ConnectionMaintenanceBatchSchema.parse(undefined)).toBe(100);
    expect(ConnectionMaintenanceBatchSchema.parse('1')).toBe(1);
    expect(ConnectionMaintenanceBatchSchema.parse('1000')).toBe(1000);
  });
  it.each(['', '0', '-1', '1001', '1.5', 'invalid', 'Infinity'])(
    'rejects invalid batch %s',
    (value) => {
      expect(ConnectionMaintenanceBatchSchema.safeParse(value).success).toBe(false);
    },
  );
  it('accepts counts only and refuses private values or unbounded results', () => {
    const result = { previewsPurged: 1, itemsInvalidated: 0, snapshotsPurged: 1 };
    expect(ConnectionMaintenanceResultSchema.parse(result)).toEqual(result);
    for (const invalid of [
      { ...result, content: 'private' },
      { ...result, snapshotsPurged: -1 },
      { ...result, previewsPurged: 1001 },
    ]) {
      expect(ConnectionMaintenanceResultSchema.safeParse(invalid).success).toBe(false);
    }
  });
});
