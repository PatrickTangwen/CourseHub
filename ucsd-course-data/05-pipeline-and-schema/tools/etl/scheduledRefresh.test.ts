import { execFile } from 'node:child_process';
import { lstat, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import {
  runScheduledRefresh,
  type ScheduledRefreshSteps,
} from './scheduledRefresh';

const execFileAsync = promisify(execFile);

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout;
}

type Fixture = {
  originDirectory: string;
  repositoryDirectory: string;
  worktreeDirectory: string;
  artifactPath: string;
  reportPath: string;
};

async function makeFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'scheduled-refresh-'));
  tempDirectories.push(root);
  const originDirectory = join(root, 'origin.git');
  const repositoryDirectory = join(root, 'clone');
  await mkdir(originDirectory);
  await git(root, 'init', '--bare', '-b', 'main', originDirectory);
  await git(root, 'clone', originDirectory, repositoryDirectory);
  await git(repositoryDirectory, 'config', 'user.name', 'Fixture');
  await git(repositoryDirectory, 'config', 'user.email', 'fixture@test');

  const artifactPath = 'api/static/catalogs/SP26.json';
  await mkdir(join(repositoryDirectory, 'api/static/catalogs'), {
    recursive: true,
  });
  await writeFile(join(repositoryDirectory, artifactPath), '{"courses":[]}\n');
  await mkdir(join(repositoryDirectory, 'data'), { recursive: true });
  await git(repositoryDirectory, 'add', '.');
  await git(repositoryDirectory, 'commit', '-m', 'seed');
  await git(repositoryDirectory, 'push', 'origin', 'main');

  const reportPath = join(root, 'refresh-report.md');
  await writeFile(reportPath, '# ETL Refresh Report\n');

  return {
    originDirectory,
    repositoryDirectory,
    worktreeDirectory: join(root, 'etl-worktree'),
    artifactPath,
    reportPath,
  };
}

function makeSteps(
  fixture: Fixture,
  options: { termsChanged: number; touchArtifact?: boolean },
): ScheduledRefreshSteps & { calls: string[]; prBodyPaths: string[] } {
  const calls: string[] = [];
  const prBodyPaths: string[] = [];
  return {
    calls,
    prBodyPaths,
    installDependencies() {
      calls.push('install');
      return Promise.resolve();
    },
    async runRefresh(worktreeDirectory, resultPath) {
      calls.push('refresh');
      if (options.touchArtifact ?? true) {
        await writeFile(
          join(worktreeDirectory, fixture.artifactPath),
          '{"courses":["refreshed"]}\n',
        );
      }
      await writeFile(
        resultPath,
        JSON.stringify({
          generated_at: '2026-08-07T07:00:00.000Z',
          totals: {
            terms_changed: options.termsChanged,
            courses_added: options.termsChanged,
            courses_removed: 0,
            courses_changed: 0,
          },
          report_json: fixture.reportPath.replace(/\.md$/u, '.json'),
          report_markdown: fixture.reportPath,
        }),
      );
    },
    createPullRequest(prOptions) {
      calls.push('pr');
      prBodyPaths.push(prOptions.bodyPath);
      return Promise.resolve(`https://github.test/pr/${prOptions.branch}`);
    },
  };
}

