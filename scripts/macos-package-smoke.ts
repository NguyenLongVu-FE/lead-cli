import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

async function main(): Promise<void> {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    throw new Error('macOS package smoke test requires macOS arm64');
  }

  const packageJson = JSON.parse(await readFile(resolve('package.json'), 'utf8')) as { version: string };
  const archive = resolve('release', `leads-cm-${packageJson.version}-macos-arm64.tar.gz`);
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'leads-cm-macos-package-'));

  try {
    await stat(archive);
    const { stdout: listing } = await execFile('/usr/bin/tar', ['-tzf', archive]);
    const entries = listing.trim().split('\n').sort();
    const expectedEntries = ['LICENSE', 'README.md', 'leads-cm', 'skills/', 'skills/leads-cm/', 'skills/leads-cm/SKILL.md'].sort();
    if (JSON.stringify(entries) !== JSON.stringify(expectedEntries)) {
      throw new Error(`unexpected archive contents: ${entries.join(', ')}`);
    }

    await execFile('/usr/bin/tar', ['-xzf', archive, '-C', temporaryRoot]);
    const skill = await readFile(join(temporaryRoot, 'skills', 'leads-cm', 'SKILL.md'), 'utf8');
    if (!skill.includes('name: leads-cm')) {
      throw new Error('standalone archive contains an invalid leads-cm skill');
    }
    const executable = join(temporaryRoot, 'leads-cm');
    const executableStat = await stat(executable);
    if ((executableStat.mode & 0o111) === 0) {
      throw new Error('leads-cm is not executable');
    }

    const { stdout: fileOutput } = await execFile('/usr/bin/file', [executable]);
    if (!fileOutput.includes('Mach-O 64-bit executable arm64')) {
      throw new Error(`leads-cm is not an arm64 Mach-O executable: ${fileOutput.trim()}`);
    }
    await execFile('/usr/bin/codesign', ['--verify', '--strict', executable]);

    const emptyPath = join(temporaryRoot, 'empty-path');
    const environment = { ...process.env, PATH: emptyPath };
    const { stdout: help, stderr: helpError } = await execFile(executable, ['--help'], { env: environment });
    if (!help.includes('Usage: leads-cm <command>') || !help.includes('linkedin search') || helpError !== '') {
      throw new Error('standalone help output is invalid');
    }

    const { stdout: countries, stderr: countriesError } = await execFile(executable, ['countries', '--json'], { env: environment });
    const parsed = JSON.parse(countries) as Array<{ name?: string }>;
    if (!parsed.some((country) => country.name === 'Eritrea') || countriesError !== '') {
      throw new Error('standalone countries output is invalid');
    }

    process.stdout.write(`macOS package smoke passed: ${archive}\n`);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'macOS package smoke failed';
  process.stderr.write(`macOS package smoke failed: ${message}\n`);
  process.exitCode = 1;
});
