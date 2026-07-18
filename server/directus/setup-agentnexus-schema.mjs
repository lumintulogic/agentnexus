import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const serviceDir = path.dirname(new URL(import.meta.url).pathname);
const env = readEnv(path.join(serviceDir, ".env"));
const directusUrl = (env.PUBLIC_URL || `http://localhost:${env.DIRECTUS_HOST_PORT || "8055"}`).replace(/\/$/, "");

const uuidPrimaryKey = {
  field: "id",
  type: "uuid",
  meta: { hidden: true, readonly: true, interface: "input", special: ["uuid"] },
  schema: { is_primary_key: true, length: 36, has_auto_increment: false },
};

const field = (name, type, options = {}) => ({
  field: name,
  type,
  meta: {
    interface: options.interface ?? interfaceFor(type),
    special: options.special ?? null,
    required: options.required ?? false,
    hidden: options.hidden ?? false,
    width: options.width ?? "full",
    note: options.note ?? null,
  },
  schema: {
    is_nullable: !(options.required ?? false),
    is_unique: options.unique ?? false,
    default_value: options.default ?? null,
  },
});

const relationField = (name, options = {}) =>
  field(name, "uuid", {
    ...options,
    interface: "select-dropdown-m2o",
    special: ["m2o"],
  });

function interfaceFor(type) {
  return {
    string: "input",
    text: "input-multiline",
    boolean: "boolean",
    json: "input-code",
    timestamp: "datetime",
    uuid: "input",
  }[type] ?? "input";
}

const collections = [
  {
    collection: "anx_user_profiles",
    meta: {
      icon: "account_circle",
      note: "AgentNexus canonical user identity, upstream SSO mapping, plan, and profile metadata.",
      display_template: "{{display_name}}",
    },
    schema: {},
    fields: [
      uuidPrimaryKey,
      field("email", "string", { required: true, unique: true, width: "half" }),
      field("display_name", "string", { width: "half" }),
      field("email_verified", "boolean", { default: false, width: "half" }),
      field("keycloak_subject", "string", { unique: true, width: "half" }),
      field("upstream_provider", "string", { width: "half" }),
      field("plan", "string", { default: "personal", width: "half" }),
      field("status", "string", { default: "active", width: "half" }),
      field("metadata", "json"),
    ],
  },
  {
    collection: "anx_tenants",
    meta: {
      icon: "business",
      note: "Enterprise tenants that own private MCP apps, private MCP servers, and role-scoped memberships.",
      display_template: "{{name}}",
    },
    schema: {},
    fields: [
      uuidPrimaryKey,
      field("name", "string", { required: true }),
      field("slug", "string", { required: true, unique: true, width: "half" }),
      field("plan", "string", { default: "enterprise", width: "half" }),
      field("status", "string", { default: "active", width: "half" }),
      relationField("owner_profile", { width: "half" }),
      field("settings", "json"),
    ],
  },
  {
    collection: "anx_tenant_roles",
    meta: {
      icon: "admin_panel_settings",
      note: "Tenant role definitions used in enterprise/private token context.",
      display_template: "{{name}}",
    },
    schema: {},
    fields: [
      uuidPrimaryKey,
      relationField("tenant", { required: true, width: "half" }),
      field("name", "string", { required: true, width: "half" }),
      field("description", "text"),
      field("permissions", "json"),
      field("is_default", "boolean", { default: false, width: "half" }),
    ],
  },
  {
    collection: "anx_tenant_memberships",
    meta: {
      icon: "group",
      note: "Links AgentNexus users to tenants and roles, including invited personal users.",
      display_template: "{{invited_email}}",
    },
    schema: {},
    fields: [
      uuidPrimaryKey,
      relationField("tenant", { required: true, width: "half" }),
      relationField("profile", { required: true, width: "half" }),
      relationField("role", { width: "half" }),
      field("role_name", "string", { width: "half" }),
      field("status", "string", { default: "invited", width: "half" }),
      field("invited_email", "string", { width: "half" }),
      relationField("invited_by", { width: "half" }),
      field("accepted_at", "timestamp", { width: "half" }),
    ],
  },
  {
    collection: "anx_mcp_apps",
    meta: {
      icon: "apps",
      note: "Downstream OIDC clients and developer apps that trust AgentNexus identity.",
      display_template: "{{name}}",
    },
    schema: {},
    fields: [
      uuidPrimaryKey,
      relationField("tenant", { width: "half" }),
      field("name", "string", { required: true }),
      field("app_url", "string", { required: true }),
      field("visibility", "string", { default: "public", width: "half" }),
      field("oidc_client_id", "string", { required: true, unique: true, width: "half" }),
      field("redirect_uris", "json"),
      field("allowed_scopes", "json"),
      field("status", "string", { default: "draft", width: "half" }),
      relationField("owner_profile", { width: "half" }),
    ],
  },
  {
    collection: "anx_mcp_servers",
    meta: {
      icon: "hub",
      note: "Public marketplace and private tenant MCP server registry.",
      display_template: "{{name}}",
    },
    schema: {},
    fields: [
      uuidPrimaryKey,
      relationField("app", { width: "half" }),
      relationField("tenant", { width: "half" }),
      field("name", "string", { required: true }),
      field("vendor", "string", { width: "half" }),
      field("category", "string", { width: "half" }),
      field("transport", "string", { default: "streamable_http", width: "half" }),
      field("endpoint_url", "string", { required: true }),
      field("auth_mode", "string", { default: "none", width: "half" }),
      field("visibility", "string", { default: "public", width: "half" }),
      field("status", "string", { default: "available", width: "half" }),
      field("tool_schema", "json"),
      field("custom_headers_schema", "json"),
      field("description", "text"),
    ],
  },
  {
    collection: "anx_user_mcp_installs",
    meta: {
      icon: "extension",
      note: "Per-user install and activation state for MCP servers.",
      display_template: "{{status}}",
    },
    schema: {},
    fields: [
      uuidPrimaryKey,
      relationField("profile", { required: true, width: "half" }),
      relationField("server", { required: true, width: "half" }),
      field("status", "string", { default: "installed", width: "half" }),
      field("installed_at", "timestamp", { width: "half" }),
      field("last_handshake_at", "timestamp", { width: "half" }),
      field("last_tool_schema", "json"),
    ],
  },
  {
    collection: "anx_model_connections",
    meta: {
      icon: "smart_toy",
      note: "Per-user model provider connection metadata without raw model API secrets.",
      display_template: "{{provider}} {{model_id}}",
    },
    schema: {},
    fields: [
      uuidPrimaryKey,
      relationField("profile", { required: true, width: "half" }),
      field("provider", "string", { required: true, width: "half" }),
      field("model_id", "string", { required: true, width: "half" }),
      field("endpoint_url", "string"),
      field("token_ref", "string"),
      field("status", "string", { default: "connected", width: "half" }),
      field("metadata", "json"),
    ],
  },
  {
    collection: "anx_token_vault_refs",
    meta: {
      icon: "key",
      note: "Opaque encrypted-token metadata references for model and MCP credentials.",
      display_template: "{{purpose}}",
    },
    schema: {},
    fields: [
      uuidPrimaryKey,
      relationField("profile", { required: true, width: "half" }),
      relationField("tenant", { width: "half" }),
      field("purpose", "string", { required: true, width: "half" }),
      field("provider", "string", { width: "half" }),
      field("vault_key", "string", { required: true, unique: true }),
      field("expires_at", "timestamp", { width: "half" }),
      field("revoked_at", "timestamp", { width: "half" }),
      field("metadata", "json"),
    ],
  },
  {
    collection: "anx_oidc_grants",
    meta: {
      icon: "verified_user",
      note: "Issued downstream OIDC app grants and consent state.",
      display_template: "{{status}}",
    },
    schema: {},
    fields: [
      uuidPrimaryKey,
      relationField("profile", { required: true, width: "half" }),
      relationField("app", { required: true, width: "half" }),
      relationField("tenant", { width: "half" }),
      field("scopes", "json"),
      field("claims_snapshot", "json"),
      field("refresh_token_ref", "string"),
      field("status", "string", { default: "active", width: "half" }),
      field("granted_at", "timestamp", { width: "half" }),
      field("revoked_at", "timestamp", { width: "half" }),
    ],
  },
];

