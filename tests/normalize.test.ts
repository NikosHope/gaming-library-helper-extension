import { describe, expect, it } from 'vitest';
import { isMatchableTitle, normalizeTitle } from '../src/core/normalize';

describe('normalizeTitle', () => {
  it('normalizes punctuation, marks, accents, and ampersands', () => {
    expect(normalizeTitle('Sid Meier’s™ Café & Strategy')).toBe('sid meier s cafe and strategy');
  });

  it('keeps edition qualifiers to avoid false ownership matches', () => {
    expect(normalizeTitle('Control Ultimate Edition')).not.toBe(normalizeTitle('Control'));
  });
});

describe('isMatchableTitle', () => {
  it('rejects unresolved provider placeholders', () => {
    expect(isMatchableTitle('Steam app 123')).toBe(false);
    expect(isMatchableTitle('GOG game 456')).toBe(false);
  });
});
