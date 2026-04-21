export type AnimationState = 'IDLE' | 'WALKING';

export interface AnimationHandlerProps {
  animationState: AnimationState;
  /** Hex color assigned to this player. Used as the idle capsule color. */
  color?: string;
}
