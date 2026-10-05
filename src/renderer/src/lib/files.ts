/** Read image files from a drop (or file input) as data URLs; non-images are skipped. */
export function readDroppedImages(files: FileList | File[]): Promise<{ name: string; dataUrl: string }[]> {
  return Promise.all(
    [...files]
      .filter((f) => f.type.startsWith('image/'))
      .map(
        (f) =>
          new Promise<{ name: string; dataUrl: string }>((resolve, reject) => {
            const r = new FileReader()
            r.onload = () => resolve({ name: f.name.replace(/.[^.]+$/, ''), dataUrl: r.result as string })
            r.onerror = () => reject(r.error)
            r.readAsDataURL(f)
          })
      )
  )
}
