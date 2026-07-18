import json
import sys
import urllib.error
import urllib.parse
import urllib.request


ENV_PATH = ".env"


def read_env(path):
    values = {}
    with open(path, "r", encoding="utf-8") as file:
        for line in file:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            values[key] = value
    return values


env = read_env(ENV_PATH)
base_url = f"http://localhost:{env.get('KEYCLOAK_HTTP_PORT', '8080')}"
realm = env.get("AGENTNEXUS_REALM", "agentnexus")
web_base_url = env.get("AGENTNEXUS_PUBLIC_BASE_URL", "http://localhost:4321")
web_client_id = env.get("AGENTNEXUS_OIDC_CLIENT_ID", "agentnexus-web")


def request(method, path, token=None, payload=None, form=None, expected=(200, 201, 204, 409)):
    data = None
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if payload is not None:
        data = json.dumps(payload).encode()
        headers["Content-Type"] = "application/json"
    if form is not None:
        data = urllib.parse.urlencode(form).encode()
        headers["Content-Type"] = "application/x-www-form-urlencoded"

    req = urllib.request.Request(base_url + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            body = response.read()
            parsed = json.loads(body) if body else None
            return response.status, parsed
    except urllib.error.HTTPError as error:
        body = error.read().decode()
        if error.code in expected:
            return error.code, body
        raise RuntimeError(f"{method} {path} failed: {error.code} {body}") from error


def get_admin_token():
    _, data = request(
        "POST",
        "/realms/master/protocol/openid-connect/token",
        form={
            "grant_type": "password",
            "client_id": "admin-cli",
            "username": env["KEYCLOAK_ADMIN"],
            "password": env["KEYCLOAK_ADMIN_PASSWORD"],
        },
        expected=(200,),
    )
    return data["access_token"]


def put_realm(token):
    payload = {
        "realm": realm,
        "enabled": True,
        "displayName": "AgentNexus",
        "loginWithEmailAllowed": True,
        "duplicateEmailsAllowed": False,
        "registrationAllowed": False,
        "resetPasswordAllowed": True,
        "rememberMe": True,
        "verifyEmail": False,
        "sslRequired": "external",
    }
    status, _ = request("POST", "/admin/realms", token=token, payload=payload)
    if status == 409:
        request("PUT", f"/admin/realms/{realm}", token=token, payload=payload, expected=(204,))
        return "updated"
    return "created"


def ensure_realm_roles(token):
    roles = [
        ("agentnexus_user", "Default authenticated AgentNexus user."),
        ("agentnexus_developer", "MCP app/server developer."),
        ("agentnexus_enterprise_admin", "Enterprise tenant administrator."),
        ("agentnexus_internal_admin", "AgentNexus internal operator."),
    ]
    created = []
    for name, description in roles:
        status, _ = request(
            "POST",
            f"/admin/realms/{realm}/roles",
            token=token,
            payload={"name": name, "description": description},
        )
        if status == 201:
            created.append(name)
    return created


def get_client(token, client_id):
    _, data = request(
        "GET",
        f"/admin/realms/{realm}/clients?clientId={urllib.parse.quote(client_id)}",
        token=token,
        expected=(200,),
    )
    return data[0] if data else None


def upsert_client(token, client_id, payload):
    existing = get_client(token, client_id)
    if existing:
        request(
            "PUT",
            f"/admin/realms/{realm}/clients/{existing['id']}",
            token=token,
            payload={**existing, **payload},
            expected=(204,),
        )
        return "updated"

    status, _ = request("POST", f"/admin/realms/{realm}/clients", token=token, payload=payload)
    return "created" if status == 201 else "unchanged"


def ensure_clients(token):
    web_payload = {
        "clientId": web_client_id,
        "name": "AgentNexus Web",
        "description": "AgentNexus browser application using Authorization Code + PKCE.",
        "enabled": True,
        "protocol": "openid-connect",
        "publicClient": True,
        "standardFlowEnabled": True,
        "implicitFlowEnabled": False,
        "directAccessGrantsEnabled": False,
        "serviceAccountsEnabled": False,
        "frontchannelLogout": True,
        "redirectUris": [f"{web_base_url}/*"],
        "webOrigins": [web_base_url],
        "attributes": {
            "pkce.code.challenge.method": "S256",
            "post.logout.redirect.uris": f"{web_base_url}/*",
        },
    }

    api_payload = {
        "clientId": "agentnexus-api",
        "name": "AgentNexus API",
        "description": "Confidential service client for AgentNexus backend/API integration with Keycloak.",
        "enabled": True,
        "protocol": "openid-connect",
        "publicClient": False,
        "standardFlowEnabled": False,
        "implicitFlowEnabled": False,
        "directAccessGrantsEnabled": False,
        "serviceAccountsEnabled": True,
        "authorizationServicesEnabled": False,
    }

    return {
        web_client_id: upsert_client(token, web_client_id, web_payload),
        "agentnexus-api": upsert_client(token, "agentnexus-api", api_payload),
    }


def ensure_identity_providers(token):
    providers = [
        ("google", "google", "GOOGLE"),
        ("github", "github", "GITHUB"),
        ("facebook", "facebook", "META"),
        ("microsoft", "microsoft", "MICROSOFT"),
    ]
    results = {}
    for alias, provider_id, prefix in providers:
        client_id = env.get(f"{prefix}_CLIENT_ID")
        client_secret = env.get(f"{prefix}_CLIENT_SECRET")
        if not client_id or not client_secret:
            results[alias] = "skipped_missing_credentials"
            continue

        payload = {
            "alias": alias,
            "providerId": provider_id,
            "enabled": True,
            "trustEmail": True,
            "storeToken": False,
            "addReadTokenRoleOnCreate": False,
            "authenticateByDefault": False,
            "config": {"clientId": client_id, "clientSecret": client_secret},
        }
        status, _ = request(
            "POST",
            f"/admin/realms/{realm}/identity-provider/instances",
            token=token,
            payload=payload,
        )
        if status == 409:
            request(
                "PUT",
                f"/admin/realms/{realm}/identity-provider/instances/{alias}",
                token=token,
                payload=payload,
                expected=(204,),
            )
            results[alias] = "updated"
        else:
            results[alias] = "created"
    return results


def main():
    token = get_admin_token()
    summary = {
        "realm": {realm: put_realm(token)},
        "roles_created": ensure_realm_roles(token),
        "clients": ensure_clients(token),
        "identity_providers": ensure_identity_providers(token),
        "issuer": f"{base_url}/realms/{realm}",
        "discovery": f"{base_url}/realms/{realm}/.well-known/openid-configuration",
    }
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
