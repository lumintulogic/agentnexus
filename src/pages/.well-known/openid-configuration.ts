import type { APIRoute } from "astro";
import { issuerFromRequest, oidcDiscovery } from "@/lib/oidc";

export const GET: APIRoute = ({ request }) =>
  Response.json(oidcDiscovery(issuerFromRequest(request)), {
    headers: { "Cache-Control": "no-store" }
  });
