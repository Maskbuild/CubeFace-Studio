import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('nkw', {
  listSkins: () => ipcRenderer.invoke('lib:list'),
  loadSkin: (id: string) => ipcRenderer.invoke('lib:load', id),
  saveSkin: (payload: unknown) => ipcRenderer.invoke('lib:save', payload),
  deleteSkin: (id: string) => ipcRenderer.invoke('lib:delete', id),
  getGlobal: (name: string) => ipcRenderer.invoke('global:get', name),
  setGlobal: (name: string, value: unknown) => ipcRenderer.invoke('global:set', name, value),
  getAsset: (kind: string, id: string) => ipcRenderer.invoke('asset:get', kind, id),
  setAsset: (kind: string, id: string, dataUrl: string) => ipcRenderer.invoke('asset:set', kind, id, dataUrl),
  deleteAsset: (kind: string, id: string) => ipcRenderer.invoke('asset:delete', kind, id),
  exportFigura: (folder: string, files: Record<string, string>) => ipcRenderer.invoke('figura:export', folder, files),
  mergeFigura: () => ipcRenderer.invoke('figura:merge'),
  openImage: () => ipcRenderer.invoke('dialog:openImage'),
  savePng: (dataUrl: string, name: string) => ipcRenderer.invoke('dialog:savePng', dataUrl, name)
})
