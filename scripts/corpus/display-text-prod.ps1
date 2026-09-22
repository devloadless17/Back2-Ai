# Loads the new science display text into PRODUCTION.
#   Run from the bac2 folder:
#     powershell -ExecutionPolicy Bypass -File scripts/corpus/display-text-prod.ps1 -Mode trial   # writes nothing
#     powershell -ExecutionPolicy Bypass -File scripts/corpus/display-text-prod.ps1 -Mode apply   # writes
#     powershell -ExecutionPolicy Bypass -File scripts/corpus/display-text-prod.ps1 -Mode rollback -Run <run>
# The connection string is never printed, and is cleared when the script ends.
#
# ALWAYS ROLL PRODUCTION BACK THROUGH THIS SCRIPT. The run prints an `npm run`
# rollback line, and npm reads .env — which points at the LOCAL database, so
# that line would undo the wrong one.
param([ValidateSet('trial', 'apply', 'rollback')][string]$Mode = 'trial', [string]$Run)

$line = Select-String -Path .env.prod -Pattern '^PROD_DATABASE_URL=' | Select-Object -First 1
if (-not $line) { Write-Host 'No PROD_DATABASE_URL in .env.prod'; exit 1 }
$env:DATABASE_URL = $line.Line.Split('=', 2)[1]

try {
  $cmd = @('--conditions=react-server', '--env-file=.env', '--import', 'tsx', 'scripts/corpus/load-display-text.ts')
  if ($Mode -eq 'apply') { $cmd += @('--apply', '--confirm-db', 'neondb') }
  if ($Mode -eq 'rollback') {
    if (-not $Run) { Write-Host 'Rollback needs -Run <run id>, the one the apply printed.'; exit 1 }
    $cmd += @('--rollback', $Run, '--confirm-db', 'neondb')
  }
  & node @cmd
  exit $LASTEXITCODE
}
finally {
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
}
