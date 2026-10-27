# Provider field inventory

Every field the desklet can read, per provider and per source. Verified live on
the target (`javi-mbair`) on **2026-10-27** with the user's own logins
(Claude **Pro**, ChatGPT **Free**, Ollama cloud **legacy tier**). Shapes for
other tiers are marked *documented* or *unverified*.

Legend for the **Card** column: **hero** = main number, **meter** = a bar,
**detail** = secondary line, **badge** = small label, **—** = not useful.

---

## 1. Claude

### 1.1 `~/.claude/.credentials.json` (local, read every refresh)

| Field | Example | Meaning | Card |
|---|---|---|---|
| `claudeAiOauth.accessToken` | *(secret)* | Bearer for the OAuth endpoints. ~8 h life; the `claude` CLI renews it in place. | — |
| `claudeAiOauth.expiresAt` | `1793168388193` (ms) | Token expiry. Past it → "run `claude` once". | detail (stale hint) |
| `claudeAiOauth.refreshToken` / `refreshTokenExpiresAt` | *(secret)* | **Not used.** Refreshing from the desklet would rotate it and log the CLI out. | — |
| `claudeAiOauth.subscriptionType` | `"pro"` | Plan name. | badge |
| `claudeAiOauth.rateLimitTier` | `"default_claude_ai"` | Rate-limit tier. | — |
| `claudeAiOauth.scopes[]` | `user:inference`, … | OAuth scopes. | — |

### 1.2 `GET api.anthropic.com/api/oauth/usage` (undocumented; OAuth + `anthropic-beta: oauth-2025-04-20`)

| Field | Example | Meaning | Card |
|---|---|---|---|
| `five_hour.utilization` | `3.0` (0–100) | 5-hour rolling window used %. | **meter** |
| `five_hour.resets_at` | ISO | When the 5 h window resets. | detail ("resets in 2h 41m") |
| `seven_day.utilization` | `16.0` | Weekly (all models) used %. | **meter** |
| `seven_day.resets_at` | ISO | Weekly reset. | detail |
| `seven_day_opus` / `seven_day_sonnet` / `seven_day_oauth_apps` / `seven_day_cowork` | `null` on Pro | Per-model / per-surface weekly caps (Max plans). Same `{utilization, resets_at}` shape. | meter when non-null |
| `*.limit_dollars` / `used_dollars` / `remaining_dollars` / `locked_reason` | `null` on the 5h/7d meters | Dollar-capped meters (seen on a promo meter only). | — |
| `limits[]` → `{kind, group, percent, severity, resets_at, is_active}` | `session` 3 % `normal`; `weekly_all` 16 % `normal`, `is_active: true` | Modern form of the same meters. **`severity`** (`normal`/…) is the server's own warning level; **`is_active`** marks the limit currently binding. | meter colour from `severity`; highlight active |
| `extra_usage.{is_enabled, monthly_limit, used_credits, utilization, currency}` | disabled | Pay-as-you-go overflow credits. | detail when enabled |
| `spend.{used.amount_minor, currency, exponent, limit, percent, enabled}` | 0 USD, disabled | Credit spend beyond the plan. | detail when enabled |
| `seven_day_breakdown.rows[]` → `{key, display_name, percent}` | Claude Code 100 %, Chats 0 %, Cowork 0 %, Other 0 % | **Where the weekly usage went**, by surface. | detail (stacked bar / list) |
| `seven_day_breakdown.window_started_at` / `as_of` | ISO | Window bounds of that breakdown. | — |
| Codename keys (`iguana_necktie`, `tangelo`, `amber_gauge`, `pace`, …) | mostly `null`; one had `limit_dollars: 100` | Internal/promo meters, undocumented. | — (ignore) |

### 1.3 `GET api.anthropic.com/api/oauth/profile` (undocumented)

