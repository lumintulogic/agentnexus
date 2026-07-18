import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const serviceDir = path.dirname(new URL(import.meta.url).pathname);
const env = readEnv(path.join(serviceDir, ".env"));
const directusUrl = (env.PUBLIC_URL || `http://localhost:${env.DIRECTUS_HOST_PORT || "8055"}`).replace(/\/$/, "");
const expectedCollections = [
  "anx_user_profiles",
  "anx_tenants",
  "anx_tenant_roles",
  "anx_tenant_memberships",
  "anx_mcp_apps",
  "anx_mcp_servers",
  "anx_user_mcp_installs",
  "anx_model_connections",
  "anx_token_vault_refs",
  "anx_oidc_grants",
];

function readEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing ${filePath}. Copy .env.example to .env and fill the local secrets first.`);
  }

  const values = {};
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const [key, ...rest] = line.split("=");
    values[key] = rest.join("=");
  }
  return values;
}

async function directusRequest(method, pathname, token, body, expected = [200, 201, 204]) {
  const headers = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(`${directusUrl}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!expected.includes(response.status)) {
    throw new Error(`${method} ${pathname} failed with ${response.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

async function getToken(email, password) {
  const data = await directusRequest("POST", "/auth/login", null, {
    email,
    password,
    mode: "json",
  });
  return data.data.access_token;
}

async function firstByName(token, pathname, name, fields = "id,name") {
  const data = await directusRequest(
    "GET",
    `${pathname}?limit=1&fields=${fields}&filter[name][_eq]=${encodeURIComponent(name)}`,
    token
  );
  return data.data[0] ?? null;
}

async function createItem(collection, token, body) {
  const data = await directusRequest("POST", `/items/${collection}`, token, body);
  return data.data;
}

async function deleteItem(collection, token, id) {
  await directusRequest("DELETE", `/items/${collection}/${id}`, token, undefined, [200, 204, 404]);
}

async function main() {
  const adminToken = await getToken(env.ADMIN_EMAIL, env.ADMIN_PASSWORD);
  const collections = await directusRequest("GET", "/collections?limit=-1", adminToken);
  const collectionSet = new Set(collections.data.map((item) => item.collection));
  const missingCollections = expectedCollections.filter((collection) => !collectionSet.has(collection));
  if (missingCollections.length) {
    throw new Error(`Missing AgentNexus collections: ${missingCollections.join(", ")}`);
  }

  const publicMarketplace = await directusRequest(
    "GET",
    "/items/anx_mcp_servers?limit=5&fields=id,name,visibility&filter[visibility][_eq]=public",
    null
  );
  if (!publicMarketplace.data.length) {
    throw new Error("Public marketplace read succeeded but returned no public MCP servers.");
  }

  const appRole = await firstByName(adminToken, "/roles", "AgentNexus App User", "id,name");
  if (!appRole) throw new Error("Missing AgentNexus App User role. Run setup-agentnexus-schema.mjs first.");

  const appPolicy = await firstByName(adminToken, "/policies", "AgentNexus App User API", "id,name");
  if (!appPolicy) throw new Error("Missing AgentNexus App User API policy. Run setup-agentnexus-schema.mjs first.");

  const defaultRoleMatches = env.AUTH_KEYCLOAK_DEFAULT_ROLE_ID === appRole.id;
  const smokeId = crypto.randomUUID();
  const smokeEmail = `agentnexus-smoke-${smokeId}@example.com`;
  const smokePassword = `AgentNexus-${smokeId}!`;
  const created = {
    users: [],
    anx_user_profiles: [],
    anx_model_connections: [],
    anx_user_mcp_installs: [],
    anx_tenants: [],
    anx_tenant_roles: [],
    anx_mcp_apps: [],
    anx_mcp_servers: [],
  };

  try {
    const user = await directusRequest("POST", "/users", adminToken, {
      email: smokeEmail,
      password: smokePassword,
      role: appRole.id,
      status: "active",
      first_name: "AgentNexus",
      last_name: "Smoke",
    });
    created.users.push(user.data.id);

    const userToken = await getToken(smokeEmail, smokePassword);
    const profile = await createItem("anx_user_profiles", userToken, {
      email: smokeEmail,
      display_name: "AgentNexus Smoke",
      email_verified: true,
      keycloak_subject: user.data.id,
      upstream_provider: "keycloak",
      plan: "personal",
      status: "active",
      metadata: { smoke: true },
    });
    created.anx_user_profiles.push(profile.id);

    const model = await createItem("anx_model_connections", userToken, {
      profile: profile.id,
      provider: "OpenAI",
      model_id: "gpt-4.1",
      token_ref: `smoke:${smokeId}`,
      status: "connected",
      metadata: { smoke: true },
    });
    created.anx_model_connections.push(model.id);

    const install = await createItem("anx_user_mcp_installs", userToken, {
      profile: profile.id,
      server: publicMarketplace.data[0].id,
      status: "installed",
      installed_at: new Date().toISOString(),
      last_handshake_at: new Date().toISOString(),
      last_tool_schema: [{ name: "smoke_tool" }],
    });
    created.anx_user_mcp_installs.push(install.id);

    const tenant = await createItem("anx_tenants", userToken, {
      name: "AgentNexus Smoke Tenant",
      slug: `agentnexus-smoke-${smokeId}`,
      owner_profile: profile.id,
      plan: "enterprise",
      status: "active",
      settings: { smoke: true },
    });
    created.anx_tenants.push(tenant.id);

    const role = await createItem("anx_tenant_roles", userToken, {
      tenant: tenant.id,
      name: "smoke-viewer",
      permissions: { mcp: ["invoke"] },
      is_default: true,
    });
    created.anx_tenant_roles.push(role.id);

    const app = await createItem("anx_mcp_apps", userToken, {
      tenant: tenant.id,
      name: "AgentNexus Smoke App",
      app_url: "https://smoke.example/app",
      visibility: "private",
      oidc_client_id: `anx_smoke_${smokeId.replaceAll("-", "")}`,
      redirect_uris: ["https://smoke.example/app"],
      allowed_scopes: ["openid", "profile", "email", "agentnexus.enterprise"],
      status: "active",
      owner_profile: profile.id,
    });
    created.anx_mcp_apps.push(app.id);

    const server = await createItem("anx_mcp_servers", userToken, {
      app: app.id,
      tenant: tenant.id,
      name: "AgentNexus Smoke Private MCP",
      vendor: "AgentNexus Smoke Tenant",
      category: "Private",
      transport: "streamable_http",
      endpoint_url: "https://smoke.example/mcp",
      auth_mode: "oauth",
      visibility: "private",
      status: "installed",
      tool_schema: [{ name: "smoke_private_tool" }],
      custom_headers_schema: [{ name: "X-Smoke-Tenant" }],
      description: "Smoke-test private MCP server",
    });
    created.anx_mcp_servers.push(server.id);

    console.log(
      JSON.stringify(
        {
          directus_url: directusUrl,
          public_marketplace_records: publicMarketplace.data.length,
          app_user_role_id: appRole.id,
          auth_keycloak_default_role_matches: defaultRoleMatches,
          smoke_user_writes: {
            profile: profile.id,
            model_connection: model.id,
            install: install.id,
            tenant: tenant.id,
            role: role.id,
            app: app.id,
            private_server: server.id,
          },
        },
        null,
        2
      )
    );
  } finally {
    for (const id of created.anx_mcp_servers.reverse()) await deleteItem("anx_mcp_servers", adminToken, id);
    for (const id of created.anx_mcp_apps.reverse()) await deleteItem("anx_mcp_apps", adminToken, id);
    for (const id of created.anx_tenant_roles.reverse()) await deleteItem("anx_tenant_roles", adminToken, id);
    for (const id of created.anx_tenants.reverse()) await deleteItem("anx_tenants", adminToken, id);
    for (const id of created.anx_user_mcp_installs.reverse()) await deleteItem("anx_user_mcp_installs", adminToken, id);
    for (const id of created.anx_model_connections.reverse()) await deleteItem("anx_model_connections", adminToken, id);
    for (const id of created.anx_user_profiles.reverse()) await deleteItem("anx_user_profiles", adminToken, id);
    for (const id of created.users.reverse()) await directusRequest("DELETE", `/users/${id}`, adminToken, undefined, [200, 204, 404]);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
