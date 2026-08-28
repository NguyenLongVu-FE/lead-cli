import type { SourceLocation } from './types.js';

export function createSourceRef(slug: string, file: number, row: number): string {
  assertPositiveInteger(file, 'source file');
  assertPositiveInteger(row, 'source row');
  return `${encodeURIComponent(slug).replace(/'/g, '%27')}:${file}:${row}`;
}

export function parseSourceRef(value: string): SourceLocation {
  const match = /^(.*):(\d+):(\d+)$/.exec(value);
  if (match === null) {
    throw new Error('invalid source reference');
  }

  let slug: string;
  try {
    slug = decodeURIComponent(match[1]);
  } catch {
    throw new Error('invalid source reference');
  }

  const file = Number(match[2]);
  const row = Number(match[3]);
  assertPositiveInteger(file, 'source file');
  assertPositiveInteger(row, 'source row');
  return { slug, file, row };
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} must be a safe integer`);
  }
  if (value < 1) {
    throw new Error(`${label} must be at least 1`);
  }
}
