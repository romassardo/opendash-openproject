# Abre el puerto de OpenDash (TCP 5174) en el firewall de Windows para la red privada y de dominio, solo desde la red local.
# Hay que correrlo en un PowerShell abierto como administrador.
$ErrorActionPreference = 'Stop'
$puerto = 5174
$nombre = 'OpenDash'

$identidad = [Security.Principal.WindowsIdentity]::GetCurrent()
$esAdmin = ([Security.Principal.WindowsPrincipal]$identidad).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $esAdmin) {
    Write-Host 'Abrí PowerShell como administrador y volvé a correr este script' -ForegroundColor Yellow
    exit 1
}

$existentes = @(Get-NetFirewallRule -DisplayName $nombre -ErrorAction SilentlyContinue)
if ($existentes.Count -gt 0) {
    $correcta = $false
    foreach ($regla in $existentes) {
        $puertos = (Get-NetFirewallPortFilter -AssociatedNetFirewallRule $regla).LocalPort
        $perfiles = [string]$regla.Profile
        $remotas = (Get-NetFirewallAddressFilter -AssociatedNetFirewallRule $regla).RemoteAddress
        if ($regla.Enabled -eq 'True' -and $regla.Direction -eq 'Inbound' -and $regla.Action -eq 'Allow' -and "$puertos" -eq "$puerto" -and $perfiles -match 'Private' -and $perfiles -match 'Domain' -and "$remotas" -eq 'LocalSubnet') {
            $correcta = $true
        }
    }
    if ($correcta) {
        Write-Host "La regla '$nombre' ya existe: no hace falta hacer nada."
    } else {
        Write-Host "Ya existe una regla '$nombre' pero no coincide (puerto $puerto, entrada, permitir, perfiles privado y de dominio, solo desde la red local, activa)." -ForegroundColor Yellow
        Write-Host "Borrala con: netsh advfirewall firewall delete rule name=`"$nombre`" y volvé a correr este script." -ForegroundColor Yellow
        exit 1
    }
} else {
    netsh advfirewall firewall add rule name="$nombre" dir=in action=allow protocol=TCP localport=$puerto profile=private,domain remoteip=localsubnet | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "No se pudo crear la regla '$nombre'." -ForegroundColor Red
        exit 1
    }
    Write-Host "Regla '$nombre' creada: TCP $puerto entrante en redes privadas y de dominio, solo desde la red local."
}

# Si alguna vez se canceló el aviso de Windows sobre node.exe, quedó una regla que lo bloquea y le gana a esta.
$bloqueos = @(Get-NetFirewallApplicationFilter | Where-Object { $_.Program -like '*\node.exe' } | Get-NetFirewallRule |
    Where-Object { $_.Direction -eq 'Inbound' -and $_.Action -eq 'Block' -and $_.Enabled -eq 'True' })
if ($bloqueos.Count -gt 0) {
    Write-Host ''
    Write-Host "Hay $($bloqueos.Count) regla(s) que bloquean node.exe (se canceló el aviso de Windows) y le ganan a '$nombre'." -ForegroundColor Yellow
    Write-Host 'Hasta borrarlas nadie va a poder entrar. Para borrarlas:' -ForegroundColor Yellow
    Write-Host "  Get-NetFirewallApplicationFilter | Where-Object { `$_.Program -like '*\node.exe' } | Get-NetFirewallRule | Where-Object { `$_.Direction -eq 'Inbound' -and `$_.Action -eq 'Block' } | Remove-NetFirewallRule" -ForegroundColor Yellow
}

Write-Host ''
Write-Host 'Pasale estas direcciones a tus compañeros:'
Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' -and $_.InterfaceAlias -notmatch 'vEthernet|WSL|Hyper-V|Loopback|VirtualBox|VMware' } |
    ForEach-Object { Write-Host "  http://$($_.IPAddress):$puerto" }
