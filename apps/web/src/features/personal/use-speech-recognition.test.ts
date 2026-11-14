import { describe, expect, it } from 'vitest';
import { appendDictation } from './use-speech-recognition';

describe('dictation draft append', () => {
  it('joins CJK additions directly onto the draft', () => {
    expect(appendDictation('昨晚', 'CI 挂了')).toBe('昨晚CI 挂了');
    expect(appendDictation('', '开始新草稿')).toBe('开始新草稿');
  });

  it('inserts a space between Latin or digit runs', () => {
    expect(appendDictation('open the', 'file now')).toBe('open the file now');
    expect(appendDictation('版本 1', '2 发布')).toBe('版本 1 2 发布');
  });

  it('trims the addition and ignores empty dictation', () => {
    expect(appendDictation('草稿', '  内容  ')).toBe('草稿内容');
    expect(appendDictation('草稿', '   ')).toBe('草稿');
  });
});
