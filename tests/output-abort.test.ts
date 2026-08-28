import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs', async () => {
  const { Writable } = await import('node:stream');

  class DelayedCloseWriteStream extends Writable {
    private finishDestroy: ((error?: Error | null) => void) | undefined;

    completeClose(): void {
      this.finishDestroy?.();
    }

    _write(_chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
      callback();
    }

    _destroy(_error: Error | null, callback: (error?: Error | null) => void): void {
      this.finishDestroy = callback;
    }
  }

  return { createWriteStream: vi.fn(() => new DelayedCloseWriteStream()) };
});

vi.mock('node:fs/promises', () => ({ rename: vi.fn(), rm: vi.fn(async () => undefined) }));

import { createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { createOutput } from '../src/output.js';

interface DelayedCloseWriteStream {
  completeClose(): void;
}

describe('OutputWriter.abort', () => {
  beforeEach(() => {
    vi.mocked(createWriteStream).mockClear();
    vi.mocked(rm).mockClear();
  });

  it('waits for a write stream destroyed before open to close before unlinking its temporary path', async () => {
    const output = createOutput({ outputPath: '/tmp/leads.ndjson' });
    const stream = vi.mocked(createWriteStream).mock.results[0]?.value as DelayedCloseWriteStream | undefined;
    expect(stream).toBeDefined();

    const aborting = output.abort();
    await Promise.resolve();
    expect(rm).not.toHaveBeenCalled();

    stream?.completeClose();
    await aborting;
    expect(rm).toHaveBeenCalledOnce();
  });
});
