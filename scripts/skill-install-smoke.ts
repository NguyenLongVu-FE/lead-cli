import { strict as assert } from 'node:assert';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const tar = process.platform === 'win32' ? 'tar.exe' : 'tar';
const npxOptions = { shell: process.platform === 'win32' };

async function main(): Promise<void> {
  const projectRoot = resolve('.');
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'leads-cm-skill-install-'));
  const packageDirectory = join(temporaryRoot, 'packed');
  const unpackDirectory = join(temporaryRoot, 'unpacked');
  const installDirectory = join(temporaryRoot, 'install');

  try {
    await Promise.all([mkdir(packageDirectory), mkdir(unpackDirectory), mkdir(installDirectory)]);
    await writeFile(join(installDirectory, 'package.json'), '{"private":true}\n');
    await exec(pnpm, ['pack', '--pack-destination', packageDirectory], { cwd: projectRoot, ...npxOptions });
    const [tarball] = await readdir(packageDirectory);
    if (tarball === undefined || !tarball.endsWith('.tgz')) throw new Error('pnpm pack did not create a tarball');
    await exec(tar, ['-xzf', join(packageDirectory, tarball), '-C', unpackDirectory], npxOptions);
    const unpackedPackage = join(unpackDirectory, 'package');
    await exec(npx, ['-y', 'skills', 'add', unpackedPackage, '--skill', 'leads-cm', '--agent', 'codex', '--copy', '-y'], {
      cwd: installDirectory,
      ...npxOptions
    });
    const { stdout } = await exec(npx, ['-y', 'skills', 'list', '--json'], { cwd: installDirectory, ...npxOptions });
    assert.match(stdout, /"name"\s*:\s*"leads-cm"/, 'skills CLI did not list the installed leads-cm skill');
    process.stdout.write('skill install smoke passed: leads-cm is discoverable by the skills CLI\n');
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'skill install smoke failed';
  process.stderr.write(`skill install smoke failed: ${message}\n`);
  process.exitCode = 1;
});
