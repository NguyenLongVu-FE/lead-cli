import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { strict as assert } from 'node:assert';

const ROWS = 100_000;
const MATCHES = 1_000;

async function main(): Promise<void> {
  const server = createServer((request, response) => {
    if (request.url !== '/Eritrea/1.json') {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end('{}');
      return;
    }
    void writeDataset(response);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address();
    assert(address !== null && typeof address !== 'string', 'large-stream server did not bind to a TCP port');
    const result = await runCli(`http://127.0.0.1:${address.port}`);
    assert.equal(result.code, 0, `large-stream CLI exited ${result.code}: ${result.stderr}`);
    assert.match(
      result.stderr,
      new RegExp(`completed: 1 files, ${ROWS} rows, ${MATCHES} matched, ${MATCHES} written`),
      'large-stream CLI did not report the exact expected result count'
    );
    process.stdout.write(`large-stream: ${ROWS} rows, ${MATCHES} matches, 128 MiB heap\n`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

async function writeDataset(response: import('node:http').ServerResponse): Promise<void> {
  response.writeHead(200, { 'content-type': 'application/json' });
  await write(response, '{"headers":["name","title","employees","revenue","linkedin"],"rows":[');
  for (let index = 0; index < ROWS; index += 1) {
    const row = JSON.stringify([
      `Invented Person ${index}`,
      index % (ROWS / MATCHES) === 0 ? 'Founder' : 'Engineer',
      '11',
      '250',
      `invented-person-${index}`
    ]);
    await write(response, `${index === 0 ? '' : ','}${row}`);
  }
  response.end(']}');
}

async function write(response: import('node:http').ServerResponse, chunk: string): Promise<void> {
  if (!response.write(chunk)) {
    await once(response, 'drain');
  }
}

async function runCli(baseUrl: string): Promise<{ code: number | null; stderr: string }> {
  const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
  const child = spawn(process.execPath, ['--max-old-space-size=128', cli, 'linkedin', 'search', '--country', 'Eritrea', '--file', '1', '--title-include', 'Founder'], {
    env: { ...process.env, LEADS_CM_BASE_URL: baseUrl },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  const stderr: Buffer[] = [];
  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
  const [code] = (await once(child, 'close')) as [number | null];
  return { code, stderr: Buffer.concat(stderr).toString('utf8') };
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'large-stream check failed';
  process.stderr.write(`large-stream failed: ${message}\n`);
  process.exitCode = 1;
});
