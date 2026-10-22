// Streaming download helper with timeout, retries, and proxy support
import fs from 'fs-extra';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import fetch from 'node-fetch';
import { ProxyAgent } from 'proxy-agent';

const DEFAULT_RETRIES = 3;
const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_BASE_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 30_000;

export interface DownloadOptions {
  retries?: number;
  timeoutMs?: number;
  baseDelayMs?: number;
  onRetry?: (retry: number, error: Error, delayMs: number) => void;
}

export interface DownloadResult {
  bytes: number;
  attempts: number;
}

class DownloadError extends Error {
  constructor(
    message: string,
    readonly status: number | undefined,
    readonly retryable: boolean,
    readonly retryAfterMs?: number
  ) {
    super(message);
    this.name = 'DownloadError';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function isRetryableError(error: Error): boolean {
  if (error instanceof DownloadError) {
    return error.retryable;
  }

  if (error.name === 'AbortError' || error.name === 'FetchError') {
    return true;
  }

  const code = (error as Error & { code?: string }).code;
  return (
    code !== undefined &&
    [
      'ECONNRESET',
      'ECONNREFUSED',
      'ETIMEDOUT',
      'EPIPE',
      'ENOTFOUND',
      'EAI_AGAIN',
    ].includes(code)
  );
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }

  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

function getRetryDelay(
  retry: number,
  error: Error,
  baseDelayMs: number
): number {
  if (error instanceof DownloadError && error.retryAfterMs !== undefined) {
    return Math.min(error.retryAfterMs, MAX_RETRY_DELAY_MS);
  }

  const jitter = 0.8 + Math.random() * 0.4;
  return Math.min(
    Math.round(baseDelayMs * 2 ** retry * jitter),
    MAX_RETRY_DELAY_MS
  );
}

async function downloadOnce(
  url: string,
  outputPath: string,
  tempPath: string,
  timeoutMs: number,
  agent: ProxyAgent
): Promise<number> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      agent,
      signal: controller.signal,
    });

    if (!response.ok) {
      (response.body as Readable | null)?.destroy();
      const retryable =
        response.status === 408 ||
        response.status === 425 ||
        response.status === 429 ||
        response.status >= 500;

      throw new DownloadError(
        `Download failed with HTTP ${response.status} ${response.statusText}`,
        response.status,
        retryable,
        parseRetryAfter(response.headers.get('retry-after'))
      );
    }

    if (!response.body) {
      throw new DownloadError(
        'Download response had no body',
        response.status,
        true
      );
    }

    const contentLengthHeader = response.headers.get('content-length');
    const contentLength = contentLengthHeader
      ? Number(contentLengthHeader)
      : undefined;
    const compressed = response.headers.get('content-encoding') !== null;
    let bytes = 0;
    const counter = new Transform({
      transform(chunk: Buffer | string, _encoding, callback) {
        bytes += Buffer.byteLength(chunk);
        callback(null, chunk);
      },
    });
    const writeStream = createWriteStream(tempPath);

    await pipeline(response.body as Readable, counter, writeStream);

    if (!compressed && contentLength !== undefined && bytes !== contentLength) {
      throw new DownloadError(
        `Incomplete download: expected ${contentLength} bytes, received ${bytes}`,
        response.status,
        true
      );
    }

    await fs.move(tempPath, outputPath, { overwrite: true });

    return bytes;
  } finally {
    clearTimeout(timer);
  }
}

export async function downloadFileWithRetry(
  url: string,
  outputPath: string,
  options: DownloadOptions = {}
): Promise<DownloadResult> {
  const retries = Math.max(0, options.retries ?? DEFAULT_RETRIES);
  const timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const baseDelayMs = Math.max(1, options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS);
  const tempPath = `${outputPath}.part`;
  const agent = new ProxyAgent();

  await fs.ensureDir(path.dirname(outputPath));
  await fs.remove(tempPath).catch(() => undefined);

  let lastError: Error | undefined;

  try {
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const bytes = await downloadOnce(
          url,
          outputPath,
          tempPath,
          timeoutMs,
          agent
        );
        return { bytes, attempts: attempt + 1 };
      } catch (error) {
        const normalized = normalizeError(error);
        lastError = normalized;
        await fs.remove(tempPath).catch(() => undefined);

        if (attempt >= retries || !isRetryableError(normalized)) {
          throw normalized;
        }

        const delayMs = getRetryDelay(attempt, normalized, baseDelayMs);
        options.onRetry?.(attempt + 1, normalized, delayMs);
        await sleep(delayMs);
      }
    }
  } finally {
    agent.destroy();
  }

  throw lastError ?? new Error(`Failed to download ${url}`);
}
