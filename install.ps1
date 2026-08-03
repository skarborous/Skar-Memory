param(
  [Parameter(Position = 0)]
  [string]$Action = "install",
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Rest
)
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodeArgs = @("$Root\scripts\install-core.js", $Action) + $Rest
& node @nodeArgs
exit $LASTEXITCODE
