import { contextBridge, ipcRenderer, webFrame, webUtils } from 'electron'

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
  exportFigura: (folder: string, files: unknown, attachIds?: string[]) => ipcRenderer.invoke('figura:export', folder, files, attachIds),
  listAvatars: () => ipcRenderer.invoke('avatars:list'),
  importAvatars: (paths?: string[], archives?: boolean) => ipcRenderer.invoke('avatars:import', paths, archives),
  updateAvatar: (id: string, patch: { name?: string; category?: string; thumb3d?: string; rights?: unknown }) => ipcRenderer.invoke('avatars:update', id, patch),
  avatarFiles: (id: string) => ipcRenderer.invoke('avatars:files', id),
  readAvatarFile: (id: string, rel: string) => ipcRenderer.invoke('avatars:read', id, rel),
  deleteAvatar: (id: string) => ipcRenderer.invoke('avatars:delete', id),
  mergeAvatars: (ids: string[], current: unknown, outName: string) => ipcRenderer.invoke('avatars:merge', ids, current, outName),
  // whole-window zoom (keeps canvas/pointer coordinates consistent, unlike CSS zoom)
  setZoom: (factor: number) => webFrame.setZoomFactor(factor),
  // full path of a dropped file/folder (Electron only)
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  mcFind: (v: string) => ipcRenderer.invoke('mc:find', v),
  mcRead: (v: string) => ipcRenderer.invoke('mc:read', v),
  mcDownload: (v: string) => ipcRenderer.invoke('mc:download', v),
  openImage: () => ipcRenderer.invoke('dialog:openImage'),
  saveFile: (data: Uint8Array, name: string, ext: string, label: string) => ipcRenderer.invoke('dialog:saveFile', data, name, ext, label),
  savePng: (dataUrl: string, name: string) => ipcRenderer.invoke('dialog:savePng', dataUrl, name)
})
