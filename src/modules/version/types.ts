// Version module specific types
export interface VersionInfo {
  version: string;
  publishedAt: string | null;
  downloadUrl?: string | null;
  message?: string;
}

export interface GitHubRelease {
  tag_name: string;
  published_at: string | null;
  draft?: boolean;
  prerelease?: boolean;
  assets: Array<{
    browser_download_url?: string;
  }>;
}

export interface GitHubCommit {
  sha: string;
  commit: {
    committer: {
      date: string | null;
    };
    message: string;
  };
}
