const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const net = require('net');
const fs = require('fs');

const PORT = 5000;
const isDev = !app.isPackaged;

// Resolve a path inside the packaged app's resources folder, or the project
// root in dev mode.
function res(...parts) {
  return isDev
    ? path.join(__dirname, '..', ...parts)
    : path.join(process.resourcesPath, ...parts);
}

// Poll until the local server is accepting connections (or timeout).
function waitForServer(port, timeoutMs = 30_000) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    function attempt() {
      const sock = new net.Socket();
      sock.once('connect', () => { sock.destroy(); resolve(true); });
      sock.once('error',   () => {
        sock.destroy();
        if (Date.now() >= deadline) return resolve(false);
        setTimeout(attempt, 500);
      });
      sock.connect(port, '127.0.0.1');
    }
    attempt();
  });
}

async function startServer() {
  // Load credentials from config.json (written by build.bat at build time)
  const configPath = res('config.json');
  let config = {};
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (e) {
    console.error('[fog.chess] Could not read config.json:', e.message);
  }

  // Inject all required env vars before the Nitro server module loads.
  // VITE_* vars are already baked into the client bundle at build time;
  // SUPABASE_URL and SERVICE_ROLE_KEY are needed by the SSR server at runtime.
  Object.assign(process.env, {
    PORT:                        String(PORT),
    HOST:                        '127.0.0.1',
    SUPABASE_URL:                config.SUPABASE_URL                || '',
    SUPABASE_SERVICE_ROLE_KEY:   config.SUPABASE_SERVICE_ROLE_KEY   || '',
    SUPABASE_PUBLISHABLE_KEY:    config.VITE_SUPABASE_PUBLISHABLE_KEY || '',
    // Nitro looks for these too
    NITRO_PORT:                  String(PORT),
    NITRO_HOST:                  '127.0.0.1',
  });

  // Import the Nitro SSR server.
  // Because this is an ES module, import.meta.dirname inside index.mjs will
  // correctly point to its own directory — so Nitro finds ../public on its own.
  const serverEntry = res('app-server', 'server', 'index.mjs');
  try {
    await import(serverEntry);
    console.log('[fog.chess] Nitro server started on port', PORT);
  } catch (e) {
    console.error('[fog.chess] Failed to start server:', e);
  }
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration:  false,
      contextIsolation: true,
      // Allow the app to talk to localhost without CORS issues
      webSecurity: false,
    },
    title: 'fog.chess',
    backgroundColor: '#061006',
    show: false, // show after content loads to avoid white flash
  });

  // Show a loading screen immediately
  win.loadFile(path.join(__dirname, 'loading.html'));
  win.once('ready-to-show', () => win.show());

  // Start the Nitro SSR server
  await startServer();

  // Wait for the server to accept connections, then navigate
  const ready = await waitForServer(PORT, 30_000);
  if (ready) {
    win.loadURL(`http://127.0.0.1:${PORT}`);
  } else {
    win.loadFile(path.join(__dirname, 'error.html'));
  }

  // Open external links in the system browser, not inside the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  // On macOS it's conventional to keep the app open until the user quits
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
