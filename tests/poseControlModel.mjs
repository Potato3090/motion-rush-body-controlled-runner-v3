import assert from 'node:assert/strict'
import {
  HORIZONTAL_SENSITIVITY,
  adaptivePoseSmooth,
  applyHorizontalSensitivity,
  normalizeHorizontalSensitivity,
  resolveAbsoluteLane,
  updateCrouchGate,
  updateJumpGate,
} from '../.control-test-build/poseControlModel.js'

// Fine-step sensitivity, clamping, center preservation, and shared processed
// signal behavior for both the tracking dot and absolute lane model.
assert.equal(normalizeHorizontalSensitivity(0.9), 0.9)
assert.equal(normalizeHorizontalSensitivity(1.1), 1.1)
assert.equal(normalizeHorizontalSensitivity(1.35), 1.35)
assert.equal(normalizeHorizontalSensitivity(1.95), 1.95)
assert.equal(normalizeHorizontalSensitivity(0.1), HORIZONTAL_SENSITIVITY.min)
assert.equal(normalizeHorizontalSensitivity(4), HORIZONTAL_SENSITIVITY.max)
assert.equal(applyHorizontalSensitivity(0, 2), 0)
assert.equal(applyHorizontalSensitivity(0.04, 0.5), 0.02)
assert.equal(applyHorizontalSensitivity(0.04, 1), 0.04)
assert.equal(applyHorizontalSensitivity(0.04, 2), 0.08)
assert.equal(applyHorizontalSensitivity(0.2, 2), HORIZONTAL_SENSITIVITY.maxProcessedOffset)
assert.equal(applyHorizontalSensitivity(-0.2, 2), -HORIZONTAL_SENSITIVITY.maxProcessedOffset)
assert.equal(resolveAbsoluteLane(applyHorizontalSensitivity(0.04, 0.5), 1), 1)
assert.equal(resolveAbsoluteLane(applyHorizontalSensitivity(0.04, 2), 1), 2)
assert.equal(resolveAbsoluteLane(applyHorizontalSensitivity(0.12, 0.5), 1), 2, 'minimum sensitivity must still reach the right lane')
assert.equal(resolveAbsoluteLane(applyHorizontalSensitivity(-0.12, 0.5), 1), 0, 'minimum sensitivity must still reach the left lane')
assert.equal(resolveAbsoluteLane(applyHorizontalSensitivity(-0.04, 2), 2), 0)
assert.equal(resolveAbsoluteLane(applyHorizontalSensitivity(0.02, 2), 1), 1, 'high-sensitivity jitter must stay inside the center zone')

// The local persistence adapter restores saved fine-step values and normalizes
// invalid/out-of-range storage without affecting runtime availability.
const fakeStorage = new Map()
globalThis.localStorage = {
  getItem: (key) => fakeStorage.has(key) ? fakeStorage.get(key) : null,
  setItem: (key, value) => fakeStorage.set(key, String(value)),
}
const {
  HORIZONTAL_SENSITIVITY_STORAGE_KEY,
  loadHorizontalSensitivity,
  saveHorizontalSensitivity,
} = await import('../.control-test-build/settings.js')
assert.equal(loadHorizontalSensitivity(), 1)
assert.equal(saveHorizontalSensitivity(1.35), 1.35)
assert.equal(fakeStorage.get(HORIZONTAL_SENSITIVITY_STORAGE_KEY), '1.35')
assert.equal(loadHorizontalSensitivity(), 1.35)
fakeStorage.set(HORIZONTAL_SENSITIVITY_STORAGE_KEY, '99')
assert.equal(loadHorizontalSensitivity(), 2)
delete globalThis.localStorage

// Absolute lane selection, including direct opposite-side retargeting.
assert.equal(resolveAbsoluteLane(0, 1), 1)
assert.equal(resolveAbsoluteLane(0.056, 1), 2)
assert.equal(resolveAbsoluteLane(-0.08, 2), 0)
assert.equal(resolveAbsoluteLane(0.08, 0), 2)

// Narrow hysteresis holds a lane at its edge but releases promptly to center.
assert.equal(resolveAbsoluteLane(0.04, 2), 2)
assert.equal(resolveAbsoluteLane(0.036, 2), 1)
assert.equal(resolveAbsoluteLane(-0.04, 0), 0)
assert.equal(resolveAbsoluteLane(-0.036, 0), 1)

// Fast intentional movement receives the newest frame almost immediately.
const fastMove = adaptivePoseSmooth(0, 0.09, 1 / 30, {
  minAlpha: 0.46,
  maxAlpha: 0.9,
  fullSpeed: 0.72,
  deadband: 0.0014,
})
assert.ok(fastMove > 0.055, 'intentional movement should cross the lane threshold in one frame')
assert.equal(adaptivePoseSmooth(0, 0.001, 1 / 30, {
  minAlpha: 0.46,
  maxAlpha: 0.9,
  fullSpeed: 0.72,
  deadband: 0.0014,
}), 0, 'sub-deadband jitter should be ignored')

// Crouch requires only two reliable enter frames, remains held indefinitely,
// and exits on the first real stand-up frame.
let crouch = { crouching: false, enterFrames: 0 }
crouch = updateCrouchGate(0.06, crouch)
assert.deepEqual(crouch, { crouching: false, enterFrames: 1 })
crouch = updateCrouchGate(0.061, crouch)
assert.deepEqual(crouch, { crouching: true, enterFrames: 0 })
for (let frame = 0; frame < 180; frame += 1) crouch = updateCrouchGate(0.055, crouch)
assert.equal(crouch.crouching, true, 'crouch must not time out')
crouch = updateCrouchGate(0.038, crouch)
assert.equal(crouch.crouching, false, 'standing should release crouch immediately')

// One takeoff triggers once. No timer is involved; two neutral landing frames
// rearm the next physical jump, while minor vertical movement never triggers.
let jump = { armed: true, neutralFrames: 0 }
let jumpResult = updateJumpGate(-0.053, jump, false)
assert.equal(jumpResult.triggered, true)
jump = { armed: jumpResult.armed, neutralFrames: jumpResult.neutralFrames }
jumpResult = updateJumpGate(-0.08, jump, false)
assert.equal(jumpResult.triggered, false)
jump = { armed: jumpResult.armed, neutralFrames: jumpResult.neutralFrames }
jumpResult = updateJumpGate(0, jump, false)
assert.equal(jumpResult.armed, false)
jump = { armed: jumpResult.armed, neutralFrames: jumpResult.neutralFrames }
jumpResult = updateJumpGate(0.002, jump, false)
assert.equal(jumpResult.armed, true)
jump = { armed: jumpResult.armed, neutralFrames: jumpResult.neutralFrames }
jumpResult = updateJumpGate(-0.03, jump, false)
assert.equal(jumpResult.triggered, false)

console.log('Camera control model: all acceptance checks passed.')
