import { describe, expect, it } from 'vitest';
import { extractMemoryCandidates } from './memory-extractor.js';

describe('mock memory extractor', () => {
  it('only turns labelled lines into candidates', () => {
    const drafts = extractMemoryCandidates(
      [
        '兴趣：具身智能',
        '技能: ROS 2 与四足机器人控制',
        '项目：校园服务机器人',
        '这是一句没有标签的话，不应生成候选。',
      ].join('\n'),
    );
    expect(drafts).toHaveLength(3);
    expect(drafts[0]).toMatchObject({ kind: 'interest', content: '具身智能' });
    expect(drafts[1]).toMatchObject({ kind: 'skill', content: 'ROS 2 与四足机器人控制' });
    expect(drafts[2]).toMatchObject({ kind: 'project', content: '校园服务机器人' });
    expect(drafts[0]?.excerpt).toBe('兴趣：具身智能');
  });

  it('does not invent candidates from unlabelled text', () => {
    expect(extractMemoryCandidates('今天天气不错，也没有结构化记忆。')).toEqual([]);
    expect(extractMemoryCandidates('兴趣：')).toEqual([]);
  });

  it('deduplicates identical labelled content', () => {
    const drafts = extractMemoryCandidates('技能：ROS 2\n技能：ROS 2\n技能：ROS 2');
    expect(drafts).toHaveLength(1);
  });

  it('supports bullets, semicolons, and bounded candidate counts', () => {
    const drafts = extractMemoryCandidates(
      '- 偏好：远程协作；- 目标：完成毕业设计；- 教育：西安交通大学',
    );
    expect(drafts.map((draft) => draft.kind)).toEqual(['preference', 'goal', 'education']);
    const many = Array.from({ length: 30 }, (_, index) => `兴趣：主题 ${index}`).join('\n');
    expect(extractMemoryCandidates(many)).toHaveLength(20);
  });

  it('tolerates whitespace before the label separator', () => {
    const [draft] = extractMemoryCandidates('技能 ： ROS 2');
    expect(draft).toMatchObject({ kind: 'skill', content: 'ROS 2' });
  });

  it('truncates long titles while keeping full content', () => {
    const content = 'x'.repeat(200);
    const [draft] = extractMemoryCandidates(`技能：${content}`);
    expect(draft?.title).toHaveLength(160);
    expect(draft?.title.endsWith('...')).toBe(true);
    expect(draft?.content).toBe(content);
  });
});
