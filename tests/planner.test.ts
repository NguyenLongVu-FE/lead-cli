import { describe, expect, it } from 'vitest';

import { planSelection } from '../src/planner.js';

describe('file selection planner', () => {
  it('maps a dataset to its five-file range', () => {
    expect(planSelection({ kind: 'dataset', dataset: 2 })).toEqual({ start: 6, end: 10, stopOn404: true });
    expect(planSelection({ kind: 'dataset', dataset: 2, size: 5 })).toEqual({ start: 6, end: 10, stopOn404: true });
  });

  it('maps a small-CPU dataset to its two-file range', () => {
    expect(planSelection({ kind: 'dataset', dataset: 2, size: 2 })).toEqual({ start: 3, end: 4, stopOn404: true });
  });

  it('plans one explicit file without treating a 404 as pagination', () => {
    expect(planSelection({ kind: 'file', file: 3 })).toEqual({ start: 3, end: 3, stopOn404: false });
  });

  it('rejects a dataset below the first dataset', () => {
    expect(() => planSelection({ kind: 'dataset', dataset: 0 })).toThrow('dataset must be at least 1');
  });

  it('rejects unsupported dataset sizes from JavaScript callers', () => {
    expect(() => planSelection({ kind: 'dataset', dataset: 1, size: 3 } as never)).toThrow('dataset size must be 2 or 5');
  });
});
