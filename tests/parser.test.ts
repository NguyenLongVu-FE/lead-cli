import { describe, expect, it } from 'vitest';

import { SchemaError } from '../src/errors.js';
import { parseTabular } from '../src/parser.js';
import fixture from './fixtures/leads.json';

const encoder = new TextEncoder();

function streamFromBytes(bytes: Uint8Array, chunkSize = bytes.length): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset === bytes.length) {
        controller.close();
        return;
      }

      const end = Math.min(offset + chunkSize, bytes.length);
      controller.enqueue(bytes.slice(offset, end));
      offset = end;
    }
  });
}

function streamFromJson(value: string, chunkSize?: number): ReadableStream<Uint8Array> {
  const bytes = encoder.encode(value);
  return streamFromBytes(bytes, chunkSize);
}

describe('parseTabular', () => {
  it('maps a one-byte-at-a-time response to header and row events', async () => {
    const headers: string[][] = [];
    const rows: Array<Record<string, unknown>> = [];
    let chunksCompleted = 0;

    const stats = await parseTabular(
      streamFromJson(JSON.stringify(fixture), 1),
      {
        onHeaders: (value) => headers.push([...value]),
        onRow: (row) => rows.push(row),
        onChunkComplete: async () => {
          chunksCompleted += 1;
        }
      }
    );

    expect(headers).toEqual([['name', 'employees', 'revenue', 'linkedin']]);
    expect(rows).toEqual([{ name: 'Ada Example', employees: '11', revenue: '250', linkedin: 'ada-example' }]);
    expect(stats).toEqual({ rows: 1 });
    expect(chunksCompleted).toBe(103);
  });

  it('preserves nulls and Unicode values when a UTF-8 character crosses chunks', async () => {
    const rows: Array<Record<string, unknown>> = [];

    await parseTabular(
      streamFromJson('{"headers":["name","note"],"rows":[["Nguyễn Ánh",null]]}', 1),
      { onHeaders: () => undefined, onRow: (row) => rows.push(row) }
    );

    expect(rows).toEqual([{ name: 'Nguyễn Ánh', note: null }]);
  });

  it('accepts an empty rows container', async () => {
    const headers: string[][] = [];

    await expect(
      parseTabular(streamFromJson('{"headers":["name"],"rows":[]}'), {
        onHeaders: (value) => headers.push([...value]),
        onRow: () => undefined
      })
    ).resolves.toEqual({ rows: 0 });

    expect(headers).toEqual([['name']]);
  });

  it.each([
    ['malformed JSON', '{"headers":["name"],"rows":[["Ada"]}'],
    ['truncated JSON', '{"headers":["name"],"rows":[["Ada"]'],
    ['missing headers', '{"rows":[["Ada"]]}'],
    ['missing rows', '{"headers":["name"]}'],
    ['non-array rows', '{"headers":["name"],"rows":null}'],
    ['row before headers', '{"rows":[["Ada"]],"headers":["name"]}'],
    ['short row', '{"headers":["name","email"],"rows":[["Ada"]]}'],
    ['extra column', '{"headers":["name"],"rows":[["Ada","extra"]]}'],
    ['null row', '{"headers":["name"],"rows":[null]}']
  ])('rejects %s as a schema error', async (_description, document) => {
    await expect(
      parseTabular(streamFromJson(document), { onHeaders: () => undefined, onRow: () => undefined })
    ).rejects.toBeInstanceOf(SchemaError);
  });
});