describe('runScheduledRefresh', () => {
  it('bootstraps when the worktree parent directory does not exist yet', async () => {
    const fixture = await makeFixture();
    const steps = makeSteps(fixture, { termsChanged: 1 });

    // First-ever scheduled run: neither the shared parent directory nor the
    // worktree exists (the regression behind the failed 07:00 launchd run).
    const result = await runScheduledRefresh({
      repositoryDirectory: fixture.repositoryDirectory,
      worktreeDirectory: join(
        fixture.worktreeDirectory,
        '..',
        'never-created-parent',
        'worktree',
      ),
      branchName: 'data-refresh/bootstrap',
      artifactPaths: ['api/static/catalogs'],
      steps,
      log() {},
    });

    expect(result.status).toBe('opened');
  }, 60_000);

  it('pushes a review branch and opens a PR when the report shows changes', async () => {
    const fixture = await makeFixture();
    const steps = makeSteps(fixture, { termsChanged: 2 });

    const result = await runScheduledRefresh({
      repositoryDirectory: fixture.repositoryDirectory,
      worktreeDirectory: fixture.worktreeDirectory,
      branchName: 'data-refresh/test-run',
      artifactPaths: ['api/static/catalogs'],
      steps,
      log() {},
    });

    expect(result.status).toBe('opened');
    if (result.status === 'opened') {
      expect(result.pullRequestUrl).toBe(
        'https://github.test/pr/data-refresh/test-run',
      );
    }
    expect(steps.calls).toEqual(['install', 'refresh', 'pr']);
    expect(steps.prBodyPaths).toEqual([fixture.reportPath]);

    // The branch landed on the origin with the refreshed artifact.
    const subject = await git(
      fixture.originDirectory,
      'log',
      '-1',
      '--format=%s',
      'refs/heads/data-refresh/test-run',
    );
    expect(subject.trim()).toBe(
      'chore(data): scheduled ETL refresh 2026-08-07',
    );
    const tree = await git(
      fixture.originDirectory,
      'show',
      'refs/heads/data-refresh/test-run:api/static/catalogs/SP26.json',
    );
    expect(tree).toContain('refreshed');
    // Main itself is untouched.
    const mainSubject = await git(
      fixture.originDirectory,
      'log',
      '-1',
      '--format=%s',
      'refs/heads/main',
    );
    expect(mainSubject.trim()).toBe('seed');

    // The worktree's data directory is a symlink to the clone's archive.
    const linkStats = await lstat(join(fixture.worktreeDirectory, 'data'));
    expect(linkStats.isSymbolicLink()).toBe(true);
  }, 60_000);

  it('skips the PR when the report shows no material change', async () => {
    const fixture = await makeFixture();
    const steps = makeSteps(fixture, { termsChanged: 0, touchArtifact: false });

    const result = await runScheduledRefresh({
      repositoryDirectory: fixture.repositoryDirectory,
      worktreeDirectory: fixture.worktreeDirectory,
      branchName: 'data-refresh/quiet',
      artifactPaths: ['api/static/catalogs'],
      steps,
      log() {},
    });

    expect(result.status).toBe('no_changes');
    expect(steps.calls).toEqual(['install', 'refresh']);
    await expect(
      git(
        fixture.originDirectory,
        'rev-parse',
        'refs/heads/data-refresh/quiet',
      ),
    ).rejects.toThrow();
  }, 60_000);

  it('pushes nothing when the refresh itself fails, and releases the lock', async () => {
    const fixture = await makeFixture();
    const failingSteps: ScheduledRefreshSteps = {
      async installDependencies() {},
      runRefresh() {
        return Promise.reject(new Error('refresh exploded'));
      },
      createPullRequest() {
        return Promise.resolve('unreachable');
      },
    };

    await expect(
      runScheduledRefresh({
        repositoryDirectory: fixture.repositoryDirectory,
        worktreeDirectory: fixture.worktreeDirectory,
        branchName: 'data-refresh/broken',
        artifactPaths: ['api/static/catalogs'],
        steps: failingSteps,
        log() {},
      }),
    ).rejects.toThrow('refresh exploded');
    await expect(
      git(
        fixture.originDirectory,
        'rev-parse',
        'refs/heads/data-refresh/broken',
      ),
    ).rejects.toThrow();

    // The lock is released: a following run succeeds in the same worktree.
    const steps = makeSteps(fixture, { termsChanged: 1 });
    const retry = await runScheduledRefresh({
      repositoryDirectory: fixture.repositoryDirectory,
      worktreeDirectory: fixture.worktreeDirectory,
      branchName: 'data-refresh/retry',
      artifactPaths: ['api/static/catalogs'],
      steps,
      log() {},
    });
    expect(retry.status).toBe('opened');
  }, 60_000);

  it('fails loudly when the report and the git diff disagree', async () => {
    const fixture = await makeFixture();
    const steps = makeSteps(fixture, { termsChanged: 3, touchArtifact: false });

    await expect(
      runScheduledRefresh({
        repositoryDirectory: fixture.repositoryDirectory,
        worktreeDirectory: fixture.worktreeDirectory,
        branchName: 'data-refresh/inconsistent',
        artifactPaths: ['api/static/catalogs'],
        steps,
        log() {},
      }),
    ).rejects.toThrow(/no artifact file changed/u);
  }, 60_000);
});
