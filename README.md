# AgentNexus

AgentNexus is a consumer-facing, model-agnostic web application for browsing, installing, and orchestrating Model Context Protocol (MCP) server integrations. The product direction is to become an app-store and operating layer for MCP: users can discover backend capabilities, connect them to their preferred model provider, manage authentication, and route tool calls through a browser-first interface.

This scaffold uses Astro with React islands and the Cloudflare SSR adapter. The current implementation is a working prototype with a protected dashboard, mock marketplace registry, live MCP WebSocket fixture, SDK capability handshakes, session-scoped server authorization, model connection setup, MCP tool-call execution, PWA metadata, local Directus/Keycloak infrastructure, and an isolated Playwright E2E test package.

Project tracking board: https://repository.lumintulogic.com/apps/deck/board/146

## Current Status

- Astro app scaffolded with Cloudflare SSR output.
- React dashboard shell implemented from the PRD twin-panel layout.
- Mock sign-up/login gate added with email auth and multiple SSO entry points.
- Mock MCP marketplace registry, local WebSocket MCP fixture, and SDK capability handshake path added.
- Browser app now attempts to load public MCP marketplace records from Directus and falls back to the prototype registry when Directus is unavailable.
- Auth screen includes a Directus/Keycloak broker entry point and can hydrate a session from either a Directus session cookie or returned Directus access token.
- Server authorization dialog added for OAuth/Bearer MCP integrations with encrypted session vault references and automatic Authorization attachment for tool calls.
- Enterprise private MCP registration added with tenant/app/role context and generated AgentNexus OIDC authorize URLs for invited users.
- MCP tool-call execution path added for `/tool <tool_name> <query>` chat intents, with SDK execution and mock fallback.
- Model connection dialog added for provider, endpoint, model ID, and session-scoped API-key metadata.
- Local Directus and Keycloak compose stacks added under `server/` for the product data and upstream SSO layers.
- Cloudflare Workers deployment scripts and GitHub Actions workflow added.
- PWA manifest and app icon added.
- Isolated Playwright E2E subpackage added under `e2e/`.
- Verified with `npm run build` and `cd e2e && npm test`.

## Folder Structure

```text
.
├── e2e/
│   ├── README.md
│   ├── package.json
│   ├── package-lock.json
│   ├── playwright.config.ts
│   └── tests/
│       └── agentnexus.spec.ts
├── .github/
│   └── workflows/
│       └── cloudflare-deploy.yml
├── public/
│   ├── icons/
│   │   └── icon.svg
│   └── manifest.webmanifest
├── server/
│   ├── README.md
│   ├── bootstrap-local.sh
│   ├── directus/
│   │   ├── docker-compose.yml
│   │   ├── .env.example
│   │   └── setup-agentnexus-schema.mjs
│   └── keycloak/
│       ├── docker-compose.yml
│       ├── .env.example
│       └── setup-agentnexus.py
├── src/
│   ├── components/
│   │   ├── AgentNexusApp.css
│   │   └── AgentNexusApp.tsx
│   ├── data/
│   │   └── registry.ts
│   ├── layouts/
│   │   └── BaseLayout.astro
│   ├── lib/
│   │   └── mcp.ts
│   ├── pages/
│   │   └── index.astro
│   └── env.d.ts
├── astro.config.mjs
├── package.json
├── package-lock.json
├── prd.md
├── tsconfig.json
└── wrangler.jsonc
```

## Key Directories

- `src/components/` contains the interactive React dashboard island and its styles.
- `src/data/` contains typed mock registry data for marketplace servers.
- `src/lib/` contains MCP-related helpers, currently a mock capability handshake mapper.
- `src/pages/` contains Astro routes.
- `public/` contains PWA metadata and static assets.
- `e2e/` is a separate Node package for Playwright end-to-end tests.
- `.github/workflows/cloudflare-deploy.yml` deploys `main` to Cloudflare Workers with Wrangler.
- `tools/mock-mcp-websocket-server.mjs` is a local JSON-RPC WebSocket fixture for live MCP capability discovery tests.
- `server/` contains local Directus and Keycloak compose stacks plus initialization scripts for the product data and identity broker layers.
- `server/directus/verify-agentnexus-integration.mjs` verifies public marketplace reads and authenticated AgentNexus collection writes against a live Directus instance.

## Development

Install root dependencies:

```sh
npm install
```

Copy the browser-facing local env example if you want the app to use local Directus and Keycloak:

```sh
cp .env.example .env
```

The defaults point to `http://localhost:8055` and the Directus auth provider named `keycloak`.

Run the Astro dev server:

```sh
npm run dev
```

Run the mock MCP WebSocket server:

```sh
npm run mock:mcp
```

It listens at `ws://localhost:8787/mcp/postgres` and supports `initialize`, `tools/list`, and `tools/call`.

Run the prototype smoke verifier:

```sh
npm run smoke:prototype
```

The smoke verifier starts the Astro dev server and mock MCP WebSocket server, checks OIDC discovery/registration/authorization/token/userinfo/JWKS, and checks MCP `tools/list` plus `tools/call`.

Build and type-check the app:

```sh
npm run build
```

Run E2E tests:

```sh
cd e2e
npm install
npm test
```

The Playwright config starts the parent Astro dev server when needed and reuses it if it is already running.

## Cloudflare Deployment

The app builds for Cloudflare Workers using the Astro Cloudflare adapter and `wrangler.jsonc`.

`npm run build` emits the Worker module entry at `dist/_worker.js/index.js`, static assets under `dist/`, and `dist/.assetsignore` so Wrangler does not upload the private `_worker.js` bundle as a public asset. Wrangler deploys the Worker with `assets.directory` set to `./dist` and `run_worker_first` enabled so OIDC/API routes are handled by the Worker runtime.

Run a preview deployment:

```sh
npm run deploy:preview
```

Run a production deployment from `main`:

```sh
npm run deploy:production
```

GitHub Actions also deploys `main` through `.github/workflows/cloudflare-deploy.yml`. Configure these repository secrets before enabling the workflow:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

The workflow runs `npm ci`, `npm run build`, then `npx wrangler deploy`.

## Prototype OIDC Issuer

AgentNexus exposes a prototype OIDC issuer for downstream MCP apps:

- `/.well-known/openid-configuration`
- `/oidc/authorize`
- `/oidc/token`
- `/oidc/userinfo`
- `/oidc/jwks.json`
- `/oidc/register`

Set `PUBLIC_AGENTNEXUS_ISSUER` in `.env` when the browser/dev-server origin is not the issuer URL you want in discovery metadata.

## Next Plan

- Complete Keycloak-backed login by persisting/syncing AgentNexus-owned Directus user profiles after SSO callback.
- Replace session-only server credential storage with encrypted token storage and vault references in the AgentNexus data layer.
- Add AgentNexus OIDC issuer endpoints for downstream MCP app authentication.
- Connect marketplace, tenant membership, installs, model connections, and token metadata to Directus collections.
- Verify enterprise private MCP registration against live Directus permissions and replace prototype tenant IDs with persisted tenant/app/role IDs in the browser flow.
