$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot
$destino = Join-Path $raiz '.env'
$exemplo = Join-Path $raiz '.env.example'
$utf8 = New-Object System.Text.UTF8Encoding $false

function Aleatorio([int]$tamanho) {
    $letras = [char[]]'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    $bytes = New-Object byte[] $tamanho
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    -join ($bytes | ForEach-Object { $letras[$_ % $letras.Length] })
}

if (-not (Test-Path $destino)) {
    $conteudo = Get-Content $exemplo -Raw
    $conteudo = $conteudo -replace '(?m)^BENTO_DB_SENHA=.*$', ('BENTO_DB_SENHA=' + (Aleatorio 32))
    $conteudo = $conteudo -replace '(?m)^BENTO_SEGREDO_JWT=.*$', ('BENTO_SEGREDO_JWT=' + (Aleatorio 64))
    $conteudo = $conteudo -replace '(?m)^BENTO_ANALISE_TOKEN=.*$', ('BENTO_ANALISE_TOKEN=' + (Aleatorio 48))
    [System.IO.File]::WriteAllText($destino, $conteudo, $utf8)
    Write-Host 'Arquivo .env criado com senha e chaves aleatorias.'
    exit 0
}

$atual = [System.IO.File]::ReadAllText($destino)
$existentes = @{}
foreach ($linha in ($atual -split "`r?`n")) {
    if ($linha -match '^\s*([A-Z0-9_]+)=') { $existentes[$Matches[1]] = $true }
}
$novas = New-Object System.Collections.Generic.List[string]
$nomes = New-Object System.Collections.Generic.List[string]
foreach ($linha in (Get-Content $exemplo)) {
    if ($linha -notmatch '^([A-Z0-9_]+)=(.*)$') { continue }
    $nome = $Matches[1]
    if ($existentes.ContainsKey($nome) -or $nome -eq 'BENTO_SEGREDO_JWT' -or $nome -eq 'BENTO_DB_SENHA') { continue }
    if ($nome -eq 'BENTO_ANALISE_TOKEN') { $linha = $nome + '=' + (Aleatorio 48) }
    $novas.Add($linha)
    $nomes.Add($nome)
}
if ($novas.Count -gt 0) {
    $separador = if ($atual.Length -gt 0 -and -not $atual.EndsWith("`n")) { "`n" } else { '' }
    [System.IO.File]::AppendAllText($destino, $separador + ($novas -join "`n") + "`n", $utf8)
    Write-Host ('Variaveis novas acrescentadas ao .env: ' + ($nomes -join ', '))
}
