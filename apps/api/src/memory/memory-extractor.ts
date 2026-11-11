import type { MemoryKind } from '@aven/contracts';

/**
 * Deterministic, explicitly-labelled mock extractor for M3-02.
 *
 * It only turns labelled lines into pending candidates. It never confirms a
 * memory and never invents content. A real Provider is introduced in M3-04.
 */
export const MEMORY_EXTRACTOR_VERSION = 'mock_rules_v1';

export type MemoryCandidateDraft = {
  kind: MemoryKind;
  title: string;
  content: string;
  excerpt: string;
};

const MAX_CANDIDATES = 20;
const MAX_TITLE = 160;
const MAX_CONTENT = 20000;
const MAX_EXCERPT = 500;

const PREFIXES: ReadonlyArray<{ pattern: RegExp; kind: MemoryKind }> = [
  { pattern: /^(?:[-*•]\s*)?(?:兴趣|爱好)\s*[：:]\s*/, kind: 'interest' },
  { pattern: /^(?:[-*•]\s*)?(?:技能|专长)\s*[：:]\s*/, kind: 'skill' },
  { pattern: /^(?:[-*•]\s*)?(?:项目|项目经历)\s*[：:]\s*/, kind: 'project' },
  { pattern: /^(?:[-*•]\s*)?(?:目标|计划)\s*[：:]\s*/, kind: 'goal' },
  { pattern: /^(?:[-*•]\s*)?(?:偏好|喜好)\s*[：:]\s*/, kind: 'preference' },
  { pattern: /^(?:[-*•]\s*)?(?:经历|工作经历)\s*[：:]\s*/, kind: 'experience' },
  { pattern: /^(?:[-*•]\s*)?(?:教育|教育经历)\s*[：:]\s*/, kind: 'education' },
  { pattern: /^(?:[-*•]\s*)?(?:其他)\s*[：:]\s*/, kind: 'other' },
];

function titleFor(content: string): string {
  if (content.length <= MAX_TITLE) return content;
  return `${content.slice(0, MAX_TITLE - 3)}...`;
}

export function extractMemoryCandidates(text: string): MemoryCandidateDraft[] {
  const segments = text
    .split(/[\r\n；;]+/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const drafts: MemoryCandidateDraft[] = [];

  for (const segment of segments) {
    for (const { pattern, kind } of PREFIXES) {
      const match = pattern.exec(segment);
      if (!match) continue;
      const value = segment.slice(match[0].length).trim();
      if (!value) break;
      const content = value.slice(0, MAX_CONTENT);
      const key = `${kind}\u0000${content}`;
      if (seen.has(key)) break;
      seen.add(key);
      drafts.push({
        kind,
        title: titleFor(content),
        content,
        excerpt: segment.slice(0, MAX_EXCERPT),
      });
      break;
    }
    if (drafts.length >= MAX_CANDIDATES) break;
  }

  return drafts;
}
