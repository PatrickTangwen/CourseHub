/**
 * Scheduled ETL refresh: run the one-command refresh inside a dedicated git
 * worktree (never the operator's working copy), and open a review PR only
 * when the refresh report shows a material change. See ADR 0042 and
 * docs/etl_refresh.md.
 *
 * The worktree is reset to the remote base branch on every run, its `data/`
 * directory is a symlink to the main clone's gitignored `data/` so raw and
 * normalized history stays on one durable archive, and only the published
 * artifact paths are staged. Merging the PR and dispatching deployments stay
 * human decisions.
 */

import { spawn } from 'node:child_process';
import {
  lstat,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';

export type RefreshTotals = {
  terms_changed: number;
  courses_added: number;
  courses_removed: number;
  courses_changed: number;
};

export type RefreshRunSummary = {
  generated_at: string;
  totals: RefreshTotals;
  report_json: string;
  report_markdown: string;
};

export type ScheduledRefreshSteps = {
  installDependencies: (worktreeDirectory: string) => Promise<void>;
  /** Run the refresh in the worktree, writing the summary to `resultPath`. */
  runRefresh: (worktreeDirectory: string, resultPath: string) => Promise<void>;
  /** Open the review PR; returns its URL. */
  createPullRequest: (options: {
    worktreeDirectory: string;
    branch: string;
    baseBranch: string;
    title: string;
    bodyPath: string;
  }) => Promise<string>;
};

export type ScheduledRefreshOptions = {
  /** The main clone; it registers the worktree and owns `data/`. */
  repositoryDirectory: string;
  worktreeDirectory: string;
  branchName: string;
  steps: ScheduledRefreshSteps;
  remote?: string;
  baseBranch?: string;
  /** Worktree-relative paths staged for the data commit. */
  artifactPaths?: string[];
  log?: (line: string) => void;
};

export type ScheduledRefreshResult =
  | { status: 'no_changes'; totals: RefreshTotals }
  | {
      status: 'opened';
      branch: string;
      pullRequestUrl: string;
      totals: RefreshTotals;
    };

const defaultArtifactPaths = [
  'api/static/catalogs',
  'api/static/metadata.json',
  'frontend/src/generated/supported-terms.json',
];

function execute(
  command: string,
  args: string[],
  options: { cwd: string },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(
          new Error(
            `${command} ${args.join(' ')} exited with code ${String(code)}: ${stderr.trim()}`,
          ),
        );
      }
    });
  });
}

async function pathState(
  path: string,
): Promise<'missing' | 'symlink' | 'other'> {
  try {
    const stats = await lstat(path);
    return stats.isSymbolicLink() ? 'symlink' : 'other';
  } catch {
    return 'missing';
  }
}

/** One lock per worktree; a live pid blocks, a dead pid's lock is reclaimed. */
async function acquireRunLock(worktreeDirectory: string): Promise<string> {
  const lockDirectory = `${worktreeDirectory}.lock`;
  const pidPath = join(lockDirectory, 'pid');
  // The worktree itself is created after the lock, so on the very first run
  // the shared parent directory does not exist yet.
  await mkdir(dirname(lockDirectory), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await mkdir(lockDirectory, { recursive: false });
      await writeFile(pidPath, `${String(process.pid)}\n`);
      return lockDirectory;
    } catch (mkdirError) {
      // Only "the lock directory already exists" means the lock is held;
      // anything else is a real failure and must surface as itself.
      if ((mkdirError as NodeJS.ErrnoException).code !== 'EEXIST')
        throw mkdirError;
      const holder = Number.parseInt(
        await readFile(pidPath, 'utf-8').catch(() => ''),
        10,
      );
      if (Number.isInteger(holder)) {
        try {
          process.kill(holder, 0);
          throw new Error(
            `Another scheduled refresh (pid ${String(holder)}) is running`,
            { cause: mkdirError },
          );
        } catch (error) {
          if (error instanceof Error && error.message.includes('scheduled'))
            throw error;
          // The recorded holder is dead: reclaim the stale lock.
        }
      }
      await rm(lockDirectory, { recursive: true, force: true });
    }
  }
  throw new Error(
    `Could not acquire the refresh lock for ${worktreeDirectory}`,
  );
}

