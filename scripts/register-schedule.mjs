/**
 * Windows entry point for the Arc Mainnet deploy.
 *
 * Arc publishes its Foundry fork as a Linux binary only, so the deploy runs
 * inside WSL. This converts the project path and hands over to the bash script,
 * keeping stdio attached - the script asks for a typed confirmation and that
 * prompt has to reach a real terminal.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const translated = spawnSync('wsl.exe', ['-d', 'Ubuntu', '-e', 'wslpath', '-a', root], {
  encoding: 'utf8',
});

if (translated.status !== 0) {
  console.error('Could not reach WSL. Is Ubuntu installed and running?');
  console.error(translated.stderr?.trim() || '');
  process.exit(1);
}

const linuxRoot = translated.stdout.trim();

const run = spawnSync(
  'wsl.exe',
  ['-d', 'Ubuntu', '-e', 'bash', `${linuxRoot}/scripts/register-schedule.sh`],
  { stdio: 'inherit' },
);

process.exit(run.status ?? 1);
