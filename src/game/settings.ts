import {
  HORIZONTAL_SENSITIVITY,
  normalizeHorizontalSensitivity,
} from './poseControlModel.js'

export const HORIZONTAL_SENSITIVITY_STORAGE_KEY = 'motion-rush-horizontal-sensitivity'

export function loadHorizontalSensitivity(): number {
  try {
    const saved = localStorage.getItem(HORIZONTAL_SENSITIVITY_STORAGE_KEY)
    if (saved === null) return HORIZONTAL_SENSITIVITY.default
    return normalizeHorizontalSensitivity(Number(saved))
  } catch {
    return HORIZONTAL_SENSITIVITY.default
  }
}

export function saveHorizontalSensitivity(value: number): number {
  const normalized = normalizeHorizontalSensitivity(value)
  try {
    localStorage.setItem(HORIZONTAL_SENSITIVITY_STORAGE_KEY, String(normalized))
  } catch {
    // Private browsing/storage restrictions should not disable live controls.
  }
  return normalized
}
