export type JsonSchemaProperty = {
  type?: string;
  enum?: string[];
  default?: unknown;
  description?: string;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
};

export type PluginInputSchema = {
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
};

export function initialPluginValues(schema: PluginInputSchema): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, property] of Object.entries(schema.properties ?? {})) {
    if (property.default !== undefined) values[key] = String(property.default);
    else if (property.type === 'boolean') values[key] = 'false';
    else values[key] = '';
  }
  return values;
}

export function missingRequiredFields(
  schema: PluginInputSchema,
  values: Record<string, string>,
): string[] {
  const required = schema.required ?? [];
  return required.filter((key) => {
    const property = schema.properties?.[key];
    if (property?.type === 'boolean') return false;
    return !values[key]?.trim();
  });
}

export function buildPluginInput(
  schema: PluginInputSchema,
  values: Record<string, string>,
): Record<string, unknown> {
  const required = schema.required ?? [];
  const input: Record<string, unknown> = {};
  for (const [key, property] of Object.entries(schema.properties ?? {})) {
    const raw = values[key] ?? '';
    if (property.type === 'boolean') {
      input[key] = raw === 'true';
      continue;
    }
    if (property.type === 'number' || property.type === 'integer') {
      if (!raw.trim()) continue;
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) continue;
      input[key] = parsed;
      continue;
    }
    if (property.type === 'array') {
      input[key] = raw
        .split(/[,，\n]/)
        .map((item) => item.trim())
        .filter(Boolean);
      continue;
    }
    if (!raw.trim() && !required.includes(key)) continue;
    input[key] = raw;
  }
  return input;
}
