'use strict';

// Lanceur SpeedKart : démarre le serveur de la page et l'ouvre dans une fenêtre.
// L'hôte y fait tourner la partie ; les amis rejoignent depuis leur navigateur ou le lanceur.

const { app, BrowserWindow, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const { startServer } = require('../server');

// Sons sans clic préalable.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;

async function createWindow() {
  const { port } = await startServer(Number(process.env.PORT) || 3000);

  win = new BrowserWindow({
    width: 1400,
    height: 860,
    minWidth: 800,
    minHeight: 560,
    title: 'SpeedKart',
    backgroundColor: '#140a2e',
    autoHideMenuBar: true,
    webPreferences: {
      // L'hôte simule les bots et les objets : pas de ralentissement quand la fenêtre est en arrière-plan.
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Liens externes dans le navigateur, pas dans le lanceur.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`http://localhost:${port}/`)) event.preventDefault();
  });
  // F11 : plein écran.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    }
  });

  if (process.env.SK_DEBUG) {
    win.webContents.on('console-message', (event) => console.log(`[page] ${event.message}`));
  }

  await win.loadURL(`http://localhost:${port}/`);
}

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

// Mises à jour depuis les releases GitHub : téléchargées en arrière-plan,
// installées à la fermeture du lanceur (jamais en pleine course).
function checkForUpdates() {
  if (!app.isPackaged) return;
  autoUpdater.checkForUpdatesAndNotify().catch((err) => console.warn('[update]', err.message));
}

app.whenReady().then(async () => {
  await createWindow();
  checkForUpdates();
  setInterval(checkForUpdates, 60 * 60 * 1000);
});
app.on('window-all-closed', () => app.quit());
