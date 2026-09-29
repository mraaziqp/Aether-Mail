#!/usr/bin/env bash
#
# Take AetherMail + business mail for arpcloudsolutions.co.za live, end to end:
#
#   1. Resend    — add the domain (sending + receiving), read its DNS records
#   2. Route 53  — write those records, the aethermail. A record, SPF and DMARC
#   3. Resend    — verify the domain; create the inbound (email.received) webhook
#   4. Vercel    — set the environment, attach the subdomain, deploy to production
#   5. GitHub    — set the secrets the 5-minute sync workflow needs (if gh is set up)
#   6. Check     — DNS, HTTPS, database, and print what to test next
#
# Safe to re-run: every step reads current state first and only changes what is
# missing. Nothing secret is written to disk except Route 53 zone backups.
#
# Usage (from the repo root, on a machine logged in to AWS and Vercel):
#
#   aws login                      # or any valid AWS credentials for the Route 53 zone
#   npx vercel login
#   export RESEND_API_KEY=re_...   # a FULL-ACCESS key (send-only keys cannot read received mail)
#   export DATABASE_URL=postgres://...   # first run, or to move to another Neon project
#   ./scripts/go-live.sh --dry-run       # show everything it would do
#   ./scripts/go-live.sh                 # do it
#
# Optional overrides: DOMAIN, APP_HOST, VERCEL_PROJECT, VERCEL_SCOPE, RESEND_REGION,
# BUSINESS_NAME, BUSINESS_MAILBOXES, ADMIN_PASSWORD, RESEND_INBOUND_MX.

set -euo pipefail

DOMAIN="${DOMAIN:-arpcloudsolutions.co.za}"
APP_HOST="${APP_HOST:-aethermail.${DOMAIN}}"
APP_URL="https://${APP_HOST}"
VERCEL_PROJECT="${VERCEL_PROJECT:-aethermail}"
# Team that owns the project (from the Vercel preview on the PR).
VERCEL_SCOPE="${VERCEL_SCOPE:-moparks-projects-5fd3a0cd}"
RESEND_REGION="${RESEND_REGION:-us-east-1}"
RESEND_API="${RESEND_API_URL:-https://api.resend.com}"
BUSINESS_NAME="${BUSINESS_NAME:-ARP Cloud Solutions}"
BUSINESS_MAILBOXES="${BUSINESS_MAILBOXES:-contact,info,sales,billing}"
SENDER="contact@${DOMAIN}"
VERCEL_IP="76.76.21.21"
DRY=false
[[ "${1:-}" == "--dry-run" ]] && DRY=true

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

say()  { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
fail() { printf '\n\033[31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }
rand() { openssl rand -base64 "${1:-32}" | tr -d '\n=/+' | cut -c1-"${2:-44}"; }

VERCEL_BIN="${VERCEL_BIN:-npx --yes vercel@latest}"
vc() { if [[ -n "${VERCEL_SCOPE:-}" ]]; then $VERCEL_BIN --scope "$VERCEL_SCOPE" "$@"; else $VERCEL_BIN "$@"; fi; }

# resend METHOD PATH [JSON] → body on stdout, HTTP status in $WORK/status
resend() {
  : > "$WORK/body"
  local args=(-sS -o "$WORK/body" -w '%{http_code}' -X "$1" "$RESEND_API$2" -H "Authorization: Bearer $RESEND_API_KEY")
  [[ -n "${3:-}" ]] && args+=(-H 'Content-Type: application/json' -d "$3")
  curl "${args[@]}" > "$WORK/status" || echo 000 > "$WORK/status"
  cat "$WORK/body"
}
rstatus() { cat "$WORK/status"; }

# ------------------------------------------------------------------ preflight
say "Preflight"
for c in curl jq aws dig openssl npx python3; do command -v "$c" >/dev/null || fail "$c is required"; done
[[ -n "${RESEND_API_KEY:-}" ]] || fail "export RESEND_API_KEY=re_... (full access) first"
aws sts get-caller-identity >/dev/null 2>&1 || fail "AWS credentials missing or expired — run: aws login"
ZONE_ID=$(aws route53 list-hosted-zones --query "HostedZones[?Name=='${DOMAIN}.'].Id | [0]" --output text)
[[ -n "$ZONE_ID" && "$ZONE_ID" != "None" ]] || fail "no Route 53 hosted zone for ${DOMAIN} in this AWS account"
ZONE_ID="${ZONE_ID#/hostedzone/}"
ok "Route 53 zone ${ZONE_ID}"
vc whoami >/dev/null 2>&1 || fail "Vercel CLI not logged in — run: npx vercel login"
ok "Vercel: $(vc whoami 2>/dev/null | tail -1)"

resend GET /domains >/dev/null
case "$(rstatus)" in
  200) ok "Resend key has full access" ;;
  401|403) fail "Resend rejected the key for domain management ($(jq -r '.message // .name // empty' "$WORK/body")). Create a Full-access key at resend.com/api-keys." ;;
  *) fail "Resend API unreachable (HTTP $(rstatus))" ;;
