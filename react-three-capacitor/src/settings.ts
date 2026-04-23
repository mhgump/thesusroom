import { isNativePlatform } from './platform'

const SOUND_KEY = 'sus_sound_enabled'
const INPUT_MODE_KEY = 'sus_input_mode'

export type InputMode = 'joystick' | 'tap'

export function getSoundEnabled(): boolean {
  return localStorage.getItem(SOUND_KEY) !== 'false'
}

export function setSoundEnabled(enabled: boolean): void {
  localStorage.setItem(SOUND_KEY, enabled ? 'true' : 'false')
}

export function getInputMode(): InputMode {
  const stored = localStorage.getItem(INPUT_MODE_KEY)
  if (stored === 'joystick' || stored === 'tap') return stored
  return isNativePlatform() ? 'joystick' : 'tap'
}

export function setInputMode(mode: InputMode): void {
  localStorage.setItem(INPUT_MODE_KEY, mode)
}
