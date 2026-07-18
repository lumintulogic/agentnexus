# AgentNexus Agent Notes

Use this checklist at the start of every new session before making changes.

## Session Prep

1. Read `README.md` first.
   - Treat the "Project tracking board" URL in `README.md` as the source of truth for Deck/Lakon updates.
   - Current board: `https://repository.lumintulogic.com/apps/deck/board/146`.

2. Read `prd.md` when task scope is unclear.
   - Use it to align feature work with the product direction and milestones.

3. Check the worktree before editing.
   - Run `git status --short`.
   - Do not revert or overwrite existing user/agent changes unless explicitly asked.

4. If using Lakon/Deck, verify the board before updating anything.
   - List or search for the board ID from `README.md`.
   - For this repo, use AgentNexus board `146`.
   - Do not update any other board unless the user explicitly asks.
   - Add progress comments to the relevant cards after meaningful work or verification.
   - Move cards to the proper lane after a planning decision or implementation is actually resolved, not only by adding comments.
   - The exposed Lakon MCP tools may not include a move-card operation. If a move is required, use the Deck API fallback with the existing Lakon auth header from `/home/happy/.codex/config.toml`; do not print the token. The reliable cross-stack endpoint is `PUT https://repository.lumintulogic.com/index.php/apps/deck/cards/{cardId}/reorder` with JSON like `{"stackId":443,"order":999}`. The documented `/boards/{boardId}/stacks/{stackId}/cards/{cardId}/reorder` endpoint can return 200 while failing to move cards across stacks on this Deck version.

5. Review planned tasks from the board before expanding scope.
   - Current board lanes after the Directus/Keycloak setup and app MCP SDK work:
     - Completed: initial scaffold/UI/PWA/E2E work, mock MCP WebSocket server (`2407`), MCP SDK handshake (`2408`), authentication/token runtime work (`2409`), MCP tool execution pipeline (`2410`), Directus instance/schema/init automation (`2414`), persistent storage provider decision via Directus (`2411`), OIDC broker contract definition (`2417`), Cloudflare deployment workflow (`2412`), encrypted token vault references (`2420`), AgentNexus OIDC issuer endpoints (`2421`), enterprise private MCP registration (`2422`), and Cloudflare Workers deployment migration (`2423`).
     - Next: app login/Directus profile sync (`2418`) and Directus-backed marketplace/install persistence (`2419`).
     - Backlog: no current cards after the Workers migration item was added to Next.
   - Directus answers the persistent storage provider decision. Directus also provides persistence for auth/token and OIDC broker metadata, but it does not by itself finish the app/runtime work for real login, token vault behavior, auth header attachment, token issuance, or MCP tool execution.

## Development Commands

- Install dependencies: `npm install`
- Run app: `npm run dev`
- Build/type-check: `npm run build`
- Run prototype smoke verifier: `npm run smoke:prototype`
- Run mock MCP WebSocket server: `npm run mock:mcp`
- Deploy preview Worker version: `npm run deploy:preview`
- Deploy production Worker: `npm run deploy:production`
- Run E2E tests: `cd e2e && npm test`

Notes:
- Playwright may need permission to bind a local test server outside the sandbox.
- The mock MCP server listens on `ws://127.0.0.1:8787/mcp/postgres`.
- Deployment now targets Cloudflare Workers through `wrangler deploy`, with `dist/_worker.js/index.js` as the Worker entry and `dist/` as the static asset directory. The build writes `dist/.assetsignore` so Wrangler does not upload `_worker.js` as a public static asset.

## Verification Expectations

Before finalizing code changes, run:

1. `npm run build`
2. `cd e2e && npm test` when UI behavior changed
3. For MCP server work, smoke-test `npm run mock:mcp` and SDK `tools/list` if relevant

When reporting back, include what passed, what could not be run, and which Deck cards were updated.
