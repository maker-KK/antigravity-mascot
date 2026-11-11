const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Mascot overlay IPC
  mouse: over => ipcRenderer.send('mascot:mouse', !!over),
  clicked: () => ipcRenderer.send('mascot:clicked'),
  idle: () => ipcRenderer.send('mascot:idle'),
  ping: on => ipcRenderer.send('mascot:ping', !!on),
  reportStatus: data => ipcRenderer.send('mascot:status', data),

  // Settings / Control Deck IPC
  getState: () => ipcRenderer.invoke('settings:getState'),
  updateConfig: patch => ipcRenderer.invoke('settings:updateConfig', patch),
  triggerTest: opts => ipcRenderer.invoke('settings:test', opts),
  dismiss: () => ipcRenderer.invoke('settings:dismiss'),

  // Subscriptions
  on: (channel, fn) => {
    const allowed = ['notify', 'leave', 'config', 'status', 'stateChanged'];
    if (!allowed.includes(channel)) return;
    ipcRenderer.on(channel, (_event, payload) => fn(payload));
  },
});
