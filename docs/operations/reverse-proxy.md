# Reverse Proxy & TLS

FHIRBridge's API (`packages/api`) serves PHI in transit and ships **no TLS of its
own**. In production you MUST run it behind a reverse proxy that terminates TLS.
Bind the API to loopback (or a private network) and let the proxy be the only
public listener.

> **TLS is required in production.** Do not publish `:3001` to the internet.

## What the proxy must get right

FHIRBridge streams exports as **NDJSON with backpressure** (`ExportService.streamExport`).
A proxy that buffers the whole response breaks streaming, inflates memory, and can
hold PHI longer than intended. Configure the proxy to:

1. **Disable response buffering** so chunks flush to the client as produced.
2. **Use long read timeouts** — a large `Patient/$everything` export can run for
   minutes. A 30–60 s default proxy timeout will truncate it mid-stream.
3. **Forward the real client IP** and set `TRUST_PROXY` on the API so per-IP rate
   limiting and audit see the true source, not the proxy.

### `TRUST_PROXY`

The API only honours `X-Forwarded-*` headers when `TRUST_PROXY` is set. Set it to
the proxy's address range so a client cannot spoof its own IP:

```bash
TRUST_PROXY=true            # trust the immediate upstream (single known proxy)
# or, more strictly, the proxy subnet:
TRUST_PROXY=10.0.0.0/8
```

Leave it unset (`false`) when nothing sits in front of the API.

## Caddy (automatic HTTPS)

Caddy provisions and renews certificates automatically. This is the least-effort
production setup.

```caddyfile
fhirbridge.example.org {
    encode gzip

    reverse_proxy 127.0.0.1:3001 {
        # Stream NDJSON: flush immediately, no response buffering.
        flush_interval -1

        # Long timeouts for large exports.
        transport http {
            read_timeout 30m
            write_timeout 30m
        }
    }
}
```

Then run the API bound to loopback:

```bash
HOST=127.0.0.1 PORT=3001 NODE_ENV=production TRUST_PROXY=true \
  pnpm --filter @fhirbridge/api start
```

## nginx

```nginx
server {
    listen 443 ssl http2;
    server_name fhirbridge.example.org;

    ssl_certificate     /etc/letsencrypt/live/fhirbridge.example.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/fhirbridge.example.org/privkey.pem;

    # Modern TLS only.
    ssl_protocols       TLSv1.2 TLSv1.3;

    location / {
        proxy_pass http://127.0.0.1:3001;

        # --- Streaming NDJSON: never buffer the response ---
        proxy_buffering    off;
        proxy_cache        off;
        proxy_http_version 1.1;

        # --- Long-running exports ---
        proxy_read_timeout    30m;
        proxy_send_timeout    30m;
        # Do not cap upload/response body for CSV/Excel import + NDJSON export.
        client_max_body_size  60m;

        # --- Real client IP for rate limit + audit (set TRUST_PROXY on the API) ---
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# Redirect HTTP → HTTPS.
server {
    listen 80;
    server_name fhirbridge.example.org;
    return 301 https://$host$request_uri;
}
```

## Security headers

The API already sends security headers via `helmet` (HSTS, `X-Content-Type-Options`,
frame denial, etc.). Do not strip them at the proxy. If you add headers at the proxy
instead, mirror the same policy — do not weaken it.

## Health checks

`GET /api/v1/health` is public and returns `200` even when Postgres/Redis are
degraded. Point your load balancer's health probe at it. It is safe to expose.
