# Squatopia: Fireball Range

A WebXR demo of Squatopia: stand on an alpine ledge and punch fireballs at target rings for 60 seconds.

- **Play:** https://clrke.github.io/squatopia-webxr/ (Quest Browser: Enter VR; desktop: Play in browser, click to throw, drag to look)
- **Throwing:** a forward jab (Reach) throws a fireball along the punch's own path, from where the stroke began to where it let go, as fast as you punch.
- **Menus:** look and pinch. The pinch's own ray picks the button: your eye gaze where the Browser reports pinches as a transient-pointer (eye tracking), otherwise your hand's pointing ray.
- **Music:** a 120 BPM piece whose melody and drums play only in the beats your punches unlock; the last 10 seconds speed up with timer beeps.

Plain static files (Three.js 0.160 from unpkg), no build step. Run locally with `python3 -m http.server`.
