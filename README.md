# AgentNexus

AgentNexus is a consumer-facing, model-agnostic web application for browsing, installing, and orchestrating Model Context Protocol (MCP) server integrations. The product direction is to become an app-store and operating layer for MCP: users can discover backend capabilities, connect them to their preferred model provider, manage authentication, and route tool calls through a browser-first interface.

This scaffold uses Astro with React islands and the Cloudflare SSR adapter. The current implementation is a functional product shell with mock MCP registry data, mock capability mapping, PWA metadata, and an isolated Playwright E2E test package.

Project tracking board: https://repository.lumintulogic.com/apps/deck/board/146

## Current Status

- Astro app scaffolded with Cloudflare SSR output.
- React dashboard shell implemented from the PRD twin-panel layout.
- Mock sign-up/login gate added with email auth and multiple SSO entry points.
- Mock MCP marketplace registry and capability handshake helper added.
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
├── public/
│   ├── icons/
│   │   └── icon.svg
│   └── manifest.webmanifest
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
- `tools/mock-mcp-websocket-server.mjs` is a local JSON-RPC WebSocket fixture for live MCP capability discovery tests.

## Development

Install root dependencies:

```sh
npm install
```

Run the Astro dev server:

```sh
npm run dev
```

Run the mock MCP WebSocket server:

```sh
npm run mock:mcp
```

It listens at `ws://localhost:8787/mcp/postgres` and supports `initialize`, `tools/list`, and `tools/call`.

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

## Next Plan

- Build a mock MCP WebSocket server for live connection testing.
- Replace mock capability mapping with a real MCP SDK handshake.
- Implement OAuth/Bearer token setup and encrypted session-scoped token handling.
- Add the MCP tool execution pipeline for model tool-call intents.
- Choose persistent storage, likely Supabase or Firebase, for user profiles and registry metadata.
- Add a production Cloudflare deployment workflow.
