import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { storage, type AvatarMeta } from '../../lib/storage'
import { loadBBModel, type LoadedModel } from '../../three/bbLoader'
import { Icon } from '../common/Icon'

type FileInfo = { path: string; size: number }
const kb = (n: number) => (n / 1024).toFixed(1) + ' KB'
const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '')
const base = (p: string) => p.slice(p.lastIndexOf('/') + 1).toLowerCase()

/** Resolve a .bbmodel path like "../textures/skin.png" against the model's folder. */
function join(dir: string, rel: string) {
  const parts = (dir + rel.replace(/\\/g, '/')).split('/')
  const out: string[] = []
  for (const p of parts) {
    if (p === '..') out.pop()
    else if (p && p !== '.') out.push(p)
  }
  return out.join('/')
}

/** 3D preview of every .bbmodel in the avatar, with textures from the model or the folder. */
function ModelView({ avatar, files }: { avatar: AvatarMeta; files: FileInfo[] }) {
  const { t } = useTranslation()
  const box = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<string | null>(t('avatars.loading'))

  useEffect(() => {
    const el = box.current!
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    el.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(35, 1, 0.5, 2000)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.zoomToCursor = true
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }
    renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault())
    const grid = new THREE.GridHelper(48, 12, 0x888888, 0x888888)
    ;(grid.material as THREE.Material).transparent = true
    ;(grid.material as THREE.Material).opacity = 0.2
    scene.add(grid)
    const loaded: LoadedModel[] = []
    let alive = true

    ;(async () => {
      const models = files.filter((f) => f.path.toLowerCase().endsWith('.bbmodel'))
      if (!models.length) return setStatus(t('avatars.noModel'))
      const pngs = files.filter((f) => /\.png$/i.test(f.path))
      for (const m of models) {
        const text = await storage.readAvatarFile(avatar.id, m.path)
        if (!text || !alive) continue
        let json
        try {
          json = JSON.parse(text)
        } catch {
          continue
        }
        const dir = dirOf(m.path)
        const model = await loadBBModel(json, async (tex) => {
          if (typeof tex.source === 'string' && tex.source.startsWith('data:')) return tex.source
          const tries = [tex.relative_path && join(dir, tex.relative_path), tex.name && join(dir, tex.name)].filter(Boolean) as string[]
          const hit = tries.find((p) => pngs.some((f) => f.path === p)) ?? pngs.find((f) => base(f.path) === String(tex.name ?? '').toLowerCase())?.path
          return hit ? storage.readAvatarFile(avatar.id, hit) : null
        })
        if (!alive) return model.dispose()
        loaded.push(model)
        scene.add(model.root)
      }
      // frame everything that loaded
      const bounds = new THREE.Box3()
      for (const m of loaded) bounds.expandByObject(m.root)
      if (bounds.isEmpty()) return setStatus(t('avatars.noModel'))
      const s = bounds.getBoundingSphere(new THREE.Sphere())
      controls.target.copy(s.center)
      camera.position.copy(s.center).add(new THREE.Vector3(0.35, 0.25, 1).normalize().multiplyScalar(Math.max(20, s.radius / Math.sin(THREE.MathUtils.degToRad(17.5)))))
      setStatus(null)
    })()

    let raf = 0, w = 0, h = 0
    const frame = () => {
      raf = requestAnimationFrame(frame)
      if (el.clientWidth !== w || el.clientHeight !== h) {
        w = el.clientWidth
        h = el.clientHeight
        renderer.setSize(w, h, false)
        camera.aspect = w / Math.max(1, h)
        camera.updateProjectionMatrix()
      }
      controls.update()
      renderer.render(scene, camera)
    }
    frame()
    return () => {
      alive = false
      cancelAnimationFrame(raf)
      controls.dispose()
      loaded.forEach((m) => m.dispose())
      grid.geometry.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [avatar, files, t])

  return (
    <div className="wardrobe-preview" ref={box}>
      {status && <div className="viewer-status">{status}</div>}
    </div>
  )
}

