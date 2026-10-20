import { buildKeyring, type Keyring } from "./crypto";
import { getEnv } from "./env";

let ring: Keyring | undefined;

export function getKeyring(): Keyring {
  if (!ring) {
    const env = getEnv();
    ring = buildKeyring(env.MASTER_KEY_ID, env.MASTER_KEY, env.MASTER_KEYS_PREVIOUS);
  }
  return ring;
}
