/* Panda Stack — twilight bamboo grove edition
 *
 * A pandas-on-a-rope stacker. Pandas swing in from the top; tap / click / Space
 * drops one. Land it near the middle for a Perfect and build a combo. Lean the tower
 * too far and everything above the weak point topples.
 *
 * Everything is drawn in code (no image assets), in "world units" so the same game
 * plays identically on a phone, a tablet and a wide desktop window.
 */
(() => {
    'use strict';

    // ------------------------------------------------------------------ setup
    const $ = (id) => document.getElementById(id);
    const canvas = $('stage');
    const ctx = canvas.getContext('2d');
    const TAU = Math.PI * 2;
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const lerp = (a, b, t) => a + (b - a) * t;
    const rand = (a, b) => a + Math.random() * (b - a);
    const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

    // World units. The playable column is always WORLD_W units wide.
    const WORLD_W = 360;
    const BW = 72;            // panda width
    const BH = 50;            // stacking pitch (pandas overlap a little, squishy)
    const SPRITE_H = 60;      // panda height from feet to top of head
    const BASE_X = WORLD_W / 2;
    const BASE_W = 150;       // bamboo raft width
    const PLAT_H = 16;        // raft height (first panda lands on top of it)
    const GM = 56;            // ground margin: how much ground shows at the bottom at cam = 0
    const PERFECT = 7;        // |offset| under this snaps and counts as Perfect
    const SAFE = 0.92;        // how much of a support's width counts as stable
    const GRAV = 2000;
    const ROPE = 320;         // virtual pendulum length
    const MAX_LIVES = 5;

    const store = {
        get(k, d) { try { const v = localStorage.getItem('pandastack.' + k); return v === null ? d : v; } catch (e) { return d; } },
        set(k, v) { try { localStorage.setItem('pandastack.' + k, v); } catch (e) { /* private mode */ } }
    };

    // seeded rng so the bamboo looks the same each time the layout rebuilds
    function rng(seed) {
        return () => {
            seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
            let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    // ------------------------------------------------------------------ state
    const st = {
        mode: 'title',        // title | playing | paused | ending | over
        t: 0,
        score: 0,
        best: parseInt(store.get('best', '0'), 10) || 0,
        lives: 3,
        combo: 0,
        blocks: [],           // stacked pandas: {x, y, variant, born}
        hang: null,           // panda swinging on the rope {variant, age}
        fall: null,           // panda in free fall
        debris: [],
        parts: [],
        texts: [],
        cam: 0, camT: 0,
        sway: 0, swayV: 0,
        margin: 1,
        shake: 0,
        phase: 0,
        lastVariant: 0,
        milestones: new Set(),
        endTimer: 0,
        muted: store.get('muted', '0') === '1'
    };

    // layout (set in layout())
    let S = 1, VW = WORLD_W, H = 700, offX = 0, dpr = 1;

    // ------------------------------------------------------------------ colour helpers
    const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
    const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const rgb = (a, al) => al === undefined ? `rgb(${a[0] | 0},${a[1] | 0},${a[2] | 0})` : `rgba(${a[0] | 0},${a[1] | 0},${a[2] | 0},${al})`;

    // Sky palettes by altitude (world units of camera height): sunset -> dusk -> night -> deep night
    const SKY = [
        { a: 0,    top: hex('#6a4c93'), mid: hex('#f08aa0'), bot: hex('#ffc9a0') },
        { a: 550,  top: hex('#2c2468'), mid: hex('#8a4a9c'), bot: hex('#f0809e') },
        { a: 1200, top: hex('#0d1240'), mid: hex('#2a2f86'), bot: hex('#6a4fa8') },
        { a: 2000, top: hex('#060a2b'), mid: hex('#16206a'), bot: hex('#2d3b94') },
        { a: 3000, top: hex('#02030f'), mid: hex('#0b1050'), bot: hex('#1c2b7a') }
    ];
    function skyAt(alt) {
        let i = 0;
        while (i < SKY.length - 2 && alt > SKY[i + 1].a) i++;
        const A = SKY[i], B = SKY[i + 1];
        const t = clamp((alt - A.a) / (B.a - A.a), 0, 1);
        return { top: mix(A.top, B.top, t), mid: mix(A.mid, B.mid, t), bot: mix(A.bot, B.bot, t) };
    }

    // ------------------------------------------------------------------ layout & coordinates
    let layers = null, stars = [], clouds = [], flies = [];

    function layout() {
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        const cw = window.innerWidth, ch = window.innerHeight;
        canvas.style.width = cw + 'px';
        canvas.style.height = ch + 'px';
        canvas.width = Math.round(cw * dpr);
        canvas.height = Math.round(ch * dpr);
        // The game column is as wide as the screen allows, but never wider than a ~tall phone
        // proportion — so wide windows get a centred column with the scenery filling the sides.
        const colCss = Math.min(cw, Math.max(ch * 0.62, 320));
        S = (colCss / WORLD_W) * dpr;
        VW = canvas.width / S;
        H = canvas.height / S;
        offX = (VW - WORLD_W) / 2;
        document.documentElement.style.setProperty('--col', colCss + 'px');
        buildScenery();
    }

    const X = (x) => (x + offX) * S;
    const Y = (wy) => canvas.height - (wy - st.cam + GM) * S;

    function buildScenery() {
        const r = rng(7);
        const mk = (count, wMin, wMax, spMin, spMax) => {
            const arr = [];
            for (let i = 0; i < count; i++) {
                arr.push({
                    u: (i + 0.15 + r() * 0.7) / count,
                    w: rand(wMin, wMax),
                    sp: rand(spMin, spMax),
                    off: r() * 400,
                    shade: r()
                });
            }
            return arr;
        };
        const per = Math.max(1, VW / WORLD_W);
        layers = {
            far:  { f: 0.12, stalks: mk(Math.round(16 * per), 7, 12, 55, 80) },
            mid:  { f: 0.32, stalks: mk(Math.round(9 * per), 13, 20, 70, 100) },
            near: { f: 0.85, stalks: mk(Math.round(5 * per), 30, 44, 90, 120) }
        };
        stars = Array.from({ length: 150 }, () => ({ u: r(), v: r(), r: 0.6 + r() * 1.6, tw: 1 + r() * 3, ph: r() * TAU }));
        clouds = Array.from({ length: 8 }, () => ({ u: r(), v: r(), s: 0.7 + r() * 0.9, sp: 3 + r() * 6 }));
        flies = Array.from({ length: 28 }, () => ({ u: r(), v: r(), ph: r() * TAU, sp: 0.3 + r() * 0.7, f: 0.2 + r() * 0.7 }));
    }

    // ------------------------------------------------------------------ audio (synthesised, no files)
    let actx = null, master = null;
    function unlockAudio() {
        if (!actx) {
            try {
                actx = new (window.AudioContext || window.webkitAudioContext)();
                master = actx.createGain();
                master.gain.value = st.muted ? 0 : 0.55;
                master.connect(actx.destination);
            } catch (e) { actx = null; }
        }
        if (actx && actx.state === 'suspended') actx.resume();
    }
    function tone(f1, f2, dur, type, vol, delay) {
        if (!actx || st.muted) return;
        const t0 = actx.currentTime + (delay || 0);
        const o = actx.createOscillator(), g = actx.createGain();
        o.type = type || 'sine';
        o.frequency.setValueAtTime(f1, t0);
        if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        o.connect(g); g.connect(master);
        o.start(t0); o.stop(t0 + dur + 0.05);
    }
    function noise(dur, vol, cutoff, delay) {
        if (!actx || st.muted) return;
        const t0 = actx.currentTime + (delay || 0);
        const len = Math.max(1, Math.floor(actx.sampleRate * dur));
        const buf = actx.createBuffer(1, len, actx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
        const src = actx.createBufferSource(); src.buffer = buf;
        const f = actx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff;
        const g = actx.createGain(); g.gain.value = vol;
        src.connect(f); f.connect(g); g.connect(master);
        src.start(t0);
    }
    const PENTA = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.7, 1318.5, 1568];
    const sfx = {
        release() { tone(620, 380, 0.09, 'triangle', 0.12); },
        land()    { tone(190, 80, 0.14, 'triangle', 0.4); noise(0.07, 0.25, 700); },
        perfect(c) {
            tone(190, 80, 0.14, 'triangle', 0.35); noise(0.05, 0.18, 700);
            const n = PENTA[Math.min(c, PENTA.length) - 1];
            tone(n, null, 0.28, 'sine', 0.28, 0.02);
            tone(n * 2, null, 0.22, 'sine', 0.12, 0.02);
        },
        miss()    { tone(340, 90, 0.5, 'sawtooth', 0.16); },
        topple()  { noise(0.6, 0.5, 900); tone(130, 45, 0.5, 'triangle', 0.35); tone(340, 90, 0.5, 'sawtooth', 0.12); },
        life()    { [523, 659, 784, 1046].forEach((f, i) => tone(f, null, 0.18, 'triangle', 0.22, i * 0.07)); },
        over()    { [392, 330, 262, 196].forEach((f, i) => tone(f, f * 0.97, 0.3, 'triangle', 0.25, i * 0.16)); },
        milestone() { [523, 784, 1046].forEach((f, i) => tone(f, null, 0.3, 'sine', 0.2, i * 0.1)); },
        ui()      { tone(700, 900, 0.07, 'sine', 0.15); }
    };
    const buzz = (p) => { if (!st.muted && navigator.vibrate) { try { navigator.vibrate(p); } catch (e) { /* ignore */ } } };

    // ------------------------------------------------------------------ panda sprite
    const INK = '#23212e';
    function ell(c, x, y, rx, ry, rot) { c.beginPath(); c.ellipse(x, y, rx, ry, rot || 0, 0, TAU); }

    // Draws a panda with origin at bottom-centre, y up is negative. ~72 wide, ~60 tall.
    // expr: normal | happy | content | shock | worried      arms: 'down' | 'up'
    function drawPanda(c, variant, expr, arms) {
        c.lineJoin = 'round'; c.lineCap = 'round';
        // ears
        c.fillStyle = INK;
        for (const s of [-1, 1]) { ell(c, s * 24, -50, 10, 9.5); c.fill(); }
        // feet
        for (const s of [-1, 1]) { ell(c, s * 20, -4, 12.5, 7.5); c.fill(); }
        // body/head (one chubby mochi)
        c.fillStyle = '#fffdf7'; c.strokeStyle = INK; c.lineWidth = 2.6;
        ell(c, 0, -27, 36, 27); c.fill(); c.stroke();
        // soft belly shade
        c.fillStyle = 'rgba(120,100,160,.12)';
        c.beginPath(); c.ellipse(0, -27, 33, 24, 0, 0.15, Math.PI - 0.15); c.fill();
        // arms
        c.fillStyle = INK;
        if (arms === 'up') {
            for (const s of [-1, 1]) { ell(c, s * 27, -50, 7, 13, s * 0.35); c.fill(); }
        } else {
            for (const s of [-1, 1]) { ell(c, s * 34, -17, 7.5, 12.5, -s * 0.4); c.fill(); }
        }
        // eye patches
        for (const s of [-1, 1]) { ell(c, s * 15, -30, 8.5, 10.5, s * 0.45); c.fill(); }
        // eyes
        const eyeX = 15, eyeY = -31;
        if (expr === 'happy' || expr === 'content') {
            c.strokeStyle = '#fff'; c.lineWidth = 2.6;
            for (const s of [-1, 1]) {
                c.beginPath();
                if (expr === 'happy') c.arc(s * eyeX, eyeY + 3, 4.2, Math.PI * 1.1, Math.PI * 1.9);          // ^ ^
                else c.arc(s * eyeX, eyeY - 1.5, 4.2, Math.PI * 0.15, Math.PI * 0.85);                       // ‿ ‿
                c.stroke();
            }
        } else {
            const big = expr === 'shock';
            for (const s of [-1, 1]) {
                c.fillStyle = '#fff'; ell(c, s * eyeX, eyeY, big ? 4.6 : 3.4, big ? 4.9 : 3.8); c.fill();
                c.fillStyle = INK; ell(c, s * eyeX + (expr === 'worried' ? 0 : 0.4), eyeY + (big ? 0 : 0.5), big ? 2.1 : 1.9, big ? 2.4 : 2.3); c.fill();
                c.fillStyle = '#fff'; ell(c, s * eyeX + 1.1, eyeY - 1.3, 0.9, 0.9); c.fill();
            }
            if (expr === 'worried') {
                c.strokeStyle = INK; c.lineWidth = 2; c.beginPath();
                c.moveTo(-23, -44.5); c.lineTo(-9, -41.5);
                c.moveTo(23, -44.5); c.lineTo(9, -41.5);
                c.stroke();
            }
        }
        // nose + mouth
        c.fillStyle = INK; c.beginPath();
        c.moveTo(-4.5, -22.5); c.quadraticCurveTo(0, -25.5, 4.5, -22.5); c.quadraticCurveTo(0, -17.5, -4.5, -22.5); c.fill();
        c.strokeStyle = INK; c.lineWidth = 1.9;
        c.beginPath();
        if (expr === 'happy') {
            c.moveTo(-6, -17); c.quadraticCurveTo(0, -8, 6, -17); c.closePath(); c.fillStyle = '#ff7a95'; c.fill(); c.stroke();
        } else if (expr === 'shock') {
            ell(c, 0, -15, 3.2, 4.2); c.fillStyle = '#ff7a95'; c.fill(); c.stroke();
        } else if (expr === 'worried') {
            c.moveTo(-6, -14); c.quadraticCurveTo(-3, -17.5, 0, -14.5); c.quadraticCurveTo(3, -11.5, 6, -15); c.stroke();
        } else {
            c.moveTo(-6, -17.5); c.quadraticCurveTo(-3, -13.5, 0, -17.5); c.quadraticCurveTo(3, -13.5, 6, -17.5); c.stroke();
        }
        // blush
        c.fillStyle = 'rgba(255,130,160,.45)';
        for (const s of [-1, 1]) { ell(c, s * 25, -19, 5.5, 3.3); c.fill(); }
        // sweat drop
        if (expr === 'worried') {
            c.fillStyle = '#8fd3ff'; c.strokeStyle = 'rgba(40,90,160,.8)'; c.lineWidth = 1;
            c.beginPath(); c.moveTo(31, -53); c.quadraticCurveTo(37, -44, 31, -41); c.quadraticCurveTo(25, -44, 31, -53); c.fill(); c.stroke();
        }
        accessory(c, variant % 8, expr);
    }

    function accessory(c, v, expr) {
        c.lineJoin = 'round'; c.lineCap = 'round';
        switch (v) {
            case 0: { // bamboo leaf on the head
                c.fillStyle = '#4fbf7a'; c.strokeStyle = '#1f6b46'; c.lineWidth = 1.6;
                c.save(); c.translate(0, -55); c.rotate(-0.35);
                c.beginPath(); c.moveTo(-3, 2); c.quadraticCurveTo(-4, -16, 6, -22); c.quadraticCurveTo(12, -8, 3, 2); c.closePath(); c.fill(); c.stroke();
                c.beginPath(); c.moveTo(0, 1); c.lineTo(5, -17); c.stroke();
                c.restore(); break;
            }
            case 1: { // red scarf
                c.strokeStyle = '#ff5d6c'; c.lineWidth = 7;
                c.beginPath(); c.moveTo(-26, -9); c.quadraticCurveTo(0, 1, 26, -9); c.stroke();
                c.fillStyle = '#ff5d6c';
                c.beginPath(); c.moveTo(14, -6); c.lineTo(26, 4); c.lineTo(17, 7); c.lineTo(9, -2); c.closePath(); c.fill();
                c.strokeStyle = '#fff'; c.lineWidth = 1.6; c.setLineDash([2, 4]);
                c.beginPath(); c.moveTo(-24, -7); c.quadraticCurveTo(0, 3, 24, -7); c.stroke(); c.setLineDash([]);
                break;
            }
            case 2: { // pink bow
                c.fillStyle = '#ff8fb0'; c.strokeStyle = '#c24b78'; c.lineWidth = 1.6;
                c.save(); c.translate(26, -56); c.rotate(0.3);
                c.beginPath(); c.moveTo(0, 0); c.lineTo(-11, -7); c.lineTo(-11, 7); c.closePath(); c.fill(); c.stroke();
                c.beginPath(); c.moveTo(0, 0); c.lineTo(11, -7); c.lineTo(11, 7); c.closePath(); c.fill(); c.stroke();
                ell(c, 0, 0, 3.6, 3.6); c.fillStyle = '#ff5f93'; c.fill(); c.stroke();
                c.restore(); break;
            }
            case 3: { // sunglasses
                c.fillStyle = '#15131f'; c.strokeStyle = '#15131f'; c.lineWidth = 2.4;
                for (const s of [-1, 1]) {
                    c.beginPath(); c.roundRect ? c.roundRect(s * 15 - 10, -41, 20, 14, 5) : c.rect(s * 15 - 10, -41, 20, 14); c.fill();
                    c.fillStyle = 'rgba(255,255,255,.55)'; ell(c, s * 15 - 4, -37, 2.8, 1.6, -0.5); c.fill(); c.fillStyle = '#15131f';
                }
                c.beginPath(); c.moveTo(-6, -35); c.lineTo(6, -35); c.stroke();
                break;
            }
            case 4: { // party hat
                c.save(); c.translate(0, -56); c.rotate(0.12);
                c.fillStyle = '#7bd5ff'; c.strokeStyle = '#2d7fb0'; c.lineWidth = 1.8;
                c.beginPath(); c.moveTo(-12, 3); c.lineTo(0, -26); c.lineTo(12, 3); c.closePath(); c.fill(); c.stroke();
                c.fillStyle = '#ffe08a';
                ell(c, -3, -10, 2.3, 2.3); c.fill(); ell(c, 4, -3, 2.3, 2.3); c.fill(); ell(c, 1, -17, 2, 2); c.fill();
                c.fillStyle = '#ff7aa8'; ell(c, 0, -27, 4, 4); c.fill();
                c.restore(); break;
            }
            case 5: { // little gold crown
                c.fillStyle = '#ffd166'; c.strokeStyle = '#b8801a'; c.lineWidth = 1.8;
                c.save(); c.translate(0, -55);
                c.beginPath(); c.moveTo(-13, 2); c.lineTo(-15, -13); c.lineTo(-7, -6); c.lineTo(0, -16); c.lineTo(7, -6); c.lineTo(15, -13); c.lineTo(13, 2); c.closePath(); c.fill(); c.stroke();
                c.fillStyle = '#ff6b8b'; ell(c, 0, -4, 2.4, 2.4); c.fill();
                c.restore(); break;
            }
            case 6: { // holding a bamboo stalk
                c.save(); c.translate(-41, -4);
                c.fillStyle = '#58c985'; c.strokeStyle = '#1f6b46'; c.lineWidth = 1.8;
                c.beginPath(); c.roundRect ? c.roundRect(-4, -46, 8, 48, 3) : c.rect(-4, -46, 8, 48); c.fill(); c.stroke();
                c.beginPath(); c.moveTo(-4, -30); c.lineTo(4, -30); c.moveTo(-4, -14); c.lineTo(4, -14); c.stroke();
                c.fillStyle = '#7ee0a0';
                c.beginPath(); c.moveTo(4, -40); c.quadraticCurveTo(16, -48, 20, -38); c.quadraticCurveTo(10, -33, 4, -40); c.fill(); c.stroke();
                c.restore();
                c.fillStyle = INK; ell(c, -34, -15, 8, 8); c.fill();
                break;
            }
            default: { // hibiscus flower
                c.save(); c.translate(-26, -56);
                c.fillStyle = '#ff6f91'; c.strokeStyle = '#c23b62'; c.lineWidth = 1.2;
                for (let i = 0; i < 5; i++) { c.save(); c.rotate(i * TAU / 5); ell(c, 0, -5.5, 4.2, 5.8); c.fill(); c.stroke(); c.restore(); }
                c.fillStyle = '#ffe08a'; ell(c, 0, 0, 2.6, 2.6); c.fill();
                c.restore();
            }
        }
    }

    // ------------------------------------------------------------------ scenery drawing
    function drawSky() {
        const c = skyAt(st.cam);
        const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
        g.addColorStop(0, rgb(c.top)); g.addColorStop(0.6, rgb(c.mid)); g.addColorStop(1, rgb(c.bot));
        ctx.fillStyle = g; ctx.fillRect(0, 0, canvas.width, canvas.height);
        return c;
    }

    function drawStars() {
        const a = clamp((st.cam - 150) / 900, 0, 1) * 0.9 + 0.1;
        ctx.fillStyle = '#fff';
        for (const s of stars) {
            const y = ((s.v * canvas.height + st.cam * 0.05 * S) % canvas.height);
            const al = a * (0.45 + 0.55 * Math.sin(st.t * s.tw + s.ph)) * (1 - 0.6 * (y / canvas.height));
            if (al <= 0.02) continue;
            ctx.globalAlpha = al;
            ctx.beginPath(); ctx.arc(s.u * canvas.width, y, s.r * dpr, 0, TAU); ctx.fill();
        }
        ctx.globalAlpha = 1;
    }

    function drawSunMoon() {
        const sunA = clamp(1 - st.cam / 420, 0, 1);
        if (sunA > 0.01) {
            const x = X(BASE_X + 70), y = Y(0) - (120 - st.cam * 0.5) * S, r = 52 * S;
            const g = ctx.createRadialGradient(x, y, r * 0.2, x, y, r * 3.2);
            g.addColorStop(0, `rgba(255,236,190,${0.75 * sunA})`); g.addColorStop(1, 'rgba(255,170,150,0)');
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 3.2, 0, TAU); ctx.fill();
            ctx.fillStyle = `rgba(255,244,214,${sunA})`; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
        }
        const moonA = clamp((st.cam - 380) / 700, 0, 1);
        if (moonA > 0.01) {
            const x = X(WORLD_W * 0.74), y = (H * 0.2 + st.cam * 0.015) * S, r = 42 * S;
            const g = ctx.createRadialGradient(x, y, r * 0.5, x, y, r * 3.4);
            g.addColorStop(0, `rgba(255,248,220,${0.45 * moonA})`); g.addColorStop(1, 'rgba(255,248,220,0)');
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 3.4, 0, TAU); ctx.fill();
            ctx.fillStyle = `rgba(255,251,232,${moonA})`; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
            ctx.fillStyle = `rgba(214,206,190,${0.55 * moonA})`;
            for (const [dx, dy, rr] of [[-12, -8, 9], [10, 10, 7], [6, -16, 4.5], [-6, 16, 5]]) { ctx.beginPath(); ctx.arc(x + dx * S, y + dy * S, rr * S, 0, TAU); ctx.fill(); }
        }
    }

    function drawAurora() {
        const a = clamp((st.cam - 1700) / 1200, 0, 1) * 0.5;
        if (a < 0.02) return;
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        const cols = [['rgba(80,255,190,', 0.16], ['rgba(120,170,255,', 0.5], ['rgba(200,120,255,', 0.82]];
        cols.forEach(([col, base], k) => {
            const y0 = canvas.height * (0.12 + base * 0.2);
            const g = ctx.createLinearGradient(0, y0 - 120 * S, 0, y0 + 180 * S);
            g.addColorStop(0, col + '0)'); g.addColorStop(0.45, col + (a * 0.55) + ')'); g.addColorStop(1, col + '0)');
            ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, canvas.height);
            for (let px = 0; px <= canvas.width + 20; px += 20) {
                const u = px / canvas.width;
                ctx.lineTo(px, y0 + Math.sin(u * 5 + st.t * 0.4 + k * 2) * 40 * S + Math.sin(u * 11 - st.t * 0.3 + k) * 16 * S);
            }
            ctx.lineTo(canvas.width, canvas.height); ctx.closePath();
            ctx.save(); ctx.globalAlpha = 1; ctx.fill(); ctx.restore();
        });
        ctx.restore();
    }

    function drawClouds(sky) {
        const alpha = clamp(1 - (st.cam - 1400) / 1600, 0.08, 1) * 0.55;
        const col = mix(sky.bot, [255, 255, 255], 0.3);
        ctx.fillStyle = rgb(col, alpha);
        const span = canvas.height + 200 * S;
        for (const c of clouds) {
            const y = ((c.v * span + st.cam * 0.22 * S) % span) - 100 * S;
            const x = (((c.u * (VW + 300) + st.t * c.sp) % (VW + 300)) - 150) * S;
            const s = c.s * S;
            for (const [dx, dy, rx, ry] of [[0, 0, 60, 20], [-34, 6, 36, 14], [38, 5, 40, 15], [6, -12, 34, 16]]) {
                ctx.beginPath(); ctx.ellipse(x + dx * s, y + dy * s, rx * s, ry * s, 0, 0, TAU); ctx.fill();
            }
        }
    }

    function leaf(x, y, len, ang, col) {
        ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
        ctx.fillStyle = col; ctx.beginPath();
        ctx.moveTo(0, 0); ctx.quadraticCurveTo(len * 0.5, -len * 0.22, len, 0); ctx.quadraticCurveTo(len * 0.5, len * 0.1, 0, 0); ctx.fill();
        ctx.restore();
    }

    function drawBamboo(layerName, sky) {
        const L = layers[layerName];
        const fade = clamp(1 - (st.cam - 1000) / 1500, 0, 1);
        if (fade <= 0.01) return;
        const isNear = layerName === 'near', isFar = layerName === 'far';
        const baseCol = isFar ? hex('#2d6a58') : layerName === 'mid' ? hex('#1f5444') : hex('#0e2a26');
        const fog = isFar ? 0.62 : layerName === 'mid' ? 0.42 : 0.06;
        const col = mix(baseCol, sky.mid, fog);
        const hi = mix(col, [255, 255, 255], 0.14), dark = mix(col, [0, 0, 0], 0.4);
        const leafCol = rgb(mix(col, [120, 220, 150], 0.18));
        const shift = st.cam * L.f * S;
        const colL = offX * S, colR = (offX + WORLD_W) * S;
        ctx.globalAlpha = fade * (isNear ? 0.95 : 1);
        for (const k of L.stalks) {
            const x = k.u * canvas.width, w = k.w * S;
            if (isNear && x > colL - w && x < colR + w) continue; // keep the near foreground out of the play column
            ctx.fillStyle = rgb(col); ctx.fillRect(x - w / 2, 0, w, canvas.height);
            ctx.fillStyle = rgb(hi); ctx.fillRect(x - w / 2 + w * 0.14, 0, w * 0.2, canvas.height);
            const sp = k.sp * S, base = shift + k.off * S;
            const j0 = Math.ceil((-sp - base) / sp), j1 = Math.floor((canvas.height + sp - base) / sp);
            for (let j = j0; j <= j1; j++) {
                const y = base + j * sp;
                ctx.fillStyle = rgb(dark); ctx.fillRect(x - w / 2 - 1, y, w + 2, Math.max(2, w * 0.13));
                if (!isFar) {
                    const h = (Math.imul(j + 31, 2654435761) >>> 0) % 7;
                    if (h < 3) {
                        const dir = h % 2 ? 1 : -1;
                        leaf(x, y + w * 0.1, w * 2.4, dir > 0 ? -0.5 - h * 0.15 : Math.PI + 0.5 + h * 0.15, leafCol);
                        if (h === 0) leaf(x, y + w * 0.1, w * 1.8, dir > 0 ? 0.15 : Math.PI - 0.15, leafCol);
                    }
                }
            }
        }
        ctx.globalAlpha = 1;
    }

    function drawFireflies() {
        const a = clamp(0.25 + st.cam / 900, 0, 1) * clamp(1 - (st.cam - 1200) / 1200, 0, 1);
        if (a < 0.02) return;
        for (const f of flies) {
            const x = (f.u * canvas.width + Math.sin(st.t * f.sp + f.ph) * 30 * S) % canvas.width;
            const y = ((f.v * canvas.height + st.cam * f.f * S) + Math.cos(st.t * f.sp * 0.8 + f.ph) * 20 * S) % canvas.height;
            const tw = 0.5 + 0.5 * Math.sin(st.t * 2.2 * f.sp + f.ph * 3);
            ctx.fillStyle = `rgba(255,236,140,${0.18 * a * tw})`; ctx.beginPath(); ctx.arc(x, y, 7 * S, 0, TAU); ctx.fill();
            ctx.fillStyle = `rgba(255,248,200,${0.9 * a * tw})`; ctx.beginPath(); ctx.arc(x, y, 1.9 * S, 0, TAU); ctx.fill();
        }
    }

    function drawHills(sky) {
        const gy = canvas.height - (-st.cam * 0.55 + GM) * S;
        if (gy > canvas.height + 120 * S) return;
        const col = mix(hex('#2c6a5a'), sky.mid, 0.35);
        ctx.fillStyle = rgb(col);
        ctx.beginPath(); ctx.moveTo(0, canvas.height);
        for (let px = 0; px <= canvas.width + 16; px += 16) {
            const xu = px / S;
            ctx.lineTo(px, gy - (46 + 18 * Math.sin(xu * 0.014 + 1) + 11 * Math.sin(xu * 0.037)) * S);
        }
        ctx.lineTo(canvas.width, canvas.height); ctx.closePath(); ctx.fill();
        const col2 = mix(hex('#276a50'), sky.mid, 0.12);
        const gy2 = canvas.height - (-st.cam * 0.8 + GM) * S;
        ctx.fillStyle = rgb(col2);
        ctx.beginPath(); ctx.moveTo(0, canvas.height);
        for (let px = 0; px <= canvas.width + 16; px += 16) {
            const xu = px / S;
            ctx.lineTo(px, gy2 - (18 + 11 * Math.sin(xu * 0.02 + 3) + 6 * Math.sin(xu * 0.05)) * S);
        }
        ctx.lineTo(canvas.width, canvas.height); ctx.closePath(); ctx.fill();
    }

    function lantern(x, gy) {
        const px = X(x);
        const glowG = ctx.createRadialGradient(px, gy - 44 * S, 4 * S, px, gy - 44 * S, 70 * S);
        glowG.addColorStop(0, 'rgba(255,190,90,.55)'); glowG.addColorStop(1, 'rgba(255,190,90,0)');
        ctx.fillStyle = glowG; ctx.beginPath(); ctx.arc(px, gy - 44 * S, 70 * S, 0, TAU); ctx.fill();
        ctx.save(); ctx.translate(px, gy); ctx.scale(S, S);
        ctx.fillStyle = '#7d7a8f'; ctx.strokeStyle = '#3a3750'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.rect(-10, -8, 20, 8); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.rect(-4, -32, 8, 24); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.rect(-12, -44, 24, 12); ctx.fillStyle = '#ffcf70'; ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#7d7a8f';
        ctx.beginPath(); ctx.moveTo(-17, -44); ctx.lineTo(0, -56); ctx.lineTo(17, -44); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.restore();
    }

    function drawGround(sky) {
        const gy = Y(0);
        if (gy >= canvas.height + 80 * S) return;
        const top = mix(hex('#47b377'), sky.mid, 0.22), body = mix(hex('#2f8a5c'), sky.top, 0.3);
        ctx.fillStyle = rgb(body); ctx.fillRect(0, gy, canvas.width, canvas.height - gy + 4);
        ctx.fillStyle = rgb(top); ctx.fillRect(0, gy - 3 * S, canvas.width, 12 * S);
        // grass tufts along the edge (deterministic)
        const r = rng(99);
        ctx.fillStyle = rgb(mix(top, [255, 255, 255], 0.06));
        for (let px = 0; px < canvas.width; px += 11 * S) {
            const h = (5 + r() * 12) * S, lean = (r() - 0.5) * 8 * S;
            ctx.beginPath(); ctx.moveTo(px - 3 * S, gy - 2 * S); ctx.lineTo(px + lean, gy - 2 * S - h); ctx.lineTo(px + 3 * S, gy - 2 * S); ctx.fill();
        }
        // flowers
        const fr = rng(5);
        for (let i = 0; i < 18; i++) {
            const fx = fr() * canvas.width, fy = gy + (8 + fr() * 24) * S;
            ctx.fillStyle = i % 3 === 0 ? '#ffe08a' : i % 3 === 1 ? '#ff9fb2' : '#fff';
            ctx.beginPath(); ctx.arc(fx, fy, 2.2 * S, 0, TAU); ctx.fill();
        }
        lantern(26, gy); lantern(WORLD_W - 26, gy);
        // bamboo raft the first panda lands on
        ctx.save(); ctx.translate(X(BASE_X), gy); ctx.scale(S, S);
        const g = ctx.createLinearGradient(0, -PLAT_H, 0, 0);
        g.addColorStop(0, '#8be0a6'); g.addColorStop(0.5, '#46b676'); g.addColorStop(1, '#2a8458');
        ctx.fillStyle = g; ctx.strokeStyle = '#1b5a3c'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-BASE_W / 2, -PLAT_H, BASE_W, PLAT_H, 7) : ctx.rect(-BASE_W / 2, -PLAT_H, BASE_W, PLAT_H);
        ctx.fill(); ctx.stroke();
        ctx.strokeStyle = '#1b5a3c';
        for (const nx of [-46, 0, 46]) { ctx.beginPath(); ctx.moveTo(nx, -PLAT_H + 1); ctx.lineTo(nx, -1); ctx.stroke(); }
        ctx.strokeStyle = '#d9b36a'; ctx.lineWidth = 3;
        for (const nx of [-30, 30]) { ctx.beginPath(); ctx.moveTo(nx, -PLAT_H - 1); ctx.lineTo(nx, 1); ctx.stroke(); }
        ctx.restore();
    }

    function drawForegroundGrass(sky) {
        const gy = Y(0);
        if (gy >= canvas.height + 30 * S) return;
        const r = rng(321);
        const col = mix(hex('#47b377'), sky.mid, 0.15);
        ctx.fillStyle = rgb(mix(col, [0, 0, 0], 0.12));
        for (let px = 0; px < canvas.width; px += 17 * S) {
            const h = (9 + r() * 15) * S, lean = (r() - 0.5) * 14 * S;
            ctx.beginPath(); ctx.moveTo(px - 4 * S, gy + 4 * S); ctx.quadraticCurveTo(px + lean * 0.3, gy - h * 0.6, px + lean, gy - h); ctx.quadraticCurveTo(px + 3 * S, gy - h * 0.4, px + 4 * S, gy + 4 * S); ctx.fill();
        }
    }

    // ------------------------------------------------------------------ gameplay helpers
    const surface = () => PLAT_H + st.blocks.length * BH;
    const topX = () => st.blocks.length ? st.blocks[st.blocks.length - 1].x : BASE_X;

    function nextVariant() {
        st.lastVariant = (st.lastVariant + 1 + Math.floor(Math.random() * 7)) % 8;
        return st.lastVariant;
    }

    function swingParams() {
        const n = st.blocks.length;
        const w = 1.75 + Math.min(n, 40) * 0.045;                  // rad/s: faster as you climb
        const cx = BASE_X + (topX() - BASE_X) * 0.5;               // swing re-centres towards the lean
        const amp = Math.min(118 + Math.min(n, 20) * 1.8, cx - 42, WORLD_W - 42 - cx);
        return { w, cx, amp: Math.max(40, amp) };
    }

    // Where the swinging panda is right now (attach point on rope + angle + bottom centre)
    function swingPose() {
        const p = swingParams();
        const thMax = Math.asin(clamp(p.amp / ROPE, 0, 0.99));
        const th = thMax * Math.sin(st.phase);
        const hangOff = clamp(H * 0.2, 105, 170);
        const pivotY = st.cam + H - GM - hangOff + ROPE;                  // world y of virtual pivot (rope disappears off the top)
        const ax = p.cx + ROPE * Math.sin(th), ay = pivotY - ROPE * Math.cos(th);
        return { th, ax, ay, bx: ax + SPRITE_H * Math.sin(th), by: ay - SPRITE_H * Math.cos(th), cx: p.cx, pivotY };
    }

    // Walk the tower from the top and find the highest level whose supporting block can't
    // carry the centre of mass of everything above it. Returns {fail, margin}.
    function analyse(blocks) {
        const n = blocks.length;
        let sum = 0, margin = 1, fail = -1;
        for (let i = n - 1; i >= 0; i--) {
            sum += blocks[i].x;
            const com = sum / (n - i);
            const sx = i === 0 ? BASE_X : blocks[i - 1].x;
            const half = (i === 0 ? BASE_W : BW) / 2 * SAFE;
            const m = (half - Math.abs(com - sx)) / half;
            if (m < 0 && fail < 0) fail = i;
            margin = Math.min(margin, m);
        }
        return { fail, margin: clamp(margin, 0, 1) };
    }

    // ------------------------------------------------------------------ effects
    function dust(x, y, n, spread) {
        if (reduceMotion) n = Math.ceil(n / 3);
        for (let i = 0; i < n; i++) {
            st.parts.push({ type: 'dust', x: x + rand(-spread, spread), y, vx: rand(-60, 60), vy: rand(10, 50), life: 0, max: rand(0.35, 0.65), size: rand(5, 10) });
        }
    }
    function sparkle(x, y, n) {
        for (let i = 0; i < n; i++) {
            const a = rand(0, TAU), sp = rand(80, 200);
            st.parts.push({ type: 'star', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + 60, life: 0, max: rand(0.5, 0.9), size: rand(4, 8), rot: rand(0, TAU) });
        }
    }
    function leaves(x, y, n) {
        for (let i = 0; i < n; i++) {
            st.parts.push({ type: 'leaf', x: x + rand(-30, 30), y: y + rand(0, 30), vx: rand(-40, 40), vy: rand(20, 90), life: 0, max: rand(0.9, 1.5), size: rand(7, 12), rot: rand(0, TAU), vr: rand(-5, 5) });
        }
    }
    function ring(x, y) { st.parts.push({ type: 'ring', x, y, vx: 0, vy: 0, life: 0, max: 0.5, size: 20 }); }
    function floatText(x, y, text, color, size) { st.texts.push({ x, y, text, color: color || '#fff', size: size || 22, life: 0, max: 1.1 }); }
    function kick(amount) { if (!reduceMotion) st.shake = Math.max(st.shake, amount); }

    // ------------------------------------------------------------------ HUD / UI
    const el = {
        hud: $('hud'), lives: $('lives'), score: $('score'), best: $('best'), combo: $('combo'), toast: $('toast'),
        title: $('title'), paused: $('paused'), over: $('over'),
        btnSound: $('btnSound'), icoOn: $('icoOn'), icoOff: $('icoOff')
    };
    const HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.7-9.6-9.3C.9 8.4 2.9 4.5 6.6 4.5c2.2 0 3.7 1.2 5.4 3.2 1.7-2 3.2-3.2 5.4-3.2 3.7 0 5.7 3.9 4.2 7.2C19.500 16.300 12 21 12 21z"/></svg>';

    function renderLives(bumped) {
        const n = Math.max(3, st.lives);
        let html = '';
        for (let i = 0; i < n; i++) html += HEART;
        el.lives.innerHTML = html;
        [...el.lives.children].forEach((h, i) => {
            if (i >= st.lives) h.classList.add('off');
            if (bumped && i === st.lives) h.classList.add('bump');
        });
    }
    function renderScore(pop) {
        el.score.textContent = st.score;
        el.best.textContent = 'Best ' + st.best;
        if (pop) { el.score.classList.remove('pop'); void el.score.offsetWidth; el.score.classList.add('pop'); }
    }
    function renderCombo() {
        if (st.combo >= 2) {
            el.combo.textContent = 'PERFECT ×' + st.combo;
            el.combo.classList.remove('show'); void el.combo.offsetWidth; el.combo.classList.add('show');
        } else el.combo.classList.remove('show');
    }
    function toast(text) {
        el.toast.textContent = text;
        el.toast.classList.remove('show'); void el.toast.offsetWidth; el.toast.classList.add('show');
    }
    function renderSound() {
        el.icoOn.hidden = st.muted; el.icoOff.hidden = !st.muted;
        el.btnSound.setAttribute('aria-label', st.muted ? 'Unmute sound' : 'Mute sound');
    }
    function show(which) {
        for (const o of [el.title, el.paused, el.over]) o.classList.toggle('show', o === which);
    }

    const MILESTONES = [[10, 'Dusk Grove'], [20, 'Moonrise'], [32, 'Starry Summit'], [45, 'Aurora Peak'], [60, 'Panda Legend!']];

    // ------------------------------------------------------------------ game flow
    function resetRun() {
        st.score = 0; st.lives = 3; st.combo = 0;
        st.blocks = []; st.fall = null; st.debris = []; st.parts = []; st.texts = [];
        st.cam = 0; st.camT = 0; st.sway = 0; st.swayV = 0; st.margin = 1; st.shake = 0;
        st.phase = 0; st.milestones = new Set(); st.endTimer = 0;
        st.hang = { variant: nextVariant(), age: 0 };
        renderLives(); renderScore(); renderCombo();
    }

    function titleDecor() {
        resetRun();
        st.blocks = [
            { x: BASE_X - 2, y: PLAT_H, variant: 3, born: -9 },
            { x: BASE_X + 4, y: PLAT_H + BH, variant: 0, born: -9 },
            { x: BASE_X - 3, y: PLAT_H + BH * 2, variant: 5, born: -9 }
        ];
    }

    function startGame() {
        unlockAudio(); sfx.ui();
        resetRun();
        st.mode = 'playing';
        el.hud.hidden = false;
        show(null);
    }

    function pause() {
        if (st.mode !== 'playing') return;
        st.mode = 'paused'; show(el.paused);
    }
    function resume() {
        if (st.mode !== 'paused') return;
        st.mode = 'playing'; show(null); sfx.ui();
    }
    function toTitle() {
        titleDecor(); st.mode = 'title'; el.hud.hidden = true; show(el.title); updateTitleBest();
    }
    function updateTitleBest() { $('titleBest').textContent = st.best ? 'Best: ' + st.best : ''; }

    function drop() {
        if (st.mode !== 'playing' || !st.hang || st.fall || st.hang.age < 0.25) return;
        const p = swingPose();
        st.fall = { x: p.bx, y: p.by, vy: 0, rot: -p.th, vr: 0, variant: st.hang.variant, missed: false };
        st.hang = null;
        sfx.release();
    }

    function resolveLanding() {
        const f = st.fall, surf = surface();
        const supX = topX(), supW = st.blocks.length ? BW : BASE_W;
        const dx = f.x - supX;
        if (Math.abs(dx) >= (BW + supW) / 2 - 4) { // missed entirely: sails past
            f.missed = true; f.vr = rand(-5, 5);
            loseLife('Miss!', f.x, surf + 30);
            sfx.miss(); buzz([20, 40, 20]);
            return;
        }
        let x = f.x, perfect = false;
        if (Math.abs(dx) <= PERFECT) { x = supX; perfect = true; }
        const block = { x, y: surf, variant: f.variant, born: st.t };
        st.blocks.push(block);
        st.fall = null;

        const removed = [];
        let res = analyse(st.blocks);
        while (res.fail >= 0) { removed.push(...st.blocks.splice(res.fail)); res = analyse(st.blocks); }
        st.margin = res.margin;

        if (removed.length) {
            const survived = !removed.includes(block);
            const pivotIdx = st.blocks.length;
            const sx = pivotIdx === 0 ? BASE_X : st.blocks[pivotIdx - 1].x;
            const avg = removed.reduce((a, b) => a + b.x, 0) / removed.length;
            const dir = avg >= sx ? 1 : -1;
            removed.forEach((b, i) => st.debris.push({
                x: b.x, y: b.y, vx: dir * (70 + i * 14 + rand(0, 60)), vy: rand(120, 260), rot: 0, vr: dir * rand(2, 5), variant: b.variant
            }));
            st.combo = 0; renderCombo();
            loseLife(removed.length > 1 ? 'Timber!' : 'Slipped!', block.x, surf + 40);
            sfx.topple(); buzz([30, 30, 60]);
            kick(10);
            dust(block.x, surf, 8, 30);
            if (!survived) { st.swayV += dir * 40; spawnNext(); return; }
        }

        // survived: score it
        if (perfect) {
            st.combo++;
            const pts = 1 + Math.min(st.combo, 9);
            st.score += pts;
            floatText(x, surf + 70, st.combo > 1 ? `Perfect ×${st.combo}` : 'Perfect!', '#ffd166', 24);
            floatText(x, surf + 44, '+' + pts, '#fff', 18);
            sparkle(x, surf + 24, 10); leaves(x, surf + 40, 4); ring(x, surf + 6);
            sfx.perfect(st.combo); buzz(12);
            st.swayV *= 0.3;
            if (st.combo % 5 === 0 && st.lives < MAX_LIVES) {
                st.lives++; renderLives(); toast('+1 life!'); sfx.life();
            }
            renderCombo();
        } else {
            if (!removed.length) {
                st.combo = 0; renderCombo();
                st.score += 1;
                floatText(x, surf + 52, '+1', '#fff', 20);
                sfx.land(); buzz(8);
                st.swayV += clamp(dx, -40, 40) * 1.8;
            }
        }
        dust(x, surf, 7, 28); kick(perfect ? 2 : 4);
        if (st.score > st.best) { st.best = st.score; }
        renderScore(true);
        for (const [n, name] of MILESTONES) {
            if (st.blocks.length >= n && !st.milestones.has(n)) { st.milestones.add(n); toast(name); sfx.milestone(); }
        }
        spawnNext();
    }

    function spawnNext() {
        st.fall = null;
        if (st.mode === 'playing') st.hang = { variant: nextVariant(), age: 0 };
    }

    function loseLife(label, x, y) {
        st.lives--;
        floatText(x, y, label, '#ff7a95', 26);
        renderLives(true);
        kick(8);
        if (st.lives <= 0) {
            st.mode = 'ending'; st.endTimer = 1.1; st.hang = null;
            sfx.over();
        }
    }

    function finishRun() {
        st.mode = 'over';
        const isBest = st.score > 0 && st.score >= st.best && st.score > (parseInt(store.get('best', '0'), 10) || 0);
        if (isBest) store.set('best', String(st.score));
        st.best = Math.max(st.best, parseInt(store.get('best', '0'), 10) || 0);
        $('finalScore').textContent = st.score;
        $('overBest').textContent = 'Best: ' + st.best;
        $('newBest').hidden = !isBest;
        el.hud.hidden = true;
        show(el.over);
    }

    // ------------------------------------------------------------------ update
    function update(dt) {
        st.t += dt;
        const live = st.mode === 'playing' || st.mode === 'title' || st.mode === 'ending';
        if (!live) return;

        // rope panda
        if (st.hang) {
            st.phase += swingParams().w * dt;
            st.hang.age += dt;
        }
        // falling panda
        if (st.fall) {
            const f = st.fall;
            const prev = f.y;
            f.vy += GRAV * dt; f.y -= f.vy * dt;
            if (!f.missed) {
                f.rot *= Math.exp(-9 * dt);
                if (prev >= surface() && f.y <= surface()) resolveLanding();
            } else {
                f.rot += f.vr * dt;
                if (f.y < st.cam - 260) { st.fall = null; if (st.mode === 'playing') spawnNext(); }
            }
        }
        // tower sway (damped spring) — drawn only; collisions use true positions
        st.swayV += (-70 * st.sway - 4.2 * st.swayV) * dt;
        st.sway += st.swayV * dt;

        // camera follows the top of the tower
        const target = Math.max(0, surface() - (0.34 * H - GM));
        st.camT = target;
        st.cam += (target - st.cam) * (1 - Math.exp(-4 * dt));

        // debris & particles
        for (const d of st.debris) { d.vy -= GRAV * 0.9 * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.rot += d.vr * dt; }
        st.debris = st.debris.filter(d => d.y > st.cam - 300);
        for (const p of st.parts) {
            p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt;
            if (p.type === 'star') p.vy -= 260 * dt;
            if (p.type === 'leaf') { p.vy -= 70 * dt; p.rot += p.vr * dt; p.vx += Math.sin(st.t * 4 + p.rot) * 30 * dt; }
            if (p.type === 'dust') { p.vx *= 0.94; p.vy *= 0.94; }
        }
        st.parts = st.parts.filter(p => p.life < p.max);
        for (const t of st.texts) { t.life += dt; t.y += 36 * dt; }
        st.texts = st.texts.filter(t => t.life < t.max);
        st.shake = Math.max(0, st.shake - 30 * dt);

        if (st.mode === 'ending') {
            st.endTimer -= dt;
            if (st.endTimer <= 0 && !st.fall) finishRun();
            else if (st.endTimer <= -2.5) finishRun();
        }
    }

    // ------------------------------------------------------------------ render
    function withWorld(x, y, fn, scaleX, scaleY, rot) {
        ctx.save();
        ctx.translate(X(x), Y(y));
        if (rot) ctx.rotate(rot);
        ctx.scale(S * (scaleX || 1), S * (scaleY || 1));
        fn();
        ctx.restore();
    }

    function swayOffset(level, topMargin) {
        const h = (level * BH) / 300;
        const idle = topMargin < 0.5 ? (0.5 - topMargin) / 0.5 * 3.2 * Math.sin(st.t * 8.4) : 0;
        return (st.sway + idle) * Math.pow(h, 1.3);
    }

    function render() {
        const sky = drawSky();
        drawStars(); drawSunMoon(); drawAurora();
        ctx.save();
        if (st.shake > 0) ctx.translate((Math.random() - 0.5) * st.shake * dpr, (Math.random() - 0.5) * st.shake * dpr);
        drawBamboo('far', sky);
        drawHills(sky);
        drawClouds(sky);
        drawBamboo('mid', sky);
        drawGround(sky);

        // tower
        const n = st.blocks.length;
        for (let i = 0; i < n; i++) {
            const b = st.blocks[i];
            if (Y(b.y) < -80 * S || Y(b.y) - 80 * S > canvas.height) continue; // off-screen
            const age = st.t - b.born;
            const sq = age < 0.7 ? Math.exp(-age * 8) * Math.cos(age * 26) * 0.2 : 0;
            let expr = 'content';
            if (i === n - 1) expr = (age < 0.9 && age >= 0) ? 'happy' : (st.margin < 0.3 ? 'worried' : 'normal');
            else if (i === n - 2 && st.margin < 0.18) expr = 'worried';
            const off = swayOffset(i + 1, st.margin);
            withWorld(b.x + off, b.y, () => drawPanda(ctx, b.variant, expr, 'down'), 1 + sq * 0.5, 1 - sq, off * 0.004);
        }

        // swinging panda + rope
        if (st.hang) {
            const p = swingPose();
            const sc = st.hang.age < 0.3 ? 1 - Math.pow(1 - st.hang.age / 0.3, 3) * 0.6 : 1;
            ctx.save();
            ctx.translate(X(p.ax), Y(p.ay)); ctx.rotate(-p.th); ctx.scale(S, S);
            ctx.strokeStyle = '#d9b36a'; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
            ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -ROPE * 1.4); ctx.stroke();
            ctx.strokeStyle = '#a07d3e'; ctx.lineWidth = 1; ctx.setLineDash([3, 5]);
            ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -ROPE * 1.4); ctx.stroke(); ctx.setLineDash([]);
            ctx.translate(0, SPRITE_H); ctx.scale(sc, sc);
            drawPanda(ctx, st.hang.variant, 'normal', 'up');
            ctx.restore();
            // faint aiming guide
            if (st.mode === 'playing') {
                ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,.2)'; ctx.lineWidth = 2 * S; ctx.setLineDash([4 * S, 8 * S]);
                ctx.beginPath(); ctx.moveTo(X(p.bx), Y(p.by) + 6 * S); ctx.lineTo(X(p.bx), Y(surface())); ctx.stroke(); ctx.restore();
            }
        }
        if (st.fall) {
            const f = st.fall;
            withWorld(f.x, f.y, () => drawPanda(ctx, f.variant, 'shock', 'up'), 1, 1, f.rot);
        }
        for (const d of st.debris) withWorld(d.x, d.y, () => drawPanda(ctx, d.variant, 'shock', 'up'), 1, 1, d.rot);

        // particles
        for (const p of st.parts) {
            const k = p.life / p.max, a = 1 - k;
            if (p.type === 'dust') {
                ctx.fillStyle = `rgba(255,250,235,${0.5 * a})`;
                ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), p.size * (0.6 + k) * S, 0, TAU); ctx.fill();
            } else if (p.type === 'star') {
                withWorld(p.x, p.y, () => {
                    ctx.globalAlpha = a; ctx.fillStyle = '#ffe08a'; ctx.rotate(p.rot + p.life * 4);
                    ctx.beginPath();
                    for (let i = 0; i < 8; i++) { const r = i % 2 ? p.size * 0.4 : p.size; ctx.lineTo(Math.cos(i * Math.PI / 4) * r, Math.sin(i * Math.PI / 4) * r); }
                    ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
                });
            } else if (p.type === 'leaf') {
                ctx.save(); ctx.translate(X(p.x), Y(p.y)); ctx.rotate(p.rot); ctx.scale(S, S); ctx.globalAlpha = Math.min(1, a * 2);
                ctx.fillStyle = '#58c985'; ctx.beginPath(); ctx.moveTo(-p.size / 2, 0); ctx.quadraticCurveTo(0, -p.size * 0.45, p.size / 2, 0); ctx.quadraticCurveTo(0, p.size * 0.3, -p.size / 2, 0); ctx.fill();
                ctx.restore();
            } else if (p.type === 'ring') {
                ctx.strokeStyle = `rgba(255,224,138,${a})`; ctx.lineWidth = 3 * S * a + 1;
                ctx.beginPath(); ctx.ellipse(X(p.x), Y(p.y), (p.size + k * 70) * S, (p.size + k * 70) * S * 0.28, 0, 0, TAU); ctx.stroke();
            }
        }
        drawForegroundGrass(sky);
        drawBamboo('near', sky);
        drawFireflies();

        // floating text
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
        for (const t of st.texts) {
            const k = t.life / t.max, a = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1, pop = 1 + Math.max(0, 0.35 - k * 1.5);
            ctx.globalAlpha = a;
            ctx.font = `900 ${t.size * S * pop}px ui-rounded, "Trebuchet MS", system-ui, sans-serif`;
            ctx.lineWidth = 5 * S; ctx.strokeStyle = 'rgba(29,26,47,.8)';
            ctx.strokeText(t.text, X(t.x), Y(t.y)); ctx.fillStyle = t.color; ctx.fillText(t.text, X(t.x), Y(t.y));
        }
        ctx.globalAlpha = 1;
        ctx.restore();

        // soft vignette for depth
        const vg = ctx.createRadialGradient(canvas.width / 2, canvas.height / 2, Math.min(canvas.width, canvas.height) * 0.4, canvas.width / 2, canvas.height / 2, Math.max(canvas.width, canvas.height) * 0.78);
        vg.addColorStop(0, 'rgba(10,6,40,0)'); vg.addColorStop(1, 'rgba(10,6,40,.38)');
        ctx.fillStyle = vg; ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    let last = performance.now();
    function frame(now) {
        const dt = Math.min(0.033, (now - last) / 1000);
        last = now;
        if (st.mode !== 'paused' && st.mode !== 'over') update(dt);
        else if (st.mode === 'over') { st.t += dt; st.phase += 0; }
        render();
        requestAnimationFrame(frame);
    }

    // ------------------------------------------------------------------ input
    function onPointer(e) {
        if (e.target.closest && e.target.closest('button')) return;
        if (st.mode === 'playing') { e.preventDefault(); unlockAudio(); drop(); }
    }
    window.addEventListener('pointerdown', onPointer, { passive: false });
    window.addEventListener('keydown', (e) => {
        if (e.repeat) return;
        const k = e.key;
        if (k === ' ' || k === 'Enter' || k === 'ArrowDown' || k === 'ArrowUp') {
            if (st.mode === 'playing') { e.preventDefault(); unlockAudio(); drop(); }
            else if (st.mode === 'title' || st.mode === 'over') { e.preventDefault(); startGame(); }
            else if (st.mode === 'paused') { e.preventDefault(); resume(); }
        } else if (k === 'p' || k === 'P' || k === 'Escape') {
            if (st.mode === 'playing') pause(); else if (st.mode === 'paused') resume();
        } else if (k === 'm' || k === 'M') toggleSound();
    });
    function toggleSound() {
        st.muted = !st.muted; store.set('muted', st.muted ? '1' : '0');
        if (master) master.gain.value = st.muted ? 0 : 0.55;
        renderSound(); if (!st.muted) { unlockAudio(); sfx.ui(); }
    }
    $('btnPlay').addEventListener('click', startGame);
    $('btnAgain').addEventListener('click', startGame);
    $('btnPause').addEventListener('click', pause);
    $('btnResume').addEventListener('click', resume);
    $('btnQuit').addEventListener('click', toTitle);
    el.btnSound.addEventListener('click', toggleSound);
    document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
    window.addEventListener('blur', pause);
    window.addEventListener('resize', layout);
    window.addEventListener('orientationchange', () => setTimeout(layout, 120));
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('touchmove', (e) => { if (!(e.target.closest && e.target.closest('.overlay'))) e.preventDefault(); }, { passive: false });

    // ------------------------------------------------------------------ boot
    layout();
    renderSound();
    titleDecor();
    updateTitleBest();
    // expose a tiny hook for automated tests
    window.__panda = { st, drop, swingPose, surface, startGame };
    requestAnimationFrame((t) => { last = t; frame(t); });
})();
