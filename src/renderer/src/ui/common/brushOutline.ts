/**
 * Where the brush will paint: a ring (round brush) or a square, drawn twice (dark, then the
 * accent colour) so it shows on light and dark pixels alike.
 */
export function brushOutline(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, round: boolean, accent: string) {
  const path = () => {
    ctx.beginPath()
    if (round) ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2)
    else ctx.rect(x, y, size, size)
  }
  ctx.save()
  ctx.lineWidth = 3
  ctx.strokeStyle = 'rgba(0, 0, 0, .45)'
  path()
  ctx.stroke()
  ctx.lineWidth = 1.5
  ctx.strokeStyle = accent
  path()
  ctx.stroke()
  ctx.restore()
}
