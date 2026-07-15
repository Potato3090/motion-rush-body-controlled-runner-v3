import type { RunnerLane } from './types'

export const POSE_TUNING = {
  laneEnter: 0.055,
  laneExit: 0.037,
  crouchEnter: 0.058,
  crouchExit: 0.039,
  crouchEnterFrames: 2,
  jumpTakeoff: -0.052,
  jumpRearm: -0.018,
  jumpNeutralFrames: 2,
} as const

export const HORIZONTAL_SENSITIVITY = {
  min: 0.5,
  max: 2,
  step: 0.05,
  default: 1,
  maxProcessedOffset: 0.1,
} as const

export interface JumpGateState {
  armed: boolean
  neutralFrames: number
}

export interface JumpGateResult extends JumpGateState {
  triggered: boolean
}

export interface CrouchGateState {
  crouching: boolean
  enterFrames: number
}

export function normalizeHorizontalSensitivity(value: number): number {
  if (!Number.isFinite(value)) return HORIZONTAL_SENSITIVITY.default
  const clamped = Math.max(HORIZONTAL_SENSITIVITY.min, Math.min(HORIZONTAL_SENSITIVITY.max, value))
  const stepped = Math.round(clamped / HORIZONTAL_SENSITIVITY.step) * HORIZONTAL_SENSITIVITY.step
  return Number(stepped.toFixed(2))
}

/**
 * Applies user sensitivity around the calibrated zero point and constrains the
 * shared UI/game signal to the physical tracking bar's valid range.
 */
export function applyHorizontalSensitivity(
  rawHorizontalOffset: number,
  sensitivity: number,
): number {
  const processed = rawHorizontalOffset * normalizeHorizontalSensitivity(sensitivity)
  return Math.max(
    -HORIZONTAL_SENSITIVITY.maxProcessedOffset,
    Math.min(HORIZONTAL_SENSITIVITY.maxProcessedOffset, processed),
  )
}

/**
 * Maps the current horizontal pose directly to a lane. The previous lane is
 * used only inside the narrow boundary hysteresis; it is never used as a
 * relative movement command or as a prerequisite for crossing the center.
 */
export function resolveAbsoluteLane(
  horizontalOffset: number,
  currentLane: RunnerLane,
): RunnerLane {
  if (horizontalOffset <= -POSE_TUNING.laneEnter) return 0
  if (horizontalOffset >= POSE_TUNING.laneEnter) return 2

  if (currentLane === 0 && horizontalOffset < -POSE_TUNING.laneExit) return 0
  if (currentLane === 2 && horizontalOffset > POSE_TUNING.laneExit) return 2
  return 1
}

/** A held state with separate enter/exit thresholds to avoid edge flicker. */
export function resolveCrouchState(
  verticalOffset: number,
  isCrouching: boolean,
): boolean {
  return isCrouching
    ? verticalOffset > POSE_TUNING.crouchExit
    : verticalOffset >= POSE_TUNING.crouchEnter
}

/** Two-frame enter confirmation and immediate thresholded exit. */
export function updateCrouchGate(
  verticalOffset: number,
  state: CrouchGateState,
): CrouchGateState {
  const wantsCrouch = resolveCrouchState(verticalOffset, state.crouching)
  if (state.crouching) {
    return wantsCrouch ? state : { crouching: false, enterFrames: 0 }
  }
  if (!wantsCrouch) return { crouching: false, enterFrames: 0 }

  const enterFrames = state.enterFrames + 1
  return {
    crouching: enterFrames >= POSE_TUNING.crouchEnterFrames,
    enterFrames: enterFrames >= POSE_TUNING.crouchEnterFrames ? 0 : enterFrames,
  }
}

/**
 * A timer-free jump gate. One upward takeoff disarms the gate; returning to a
 * neutral height for two reliable frames rearms it for the next real jump.
 */
export function updateJumpGate(
  verticalOffset: number,
  state: JumpGateState,
  isCrouching: boolean,
): JumpGateResult {
  if (state.armed) {
    if (!isCrouching && verticalOffset <= POSE_TUNING.jumpTakeoff) {
      return { armed: false, neutralFrames: 0, triggered: true }
    }
    return { ...state, triggered: false }
  }

  const isNeutral = verticalOffset >= POSE_TUNING.jumpRearm && !isCrouching
  const neutralFrames = isNeutral ? state.neutralFrames + 1 : 0
  return {
    armed: neutralFrames >= POSE_TUNING.jumpNeutralFrames,
    neutralFrames,
    triggered: false,
  }
}

/**
 * Adaptive EMA: steady landmarks are filtered lightly, while intentional fast
 * movement receives up to 90% of the newest frame immediately.
 */
export function adaptivePoseSmooth(
  previous: number,
  sample: number,
  deltaSeconds: number,
  options: { minAlpha: number; maxAlpha: number; fullSpeed: number; deadband: number },
): number {
  const difference = sample - previous
  if (Math.abs(difference) <= options.deadband) return previous

  const safeDelta = Math.max(1 / 120, Math.min(deltaSeconds, 0.1))
  const velocity = Math.abs(difference) / safeDelta
  const motionRatio = Math.min(1, velocity / options.fullSpeed)
  const alpha = options.minAlpha + (options.maxAlpha - options.minAlpha) * motionRatio
  return previous + difference * alpha
}
