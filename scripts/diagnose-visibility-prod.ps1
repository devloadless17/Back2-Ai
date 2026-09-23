# Reads PRODUCTION and writes nothing.
#   powershell -ExecutionPolicy Bypass -File scripts/diagnose-visibility-prod.ps1
#
# Answers "why does this student see only the Arabic subjects?" against the
# database the question is actually about. The connection string is never
# printed, and is cleared when the script ends.
$line = Select-String -Path .env.prod -Pattern '^PROD_DATABASE_URL=' | Select-Object -First 1
if (-not $line) { Write-Host 'No PROD_DATABASE_URL in .env.prod'; exit 1 }
$env:DATABASE_URL = $line.Line.Split('=', 2)[1]

try {
  & node --conditions=react-server --env-file=.env --import tsx scripts/diagnose-track-visibility.ts
  exit $LASTEXITCODE
}
finally {
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
}
