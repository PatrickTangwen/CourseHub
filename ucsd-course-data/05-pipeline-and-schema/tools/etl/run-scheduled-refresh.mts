/**
 * CLI entrypoint for the scheduled ETL refresh (launchd runs this). See
 * ./scheduledRefresh.ts for the worktree/branch/PR flow and ADR 0042.
 *
 * Usage:
 *   bun tools/etl/run-scheduled-refresh.mts [--repo <path>] [--worktree <path>]
 *
 * Defaults: --repo is the current working directory (launchd sets it to the
 * main clone), --worktree is ~/.coursetable-etl/worktree. A macOS
 * notification reports the outcome; failures also land in the launchd log.
 */

import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { runScheduledRefresh } from './scheduledRefresh.js';

function argument(name: string, fallback?: string): string {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    if (fallback !== undefined) return fallback;
    throw new Error(`${name} requires a value`);
  }
  const value = process.argv[index + 1];
  if (!value) throw new Error(`${name} requires a value`);
  return value;
}

function run(
  command: string,
  args: string[],
  options: { cwd: string; capture?: boolean },
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: options.capture
        ? ['ignore', 'pipe', 'inherit']
        : ['ignore', 'inherit', 'inherit'],
    });
    let stdout = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolvePromise(stdout);
      } else {
        reject(
          new Error(
            `${command} ${args.join(' ')} exited with code ${String(code)}`,
          ),
        );
      }
    });
  });
}

async function notify(message: string): Promise<void> {
  // Best-effort operator notification; a failure here must not mask the
  // run's own outcome, so it is logged and swallowed.
  try {
    await run(
      'osascript',
      [
        '-e',
        `display notification ${JSON.stringify(message)} with title "CourseTable ETL"`,
      ],
      { cwd: process.cwd() },
    );
  } catch (error) {
    console.error(
      `notification failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

const repositoryDirectory = resolve(argument('--repo', process.cwd()));
const worktreeDirectory = resolve(
  argument('--worktree', join(homedir(), '.coursetable-etl', 'worktree')),
);
const now = new Date();
const stamp =
  `${now.toISOString().slice(0, 10)}-` +
  `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;

try {
  const result = await runScheduledRefresh({
    repositoryDirectory,
    worktreeDirectory,
    branchName: `data-refresh/${stamp}`,
    steps: {
      installDependencies: (worktree) =>
        run(process.execPath, ['install', '--frozen-lockfile'], {
          cwd: worktree,
        }).then(() => {}),
      runRefresh: (worktree, resultPath) =>
        run(
          process.execPath,
          [
            'tools/etl/run-refresh.mts',
            '--config',
            'config/catalog-snapshot.ucsd.yaml',
            '--result-path',
            resultPath,
          ],
          { cwd: worktree },
        ).then(() => {}),
      createPullRequest: async (options) =>
        (
          await run(
            'gh',
            [
              'pr',
              'create',
              '--base',
              options.baseBranch,
              '--head',
              options.branch,
              '--title',
              options.title,
              '--body-file',
              options.bodyPath,
            ],
            { cwd: options.worktreeDirectory, capture: true },
          )
        ).trim(),
    },
  });

  if (result.status === 'opened') {
    console.log(`opened ${result.pullRequestUrl}`);
    await notify(`Data refresh PR ready for review: ${result.pullRequestUrl}`);
  } else {
    console.log('no material changes; no PR opened');
    await notify('Data refresh ran: no material changes, no PR.');
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  await notify(`Data refresh FAILED: ${message.slice(0, 180)}`);
  process.exitCode = 1;
}
