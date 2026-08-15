import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

import type { HostedDeploymentContract } from './productionContract.js';
import { stagingContract } from './stagingContract.js';
import type { TermArchiveStore } from './termArchivePublisher.js';

const r2RequestTimeoutMs = 20_000;
const r2RequestMaxAttempts = 3;
const r2RequestRetryDelayMs = 250;

type R2RequestRetryOptions = {
  attemptTimeoutMs?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
};

class R2RequestTimeoutError extends Error {
  constructor(operation: string, cause?: unknown) {
    super(`R2 ${operation} timed out`, { cause });
    this.name = 'R2RequestTimeoutError';
  }
}

export async function withR2RequestTimeout<T>(
  operation: string,
  request: (signal: AbortSignal) => Promise<T>,
  timeoutMs = r2RequestTimeoutMs,
) {
  const controller = new AbortController();
  const timeoutError = new R2RequestTimeoutError(operation);
  let timeout: ReturnType<typeof setTimeout> | undefined = undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(timeoutError);
    }, timeoutMs);
  });

  try {
    return await Promise.race([request(controller.signal), deadline]);
  } catch (error) {
    if (
      error === timeoutError ||
      (error instanceof Error &&
        (error.name === 'AbortError' || error.name === 'TimeoutError'))
    )
      throw new R2RequestTimeoutError(operation, error);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function withR2RequestRetries<T>(
  operation: string,
  request: (signal: AbortSignal) => Promise<T>,
  options: R2RequestRetryOptions = {},
) {
  const attemptTimeoutMs = options.attemptTimeoutMs ?? r2RequestTimeoutMs;
  const maxAttempts = options.maxAttempts ?? r2RequestMaxAttempts;
  const retryDelayMs = options.retryDelayMs ?? r2RequestRetryDelayMs;
  if (!Number.isFinite(attemptTimeoutMs) || attemptTimeoutMs <= 0)
    throw new Error('R2 attempt timeout must be positive');
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1)
    throw new Error('R2 max attempts must be a positive integer');
  if (!Number.isFinite(retryDelayMs) || retryDelayMs < 0)
    throw new Error('R2 retry delay must not be negative');

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await withR2RequestTimeout(operation, request, attemptTimeoutMs);
    } catch (error) {
      if (!(error instanceof R2RequestTimeoutError) || attempt === maxAttempts)
        throw error;
      console.warn(
        JSON.stringify({
          operation: 'r2-request-retry',
          request: operation,
          attempt,
          maxAttempts,
          reason: 'timeout',
        }),
      );
      const exponentialDelay = retryDelayMs * 2 ** (attempt - 1);
      const jitter = Math.floor(Math.random() * exponentialDelay);
      await new Promise((resolve) => {
        setTimeout(resolve, exponentialDelay + jitter);
      });
    }
  }
  throw new Error('R2 request retry loop ended unexpectedly');
}

export function createR2CatalogStore(
  environment: { [key: string]: string | undefined } = process.env,
  contract: HostedDeploymentContract = stagingContract,
) {
  const accountId = required(environment, 'CLOUDFLARE_ACCOUNT_ID');
  const bucket = required(environment, 'R2_CATALOG_BUCKET');
  if (bucket !== contract.bucket)
    throw new Error(`Unexpected ${contract.target} Catalog bucket`);
  const client = new S3Client({
    credentials: {
      accessKeyId: required(environment, 'R2_CATALOG_ACCESS_KEY_ID'),
      secretAccessKey: required(environment, 'R2_CATALOG_SECRET_ACCESS_KEY'),
    },
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    region: 'auto',
  });

  const store: TermArchiveStore = {
    async get(key) {
      try {
        return await withR2RequestRetries(`GET ${key}`, async (abortSignal) => {
          const result = await client.send(
            new GetObjectCommand({ Bucket: bucket, Key: key }),
            { abortSignal },
          );
          const body = await result.Body?.transformToByteArray();
          return body ? Uint8Array.from(body) : null;
        });
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },
    async put(key, body, options) {
      await withR2RequestRetries(`PUT ${key}`, (abortSignal) =>
        client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: body,
            CacheControl: options.cacheControl,
            ContentType: options.contentType,
            Metadata: options.metadata,
            StorageClass: options.storageClass,
          }),
          { abortSignal },
        ),
      );
    },
    async delete(key) {
      await withR2RequestRetries(`DELETE ${key}`, (abortSignal) =>
        client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), {
          abortSignal,
        }),
      );
    },
  };
  return store;
}

function required(
  environment: { [key: string]: string | undefined },
  name: string,
) {
  const value = environment[name];
  if (!value) throw new Error(`Missing hosted deployment input: ${name}`);
  return value;
}

function isNotFound(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as {
    name?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    candidate.name === 'NoSuchKey' ||
    candidate.$metadata?.httpStatusCode === 404
  );
}