const relations = [
  ["anx_tenants", "owner_profile", "anx_user_profiles"],
  ["anx_tenant_roles", "tenant", "anx_tenants"],
  ["anx_tenant_memberships", "tenant", "anx_tenants"],
  ["anx_tenant_memberships", "profile", "anx_user_profiles"],
  ["anx_tenant_memberships", "role", "anx_tenant_roles"],
  ["anx_tenant_memberships", "invited_by", "anx_user_profiles"],
  ["anx_mcp_apps", "tenant", "anx_tenants"],
  ["anx_mcp_apps", "owner_profile", "anx_user_profiles"],
  ["anx_mcp_servers", "app", "anx_mcp_apps"],
  ["anx_mcp_servers", "tenant", "anx_tenants"],
  ["anx_user_mcp_installs", "profile", "anx_user_profiles"],
  ["anx_user_mcp_installs", "server", "anx_mcp_servers"],
  ["anx_model_connections", "profile", "anx_user_profiles"],
  ["anx_token_vault_refs", "profile", "anx_user_profiles"],
  ["anx_token_vault_refs", "tenant", "anx_tenants"],
  ["anx_oidc_grants", "profile", "anx_user_profiles"],
  ["anx_oidc_grants", "app", "anx_mcp_apps"],
  ["anx_oidc_grants", "tenant", "anx_tenants"],
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

async function getToken() {
  const data = await directusRequest("POST", "/auth/login", null, {
    email: env.ADMIN_EMAIL,
    password: env.ADMIN_PASSWORD,
    mode: "json",
  });
  return data.data.access_token;
}

async function existingCollections(token) {
  const data = await directusRequest("GET", "/collections?limit=-1", token);
  return new Set(data.data.map((item) => item.collection));
}

async function existingRelations(token) {
  const data = await directusRequest("GET", "/relations?limit=-1", token);
  return new Set(data.data.map((item) => `${item.collection}.${item.field}`));
}

async function createCollection(token, definition) {
  await directusRequest("POST", "/collections", token, definition);
}

async function createRelation(token, collection, fieldName, relatedCollection) {
  await directusRequest("POST", "/relations", token, {
    collection,
    field: fieldName,
    related_collection: relatedCollection,
    schema: { on_delete: "SET NULL" },
    meta: { sort_field: null },
  });
}

async function main() {
  const token = await getToken();
  const collectionSet = await existingCollections(token);
  const createdCollections = [];

  for (const definition of collections) {
    if (collectionSet.has(definition.collection)) continue;
    await createCollection(token, definition);
    collectionSet.add(definition.collection);
    createdCollections.push(definition.collection);
  }

  const relationSet = await existingRelations(token);
  const createdRelations = [];

  for (const [collection, fieldName, relatedCollection] of relations) {
    const key = `${collection}.${fieldName}`;
    if (relationSet.has(key)) continue;
    await createRelation(token, collection, fieldName, relatedCollection);
    relationSet.add(key);
    createdRelations.push(`${key}->${relatedCollection}`);
  }

  console.log(JSON.stringify({ directus_url: directusUrl, created_collections: createdCollections, created_relations: createdRelations }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
