type TenantClaimInput = {
  tenant_id?: string | null;
  app_id?: string | null;
  app_url?: string | null;
  role_id?: string | null;
  role_name?: string | null;
};

type AuthorizationCodePayload = TenantClaimInput & {
  client_id: string;
  redirect_uri: string;
  scope: string;
  sub: string;
  email: string;
  name: string;
};

const keyId = "agentnexus-prototype-rs256";
let signingKeyPair: Promise<CryptoKeyPair> | null = null;

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlJson(value: unknown): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function decodeBase64UrlJson<T>(value: string): T {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const decoded = atob(padded);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

async function getSigningKeyPair(): Promise<CryptoKeyPair> {
  signingKeyPair ??= crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256"
    },
    true,
    ["sign", "verify"]
  );
  return signingKeyPair;
}

function tenantClaims(input: TenantClaimInput): Record<string, string> {
  return Object.fromEntries(
    Object.entries(input).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0)
  );
}

export function issuerFromRequest(request: Request): string {
  return import.meta.env.PUBLIC_AGENTNEXUS_ISSUER?.replace(/\/$/, "") ?? new URL(request.url).origin;
}

export function oidcDiscovery(issuer: string) {
  return {
    issuer,
    authorization_endpoint: `${issuer}/oidc/authorize`,
    token_endpoint: `${issuer}/oidc/token`,
    userinfo_endpoint: `${issuer}/oidc/userinfo`,
    jwks_uri: `${issuer}/oidc/jwks.json`,
    registration_endpoint: `${issuer}/oidc/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "none"],
    scopes_supported: ["openid", "profile", "email", "offline_access", "agentnexus.enterprise"],
    claims_supported: [
      "sub",
      "email",
      "name",
      "email_verified",
      "tenant_id",
      "app_id",
      "app_url",
      "role_id",
      "role_name"
    ]
  };
}

export async function jwks() {
  const { publicKey } = await getSigningKeyPair();
  const jwk = await crypto.subtle.exportKey("jwk", publicKey);
  return {
    keys: [
      {
        ...jwk,
        kid: keyId,
        use: "sig",
        alg: "RS256"
      }
    ]
  };
}

export function createAuthorizationCode(url: URL): string {
  const email = url.searchParams.get("login_hint") || "common-user@agentnexus.local";
  const name = url.searchParams.get("name") || email.split("@")[0] || "AgentNexus User";
  const payload: AuthorizationCodePayload = {
    client_id: url.searchParams.get("client_id") || "prototype-client",
    redirect_uri: url.searchParams.get("redirect_uri") || "",
    scope: url.searchParams.get("scope") || "openid profile email",
    sub: `user:${email}`,
    email,
    name,
    tenant_id: url.searchParams.get("tenant_id"),
    app_id: url.searchParams.get("app_id"),
    app_url: url.searchParams.get("app_url"),
    role_id: url.searchParams.get("role_id"),
    role_name: url.searchParams.get("role_name")
  };
  return `prototype.${base64UrlJson(payload)}`;
}

export function decodeAuthorizationCode(code: string): AuthorizationCodePayload {
  const [, payload] = code.split(".");
  if (!payload) throw new Error("Invalid authorization code.");
  return decodeBase64UrlJson<AuthorizationCodePayload>(payload);
}

export async function signJwt(claims: Record<string, unknown>): Promise<string> {
  const header = { alg: "RS256", typ: "JWT", kid: keyId };
  const signingInput = `${base64UrlJson(header)}.${base64UrlJson(claims)}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    (await getSigningKeyPair()).privateKey,
    new TextEncoder().encode(signingInput)
  );
  return `${signingInput}.${base64Url(new Uint8Array(signature))}`;
}

export async function issueTokenSet(input: {
  issuer: string;
  code: string;
  clientId?: string | null;
  redirectUri?: string | null;
}) {
  const codePayload = decodeAuthorizationCode(input.code);
  const now = Math.floor(Date.now() / 1000);
  const audience = input.clientId || codePayload.client_id;
  const baseClaims = {
    iss: input.issuer,
    aud: audience,
    iat: now,
    exp: now + 3600,
    sub: codePayload.sub,
    email: codePayload.email,
    name: codePayload.name,
    email_verified: true,
    scope: codePayload.scope,
    ...tenantClaims(codePayload)
  };

  return {
    access_token: await signJwt({ ...baseClaims, token_use: "access" }),
    id_token: await signJwt({ ...baseClaims, token_use: "id" }),
    token_type: "Bearer",
    expires_in: 3600,
    scope: codePayload.scope
  };
}

export function decodeJwtPayload(token: string): Record<string, unknown> {
  const [, payload] = token.split(".");
  if (!payload) throw new Error("Invalid bearer token.");
  return decodeBase64UrlJson<Record<string, unknown>>(payload);
}

export function registeredClient(body: Record<string, unknown>) {
  const appUrl = Array.isArray(body.redirect_uris) && typeof body.redirect_uris[0] === "string"
    ? new URL(body.redirect_uris[0]).origin
    : "https://client.example";

  return {
    client_id: `anx_${crypto.randomUUID()}`,
    client_secret: `secret_${crypto.randomUUID()}`,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    grant_types: ["authorization_code"],
    response_types: ["code"],
    redirect_uris: body.redirect_uris ?? [],
    scope: body.scope ?? "openid profile email",
    application_type: body.application_type ?? "web",
    client_name: body.client_name ?? "AgentNexus MCP App",
    app_url: body.app_url ?? appUrl
  };
}
