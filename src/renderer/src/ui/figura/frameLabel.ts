import type { TFunction } from 'i18next'
import type { FaceFrame, FiguraConfig } from '../../skin/figura'

/** Display name of a face frame: translated for built-ins, the user's name for custom ones. */
export function frameLabel(t: TFunction, cfg: FiguraConfig, f: FaceFrame): string {
  if (f === 'glowMask') return t('glow.spots')
  if (f.startsWith('x_')) return cfg.customExpr.find((c) => 'x_' + c.id === f)?.name || 'Custom'
  return t(`figura.frames.${f}`)
}
