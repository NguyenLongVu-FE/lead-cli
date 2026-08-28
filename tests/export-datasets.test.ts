import { mkdtemp, readFile, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { LeadsCmClient } from '../src/client.js';
import { exportDatasets } from '../src/export-datasets.js';
import type { GetOptions, Transport, TransportResponse } from '../src/transport.js';

const encoder = new TextEncoder();

function dataResponse(name: string): TransportResponse {
  return {
    status: 200,
    headers: new Headers(),
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(JSON.stringify({
          headers: ['name', 'title', 'employees', 'revenue', 'linkedin'],
          rows: [[name, 'Founder', '11', '250', name.toLowerCase()]]
        })));
        controller.close();
      }
    })
  };
}

describe('exportDatasets', () => {
  it('writes dataset CSV files sequentially with the requested two-file grouping', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'leads-cm-datasets-'));
    const urls: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const transport: Transport = {
      async get(url) {
        urls.push(url);
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Promise.resolve();
        inFlight -= 1;
        const file = Number(new URL(url).pathname.match(/\/(\d+)\.json$/)?.[1]);
        return dataResponse(`Lead ${file}`);
      }
    };

    const result = await exportDatasets(new LeadsCmClient({ transport }), {
      country: 'Eritrea', startDataset: 1, endDataset: 2, datasetSize: 2,
      outputDir: directory, filters: {}, excludeBlacklist: false
    });

    expect(result.files.map((file) => basename(file))).toEqual(['dataset-1.csv', 'dataset-2.csv']);
    expect(maxInFlight).toBe(1);
    expect(urls).toEqual([1, 2, 3, 4].map((file) => `https://vorbidden.com/Eritrea/${file}.json`));
    expect(await readFile(join(directory, 'dataset-1.csv'), 'utf8')).toContain('Lead 1');
    expect(await readFile(join(directory, 'dataset-2.csv'), 'utf8')).toContain('Lead 4');
  });

  it('keeps completed datasets and removes the active temporary file on cancellation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'leads-cm-datasets-'));
    const cancellation = new AbortController();
    const transport: Transport = {
      async get(url, options) {
        const file = Number(new URL(url).pathname.match(/\/(\d+)\.json$/)?.[1]);
        if (file !== 3) return dataResponse(`Lead ${file}`);
        queueMicrotask(() => cancellation.abort(new Error('cancelled')));
        return hangingResponse(options);
      }
    };

    await expect(exportDatasets(new LeadsCmClient({ transport }), {
      country: 'Eritrea', startDataset: 1, endDataset: 2, datasetSize: 2,
      outputDir: directory, filters: {}, excludeBlacklist: false, signal: cancellation.signal
    })).rejects.toThrow();

    expect(await readFile(join(directory, 'dataset-1.csv'), 'utf8')).toContain('Lead 2');
    await expect(readFile(join(directory, 'dataset-2.csv'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await readdir(directory)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('rejects a reversed range before creating its output directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'leads-cm-datasets-'));
    const directory = join(root, 'not-created');

    await expect(exportDatasets(new LeadsCmClient(), {
      country: 'Eritrea', startDataset: 2, endDataset: 1, datasetSize: 5,
      outputDir: directory, filters: {}, excludeBlacklist: false
    })).rejects.toMatchObject({ name: 'CliError', exitCode: 1 });
    await expect(stat(directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

function hangingResponse(options: GetOptions | undefined): TransportResponse {
  return {
    status: 200,
    headers: new Headers(),
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(JSON.stringify({
          headers: ['name', 'title', 'employees', 'revenue', 'linkedin'],
          rows: [['Interrupted', 'Founder', '11', '250', 'interrupted']]
        })));
        options?.signal?.addEventListener('abort', () => controller.error(options.signal?.reason));
      }
    })
  };
}
