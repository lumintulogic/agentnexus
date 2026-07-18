import { marketplaceServers, type AuthMode, type MarketplaceServer, type ServerStatus } from "@/data/registry";

type DirectusItemResponse<T> = {
  data: T;
};

type DirectusListResponse<T> = {
  data: T[];
};

type DirectusUser = {
  id: string;
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
};

type DirectusMcpServer = {
  id: string;
  name?: string | null;
  vendor?: string | null;
  category?: string | null;
  transport?: string | null;
  auth_mode?: string | null;
  status?: string | null;
  endpoint_url?: string | null;
  description?: string | null;
  tool_schema?: unknown;
};

export type DirectusAuthSession = {
  name: string;
  email: string;
  method: string;
  accessToken: string;
  directusUserId?: string;
  profileId?: string;
};

type DirectusUserProfile = {
  id: string;
  email?: string | null;
};

export type DirectusWriteResult = {
  ok: boolean;
  detail: string;
};

const directusUrl = (import.meta.env.PUBLIC_DIRECTUS_URL ?? "http://localhost:8055").replace(/\/$/, "");
const keycloakProvider = import.meta.env.PUBLIC_DIRECTUS_KEYCLOAK_PROVIDER ?? "keycloak";

function isServerStatus(value: string | null | undefined): value is ServerStatus {
  return value === "active" || value === "installed" || value === "available";
}

function mapTransport(value: string | null | undefined): MarketplaceServer["transport"] {
  if (value === "websocket" || value === "WebSocket") return "WebSocket";
  if (value === "local_bridge" || value === "Local bridge") return "Local bridge";
  return "HTTP/SSE";
}

function mapAuthMode(value: string | null | undefined): AuthMode {
  if (value === "oauth" || value === "bearer") return value;
  return "none";
}

function toolNamesFromSchema(schema: unknown): string[] {
  if (!Array.isArray(schema)) return [];

  return schema
    .map((tool) => {
      if (typeof tool === "string") return tool;
      if (tool && typeof tool === "object" && "name" in tool && typeof tool.name === "string") return tool.name;
      return null;
    })
    .filter((toolName): toolName is string => Boolean(toolName));
}

export function buildDirectusKeycloakLoginUrl(redirectUrl: string): string {
  const url = new URL(`/auth/login/${keycloakProvider}`, directusUrl);
  url.searchParams.set("redirect", redirectUrl);
  return url.toString();
}

export function readDirectusAccessToken(search: string): string | null {
  const params = new URLSearchParams(search);
  return params.get("access_token") ?? params.get("directus_access_token") ?? params.get("token") ?? null;
}

export async function loadDirectusAuthSession(accessToken: string): Promise<DirectusAuthSession> {
  const response = await fetch(`${directusUrl}/users/me?fields=id,email,first_name,last_name`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    throw new Error(`Directus user lookup failed with ${response.status}.`);
  }

  const payload = (await response.json()) as DirectusItemResponse<DirectusUser>;
  const firstName = payload.data.first_name?.trim();
  const lastName = payload.data.last_name?.trim();
  const name = [firstName, lastName].filter(Boolean).join(" ") || payload.data.email?.split("@")[0] || "Directus User";

  const session = {
    name,
    email: payload.data.email ?? "directus-user@agentnexus.local",
    method: "Keycloak via Directus",
    accessToken,
    directusUserId: payload.data.id
  };

  return {
    ...session,
    profileId: await ensureAgentNexusProfile(accessToken, session).catch(() => undefined)
  };
}

export async function loadDirectusMarketplaceServers(): Promise<MarketplaceServer[]> {
  const fields = [
    "id",
    "name",
    "vendor",
    "category",
    "transport",
    "auth_mode",
    "status",
    "endpoint_url",
    "description",
    "tool_schema"
  ].join(",");
  const response = await fetch(
    `${directusUrl}/items/anx_mcp_servers?limit=-1&fields=${fields}&filter[visibility][_eq]=public`,
    { headers: { Accept: "application/json" } }
  );

  if (!response.ok) {
    throw new Error(`Directus marketplace lookup failed with ${response.status}.`);
  }

  const payload = (await response.json()) as DirectusListResponse<DirectusMcpServer>;
  const servers = payload.data.map((server) => {
    const staticFallback = marketplaceServers.find((item) => item.endpoint === server.endpoint_url);
    const tools = toolNamesFromSchema(server.tool_schema);

    return {
      id: server.id,
      name: server.name ?? staticFallback?.name ?? "Untitled MCP Server",
      vendor: server.vendor ?? staticFallback?.vendor ?? "Unknown vendor",
      category: server.category ?? staticFallback?.category ?? "General",
      transport: mapTransport(server.transport),
      authMode: mapAuthMode(server.auth_mode),
      status: isServerStatus(server.status) ? server.status : (staticFallback?.status ?? "available"),
      endpoint: server.endpoint_url ?? staticFallback?.endpoint ?? "",
      description: server.description ?? staticFallback?.description ?? "No description supplied.",
      tools: tools.length ? tools : (staticFallback?.tools ?? [])
    };
  });

  return servers.length ? servers : marketplaceServers;
}

