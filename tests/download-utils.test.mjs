import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { downloadFileWithRetry } from '../dist/utils/DownloadUtils.js';

const payload = Buffer.from('font-download-test-payload'.repeat(32));
const payloadHash = createHash('sha256').update(payload).digest('hex');

const proxyEnvKeys = [
  'HTTP_PROXY',
  'http_proxy',
  'HTTPS_PROXY',
  'https_proxy',
  'ALL_PROXY',
  'all_proxy',
  'NO_PROXY',
  'no_proxy',
];

for (const key of proxyEnvKeys) {
  delete process.env[key];
}

async function makeTempDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fonts-download-utils-'));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  return dir;
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

async function closeServer(server) {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(() => resolve()));
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function assertPayload(filePath) {
  const data = await fs.readFile(filePath);
  const hash = createHash('sha256').update(data).digest('hex');
  assert.equal(hash, payloadHash, 'downloaded content mismatch');
}

test('downloads a file successfully', async (t) => {
  const dir = await makeTempDir(t);
  let requests = 0;
  const server = http.createServer((_request, response) => {
    requests += 1;
    response.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': payload.length,
    });
    response.end(payload);
  });
  t.after(() => closeServer(server));
  const port = await listen(server);
  const outputPath = path.join(dir, 'font.bin');

  const result = await downloadFileWithRetry(
    `http://127.0.0.1:${port}/font.bin`,
    outputPath,
    { retries: 0, timeoutMs: 5000 }
  );

  assert.equal(result.attempts, 1);
  assert.equal(requests, 1);
  await assertPayload(outputPath);
  assert.equal(await pathExists(`${outputPath}.part`), false);
});

test('retries transient HTTP failures', async (t) => {
  const dir = await makeTempDir(t);
  let failures = 2;
  let requests = 0;
  const server = http.createServer((_request, response) => {
    requests += 1;
    if (failures > 0) {
      failures -= 1;
      response.writeHead(500);
      response.end('temporary failure');
      return;
    }
    response.writeHead(200, {
      'Content-Length': payload.length,
    });
    response.end(payload);
  });
  t.after(() => closeServer(server));
  const port = await listen(server);
  const outputPath = path.join(dir, 'font.bin');
  const retryEvents = [];

  const result = await downloadFileWithRetry(
    `http://127.0.0.1:${port}/font.bin`,
    outputPath,
    {
      retries: 3,
      timeoutMs: 5000,
      baseDelayMs: 5,
      onRetry: (retry, _error, delayMs) => retryEvents.push({ retry, delayMs }),
    }
  );

  assert.equal(result.attempts, 3);
  assert.equal(requests, 3);
  assert.equal(retryEvents.length, 2);
  await assertPayload(outputPath);
});

test('does not retry non-retryable HTTP errors', async (t) => {
  const dir = await makeTempDir(t);
  let requests = 0;
  const server = http.createServer((_request, response) => {
    requests += 1;
    response.writeHead(404);
    response.end('missing');
  });
  t.after(() => closeServer(server));
  const port = await listen(server);
  const outputPath = path.join(dir, 'font.bin');

  await assert.rejects(
    downloadFileWithRetry(`http://127.0.0.1:${port}/font.bin`, outputPath, {
      retries: 3,
      timeoutMs: 5000,
      baseDelayMs: 5,
    }),
    /HTTP 404/
  );

  assert.equal(requests, 1);
  assert.equal(await pathExists(outputPath), false);
  assert.equal(await pathExists(`${outputPath}.part`), false);
});

test('times out and removes the partial file', async (t) => {
  const dir = await makeTempDir(t);
  const server = http.createServer((_request, response) => {
    setTimeout(() => {
      if (!response.destroyed) {
        response.writeHead(200, { 'Content-Length': payload.length });
        response.end(payload);
      }
    }, 200);
  });
  t.after(() => closeServer(server));
  const port = await listen(server);
  const outputPath = path.join(dir, 'font.bin');

  await assert.rejects(
    downloadFileWithRetry(`http://127.0.0.1:${port}/font.bin`, outputPath, {
      retries: 0,
      timeoutMs: 30,
    })
  );

  assert.equal(await pathExists(outputPath), false);
  assert.equal(await pathExists(`${outputPath}.part`), false);
});

test('routes downloads through HTTP_PROXY', async (t) => {
  const dir = await makeTempDir(t);
  let targetRequests = 0;
  const targetServer = http.createServer((_request, response) => {
    targetRequests += 1;
    response.writeHead(200, { 'Content-Length': payload.length });
    response.end(payload);
  });
  t.after(() => closeServer(targetServer));
  const targetPort = await listen(targetServer);

  let proxyRequests = 0;
  const proxyServer = http.createServer((request, response) => {
    proxyRequests += 1;
    const target = new URL(
      request.url ?? '/',
      `http://127.0.0.1:${targetPort}`
    );
    const proxyRequest = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method: request.method,
        headers: request.headers,
      },
      (proxyResponse) => {
        response.writeHead(
          proxyResponse.statusCode ?? 502,
          proxyResponse.headers
        );
        proxyResponse.pipe(response);
      }
    );
    proxyRequest.on('error', (error) => {
      if (!response.headersSent) {
        response.writeHead(502);
      }
      response.end(error.message);
    });
    request.pipe(proxyRequest);
  });
  t.after(() => closeServer(proxyServer));
  const proxyPort = await listen(proxyServer);

  const savedEnv = {};
  for (const key of proxyEnvKeys) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  process.env.HTTP_PROXY = `http://127.0.0.1:${proxyPort}`;
  process.env.http_proxy = `http://127.0.0.1:${proxyPort}`;

  const outputPath = path.join(dir, 'font.bin');

  try {
    await downloadFileWithRetry(
      `http://127.0.0.1:${targetPort}/font.bin`,
      outputPath,
      { retries: 0, timeoutMs: 5000 }
    );
  } finally {
    for (const key of proxyEnvKeys) {
      delete process.env[key];
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key];
      }
    }
  }

  assert.ok(proxyRequests > 0, 'request did not go through the proxy');
  assert.ok(targetRequests > 0, 'target never received the request');
  await assertPayload(outputPath);
});
