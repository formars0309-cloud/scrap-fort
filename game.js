// 고물 요새 화면과 입력. 규칙은 sim.js에만 있다.
(function () {
  const Sim = self.ScrapSim;
  const Assets = self.ScrapAssets;
  const { createTelemetry, createSfx } = self.Proto;
  const VERSION = "2026-11-11";
  const W = Sim.W;
  const H = 960;
  const TRAY_Y = Sim.FIELD_H;
  const HAND = { x: 66, y: 870, r: 48 };
  const FURNACE = { x: 178, y: 870, r: 48 };
  const SLOT_COLOR = { barrel: "#d08c4a", war: "#55b5cf", power: "#b48be6" };
  const SLOT_RULE = {
    barrel: "포신은 탄이 나가는 모양을 정한다.",
    war: "탄두는 맞은 적에게 생기는 일을 정한다.",
    power: "동력은 쏘는 속도와 세기를 정한다.",
  };
  const WAR_COLOR = { ice: "#8fdcff", battery: "#c7a6ff", oil: "#ff8a3d", magnet: "#ef5b50" };
  const INK = "#161d2c";
  const FONT = 'Jua, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
  // 버튼은 보이는 크기보다 이만큼 넓게 눌린다. 휴대폰에서 손가락으로 누르기 쉽게 한다.
  const TOUCH_PAD = 4;

  const {
    SLOTS,
    TOWER_SCALE,
    TOWER_CANVAS,
    TOWER_CENTER,
    TOWER_DROP,
    TOWER_LABEL_Y,
    BARREL,
    BARE_MUZZLE,
    MAX_AIM,
    SOCKET,
    PATCH_AT,
    ENEMY_SIZE,
    ENEMY_STEP,
    PROPS,
  } = Assets;

  const IMG = {};
  let imgPending = 0;
  for (const name of Assets.imageNames(Sim.SCRAPS)) {
    const image = new Image();
    imgPending += 1;
    image.onload = image.onerror = () => (imgPending -= 1);
    image.src = "img/" + name + ".webp";
    IMG[name] = image;
  }

  const canvas = document.getElementById("c");
  const ctx = canvas.getContext("2d");
  const telemetry = createTelemetry("scrap-fort", VERSION);
  const sfx = createSfx(Assets.SOUNDS);

  // 녹음 효과음이 아직 없으면 예전 beep으로 대신한다.
  function sound(name, options, fallback) {
    if (!sfx.play(name, options) && fallback) sfx.beep(...fallback);
  }

  function shotSound(t, burst) {
    const barrel = t.parts.barrel && t.parts.barrel.id;
    const war = t.parts.war && t.parts.war.id;
    if (barrel === "rebar") sound("pierce", { volume: 0.4, gap: 0.12 });
    else sound("shoot", { volume: burst ? 0.5 : 0.3, gap: 0.07, rate: barrel === "pipe" ? 0.8 : barrel === "funnel" ? 1.2 : 1 });
    if (war === "ice") sound("ice", { volume: 0.22, gap: 0.5 });
    if (war === "oil") sound("fire", { volume: 0.22, gap: 0.9 });
  }

  let S = null;
  let snaps = [];
  let mode = "title";
  let speed = 1;
  let paused = false;
  let runIndex = 0;
  let accumulator = 0;
  let lastTime = 0;
  let held = null;
  let selected = null;
  let pointer = { x: 0, y: 0 };
  let buttons = [];
  let fx = [];
  let shake = 0;
  let attachedOnce = false;
  let search = null;
  let missed = null;
  let replay = null;
  let replayEndTick = 0;
  let finalState = null;
  let codex = null;
  let frameDt = 0;
  let pathPattern = null;
  let towerFx = [];
  const enemyFx = new Map();
  const bulletOrigin = new WeakMap();
  let inspected = null;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const scale = Math.min(window.innerWidth / W, window.innerHeight / H);
    canvas.style.width = W * scale + "px";
    canvas.style.height = H * scale + "px";
    canvas.width = Math.round(W * scale * dpr);
    canvas.height = Math.round(H * scale * dpr);
  }
  window.addEventListener("resize", resize);
  resize();

  function newSeed() {
    return (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) | 0;
  }

  function startRun(target) {
    runIndex += 1;
    exportNote = "";
    sfx.music("battle");
    towerFx = Sim.TOWER_SPOTS.map(() => ({ recoil: 0, flash: 0, pop: 0, flip: false, aim: -0.3 }));
    enemyFx.clear();
    inspected = null;
    S = Sim.create(newSeed(), target || []);
    snaps = [];
    fx = [];
    mode = "play";
    paused = false;
    held = null;
    selected = null;
    missed = null;
    replay = null;
    finalState = null;
    telemetry.log("run_start", { run: runIndex, seed: S.seed, target: S.target });
  }

  // 화면 효과

  function floatText(x, y, text, color, size) {
    fx.push({ kind: "text", x, y, text, color: color || "#fff", size: size || 18, t: 1.1, life: 1.1 });
  }

  function burstFx(x, y, color, count) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 40 + Math.random() * 140;
      fx.push({ kind: "spark", x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, color, t: 0.45, life: 0.45 });
    }
  }

  function consumeEvents(state, quiet) {
    let shooter = 0;
    for (const e of state.events) {
      if (e.type === "kill") {
        burstFx(e.x, e.y, e.enemy === "brute" ? "#ffd166" : "#e9dcc0", e.enemy === "brute" ? 26 : 6);
        if (e.enemy === "brute") fx.push({ kind: "blast", x: e.x, y: e.y, r: 70, t: 0.4, life: 0.4 });
        else fx.push({ kind: "sprite", name: "fx/smoke", x: e.x, y: e.y - 4, size: 26, t: 0.3, life: 0.3 });
        if (e.enemy === "brute") shake = 10;
        if (!quiet) {
          if (e.enemy === "brute") sound("blast", { volume: 0.8 });
          else sound("die", { volume: 0.3, gap: 0.08, rate: 0.9 + Math.random() * 0.3 }, [180, 0.06, "square", 0.025]);
        }
      } else if (e.type === "drop") {
        burstFx(e.x, e.y, SLOT_COLOR[Sim.SCRAPS[e.scrap].slot], 6);
        fx.push({ kind: "sprite", name: "fx/scrap-pop", x: e.x, y: e.y, size: 54, t: 0.4, life: 0.4 });
        if (!quiet) sound("drop", { volume: 0.5, gap: 0.1 }, [620, 0.08, "triangle", 0.05, 820]);
      } else if (e.type === "beam") {
        const [ax, ay] = muzzlePoint(state.towers[shooter], towerFx[shooter]);
        fx.push({ kind: "beam", ax, ay, bx: e.bx, by: e.by, burst: e.burst, t: 0.13, life: 0.13 });
      } else if (e.type === "arc") {
        fx.push({ kind: "arc", ax: e.ax, ay: e.ay, bx: e.bx, by: e.by, t: 0.14, life: 0.14 });
        fx.push({ kind: "sprite", name: "fx/spark", x: e.bx, y: e.by, size: 30, t: 0.18, life: 0.18 });
        if (!quiet) sound("zap", { volume: 0.25, gap: 0.18 });
      } else if (e.type === "blast") {
        fx.push({ kind: "blast", x: e.x, y: e.y, r: e.r, t: 0.32, life: 0.32 });
        if (!quiet) sound("blast", { volume: e.r > 60 ? 0.5 : 0.3, gap: 0.2, rate: e.r > 60 ? 0.9 : 1.25 });
      } else if (e.type === "shot") {
        const tf = towerFx[e.tower];
        shooter = e.tower;
        tf.recoil = 1;
        tf.flash = 1;
        aimTower(tf, state.towers[e.tower].angle);
        if (!quiet) shotSound(state.towers[e.tower], e.burst);
      } else if (e.type === "leak") {
        shake = Math.max(shake, 7);
        if (!quiet) sound("forthit", { volume: 0.7, gap: 0.25 }, [90, 0.18, "sawtooth", 0.07, 50]);
      } else if (e.type === "wave" && !quiet) {
        floatText(W / 2, 120, e.wave + " 웨이브", "#ffd166", 32);
        sound("wave", { volume: 0.55 }, [330, 0.14, "triangle", 0.06, 490]);
        if (state.queue.some((item) => item.type === "brute" && item.wave === e.wave)) sound("brute", { volume: 0.7 });
        telemetry.log("wave", { run: runIndex, wave: e.wave, fort: state.fort, sec: Math.round(state.tick / 30) });
      } else if (e.type === "attach" && !quiet) {
        const t = state.towers[e.tower];
        towerFx[e.tower].pop = 1;
        burstFx(t.x, t.y, "#ffd166", 16);
        sound("attach", { volume: 0.7 }, [420, 0.1, "square", 0.06, 840]);
        if (e.names && e.names.length) {
          floatText(t.x, t.y - 62, e.names.join(" · ") + " 완성!", "#ffd166", 26);
          shake = Math.max(shake, 8);
          sound("synergy", { volume: 0.8 }, [660, 0.25, "triangle", 0.08, 1320]);
        } else if (e.lv > 1) {
          floatText(t.x, t.y - 56, "덧대기 " + e.lv + "단", "#ffe9b0", 20);
        }
      } else if (e.type === "melt" && !quiet) {
        floatText(FURNACE.x, FURNACE.y - 62, "이번 판에서 제외", "#ff9a4d", 18);
        sound("melt", { volume: 0.6 }, [240, 0.25, "sawtooth", 0.05, 80]);
      }
    }
    state.events.length = 0;
  }

  // 판 진행

  function onRunEnd() {
    finalState = S;
    telemetry.log("run_end", {
      run: runIndex,
      result: S.over,
      wave: S.wave,
      sec: Math.round(S.tick / 30),
      fort: S.fort,
      kills: S.kills,
      builds: Sim.buildSummary(S),
      seen: Object.keys(S.seen),
      melted: S.melted,
      target: S.target,
    });
    held = null;
    selected = null;
    if (S.over === "win") {
      mode = "end";
      sound("win", { volume: 0.8 }, [520, 0.5, "triangle", 0.08, 1040]);
      sfx.music("workshop");
      return;
    }
    sound("lose", { volume: 0.8 }, [160, 0.5, "sawtooth", 0.08, 45]);
    sfx.music("workshop");
    let snap = null;
    for (let i = snaps.length - 1; i >= 0; i--) {
      if (S.tick - snaps[i].tick >= 180) {
        snap = snaps[i];
        break;
      }
    }
    snap = snap || snaps[0] || null;
    if (!snap) {
      mode = "end";
      return;
    }
    const lossTick = S.tick;
    const snapState = JSON.parse(snap.json);
    search = {
      snapState,
      gen: Sim.searchMissed(snapState, S.seen, lossTick - snapState.tick),
      done: 0,
      total: 0,
    };
    mode = "search";
  }

  function runSearchSlice() {
    const limit = performance.now() + 10;
    while (performance.now() < limit) {
      const r = search.gen.next();
      if (r.done) {
        missed = r.value;
        finishSearch();
        return;
      }
      search.total = r.value;
      search.done += 1;
    }
  }

  function finishSearch() {
    if (!missed) {
      telemetry.log("replay", { run: runIndex, found: false });
      mode = "end";
      search = null;
      return;
    }
    replay = Sim.clone(search.snapState);
    Sim.applyPair(replay, missed.tower, missed.a, missed.b);
    replayEndTick = replay.tick + missed.horizon;
    telemetry.log("replay", {
      run: runIndex,
      found: true,
      a: missed.a,
      b: missed.b,
      synergy: missed.synergy,
      survived: missed.survived,
      gainSec: missed.gainSec,
    });
    search = null;
    fx = [];
    mode = "replay";
  }

  function leaveReplay(skipped) {
    if (skipped) telemetry.log("replay_skip", { run: runIndex });
    mode = "end";
  }

  function chooseTarget() {
    telemetry.log("choice", { run: runIndex, choice: "target", a: missed.a, b: missed.b });
    startRun([missed.a, missed.b]);
  }

  function choosePlain() {
    telemetry.log("choice", { run: runIndex, choice: "plain" });
    startRun([]);
  }

  // 입력

  function logical(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) * W) / rect.width,
      y: ((event.clientY - rect.top) * H) / rect.height,
    };
  }

  function towerAt(p) {
    return S.towers.findIndex((t) => t.active && Math.hypot(t.x - p.x, t.y + TOWER_DROP - p.y) < 72);
  }

  function inZone(zone, p) {
    return Math.hypot(zone.x - p.x, zone.y - p.y) <= zone.r + 12;
  }

  function fieldAt(p) {
    let best = null;
    let nearest = Sim.PICK_R;
    for (const item of S.field) {
      const d = Math.hypot(item.x - p.x, item.y - p.y);
      if (d < nearest) {
        nearest = d;
        best = item;
      }
    }
    return best;
  }

  function currentScrap(ref) {
    if (!ref) return null;
    if (ref.from === "hand") return S.hand;
    const item = S.field.find((f) => f.id === ref.id);
    return item ? item.scrap : null;
  }

  function logAction(type, scrap, extra) {
    telemetry.log(type, Object.assign({ run: runIndex, scrap, wave: S.wave }, extra));
  }

  function applyTo(ref, p) {
    const scrap = currentScrap(ref);
    if (!scrap) return false;
    const tower = towerAt(p);
    if (tower >= 0) {
      const ok = Sim.act(
        S,
        ref.from === "hand" ? { type: "attachHand", tower } : { type: "attach", id: ref.id, tower },
      );
      if (ok) {
        attachedOnce = true;
        logAction("attach", scrap, { tower });
      }
      return ok;
    }
    if (inZone(FURNACE, p)) {
      const ok = Sim.act(S, ref.from === "hand" ? { type: "meltHand" } : { type: "melt", id: ref.id });
      if (ok) logAction("melt", scrap);
      else if (!Sim.canMelt(S, scrap)) floatText(FURNACE.x, FURNACE.y - 62, "마지막 종류는 못 녹임", "#ffb3a0", 16);
      return ok;
    }
    if (inZone(HAND, p) && ref.from !== "hand") {
      const ok = Sim.act(S, { type: "hold", id: ref.id });
      if (ok) {
        sound("pick", { volume: 0.6 }, [520, 0.07, "triangle", 0.05]);
        logAction("hold", scrap);
      }
      return ok;
    }
    return false;
  }

  canvas.addEventListener("pointerdown", (event) => {
    sfx.unlock();
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    const p = logical(event);
    pointer = p;
    for (const b of buttons) {
      if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) {
        sound("tap", { volume: 0.5 });
        b.fn();
        return;
      }
    }
    if (codex || mode !== "play") return;
    inspected = null;
    if (selected && applyTo(selected, p)) {
      selected = null;
      return;
    }
    const item = fieldAt(p);
    if (item) {
      held = { from: "field", id: item.id, startX: p.x, startY: p.y, moved: false };
      selected = null;
      return;
    }
    if (S.hand && inZone(HAND, p)) {
      held = { from: "hand", startX: p.x, startY: p.y, moved: false };
      selected = null;
      return;
    }
    selected = null;
    const tapped = towerAt(p);
    if (tapped >= 0) inspected = tapped;
  });

  canvas.addEventListener("pointermove", (event) => {
    pointer = logical(event);
    if (held && Math.hypot(pointer.x - held.startX, pointer.y - held.startY) > 8) held.moved = true;
  });

  canvas.addEventListener("pointerup", (event) => {
    pointer = logical(event);
    if (!held || mode !== "play") {
      held = null;
      return;
    }
    if (held.moved) applyTo(held, pointer);
    else selected = held;
    held = null;
  });

  canvas.addEventListener("pointercancel", () => {
    held = null;
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && codex) {
      codex = null;
      return;
    }
    if (event.key === " ") {
      event.preventDefault();
      if (codex) codex = null;
      else paused = !paused;
    }
  });

  // 그리기

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  }

  function spr(name, x, y, w, h) {
    const image = IMG[name];
    if (!image || !image.naturalWidth) return;
    ctx.drawImage(image, x, y, w, h === undefined ? (w * image.naturalHeight) / image.naturalWidth : h);
  }

  function sprCenter(name, x, y, size) {
    spr(name, x - size / 2, y - size / 2, size, size);
  }

  // 고물 한 칸: 부류 판(주황 육각·하늘 네모·보라 원) 위에 물건을 얹는다. size는 반지름이다.
  function drawScrap(id, x, y, size) {
    const def = Sim.SCRAPS[id];
    sprCenter("plates/" + def.slot, x, y, size * 2.25);
    ctx.fillStyle = "rgba(18,24,38,.42)";
    ctx.beginPath();
    ctx.arc(x, y, size * 0.74, 0, Math.PI * 2);
    ctx.fill();
    sprCenter("scraps/" + id, x, y, size * 1.6);
  }

  function drawStar(x, y) {
    sprCenter("ui/star", x, y, 24);
  }

  function towerLayer(name, dx) {
    const s = TOWER_SCALE;
    spr(name, -TOWER_CENTER[0] * s + (dx || 0), -TOWER_CENTER[1] * s, TOWER_CANVAS * s, TOWER_CANVAS * s);
  }

  // 탑 그림(768 캔버스) 좌표를 탑 중심 기준 화면 거리로 바꾼다.
  function towerLocal(point) {
    return [(point[0] - TOWER_CENTER[0]) * TOWER_SCALE, (point[1] - TOWER_CENTER[1]) * TOWER_SCALE];
  }

  // 쏘는 순간의 표적 방향으로 조준을 맞춘다. 표적이 반대편으로 충분히 넘어가야 탑을 뒤집어 떨림을 막는다.
  function aimTower(tf, angle) {
    const cos = Math.cos(angle);
    if (!tf.flip && cos < -0.2) tf.flip = true;
    else if (tf.flip && cos > 0.2) tf.flip = false;
    const aim = Math.atan2(Math.sin(angle), tf.flip ? -cos : cos);
    tf.aim = Math.max(-MAX_AIM, Math.min(MAX_AIM, aim));
  }

  // 지금 조준에서 포구가 화면 어디에 있는지. 탄과 광선이 여기서 나온다.
  function muzzlePoint(t, tf) {
    const spec = t.parts.barrel ? BARREL[t.parts.barrel.id] : null;
    let point = BARE_MUZZLE;
    if (spec) {
      const a = tf.aim * spec.turn;
      const dx = spec.muzzle[0] - spec.pivot[0];
      const dy = spec.muzzle[1] - spec.pivot[1];
      point = [spec.pivot[0] + dx * Math.cos(a) - dy * Math.sin(a), spec.pivot[1] + dx * Math.sin(a) + dy * Math.cos(a)];
    }
    const [lx, ly] = towerLocal(point);
    return [t.x + (tf.flip ? -lx : lx), t.y + TOWER_DROP + ly];
  }

  function drawMuzzleFlash(x, y, strength) {
    const f = 0.24;
    ctx.globalAlpha = Math.min(1, strength * 1.6);
    spr("tower/muzzle", x - 20 * f, y - 128 * f, 256 * f, 256 * f);
    ctx.globalAlpha = 1;
  }

  // 포신: 받침쇠는 그대로 두고 통만 축을 중심으로 돌린다. 반동은 통의 축 방향으로 준다.
  function drawBarrel(id, tf) {
    const spec = BARREL[id];
    const [px, py] = towerLocal(spec.pivot);
    if (!spec.mountOnTop) towerLayer("tower/mount-" + id);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(tf.aim * spec.turn);
    ctx.translate(-px - tf.recoil * 5, -py);
    towerLayer("tower/tube-" + id);
    if (tf.flash > 0) drawMuzzleFlash(...towerLocal(spec.muzzle), tf.flash);
    ctx.restore();
    if (spec.mountOnTop) towerLayer("tower/mount-" + id);
  }

  // 탑은 회전하지 않는다. 받침 위에 동력 → 탄두 → 포신 순으로 겹치고, 표적이 왼쪽이면 통째로 뒤집는다.
  // 탑 몸통은 고정이고 포신만 표적을 따라 돈다. 표적이 왼쪽이면 탑을 통째로 뒤집는다.
  // 받침 위 세 자리(너트)가 곧 세 칸이다. 빈 칸은 부류 판을 흐리게 띄워 무엇이 들어가는지 보여 준다.
  function drawTower(t, index) {
    const tf = towerFx[index] || { recoil: 0, flash: 0, pop: 0, flip: false, aim: 0 };
    tf.recoil = Math.max(0, tf.recoil - frameDt * 7);
    tf.flash = Math.max(0, tf.flash - frameDt * 11);
    tf.pop = Math.max(0, tf.pop - frameDt * 3.5);
    const cy = t.y + TOWER_DROP;
    if (!t.active) {
      ctx.save();
      ctx.translate(t.x, cy);
      ctx.globalAlpha = 0.32;
      towerLayer("tower/base");
      ctx.restore();
      outlinedText(t.unlock + "웨이브에 열림", t.x, t.y + 6, 15, "#e9dcc0");
      return;
    }
    const stats = Sim.towerStats(t);
    const scrapRef = mode === "play" ? held || selected : null;
    const hoverScrap = scrapRef ? currentScrap(scrapRef) : null;
    const hoverSlot = hoverScrap ? Sim.SCRAPS[hoverScrap].slot : null;
    const pulse = Math.sin(performance.now() / 130);
    if (stats.names.length) {
      ctx.fillStyle = "rgba(255,209,102,.3)";
      ctx.beginPath();
      ctx.ellipse(t.x, cy + 6, 74, 50, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    if (hoverScrap || index === inspected) {
      ctx.strokeStyle = hoverScrap ? "rgba(255,209,102,.9)" : "rgba(255,255,255,.85)";
      ctx.lineWidth = 3;
      ctx.setLineDash([9, 7]);
      ctx.beginPath();
      ctx.ellipse(t.x, cy - 6, 76 + (hoverScrap ? pulse * 3 : 0), 64, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const pop = 1 + Math.sin(tf.pop * Math.PI) * 0.16;
    ctx.save();
    ctx.translate(t.x, cy);
    ctx.scale((tf.flip ? -1 : 1) * pop, pop);
    towerLayer("tower/base");
    for (const slot of SLOTS) {
      if (t.parts[slot]) continue;
      const [sx, sy] = towerLocal(SOCKET[slot]);
      const wanted = slot === hoverSlot;
      if (wanted) {
        ctx.fillStyle = "#ffd166";
        ctx.beginPath();
        ctx.arc(sx, sy, 19 + pulse * 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = wanted ? 1 : 0.62;
      sprCenter("plates/" + slot, sx, sy, wanted ? 34 + pulse * 2 : 30);
      ctx.globalAlpha = 1;
    }
    if (t.parts.power) towerLayer("tower/power-" + t.parts.power.id);
    if (t.parts.war) towerLayer("tower/war-" + t.parts.war.id);
    if (t.parts.barrel) drawBarrel(t.parts.barrel.id, tf);
    else if (tf.flash > 0) drawMuzzleFlash(...towerLocal(BARE_MUZZLE), tf.flash);
    for (const slot of SLOTS) {
      const part = t.parts[slot];
      if (!part) continue;
      for (let k = 0; k < part.lv - 1; k++) {
        const [px, py] = towerLocal([PATCH_AT[slot][0] + k * 44, PATCH_AT[slot][1] + k * 26]);
        spr("tower/patch", px - 9, py - 9, 19, 19);
      }
      if (slot === hoverSlot) {
        const [sx, sy] = towerLocal(SOCKET[slot]);
        ctx.strokeStyle = "#ffd166";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(sx, sy - 12, 25 + pulse * 2, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();

    // 글자는 뒤집힌 좌표 밖에서 쓴다.
    for (const slot of SLOTS) {
      const part = t.parts[slot];
      if (!part || part.lv < 2) continue;
      const [sx, sy] = towerLocal(SOCKET[slot]);
      outlinedText("×" + part.lv, t.x + (tf.flip ? -sx : sx) + 14, cy + sy + 12, 14, "#fff");
    }
    if (stats.names.length && !hoverScrap) outlinedText(stats.names.join(" · "), t.x, t.y + TOWER_LABEL_Y, 17, "#ffd166");
  }

  // 고물을 이 탑에 붙이면 어떻게 되는지: 장착·덧대기·교체와 생기거나 풀리는 궁합.
  function attachPreview(t, scrap) {
    const slot = Sim.SCRAPS[scrap].slot;
    const current = t.parts[slot];
    if (current && current.id === scrap) {
      if (current.lv >= Sim.MAX_LV) return { text: "이미 최대 " + Sim.MAX_LV + "단", color: "#ffb3a0", gained: [], lost: [] };
      return { text: "덧대기 " + current.lv + "→" + (current.lv + 1) + "단, 공격력 상승", color: "#efe6d6", gained: [], lost: [] };
    }
    const before = Sim.towerStats(t).names;
    const parts = Object.assign({}, t.parts, { [slot]: { id: scrap, lv: 1 } });
    const after = Sim.towerStats({ parts }).names;
    const gained = after.filter((n) => !before.includes(n));
    const lost = before.filter((n) => !after.includes(n));
    if (gained.length) return { text: "궁합 완성: " + gained.join(" · "), color: "#ffd166", gained, lost };
    const text = current
      ? Sim.SCRAPS[current.id].name + " 빼고 교체"
      : "빈 " + Sim.SLOT_NAMES[slot] + " 칸에 장착";
    return { text, color: current ? "#ffcf9a" : "#efe6d6", gained, lost };
  }

  function completesSynergy(state, scrap) {
    return state.towers.some((t) => t.active && attachPreview(t, scrap).gained.length > 0);
  }

  function outlinedText(text, x, y, size, color) {
    ctx.font = size + "px " + FONT;
    ctx.textAlign = "center";
    ctx.lineJoin = "round";
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(4, size * 0.3);
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  // 고물을 든 동안 열린 탑마다 붙였을 때의 결과를 띄운다.
  function drawPreviews(state) {
    if (mode !== "play") return;
    const ref = held || selected;
    const scrap = ref ? currentScrap(ref) : null;
    if (!scrap) return;
    for (const t of state.towers) {
      if (!t.active) continue;
      const pv = attachPreview(t, scrap);
      outlinedText(pv.text, t.x, t.y + TOWER_LABEL_Y, pv.gained.length ? 20 : 16, pv.color);
      if (pv.lost.length) outlinedText(pv.lost.join(" · ") + " 풀림", t.x, t.y + TOWER_LABEL_Y + 19, 15, "#ff8a7a");
    }
  }

  // 그림은 두 장뿐이라 걸음마다 몸을 튀기고 좌우로 기울여 움직임을 잇는다. 맞으면 잠깐 움찔한다.
  function drawEnemy(e, tick) {
    const def = Sim.ENEMIES[e.type];
    const size = ENEMY_SIZE[e.type];
    let look = enemyFx.get(e.id);
    if (!look) {
      look = { hp: e.hp, punch: 0, left: false };
      enemyFx.set(e.id, look);
    }
    if (e.hp < look.hp) look.punch = 1;
    look.hp = e.hp;
    look.punch = Math.max(0, look.punch - frameDt * 8);
    const ahead = Sim.posAt(e.d + 3)[0] - e.x;
    if (Math.abs(ahead) > 0.5) look.left = ahead < 0;
    const left = look.left;

    let pose;
    let lift;
    let tilt;
    let stretch = 0;
    if (e.type === "wasp") {
      pose = Math.floor(tick / 2) % 2;
      lift = -10 + Math.sin(tick / 7 + e.id) * 3;
      tilt = Math.sin(tick / 9 + e.id) * 0.08;
    } else {
      const [stride, hop] = ENEMY_STEP[e.type];
      const phase = e.d / stride;
      const swing = Math.sin(phase * Math.PI);
      pose = Math.floor(phase) % 2;
      lift = -Math.abs(swing) * hop;
      tilt = swing * 0.06;
      stretch = Math.abs(swing) * 0.05;
    }
    const foot = e.y + def.r * 0.75;
    ctx.fillStyle = "rgba(10,16,24,.28)";
    ctx.beginPath();
    ctx.ellipse(e.x, foot, size * (0.3 + lift * 0.004), size * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.translate(e.x, foot + lift);
    ctx.rotate(left ? -tilt : tilt);
    ctx.scale((left ? -1 : 1) * (1 - stretch + look.punch * 0.14), 1 + stretch - look.punch * 0.12);
    spr("enemies/" + e.type + "-" + (pose + 1), -size / 2, -size * 0.875, size, size);
    ctx.restore();
    const top = foot + lift - size * 0.72;
    if (e.slowT > 0) sprCenter("fx/frost", e.x, foot + lift - 4, size * 0.7);
    if (e.hp < e.maxHp) {
      const width = Math.max(24, size * 0.7);
      ctx.fillStyle = INK;
      roundRect(e.x - width / 2 - 2, top - 8, width + 4, 8, 4);
      ctx.fill();
      ctx.fillStyle = "#7ddf64";
      roundRect(e.x - width / 2, top - 6, (width * Math.max(0, e.hp)) / e.maxHp, 4, 2);
      ctx.fill();
    }
  }

  // 사라진 적의 화면 상태를 지운다.
  function forgetGoneEnemies(state) {
    if (enemyFx.size <= state.enemies.length + 40) return;
    const alive = new Set(state.enemies.map((e) => e.id));
    for (const id of enemyFx.keys()) if (!alive.has(id)) enemyFx.delete(id);
  }

  function tracePath() {
    ctx.beginPath();
    Sim.PATH.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  }

  function drawField(state) {
    ctx.fillStyle = "#5d7350";
    ctx.fillRect(0, 0, W, Sim.FIELD_H);
    spr("map/ground", 0, 0, W, Sim.FIELD_H);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = INK;
    ctx.lineWidth = 64;
    tracePath();
    ctx.stroke();
    if (!pathPattern && IMG["map/path-tile"].naturalWidth) {
      pathPattern = ctx.createPattern(IMG["map/path-tile"], "repeat");
      if (pathPattern.setTransform) pathPattern.setTransform(new DOMMatrix().scale(0.5));
    }
    ctx.strokeStyle = pathPattern || "#e6d5ae";
    ctx.lineWidth = 56;
    tracePath();
    ctx.stroke();
    for (const [name, x, y, size] of PROPS) sprCenter(name, x, y, size);
    sprCenter("map/gate", 270, 34, 118);

    for (const p of state.puddles) {
      const a = Math.min(1, p.t);
      ctx.fillStyle = "rgba(255,120,40," + 0.24 * a + ")";
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, p.r, p.r * 0.72, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = a;
      const flame = p.r * 1.5;
      spr("fx/fire-" + ((Math.floor(state.tick / 5) % 2) + 1), p.x - flame / 2, p.y - flame * 0.78, flame, flame);
      ctx.globalAlpha = 1;
    }

    // 위에 있는 것부터 그려 아래 것이 앞에 오게 한다.
    spr("map/fort", 270 - 76, 652, 152, 152);
    state.towers.forEach((t, i) => drawTower(t, i));
    for (const e of [...state.enemies].sort((a, b) => a.y - b.y)) drawEnemy(e, state.tick);
    forgetGoneEnemies(state);

    const hpShare = Math.max(0, state.fort) / Sim.FORT_HP;
    ctx.fillStyle = INK;
    roundRect(206, 772, 128, 24, 12);
    ctx.fill();
    ctx.fillStyle = "#3a4558";
    roundRect(236, 779, 90, 10, 5);
    ctx.fill();
    ctx.fillStyle = hpShare > 0.35 ? "#7ddf64" : "#ef5b50";
    roundRect(236, 779, 90 * hpShare, 10, 5);
    ctx.fill();
    sprCenter("ui/heart", 222, 784, 22);
    outlinedText(String(Math.max(0, state.fort)), 281, 789, 13, "#fff");

    for (const b of state.bullets) {
      const tower = state.towers[b.tower];
      const war = tower.parts.war;
      const color = b.burst ? "#ffd166" : war ? WAR_COLOR[war.id] : "#fff4d6";
      // 규칙상 탄은 탑 중심에서 출발한다. 화면에서는 포구에서 나와 실제 궤도로 합쳐지게 그린다.
      let origin = bulletOrigin.get(b);
      if (!origin) {
        origin = muzzlePoint(tower, towerFx[b.tower]);
        bulletOrigin.set(b, origin);
      }
      const ox = origin[0] - tower.x;
      const oy = origin[1] - tower.y;
      let x = b.x;
      let y = b.y;
      let r = b.burst ? 8 : 5;
      if (b.kind === "lob") {
        const f = Math.min(1, b.t / b.dur);
        ctx.fillStyle = "rgba(10,16,24,.3)";
        ctx.beginPath();
        ctx.ellipse(b.x, b.y, 7, 3.5, 0, 0, Math.PI * 2);
        ctx.fill();
        x += ox * (1 - f);
        y += oy * (1 - f) - Math.sin(f * Math.PI) * 64;
        r = b.burst ? 10 : 7;
      } else if (!b.hits.length) {
        const pace = Math.hypot(b.vx, b.vy) || 1;
        const ux = b.vx / pace;
        const uy = b.vy / pace;
        const along = ox * ux + oy * uy;
        const travel = (b.x - tower.x) * ux + (b.y - tower.y) * uy;
        if (travel < along) continue;
        const side = Math.max(0, 1 - (travel - along) / 60);
        x += (ox - along * ux) * side;
        y += (oy - along * uy) * side;
      }
      ctx.fillStyle = color;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    for (const item of state.field) {
      const blink = item.ttl < 3 && Math.floor(item.ttl * 6) % 2 === 0;
      if (blink) continue;
      if (held && held.from === "field" && held.id === item.id) continue;
      const bob = Math.sin((state.tick + item.id * 7) / 7) * 2.5;
      const y = item.y + bob;
      ctx.fillStyle = "rgba(10,16,24,.3)";
      ctx.beginPath();
      ctx.ellipse(item.x, item.y + 26, 20, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      const chosen = selected && selected.from === "field" && selected.id === item.id;
      if (state.target.includes(item.scrap) || chosen) {
        ctx.strokeStyle = chosen ? "#fff" : "#ffd166";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(item.x, y, 31, 0, Math.PI * 2);
        ctx.stroke();
      }
      drawScrap(item.scrap, item.x, y, 22);
      outlinedText(Sim.SCRAPS[item.scrap].name, item.x, y + 40, 13, "#fff");
      if (completesSynergy(state, item.scrap)) drawStar(item.x + 21, y - 21);
    }
  }

  function drawFx(dt) {
    for (const f of fx) {
      f.t -= dt;
      const a = Math.max(0, f.t / f.life);
      if (f.kind === "spark") {
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        ctx.globalAlpha = a;
        ctx.fillStyle = f.color;
        ctx.beginPath();
        ctx.arc(f.x, f.y, 3, 0, Math.PI * 2);
        ctx.fill();
      } else if (f.kind === "text") {
        f.y -= 34 * dt;
        ctx.globalAlpha = Math.min(1, a * 1.8);
        outlinedText(f.text, f.x, f.y, f.size, f.color);
      } else if (f.kind === "beam") {
        ctx.globalAlpha = a;
        ctx.lineCap = "round";
        ctx.strokeStyle = INK;
        ctx.lineWidth = f.burst ? 13 : 9;
        ctx.beginPath();
        ctx.moveTo(f.ax, f.ay);
        ctx.lineTo(f.bx, f.by);
        ctx.stroke();
        ctx.strokeStyle = f.burst ? "#ffd166" : "#ffb070";
        ctx.lineWidth = f.burst ? 8 : 4;
        ctx.stroke();
      } else if (f.kind === "arc") {
        ctx.globalAlpha = a;
        ctx.strokeStyle = "#9fe4ff";
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(f.ax, f.ay);
        const mx = (f.ax + f.bx) / 2 + (Math.random() - 0.5) * 22;
        const my = (f.ay + f.by) / 2 + (Math.random() - 0.5) * 22;
        ctx.lineTo(mx, my);
        ctx.lineTo(f.bx, f.by);
        ctx.stroke();
      } else if (f.kind === "blast") {
        const index = Math.min(3, Math.floor((1 - a) * 4));
        ctx.globalAlpha = index === 3 ? a * 4 : 1;
        sprCenter("fx/blast-" + (index + 1), f.x, f.y, f.r * 2.5);
      } else if (f.kind === "sprite") {
        ctx.globalAlpha = Math.min(1, a * 2);
        sprCenter(f.name, f.x, f.y, f.size * (1.25 - a * 0.4));
      }
    }
    ctx.globalAlpha = 1;
    fx = fx.filter((f) => f.t > 0);
  }

  // 기록 내보내기 결과를 끝 화면 아래 줄에 알린다.
  let exportNote = "";
  const EXPORT_NOTES = {
    saved: "기록 파일을 저장했습니다",
    declined: "저장을 취소했습니다",
    unavailable: "이 화면에서는 기록을 저장할 수 없습니다",
  };
  function exportRecord() {
    exportNote = "저장 확인창을 확인해 주세요";
    telemetry.exportFile().then((result) => {
      exportNote = EXPORT_NOTES[result] || EXPORT_NOTES.unavailable;
    });
  }

  function pushButton(x, y, w, h, fn) {
    buttons.push({ x: x - TOUCH_PAD, y: y - TOUCH_PAD, w: w + TOUCH_PAD * 2, h: h + TOUCH_PAD * 2, fn });
  }

  function addButton(x, y, w, h, label, fn, style) {
    pushButton(x, y, w, h, fn);
    const opts = Object.assign({ fill: "#3d566e", color: "#fff", size: 18 }, style);
    ctx.fillStyle = INK;
    roundRect(x - 2, y - 2, w + 4, h + 7, 13);
    ctx.fill();
    ctx.fillStyle = opts.fill;
    roundRect(x, y, w, h, 11);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,.16)";
    roundRect(x + 4, y + 3, w - 8, h * 0.36, 8);
    ctx.fill();
    ctx.fillStyle = opts.color;
    ctx.font = opts.size + "px " + FONT;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, x + w / 2, y + h / 2 + 1);
    ctx.textBaseline = "alphabetic";
  }

  function addIconButton(x, y, size, name, fn) {
    pushButton(x, y, size, size, fn);
    spr(name, x, y, size, size);
  }

  function wrapText(text, x, y, maxWidth, lineHeight) {
    let line = "";
    for (const ch of text) {
      if (ctx.measureText(line + ch).width > maxWidth) {
        ctx.fillText(line, x, y);
        y += lineHeight;
        line = ch;
      } else line += ch;
    }
    if (line) ctx.fillText(line, x, y);
    return y;
  }

  function zoneBox(zone, sprite, label, active) {
    if (active) {
      ctx.fillStyle = "#ffd166";
      roundRect(zone.x - 54, zone.y - 54, 108, 108, 18);
      ctx.fill();
    }
    sprCenter(sprite, zone.x, zone.y, 104);
    outlinedText(label, zone.x, zone.y + 68, 14, "#fff");
  }

  function hoverText(scrap) {
    const def = Sim.SCRAPS[scrap];
    const lines = [def.name + " · " + Sim.SLOT_NAMES[def.slot], def.desc, def.tip];
    const tower = towerAt(pointer);
    if (tower >= 0) {
      const pv = attachPreview(S.towers[tower], scrap);
      lines[1] = pv.text + (pv.lost.length ? " (" + pv.lost.join(", ") + " 풀림)" : "");
    }
    return lines;
  }

  function drawTray(state) {
    ctx.fillStyle = "#24516a";
    ctx.fillRect(0, TRAY_Y, W, H - TRAY_Y);
    spr("ui/tray", 0, TRAY_Y, W, H - TRAY_Y);
    ctx.fillStyle = INK;
    ctx.fillRect(0, TRAY_Y - 2, W, 4);
    const ref = held || selected;
    const scrap = ref && mode === "play" ? currentScrap(ref) : null;
    zoneBox(HAND, "ui/slot-hand", "손에 쥐기", scrap && inZone(HAND, pointer));
    zoneBox(FURNACE, "ui/slot-furnace", "녹이기", scrap && inZone(FURNACE, pointer));
    if (state.hand && !(held && held.from === "hand")) drawScrap(state.hand, HAND.x + 6, HAND.y - 2, 22);

    const left = 244;
    const width = 286;
    const title = (text, y) => {
      ctx.fillStyle = "#ffd166";
      ctx.font = "19px " + FONT;
      ctx.fillText(text, left, y);
    };
    const body = (text, y) => {
      ctx.fillStyle = "#efe6d6";
      ctx.font = "17px " + FONT;
      return wrapText(text, left, y, width, 22);
    };
    ctx.textAlign = "left";
    ctx.fillStyle = "#ffd166";
    ctx.font = "23px " + FONT;
    ctx.fillText(state.wave + " / " + Sim.MAX_WAVES + " 웨이브", left, 838);

    const tower = inspected !== null ? state.towers[inspected] : null;
    if (scrap) {
      const lines = hoverText(scrap);
      title(lines[0], 872);
      const y = body(lines[1], 897);
      ctx.fillStyle = "#b9c7d6";
      ctx.font = "15px " + FONT;
      wrapText(lines[2], left, y + 21, width, 19);
    } else if (tower && tower.active) {
      const names = Sim.towerStats(tower).names;
      title(inspected + 1 + "번 탑" + (names.length ? " · " + names.join(" · ") : ""), 872);
      SLOTS.forEach((slot, i) => {
        const part = tower.parts[slot];
        const name = part ? Sim.SCRAPS[part.id].name + (part.lv > 1 ? " ×" + part.lv : "") : "비어 있음";
        ctx.fillStyle = SLOT_COLOR[slot];
        ctx.font = "17px " + FONT;
        ctx.fillText(Sim.SLOT_NAMES[slot], left, 897 + i * 22);
        ctx.fillStyle = part ? "#efe6d6" : "#9fb0c4";
        ctx.fillText(name, left + 46, 897 + i * 22);
      });
    } else if (state.target.length) {
      title("노리는 조합", 872);
      body(state.target.map((id) => Sim.SCRAPS[id].name).join(" + "), 897);
    } else if (attachedOnce) {
      body("탑을 누르면 붙은 고물을 볼 수 있다. 녹인 고물은 이번 판에 다시 안 나온다.", 878);
    } else {
      body(state.field.length ? "떨어진 고물을 탑으로 끌어다 붙이세요!" : "쓰러진 적이 고물을 흘린다.", 878);
    }
  }

  // 전장 위쪽의 조작 버튼. 플레이 중에만 그린다.
  function drawHud() {
    addIconButton(6, 6, 54, paused ? "ui/btn-play" : "ui/btn-pause", () => (paused = !paused));
    addButton(66, 10, 58, 46, speed + "배", () => (speed = speed === 3 ? 1 : speed + 1), { size: 21, fill: "#2f7f93" });
    addIconButton(130, 6, 54, sfx.isMuted() ? "ui/btn-sound-off" : "ui/btn-sound-on", () => sfx.toggle());
    addIconButton(480, 6, 54, "ui/btn-codex", openCodex);
    outlinedText("도감", 507, 76, 15, "#fff");
  }

  function drawHint(state) {
    if (attachedOnce || mode !== "play" || !state.field.length || held) return;
    const item = state.field[0];
    const t = state.towers[0];
    const pulse = (performance.now() % 900) / 900;
    const x = item.x + (t.x - item.x) * pulse;
    const y = item.y + (t.y - item.y) * pulse;
    ctx.strokeStyle = "rgba(255,209,102,.55)";
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 10]);
    ctx.beginPath();
    ctx.moveTo(item.x, item.y);
    ctx.lineTo(t.x, t.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#ffd166";
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawDragged() {
    if (!held || !held.moved || mode !== "play") return;
    const scrap = currentScrap(held);
    if (!scrap) {
      held = null;
      return;
    }
    drawScrap(scrap, pointer.x, pointer.y, 25);
  }

  function dim(alpha) {
    ctx.fillStyle = "rgba(10,8,6," + alpha + ")";
    ctx.fillRect(0, 0, W, H);
  }

  function centerText(text, y, size, color) {
    ctx.font = size + "px " + FONT;
    ctx.textAlign = "center";
    ctx.fillStyle = color || "#fff";
    ctx.fillText(text, W / 2, y);
  }

  // 덮는 화면(재현·검색·결과·도감)은 아래 화면의 버튼을 지우고 자기 버튼만 받는다.
  function clearButtons() {
    buttons = [];
  }

  function drawReplayBanner() {
    clearButtons();
    ctx.fillStyle = "rgba(15,20,30,.86)";
    ctx.fillRect(0, 0, W, 124);
    centerText("놓친 조합을 그 웨이브에 다시 돌려 봤다", 34, 20, "#cdd6e2");
    drawScrap(missed.a, 96, 84, 22);
    outlinedText("+", 150, 95, 30, "#ffd166");
    drawScrap(missed.b, 204, 84, 22);
    ctx.textAlign = "left";
    ctx.font = "21px " + FONT;
    ctx.fillStyle = "#ffd166";
    ctx.fillText(missed.synergy ? missed.synergy : "이 둘을 같이", 250, 80);
    ctx.font = "17px " + FONT;
    ctx.fillStyle = "#efe6d6";
    ctx.fillText(missed.tower + 1 + "번 탑에 붙였다면", 250, 104);
    addButton(398, 136, 130, 52, "건너뛰기", () => leaveReplay(true), { size: 20 });
  }

  function endMessage() {
    if (!finalState) return "";
    if (finalState.over === "win") return "12웨이브를 다 막았다";
    return finalState.wave + "웨이브에서 무너졌다";
  }

  function drawEndPanel() {
    clearButtons();
    dim(0.6);
    spr("ui/panel", 16, 176, 508, 610);
    centerText(endMessage(), 338, 30, "#b5501c");
    const builds = Sim.buildSummary(finalState);
    builds.forEach((parts, i) => {
      const names = parts.map((id) => Sim.SCRAPS[id].name).join(" + ") || "맨탑";
      centerText(i + 1 + "번 탑: " + names, 376 + i * 26, 17, "#2a3346");
    });
    if (missed) {
      const result = missed.survived
        ? "이 조합이면 그 웨이브를 막았다"
        : "이 조합이면 " + Math.max(0, missed.gainSec) + "초 더 버텼다";
      centerText(result, 474, 20, "#2a3346");
      addButton(110, 490, 320, 66, "이 조합 노리고 다시", chooseTarget, { fill: "#e0782a", size: 25 });
      addButton(110, 568, 320, 54, "그냥 다시", choosePlain, { fill: "#5a6b82", size: 21 });
    } else {
      // 탐색은 본 고물 두 개를 한 탑에 붙이는 경우만 본다. 그 범위에서 못 찾았다는 뜻이다.
      if (finalState.over === "lose") centerText("확인한 조합 중에는 더 나은 것이 없었다", 474, 18, "#2a3346");
      addButton(110, 490, 320, 66, "다시", choosePlain, { fill: "#e0782a", size: 25 });
    }
    addButton(170, 636, 200, 46, "기록 내보내기", exportRecord, { fill: "#8a94a6", size: 18 });
    outlinedText(exportNote || "플레이 기록은 이 기기에만 저장됩니다", W / 2, 812, 15, "#e9dcc0");
  }

  function drawSearching() {
    clearButtons();
    dim(0.55);
    centerText(endMessage(), 420, 34, "#ffd166");
    const share = search.total ? Math.round((search.done / search.total) * 100) : 0;
    centerText("놓친 조합을 찾는 중 " + share + "%", 470, 20, "#efe6d6");
  }

  // 고물 도감: 12종의 칸과 효과, 궁합 10가지. 열려 있는 동안 게임은 멈춘다.
  function openCodex() {
    held = null;
    selected = null;
    inspected = null;
    codex = { tab: "barrel" };
    telemetry.log("codex", { run: runIndex, wave: S.wave });
  }

  function drawCodex(state) {
    clearButtons();
    ctx.fillStyle = "#16202e";
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = "left";
    ctx.fillStyle = "#ffd166";
    ctx.font = "32px " + FONT;
    ctx.fillText("고물 도감", 24, 60);
    addButton(398, 18, 122, 58, "닫기", () => (codex = null), { size: 23 });
    const tabs = [...SLOTS.map((slot) => [slot, Sim.SLOT_NAMES[slot], SLOT_COLOR[slot]]), ["synergy", "궁합", "#ffd166"]];
    tabs.forEach(([key, label, color], i) => {
      const on = codex.tab === key;
      addButton(20 + i * 127, 96, 119, 58, label, () => (codex.tab = key), {
        size: 23,
        fill: on ? color : "#2b3a4e",
        color: on ? INK : "#cdd6e2",
      });
    });
    if (codex.tab === "synergy") drawCodexSynergies(state);
    else drawCodexSlot(state, codex.tab);
  }

  // 이 고물과 궁합이 맞는 짝: "깨진 배터리 → 연쇄번개" 꼴.
  function synergyPartners(id) {
    return Object.entries(Sim.SYNERGIES)
      .filter(([key]) => key.split("+").includes(id))
      .map(([key, name]) => Sim.SCRAPS[key.split("+").find((other) => other !== id)].name + " → " + name);
  }

  function drawCodexSlot(state, slot) {
    ctx.textAlign = "left";
    ctx.fillStyle = "#cdd6e2";
    ctx.font = "18px " + FONT;
    const end = wrapText(
      SLOT_RULE[slot] + " 탑마다 한 칸뿐이라 다른 것을 붙이면 원래 것이 바닥에 떨어진다. 같은 것을 또 붙이면 덧대져 공격력이 42%씩 오른다(최대 3단).",
      24,
      196,
      492,
      25,
    );
    let y = end + 20;
    for (const id of Sim.SCRAP_IDS.filter((key) => Sim.SCRAPS[key].slot === slot)) {
      const def = Sim.SCRAPS[id];
      const melted = state.melted.includes(id);
      ctx.fillStyle = "#1f2c3d";
      roundRect(20, y, 500, 158, 14);
      ctx.fill();
      drawScrap(id, 72, y + 62, 36);
      ctx.textAlign = "left";
      ctx.fillStyle = melted ? "#7d8a9a" : "#fff";
      ctx.font = "25px " + FONT;
      ctx.fillText(def.name, 128, y + 40);
      if (melted) {
        ctx.textAlign = "right";
        ctx.fillStyle = "#ff8a7a";
        ctx.font = "16px " + FONT;
        ctx.fillText("이번 판에 녹임", 506, y + 38);
        ctx.textAlign = "left";
      }
      ctx.fillStyle = melted ? "#7d8a9a" : "#e9eef5";
      ctx.font = "19px " + FONT;
      ctx.fillText(def.desc, 128, y + 68);
      ctx.fillStyle = "#9fb0c4";
      ctx.font = "16px " + FONT;
      const tipEnd = wrapText(def.tip, 128, y + 94, 380, 21);
      ctx.fillStyle = "#ffd166";
      wrapText("궁합  " + synergyPartners(id).join("  ·  "), 128, tipEnd + 23, 380, 21);
      y += 166;
    }
  }

  function drawCodexSynergies(state) {
    ctx.textAlign = "left";
    ctx.fillStyle = "#cdd6e2";
    ctx.font = "18px " + FONT;
    const end = wrapText(
      "칸이 다른 두 고물이 한 탑에 붙으면 궁합이 생긴다. 바닥 고물에 별이 붙으면 지금 붙였을 때 궁합이 완성된다는 뜻이다.",
      24,
      196,
      492,
      25,
    );
    const active = new Set(state.towers.filter((t) => t.active).flatMap((t) => Sim.towerStats(t).names));
    let y = end + 46;
    for (const [key, name] of Object.entries(Sim.SYNERGIES)) {
      const [a, b] = key.split("+");
      drawScrap(a, 46, y, 20);
      outlinedText("+", 80, y + 9, 24, "#ffd166");
      drawScrap(b, 114, y, 20);
      ctx.textAlign = "left";
      ctx.fillStyle = "#ffd166";
      ctx.font = "22px " + FONT;
      ctx.fillText(name, 150, y - 4);
      ctx.fillStyle = "#e9eef5";
      ctx.font = "17px " + FONT;
      ctx.fillText(Sim.SYNERGY_INFO[name], 150, y + 20);
      const blocked = state.melted.includes(a) || state.melted.includes(b);
      if (active.has(name) || blocked) {
        ctx.textAlign = "right";
        ctx.fillStyle = active.has(name) ? "#7ddf64" : "#ff8a7a";
        ctx.font = "16px " + FONT;
        ctx.fillText(active.has(name) ? "가동 중" : "녹여서 불가", 518, y - 4);
      }
      y += 65;
    }
  }

  // 세로로 긴 휴대폰에서는 캔버스 위아래가 남는다. 그 여백을 지금 화면의 위·아래 색으로 칠해 이어 보이게 한다.
  const BACKDROP = {
    title: ["#909357", "#7e7841"],
    field: ["#617352", "#245163"],
    codex: ["#16202e", "#16202e"],
  };
  let backdrop = null;

  function setBackdrop(name) {
    if (backdrop === name) return;
    backdrop = name;
    const [top, bottom] = BACKDROP[name];
    document.body.style.background = "linear-gradient(" + top + " 50%, " + bottom + " 50%)";
  }

  function startFromTitle() {
    if (mode !== "title") return;
    mode = "play";
    startRun([]);
  }

  function drawTitle() {
    ctx.fillStyle = "#7d8a4a";
    ctx.fillRect(0, 0, W, H);
    spr("key/title", 0, 0, W, H);
    ctx.font = "86px " + FONT;
    ctx.textAlign = "center";
    ctx.lineJoin = "round";
    ctx.strokeStyle = INK;
    ctx.lineWidth = 18;
    ctx.strokeText("고물 요새", W / 2, 170);
    ctx.fillStyle = "#e0782a";
    ctx.fillText("고물 요새", W / 2, 176);
    ctx.fillStyle = "#ffe9b0";
    ctx.fillText("고물 요새", W / 2, 170);
    outlinedText("적이 흘린 고물을 주워 탑에 붙여라", W / 2, 232, 24, "#fff");
    if (imgPending > 0) outlinedText("불러오는 중…", W / 2, 840, 22, "#fff");
    else addButton(120, 792, 300, 78, "시작", startFromTitle, { fill: "#e0782a", size: 36 });
  }

  function frame(time) {
    const dt = Math.min(0.05, (time - lastTime) / 1000 || 0);
    lastTime = time;
    frameDt = dt;
    buttons = [];
    setBackdrop(mode === "title" ? "title" : codex ? "codex" : "field");
    if (mode === "title") {
      const titleScale = canvas.width / W;
      ctx.setTransform(titleScale, 0, 0, titleScale, 0, 0);
      drawTitle();
      requestAnimationFrame(frame);
      return;
    }

    if (mode === "play" && !paused && !codex) {
      accumulator += dt * speed;
      while (accumulator >= Sim.DT && !S.over) {
        accumulator -= Sim.DT;
        Sim.step(S);
        const waved = S.events.some((e) => e.type === "wave");
        consumeEvents(S, false);
        if (waved) snaps.push({ tick: S.tick, json: JSON.stringify(S) });
      }
      if (S.over) onRunEnd();
    } else if (mode === "search") {
      runSearchSlice();
    } else if (mode === "replay") {
      accumulator += dt * 3;
      while (accumulator >= Sim.DT && mode === "replay") {
        accumulator -= Sim.DT;
        if (replay.over || replay.tick >= replayEndTick) {
          leaveReplay(false);
          break;
        }
        Sim.step(replay);
        consumeEvents(replay, true);
      }
    }

    const view = mode === "replay" ? replay : finalState && mode !== "play" ? finalState : S;
    const scale = canvas.width / W;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    shake = Math.max(0, shake - dt * 30);
    ctx.save();
    if (shake > 0) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    drawField(view);
    drawFx(dt);
    drawPreviews(view);
    drawHint(view);
    ctx.restore();
    drawTray(view);

    if (mode === "play") {
      if (paused) {
        ctx.fillStyle = "rgba(10,14,22,.3)";
        ctx.fillRect(0, 0, W, Sim.FIELD_H);
        outlinedText("일시정지", W / 2, 298, 34, "#fff");
        outlinedText("왼쪽 위 ▶ 버튼으로 계속", W / 2, 326, 17, "#ffd166");
      }
      drawHud();
    }
    drawDragged();
    if (mode === "search") drawSearching();
    if (mode === "replay") drawReplayBanner();
    if (mode === "end") drawEndPanel();
    if (codex) drawCodex(view);
    requestAnimationFrame(frame);
  }

  // 다른 앱으로 넘어가거나 화면이 꺼지면 판과 소리를 멈춘다. 돌아오면 소리만 깨우고 판은 멈춘 채로 둔다.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (mode === "play") paused = true;
      sfx.suspend();
    } else {
      sfx.resume();
    }
  });

  // 검사 스크립트가 상태를 읽고 속도를 바꾸는 창구.
  self.__scrapFort = {
    get state() {
      return S;
    },
    get mode() {
      return mode;
    },
    get speed() {
      return speed;
    },
    setSpeed: (value) => (speed = value),
    start: startFromTitle,
  };
  sfx.music("workshop");
  if (document.fonts && document.fonts.load) document.fonts.load("20px Jua");
  requestAnimationFrame(frame);
})();
