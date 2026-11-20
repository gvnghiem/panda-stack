# Panda Stack — review & roadmap

## Problems found in the original
- Fixed 800×600 canvas that never scaled, so it was unusable on phones.
- Panda sprite (448×652) was squashed into 50×50.
- `styles.css` referenced a missing `bamboo-bg.jpg`.
- Touch was nudge-only swipes; random spawn x with no skill element; `alert()` for game over; no pause.
- ~830 KB sky image for a flat gradient.

## Done in this version
See README "What's new".

## Ideas for next
1. **Daily seed / share card** — same swing pattern for everyone, "I stacked 42 🐼" share image.
2. **Power-ups** — glue (steadies the tower), bamboo-snack slow-mo, a sleepy "heavy" panda.
3. **Wind gusts** above ~25 pandas that push the tower sway and swing arc.
4. **Unlockable accessories & themes** (cherry-blossom day, snow mountain) from lifetime pandas stacked.
5. **Online leaderboard** (small serverless endpoint) once the score formula has settled.
6. **Ambient music + service worker** for offline play and full PWA install.
7. **Tests**: the `analyse()` stability function is pure and easy to unit-test.
