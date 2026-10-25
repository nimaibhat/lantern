// Windows Chrome can pick a Bluetooth device, but it cannot hear an iPhone
// advertisement. The file this builds listens on that laptop and posts dBm to the hub.
// A scriptblock passed to add_Received never fires. A real WinRT delegate does.

// Next binds 0.0.0.0, so the request URL is not the address the other laptop opened.
export function originFor(request: Request): string {
  const url = new URL(request.url);
  const raw = (request.headers.get("x-forwarded-host") || request.headers.get("host") || "").split(",")[0]?.trim() ?? "";
  if (!raw || raw === "0.0.0.0" || raw.startsWith("0.0.0.0:")) return url.origin;
  const forwarded = request.headers.get("x-forwarded-proto");
  const proto = forwarded === "http" || forwarded === "https" ? forwarded : url.protocol.replace(":", "");
  return `${proto}://${raw}`;
}

function utf16leBase64(text: string): string {
  let binary = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    binary += String.fromCharCode(code & 0xff, code >> 8);
  }
  return btoa(binary);
}

export function earScript(deviceId: string, postUrl: string): string {
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
        try { hit = SectionHasLantern(adv); } catch { }
      }
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
  static bool SectionHasLantern(object adv) {
    var sections = adv.GetType().GetProperty("DataSections").GetValue(adv, null) as System.Collections.IEnumerable;
    if (sections == null) return false;
    foreach (var section in sections) {
      int type = System.Convert.ToInt32(section.GetType().GetProperty("DataType").GetValue(section, null));
      if (type != 8 && type != 9) continue;
      var buffer = section.GetType().GetProperty("Data").GetValue(section, null);
      if (buffer == null) continue;
      var asm = System.Reflection.Assembly.Load("System.Runtime.WindowsRuntime, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089");
      var ext = asm.GetType("System.Runtime.InteropServices.WindowsRuntime.WindowsRuntimeBufferExtensions");
      var toArray = ext.GetMethods()[0];
      foreach (var method in ext.GetMethods()) {
        if (method.Name == "ToArray" && method.GetParameters().Length == 1) { toArray = method; break; }
      }
      var bytes = (byte[])toArray.Invoke(null, new object[] { buffer });
      var text = System.Text.Encoding.UTF8.GetString(bytes).ToLowerInvariant();
      if (text.Contains("lantern")) return true;
    }
    return false;
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

// The scanner script is about 9000 characters. A downloaded file that long never
// starts. This file is short: the other laptop downloads it, then pulls the script.
// The window stays open so a Bluetooth or download error is visible.
/** PowerShell one-liner the user can paste into a terminal — no .bat file, no SmartScreen. */
export function earWinOneLiner(deviceId: string, postUrl: string): string {
  if (!/^ear-[a-f0-9]{8}$/i.test(deviceId)) throw new Error("bad device");
  const post = postUrl.trim().replace(/\/$/, "");
  if (!/^https?:\/\/\S+\/api\/tracking$/.test(post)) throw new Error("bad url");
  const earUrl = `${post}/ear?id=${deviceId.toLowerCase()}`;
  return `powershell -NoProfile -ExecutionPolicy Bypass -Command "[System.Net.ServicePointManager]::ServerCertificateValidationCallback={$true}; [System.Net.ServicePointManager]::SecurityProtocol=[System.Net.SecurityProtocolType]::Tls12; $p=Join-Path $env:TEMP 'lantern-ear.ps1'; Invoke-WebRequest -UseBasicParsing -Uri '${earUrl}' -OutFile $p; Unblock-File $p; powershell -NoProfile -ExecutionPolicy Bypass -File $p"`;
}

export function earLaunch(deviceId: string, postUrl: string, label: string): string {
  if (!/^ear-[a-f0-9]{8}$/i.test(deviceId)) throw new Error("bad device");
  const post = postUrl.trim().replace(/\/$/, "");
  if (!/^https?:\/\/\S+\/api\/tracking$/.test(post)) throw new Error("bad url");
  const title = (label.replace(/[^\w .'-]/g, "").trim() || "laptop").slice(0, 40);
  const earUrl = `${post}/ear?id=${deviceId.toLowerCase()}`;
  const command = [
    "[System.Net.ServicePointManager]::ServerCertificateValidationCallback={$true}",
    "[System.Net.ServicePointManager]::SecurityProtocol=[System.Net.SecurityProtocolType]::Tls12",
    `$u='${earUrl}'`,
    "$p=Join-Path $env:TEMP 'lantern-ear.ps1'",
    "Invoke-WebRequest -UseBasicParsing -Uri $u -OutFile $p",
    "if (-not (Test-Path $p)) { Write-Output 'Could not download the listener.'; exit 1 }",
    "Unblock-File -Path $p",
    "powershell.exe -NoProfile -ExecutionPolicy Bypass -File $p",
  ].join("; ");
  if (command.length > 2000) throw new Error("launcher command is too long");
  return `@echo off\r\ntitle Lantern ${title}\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -Command "${command}"\r\nif errorlevel 1 (\r\n  echo Could not download the listener.\r\n  pause\r\n)\r\n`;
}
