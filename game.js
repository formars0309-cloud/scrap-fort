// 고물 요새 화면과 입력. 규칙은 sim.js에만 있다.
(function () {
  const Sim = self.ScrapSim;
  const Assets = self.ScrapAssets;
  const { createTelemetry, createSfx } = self.Proto;
  const VERSION = "2026-11-20";
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
  // 궁합 계열 색. 탑의 빛, 이름 카드, 탄의 잔광에 쓴다.
  const SYNERGY_COLOR = {};
  for (const [color, names] of [
    ["#ff8a3d", ["화염병", "불기둥", "용광로", "박격포", "지옥 포대"]],
    ["#b48bff", ["연쇄번개", "누전", "레일건", "과충전", "번개 폭풍"]],
    ["#8fdcff", ["눈보라", "얼음 구슬", "빙결 망치", "냉각기", "빙하기"]],
    ["#ff6b5b", ["자석 꼬챙이", "말뚝", "철퇴", "파성추"]],
    ["#ffd166", ["핀볼", "팽이", "벌집"]],
  ]) {
    for (const name of names) SYNERGY_COLOR[name] = color;
  }
  const SYNERGY_LIST = Object.entries(Sim.SYNERGIES).map(([key, name]) => ({ kind: "synergy", name, ids: key.split("+") }));
  const FULL_LIST = Object.entries(Sim.FULL_SETS).map(([key, name]) => ({ kind: "full", name, ids: key.split("+") }));
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
  let hitstop = 0; // 남은 정지 시간(초). 궁합 완성·덩치 처치 때 판을 잠깐 멈춘다.
  let slowmo = 0; // 남은 느린 화면 시간(초).
  let cards = []; // 화면 가운데 궁합 이름 카드
  let streak = { n: 0, tick: -999 };
  let waveKillBase = [];
  let runFinds = [];
  let picker = null; // 노릴 조합 고르기 화면

  // 궁합 도감 수집 기록. 이 기기에만 남는다.
  const COLLECTION_KEY = "scrap-fort:collection";
  function loadCollection() {
    try {
      const value = JSON.parse(localStorage.getItem(COLLECTION_KEY));
      if (value && value.synergies && value.fulls) return value;
    } catch {
      // 저장소를 못 쓰면 이번 방문 동안만 센다.
    }
    return { synergies: {}, fulls: {}, bestWave: 0, wins: 0 };
  }
  const collection = loadCollection();
  function saveCollection() {
    try {
      localStorage.setItem(COLLECTION_KEY, JSON.stringify(collection));
    } catch {
      // 위와 같다.
    }
  }
  function found(entry) {
    return Boolean((entry.kind === "full" ? collection.fulls : collection.synergies)[entry.name]);
  }
  // 처음 만든 궁합이면 true.
  function discover(kind, name) {
    const book = kind === "full" ? collection.fulls : collection.synergies;
    const first = !book[name];
    book[name] = (book[name] || 0) + 1;
    if (first) runFinds.push(name);
    saveCollection();
    return first;
  }
  function collectionLine() {
    const syn = SYNERGY_LIST.filter(found).length;
    const full = FULL_LIST.filter(found).length;
    return "궁합 " + syn + "/" + SYNERGY_LIST.length + " · 완전체 " + full + "/" + FULL_LIST.length;
  }

  function towerColor(stats) {
    if (stats.full) return SYNERGY_COLOR[stats.full];
    return stats.names.length ? SYNERGY_COLOR[stats.names[0]] : null;
  }

  function rgba(hex, alpha) {
    const n = parseInt(hex.slice(1), 16);
    return "rgba(" + (n >> 16) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + Math.max(0, Math.min(1, alpha)) + ")";
  }

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
    towerFx = Sim.TOWER_SPOTS.map(() => ({ recoil: 0, flash: 0, pop: 0, flip: false, aim: -0.3, hype: 0, hyped: false, glow: 0, names: [], full: null }));
    hitstop = 0;
    slowmo = 0;
    cards = [];
    streak = { n: 0, tick: -999 };
    waveKillBase = Sim.TOWER_SPOTS.map(() => 0);
    runFinds = [];
    picker = null;
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

  // 튀어 오르며 커졌다 작아지는 글자. 연속 처치와 피해 숫자에 쓴다.
  function popText(x, y, text, color, size, life) {
    fx.push({ kind: "pop", x, y, text, color, size, t: life || 0.9, life: life || 0.9 });
  }

  // 불꽃 조각. power는 퍼지는 세기, glow면 빛을 더해 그린다.
  function burstFx(x, y, color, count, power, glow) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = (40 + Math.random() * 140) * (power || 1);
      const life = 0.4 + Math.random() * 0.25;
      fx.push({ kind: "spark", x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, color, glow: Boolean(glow), t: life, life });
    }
  }

  function ringFx(x, y, color, r0, r1, life, width) {
    fx.push({ kind: "ring", x, y, color, r0, r1, width: width || 5, t: life, life });
  }

  function flashFx(x, y, color, r, life) {
    fx.push({ kind: "flash", x, y, color, r, t: life, life });
  }

  function raysFx(x, y, color, r, life) {
    fx.push({ kind: "rays", x, y, color, r, spin: Math.random() * 6, t: life, life });
  }

  // 무엇에 맞아 죽었는지에 따라 쓰러지는 모습이 다르다. 쓰러진 몸은 튀어 올랐다가 사라진다.
  function deathFx(e) {
    const size = ENEMY_SIZE[e.enemy];
    const look = enemyFx.get(e.id);
    const left = look ? look.left : false;
    const fling = e.cause === "magnet";
    const back = left ? 1 : -1;
    fx.push({
      kind: "corpse",
      name: "enemies/" + e.enemy + "-1",
      x: e.x,
      y: e.y,
      size,
      left,
      vx: (Math.random() - 0.5) * 70 + (fling ? back * 260 : 0),
      vy: fling ? -320 : -170,
      rot: 0,
      vr: (Math.random() - 0.5) * (fling ? 16 : 5),
      tint: e.cause,
      t: fling ? 0.7 : 0.45,
      life: fling ? 0.7 : 0.45,
    });
    if (e.cause === "ice") {
      for (let i = 0; i < 8; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = 90 + Math.random() * 150;
        fx.push({
          kind: "shard",
          x: e.x,
          y: e.y - 6,
          vx: Math.cos(a) * v,
          vy: Math.sin(a) * v - 120,
          rot: Math.random() * 6,
          vr: (Math.random() - 0.5) * 18,
          size: 5 + Math.random() * 6,
          t: 0.6,
          life: 0.6,
        });
      }
      ringFx(e.x, e.y, "#bff0ff", 8, 46, 0.3, 4);
      fx.push({ kind: "sprite", name: "fx/frost", x: e.x, y: e.y - 4, size: size * 0.9, t: 0.3, life: 0.3 });
    } else if (e.cause === "battery") {
      flashFx(e.x, e.y, "#d9c4ff", 54, 0.22);
      for (let i = 0; i < 4; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = 34 + Math.random() * 26;
        fx.push({ kind: "bolt", ax: e.x, ay: e.y, bx: e.x + Math.cos(a) * r, by: e.y + Math.sin(a) * r, color: "#c7a6ff", t: 0.16, life: 0.16 });
      }
      fx.push({ kind: "sprite", name: "fx/spark", x: e.x, y: e.y, size: 40, t: 0.2, life: 0.2 });
    } else if (e.cause === "oil" || e.cause === "burn") {
      for (let i = 0; i < 9; i++) {
        const life = 0.5 + Math.random() * 0.4;
        fx.push({
          kind: "ember",
          x: e.x + (Math.random() - 0.5) * 22,
          y: e.y - Math.random() * 10,
          vy: -50 - Math.random() * 70,
          seed: Math.random() * 6,
          color: Math.random() < 0.5 ? "#ffb347" : "#ff6a2a",
          t: life,
          life,
        });
      }
      fx.push({ kind: "sprite", name: "fx/smoke", x: e.x, y: e.y - 8, size: 38, t: 0.45, life: 0.45 });
    } else if (fling) {
      ringFx(e.x, e.y, "#ff8a7a", 10, 50, 0.25, 4);
      burstFx(e.x, e.y, "#ff8a7a", 6, 1.2, true);
    } else {
      burstFx(e.x, e.y, "#e9dcc0", 6);
      fx.push({ kind: "sprite", name: "fx/smoke", x: e.x, y: e.y - 4, size: 26, t: 0.3, life: 0.3 });
    }
  }

  // 짧은 간격으로 잇달아 잡으면 연속 수가 쌓이고, 처치음이 한 칸씩 높아진다.
  function bumpStreak(state, e) {
    streak.n = state.tick - streak.tick <= 27 ? streak.n + 1 : 1;
    streak.tick = state.tick;
    const n = streak.n;
    if (n === 3 || n === 5 || n === 8 || (n >= 10 && n % 5 === 0)) {
      const hot = n >= 8;
      popText(e.x, e.y - 34, n + "연속!", hot ? "#ff7a5c" : "#ffd166", 22 + Math.min(n, 20) * 1.3);
      if (hot) shake = Math.max(shake, 4 + Math.min(n, 20) * 0.3);
    }
    return n;
  }

  function entryFor(kind, name) {
    return (kind === "full" ? FULL_LIST : SYNERGY_LIST).find((entry) => entry.name === name);
  }

  // 궁합이나 완전체가 생긴 순간: 판을 잠깐 멈추고, 이름 카드를 띄우고, 탑이 빛나며 다음 몇 발을 과장한다.
  function celebrate(index, kind, name) {
    const t = S.towers[index];
    const tf = towerFx[index];
    const full = kind === "full";
    const color = SYNERGY_COLOR[name] || "#ffd166";
    const first = discover(kind, name);
    const entry = entryFor(kind, name);
    cards.push({
      kind,
      name,
      color,
      ids: entry ? entry.ids : [],
      info: full ? Sim.FULL_INFO[name] : Sim.SYNERGY_INFO[name],
      first,
      t: full ? 2.6 : 2.0,
      life: full ? 2.6 : 2.0,
    });
    if (cards.length > 3) cards.splice(1, cards.length - 3);
    hitstop = Math.max(hitstop, full ? 0.5 : 0.32);
    slowmo = Math.max(slowmo, full ? 1.2 : 0.7);
    shake = Math.max(shake, full ? 14 : 9);
    tf.hype = full ? 8 : 5;
    tf.glow = 1;
    const cy = t.y + TOWER_DROP - 20;
    flashFx(t.x, cy, color, full ? 230 : 150, 0.5);
    ringFx(t.x, cy + 20, color, 30, full ? 270 : 180, 0.6, full ? 11 : 7);
    ringFx(t.x, cy + 20, "#ffffff", 20, full ? 210 : 130, 0.45, 3);
    raysFx(t.x, cy, color, full ? 220 : 140, full ? 1.4 : 0.9);
    burstFx(t.x, cy, color, full ? 60 : 34, 1.9, true);
    sound("synergy", { volume: 0.9, rate: full ? 0.85 : 1 }, [660, 0.25, "triangle", 0.08, 1320]);
    if (full) sound("blast", { volume: 0.6, rate: 0.7 });
    if (first) sound("wave", { volume: 0.5, rate: 1.4 });
    telemetry.log("synergy", { run: runIndex, name, full, first, wave: S.wave, tower: index });
  }

  // 지난 웨이브에 가장 많이 잡은 탑을 띄운다.
  function waveMvp(state) {
    let best = -1;
    let bestKills = 0;
    state.towers.forEach((tower, i) => {
      const k = tower.kills - (waveKillBase[i] || 0);
      if (k > bestKills) {
        bestKills = k;
        best = i;
      }
    });
    waveKillBase = state.towers.map((tower) => tower.kills);
    if (best < 0 || bestKills < 6) return;
    const st = Sim.towerStats(state.towers[best]);
    const label = st.full || st.names[0] || "";
    floatText(W / 2, 162, "지난 웨이브 MVP  " + (best + 1) + "번 탑" + (label ? " · " + label : "") + " · " + bestKills + "마리", "#fff", 19);
  }

  function consumeEvents(state, quiet) {
    let shooter = 0;
    for (const e of state.events) {
      if (e.type === "kill") {
        deathFx(e);
        if (e.enemy === "brute") {
          shake = Math.max(shake, 14);
          fx.push({ kind: "blast", x: e.x, y: e.y, r: 80, t: 0.45, life: 0.45 });
          raysFx(e.x, e.y, "#ffd166", 160, 0.9);
          ringFx(e.x, e.y, "#ffe9b0", 20, 180, 0.5, 8);
          flashFx(e.x, e.y, "#fff3c4", 170, 0.35);
          burstFx(e.x, e.y, "#ffd166", 30, 1.6, true);
          if (!quiet) {
            hitstop = Math.max(hitstop, 0.14);
            slowmo = Math.max(slowmo, 0.7);
          }
        }
        if (!quiet) {
          const n = bumpStreak(state, e);
          if (e.enemy === "brute") sound("blast", { volume: 0.9, rate: 0.75 });
          else {
            const step = Math.min(n, 14);
            sound("die", { volume: 0.3 + step * 0.015, gap: 0.05, rate: 0.85 + step * 0.05 }, [180 + step * 30, 0.06, "square", 0.025]);
          }
        }
      } else if (e.type === "drop") {
        burstFx(e.x, e.y, SLOT_COLOR[Sim.SCRAPS[e.scrap].slot], 8, 1, true);
        ringFx(e.x, e.y, SLOT_COLOR[Sim.SCRAPS[e.scrap].slot], 10, 44, 0.35, 4);
        fx.push({ kind: "sprite", name: "fx/scrap-pop", x: e.x, y: e.y, size: 54, t: 0.4, life: 0.4 });
        if (!quiet) sound("drop", { volume: 0.5, gap: 0.1 }, [620, 0.08, "triangle", 0.05, 820]);
      } else if (e.type === "beam") {
        const tf = towerFx[shooter];
        const [ax, ay] = muzzlePoint(state.towers[shooter], tf);
        const color = towerColor(Sim.towerStats(state.towers[shooter])) || "#ffb070";
        const life = e.rail ? 0.24 : 0.14;
        fx.push({ kind: "beam", ax, ay, bx: e.bx, by: e.by, burst: e.burst, rail: e.rail, hype: tf.hyped, color, t: life, life });
        if (e.rail || tf.hyped) flashFx(ax, ay, color, e.rail ? 60 : 44, 0.16);
      } else if (e.type === "arc") {
        fx.push({ kind: "bolt", ax: e.ax, ay: e.ay, bx: e.bx, by: e.by, color: "#b9a0ff", t: 0.16, life: 0.16 });
        fx.push({ kind: "sprite", name: "fx/spark", x: e.bx, y: e.by, size: 30, t: 0.18, life: 0.18 });
        if (!quiet) sound("zap", { volume: 0.25, gap: 0.18 });
      } else if (e.type === "blast") {
        fx.push({ kind: "blast", x: e.x, y: e.y, r: e.r, t: 0.32, life: 0.32 });
        ringFx(e.x, e.y, e.r > 60 ? "#ffd166" : "#ffe2b0", e.r * 0.3, e.r * 1.15, 0.3, e.r > 60 ? 7 : 4);
        if (e.r > 60) flashFx(e.x, e.y, "#ffcf7a", e.r * 1.4, 0.22);
        if (!quiet) sound("blast", { volume: e.r > 60 ? 0.5 : 0.3, gap: 0.2, rate: e.r > 60 ? 0.9 : 1.25 });
      } else if (e.type === "shot") {
        const tf = towerFx[e.tower];
        const tower = state.towers[e.tower];
        shooter = e.tower;
        tf.recoil = 1;
        tf.flash = 1;
        aimTower(tf, tower.angle);
        tf.hyped = tf.hype > 0;
        if (tf.hyped) {
          tf.hype -= 1;
          tf.flash = 1.7;
          const [mx, my] = muzzlePoint(tower, tf);
          const color = towerColor(Sim.towerStats(tower)) || "#ffd166";
          ringFx(mx, my, color, 6, 52, 0.28, 5);
          flashFx(mx, my, color, 58, 0.2);
          burstFx(mx, my, color, 8, 1.3, true);
        }
        if (!quiet) shotSound(tower, e.burst || tf.hyped);
      } else if (e.type === "leak") {
        shake = Math.max(shake, 7);
        if (!quiet) sound("forthit", { volume: 0.7, gap: 0.25 }, [90, 0.18, "sawtooth", 0.07, 50]);
      } else if (e.type === "wave" && !quiet) {
        floatText(W / 2, 120, e.wave + " 웨이브", "#ffd166", 32);
        if (e.wave > 1) waveMvp(state);
        sound("wave", { volume: 0.55 }, [330, 0.14, "triangle", 0.06, 490]);
        if (state.queue.some((item) => item.type === "brute" && item.wave === e.wave)) sound("brute", { volume: 0.7 });
        telemetry.log("wave", { run: runIndex, wave: e.wave, fort: state.fort, sec: Math.round(state.tick / 30) });
      } else if (e.type === "attach" && !quiet) {
        const t = state.towers[e.tower];
        const tf = towerFx[e.tower];
        tf.pop = 1;
        burstFx(t.x, t.y, "#ffd166", 16, 1, true);
        sound("attach", { volume: 0.7 }, [420, 0.1, "square", 0.06, 840]);
        // 덧대기 사건에는 궁합 목록이 없다. 장착·교체 때만 새로 생긴 궁합을 가린다.
        let gained = [];
        let newFull = null;
        if (e.names) {
          gained = e.names.filter((name) => !tf.names.includes(name));
          newFull = e.full && e.full !== tf.full ? e.full : null;
          tf.names = e.names;
          tf.full = e.full || null;
        }
        // 카드는 가장 큰 것 하나만 띄우고, 함께 생긴 궁합은 도감에만 적는다.
        const shown = newFull ? null : gained[gained.length - 1];
        for (const name of gained) if (name !== shown) discover("synergy", name);
        if (newFull) celebrate(e.tower, "full", newFull);
        else if (shown) celebrate(e.tower, "synergy", shown);
        else if (e.lv > 1) floatText(t.x, t.y - 56, "덧대기 " + e.lv + "단", "#ffe9b0", 20);
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
    cards = [];
    hitstop = 0;
    slowmo = 0;
    collection.bestWave = Math.max(collection.bestWave || 0, S.wave);
    if (S.over === "win") collection.wins = (collection.wins || 0) + 1;
    saveCollection();
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
    if (codex || picker || mode !== "play") return;
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
    if (event.key === "Escape" && (codex || picker)) {
      codex = null;
      picker = null;
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
    const aura = towerColor(stats);
    if (aura) drawAura(t, cy, aura, Boolean(stats.full), tf);
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
    if (stats.names.length && !hoverScrap) {
      const label = stats.full ? "완전체 " + stats.full : stats.names.join(" · ");
      outlinedText(label, t.x, t.y + TOWER_LABEL_Y, stats.full ? 19 : 17, aura || "#ffd166");
    }
  }

  // 궁합 탑 바닥의 빛. 완전체는 빛살과 도는 불씨가 더해진다. 막 완성된 탑은 한동안 더 밝다.
  function drawAura(t, cy, color, full, tf) {
    const now = performance.now() / 1000;
    tf.glow = Math.max(0, (tf.glow || 0) - frameDt * 0.5);
    const pulse = 0.5 + 0.5 * Math.sin(now * 3.2);
    ctx.save();
    if (full) drawRays(t.x, cy - 10, 120, color, 0.28 + tf.glow * 0.3, now * 0.5);
    ctx.globalCompositeOperation = "lighter";
    const rx = full ? 100 : 84;
    const g = ctx.createRadialGradient(t.x, cy + 8, 8, t.x, cy + 8, rx);
    g.addColorStop(0, rgba(color, 0.4 + 0.15 * pulse + tf.glow * 0.4));
    g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(t.x, cy + 8, rx, rx * 0.66, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = rgba(color, 0.5 + 0.35 * pulse);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(t.x, cy + 34, 72 + pulse * 4, 22 + pulse, 0, 0, Math.PI * 2);
    ctx.stroke();
    if (full) {
      for (let i = 0; i < 6; i++) {
        const ang = now * 1.7 + (i * Math.PI) / 3;
        ctx.fillStyle = rgba(color, 0.95);
        ctx.beginPath();
        ctx.arc(t.x + Math.cos(ang) * 78, cy + 22 + Math.sin(ang) * 26, 3.5 + pulse * 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
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
    const afterStats = Sim.towerStats({ parts });
    const after = afterStats.names;
    const gained = after.filter((n) => !before.includes(n));
    const lost = before.filter((n) => !after.includes(n));
    if (afterStats.full && afterStats.full !== Sim.towerStats(t).full) {
      return { text: "완전체: " + afterStats.full + "!", color: SYNERGY_COLOR[afterStats.full], gained, lost, full: afterStats.full };
    }
    if (gained.length) return { text: "궁합 완성: " + gained.join(" · "), color: SYNERGY_COLOR[gained[0]] || "#ffd166", gained, lost };
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
      outlinedText(pv.text, t.x, t.y + TOWER_LABEL_Y, pv.full ? 23 : pv.gained.length ? 20 : 16, pv.color);
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
    if (e.hp < look.hp) {
      look.punch = 1;
      look.acc = (look.acc || 0) + (look.hp - e.hp);
    }
    look.hp = e.hp;
    damageNumber(e, look);
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
    if (e.freezeT > 0) {
      // 빙결 망치: 얼음덩이에 갇혀 멈춘다.
      ctx.fillStyle = "rgba(180,236,255,.5)";
      ctx.strokeStyle = "#e9fbff";
      ctx.lineWidth = 2;
      roundRect(e.x - size * 0.42, foot - size * 0.86, size * 0.84, size * 0.9, 8);
      ctx.fill();
      ctx.stroke();
    }
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

  // 깎인 피해를 모았다가 0.2초마다 숫자로 띄운다. 궁합 탑이 깎으면 그 색으로 크게 띄운다.
  let numbersOnScreen = 0;
  function damageNumber(e, look) {
    look.numT = (look.numT || 0) - frameDt;
    if (!(look.acc >= 1) || look.numT > 0 || mode === "title") return;
    if (numbersOnScreen > 36) return;
    const tower = S && S.towers[e.lastTower];
    const color = tower ? towerColor(Sim.towerStats(tower)) : null;
    const amount = Math.round(look.acc);
    const size = (color ? 19 : 15) + Math.min(14, amount / 8);
    popText(e.x + (Math.random() - 0.5) * 16, e.y - 26, String(amount), color || "#fff4d6", size, 0.6);
    look.acc = 0;
    look.numT = 0.2;
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
      const glow = towerColor(Sim.towerStats(tower));
      if (glow) {
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = rgba(glow, towerFx[b.tower].hype > 0 ? 0.75 : 0.45);
        ctx.beginPath();
        ctx.arc(x, y, r * (towerFx[b.tower].hype > 0 ? 3.2 : 2.3), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = "source-over";
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

  const FX_MAX = 520;

  // 지그재그 번개 한 줄기. 매 프레임 모양을 새로 뽑아 떨리게 한다.
  function boltPath(ax, ay, bx, by, jitter) {
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    const steps = 5;
    for (let i = 1; i < steps; i++) {
      const f = i / steps;
      ctx.lineTo(ax + (bx - ax) * f + (Math.random() - 0.5) * jitter, ay + (by - ay) * f + (Math.random() - 0.5) * jitter);
    }
    ctx.lineTo(bx, by);
  }

  function drawFx(dt) {
    let pops = 0;
    for (const f of fx) {
      f.t -= dt;
      const a = Math.max(0, f.t / f.life);
      const kind = f.kind;
      if (kind === "spark") {
        f.vx *= 1 - 2.4 * dt;
        f.vy = f.vy * (1 - 2.4 * dt) + 300 * dt;
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        ctx.globalAlpha = a;
        if (f.glow) ctx.globalCompositeOperation = "lighter";
        ctx.strokeStyle = f.color;
        ctx.lineCap = "round";
        ctx.lineWidth = f.glow ? 3.6 : 3;
        ctx.beginPath();
        ctx.moveTo(f.x, f.y);
        ctx.lineTo(f.x - f.vx * 0.04, f.y - f.vy * 0.04);
        ctx.stroke();
        ctx.globalCompositeOperation = "source-over";
      } else if (kind === "text") {
        f.y -= 34 * dt;
        ctx.globalAlpha = Math.min(1, a * 1.8);
        outlinedText(f.text, f.x, f.y, f.size, f.color);
      } else if (kind === "pop") {
        pops += 1;
        const age = f.life - f.t;
        const scale = age < 0.12 ? 0.5 + (age / 0.12) * 0.75 : 1.25 - Math.min(0.25, (age - 0.12) * 1.6);
        f.y -= 24 * dt;
        ctx.globalAlpha = Math.min(1, a * 2.5);
        ctx.save();
        ctx.translate(f.x, f.y);
        ctx.scale(scale, scale);
        outlinedText(f.text, 0, 0, f.size, f.color);
        ctx.restore();
      } else if (kind === "beam") {
        const wide = f.rail ? 2 : f.hype ? 1.5 : 1;
        ctx.lineCap = "round";
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = a * 0.55;
        ctx.strokeStyle = f.color;
        ctx.lineWidth = (f.burst ? 22 : 16) * wide;
        ctx.beginPath();
        ctx.moveTo(f.ax, f.ay);
        ctx.lineTo(f.bx, f.by);
        ctx.stroke();
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = a;
        ctx.strokeStyle = INK;
        ctx.lineWidth = (f.burst ? 13 : 9) * wide;
        ctx.stroke();
        ctx.strokeStyle = f.burst ? "#ffd166" : f.color;
        ctx.lineWidth = (f.burst ? 8 : 5) * wide;
        ctx.stroke();
        ctx.strokeStyle = "#fffbe8";
        ctx.lineWidth = 2 * wide;
        ctx.stroke();
      } else if (kind === "bolt") {
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = a * 0.6;
        ctx.strokeStyle = f.color;
        ctx.lineWidth = 9;
        boltPath(f.ax, f.ay, f.bx, f.by, 26);
        ctx.stroke();
        ctx.globalAlpha = a;
        ctx.strokeStyle = "#f4eeff";
        ctx.lineWidth = 2.5;
        boltPath(f.ax, f.ay, f.bx, f.by, 18);
        ctx.stroke();
        ctx.globalCompositeOperation = "source-over";
      } else if (kind === "blast") {
        const index = Math.min(3, Math.floor((1 - a) * 4));
        ctx.globalAlpha = index === 3 ? a * 4 : 1;
        sprCenter("fx/blast-" + (index + 1), f.x, f.y, f.r * 2.5);
      } else if (kind === "sprite") {
        ctx.globalAlpha = Math.min(1, a * 2);
        sprCenter(f.name, f.x, f.y, f.size * (1.25 - a * 0.4));
      } else if (kind === "ring") {
        const p = 1 - a;
        const r = f.r0 + (f.r1 - f.r0) * (1 - Math.pow(1 - p, 3));
        ctx.globalAlpha = a;
        ctx.strokeStyle = f.color;
        ctx.lineWidth = f.width * a + 1;
        ctx.beginPath();
        ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
        ctx.stroke();
      } else if (kind === "flash") {
        const r = f.r * (0.6 + 0.4 * (1 - a));
        const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
        g.addColorStop(0, rgba("#ffffff", 0.9 * a));
        g.addColorStop(0.35, rgba(f.color, 0.6 * a));
        g.addColorStop(1, rgba(f.color, 0));
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = 1;
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = "source-over";
      } else if (kind === "rays") {
        drawRays(f.x, f.y, f.r * (0.7 + 0.3 * (1 - a)), f.color, a * 0.6, f.spin + (f.life - f.t) * 1.4);
      } else if (kind === "shard") {
        f.vy += 700 * dt;
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        f.rot += f.vr * dt;
        ctx.globalAlpha = Math.min(1, a * 2);
        ctx.save();
        ctx.translate(f.x, f.y);
        ctx.rotate(f.rot);
        ctx.fillStyle = "#d8f6ff";
        ctx.strokeStyle = "#3a7fa6";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, -f.size);
        ctx.lineTo(f.size * 0.6, f.size * 0.7);
        ctx.lineTo(-f.size * 0.6, f.size * 0.5);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      } else if (kind === "ember") {
        f.y += f.vy * dt;
        f.x += Math.sin((f.life - f.t) * 9 + f.seed) * 24 * dt;
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = a;
        ctx.fillStyle = f.color;
        ctx.beginPath();
        ctx.arc(f.x, f.y, 1.5 + 2.5 * a, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = "source-over";
      } else if (kind === "corpse") {
        f.vy += 900 * dt;
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        f.rot += f.vr * dt;
        ctx.globalAlpha = Math.min(1, a * 1.6);
        ctx.save();
        ctx.translate(f.x, f.y);
        ctx.rotate(f.rot);
        ctx.scale((f.left ? -1 : 1) * (1 + (1 - a) * 0.25), 0.4 + a * 0.6);
        spr(f.name, -f.size / 2, -f.size * 0.6, f.size, f.size);
        ctx.restore();
        // 타 버린 적은 검게, 언 적은 푸르게 덮는다.
        if (f.tint === "oil" || f.tint === "burn" || f.tint === "ice") {
          ctx.globalAlpha = Math.min(1, a * 1.6) * 0.5;
          ctx.fillStyle = f.tint === "ice" ? "#bff0ff" : "#2a1a12";
          ctx.beginPath();
          ctx.arc(f.x, f.y - f.size * 0.15, f.size * 0.36, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    numbersOnScreen = pops;
    fx = fx.filter((f) => f.t > 0);
    if (fx.length > FX_MAX) fx = fx.slice(fx.length - FX_MAX);
  }

  // 가운데에서 뻗는 빛살. 궁합 완성·덩치 처치·완전체 탑 뒤에 쓴다.
  function drawRays(x, y, r, color, alpha, spin) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(spin);
    ctx.globalCompositeOperation = "lighter";
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, rgba(color, alpha));
    g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g;
    const count = 12;
    for (let i = 0; i < count; i++) {
      const a0 = (i / count) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, r, a0, a0 + Math.PI / count / 1.6);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function easeOutBack(x) {
    const c = 1.70158;
    return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2);
  }

  // 궁합 이름 카드. 한 번에 하나씩, 띠가 옆으로 펼쳐지며 이름이 튀어나온다.
  function drawCards(dt) {
    for (const c of cards) {
      if (c === cards[0]) c.t -= dt;
    }
    cards = cards.filter((c) => c.t > 0);
    const c = cards[0];
    if (!c) return;
    const full = c.kind === "full";
    const age = c.life - c.t;
    const open = easeOutBack(Math.min(1, age / 0.28));
    const alpha = Math.min(1, c.t / 0.35);
    const y = 300;
    const h = full ? 186 : 150;
    ctx.save();
    ctx.globalAlpha = alpha;
    drawRays(W / 2, y, full ? 300 : 220, c.color, 0.42, age * 0.8);
    ctx.save();
    ctx.translate(W / 2, y);
    ctx.scale(Math.max(0.01, open), 1);
    ctx.fillStyle = "rgba(14,18,28,.9)";
    ctx.fillRect(-W / 2, -h / 2, W, h);
    const edge = ctx.createLinearGradient(-W / 2, 0, W / 2, 0);
    edge.addColorStop(0, rgba(c.color, 0));
    edge.addColorStop(0.5, rgba(c.color, 1));
    edge.addColorStop(1, rgba(c.color, 0));
    ctx.fillStyle = edge;
    ctx.fillRect(-W / 2, -h / 2, W, 5);
    ctx.fillRect(-W / 2, h / 2 - 5, W, 5);
    ctx.restore();
    const pop = easeOutBack(Math.min(1, Math.max(0, age - 0.1) / 0.3));
    const tag = full ? (c.first ? "완전체 첫 완성!" : "완전체!") : c.first ? "새 궁합 발견!" : "궁합 완성";
    outlinedText(tag, W / 2, y - h / 2 + 30, 19, c.first ? "#ffffff" : rgba(c.color, 1));
    const gap = 62;
    c.ids.forEach((id, i) => {
      const x = W / 2 + (i - (c.ids.length - 1) / 2) * gap;
      drawScrap(id, x, y - h / 2 + 68 - (full ? 0 : 4), 20);
      if (i > 0) outlinedText("+", x - gap / 2, y - h / 2 + 78, 22, "#ffd166");
    });
    ctx.save();
    ctx.translate(W / 2, y + (full ? 52 : 40));
    ctx.scale(pop, pop);
    outlinedText(c.name, 0, 0, full ? 50 : 42, c.color);
    ctx.restore();
    ctx.font = "16px " + FONT;
    outlinedText(c.info, W / 2, y + h / 2 - 16, 16, "#eef2f7");
    ctx.restore();
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
      const st = Sim.towerStats(tower);
      const label = st.full ? "완전체 " + st.full : st.names.join(" · ");
      title(inspected + 1 + "번 탑" + (label ? " · " + label : ""), 872);
      ctx.textAlign = "right";
      ctx.fillStyle = "#b9c7d6";
      ctx.font = "15px " + FONT;
      ctx.fillText("처치 " + tower.kills, 530, 897);
      ctx.textAlign = "left";
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
    centerText(endMessage(), 330, 30, "#b5501c");
    const builds = Sim.buildSummary(finalState);
    const active = finalState.towers.filter((t) => t.active);
    builds.forEach((parts, i) => {
      const names = parts.map((id) => Sim.SCRAPS[id].name).join(" + ") || "맨탑";
      centerText(i + 1 + "번 탑 (" + active[i].kills + "마리): " + names, 364 + i * 22, 16, "#2a3346");
    });
    // 가장 많이 깎은 탑에 궁합이 있으면 그 몫을 자랑한다.
    const total = active.reduce((sum, t) => sum + t.dealt, 0);
    const top = active.reduce((best, t) => (!best || t.dealt > best.dealt ? t : best), null);
    const topStats = top && Sim.towerStats(top);
    if (total > 0 && topStats && topStats.names.length) {
      const label = topStats.full ? "완전체 " + topStats.full : topStats.names.join(" · ");
      centerText(label + " 탑이 피해의 " + Math.round((top.dealt / total) * 100) + "%", 434, 17, "#b5501c");
    }
    if (missed) {
      const result = missed.survived
        ? "이 조합이면 그 웨이브를 막았다"
        : "이 조합이면 " + Math.max(0, missed.gainSec) + "초 더 버텼다";
      centerText(result, 458, 19, "#2a3346");
      addButton(110, 472, 320, 58, "이 조합 노리고 다시", chooseTarget, { fill: "#e0782a", size: 25 });
      addButton(110, 542, 320, 46, "그냥 다시", choosePlain, { fill: "#5a6b82", size: 20 });
    } else {
      // 탐색은 본 고물 두 개를 한 탑에 붙이는 경우만 본다. 그 범위에서 못 찾았다는 뜻이다.
      if (finalState.over === "lose") centerText("확인한 조합 중에는 더 나은 것이 없었다", 458, 18, "#2a3346");
      addButton(110, 472, 320, 58, "다시", choosePlain, { fill: "#e0782a", size: 25 });
    }
    addButton(110, 600, 155, 44, "골라서 다시", () => openPicker("end"), { fill: "#3d7a5a", size: 19 });
    addButton(275, 600, 155, 44, "기록 내보내기", exportRecord, { fill: "#8a94a6", size: 17 });
    if (runFinds.length) centerText("새로 발견: " + runFinds.join(" · "), 670, 16, "#b5501c");
    const best = collection.wins ? "승리 " + collection.wins + "번" : "최고 " + collection.bestWave + "웨이브";
    outlinedText(collectionLine() + " · " + best, W / 2, 812, 17, "#ffe9b0");
    outlinedText(exportNote || "플레이 기록은 이 기기에만 저장됩니다", W / 2, 767, 15, "#e9dcc0");
  }

  function drawSearching() {
    clearButtons();
    dim(0.55);
    centerText(endMessage(), 420, 34, "#ffd166");
    const share = search.total ? Math.round((search.done / search.total) * 100) : 0;
    centerText("놓친 조합을 찾는 중 " + share + "%", 470, 20, "#efe6d6");
  }

  // 고물 도감: 12종의 칸과 효과, 궁합 18가지와 완전체 4가지. 열려 있는 동안 게임은 멈춘다.
  function openCodex() {
    held = null;
    selected = null;
    inspected = null;
    codex = { tab: "barrel", page: 0 };
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
      addButton(20 + i * 127, 96, 119, 58, label, () => Object.assign(codex, { tab: key, page: 0 }), {
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

  // 궁합 쪽은 세 장이다: 궁합 1~9, 궁합 10~18, 완전체 4가지.
  const CODEX_PAGES = [SYNERGY_LIST.slice(0, 9), SYNERGY_LIST.slice(9), FULL_LIST];

  function drawCodexSynergies(state) {
    const page = codex.page || 0;
    const entries = CODEX_PAGES[page];
    const isFull = page === 2;
    ctx.textAlign = "left";
    ctx.fillStyle = "#cdd6e2";
    ctx.font = "18px " + FONT;
    const intro = isFull
      ? "세 칸이 서로 모두 궁합이면 완전체가 된다. 궁합 셋이 한꺼번에 돌고 공격력이 25% 더 오른다."
      : "칸이 다른 두 고물이 한 탑에 붙으면 궁합이 생긴다. 바닥 고물에 별이 붙으면 지금 붙였을 때 궁합이 완성된다는 뜻이다.";
    const end = wrapText(intro, 24, 196, 492, 25);
    ctx.fillStyle = "#ffd166";
    ctx.font = "17px " + FONT;
    ctx.fillText(collectionLine(), 24, end + 30);
    const active = new Set(
      state.towers.filter((t) => t.active).flatMap((t) => {
        const st = Sim.towerStats(t);
        return st.full ? [...st.names, st.full] : st.names;
      }),
    );
    let y = end + 74;
    for (const entry of entries) {
      const color = SYNERGY_COLOR[entry.name];
      const iconGap = isFull ? 56 : 68;
      entry.ids.forEach((id, i) => {
        drawScrap(id, 46 + i * iconGap, y, isFull ? 18 : 20);
        if (i > 0) outlinedText("+", 46 + i * iconGap - iconGap / 2, y + 9, 22, "#ffd166");
      });
      const textX = isFull ? 200 : 150;
      ctx.textAlign = "left";
      ctx.fillStyle = color;
      ctx.font = "22px " + FONT;
      ctx.fillText(entry.name, textX, y - 4);
      ctx.fillStyle = "#e9eef5";
      ctx.font = "16px " + FONT;
      wrapText(isFull ? Sim.FULL_INFO[entry.name] : Sim.SYNERGY_INFO[entry.name], textX, y + 20, 518 - textX, 20);
      const blocked = entry.ids.some((id) => state.melted.includes(id));
      const status = active.has(entry.name) ? ["가동 중", "#7ddf64"] : blocked ? ["녹여서 불가", "#ff8a7a"] : found(entry) ? ["발견", "#9fd8ff"] : ["미발견", "#6f7d8e"];
      ctx.textAlign = "right";
      ctx.fillStyle = status[1];
      ctx.font = "16px " + FONT;
      ctx.fillText(status[0], 518, y - 4);
      y += isFull ? 96 : 62;
    }
    const pageNames = ["궁합 1", "궁합 2", "완전체"];
    pageNames.forEach((label, i) => {
      const on = i === page;
      addButton(20 + i * 170, 880, 160, 56, label, () => (codex.page = i), {
        size: 21,
        fill: on ? "#ffd166" : "#2b3a4e",
        color: on ? INK : "#cdd6e2",
      });
    });
  }

  // 노릴 조합 고르기: 고른 조합의 고물이 더 자주 떨어진다. 시작 화면과 결과 화면에서 연다.
  function openPicker(from) {
    picker = { from };
  }

  function pickTarget(entry) {
    const from = picker.from;
    telemetry.log("choice", { run: runIndex, choice: from === "title" ? "title_pick" : "pick", target: entry.ids, name: entry.name });
    picker = null;
    mode = "play";
    startRun(entry.ids);
  }

  function drawPicker() {
    clearButtons();
    ctx.fillStyle = "#16202e";
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = "left";
    ctx.fillStyle = "#ffd166";
    ctx.font = "30px " + FONT;
    ctx.fillText("노릴 조합 고르기", 22, 54);
    ctx.fillStyle = "#cdd6e2";
    ctx.font = "16px " + FONT;
    ctx.fillText("고른 조합의 고물이 더 자주 떨어진다 · " + collectionLine(), 22, 88);
    addButton(398, 18, 122, 58, "닫기", () => (picker = null), { size: 23 });
    const cell = (entry, x, y, w) => {
      const color = SYNERGY_COLOR[entry.name];
      const seen = found(entry);
      pushButton(x, y, w, 60, () => pickTarget(entry));
      ctx.fillStyle = seen ? "#23344a" : "#1b2636";
      roundRect(x, y, w, 60, 12);
      ctx.fill();
      ctx.strokeStyle = seen ? color : "#33445a";
      ctx.lineWidth = 2;
      ctx.stroke();
      entry.ids.forEach((id, i) => drawScrap(id, x + 24 + i * 32, y + 30, 13));
      const textX = x + 24 + entry.ids.length * 32 - 4;
      ctx.textAlign = "left";
      ctx.fillStyle = seen ? color : "#cdd6e2";
      ctx.font = "19px " + FONT;
      ctx.fillText(entry.name, textX, y + 37);
      if (!seen) {
        ctx.textAlign = "right";
        ctx.fillStyle = "#6f7d8e";
        ctx.font = "13px " + FONT;
        ctx.fillText("미발견", x + w - 8, y + 18);
      }
    };
    SYNERGY_LIST.forEach((entry, i) => cell(entry, 18 + (i % 2) * 256, 108 + Math.floor(i / 2) * 68, 248));
    ctx.textAlign = "left";
    ctx.fillStyle = "#ffd166";
    ctx.font = "19px " + FONT;
    ctx.fillText("완전체 (세 칸 모두 궁합)", 22, 744);
    FULL_LIST.forEach((entry, i) => cell(entry, 18 + (i % 2) * 256, 756 + Math.floor(i / 2) * 68, 248));
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
    else {
      addButton(120, 780, 300, 78, "시작", startFromTitle, { fill: "#e0782a", size: 36 });
      addButton(150, 878, 240, 54, "조합 골라서 시작", () => openPicker("title"), { fill: "#3d7a5a", size: 21 });
      if (SYNERGY_LIST.some(found)) outlinedText(collectionLine() + " 발견", W / 2, 760, 18, "#ffe9b0");
    }
  }

  function frame(time) {
    const dt = Math.min(0.05, (time - lastTime) / 1000 || 0);
    lastTime = time;
    frameDt = dt;
    buttons = [];
    setBackdrop(picker || codex ? "codex" : mode === "title" ? "title" : "field");
    if (mode === "title") {
      const titleScale = canvas.width / W;
      ctx.setTransform(titleScale, 0, 0, titleScale, 0, 0);
      drawTitle();
      if (picker) drawPicker();
      requestAnimationFrame(frame);
      return;
    }

    // 궁합 완성·덩치 처치 때 판을 잠깐 멈췄다가 느리게 푼다. 효과는 조금씩 계속 움직인다.
    let simDt = dt;
    let fxDt = dt;
    if (mode === "play" && !paused && !codex && hitstop > 0) {
      hitstop -= dt;
      simDt = 0;
      fxDt = dt * 0.2;
    } else if (mode === "play" && !paused && !codex && slowmo > 0) {
      slowmo -= dt;
      simDt = dt * 0.35;
      fxDt = dt * 0.5;
    }
    if (mode === "play" && !paused && !codex) {
      accumulator += simDt * speed;
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
    drawFx(fxDt);
    drawPreviews(view);
    drawHint(view);
    ctx.restore();
    drawTray(view);
    if (mode === "play" && !codex) drawCards(paused ? 0 : dt);

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
    if (picker) drawPicker();
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
