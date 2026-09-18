#!/usr/bin/env bash
# Uploads a vet's logo to the "logos" Supabase Storage bucket and sets
# profiles.logo_url so the Shell picks it up for that account only.
#
# Requires migration 20260918000002_client_entity_fields_and_branding.sql to
# already be applied (adds profiles.logo_url + the logos bucket/policies).
#
# Usage: ./upload_logo.sh <email> <path-to-image>
set -euo pipefail

EMAIL="$1"
FILE="$2"
SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL:?Set NEXT_PUBLIC_SUPABASE_URL}"
SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:?Set SUPABASE_SERVICE_ROLE_KEY}"
EXT="${FILE##*.}"

echo "Looking up profile for $EMAIL..."
USER_ID=$(curl -s "$SUPABASE_URL/rest/v1/profiles?email=eq.$EMAIL&select=id" \
  -H "apikey: $SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['id'] if d else '')")

if [ -z "$USER_ID" ]; then
  echo "No profile found for $EMAIL — has that account been created yet?" >&2
  exit 1
fi

echo "Uploading $FILE to logos/$USER_ID/logo.$EXT..."
curl -s -X POST "$SUPABASE_URL/storage/v1/object/logos/$USER_ID/logo.$EXT" \
  -H "apikey: $SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: image/$EXT" \
  -H "x-upsert: true" \
  --data-binary "@$FILE" | python3 -m json.tool

LOGO_URL="$SUPABASE_URL/storage/v1/object/public/logos/$USER_ID/logo.$EXT"

echo "Setting profiles.logo_url = $LOGO_URL"
curl -s -X PATCH "$SUPABASE_URL/rest/v1/profiles?id=eq.$USER_ID" \
  -H "apikey: $SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d "{\"logo_url\": \"$LOGO_URL\"}" | python3 -m json.tool

echo "Done."
