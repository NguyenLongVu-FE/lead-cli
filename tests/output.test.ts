import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { createOutput } from '../src/output.js';

describe('createOutput', () => {
  it.each([
    ['csv', 'name,email\r\n'],
    ['tsv', 'name\temail\n']
  ] as const)('commits a header-only %s stream when no leads match', async (format, expected) => {
    const stream = new PassThrough();
    let document = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => { document += chunk; });
    const output = createOutput({ format, fields: ['name', 'email'], stream });

    await output.commit();

    expect(document).toBe(expected);
  });

  it('atomically commits a header-only tabular file when no leads match', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'leads-cm-empty-output-'));
    const destination = join(directory, 'empty.tsv');
    const output = createOutput({ format: 'tsv', fields: ['name'], outputPath: destination });

    await output.commit();

    expect(await readFile(destination, 'utf8')).toBe('name\n');
    expect((await readdir(directory)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('writes one stable, website-ordered JSON object per NDJSON line', async () => {
    const stream = new PassThrough();
    let document = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      document += chunk;
    });
    const output = createOutput({ stream });

    output.write({
      sourceRef: 'Eritrea:1:1',
      website: 'https://example.test',
      employees: 11,
      revenue: '250',
      name: 'Ada Example',
      title: 'Founder',
      revenueUsd: 250_000,
      companysize: 'Growing Startup'
    });
    output.write({
      sourceRef: 'Eritrea:1:2',
      title: 'CEO',
      name: 'Grace Example',
      employees: 1,
      revenue: '10',
      revenueUsd: 10_000,
      companysize: 'Solo Entrepreneur'
    });
    await output.flush();

    const lines = document.trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      {
        sourceRef: 'Eritrea:1:1',
        name: 'Ada Example',
        title: 'Founder',
        revenue: '250',
        revenueUsd: 250_000,
        employees: 11,
        companysize: 'Growing Startup',
        website: 'https://example.test'
      },
      {
        sourceRef: 'Eritrea:1:2',
        name: 'Grace Example',
        title: 'CEO',
        revenue: '10',
        revenueUsd: 10_000,
        employees: 1,
        companysize: 'Solo Entrepreneur'
      }
    ]);
    expect(Object.keys(JSON.parse(lines[0]))).toEqual([
      'sourceRef',
      'name',
      'title',
      'revenue',
      'revenueUsd',
      'employees',
      'companysize',
      'website'
    ]);
  });

  it('writes RFC 4180 CSV with requested field order and escaped quotes', async () => {
    const stream = new PassThrough();
    let document = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      document += chunk;
    });
    const output = createOutput({ format: 'csv', fields: ['name', 'note'], stream });

    output.write({ sourceRef: 'Eritrea:1:1', name: 'Ada, "The Builder"', note: 'first\nsecond', employees: 11, companysize: 'Growing Startup', revenueUsd: 0 });
    await output.flush();

    expect(document).toBe('name,note\r\n"Ada, ""The Builder""","first\nsecond"\r\n');
  });

  it('writes one physical TSV row by escaping tabs, newlines, carriage returns, and backslashes', async () => {
    const stream = new PassThrough();
    let document = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      document += chunk;
    });
    const output = createOutput({ format: 'tsv', fields: ['sourceRef', 'name'], stream });

    output.write({ sourceRef: 'Eritrea:1:1', name: 'A\tB\nC\rD\\E', employees: 11, companysize: 'Growing Startup', revenueUsd: 0 });
    await output.flush();

    expect(document).toBe('sourceRef\tname\nEritrea:1:1\tA\\tB\\nC\\rD\\\\E\n');
  });

  it('waits for a destination drain before parser processing continues', async () => {
    let releaseWrite: (() => void) | undefined;
    const stream = new Writable({
      highWaterMark: 1,
      write(_chunk, _encoding, callback) {
        releaseWrite = callback;
      }
    });
    const output = createOutput({ stream });

    output.write({ sourceRef: 'Eritrea:1:1', name: 'Ada Example', employees: 11, companysize: 'Growing Startup', revenueUsd: 0 });
    let settled = false;
    const flushing = output.flush().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    releaseWrite?.();
    await flushing;
    expect(settled).toBe(true);
  });

  it('stops accepting rows at its configured limit', async () => {
    const stream = new PassThrough();
    let document = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      document += chunk;
    });
    const output = createOutput({ stream, limit: 1 });

    output.write({ sourceRef: 'Eritrea:1:1', name: 'Ada Example', employees: 11, companysize: 'Growing Startup', revenueUsd: 0 });
    output.write({ sourceRef: 'Eritrea:1:2', name: 'Grace Example', employees: 1, companysize: 'Solo Entrepreneur', revenueUsd: 0 });
    await output.flush();

    expect(output.written).toBe(1);
    expect(output.limitReached).toBe(true);
    expect(document.trimEnd()).toContain('Ada Example');
    expect(document).not.toContain('Grace Example');
  });

  it('renames an output file only after a successful commit', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'leads-cm-output-'));
    const destination = join(directory, 'leads.ndjson');
    const output = createOutput({ outputPath: destination });

    output.write({ sourceRef: 'Eritrea:1:1', name: 'Ada Example', employees: 11, companysize: 'Growing Startup', revenueUsd: 0 });
    await output.flush();
    await output.commit();

    expect(await readFile(destination, 'utf8')).toContain('Ada Example');
    expect((await readdir(directory)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('removes a temporary output file when the search fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'leads-cm-output-'));
    const destination = join(directory, 'leads.ndjson');
    const output = createOutput({ outputPath: destination });

    output.write({ sourceRef: 'Eritrea:1:1', name: 'Ada Example', employees: 11, companysize: 'Growing Startup', revenueUsd: 0 });
    await output.flush();
    await output.abort();

    await expect(readFile(destination, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await readdir(directory)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });
});
