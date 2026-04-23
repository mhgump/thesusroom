import { Capacitor } from '@capacitor/core'

export function isNativePlatform(): boolean {
  const p = Capacitor.getPlatform()
  return p === 'ios' || p === 'android'
}
