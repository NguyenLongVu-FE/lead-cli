import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { startHttpServer, type LocalHttpServer } from './http-server.js';

const fixture = JSON.stringify({
  headers: ['name', 'title', 'employees', 'revenue', 'linkedin', 'email', 'industry'],
  rows: [['Ada Example', 'Founder', '11', '250', 'ada-example', 'ada@example.test', 'Computer Software']]
});

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

let server: LocalHttpServer;
let hangingDatasetSeen: Promise<void> = Promise.resolve();
let notifyHangingDataset: (() => void) | undefined;

beforeAll(async () => {
  server = await startHttpServer((request, response) => {
    if (request.url === '/Eritrea/1.json') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(fixture);
      return;
    }
    if (request.url === '/Eritrea/2.json') {
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end('{}');
      return;
    }
    if (request.url === '/Blacklist/Eritrea.json') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ headers: ['email'], rows: [[' ADA@example.test ']] }));
      return;
    }
    if (request.url === '/Broken/1.json') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"headers":["name"],"rows":"not-an-array"}');
      return;
    }
    if (request.url === '/Uncatalogued/1.json') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(fixture);
      return;
    }
    if (request.url === '/Forbidden/1.json') {
      response.writeHead(403, { 'content-type': 'application/json' });
      response.end('{}');
      return;
    }
    if (request.url === '/Afghanistan/1.json' || request.url === '/Afghanistan/2.json' || request.url === '/Afghanistan/4.json') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(fixture);
      return;
    }
    if (request.url === '/Afghanistan/3.json') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.write(fixture);
      notifyHangingDataset?.();
      request.once('close', () => response.destroy());
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end('{}');
  });
});

afterAll(async () => {
  await server.close();
});

