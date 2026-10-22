// Version checking interface
import type { VersionCheckResult } from '@/types/index.js';

export interface IVersionChecker {
  run(force?: boolean): Promise<VersionCheckResult>;
  checkSpecific(
    fontIds: string[],
    force?: boolean
  ): Promise<VersionCheckResult>;
  updateCache(versions: Record<string, string>): Promise<void>;
  getCurrentVersions(): Promise<Record<string, string>>;
}