| Field | Example | Card |
|---|---|---|
| `organization.organization_type` | `"claude_pro"` | badge (plan) |
| `organization.subscription_status` | `"active"` | badge if not active |
| `organization.has_extra_usage_enabled` | `false` | — |
| `account.has_claude_pro` / `has_claude_max` | `true` / `false` | — (badge covers it) |
| `account.email`, `full_name`, uuids | *(personal)* | — (never shown) |

### 1.4 `~/.claude/projects/*/*.jsonl` (local transcripts)

One line per API response; dedupe by `message.id` + `requestId` (streamed chunks repeat).

| Field | Example | Card |
|---|---|---|
| `timestamp` | ISO | window filter (5h / 24h / 7d), sparkline |
| `message.model` | `claude-opus-5-5`, `claude-opus-4-8`, **`mistral-large-4`**, `<synthetic>` | per-model split. **Non-`claude-*` models are Claude Code running on Ollama** → count them on the Ollama card. |
| `message.usage.input_tokens` | | detail |
| `message.usage.output_tokens` | | **hero** (tokens) |
| `message.usage.cache_creation_input_tokens` (+ `cache_creation.ephemeral_5m/1h_input_tokens`) | | detail |
| `message.usage.cache_read_input_tokens` | | detail ("cache hit %") |
| `message.usage.output_tokens_details.thinking_tokens` | | detail |
| `message.usage.server_tool_use.web_search_requests` / `web_fetch_requests` | | detail |
| `message.usage.service_tier`, `speed`, `inference_geo` | `standard`, `standard`, `global` | — |
| `cwd`, `gitBranch`, `sessionId` | `agent-bill` (496 of 7 d) | detail ("top project") |
| `entrypoint`, `version` | `cli`, CLI version | — |

7-day sample (Claude models only): 132 turns, 106 k output, 9.2 M cache-read,
305 k cache-write. Sample for Ollama-routed `mistral-large-4`: 489 turns, 13.3 M
input, 169 k output, 48 M cache-read.

### 1.5 Admin API (org admin key only; plan users get 403)

`GET /v1/organizations/usage_report/messages` → `data[].results[]` with
`uncached_input_tokens`, `cache_read_input_tokens`,
`cache_creation.ephemeral_{5m,1h}_input_tokens`, `output_tokens`, grouped by
1 h buckets. *Documented; not verifiable with a Pro login.*

### 1.6 Not used

- `anthropic-ratelimit-unified-5h/7d-*` response headers: only appear on a
  real Messages call, which would spend plan usage. Same data as 1.2.

---

## 2. Codex (ChatGPT plan)

### 2.1 `~/.codex/auth.json` (local, read every refresh)

| Field | Example | Card |
|---|---|---|
| `auth_mode` | `"chatgpt"` | — (`apikey` → no plan meters) |
| `tokens.access_token` | JWT, **~10 day** life, renewed by `codex` | — |
| `tokens.account_id` | uuid | sent as `chatgpt-account-id` header |
| `tokens.refresh_token`, `id_token` | *(secret)* | — (not used) |
| `last_refresh` | ISO | detail (stale hint) |
| JWT claim `https://api.openai.com/auth.chatgpt_plan_type` | `"free"` | badge |

### 2.2 `GET chatgpt.com/backend-api/wham/usage` (undocumented)

