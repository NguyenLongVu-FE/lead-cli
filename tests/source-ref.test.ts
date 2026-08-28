import { describe, expect, it } from 'vitest';

import { createSourceRef, parseSourceRef } from '../src/source-ref.js';

describe('lead source references', () => {
  it('round-trips an encoded catalog slug without contact values', () => {
    const reference = createSourceRef("Côte_d'Ivoire", 2, 42);

    expect(reference).toBe('C%C3%B4te_d%27Ivoire:2:42');
    expect(parseSourceRef(reference)).toEqual({ slug: "Côte_d'Ivoire", file: 2, row: 42 });
  });

  it('parses from the final numeric segments when a future slug contains a colon', () => {
    expect(parseSourceRef('Future%3ASlug:3:9')).toEqual({ slug: 'Future:Slug', file: 3, row: 9 });
  });

  it('rejects non-positive or malformed locations', () => {
    expect(() => createSourceRef('Eritrea', 0, 1)).toThrow('source file must be at least 1');
    expect(() => parseSourceRef('Eritrea:1:0')).toThrow('source row must be at least 1');
    expect(() => parseSourceRef('not-a-reference')).toThrow('invalid source reference');
    expect(() => createSourceRef('Eritrea', Number.MAX_SAFE_INTEGER + 1, 1)).toThrow('source file must be a safe integer');
    expect(() => parseSourceRef(`Eritrea:1:${Number.MAX_SAFE_INTEGER + 1}`)).toThrow('source row must be a safe integer');
  });
});
