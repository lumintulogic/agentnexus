# AgentNexus Local Services

This folder contains reproducible local initialization for the current Directus and Keycloak setup.

The `agentnexus` identifier is intentionally kept in local realm, client, cookie, network, and collection names until the product naming check is complete.

## Services

- `directus/` runs Directus, PostgreSQL/PostGIS, and Redis.
- `keycloak/` runs Keycloak and PostgreSQL.

## First Run

1. Copy each example env file and replace secrets:

   ```sh
   cp server/directus/.env.example server/directus/.env
   cp server/keycloak/.env.example server/keycloak/.env
   ```

2. Start and initialize both services:

   ```sh
   bash server/bootstrap-local.sh
   ```

The bootstrap script starts both Docker Compose stacks, configures Keycloak, and applies the Directus product schema.

## Individual Initializers

Run Keycloak setup only:

```sh
cd server/keycloak
python3 setup-agentnexus.py
```

Run Directus schema setup only:

```sh
cd server/directus
node setup-agentnexus-schema.mjs
```

Verify Directus browser/API integration after the schema setup:

```sh
cd server/directus
node verify-agentnexus-integration.mjs
```

The verifier logs in with the Directus admin credentials, confirms public marketplace reads work without an access token, creates a temporary app user with the AgentNexus role, verifies authenticated writes to profile, install, model, tenant, role, app, and private MCP server collections, then deletes the temporary records.

Both scripts are idempotent. Existing collections, relations, realm roles, clients, configured identity providers, seeded public marketplace servers, and prototype Directus access policies are left in place or updated to the expected local development shape.

The Directus initializer prints `access_policy.app_user_role_id`. Set `AUTH_KEYCLOAK_DEFAULT_ROLE_ID` in `server/directus/.env` to that value when Keycloak-created Directus users should be able to sync AgentNexus profile, install, model, tenant, and private MCP metadata.

## Frontend Integration

The browser app reads these public env values from the repo root `.env`:

```sh
PUBLIC_DIRECTUS_URL=http://localhost:8055
PUBLIC_DIRECTUS_KEYCLOAK_PROVIDER=keycloak
```

Directus must allow the app origin through CORS for browser-side marketplace reads. In local development, uncomment the CORS values in `server/directus/.env` when running the Astro dev server from another port.
