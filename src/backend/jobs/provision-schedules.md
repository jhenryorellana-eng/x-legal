# QStash Schedule Provisioning

All schedules target `/api/webhooks/qstash/<jobKey>` and use the same
signature-verification pipeline as on-demand jobs (DOC-26 §3).

Run the commands below ONCE per environment (staging / production) via the
Upstash CLI or dashboard. Never create schedules manually without recording
them here.

## Full schedule catalog (DOC-26 §3)

| cron (UTC)       | jobKey                    | Payload                                             | Notes                                   |
|------------------|---------------------------|-----------------------------------------------------|-----------------------------------------|
| `0 11 * * *`     | `installment-reminders`   | `{jobKey,entityId:null,attempt:1,dedupeId:"installment-reminders:<YYYY-MM-DD>"}` | Before client work-day (06:00 ET) |
| `*/15 * * * *`   | `appointment-reminders`   | `{jobKey,entityId:null,attempt:1,dedupeId:"appointment-reminders:<ISO-15min-window>"}` | Sliding 15-min windows for 24h/1h reminders |
| `0 14 * * *`     | `contract-reminders`      | `{jobKey,entityId:null,attempt:1,dedupeId:"contract-reminders:<YYYY-MM-DD>"}` | 48h unsigned / 24h before expiry       |
| `0 */6 * * *`    | `retry-abogados-polling`  | `{jobKey,entityId:null,attempt:1,dedupeId:"retry-abogados-polling:<YYYY-MM-DD-HH>"}` | 4×/day webhook backup                  |
| `0 12 * * *`     | `ai-budget-aggregation`   | `{jobKey,entityId:null,attempt:1,dedupeId:"ai-budget-aggregation:<YYYY-MM-DD>"}` | Daily 80%/100% threshold alert         |
| `0 13 1 * *`     | `ai-budget-aggregation`   | `{jobKey,entityId:null,attempt:1,dedupeId:"ai-budget-aggregation:<YYYY-MM>:close",mode:"monthly-close"}` | Monthly close day 1 |
| `0 7 * * *`      | `purge-retention`         | `{jobKey,entityId:null,attempt:1,dedupeId:"purge-retention:<YYYY-MM-DD>"}` | 02:00 ET, low traffic                  |

## Provisioning commands (Upstash CLI)

```bash
# appointment-reminders — every 15 minutes
upstash qstash schedule create \
  --cron "*/15 * * * *" \
  --url "${APP_URL}/api/webhooks/qstash/appointment-reminders" \
  --body '{"jobKey":"appointment-reminders","entityId":null,"attempt":1,"dedupeId":"appointment-reminders:__window__"}' \
  --retries 0

# installment-reminders — daily 11:00 UTC
upstash qstash schedule create \
  --cron "0 11 * * *" \
  --url "${APP_URL}/api/webhooks/qstash/installment-reminders" \
  --body '{"jobKey":"installment-reminders","entityId":null,"attempt":1,"dedupeId":"installment-reminders:__date__"}' \
  --retries 1

# contract-reminders — daily 14:00 UTC
upstash qstash schedule create \
  --cron "0 14 * * *" \
  --url "${APP_URL}/api/webhooks/qstash/contract-reminders" \
  --body '{"jobKey":"contract-reminders","entityId":null,"attempt":1,"dedupeId":"contract-reminders:__date__"}' \
  --retries 2
```

Notes:
- Replace `__window__` / `__date__` with a timestamp injected by QStash or
  use a fixed placeholder; the handler derives the actual window from `now`.
- The `dedupeId` in the payload is for the `webhook_events` row; QStash's own
  dedup window (24h) handles burst protection at the queue level.
- `retries 0` for `appointment-reminders`: a late retry outside the 15-min
  window would send stale reminders (DOC-26 §5.1).
- `appointment-reminders` is registered in `src/backend/jobs/registry.ts` and
  handled by `src/backend/jobs/appointment-reminders.ts`.
