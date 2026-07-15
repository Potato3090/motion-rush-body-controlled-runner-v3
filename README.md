# Motion Rush V2

A mobile-first endless runner controlled by body movement through the phone's front camera. V2 adds absolute three-zone lane mapping, continuous camera-held crouching, and a low-latency armed jump model. The game also supports swipes, on-screen buttons, and keyboard controls.

## Run it on Replit

1. Create a new Replit app and import this folder/repository.
2. Replit will install the packages from `package.json`.
3. Press **Run**. The included `.replit` file serves the game on port 3000.
4. Publish with an Autoscale Deployment so the camera runs on HTTPS.

On iPhone, open the published HTTPS URL in Safari. Use **Share → Add to Home Screen** to install the PWA.

## Controls

- Swipe or arrow keys / WASD: move left, right, jump, and slide.
- Body camera: your horizontal position maps directly to the left, center, or right lane; pop upward to jump and stay ducked to remain crouched.
- `P` or `Escape`: pause.

## Camera notes

- Camera access requires HTTPS on iPhone; Replit's published URL provides it.
- Stand the phone upright and step back until your shoulders and hips fit in the preview.
- Calibrate in a relaxed neutral stance.
- Pose landmarks are processed locally in the browser. No camera frames are sent to this app or stored.
- The MediaPipe pose model is downloaded on first use and then cached by the PWA.

## Production build

```bash
npm run build
npm start
```
