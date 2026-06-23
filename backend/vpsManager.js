const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const os = require('os');

const MT5_BASE_PATH = 'C:\\Program Files\\MetaTrader 5';
const SLOTS_DIR = 'D:\\alphagold\\backend\\vps_slots';

// Ensure slots directory exists
if (!fs.existsSync(SLOTS_DIR)) {
  fs.mkdirSync(SLOTS_DIR, { recursive: true });
}

/**
 * Get VPS host resource usage
 */
function getSystemResources() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const ramUsagePercent = Math.round(((totalMem - freeMem) / totalMem) * 100);
  
  // CPU Usage calculation (simple active time ratio over 100ms)
  const cpus = os.cpus();
  let totalIdle = 0, totalTick = 0;
  cpus.forEach(cpu => {
    for (type in cpu.times) {
      totalTick += cpu.times[type];
    }
    totalIdle += cpu.times.idle;
  });
  
  return {
    cpu: Math.min(100, Math.max(5, Math.round(100 - (totalIdle / totalTick * 100)))), // Fallback CPU ratio
    ram: ramUsagePercent,
    totalRamGb: Math.round(totalMem / (1024 * 1024 * 1024)),
    freeRamGb: Math.round(freeMem / (1024 * 1024 * 1024)),
    osPlatform: os.platform(),
    osRelease: os.release()
  };
}

/**
 * Check if slot terminal exists, copy base MT5 files if missing
 */
function ensureSlotDirectory(login) {
  const slotDir = path.join(SLOTS_DIR, `slot_${login}`);
  if (!fs.existsSync(slotDir)) {
    fs.mkdirSync(slotDir, { recursive: true });
  }

  const exePath = path.join(slotDir, 'terminal64.exe');
  if (!fs.existsSync(exePath)) {
    console.log(`[VPS Manager] Copying base MT5 files to slot_${login}...`);
    try {
      // Use PowerShell for fast recursive copy on Windows
      execSync(`powershell -Command "Copy-Item -Path '${MT5_BASE_PATH}\\*' -Destination '${slotDir}' -Recurse -Force -ErrorAction SilentlyContinue"`);
      
      // Copy user's AppData configurations so we have the broker IPs (servers.dat) and bases
      try {
        const appDataCopyCmd = `powershell -Command "$dirs = Get-ChildItem -Path $env:APPDATA\\MetaQuotes\\Terminal -Directory | Sort-Object LastWriteTime -Descending; if ($dirs.Count -gt 0) { $latest = $dirs[0].FullName; Copy-Item -Path \\"$latest\\config\\*\\" -Destination '${slotDir}\\config' -Recurse -Force -ErrorAction SilentlyContinue; Copy-Item -Path \\"$latest\\bases\\*\\" -Destination '${slotDir}\\bases' -Recurse -Force -ErrorAction SilentlyContinue; }"`;
        execSync(appDataCopyCmd);
      } catch (err) {
        console.error(`[VPS Manager] Error copying AppData config:`, err.message);
      }
      
      console.log(`[VPS Manager] Copy completed for slot_${login}.`);
    } catch (err) {
      console.error(`[VPS Manager] Error copying MT5 base:`, err.message);
      // Fallback Node.js copy
      fs.cpSync(MT5_BASE_PATH, slotDir, { recursive: true });
    }
  }

  // Ensure EA is copied to MQL5/Experts
  const eaSrcPath = 'D:\\alphagold\\backend\\TcpReceiverEA.ex5';
  const eaDestDir = path.join(slotDir, 'MQL5', 'Experts');
  const eaDestPath = path.join(eaDestDir, 'TcpReceiverEA.ex5');

  if (!fs.existsSync(eaDestDir)) {
    fs.mkdirSync(eaDestDir, { recursive: true });
  }

  if (fs.existsSync(eaSrcPath)) {
    fs.copyFileSync(eaSrcPath, eaDestPath);
    console.log(`[VPS Manager] Copied TcpReceiverEA.ex5 to slot_${login} experts folder.`);
  } else {
    console.warn(`[VPS Manager] WARNING: Compiled TcpReceiverEA.ex5 not found at ${eaSrcPath}`);
  }

  return slotDir;
}

/**
 * Generate config.ini for auto-login and EA launch
 */
