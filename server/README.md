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

Both scripts are idempotent. Existing collections, relations, realm roles, clients, configured identity providers, and seeded public marketplace servers are left in place or updated to the expected local development shape.

## Frontend Integration

The browser app reads these public env values from the repo root `.env`:

```sh
PUBLIC_DIRECTUS_URL=http://localhost:8055
PUBLIC_DIRECTUS_KEYCLOAK_PROVIDER=keycloak
```

Directus must allow the app origin through CORS for browser-side marketplace reads. In local development, uncomment the CORS values in `server/directus/.env` when running the Astro dev server from another port.
