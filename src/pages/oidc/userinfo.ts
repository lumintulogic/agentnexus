import type { APIRoute } from "astro";
import { decodeJwtPayload } from "@/lib/oidc";

export const GET: APIRoute = ({ request }) => {
  const authorization = request.headers.get("Authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";

  try {
    const payload = decodeJwtPayload(token);
    return Response.json({
      sub: payload.sub,
      email: payload.email,
      name: payload.name,
      email_verified: payload.email_verified,
      tenant_id: payload.tenant_id,
      app_id: payload.app_id,
      app_url: payload.app_url,
      role_id: payload.role_id,
      role_name: payload.role_name
    });
  } catch {
    return Response.json({ error: "invalid_token" }, { status: 401 });
  }
};
