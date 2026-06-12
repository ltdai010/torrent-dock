const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("torrentDock", {
  invoke(command, args) {
    return ipcRenderer.invoke(`command:${command}`, args ?? {});
  },
  listen(eventName, handler) {
    const channel = `event:${eventName}`;
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  }
});
