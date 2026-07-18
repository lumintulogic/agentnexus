import type { APIRoute } from "astro";
import { jwks } from "@/lib/oidc";

export const GET: APIRoute = async () =>
  Response.json(await jwks(), {
    headers: { "Cache-Control": "no-store" }
  });
