import assert from 'node:assert/strict'
import {
  adaptivePoseSmooth,
  resolveAbsoluteLane,
  updateCrouchGate,
  updateJumpGate,
} from '../.control-test-build/poseControlModel.js'

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