function generateConfigIni(slotDir, login, password, server) {
  const configContent = `[Common]
Login=${login}
Password=${password}
Server=${server}
KeepPassword=1
ProxyEnable=0

[StartUp]
Symbol=XAUUSD
Period=M5
Expert=TcpReceiverEA
Template=TcpReceiverEA

[Experts]
AllowLiveTrading=1
AllowDllImport=0
Enabled=1
`.replace(/\n/g, '\r\n');

  const configPath = path.join(slotDir, 'config.ini');
  fs.writeFileSync(configPath, configContent, 'utf-8');

  const tplContent = `<chart>
symbol=XAUUSD
period_type=1
period_size=5
digits=2
tick_size=0.010000
position_time=0
scale_fix=0
scale_fixed_min=1.000000
scale_fixed_max=2.000000
scale_fix11=0
scale_bar=0
scale_bar_val=1.000000
scale=8
mode=1
fore=0
grid=1
volume=0
scroll=1
<window>
height=100
<indicator>
name=Main
path=
apply=1
show_data=1
scale_inherit=0
scale_line=0
scale_line_percent=50
scale_line_value=0.000000
scale_fix_min=0
scale_fix_min_val=0.000000
scale_fix_max=0
scale_fix_max_val=0.000000
fixed_height=-1
</indicator>
<expert>
name=TcpReceiverEA
flags=339
window_num=0
<inputs>
</inputs>
</expert>
</window>
</chart>`.replace(/\n/g, '\r\n');

  const tplBuffer = Buffer.concat([
    Buffer.from([0xFF, 0xFE]), // BOM for UTF-16LE
    Buffer.from(tplContent, 'utf16le')
  ]);

  // Write the template files in MQL5/Profiles/Templates
  const tplDirMql = path.join(slotDir, 'MQL5', 'Profiles', 'Templates');
  if (!fs.existsSync(tplDirMql)) {
    fs.mkdirSync(tplDirMql, { recursive: true });
  }
  fs.writeFileSync(path.join(tplDirMql, 'TcpReceiverEA.tpl'), tplBuffer);
  fs.writeFileSync(path.join(tplDirMql, 'default.tpl'), tplBuffer);

  // Write the template files in Profiles/Templates
  const tplDirRoot = path.join(slotDir, 'Profiles', 'Templates');
  if (!fs.existsSync(tplDirRoot)) {
    fs.mkdirSync(tplDirRoot, { recursive: true });
  }
  fs.writeFileSync(path.join(tplDirRoot, 'TcpReceiverEA.tpl'), tplBuffer);
  fs.writeFileSync(path.join(tplDirRoot, 'default.tpl'), tplBuffer);

  console.log(`[VPS Manager] Generated config.ini and templates for ${login}`);
  return configPath;
}

/**
 * Start MT5 portable instance for slot
 */