esac

# --------------------------------------------------------------- 1. Resend domain
say "1. Resend domain ${DOMAIN}"
DOMAIN_ID=$(jq -r --arg d "$DOMAIN" '.data[]? | select(.name==$d) | .id' "$WORK/body" | head -1)
if [[ -z "$DOMAIN_ID" ]]; then
  if $DRY; then warn "would create domain ${DOMAIN} in ${RESEND_REGION}"; else
    resend POST /domains "$(jq -nc --arg n "$DOMAIN" --arg r "$RESEND_REGION" '{name:$n, region:$r}')" >/dev/null
    [[ "$(rstatus)" =~ ^20 ]] || fail "could not add domain: $(cat "$WORK/body")"
    DOMAIN_ID=$(jq -r '.id' "$WORK/body")
    ok "domain added ($DOMAIN_ID)"
  fi
else
  ok "domain already in Resend ($DOMAIN_ID)"
fi

if [[ -n "$DOMAIN_ID" ]]; then
  # Receiving is a per-domain capability. Ask for it; older API versions may
  # not accept the field, in which case it is switched on in the dashboard.
  if ! $DRY; then
    resend PATCH "/domains/$DOMAIN_ID" '{"capabilities":{"sending":"enabled","receiving":"enabled"}}' >/dev/null
    [[ "$(rstatus)" =~ ^20 ]] && ok "receiving enabled" || warn "could not enable receiving via API (HTTP $(rstatus)): $(jq -r '.message // empty' "$WORK/body")"
  fi
  resend GET "/domains/$DOMAIN_ID" > "$WORK/domain.json"
  [[ "$(rstatus)" == 200 ]] || fail "could not read domain: $(cat "$WORK/domain.json")"
  jq -r '.records[]? | "    \(.record // "-")\t\(.type)\t\(.name)\t\(.priority // "")\t\(.value[0:60])\t\(.status // "")"' "$WORK/domain.json"
else
  echo '{"records":[]}' > "$WORK/domain.json"
fi

# ------------------------------------------------------------------ 2. Route 53
say "2. DNS records in Route 53"
BACKUP_DIR="$HERE/scripts/dns-backups"; mkdir -p "$BACKUP_DIR"
BACKUP="$BACKUP_DIR/${DOMAIN}-$(date -u +%Y%m%dT%H%M%SZ).json"
aws route53 list-resource-record-sets --hosted-zone-id "$ZONE_ID" > "$BACKUP"
ok "zone backed up to ${BACKUP#$HERE/}"

# Build one change batch from: Resend's records + app A record + SPF + DMARC.
# Rules that protect existing mail: apex TXT is merged (never replaced), and an
# existing apex MX that is not Resend's stops the script unless FORCE_MX=1.
python3 - "$WORK/domain.json" "$BACKUP" "$DOMAIN" "$APP_HOST" "$VERCEL_IP" "${RESEND_INBOUND_MX:-}" "${FORCE_MX:-0}" > "$WORK/batch.json" <<'PY'
import json, sys
dom_file, zone_file, domain, app_host, vercel_ip, inbound_mx, force_mx = sys.argv[1:8]
records = json.load(open(dom_file)).get('records') or []
zone = json.load(open(zone_file))['ResourceRecordSets']
apex = domain + '.'

def fqdn(name):
    name = (name or '').strip().rstrip('.')
    if name in ('', '@', domain): return apex
    if name.endswith('.' + domain): return name + '.'
    return f'{name}.{domain}.'

def live(name, typ):
    for r in zone:
        if r['Name'] == name and r['Type'] == typ:
            return [v['Value'] for v in r.get('ResourceRecords', [])]
    return []

