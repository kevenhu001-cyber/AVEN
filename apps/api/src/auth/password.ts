import { hash, verify } from '@node-rs/argon2';

const options = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

const dummyHashPromise = hash('aven-dummy-password-not-used-anywhere', options);

export async function hashPassword(password: string): Promise<string> {
  return hash(password, options);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/** Keeps unknown-email login timing closer to a real password check. */
export async function verifyDummyPassword(password: string): Promise<void> {
  await verifyPassword(await dummyHashPromise, password);
}