function TextureList({ avatar, files }: { avatar: AvatarMeta; files: FileInfo[] }) {
  const [urls, setUrls] = useState<Record<string, string>>({})
  const pngs = files.filter((f) => /\.(png|jpe?g)$/i.test(f.path))
  useEffect(() => {
    let alive = true
    ;(async () => {
      for (const f of pngs) {
        const u = await storage.readAvatarFile(avatar.id, f.path)
        if (!alive) return
        if (u) setUrls((m) => ({ ...m, [f.path]: u }))
      }
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avatar, files])
  return (
    <div className="tex-grid">
      {pngs.map((f) => (
        <figure key={f.path}>
          {urls[f.path] ? <img src={urls[f.path]} alt="" className="checker" /> : <div className="checker" />}
          <figcaption title={f.path}>{f.path} · {kb(f.size)}</figcaption>
        </figure>
      ))}
    </div>
  )
}

function ScriptList({ avatar, files }: { avatar: AvatarMeta; files: FileInfo[] }) {
  const { t } = useTranslation()
  const scripts = files.filter((f) => /\.(lua|json)$/i.test(f.path))
  const [sel, setSel] = useState(scripts[0]?.path ?? null)
  const [text, setText] = useState('')
  useEffect(() => {
    if (sel) storage.readAvatarFile(avatar.id, sel).then((s) => setText(s ?? ''))
  }, [avatar, sel])
  if (!scripts.length) return <div className="muted">{t('avatars.noScripts')}</div>
  return (
    <div className="script-view">
      <div className="script-files">
        {scripts.map((f) => (
          <button key={f.path} className={'layer' + (sel === f.path ? ' on' : '')} onClick={() => setSel(f.path)}>
            <span className="lname">{f.path}</span>
            <span className="tag">{kb(f.size)}</span>
          </button>
        ))}
      </div>
      <pre className="script-text">{text}</pre>
    </div>
  )
}

/** Look inside an imported avatar: 3D model, textures, scripts and files. */
export function AvatarViewer({ avatar, onClose }: { avatar: AvatarMeta; onClose: () => void }) {
  const { t } = useTranslation()
  const [files, setFiles] = useState<FileInfo[] | null>(null)
  const [tab, setTab] = useState<'textures' | 'scripts' | 'files'>('textures')
  useEffect(() => {
    storage.avatarFiles(avatar.id).then(setFiles)
  }, [avatar])

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="wardrobe">
        <header className="wardrobe-head">
          <Icon name="sparkle" size={18} />
          <b>{avatar.name}</b>
          <span className="muted" style={{ fontSize: 12 }}>{avatar.authors.join(', ')}</span>
          <div className="grow" />
          <button className="icon-btn" onClick={onClose}><Icon name="x" /></button>
        </header>
        <div className="wardrobe-body">
          <div className="wardrobe-left">
            {files && <ModelView avatar={avatar} files={files} />}
            <div className="hint-bar" style={{ position: 'static', padding: '6px 10px' }}>{t('wardrobe.viewHint')}</div>
          </div>
          <div className="wardrobe-right">
            {avatar.description && <p className="muted" style={{ margin: 0 }}>{avatar.description}</p>}
            <div className="panel-tabs" style={{ padding: 0 }}>
              <button className={tab === 'textures' ? 'on' : ''} onClick={() => setTab('textures')}>{t('avatars.textures')}</button>
              <button className={tab === 'scripts' ? 'on' : ''} onClick={() => setTab('scripts')}>{t('avatars.scripts')}</button>
              <button className={tab === 'files' ? 'on' : ''} onClick={() => setTab('files')}>{t('avatars.files')}</button>
            </div>
            {files && tab === 'textures' && <TextureList avatar={avatar} files={files} />}
            {files && tab === 'scripts' && <ScriptList avatar={avatar} files={files} />}
            {files && tab === 'files' && (
              <div className="file-list">
                {files.map((f) => (
                  <div key={f.path} className="row"><span className="grow">{f.path}</span><span className="muted">{kb(f.size)}</span></div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
