const SOUND_KEY = 'sus_sound_enabled'

export function getSoundEnabled(): boolean {
  return localStorage.getItem(SOUND_KEY) !== 'false'
}

export function setSoundEnabled(enabled: boolean): void {
  localStorage.setItem(SOUND_KEY, enabled ? 'true' : 'false')
}
