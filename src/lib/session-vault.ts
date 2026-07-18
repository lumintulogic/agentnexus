export type EncryptedSessionSecret = {
  tokenRef: string;
  algorithm: "AES-GCM";
  iv: string;
  ciphertext: string;
  createdAt: string;
};

let vaultKeyPromise: Promise<CryptoKey> | null = null;

function encodeBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const decoded = atob(value);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }
  return bytes;
}

function getVaultKey(): Promise<CryptoKey> {
  vaultKeyPromise ??= crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  return vaultKeyPromise;
}

export function readEncryptedSessionSecrets(storageKey: string): Record<string, EncryptedSessionSecret> {
  const stored = sessionStorage.getItem(storageKey);
  if (!stored) return {};

  try {
    return JSON.parse(stored) as Record<string, EncryptedSessionSecret>;
  } catch {
    sessionStorage.removeItem(storageKey);
    return {};
  }
}

export async function sealSessionSecret(
  storageKey: string,
  tokenRef: string,
  secret: string
): Promise<EncryptedSessionSecret> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(secret);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await getVaultKey(), plaintext);
  const record: EncryptedSessionSecret = {
    tokenRef,
    algorithm: "AES-GCM",
    iv: encodeBase64(iv),
    ciphertext: encodeBase64(new Uint8Array(ciphertext)),
    createdAt: new Date().toISOString()
  };
  const records = readEncryptedSessionSecrets(storageKey);
  sessionStorage.setItem(storageKey, JSON.stringify({ ...records, [tokenRef]: record }));
  return record;
}

export async function openSessionSecret(record: EncryptedSessionSecret): Promise<string> {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: decodeBase64(record.iv) },
    await getVaultKey(),
    decodeBase64(record.ciphertext)
  );
  return new TextDecoder().decode(plaintext);
}

export function removeSessionSecret(storageKey: string, tokenRef: string): void {
  const { [tokenRef]: _removed, ...rest } = readEncryptedSessionSecrets(storageKey);
  if (Object.keys(rest).length) {
    sessionStorage.setItem(storageKey, JSON.stringify(rest));
  } else {
    sessionStorage.removeItem(storageKey);
  }
}
