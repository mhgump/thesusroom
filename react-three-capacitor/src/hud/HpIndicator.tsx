import { HeartFull, HeartHalf } from './HeartIcon'

interface Props { hp: 0 | 1 | 2 }

export function HpIndicator({ hp }: Props) {
  if (hp === 0) return null
  return hp === 2 ? <HeartFull /> : <HeartHalf />
}