function startSlot(login, password, server) {
  console.log(`[VPS Manager] Starting slot for account: ${login}...`);
  try {
    // 1. Stop if already running
    stopSlot(login);

    // 2. Prepare files and configs
    const slotDir = ensureSlotDirectory(login);
    generateConfigIni(slotDir, login, password, server);

    // Delete terminal.ini to force fresh first-launch read of config.ini Startup section
    try {
      const terminalIniPath = path.join(slotDir, 'config', 'terminal.ini');
      if (fs.existsSync(terminalIniPath)) {
        fs.unlinkSync(terminalIniPath);
        console.log(`[VPS Manager] Deleted terminal.ini for ${login} to force config.ini execution.`);
      }
    } catch (err) {
      console.error(`[VPS Manager] Failed to delete terminal.ini:`, err.message);
    }

    // Clear all chart profiles recursively and write a pre-configured chart01.chr with the EA loaded
    try {
      const deleteChrFiles = (dir) => {
        if (!fs.existsSync(dir)) return;
        const list = fs.readdirSync(dir);
        for (const item of list) {
          const fullPath = path.join(dir, item);
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            deleteChrFiles(fullPath);
          } else if (item.endsWith('.chr')) {
            fs.unlinkSync(fullPath);
          }
        }
      };
      
      deleteChrFiles(path.join(slotDir, 'Profiles', 'Charts'));
      deleteChrFiles(path.join(slotDir, 'MQL5', 'Profiles', 'Charts'));
      
      const chartContent = `<chart>
symbol=XAUUSD
period_type=1
period_size=1
digits=2
tick_size=0.010000
position_time=0
scale_fix=0
scale_fixed_min=1.000000
scale_fixed_max=2.000000
scale_fix11=0
scale_bar=0
scale_bar_val=1.000000
scale=8
mode=1
fore=0
grid=1
volume=0
scroll=1
<window>
height=100
<indicator>
name=Main
path=
apply=1
show_data=1
scale_inherit=0
scale_line=0
scale_line_percent=50
scale_line_value=0.000000
scale_fix_min=0
scale_fix_min_val=0.000000
scale_fix_max=0
scale_fix_max_val=0.000000
expertmode=0
fixed_height=-1
</indicator>
<expert>
name=TcpReceiverEA
flags=339
window_num=0
<inputs>
</inputs>
</expert>
</window>
</chart>`.replace(/\n/g, '\r\n');

      const writeDefaultChartToAllProfiles = (slotDir) => {
        const rootChartsDir = path.join(slotDir, 'Profiles', 'Charts');
        const mqlChartsDir = path.join(slotDir, 'MQL5', 'Profiles', 'Charts');
        
        // Ensure both directories exist
        if (!fs.existsSync(rootChartsDir)) fs.mkdirSync(rootChartsDir, { recursive: true });
        if (!fs.existsSync(mqlChartsDir)) fs.mkdirSync(mqlChartsDir, { recursive: true });
        
        // Gather all existing profiles
        const profiles = new Set(['Default']);
        
        const gatherProfiles = (dir) => {
          if (!fs.existsSync(dir)) return;
          const list = fs.readdirSync(dir);
          for (const item of list) {
            if (fs.statSync(path.join(dir, item)).isDirectory()) {
              profiles.add(item);
            }
          }
        };
        
        gatherProfiles(rootChartsDir);
        gatherProfiles(mqlChartsDir);
        
        // Write chart01.chr to all profiles in both root and MQL5
        profiles.forEach(profileName => {
          const rootProfilePath = path.join(rootChartsDir, profileName);
          const mqlProfilePath = path.join(mqlChartsDir, profileName);
          
          if (!fs.existsSync(rootProfilePath)) fs.mkdirSync(rootProfilePath, { recursive: true });
          if (!fs.existsSync(mqlProfilePath)) fs.mkdirSync(mqlProfilePath, { recursive: true });
          
          fs.writeFileSync(path.join(rootProfilePath, 'chart01.chr'), chartContent, 'utf-8');
          fs.writeFileSync(path.join(mqlProfilePath, 'chart01.chr'), chartContent, 'utf-8');
        });
      };

      writeDefaultChartToAllProfiles(slotDir);
      
      console.log(`[VPS Manager] Cleared charts and wrote default chart01.chr with EA for ${login}.`);
    } catch (err) {
      console.error(`[VPS Manager] Failed to clear or write chart profiles:`, err.message);
    }

    // 3. Start process in portable mode using child_process.spawn
    const terminalExe = path.join(slotDir, 'terminal64.exe');
    
    // We launch it and detach it so it runs independently in the background
    const child = spawn(terminalExe, ['/config:config.ini', '/portable'], {
      cwd: slotDir,
      detached: true,
      stdio: 'ignore'
    });

    child.unref(); // Allow the parent Node process to exit independently
    console.log(`[VPS Manager] Spawned MT5 slot_${login} process successfully.`);
    return true;
  } catch (err) {
    console.error(`[VPS Manager] Failed to start slot_${login}:`, err.message);
    return false;
  }
}

/**
 * Stop MT5 portable instance for slot
 */
function stopSlot(login) {
  console.log(`[VPS Manager] Stopping slot process for account: ${login}...`);
  try {
    // Find processes matching terminal64.exe and slot path, then stop them
    const command = `powershell -Command "Get-CimInstance Win32_Process -Filter \\"Name = 'terminal64.exe'\\" | Where-Object CommandLine -like \\"*slot_${login}*\\" | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`;
    execSync(command);
    console.log(`[VPS Manager] Stopped slot_${login} process.`);
    return true;
  } catch (err) {
    // If no process found, it will fail silently or throw, which is normal
    return false;
  }
}

/**
 * Check running status of MT5 slot
 */
function getSlotStatus(login) {
  try {
    const command = `powershell -Command "Get-CimInstance Win32_Process -Filter \\"Name = 'terminal64.exe'\\" | Where-Object CommandLine -like \\"*slot_${login}*\\" | Select-Object -ExpandProperty ProcessId"`;
    const result = execSync(command).toString().trim();
    if (result) {
      return { running: true, pid: parseInt(result, 10) };
    }
  } catch (err) {
    // Ignore errors
  }
  return { running: false, pid: null };
}

module.exports = {
  getSystemResources,
  startSlot,
  stopSlot,
  getSlotStatus,
  SLOTS_DIR
};
