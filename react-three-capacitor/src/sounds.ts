let buttonPressAudio: HTMLAudioElement | null = null

export function playButtonPress(): void {
  if (!buttonPressAudio) {
    buttonPressAudio = new Audio(`${import.meta.env.BASE_URL}sounds/stoneplatformsound.mp3`)
    buttonPressAudio.load()
  }
  buttonPressAudio.currentTime = 0
  buttonPressAudio.play().catch(() => {})
}
