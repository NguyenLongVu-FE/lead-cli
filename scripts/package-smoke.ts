import { strict as assert } from 'node:assert';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const pnpmOptions = { shell: process.platform === 'win32' };

async function main(): Promise<void> {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'leads-cm-package-'));
  const packageDirectory = join(temporaryRoot, 'package');
  const installDirectory = join(temporaryRoot, 'install');
  try {
    const { stdout } = await exec(pnpm, ['pack', '--pack-destination', packageDirectory, '--json'], { cwd: process.cwd(), ...pnpmOptions });
    const packed = JSON.parse(stdout) as { filename: string; files: { path: string }[] };
    assertPackageContents(packed.files.map((file) => file.path));
    const [tarball] = await readdir(packageDirectory);
    assert(tarball?.endsWith('.tgz'), 'pnpm pack did not create a .tgz tarball');
    await mkdir(installDirectory);
    await writeFile(join(installDirectory, 'package.json'), '{"type":"module"}\n');
    await exec(pnpm, ['add', join(packageDirectory, tarball)], { cwd: installDirectory, ...pnpmOptions });
    const help = await exec(pnpm, ['exec', 'leads-cm', '--help'], { cwd: installDirectory, ...pnpmOptions });
    assert.match(help.stdout, /linkedin search/, 'packed executable did not print help');
    await exec(process.execPath, ['--input-type=module', '--eval', "import('leads-cm-cli').then(({ LeadsCmClient }) => { if (!LeadsCmClient) throw new Error('missing LeadsCmClient export'); })"], { cwd: installDirectory });
    process.stdout.write('package smoke: tarball contents, executable, and ESM import passed\n');
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function assertPackageContents(files: readonly string[]): void {
  for (const file of files) {
    assert(
      file === 'package.json' || file === 'README.md' || file === 'LICENSE' || file.startsWith('dist/') || file.startsWith('skills/'),
      `tarball contains an unintended file: ${file}`
    );
  }
  for (const required of ['package.json', 'README.md', 'LICENSE', 'dist/cli.js', 'skills/leads-cm/SKILL.md']) {
    assert(files.includes(required), `tarball is missing ${required}`);
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'package smoke check failed';
  process.stderr.write(`package smoke failed: ${message}\n`);
  process.exitCode = 1;
});
