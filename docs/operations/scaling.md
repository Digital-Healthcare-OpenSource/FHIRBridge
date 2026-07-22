# Scaling

## Default: single replica

Out of the box FHIRBridge runs as **one API process**. With no `REDIS_URL`, the
following state lives **in that process's memory**:

- Export/summary job records (with a 10-minute TTL)
- Idempotency keys
- Rate-limit counters

This is correct and safe for a single replica. It does **not** work across multiple
replicas, because each process has its own copy of that state.

## Multiple replicas REQUIRE Redis

If you run more than one API replica (behind a load balancer / in an orchestrator),
you **must** set `REDIS_URL`. Without it, replicas silently diverge:

- **Exports/summaries** — a client that starts a job on replica A and polls replica B
  gets `404`, because B has never heard of that job (the record only exists in A's
  memory).
- **Idempotency** — the same request replayed to a different replica is treated as
  new; the dedup guarantee is lost.
- **Rate limiting** — each replica counts independently, so the effective limit is
  `N × RATE_LIMIT_PER_MINUTE` and per-user/IP throttling leaks.

Point every replica at the same Redis:

```bash
REDIS_URL=redis://:<password>@redis-host:6379
```

Include the password in the URL — the shipped Redis config requires auth. For TLS in
transit use the `rediss://` scheme against a TLS-enabled Redis (or an stunnel/proxy
in front):

```bash
REDIS_URL=rediss://:<password>@redis-host:6380
```

> Redis persistence stays disabled and its `/data` is tmpfs even when shared — cached
> records (which can hold PHI for their TTL) remain in RAM only. Scaling out does not
> weaken the zero-PHI-at-rest invariant.

### Shared vs per-replica state summary

| State                  | No `REDIS_URL` (single replica) | With `REDIS_URL` (multi-replica) |
| ---------------------- | ------------------------------- | -------------------------------- |
| Export/summary records | In-process memory, 10-min TTL   | Shared in Redis, 10-min TTL      |
| Idempotency keys       | In-process memory               | Shared in Redis                  |
| Rate-limit counters    | In-process memory               | Shared in Redis                  |
| Audit log              | Postgres (or stdout)            | Postgres (or stdout)             |

## Postgres under scale-out

All replicas share **one** audit database via `DATABASE_URL`. Postgres is the durable
tier; size its connection pool for the total replica count. The audit table is
append-only and index-covered for the hot query paths (`user_id_hash`, `timestamp`,
`action`). See [backup-restore.md](backup-restore.md) for retention/purge.

## Metrics are per-replica

`/metrics` (Prometheus) is exposed **per process** and reports only that replica's
counters — it is not aggregated. When scraping:

- Give each replica a distinct scrape target (per-pod/per-container), and let
  Prometheus aggregate across them. Do not scrape a single load-balanced endpoint and
  assume it represents the fleet — you'll hit a different replica each scrape.
- `/metrics` is guarded by `METRICS_BEARER_TOKEN` when set; set it in production and
  configure the scraper with the same bearer token.

## Load balancing

The API is stateless once `REDIS_URL` is set, so any balancing policy works (no
sticky sessions required). Keep the reverse-proxy streaming settings from
[reverse-proxy.md](reverse-proxy.md) (no response buffering, long read timeouts) on
every front-end so large NDJSON exports stream correctly regardless of which replica
serves them.
