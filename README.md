# Squatopia: Fireball Range

A WebXR demo of Squatopia: stand on an alpine ledge and punch fireballs at target rings for 60 seconds.

- **Play:** https://clrke.github.io/squatopia-webxr/ (Quest Browser: Enter VR; desktop: Play in browser, click to throw, drag to look)
- **Throwing:** a forward jab (Reach) throws a fireball along the punch's own path, from where the stroke began to where it let go, as fast as you punch.
- **Menus:** look and pinch. The pinch's own ray picks the button: your eye gaze where the Browser reports pinches as a transient-pointer (eye tracking), otherwise your hand's pointing ray.
- **Music:** a 120 BPM piece whose melody and drums play only in the beats your punches unlock; the last 10 seconds speed up with timer beeps.

Plain static files, no build step, no CDN: three.js r160 is vendored in `vendor/three/`. Run locally with `python3 -m http.server`.

**Licences:** everything is first-party (models, textures, synthesized sounds and music) except three.js (MIT, `vendor/three/LICENSE`), the WebXR Input Profiles generic hand models (MIT, `vendor/hands/LICENSE.md`) and the Fredoka and Nunito fonts (SIL OFL 1.1, `fonts/`). Controller models, if a controller is used, load from the WebXR Input Profiles CDN.
