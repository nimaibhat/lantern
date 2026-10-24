// Windows Chrome can pick a Bluetooth device, but it cannot hear an iPhone
// advertisement. The file this builds listens on that laptop and posts dBm to the hub.
// A scriptblock passed to add_Received never fires. A real WinRT delegate does.

function utf16leBase64(text: string): string {
  let binary = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    binary += String.fromCharCode(code & 0xff, code >> 8);
  }
  return btoa(binary);
}

function earScript(deviceId: string, postUrl: string): string {
  if (!/^ear-[a-f0-9]{8}$/i.test(deviceId)) throw new Error("bad device");
  const post = postUrl.trim().replace(/\/$/, "");
  if (!/^https?:\/\/\S+\/api\/tracking$/.test(post)) throw new Error("bad url");
  return `
$ErrorActionPreference = "Continue"
$deviceId = "${deviceId}"
$post = "${post}"
Add-Type -TypeDefinition @'
public class LanternEar {
  public static int Rssi;
  public static long At;
  public static string Err = "";
  public static void OnReceived(object sender, object args) {
    try {
      var adv = args.GetType().GetProperty("Advertisement").GetValue(args, null);
      var name = adv.GetType().GetProperty("LocalName").GetValue(adv, null) as string ?? "";
      bool hit = name.ToLowerInvariant().Contains("lantern");
      if (!hit) {
        var uuids = adv.GetType().GetProperty("ServiceUuids").GetValue(adv, null) as System.Collections.IEnumerable;
        if (uuids != null) {
          foreach (var u in uuids) {
            if (u != null && u.ToString().ToLowerInvariant() == "4c414e54-4552-4e00-a000-000000000001") { hit = true; break; }
          }
        }
      }
      if (!hit) return;
      Rssi = System.Convert.ToInt32(args.GetType().GetProperty("RawSignalStrengthInDBm").GetValue(args, null));
      At = System.DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
      Err = "";
    } catch (System.Exception ex) {
      Err = ex.Message;
    }
  }
}
'@
[System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
$watcher = [Windows.Devices.Bluetooth.Advertisement.BluetoothLEAdvertisementWatcher,Windows.Devices.Bluetooth,ContentType=WindowsRuntime]::new()
$watcher.ScanningMode = [Windows.Devices.Bluetooth.Advertisement.BluetoothLEScanningMode,Windows.Devices.Bluetooth,ContentType=WindowsRuntime]::Active
$eventInfo = $watcher.GetType().GetEvent("Received")
$delegate = [Delegate]::CreateDelegate($eventInfo.EventHandlerType, [LanternEar].GetMethod("OnReceived"))
$token = $watcher.add_Received($delegate)
$pidFile = Join-Path $env:TEMP "lantern-ear.pid"
if (Test-Path $pidFile) {
  $old = Get-Content $pidFile -ErrorAction SilentlyContinue
  if ($old) { Stop-Process -Id $old -Force -ErrorAction SilentlyContinue }
}
Set-Content -Path $pidFile -Value $PID
try {
  Invoke-RestMethod -Uri $post -Method Post -Body ('{"action":"view","hub":false,"hostLocal":false,"pairShown":true,"error":"scanner-up ' + $deviceId + '","protocol":"https:"}') -ContentType "application/json" | Out-Null
} catch {}
try { $watcher.Start() } catch { Write-Output "Turn Bluetooth on for this computer."; exit 1 }
Write-Output "Listening for LanternTag. Leave this window open."
$lastPost = [int64]0
$told = $false
$paired = $false
while ($null -ne $delegate) {
  Start-Sleep -Milliseconds 400
  if (-not $told -and [LanternEar]::Err) { $told = $true; Write-Output ([LanternEar]::Err) }
  $at = [int64][LanternEar]::At
  if ($at -le 0) { continue }
  $now = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
  if (($now - $at) -gt 3000 -or ($now - $lastPost) -lt 1000) { continue }
  $lastPost = $now
  if (-not $paired) { $paired = $true; Write-Output "Paired with LanternTag." }
  $body = '{"action":"hear","deviceId":"' + $deviceId + '","rssi":' + [int][LanternEar]::Rssi + '}'
  try { Invoke-RestMethod -Uri $post -Method Post -Body $body -ContentType "application/json" | Out-Null }
  catch { Write-Output "Could not reach the hub." }
}
$watcher.remove_Received($token) | Out-Null
`.trim();
}

export function earBat(deviceId: string, postUrl: string, label: string): string {
  const title = (label.replace(/[^\w .'-]/g, "").trim() || "laptop").slice(0, 40);
  const command = utf16leBase64(earScript(deviceId, postUrl));
  return `@echo off\r\ntitle Lantern ${title}\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${command}\r\n`;
}

// A single EncodedCommand of this script is about 9000 characters. Wscript runs that
// line and PowerShell exits before it scans. Write the script in short pieces, then
// start it with a short command.
export function hiddenLauncher(script: string): string {
  const encoded = utf16leBase64(script);
  const chunks = encoded.match(/.{1,480}/g) ?? [];
  const writes = chunks.map((chunk) => `out.Write "${chunk}"`).join("\r\n");
  const command = [
    "$t=$env:TEMP",
    "$b=[IO.File]::ReadAllText((Join-Path $t 'lantern-ear.b64'))",
    "$s=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String(($b -replace '\\s','')))",
    "[IO.File]::WriteAllText((Join-Path $t 'lantern-ear.ps1'), $s)",
    "& (Join-Path $t 'lantern-ear.ps1')",
  ].join("; ");
  return [
    `Set shell = CreateObject("Wscript.Shell")`,
    `Set fso = CreateObject("Scripting.FileSystemObject")`,
    `folder = shell.ExpandEnvironmentStrings("%TEMP%")`,
    `Set out = fso.CreateTextFile(folder & "\\lantern-ear.b64", True)`,
    writes,
    `out.Close`,
    `shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command ""${command}""", 0, False`,
    ``,
  ].join("\r\n");
}

// Same listener as the bat, started with no window. Each Windows laptop runs its own copy.
export function earHidden(deviceId: string, postUrl: string, label: string): string {
  const file = hiddenLauncher(earScript(deviceId, postUrl));
  const run = file.split("shell.Run ")[1] ?? "";
  if (run.length > 4000) throw new Error("launcher command is too long");
  return file;
}