| Field | Example (Free) | Meaning | Card |
|---|---|---|---|
| `plan_type` | `"free"` | Plan. | badge |
| `rate_limit.allowed` / `limit_reached` | `true` / `false` | Currently blocked? | badge (red "limit reached") |
| `rate_limit.primary_window.used_percent` | `0` | Used % of the **primary** window. | **meter** |
| `rate_limit.primary_window.limit_window_seconds` | **`2592000` (30 days)** on Free; `18000` (5 h) on paid | Window length → label. | meter title |
| `rate_limit.primary_window.reset_at` / `reset_after_seconds` | unix s / s | Reset time. | detail |
| `rate_limit.secondary_window` | `null` on Free; 7-day (`604800`) on paid | Weekly window. | meter when non-null |
| `rate_limit_reached_type` | `null` | Which limit blocked you. | badge text |
| `credits.{has_credits, unlimited, balance, approx_local_messages, approx_cloud_messages}` | none | Purchased credits + "≈ N messages left". | detail when present |
| `model_usage` | `{}` | Per-model usage (empty so far). | detail when filled |
| `code_review_rate_limit`, `additional_rate_limits` | `null` | Extra meters (paid plans). | meter when non-null |
| `spend_control.{reached, individual_limit}` | `false`, `null` | Workspace spend cap. | badge if reached |
| `rate_limit_reset_credits.available_count` | `0` | Limit-reset credits. | — |
| `user_id`, `account_id`, `email` | *(personal)* | — | — |

### 2.3 `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` (local, *documented, none yet on this machine*)

`event_msg` with `payload.type == "token_count"` → `info.total_token_usage`
`{input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens,
total_tokens}` and often a `rate_limits` snapshot. Appears once `codex` is used
with sessions; would give a token hero like Claude's.

### 2.4 Admin API (org admin key only)

`GET /v1/organization/usage/completions` → `input_tokens`, `output_tokens`,
`input_cached_tokens`, `num_model_requests`, grouped by model.
*Documented; not verifiable with a ChatGPT login.*

---

## 3. Ollama cloud

### 3.1 `GET ollama.com/api/usage?range=24h|7d|30d[&group_by=model]` (documented)

| Field | Example (legacy tier) | Card |
|---|---|---|
| `totals.request_count` | 597 (24 h), 1346 (7 d) | **hero** |
| `buckets[].{from, until, request_count, partial}` | 25 hourly / 8 daily | **sparkline** |
| `granularity` | `hour` (24 h) / `day` (7 d, 30 d) | — |
| `totals.groups[]` → `{model, request_count}` (with `group_by=model`) | `mistral-large-4` 583, `web_search` 14 | detail (top models) |
| `buckets[].groups[]` | per-model per-bucket | stacked sparkline (optional) |
| `totals.input_tokens`, `cached_input_tokens`, `output_tokens`, `usage_usd` | **absent on legacy tier**; *documented* on paid | hero/detail on paid |

Rate limit: 10 req/min (`429` + `Retry-After`).

### 3.2 `GET ollama.com/api/balance`

| Field | Example (legacy) | Card |
|---|---|---|
| `included.session.remaining_percent` | `100` → **0 % used** | **meter** ("session") |
| `included.session.resets_at` | ISO | detail |
| `included.weekly.remaining_percent` | `45.57` → **54.4 % used** | **meter** ("weekly") |
| `included.weekly.resets_at` | ISO | detail |
| `purchased.balance_usd` | `0` | detail when > 0 |
| `included.{balance_usd, allowance_usd, period}` | *paid tier only (documented)* | meter (monthly $) |

### 3.3 Claude Code transcripts (see 1.4)

Turns whose `message.model` is not `claude-*` ran on Ollama. They supply the
**token counts** the legacy usage API does not report.

---

## 4. Summary: what each card can honestly show (this user, today)

| | Claude (Pro) | Codex (Free) | Ollama (legacy) |
|---|---|---|---|
| Short window meter | 5 h % + reset | 30-day % + reset | session % + reset |
| Weekly meter | 7 d % + reset | — (paid only) | weekly % + reset |
| Status / severity | `limits[].severity`, `is_active` | `allowed`, `limit_reached` | — |
| Volume hero | tokens from transcripts | — (until rollouts exist) | requests (API) + tokens (transcripts) |
| Trend | transcript sparkline | — | hourly/daily buckets |
| Breakdown | surface split (Code/Chat/…) + per-model | `model_usage` (empty) | per-model requests |
| Plan badge | `pro` | `free` | — |
| Money | extra-usage / spend (disabled) | credits (none) | purchased balance ($0) |
