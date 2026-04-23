import { getSoundEnabled } from './settings'

let buttonPressAudio: HTMLAudioElement | null = null

export function playButtonPress(): void {
  if (!getSoundEnabled()) return
  if (!buttonPressAudio) {
    buttonPressAudio = new Audio(`${import.meta.env.BASE_URL}sounds/stoneplatformsound.mp3`)
    buttonPressAudio.load()
  }
  buttonPressAudio.currentTime = 0
  buttonPressAudio.play().catch(() => {})
}
