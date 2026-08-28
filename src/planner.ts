import type { FilePlan, Selection } from './types.js';

export function planSelection(selection: Selection): FilePlan {
  if (selection.kind === 'file') {
    return { start: selection.file, end: selection.file, stopOn404: false };
  }

  if (selection.kind === 'dataset') {
    if (selection.dataset < 1) {
      throw new Error('dataset must be at least 1');
    }

    const size = selection.size ?? 5;
    if (size !== 2 && size !== 5) {
      throw new Error('dataset size must be 2 or 5');
    }
    const start = (selection.dataset - 1) * size + 1;
    return { start, end: start + size - 1, stopOn404: true };
  }

  return {
    start: selection.startFile,
    end: selection.startFile + (selection.maxFiles ?? 10_000) - 1,
    stopOn404: true
  };
}