describe('leads-cm', () => {
  test('prints agent-readable help', async () => {
    const result = await run('--help');

    expect(result).toMatchObject({ code: 0, stderr: '' });
    expect(result.stdout).toContain('linkedin search');
  });

  test('checks access without printing contact data', async () => {
    const result = await run('setup');

    expect(result).toMatchObject({ code: 0, stdout: 'Setup succeeded\n', stderr: '' });
  });

  test('lists countries as text or stable JSON', async () => {
    const text = await run('countries');
    const json = await run('countries', '--json');

    expect(text).toMatchObject({ code: 0, stderr: '' });
    expect(text.stdout).toContain('Eritrea');
    expect(JSON.parse(json.stdout)).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Eritrea', slug: 'Eritrea' })]));
    expect(json.stderr).toBe('');
  });

  test('lists filter metadata with the audited source status values', async () => {
    const text = await run('linkedin', 'filters');
    const result = await run('linkedin', 'filters', '--json');

    expect(result).toMatchObject({ code: 0, stderr: '' });
    expect(JSON.parse(result.stdout)).toMatchObject({
      requiredFields: expect.arrayContaining(['email']),
      outputFields: expect.arrayContaining(['sourceRef', 'name']),
      revenueBands: ['0-1M', '1-10M', '10-50M', '50-100M', '100-250M', '250-500M', '500M-1B', '>1B'],
      statusValues: ['Valid', 'Good', 'Risky', 'Invalid']
    });
    expect(text.stdout).toContain('status values: Valid, Good, Risky, Invalid');
  });

  test('rejects a search without a country', async () => {
    const result = await run('linkedin', 'search', '--file', '1');

    expect(result).toMatchObject({ code: 1, stdout: '' });
    expect(result.stderr).toContain('--country is required');
  });

  test('rejects mutually exclusive selection flags', async () => {
    const result = await run('linkedin', 'search', '--country', 'Eritrea', '--file', '1', '--all');

    expect(result).toMatchObject({ code: 1, stdout: '' });
    expect(result.stderr).toContain('exactly one selection mode');
  });

  test('keeps comma-bearing repeatable filter values intact in dry runs', async () => {
    const result = await run(
      'linkedin',
      'search',
      '--country',
      'Eritrea',
      '--file',
      '1',
      '--industry-include',
      'Leisure, Travel & Tourism',
      '--industry-include',
      'Computer Software',
      '--dry-run'
    );

    expect(result).toMatchObject({ code: 0, stderr: '' });
    expect(JSON.parse(result.stdout)).toMatchObject({
      selection: { kind: 'file', file: 1 },
      filters: { industryInclude: ['Leisure, Travel & Tourism', 'Computer Software'] }
    });
  });

  test('splits fields and require values while writing selected CSV columns', async () => {
    const result = await run(
      'linkedin',
      'search',
      '--country',
      'Eritrea',
      '--file',
      '1',
      '--require',
      'email,linkedin',
      '--fields',
      'name,linkedin',
      '--format',
      'csv'
    );

    expect(result).toMatchObject({ code: 0, stdout: 'name,linkedin\r\nAda Example,http://www.linkedin.com/in/ada-example\r\n' });
    expect(result.stderr).toMatch(/completed: 1 files, 1 rows, 1 matched, 1 written/);
    expect(result.stderr).not.toContain('Ada Example');
  });

  test('permits an unknown country only with an explicit file', async () => {
    const explicitFile = await run('linkedin', 'search', '--country', 'Uncatalogued', '--file', '1');
    const omittedSelection = await run('linkedin', 'search', '--country', 'Uncatalogued');
    const omittedSelectionDryRun = await run('linkedin', 'search', '--country', 'Uncatalogued', '--dry-run');
    const allFiles = await run('linkedin', 'search', '--country', 'Uncatalogued', '--all');

    expect(explicitFile).toMatchObject({ code: 0 });
    expect(explicitFile.stdout).toContain('Ada Example');
    expect(omittedSelection).toMatchObject({ code: 1, stdout: '' });
    expect(omittedSelection.stderr).toContain('explicit --file');
    expect(omittedSelectionDryRun).toMatchObject({ code: 1, stdout: '' });
    expect(omittedSelectionDryRun.stderr).toContain('explicit --file');
    expect(allFiles).toMatchObject({ code: 3, stdout: '' });
    expect(allFiles.stderr).toContain('not available for multi-file searches');
  });

  test('rejects an unknown country multi-file dry run before it prints a plan', async () => {
    const result = await run('linkedin', 'search', '--country', 'Uncatalogued', '--all', '--dry-run');

    expect(result).toMatchObject({ code: 3, stdout: '' });
    expect(result.stderr).toContain('not available for multi-file searches');
  });

  test('warns with the catalog estimate before an all-file search while keeping stdout data-only', async () => {
    const result = await run('linkedin', 'search', '--country', 'Eritrea', '--all', '--max-files', '1');

    expect(result).toMatchObject({ code: 0 });
    expect(result.stderr).toMatch(/^warning: --all may process about 680 leads across 2 files\ncompleted:/);
    expect(result.stdout).toMatch(/^\{.*\}\n$/);
    expect(result.stdout).not.toContain('warning:');
  });

  test.each(['2', '5'])('warns before a dataset-size %s multi-file search', async (datasetSize) => {
    const result = await run('linkedin', 'search', '--country', 'Eritrea', '--dataset', '1', '--dataset-size', datasetSize, '--limit', '1');

    expect(result).toMatchObject({ code: 0 });
    expect(result.stderr).toMatch(/^warning: --dataset 1 may process up to 2 catalog files \(about 680 leads total catalog\)\ncompleted:/);
    expect(result.stdout).not.toContain('warning:');
  });

  test('supports paged TSV output with a stable source reference', async () => {
    const result = await run('linkedin', 'search', '--country', 'Eritrea', '--page', '1', '--format', 'tsv');

    expect(result).toMatchObject({ code: 0 });
    expect(result.stdout).toMatch(/^sourceRef\t/);
    expect(result.stdout).toContain('Eritrea:1:1\tAda Example');
  });

  test('dry-runs dataset size, page, revenue bands, exclusions, and blacklist mode without transport', async () => {
    const result = await run(
      'linkedin', 'search', '--country', 'Eritrea', '--dataset', '2', '--dataset-size', '2',
      '--page', '3', '--page-size', '25', '--revenue-band', '0-1M', '--revenue-band', '>1B',
      '--exclude-ref', 'Eritrea:1:1', '--exclude-blacklist', '--dry-run'
    );

    expect(result).toMatchObject({ code: 0, stderr: '' });
    expect(JSON.parse(result.stdout)).toMatchObject({
      selection: { kind: 'dataset', dataset: 2, size: 2 },
      urls: ['https://vorbidden.com/Eritrea/3.json', 'https://vorbidden.com/Eritrea/4.json'],
      filters: { revenueBands: ['0-1M', '>1B'] },
      page: { number: 3, size: 25 },
      excludeRefsCount: 1,
      excludeBlacklist: true
    });
  });

  test('rejects conflicting or context-free LinkedIn search flags before output', async () => {
    const cases = [
      ['--page-size', '50'],
      ['--page', '1', '--limit', '1'],
      ['--revenue-band', '0-1M', '--revenue-min', '1'],
      ['--file', '1', '--dataset-size', '2'],
      ['--status', 'Valid'],
      ['--revenue-band', 'not-a-band']
    ];

    for (const flags of cases) {
      const result = await run('linkedin', 'search', '--country', 'Eritrea', ...flags);
      expect(result).toMatchObject({ code: 1, stdout: '' });
    }
  });

  test('starts each command with reset filters instead of persisting prior process state', async () => {
    const filtered = await run('linkedin', 'search', '--country', 'Eritrea', '--title-include', 'Not Present');
    const reset = await run('linkedin', 'search', '--country', 'Eritrea');

    expect(filtered).toMatchObject({ code: 0, stdout: '' });
    expect(reset).toMatchObject({ code: 0 });
    expect(reset.stdout).toContain('Ada Example');
  });

  test('reports blacklist-only verification on stderr while keeping stdout lead-only', async () => {
    const result = await run('linkedin', 'verify', '--country', 'Eritrea');

    expect(result).toMatchObject({ code: 0, stdout: '' });
    expect(result.stderr).toContain('verificationMode=blacklist-only checked=1 excluded=1 written=0');
    expect(result.stderr).not.toContain('ada@example.test');
  });

  test('warns when a blacklist is unavailable without claiming verification success', async () => {
    const result = await run('linkedin', 'verify', '--country', 'Uncatalogued', '--file', '1');

    expect(result).toMatchObject({ code: 0 });
    expect(result.stdout).toContain('Ada Example');
    expect(result.stderr).toContain('warning: no known blacklist');
    expect(result.stderr).toContain('verificationMode=blacklist-only checked=0 excluded=0 written=1');
  });

  test('views one source reference as JSON or deterministic text', async () => {
    const json = await run('linkedin', 'lead', 'view', 'Eritrea:1:1');
    const text = await run('linkedin', 'lead', 'view', 'Eritrea:1:1', '--format', 'text');

    expect(json).toMatchObject({ code: 0, stderr: '' });
    expect(JSON.parse(json.stdout)).toMatchObject({ sourceRef: 'Eritrea:1:1', name: 'Ada Example' });
    expect(text).toMatchObject({ code: 0, stderr: '' });
    expect(text.stdout).toContain('sourceRef: Eritrea:1:1\nname: Ada Example\n');
  });

  test('prints relevant help without requiring command inputs', async () => {
    for (const arguments_ of [
      ['linkedin', 'search', '--help'],
      ['linkedin', 'verify', '--help'],
      ['linkedin', 'lead', 'view', '--help'],
      ['linkedin', 'export', 'datasets', '--help']
    ]) {
      const result = await run(...arguments_);
      expect(result).toMatchObject({ code: 0, stderr: '' });
      expect(result.stdout).toContain('Usage: leads-cm');
    }
  });

  test('documents every new search and range-export control in command help', async () => {
    const search = await run('linkedin', 'search', '--help');
    const exportHelp = await run('linkedin', 'export', 'datasets', '--help');

    for (const flag of ['--dataset-size', '--page', '--page-size', '--exclude-ref', '--exclude-blacklist', '--revenue-band', '--format']) {
      expect(search.stdout).toContain(flag);
    }
    for (const flag of ['--start-dataset', '--end-dataset', '--dataset-size', '--output-dir', '--exclude-ref', '--exclude-blacklist', '--dry-run']) {
      expect(exportHelp.stdout).toContain(flag);
    }
  });

  test('exports a dataset range to explicit atomic CSV files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'leads-cm-cli-export-'));
    const result = await run(
      'linkedin', 'export', 'datasets', '--country', 'Afghanistan',
      '--start-dataset', '1', '--end-dataset', '1', '--dataset-size', '2', '--output-dir', directory
    );

    expect(result).toMatchObject({ code: 0 });
    expect(result.stderr).toContain('estimate: 1 datasets, 2 source files');
    expect(JSON.parse(result.stdout)).toMatchObject({ completedDatasets: 1 });
    expect(await readFile(join(directory, 'dataset-1.csv'), 'utf8')).toContain('sourceRef,name');
    expect((await readdir(directory)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  test('dry-runs dataset ranges without creating the output directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'leads-cm-cli-export-'));
    const directory = join(root, 'not-created');
    const result = await run(
      'linkedin', 'export', 'datasets', '--country', 'Afghanistan',
      '--start-dataset', '2', '--end-dataset', '3', '--dataset-size', '2', '--output-dir', directory, '--dry-run'
    );

    expect(result).toMatchObject({ code: 0, stderr: '' });
    expect(JSON.parse(result.stdout)).toMatchObject({
      datasets: [
        { dataset: 2, files: { start: 3, end: 4 } },
        { dataset: 3, files: { start: 5, end: 6 } }
      ]
    });
    await expect(readFile(join(directory, 'dataset-2.csv'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('exits 130 on SIGINT while preserving completed datasets and cleaning the active one', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'leads-cm-cli-export-'));
    hangingDatasetSeen = new Promise((resolve) => {
      notifyHangingDataset = resolve;
    });
    const running = startRun(
      'linkedin', 'export', 'datasets', '--country', 'Afghanistan',
      '--start-dataset', '1', '--end-dataset', '2', '--dataset-size', '2', '--output-dir', directory
    );
    await Promise.race([
      hangingDatasetSeen,
      running.result.then(() => { throw new Error('export exited before reaching the cancellable dataset'); })
    ]);
    running.child.kill('SIGINT');
    const result = await running.result;

    expect(result.code).toBe(130);
    expect(await readFile(join(directory, 'dataset-1.csv'), 'utf8')).toContain('Ada Example');
    await expect(readFile(join(directory, 'dataset-2.csv'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await readdir(directory)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  test('uses stable exit codes for validation, access, network, partial output, and schema failures', async () => {
    const validation = await run('linkedin', 'search', '--country', 'Eritrea', '--file', '0');
    const access = await run('linkedin', 'search', '--country', 'Forbidden', '--file', '1');
    const network = await run('linkedin', 'search', '--country', 'Missing', '--all');
    const partial = await run('linkedin', 'search', '--country', 'Eritrea', '--dataset', '1');
    const schema = await run('linkedin', 'search', '--country', 'Broken', '--file', '1');

    expect(validation).toMatchObject({ code: 1, stdout: '' });
    expect(access).toMatchObject({ code: 2, stdout: '' });
    expect(network).toMatchObject({ code: 3, stdout: '' });
    expect(partial).toMatchObject({ code: 4 });
    expect(partial.stdout).toContain('Ada Example');
    expect(partial.stderr).toContain('partial output');
    expect(schema).toMatchObject({ code: 5, stdout: '' });
  }, 15_000);
});

async function run(...arguments_: string[]): Promise<CommandResult> {
  return startRun(...arguments_).result;
}

function startRun(...arguments_: string[]): { child: ReturnType<typeof spawn>; result: Promise<CommandResult> } {
  const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
  const child = spawn(process.execPath, [cli, ...arguments_], {
    env: { ...process.env, LEADS_CM_BASE_URL: server.url },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
  const result = once(child, 'close').then(([code]) => ({
    code: code as number,
    stdout: Buffer.concat(stdout).toString('utf8'),
    stderr: Buffer.concat(stderr).toString('utf8')
  }));
  return { child, result };
}
