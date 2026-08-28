import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, copyFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { build } from 'esbuild';

const execFile = promisify(execFileCallback);
const seaFuse = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

async function main(): Promise<void> {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    throw new Error('macOS packaging requires macOS arm64');
  }

  const packageJson = JSON.parse(await readFile(resolve('package.json'), 'utf8')) as { version: string };
  const artifactBase = `leads-cm-${packageJson.version}-macos-arm64`;
  const releaseDirectory = resolve('release');
  const archive = join(releaseDirectory, `${artifactBase}.tar.gz`);
  const checksum = join(releaseDirectory, `${artifactBase}.sha256`);
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'leads-cm-macos-build-'));
  const stagingDirectory = join(temporaryRoot, 'staging');
  const bundle = join(temporaryRoot, 'leads-cm.cjs');
  const blob = join(temporaryRoot, 'sea-prep.blob');
  const seaConfig = join(temporaryRoot, 'sea-config.json');
  const executable = join(stagingDirectory, 'leads-cm');

  try {
    await mkdir(releaseDirectory, { recursive: true });
    await mkdir(stagingDirectory);
    await Promise.all([rm(archive, { force: true }), rm(checksum, { force: true })]);

    await build({
      entryPoints: [resolve('src/cli.ts')],
      outfile: bundle,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node22',
      minify: false
    });
    await writeFile(seaConfig, `${JSON.stringify({ main: bundle, output: blob, disableExperimentalSEAWarning: true })}\n`);
    await execFile(process.execPath, ['--experimental-sea-config', seaConfig]);

    await execFile('/usr/bin/lipo', [process.execPath, '-thin', 'arm64', '-output', executable]);
    await execFile('/usr/bin/codesign', ['--remove-signature', executable]);
    await execFile(resolve('node_modules/.bin/postject'), [
      executable,
      'NODE_SEA_BLOB',
      blob,
      '--sentinel-fuse',
      seaFuse,
      '--macho-segment-name',
      'NODE_SEA'
    ]);
    await execFile('/usr/bin/codesign', ['--sign', '-', executable]);
    await chmod(executable, 0o755);
    await Promise.all([
      copyFile(resolve('README.md'), join(stagingDirectory, 'README.md')),
      copyFile(resolve('LICENSE'), join(stagingDirectory, 'LICENSE')),
      cp(resolve('skills'), join(stagingDirectory, 'skills'), { recursive: true })
    ]);

    await execFile('/usr/bin/tar', ['-czf', archive, '-C', stagingDirectory, 'leads-cm', 'README.md', 'LICENSE', 'skills']);
    const digest = createHash('sha256').update(await readFile(archive)).digest('hex');
    await writeFile(checksum, `${digest}  ${basename(archive)}\n`);
    process.stdout.write(`${archive}\n${checksum}\n`);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'macOS packaging failed';
  process.stderr.write(`macOS packaging failed: ${message}\n`);
  process.exitCode = 1;
});
