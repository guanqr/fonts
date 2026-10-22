// GitHub API service for version checking
import { Octokit } from '@octokit/rest';
import { BaseService } from '@/core/base/BaseService.js';
import type {
  VersionInfo,
  GitHubRelease,
  GitHubCommit,
} from '@/modules/version/types.js';

interface GitHubRequestError extends Error {
  status?: number;
  response?: {
    headers?: Record<string, string | number | undefined>;
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class GitHubVersionService extends BaseService {
  private octokit: Octokit;

  constructor() {
    super('GitHubVersionService');
    this.octokit = new Octokit({
      auth: process.env.GITHUB_TOKEN,
    });
  }

  async checkReleaseVersion(owner: string, repo: string): Promise<VersionInfo> {
    return this.executeWithErrorHandling(async () => {
      this.log(`Checking latest release for ${owner}/${repo}...`);

      let latestRelease: GitHubRelease;

      try {
        const { data } = await this.withRateLimitRetry(
          `get latest release for ${owner}/${repo}`,
          () => this.octokit.rest.repos.getLatestRelease({ owner, repo })
        );
        latestRelease = data as GitHubRelease;
      } catch (error) {
        const status = (error as GitHubRequestError).status;
        if (status !== 404) {
          throw error;
        }

        this.log(
          `No latest release for ${owner}/${repo}; checking release list`,
          'debug'
        );

        const { data: releases } = await this.withRateLimitRetry(
          `list releases for ${owner}/${repo}`,
          () =>
            this.octokit.rest.repos.listReleases({
              owner,
              repo,
              per_page: 10,
            })
        );
        const stableRelease = (releases as GitHubRelease[]).find(
          (release) => !release.draft && !release.prerelease
        );

        if (!stableRelease) {
          throw new Error(`No stable releases found for ${owner}/${repo}`, {
            cause: error,
          });
        }

        latestRelease = stableRelease;
      }

      return {
        version: latestRelease.tag_name,
        publishedAt: latestRelease.published_at,
        downloadUrl: latestRelease.assets[0]?.browser_download_url ?? null,
      };
    }, `check release version for ${owner}/${repo}`);
  }

  async checkRepoCommit(
    owner: string,
    repo: string,
    filePaths: string[] = []
  ): Promise<VersionInfo> {
    return this.executeWithErrorHandling(async () => {
      const repoPaths = filePaths
        .map((filePath) => this.normalizeRepoPath(filePath))
        .filter((filePath) => filePath.length > 0);

      this.log(
        `Checking latest commit for ${owner}/${repo}${
          repoPaths.length > 0 ? ` (${repoPaths.length} font file(s))` : ''
        }...`
      );

      const commits =
        repoPaths.length > 0
          ? await Promise.all(
              repoPaths.map((filePath) =>
                this.getLatestCommit(owner, repo, filePath)
              )
            )
          : [await this.getLatestCommit(owner, repo)];

      const newestCommit = [...commits].sort((a, b) =>
        (b.commit.committer.date ?? '').localeCompare(
          a.commit.committer.date ?? ''
        )
      )[0];

      return {
        version: commits.map((commit) => commit.sha).join(','),
        publishedAt: newestCommit.commit.committer.date,
        message: newestCommit.commit.message,
      };
    }, `check commit for ${owner}/${repo}`);
  }

  async getContentFromBranch(
    owner: string,
    repo: string,
    path: string,
    ref: string
  ): Promise<string> {
    return this.executeWithErrorHandling(async () => {
      const { data } = await this.withRateLimitRetry(
        `get content from ${owner}/${repo}:${ref}/${path}`,
        () => this.octokit.rest.repos.getContent({ owner, repo, path, ref })
      );

      if ('content' in data && data.content) {
        return Buffer.from(data.content, 'base64').toString('utf-8');
      }

      throw new Error('Content not found or not accessible');
    }, `get content from ${owner}/${repo}:${ref}/${path}`);
  }

  private async getLatestCommit(
    owner: string,
    repo: string,
    filePath?: string
  ): Promise<GitHubCommit> {
    const { data: commits } = await this.withRateLimitRetry(
      `list commits for ${owner}/${repo}${filePath ? `:${filePath}` : ''}`,
      () =>
        this.octokit.rest.repos.listCommits({
          owner,
          repo,
          per_page: 1,
          ...(filePath ? { path: filePath } : {}),
        })
    );

    if (commits.length === 0) {
      throw new Error(
        `No commits found for ${owner}/${repo}${
          filePath ? `:${filePath}` : ''
        }`
      );
    }

    return commits[0] as GitHubCommit;
  }

  private normalizeRepoPath(filePath: string): string {
    const normalized = filePath.replace(/\\/g, '/').replace(/^\/+/, '');
    const segments = normalized.split('/');

    if (
      (segments[0] === 'main' || segments[0] === 'master') &&
      segments.length > 1
    ) {
      return segments.slice(1).join('/');
    }

    return normalized;
  }

  private async withRateLimitRetry<T>(
    operationName: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const maxRetries = 2;

    for (let attempt = 0; ; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        const requestError = error as GitHubRequestError;
        const status = requestError.status;
        const headers = requestError.response?.headers ?? {};
        const retryAfter = headers['retry-after'];
        const remaining = headers['x-ratelimit-remaining'];
        const reset = headers['x-ratelimit-reset'];
        const hasRetryAfter = retryAfter !== undefined;
        const isRateLimit =
          status === 429 ||
          (status === 403 && (hasRetryAfter || String(remaining) === '0'));

        if (!isRateLimit) {
          throw error;
        }

        const resetSeconds = reset !== undefined ? Number(reset) : NaN;
        const resetTime = Number.isFinite(resetSeconds)
          ? new Date(resetSeconds * 1000).toISOString()
          : undefined;

        if (!hasRetryAfter && String(remaining) === '0') {
          throw new Error(
            `${operationName} hit the GitHub API rate limit${
              resetTime ? `; reset at ${resetTime}` : ''
            }`,
            { cause: error }
          );
        }

        if (attempt >= maxRetries) {
          throw new Error(
            `${operationName} was rate limited${
              resetTime ? `; reset at ${resetTime}` : ''
            }`,
            { cause: error }
          );
        }

        const retryAfterSeconds = Number(retryAfter);
        const delayMs = Number.isFinite(retryAfterSeconds)
          ? Math.min(Math.max(0, retryAfterSeconds * 1000), 30000)
          : Math.min(1000 * 2 ** attempt, 30000);

        this.log(
          `⚠️ ${operationName} rate limited; retrying in ${delayMs}ms`,
          'warn'
        );
        await delay(delayMs);
      }
    }
  }
}