def txt(value):
    v = value.strip()
    if v.startswith('"') and v.endswith('"'): v = v[1:-1]
    return ' '.join('"%s"' % v[i:i+255] for i in range(0, len(v), 255))

want = {}   # (name, type) -> set of values
def add(name, typ, value):
    want.setdefault((name, typ), [])
    if value not in want[(name, typ)]: want[(name, typ)].append(value)

for r in records:
    typ = r.get('type'); name = fqdn(r.get('name'))
    if typ == 'MX':
        add(name, 'MX', f"{r.get('priority', 10)} {r['value'].rstrip('.')}")
    elif typ == 'TXT':
        add(name, 'TXT', txt(r['value']))
    elif typ == 'CNAME':
        add(name, 'CNAME', r['value'])

if inbound_mx and not any(t == 'MX' and n == apex for (n, t) in want):
    add(apex, 'MX', inbound_mx if ' ' in inbound_mx else f'10 {inbound_mx}')

add(app_host + '.', 'A', vercel_ip)

# SPF: keep whatever apex TXT exists, make sure SPF allows Resend (SES).
apex_txt = live(apex, 'TXT')
spf = [v for v in apex_txt if 'v=spf1' in v]
others = [v for v in apex_txt if 'v=spf1' not in v]
if spf:
    s = spf[0].strip('"')
    if 'include:amazonses.com' not in s:
        s = s.replace('v=spf1', 'v=spf1 include:amazonses.com', 1)
    new_spf = f'"{s}"'
else:
    new_spf = '"v=spf1 include:amazonses.com ~all"'
for v in others + [new_spf] + want.get((apex, 'TXT'), []):
    add(apex, 'TXT', v)

if not live('_dmarc.' + apex, 'TXT'):
    add('_dmarc.' + apex, 'TXT', f'"v=DMARC1; p=quarantine; pct=100; adkim=r; aspf=r; rua=mailto:contact@{domain}"')

changes, notes = [], []
for (name, typ), values in want.items():
    current = live(name, typ)
    if typ == 'MX' and name == apex and current and sorted(current) != sorted(values):
        if not any('amazonaws' in c or 'resend' in c for c in current) and force_mx != '1':
            notes.append(f'REFUSE apex MX: live {current} would be replaced by {values}. Re-run with FORCE_MX=1 if intended.')
            continue
    if typ == 'A' and live(name, 'CNAME'):
        notes.append(f'REFUSE {name}: a CNAME exists there; delete it in Route 53 first.')
        continue
    if sorted(current) == sorted(values):
        notes.append(f'unchanged {typ} {name}')
        continue
    changes.append({'Action': 'UPSERT', 'ResourceRecordSet': {
        'Name': name, 'Type': typ, 'TTL': 300 if typ in ('A', 'CNAME') else 3600,
        'ResourceRecords': [{'Value': v} for v in values]}})
    notes.append(f'SET {typ} {name} -> {" | ".join(values)}' + (f'   (was {" | ".join(current)})' if current else ''))

has_mx = any(t == 'MX' and n == apex for (n, t) in want) or live(apex, 'MX')
print(json.dumps({'Comment': 'AetherMail go-live (Resend + Vercel)', 'Changes': changes, '_notes': notes, '_has_apex_mx': bool(has_mx)}))
PY

jq -r '._notes[]' "$WORK/batch.json" | sed 's/^/    /'
grep -q '"REFUSE' "$WORK/batch.json" && fail "refusing to overwrite records listed above"
if [[ "$(jq -r '._has_apex_mx' "$WORK/batch.json")" != "true" ]]; then
  warn "Resend did not return a receiving MX record. Enable Receiving for ${DOMAIN} in the"
  warn "Resend dashboard (Domains → ${DOMAIN}), then re-run — or pass RESEND_INBOUND_MX=<host> from there."
fi

N=$(jq '.Changes | length' "$WORK/batch.json")
if [[ "$N" -gt 0 ]] && ! $DRY; then
  jq '{Comment, Changes}' "$WORK/batch.json" > "$WORK/change.json"
  CHANGE=$(aws route53 change-resource-record-sets --hosted-zone-id "$ZONE_ID" --change-batch "file://$WORK/change.json" --query ChangeInfo.Id --output text)
  aws route53 wait resource-record-sets-changed --id "$CHANGE"
  ok "$N record set(s) written and INSYNC"
