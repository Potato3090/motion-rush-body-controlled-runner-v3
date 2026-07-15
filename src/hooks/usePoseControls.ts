import { useCallback, useEffect, useRef, useState } from 'react'
import type { PoseLandmarker as PoseLandmarkerInstance } from '@mediapipe/tasks-vision'
import type { CalibrationBaseline, PoseSignal, RunnerAction } from '../game/types'

export type CameraStatus = 'off' | 'requesting' | 'ready' | 'calibrating' | 'active' | 'error'

interface Landmark {
  x: number
  y: number
  z?: number
  visibility?: number
}

interface UsePoseControlsOptions {
  onAction: (action: RunnerAction) => void
}

const WASM_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm'
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task'

const CONNECTIONS: Array<[number, number]> = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27],
  [24, 26], [26, 28],
]

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)
}

export function usePoseControls({ onAction }: UsePoseControlsOptions) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const detectorRef = useRef<PoseLandmarkerInstance | null>(null)
  const frameRef = useRef(0)
  const statusRef = useRef<CameraStatus>('off')
  const baselineRef = useRef<CalibrationBaseline | null>(null)
  const smoothRef = useRef<{ x: number; y: number } | null>(null)
  const calibrationRef = useRef<{ started: number; x: number[]; y: number[] } | null>(null)
  const horizontalArmedRef = useRef(true)
  const verticalArmedRef = useRef(true)
  const lastActionRef = useRef(0)
  const lastUiUpdateRef = useRef(0)
  const onActionRef = useRef(onAction)

  const [status, setStatusState] = useState<CameraStatus>('off')
  const [message, setMessage] = useState('Camera is off')
  const [error, setError] = useState<string | null>(null)
  const [calibrationProgress, setCalibrationProgress] = useState(0)
  const [signal, setSignal] = useState<PoseSignal>({ x: 0, y: 0, confidence: 0, action: null })

  useEffect(() => {
    onActionRef.current = onAction
  }, [onAction])

  const setStatus = useCallback((next: CameraStatus) => {
    statusRef.current = next
    setStatusState(next)
  }, [])

  const drawPose = useCallback((landmarks: Landmark[] | undefined) => {
    const canvas = canvasRef.current
    const video = videoRef.current
    if (!canvas || !video) return
    const width = video.videoWidth || 640
    const height = video.videoHeight || 480
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }
    const context = canvas.getContext('2d')
    if (!context) return
    context.clearRect(0, 0, width, height)
    if (!landmarks) return

    context.save()
    context.translate(width, 0)
    context.scale(-1, 1)
    context.lineCap = 'round'
    context.strokeStyle = 'rgba(69, 230, 222, .88)'
    context.lineWidth = Math.max(3, width / 180)
    for (const [from, to] of CONNECTIONS) {
      const start = landmarks[from]
      const end = landmarks[to]
      if (!start || !end || (start.visibility ?? 1) < 0.42 || (end.visibility ?? 1) < 0.42) continue
      context.beginPath()
      context.moveTo(start.x * width, start.y * height)
      context.lineTo(end.x * width, end.y * height)
      context.stroke()
    }
    context.fillStyle = '#ffd84b'
    for (const index of [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
      const point = landmarks[index]
      if (!point || (point.visibility ?? 1) < 0.42) continue
      context.beginPath()
      context.arc(point.x * width, point.y * height, Math.max(4, width / 110), 0, Math.PI * 2)
      context.fill()
    }
    context.restore()
  }, [])

  const interpretPose = useCallback((landmarks: Landmark[], now: number) => {
    const indices = [11, 12, 23, 24]
    if (indices.some((index) => !landmarks[index])) return
    const confidence = average(indices.map((index) => landmarks[index].visibility ?? 1))
    if (confidence < 0.48) {
      if (now - lastUiUpdateRef.current > 180) {
        lastUiUpdateRef.current = now
        setMessage('Step back so I can see your shoulders and hips')
        setSignal((current) => ({ ...current, confidence, action: null }))
      }
      return
    }

    const rawCenterX = average(indices.map((index) => landmarks[index].x))
    const mirroredCenterX = 1 - rawCenterX
    const shoulderY = average([landmarks[11].y, landmarks[12].y])
    const previous = smoothRef.current
    const smoothed = previous
      ? { x: previous.x * 0.72 + mirroredCenterX * 0.28, y: previous.y * 0.72 + shoulderY * 0.28 }
      : { x: mirroredCenterX, y: shoulderY }
    smoothRef.current = smoothed

    if (statusRef.current === 'calibrating') {
      const calibration = calibrationRef.current
      if (!calibration) return
      calibration.x.push(smoothed.x)
      calibration.y.push(smoothed.y)
      const progress = Math.min(1, (now - calibration.started) / 1800)
      if (now - lastUiUpdateRef.current > 80) {
        lastUiUpdateRef.current = now
        setCalibrationProgress(progress)
        setMessage(progress < 0.98 ? 'Hold your neutral running stance…' : 'Locked in!')
      }
      if (progress >= 1 && calibration.x.length > 12) {
        baselineRef.current = {
          centerX: average(calibration.x.slice(-45)),
          shoulderY: average(calibration.y.slice(-45)),
        }
        horizontalArmedRef.current = true
        verticalArmedRef.current = true
        calibrationRef.current = null
        setCalibrationProgress(1)
        setStatus('active')
        setMessage('Body controls active')
      }
      return
    }

    const baseline = baselineRef.current
    let action: RunnerAction | null = null
    let deltaX = 0
    let deltaY = 0
    if (statusRef.current === 'active' && baseline) {
      deltaX = smoothed.x - baseline.centerX
      deltaY = smoothed.y - baseline.shoulderY
      const cooldownPassed = now - lastActionRef.current > 430

      if (Math.abs(deltaX) < 0.035) horizontalArmedRef.current = true
      if (Math.abs(deltaY) < 0.035) verticalArmedRef.current = true

      if (cooldownPassed && horizontalArmedRef.current && Math.abs(deltaX) > 0.072) {
        action = deltaX > 0 ? 'right' : 'left'
        horizontalArmedRef.current = false
      } else if (cooldownPassed && verticalArmedRef.current && deltaY < -0.058) {
        action = 'jump'
        verticalArmedRef.current = false
      } else if (cooldownPassed && verticalArmedRef.current && deltaY > 0.074) {
        action = 'slide'
        verticalArmedRef.current = false
      }

      if (action) {
        lastActionRef.current = now
        onActionRef.current(action)
        setMessage(action === 'slide' ? 'DUCK' : action.toUpperCase())
      } else if (now - lastUiUpdateRef.current > 160) {
        setMessage('Body controls active')
      }
    }

    if (now - lastUiUpdateRef.current > 90 || action) {
      lastUiUpdateRef.current = now
      setSignal({ x: deltaX, y: deltaY, confidence, action })
    }
  }, [setStatus])

  const poseLoop = useCallback(() => {
    const runFrame = () => {
      const detector = detectorRef.current
      const video = videoRef.current
      if (detector && video && video.readyState >= 2 && !video.paused) {
        try {
          const result = detector.detectForVideo(video, performance.now())
          const landmarks = result.landmarks[0] as Landmark[] | undefined
          drawPose(landmarks)
          if (landmarks) interpretPose(landmarks, performance.now())
        } catch {
          // A dropped inference frame should not stop gameplay or the camera loop.
        }
      }
      frameRef.current = requestAnimationFrame(runFrame)
    }
    cancelAnimationFrame(frameRef.current)
    frameRef.current = requestAnimationFrame(runFrame)
  }, [drawPose, interpretPose])

  const createDetector = useCallback(async () => {
    const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision')
    const vision = await FilesetResolver.forVisionTasks(WASM_ROOT)
    const options = {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' as const },
      runningMode: 'VIDEO' as const,
      numPoses: 1,
      minPoseDetectionConfidence: 0.52,
      minPosePresenceConfidence: 0.52,
      minTrackingConfidence: 0.5,
    }
    try {
      return await PoseLandmarker.createFromOptions(vision, options)
    } catch {
      return PoseLandmarker.createFromOptions(vision, {
        ...options,
        baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
      })
    }
  }, [])

  const enableCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('This browser cannot access a camera. Swipe controls still work.')
      setStatus('error')
      return false
    }

    setError(null)
    setStatus('requesting')
    setMessage('Starting camera and pose model…')
    try {
      const [stream, detector] = await Promise.all([
        navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: 'user',
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 30, max: 30 },
          },
        }),
        createDetector(),
      ])
      streamRef.current = stream
      detectorRef.current = detector
      const video = videoRef.current
      if (!video) throw new Error('Camera preview is not available')
      video.srcObject = stream
      video.muted = true
      video.playsInline = true
      await video.play()
      smoothRef.current = null
      setStatus('ready')
      setMessage('Camera ready — stand where your shoulders and hips are visible')
      poseLoop()
      return true
    } catch (caught) {
      const name = caught instanceof DOMException ? caught.name : ''
      const friendly =
        name === 'NotAllowedError'
          ? 'Camera permission was blocked. Allow it in Safari settings, or keep playing with swipes.'
          : 'Camera tracking could not start. Check your connection, then try again.'
      setError(friendly)
      setMessage('Camera unavailable')
      setStatus('error')
      return false
    }
  }, [createDetector, poseLoop, setStatus])

  const calibrate = useCallback(() => {
    if (statusRef.current !== 'ready' && statusRef.current !== 'active') return
    baselineRef.current = null
    smoothRef.current = null
    calibrationRef.current = { started: performance.now(), x: [], y: [] }
    setCalibrationProgress(0)
    setStatus('calibrating')
    setMessage('Hold your neutral running stance…')
  }, [setStatus])

  const stopCamera = useCallback(() => {
    cancelAnimationFrame(frameRef.current)
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    detectorRef.current?.close()
    detectorRef.current = null
    baselineRef.current = null
    calibrationRef.current = null
    const video = videoRef.current
    if (video) video.srcObject = null
    const canvas = canvasRef.current
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
    setSignal({ x: 0, y: 0, confidence: 0, action: null })
    setCalibrationProgress(0)
    setError(null)
    setMessage('Camera is off')
    setStatus('off')
  }, [setStatus])

  useEffect(() => stopCamera, [stopCamera])

  return {
    videoRef,
    canvasRef,
    status,
    message,
    error,
    signal,
    calibrationProgress,
    enableCamera,
    calibrate,
    stopCamera,
  }
}