export async function runScheduledRefresh(
  options: ScheduledRefreshOptions,
): Promise<ScheduledRefreshResult> {
  const log = options.log ?? console.log;
  const remote = options.remote ?? 'origin';
  const baseBranch = options.baseBranch ?? 'main';
  const artifactPaths = options.artifactPaths ?? defaultArtifactPaths;
  const { repositoryDirectory, worktreeDirectory, branchName, steps } = options;
  const baseRef = `${remote}/${baseBranch}`;

  const lockDirectory = await acquireRunLock(worktreeDirectory);
  try {
    // 1. Fresh base: fetch, then (re)create the worktree branch from it.
    await execute('git', ['fetch', remote, baseBranch], {
      cwd: repositoryDirectory,
    });
    if ((await pathState(worktreeDirectory)) === 'missing') {
      await mkdir(dirname(worktreeDirectory), { recursive: true });
      await execute(
        'git',
        ['worktree', 'add', '--detach', worktreeDirectory, baseRef],
        { cwd: repositoryDirectory },
      );
      log(`Created refresh worktree at ${worktreeDirectory}`);
    }
    await execute('git', ['reset', '--hard', baseRef], {
      cwd: worktreeDirectory,
    });
    await execute('git', ['checkout', '-B', branchName, baseRef], {
      cwd: worktreeDirectory,
    });

    // 2. Shared durable data archive: worktree data/ points at the main
    // clone's gitignored data/ (raw runs, normalized history, reports).
    const dataLink = join(worktreeDirectory, 'data');
    const linkState = await pathState(dataLink);
    if (linkState === 'other') {
      throw new Error(
        `${dataLink} exists and is not a symlink; refusing to touch it`,
      );
    }
    if (linkState === 'missing')
      await symlink(join(repositoryDirectory, 'data'), dataLink, 'dir');

    // 3. Dependencies, then the actual refresh.
    await steps.installDependencies(worktreeDirectory);
    const resultPath = join(worktreeDirectory, '.etl-refresh-result.json');
    await rm(resultPath, { force: true });
    await steps.runRefresh(worktreeDirectory, resultPath);
    const summary = JSON.parse(
      await readFile(resultPath, 'utf-8'),
    ) as RefreshRunSummary;
    await rm(resultPath, { force: true });

    // 4. Material-change gate: header timestamps always churn, so only the
    // report's course-level evidence decides whether a PR is worth review.
    if (summary.totals.terms_changed === 0) {
      log('No material changes; skipping the PR.');
      return { status: 'no_changes', totals: summary.totals };
    }

    // 5. Stage exactly the published artifacts and demand consistency.
    await execute('git', ['add', '--', ...artifactPaths], {
      cwd: worktreeDirectory,
    });
    const staged = await execute('git', ['diff', '--cached', '--name-only'], {
      cwd: worktreeDirectory,
    });
    if (staged.trim() === '') {
      throw new Error(
        'The refresh report shows changes but no artifact file changed',
      );
    }
    const unstaged = await execute(
      'git',
      ['status', '--porcelain', '--untracked-files=no'],
      { cwd: worktreeDirectory },
    );
    const unexpected = unstaged
      .split('\n')
      .filter((line) => line.length > 0 && line[1] !== ' ');
    if (unexpected.length > 0) {
      throw new Error(
        `Refresh modified tracked files outside the artifact paths:\n${unexpected.join('\n')}`,
      );
    }

    const date = summary.generated_at.slice(0, 10);
    const title = `chore(data): scheduled ETL refresh ${date}`;
    const body =
      `${title}\n\n` +
      `${String(summary.totals.terms_changed)} terms changed, ` +
      `+${String(summary.totals.courses_added)}/-${String(summary.totals.courses_removed)} courses, ` +
      `${String(summary.totals.courses_changed)} changed in place. ` +
      `Full report in the PR description and data/reports/etl/.`;
    await execute('git', ['commit', '-m', body], { cwd: worktreeDirectory });

    // 6. Push the review branch (never the base branch) and open the PR.
    await execute('git', ['push', remote, `HEAD:refs/heads/${branchName}`], {
      cwd: worktreeDirectory,
    });
    const pullRequestUrl = await steps.createPullRequest({
      worktreeDirectory,
      branch: branchName,
      baseBranch,
      title,
      bodyPath: summary.report_markdown,
    });
    log(`Opened ${pullRequestUrl}`);
    return {
      status: 'opened',
      branch: branchName,
      pullRequestUrl: pullRequestUrl.trim(),
      totals: summary.totals,
    };
  } finally {
    await rm(lockDirectory, { recursive: true, force: true });
  }
}
