import { describe, expect, it } from 'vitest';
import {
  buildPluginInput,
  initialPluginValues,
  missingRequiredFields,
  type PluginInputSchema,
} from './plugin-input';

const schema: PluginInputSchema = {
  properties: {
    query: { type: 'string' },
    city: { type: 'string' },
    limit: { type: 'integer', default: 5 },
    selfOperatedOnly: { type: 'boolean', default: false },
    sortBy: { type: 'string', enum: ['relevance', 'price'], default: 'relevance' },
    maxPriceYuan: { type: 'number' },
    to: { type: 'array' },
  },
  required: ['query', 'limit'],
};

describe('plugin input helpers', () => {
  it('seeds defaults and empty strings for every declared field', () => {
    expect(initialPluginValues(schema)).toEqual({
      query: '',
      city: '',
      limit: '5',
      selfOperatedOnly: 'false',
      sortBy: 'relevance',
      maxPriceYuan: '',
      to: '',
    });
  });

  it('reports missing required text fields but never treats booleans as missing', () => {
    expect(missingRequiredFields(schema, initialPluginValues(schema))).toEqual(['query']);
    expect(
      missingRequiredFields(schema, { ...initialPluginValues(schema), query: '机器人' }),
    ).toEqual([]);
  });

  it('builds typed input from the schema declaration', () => {
    const input = buildPluginInput(schema, {
      query: '机器人',
      city: '西安',
      limit: '3',
      selfOperatedOnly: 'true',
      sortBy: 'price',
      maxPriceYuan: '99.5',
      to: 'a@example.test, b@example.test',
    });
    expect(input).toEqual({
      query: '机器人',
      city: '西安',
      limit: 3,
      selfOperatedOnly: true,
      sortBy: 'price',
      maxPriceYuan: 99.5,
      to: ['a@example.test', 'b@example.test'],
    });
  });

  it('drops optional empty values and keeps required empty values out of the payload', () => {
    const input = buildPluginInput(schema, {
      ...initialPluginValues(schema),
      query: '机器人',
    });
    expect(input).toEqual({
      query: '机器人',
      limit: 5,
      selfOperatedOnly: false,
      sortBy: 'relevance',
      to: [],
    });
    expect('city' in input).toBe(false);
    expect('maxPriceYuan' in input).toBe(false);
  });

  it('ignores non-numeric number input instead of sending NaN', () => {
    const input = buildPluginInput(
      { properties: { maxPriceYuan: { type: 'number' } }, required: [] },
      { maxPriceYuan: 'abc' },
    );
    expect(input).toEqual({});
  });
});
