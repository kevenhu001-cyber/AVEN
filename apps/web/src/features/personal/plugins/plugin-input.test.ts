import { describe, expect, it } from 'vitest';
import {
  buildPluginInput,
  initialPluginValues,
  invalidPluginFields,
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

describe('plugin parameter validation', () => {
  const bounded: PluginInputSchema = {
    properties: {
      limit: { type: 'integer', minimum: 1, maximum: 10 },
      price: { type: 'number', minimum: 0 },
      sort: { type: 'string', enum: ['price'] },
      query: { type: 'string', minLength: 2, maxLength: 4 },
      to: { type: 'array', minItems: 1, maxItems: 2 },
    },
    required: ['to'],
  };
  it('rejects fractional integers, nonfinite numbers, unknown enums and invalid lengths', () => {
    expect(
      invalidPluginFields(bounded, {
        limit: '1.5',
        price: 'Infinity',
        sort: 'unknown',
        query: 'a',
        to: ',，',
      }),
    ).toEqual(['limit', 'price', 'sort', 'query', 'to']);
  });
  it('checks both numeric bounds and array limits', () => {
    expect(invalidPluginFields(bounded, { limit: '11', price: '-1', to: 'a,b,c' })).toEqual([
      'limit',
      'price',
      'to',
    ]);
    expect(invalidPluginFields(bounded, { limit: '0', query: '12345' })).toEqual([
      'limit',
      'query',
    ]);
  });
  it('accepts boundary values, decimal numbers and multilingual separators', () => {
    expect(
      invalidPluginFields(bounded, {
        limit: '10',
        price: '0.5',
        sort: 'price',
        query: '你好',
        to: 'a，b',
      }),
    ).toEqual([]);
    expect(invalidPluginFields(bounded, {})).toEqual([]);
  });
});
