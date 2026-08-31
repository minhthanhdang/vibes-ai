import "server-only";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const SCHEME = "scrypt";
const COST = 16384;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;
const KEY_LENGTH = 32;
const MAX_MEMORY = 64 * 1024 * 1024;

type ScryptParams = { cost: number; blockSize: number; parallelism: number; keyLength: number };

function derive(plain: string, salt: Buffer, params: ScryptParams): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      plain,
      salt,
      params.keyLength,
      {
        N: params.cost,
        r: params.blockSize,
        p: params.parallelism,
        maxmem: MAX_MEMORY,
      },
      (cause, key) => (cause ? reject(cause) : resolve(key)),
    );
  });
}

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const params = {
    cost: COST,
    blockSize: BLOCK_SIZE,
    parallelism: PARALLELISM,
    keyLength: KEY_LENGTH,
  };
  const key = await derive(plain, salt, params);
  return [
    SCHEME,
    params.cost,
    params.blockSize,
    params.parallelism,
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
}

function positiveInt(raw: string): number | null {
  if (!/^[1-9][0-9]{0,7}$/.test(raw)) return null;
  return Number(raw);
}

function parsed(stored: string): { params: ScryptParams; salt: Buffer; key: Buffer } | null {
  const segments = stored.split("$");
  if (segments.length !== 6) return null;
  const [scheme, cost, blockSize, parallelism, salt, key] = segments;
  if (scheme !== SCHEME) return null;

  const numbers = [cost, blockSize, parallelism].map(positiveInt);
  if (numbers.some((value) => value === null)) return null;

  const saltBytes = Buffer.from(salt, "base64url");
  const keyBytes = Buffer.from(key, "base64url");
  if (saltBytes.length === 0 || keyBytes.length === 0) return null;
  if (saltBytes.toString("base64url") !== salt || keyBytes.toString("base64url") !== key) {
    return null;
  }

  return {
    params: {
      cost: numbers[0]!,
      blockSize: numbers[1]!,
      parallelism: numbers[2]!,
      keyLength: keyBytes.length,
    },
    salt: saltBytes,
    key: keyBytes,
  };
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const held = parsed(stored);
  if (!held) return false;

  try {
    const candidate = await derive(plain, held.salt, held.params);
    return candidate.length === held.key.length && timingSafeEqual(candidate, held.key);
  } catch {
    return false;
  }
}

let dummy: Promise<string> | undefined;

export function dummyPasswordHash(): Promise<string> {
  dummy ??= hashPassword(randomBytes(32).toString("base64url"));
  return dummy;
}
