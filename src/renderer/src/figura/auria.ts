// Auria's wheel (MIT, AuriaFoxGirl — https://github.com/lua-gods/auria-wheel, commit ed3f624),
// bundled into exported avatars when the "auria" action wheel style is chosen.
import license from '../../../figura/auria_wheel/LICENSE.md?raw'
import colorPicker from '../../../figura/auria_wheel/color_picker.lua?raw'
import conf from '../../../figura/auria_wheel/conf.lua?raw'
import core from '../../../figura/auria_wheel/core.lua?raw'
import init from '../../../figura/auria_wheel/init.lua?raw'
import main from '../../../figura/auria_wheel/main.lua?raw'
import model from '../../../figura/auria_wheel/model.bbmodel?raw'
import dropdown from '../../../figura/auria_wheel/action/dropdown.lua?raw'
import slider from '../../../figura/auria_wheel/action/slider.lua?raw'
import toggle from '../../../figura/auria_wheel/action/toggle.lua?raw'
import textureUrl from '../../../figura/auria_wheel/texture.png?inline'

const bytes = (dataUrl: string) => Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(',') + 1)), (c) => c.charCodeAt(0))

export const AURIA_FILES: Record<string, string | Uint8Array> = {
  'auria_wheel/LICENSE.md': license,
  'auria_wheel/color_picker.lua': colorPicker,
  'auria_wheel/conf.lua': conf,
  'auria_wheel/core.lua': core,
  'auria_wheel/init.lua': init,
  'auria_wheel/main.lua': main,
  'auria_wheel/model.bbmodel': model,
  'auria_wheel/action/dropdown.lua': dropdown,
  'auria_wheel/action/slider.lua': slider,
  'auria_wheel/action/toggle.lua': toggle,
  'auria_wheel/texture.png': bytes(textureUrl)
}
