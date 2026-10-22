import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubVersionService } from '../dist/modules/version/GitHubVersionService.js';
import { VersionChecker } from '../dist/modules/version/VersionChecker.js';

function setRepos(service, repos) {
  service.octokit = { rest: { repos } };
}

test('selects the latest stable release', async () => {
  const service = new GitHubVersionService();
  setRepos(service, {
    getLatestRelease: async () => ({
      data: {
        tag_name: 'v2',
        published_at: '2026-01-01T00:00:00Z',
        draft: false,
        prerelease: false,
        assets: [{ browser_download_url: 'https://example.com/font.ttf' }],
      },
    }),
  });

  const info = await service.checkReleaseVersion('owner', 'repo');

  assert.equal(info.version, 'v2');
  assert.equal(info.downloadUrl, 'https://example.com/font.ttf');
});

test('falls back to the release list and filters prereleases', async () => {
  const service = new GitHubVersionService();
  let listCalls = 0;
  setRepos(service, {
    getLatestRelease: async () => {
      const error = new Error('not found');
      error.status = 404;
      throw error;
    },
    listReleases: async () => {
      listCalls += 1;
      return {
        data: [
          {
            tag_name: 'v3-rc',
            published_at: null,
            draft: false,
            prerelease: true,
            assets: [],
          },
          {
            tag_name: 'v2',
            published_at: '2026-01-01T00:00:00Z',
            draft: false,
            prerelease: false,
            assets: [],
          },
        ],
      };
    },
  });

  const info = await service.checkReleaseVersion('owner', 'repo');

  assert.equal(info.version, 'v2');
  assert.equal(listCalls, 1);
});

test('tracks only configured font file commits', async () => {
  const service = new GitHubVersionService();
  const seenPaths = [];
  setRepos(service, {
    listCommits: async ({ path: filePath }) => {
      seenPaths.push(filePath);
      if (filePath === 'fonts/a.ttf') {
        return {
          data: [
            {
              sha: 'aaa',
              commit: {
                committer: { date: '2026-01-01T00:00:00Z' },
                message: 'a',
              },
            },
          ],
        };
      }
      if (filePath === 'fonts/b.ttf') {
        return {
          data: [
            {
              sha: 'bbb',
              commit: {
                committer: { date: '2026-02-01T00:00:00Z' },
                message: 'b',
              },
            },
          ],
        };
      }
      throw new Error(`unexpected path: ${filePath}`);
    },
  });

  const info = await service.checkRepoCommit('owner', 'repo', [
    'master/fonts/a.ttf',
    'main/fonts/b.ttf',
  ]);

  assert.equal(info.version, 'aaa,bbb');
  assert.deepEqual(seenPaths.sort(), ['fonts/a.ttf', 'fonts/b.ttf']);
  assert.equal(info.publishedAt, '2026-02-01T00:00:00Z');
  assert.equal(info.message, 'b');
});

test('retries secondary GitHub rate limits', async () => {
  const service = new GitHubVersionService();
  let calls = 0;
  setRepos(service, {
    getLatestRelease: async () => {
      calls += 1;
      if (calls === 1) {
        const error = new Error('rate limited');
        error.status = 429;
        error.response = { headers: { 'retry-after': '0' } };
        throw error;
      }
      return {
        data: {
          tag_name: 'v2',
          published_at: null,
          draft: false,
          prerelease: false,
          assets: [],
        },
      };
    },
  });

  const info = await service.checkReleaseVersion('owner', 'repo');

  assert.equal(info.version, 'v2');
  assert.equal(calls, 2);
});

test('reports primary GitHub rate limits with reset time', async () => {
  const service = new GitHubVersionService();
  let calls = 0;
  setRepos(service, {
    getLatestRelease: async () => {
      calls += 1;
      const error = new Error('primary rate limit');
      error.status = 403;
      error.response = {
        headers: {
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
        },
      };
      throw error;
    },
  });

  await assert.rejects(
    service.checkReleaseVersion('owner', 'repo'),
    /hit the GitHub API rate limit.*reset at/
  );
  assert.equal(calls, 1);
});

test('check --force bypasses the version cache', async () => {
  const checker = new VersionChecker();
  const cache = {
    imingcp: { version: 'v1' },
    lxgwwenkaitc: { version: 'v1' },
    jetbrainsmono: { version: 'sha' },
    amstelvar: { version: 'sha' },
  };

  checker.githubService = {
    checkReleaseVersion: async () => ({ version: 'v1' }),
    checkRepoCommit: async () => ({ version: 'sha' }),
  };
  checker.cacheService = {
    loadCache: async () => cache,
    saveCache: async () => {},
    updateGitHubActionsOutput: async () => {},
  };

  const normal = await checker.run(false);
  assert.equal(normal.hasUpdates, false);
  assert.equal(normal.updatedFonts.length, 0);

  const forced = await checker.run(true);
  assert.equal(forced.hasUpdates, true);
  assert.equal(forced.updatedFonts.length, 4);
  assert.ok(
    forced.updatedFonts.every((font) => font.oldVersion === 'none'),
    'forced updates should all have oldVersion "none"'
  );
});
