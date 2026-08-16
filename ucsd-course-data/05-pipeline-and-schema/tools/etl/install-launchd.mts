/**
 * Install (or remove) the launchd agent that runs the scheduled ETL refresh
 * on Monday and Thursday at 07:00 local time. See ADR 0042 and
 * docs/etl_refresh.md.
 *
 * Usage:
 *   bun tools/etl/install-launchd.mts            # install or reinstall
 *   bun tools/etl/install-launchd.mts --uninstall
 *
 * The generated plist pins absolute paths (bun, repository, logs) for the
 * current machine, so rerun this after moving the repository or bun.
 */

import { execFile } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const label = 'com.sungrid.coursetable-etl';
const uid = process.getuid?.();
if (uid === undefined) throw new Error('Cannot determine the current uid');
const domain = `gui/${String(uid)}`;
const plistPath = join(homedir(), 'Library/LaunchAgents', `${label}.plist`);

function repositoryDirectory(): string {
  const index = process.argv.indexOf('--repo');
  if (index === -1) return process.cwd();
  const value = process.argv[index + 1];
  if (!value) throw new Error('--repo requires a value');
  return resolve(value);
}

async function launchctl(...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('launchctl', args);
  return stdout;
}

async function bootoutIfLoaded(): Promise<void> {
  // Removing an agent that is not loaded is part of idempotent (re)install.
  await launchctl('bootout', `${domain}/${label}`).catch(() => {});
}

if (process.argv.includes('--uninstall')) {
  await bootoutIfLoaded();
  await rm(plistPath, { force: true });
  console.log(`Removed ${label} (${plistPath})`);
} else {
  const repo = repositoryDirectory();
  // Inside the repository's gitignored data/ archive, next to reports.
  const logDirectory = join(repo, 'data', 'logs');
  const bun = process.execPath;
  const path = [
    dirname(bun),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
  ].join(':');
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${bun}</string>
    <string>tools/etl/run-scheduled-refresh.mts</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${repo}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${path}</string>
    <key>HOME</key>
    <string>${homedir()}</string>
  </dict>
  <key>StartCalendarInterval</key>
  <array>
    <dict>
      <key>Weekday</key>
      <integer>1</integer>
      <key>Hour</key>
      <integer>7</integer>
      <key>Minute</key>
      <integer>0</integer>
    </dict>
    <dict>
      <key>Weekday</key>
      <integer>4</integer>
      <key>Hour</key>
      <integer>7</integer>
      <key>Minute</key>
      <integer>0</integer>
    </dict>
  </array>
  <key>RunAtLoad</key>
  <false/>
  <key>StandardOutPath</key>
  <string>${join(logDirectory, 'refresh.log')}</string>
  <key>StandardErrorPath</key>
  <string>${join(logDirectory, 'refresh.err.log')}</string>
</dict>
</plist>
`;

  await mkdir(dirname(plistPath), { recursive: true });
  await mkdir(logDirectory, { recursive: true });
  await writeFile(plistPath, plist);
  await execFileAsync('plutil', ['-lint', plistPath]);
  await bootoutIfLoaded();
  await launchctl('bootstrap', domain, plistPath);
  const state = await launchctl('print', `${domain}/${label}`);
  const stateLine = state.split('\n').find((line) => line.includes('state ='));
  console.log(
    JSON.stringify(
      {
        label,
        plist: plistPath,
        schedule: 'Mon and Thu 07:00 local',
        working_directory: repo,
        logs: logDirectory,
        state: stateLine?.trim() ?? 'loaded',
      },
      null,
      2,
    ),
  );
}