async function directusJson<T>(pathname: string, options: RequestInit = {}, accessToken?: string): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  if (options.body) headers.set("Content-Type", "application/json");

  const response = await fetch(`${directusUrl}${pathname}`, { ...options, headers });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(`${pathname} failed with ${response.status}.`);
  }

  return payload as T;
}

async function ensureAgentNexusProfile(
  accessToken: string,
  session: Omit<DirectusAuthSession, "profileId">
): Promise<string> {
  const email = encodeURIComponent(session.email);
  const existing = await directusJson<DirectusListResponse<DirectusUserProfile>>(
    `/items/anx_user_profiles?limit=1&fields=id,email&filter[email][_eq]=${email}`,
    {},
    accessToken
  );

  if (existing.data[0]?.id) return existing.data[0].id;

  const created = await directusJson<DirectusItemResponse<DirectusUserProfile>>(
    "/items/anx_user_profiles",
    {
      method: "POST",
      body: JSON.stringify({
        email: session.email,
        display_name: session.name,
        email_verified: true,
        keycloak_subject: session.directusUserId,
        upstream_provider: "keycloak",
        plan: "personal",
        status: "active",
        metadata: { source: "directus-auth-callback" }
      })
    },
    accessToken
  );

  return created.data.id;
}

export async function persistDirectusServerInstall(input: {
  accessToken?: string;
  profileId?: string;
  serverId: string;
  status: ServerStatus;
  lastToolSchema?: unknown;
}): Promise<DirectusWriteResult> {
  if (!input.accessToken || !input.profileId) {
    return { ok: false, detail: "Using session-only install state" };
  }

  const profileId = encodeURIComponent(input.profileId);
  const serverId = encodeURIComponent(input.serverId);
  const existing = await directusJson<DirectusListResponse<{ id: string }>>(
    `/items/anx_user_mcp_installs?limit=1&fields=id&filter[profile][_eq]=${profileId}&filter[server][_eq]=${serverId}`,
    {},
    input.accessToken
  );
  const body = {
    profile: input.profileId,
    server: input.serverId,
    status: input.status,
    installed_at: new Date().toISOString(),
    last_handshake_at: new Date().toISOString(),
    last_tool_schema: input.lastToolSchema ?? null
  };

  if (existing.data[0]?.id) {
    await directusJson(
      `/items/anx_user_mcp_installs/${existing.data[0].id}`,
      { method: "PATCH", body: JSON.stringify(body) },
      input.accessToken
    );
  } else {
    await directusJson("/items/anx_user_mcp_installs", { method: "POST", body: JSON.stringify(body) }, input.accessToken);
  }

  return { ok: true, detail: "Install state synced to Directus" };
}

export async function persistDirectusModelConnection(input: {
  accessToken?: string;
  profileId?: string;
  provider: string;
  modelId: string;
  endpointUrl?: string | null;
  tokenRef?: string | null;
}): Promise<DirectusWriteResult> {
  if (!input.accessToken || !input.profileId) {
    return { ok: false, detail: "Using session-only model connection" };
  }

  const profileId = encodeURIComponent(input.profileId);
  const provider = encodeURIComponent(input.provider);
  const existing = await directusJson<DirectusListResponse<{ id: string }>>(
    `/items/anx_model_connections?limit=1&fields=id&filter[profile][_eq]=${profileId}&filter[provider][_eq]=${provider}`,
    {},
    input.accessToken
  );
  const body = {
    profile: input.profileId,
    provider: input.provider,
    model_id: input.modelId,
    endpoint_url: input.endpointUrl ?? null,
    token_ref: input.tokenRef ?? null,
    status: "connected",
    metadata: { source: "agentnexus-browser-prototype" }
  };

  if (existing.data[0]?.id) {
    await directusJson(
      `/items/anx_model_connections/${existing.data[0].id}`,
      { method: "PATCH", body: JSON.stringify(body) },
      input.accessToken
    );
  } else {
    await directusJson("/items/anx_model_connections", { method: "POST", body: JSON.stringify(body) }, input.accessToken);
  }

  return { ok: true, detail: "Model connection synced to Directus" };
}