else
  ok "$N change(s) $($DRY && echo 'would be made' || echo 'needed')"
fi

# ------------------------------------------------------ 3. verify + inbound webhook
say "3. Resend verification and inbound webhook"
WEBHOOK_SECRET="${RESEND_WEBHOOK_SECRET:-}"
if ! $DRY && [[ -n "$DOMAIN_ID" ]]; then
  resend POST "/domains/$DOMAIN_ID/verify" >/dev/null || true
  for i in $(seq 1 30); do
    resend GET "/domains/$DOMAIN_ID" > "$WORK/domain.json"
    st=$(jq -r '.status' "$WORK/domain.json")
    [[ "$st" == "verified" ]] && break
    [[ "$i" == 1 ]] && printf '  waiting for Resend to see the records'
    printf '.'; sleep 10
  done; echo
  st=$(jq -r '.status' "$WORK/domain.json")
  [[ "$st" == "verified" ]] && ok "domain verified" || warn "domain status: $st — DNS can take up to an hour; re-run later to confirm (sending falls back until then)"

  HOOK_URL="${APP_URL}/api/webhooks/resend"
  resend GET /webhooks > "$WORK/hooks.json"
  if [[ "$(rstatus)" == 200 ]]; then
    HOOK_ID=$(jq -r --arg u "$HOOK_URL" '.data[]? | select(.endpoint==$u) | .id' "$WORK/hooks.json" | head -1)
    if [[ -n "$HOOK_ID" && -z "$WEBHOOK_SECRET" ]]; then
      # The signing secret is only shown at creation: recreate so it can be stored.
      resend DELETE "/webhooks/$HOOK_ID" >/dev/null; HOOK_ID=""
    fi
    if [[ -z "$HOOK_ID" ]]; then
      resend POST /webhooks "$(jq -nc --arg u "$HOOK_URL" '{endpoint:$u, events:["email.received"]}')" > "$WORK/hook.json"
      if [[ "$(rstatus)" =~ ^20 ]]; then
        WEBHOOK_SECRET=$(jq -r '.signing_secret // .secret // empty' "$WORK/hook.json")
        ok "webhook created → ${HOOK_URL}"
      else
        warn "could not create the webhook via API: $(cat "$WORK/hook.json")"
      fi
    else
      ok "webhook already exists → ${HOOK_URL}"
    fi
  else
    warn "webhook API unavailable (HTTP $(rstatus))."
  fi
  [[ -n "$WEBHOOK_SECRET" ]] || warn "Create it in the Resend dashboard (Webhooks → ${HOOK_URL}, event email.received) and re-run with RESEND_WEBHOOK_SECRET=whsec_..."
else
  ok "skipped in dry run"
fi

