import { useEffect } from 'react'
import { useSettings } from './store/settings'
import { useEditor } from './store/editor'
import { Home } from './ui/home/Home'
import { Instance } from './ui/instance/Instance'
import { DialogHost } from './ui/common/dialogs'

export function App() {
  const loaded = useSettings((s) => s.loaded)
  const doc = useEditor((s) => s.doc)

  useEffect(() => {
    useSettings.getState().load()
    useEditor.getState().loadPalettes()
  }, [])

  if (!loaded) return null
  return (
    <>
      {doc ? <Instance key={doc.id} doc={doc} /> : <Home />}
      <DialogHost />
    </>
  )
}
