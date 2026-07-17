# AgentNexus E2E

This subpackage owns Playwright end-to-end tests for the Astro app.

## Commands

```sh
npm install
npm test
```

By default the tests target `http://127.0.0.1:4321`. Override it with:

```sh
AGENTNEXUS_BASE_URL=http://127.0.0.1:4321 npm test
```

The Playwright config starts the parent Astro dev server when needed and reuses it when it is already running.