# ------------------------------------------------------------------- 4. Vercel
say "4. Vercel project ${VERCEL_PROJECT}"
cd "$HERE"
vc link --yes --project "$VERCEL_PROJECT" >/dev/null 2>&1 || fail "could not link Vercel project '${VERCEL_PROJECT}' (set VERCEL_PROJECT / VERCEL_SCOPE)"
ok "linked"
vc env pull "$WORK/current.env" --environment=production --yes >/dev/null 2>&1 || true
current() { [[ -f "$WORK/current.env" ]] && grep -E "^$1=" "$WORK/current.env" | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' || true; }

GENERATED_PASSWORD=""
declare -A SET
SET[RESEND_API_KEY]="$RESEND_API_KEY"
SET[AETHERMAIL_SENDER]="$SENDER"
SET[BUSINESS_NAME]="$BUSINESS_NAME"
SET[BUSINESS_DOMAIN]="$DOMAIN"
SET[BUSINESS_MAILBOXES]="$BUSINESS_MAILBOXES"
SET[APP_URL]="$APP_URL"
[[ -n "$WEBHOOK_SECRET" ]] && SET[RESEND_WEBHOOK_SECRET]="$WEBHOOK_SECRET"
[[ -n "${DATABASE_URL:-}" ]] && SET[DATABASE_URL]="$DATABASE_URL"
if [[ -n "${ADMIN_PASSWORD:-}" ]]; then SET[ADMIN_PASSWORD]="$ADMIN_PASSWORD"
elif [[ -z "$(current ADMIN_PASSWORD)" ]]; then GENERATED_PASSWORD="$(rand 24 20)"; SET[ADMIN_PASSWORD]="$GENERATED_PASSWORD"; fi
# Never rotate APP_SECRET implicitly: it encrypts stored mailbox passwords.
[[ -z "$(current APP_SECRET)" ]] && SET[APP_SECRET]="$(rand 48 48)"
CRON_SECRET_VALUE="$(current CRON_SECRET)"
if [[ -z "$CRON_SECRET_VALUE" ]]; then CRON_SECRET_VALUE="$(rand 32 40)"; SET[CRON_SECRET]="$CRON_SECRET_VALUE"; fi
[[ -n "${DATABASE_URL:-}" || -n "$(current DATABASE_URL)" ]] || fail "Vercel has no DATABASE_URL — export DATABASE_URL (Neon pooled URL) and re-run"

for k in "${!SET[@]}"; do
  if [[ "$(current "$k")" == "${SET[$k]}" ]]; then ok "$k unchanged"; continue; fi
  if $DRY; then warn "would set $k"; continue; fi
  vc env rm "$k" production --yes >/dev/null 2>&1 || true
  printf '%s' "${SET[$k]}" | vc env add "$k" production >/dev/null
  ok "$k set"
done

if $DRY; then warn "would attach ${APP_HOST} and deploy to production"; else
  vc domains add "$APP_HOST" "$VERCEL_PROJECT" >/dev/null 2>&1 || vc domains add "$APP_HOST" >/dev/null 2>&1 || warn "could not attach ${APP_HOST} automatically — add it under Project → Settings → Domains"
  ok "domain ${APP_HOST} attached"
  vc deploy --prod --yes > "$WORK/deploy.log" 2>&1 || { tail -30 "$WORK/deploy.log"; fail "deploy failed"; }
  ok "deployed: $(grep -Eo 'https://[^ ]+\.vercel\.app' "$WORK/deploy.log" | tail -1)"
fi

# ------------------------------------------------------------------- 5. GitHub
say "5. GitHub Actions secrets (5-minute mail sync)"
if command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then
  if $DRY; then warn "would set AETHERMAIL_URL and CRON_SECRET"; else
    gh secret set AETHERMAIL_URL --body "$APP_URL" >/dev/null && gh secret set CRON_SECRET --body "$CRON_SECRET_VALUE" >/dev/null && ok "secrets set"
  fi
else
  warn "gh CLI not logged in. Add repository secrets AETHERMAIL_URL=${APP_URL} and CRON_SECRET (same value as in Vercel)."
fi

# -------------------------------------------------------------------- 6. checks
say "6. Checks"
for q in "MX ${DOMAIN}" "TXT ${DOMAIN}" "TXT resend._domainkey.${DOMAIN}" "MX send.${DOMAIN}" "A ${APP_HOST}"; do
  set -- $q; printf '    %-4s %-40s %s\n' "$1" "$2" "$(dig +short "$1" "$2" @1.1.1.1 | tr '\n' ' ' | cut -c1-90)"
done
if ! $DRY; then
  for i in $(seq 1 18); do
    code=$(curl -s -o "$WORK/health" -w '%{http_code}' "${APP_URL}/api/health?deep=1" || true)
    [[ "$code" == 200 ]] && break; sleep 10
  done
  [[ "$code" == 200 ]] && ok "${APP_URL} is up, database ok" || warn "${APP_URL}/api/health?deep=1 → HTTP ${code}: $(cat "$WORK/health" 2>/dev/null | head -c 200) (certificate issuance can take a few minutes)"
fi

say "Done"
cat <<EOF
  App:        ${APP_URL}
  Sign in:    username mraaziqp (or ADMIN_USERNAME)$( [[ -n "$GENERATED_PASSWORD" ]] && printf '\n  Password:   %s   ← generated now; save it in your password manager' "$GENERATED_PASSWORD" )
  Mailboxes:  ${BUSINESS_MAILBOXES//,/, } @${DOMAIN} (any other address on the domain is captured too)

  Test it:
    1. From Gmail, send a message to ${SENDER} — it appears in AetherMail within seconds.
    2. Reply from AetherMail — check the reply's headers show spf=pass, dkim=pass, dmarc=pass.
EOF
