import { contextBridge, ipcRenderer, webUtils } from 'electron'

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
  listAvatars: () => ipcRenderer.invoke('avatars:list'),
  importAvatars: (paths?: string[]) => ipcRenderer.invoke('avatars:import', paths),
  updateAvatar: (id: string, patch: { name?: string }) => ipcRenderer.invoke('avatars:update', id, patch),
  deleteAvatar: (id: string) => ipcRenderer.invoke('avatars:delete', id),
  mergeAvatars: (ids: string[], current: unknown, outName: string) => ipcRenderer.invoke('avatars:merge', ids, current, outName),
  // full path of a dropped file/folder (Electron only)
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  openImage: () => ipcRenderer.invoke('dialog:openImage'),
  savePng: (dataUrl: string, name: string) => ipcRenderer.invoke('dialog:savePng', dataUrl, name)
})
