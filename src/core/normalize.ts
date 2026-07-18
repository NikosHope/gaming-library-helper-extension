const TRADEMARK_MARKS = /[™®©]/gu;
const COMBINING_MARKS = /\p{Mark}+/gu;
const NON_ALPHANUMERIC = /[^\p{Letter}\p{Number}]+/gu;

export function normalizeTitle(title: string): string {
  return title
    .replace(TRADEMARK_MARKS, '')
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .toLocaleLowerCase('en-US')
    .replace(/&/gu, ' and ')
    .replace(NON_ALPHANUMERIC, ' ')
    .trim()
    .replace(/\s+/gu, ' ');
}

export function isMatchableTitle(title: string): boolean {
  const normalized = normalizeTitle(title);
  return normalized.length >= 2 && !/^(steam|gog) (app|game) \d+$/u.test(normalized);
}
