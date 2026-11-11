// 고물 요새 시뮬레이션. 화면과 분리되어 있고 같은 시드와 행동이면 같은 결과가 나온다.
// 상태는 JSON으로 복제할 수 있어 패배 재현이 실제 재실행이 된다.
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory(require("../shared/core.js"));
  else root.ScrapSim = factory(root.Proto);
})(typeof self !== "undefined" ? self : globalThis, function (Proto) {
  const next = Proto.next;
  const W = 540;
  const FIELD_H = 800;
  const DT = 1 / 30;
  const MAX_WAVES = 12;
  const WAVE_TICKS = 19 * 30;
  const FORT_HP = 20;
  const MAX_LV = 3;
  const SCRAP_TTL = 11;
  const MAX_FIELD = 7;
  const PICK_R = 36;

  const SCRAPS = {
    pipe: { slot: "barrel", name: "굽은 파이프", desc: "포물선으로 떨어져 터진다", tip: "사거리 넓음 · 범위 피해 · 조금 느림" },
    spring: { slot: "barrel", name: "스프링", desc: "맞은 탄이 다음 적으로 튕긴다", tip: "3번 튕김 · 공격력 조금 낮음" },
    funnel: { slot: "barrel", name: "깔때기", desc: "가까이 세 발을 흩뿌린다", tip: "한 번에 3발 · 사거리 짧음" },
    rebar: { slot: "barrel", name: "철근", desc: "일직선으로 전부 꿰뚫는다", tip: "줄 선 적 전부 관통 · 공격력 높음 · 느림" },
    ice: { slot: "war", name: "얼음팩", desc: "맞은 적이 느려진다", tip: "1.6초 동안 45% 느려짐" },
    battery: { slot: "war", name: "깨진 배터리", desc: "옆의 적까지 감전시킨다", tip: "주변 2마리에 45% 피해" },
    oil: { slot: "war", name: "기름통", desc: "맞은 자리에 불길이 남는다", tip: "2.8초 타는 불길" },
    magnet: { slot: "war", name: "자석", desc: "맞은 적을 뒤로 밀어낸다", tip: "뒤로 밀기 · 덩치는 덜 밀림" },
    clock: { slot: "power", name: "태엽", desc: "쏠수록 빨라진다", tip: "쉬지 않고 쏘면 최대 60% 빨라짐 · 1초 쉬면 처음부터" },
    motor: { slot: "power", name: "고물 모터", desc: "아주 빠르지만 약하다", tip: "연사 2.2배 · 공격력 58%" },
    gas: { slot: "power", name: "가스통", desc: "네 발마다 폭발탄", tip: "네 번째 탄마다 3.5배 폭발" },
    anvil: { slot: "power", name: "쇳덩이", desc: "느리지만 갑옷을 뚫는 한 방", tip: "공격력 3.7배 · 갑옷 무시 · 연사 2.3배 느림" },
  };
  const SCRAP_IDS = Object.keys(SCRAPS);
  const SLOT_NAMES = { barrel: "포신", war: "탄두", power: "동력" };

  const SYNERGIES = {
    "oil+pipe": "화염병",
    "battery+spring": "연쇄번개",
    "magnet+rebar": "자석 꼬챙이",
    "funnel+ice": "눈보라",
    "gas+pipe": "박격포",
    "motor+spring": "핀볼",
    "anvil+rebar": "말뚝",
    "clock+funnel": "팽이",
    "gas+oil": "불기둥",
    "battery+motor": "누전",
  };

  // 궁합이 실제로 바꾸는 값. towerStats와 함께 고친다.
  const SYNERGY_INFO = {
    화염병: "불길이 1.7배 넓게 번진다",
    연쇄번개: "탄이 6번 튕기며 맞을 때마다 감전",
    "자석 꼬챙이": "꿰뚫은 적을 두 배 멀리 밀어낸다",
    눈보라: "느려지는 정도 45% → 70%",
    박격포: "폭발탄 범위가 두 배 넘게 커진다",
    핀볼: "튕기는 횟수 3번 추가",
    말뚝: "한 방 공격력 1.5배",
    팽이: "최대 연사 상승 60% → 78%",
    불기둥: "불길 피해 두 배",
    누전: "감전이 주변 5마리까지 번진다",
  };

  function synergyKey(a, b) {
    return [a, b].sort().join("+");
  }

  function synergyName(a, b) {
    return SYNERGIES[synergyKey(a, b)] || null;
  }

  const ENEMIES = {
    rat: { name: "쥐", hp: 22, speed: 78, armor: 0, r: 9, leak: 1 },
    can: { name: "깡통", hp: 64, speed: 54, armor: 6, r: 13, leak: 2 },
    wasp: { name: "말벌", hp: 15, speed: 138, armor: 0, r: 8, leak: 1 },
    brute: { name: "덩치", hp: 620, speed: 40, armor: 4, r: 24, leak: 8 },
  };

  const PATH = [
    [270, -30],
    [270, 90],
    [80, 90],
    [80, 290],
    [460, 290],
    [460, 490],
    [80, 490],
    [80, 690],
    [270, 690],
    [270, 745],
  ];
  const SEGMENTS = [];
  let PATH_LEN = 0;
  for (let i = 1; i < PATH.length; i++) {
    const [ax, ay] = PATH[i - 1];
    const [bx, by] = PATH[i];
    const len = Math.hypot(bx - ax, by - ay);
    SEGMENTS.push({ ax, ay, bx, by, len, start: PATH_LEN });
    PATH_LEN += len;
  }

  const TOWER_SPOTS = [
    { x: 270, y: 190, unlock: 1 },
    { x: 270, y: 390, unlock: 4 },
    { x: 270, y: 590, unlock: 7 },
  ];

  function posAt(d) {
    const clamped = Math.max(0, Math.min(PATH_LEN, d));
    for (const seg of SEGMENTS) {
      if (clamped <= seg.start + seg.len) {
        const f = (clamped - seg.start) / seg.len;
        return [seg.ax + (seg.bx - seg.ax) * f, seg.ay + (seg.by - seg.ay) * f];
      }
    }
    return [PATH[PATH.length - 1][0], PATH[PATH.length - 1][1]];
  }

  function create(seed, target) {
    const S = {
      rng: seed | 0,
      seed: seed | 0,
      tick: 0,
      wave: 0,
      nextWaveTick: 30,
      fort: FORT_HP,
      over: null,
      nextId: 1,
      kills: 0,
      queue: [],
      enemies: [],
      bullets: [],
      puddles: [],
      field: [],
      hand: null,
      melted: [],
      seen: {},
      target: target || [],
      towers: TOWER_SPOTS.map((spot) => ({
        x: spot.x,
        y: spot.y,
        unlock: spot.unlock,
        active: false,
        parts: { barrel: null, war: null, power: null },
        cd: 0,
        ramp: 0,
        idle: 0,
        shots: 0,
        angle: -Math.PI / 2,
      })),
      events: [],
    };
    return S;
  }

  function clone(S) {
    return JSON.parse(JSON.stringify(S));
  }

  // 탑의 능력치. 붙은 고물이 같으면 결과도 같아서 탑별로 기억해 두고 다시 쓴다.
  // 돌려준 객체는 여러 곳이 함께 쓰므로 고치지 않는다.
  const statsCache = new WeakMap();

  function towerStats(t) {
    const key = partsKey(t.parts);
    const cached = statsCache.get(t);
    if (cached && cached.key === key) return cached.stats;
    const stats = computeStats(t.parts);
    statsCache.set(t, { key, stats });
    return stats;
  }

  function partsKey(parts) {
    return ["barrel", "war", "power"].map((slot) => (parts[slot] ? parts[slot].id + parts[slot].lv : "-")).join("|");
  }

  function computeStats(parts) {
    const barrel = parts.barrel && parts.barrel.id;
    const war = parts.war && parts.war.id;
    const power = parts.power && parts.power.id;
    const s = {
      dmg: 10,
      cd: 0.72,
      range: 165,
      pellets: 1,
      bounces: 0,
      splash: 0,
      lob: false,
      line: false,
      noArmor: false,
      war,
      power,
      slow: 0.45,
      shockTargets: 2,
      puddleR: 36,
      push: 16,
      rampMax: 0.6,
      gasSplash: 46,
      puddleMul: 1,
      names: [],
    };

    if (barrel === "pipe") Object.assign(s, { dmg: 11, cd: 0.9, range: 205, splash: 56, lob: true });
    if (barrel === "spring") Object.assign(s, { dmg: 8.5, bounces: 3 });
    if (barrel === "funnel") Object.assign(s, { dmg: 8, range: 120, pellets: 3 });
    if (barrel === "rebar") Object.assign(s, { dmg: 13, cd: 1.05, line: true });

    if (power === "motor") {
      s.cd *= 0.45;
      s.dmg *= 0.58;
    }
    if (power === "anvil") {
      s.cd *= 2.3;
      s.dmg *= 3.7;
      s.noArmor = true;
    }

    const all = [barrel, war, power].filter(Boolean);
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const name = synergyName(all[i], all[j]);
        if (name) s.names.push(name);
      }
    }
    if (s.names.includes("화염병")) s.puddleR *= 1.7;
    if (s.names.includes("연쇄번개")) s.bounces = 6;
    if (s.names.includes("자석 꼬챙이")) s.push = 34;
    if (s.names.includes("눈보라")) s.slow = 0.7;
    if (s.names.includes("박격포")) s.gasSplash = 110;
    if (s.names.includes("핀볼")) s.bounces += 3;
    if (s.names.includes("말뚝")) s.dmg *= 1.5;
    if (s.names.includes("팽이")) s.rampMax = 0.78;
    if (s.names.includes("누전")) s.shockTargets = 5;
    if (s.names.includes("불기둥")) s.puddleMul = 2;

    const extraLv = Object.values(parts).reduce((sum, p) => sum + (p ? p.lv - 1 : 0), 0);
    s.dmg *= 1 + 0.42 * extraLv;
    return s;
  }

  function hurt(e, amount, noArmor) {
    const armor = noArmor ? 0 : ENEMIES[e.type].armor;
    e.hp -= Math.max(1, amount - armor);
  }

  function applyHit(S, st, towerIndex, e, dmg, hits) {
    hurt(e, dmg, st.noArmor);
    if (st.war === "ice") {
      e.slowT = 1.6;
      e.slow = st.slow;
    } else if (st.war === "battery") {
      const near = S.enemies
        .filter((o) => o !== e && o.hp > 0 && !hits.includes(o.id) && Math.hypot(o.x - e.x, o.y - e.y) < 78)
        .sort((a, b) => Math.hypot(a.x - e.x, a.y - e.y) - Math.hypot(b.x - e.x, b.y - e.y))
        .slice(0, st.shockTargets);
      for (const o of near) {
        hurt(o, dmg * 0.45, st.noArmor);
        S.events.push({ type: "arc", ax: e.x, ay: e.y, bx: o.x, by: o.y });
      }
    } else if (st.war === "oil") {
      S.puddles.push({ x: e.x, y: e.y, r: st.puddleR, t: 2.8, dps: (7 + dmg * 0.65) * st.puddleMul, tower: towerIndex });
      if (S.puddles.length > 14) S.puddles.shift();
    } else if (st.war === "magnet") {
      const resist = e.type === "brute" ? 0.2 : 1;
      e.d = Math.max(0, e.d - st.push * resist);
    }
  }

  function splash(S, st, towerIndex, x, y, radius, dmg) {
    S.events.push({ type: "blast", x, y, r: radius });
    for (const e of S.enemies) {
      if (e.hp <= 0 || Math.hypot(e.x - x, e.y - y) > radius + ENEMIES[e.type].r) continue;
      applyHit(S, st, towerIndex, e, dmg, []);
    }
  }

  function fire(S, t, towerIndex, st, target) {
    t.shots += 1;
    let dmg = st.dmg;
    let burst = false;
    if (st.power === "gas" && t.shots % 4 === 0) {
      dmg *= 3.5;
      burst = true;
    }
    S.events.push({ type: "shot", tower: towerIndex, burst });
    const speed = ENEMIES[target.type].speed;
    const dist = Math.hypot(target.x - t.x, target.y - t.y);
    const [lx, ly] = posAt(target.d + speed * (dist / 520));
    t.angle = Math.atan2(ly - t.y, lx - t.x);

    if (st.line) {
      const len = st.range * 1.45;
      const dx = Math.cos(t.angle);
      const dy = Math.sin(t.angle);
      S.events.push({ type: "beam", ax: t.x, ay: t.y, bx: t.x + dx * len, by: t.y + dy * len, burst });
      const hits = [];
      for (const e of S.enemies) {
        if (e.hp <= 0) continue;
        const rx = e.x - t.x;
        const ry = e.y - t.y;
        const along = rx * dx + ry * dy;
        const across = Math.abs(rx * dy - ry * dx);
        if (along >= 0 && along <= len && across <= ENEMIES[e.type].r + 9) hits.push(e);
      }
      const ids = hits.map((e) => e.id);
      for (const e of hits) applyHit(S, st, towerIndex, e, dmg, ids);
      if (burst) splash(S, st, towerIndex, t.x + dx * len * 0.6, t.y + dy * len * 0.6, st.gasSplash, dmg * 0.5);
      return;
    }

    if (st.lob) {
      const landing = Math.hypot(lx - t.x, ly - t.y) / 430;
      S.bullets.push({
        kind: "lob",
        tower: towerIndex,
        sx: t.x,
        sy: t.y,
        x: t.x,
        y: t.y,
        tx: lx,
        ty: ly,
        t: 0,
        dur: Math.max(0.15, landing),
        dmg,
        burst,
        st,
      });
      return;
    }

    const count = st.pellets;
    for (let i = 0; i < count; i++) {
      const offset = count === 1 ? 0 : (i - (count - 1) / 2) * 0.32;
      const angle = t.angle + offset;
      S.bullets.push({
        kind: "shot",
        tower: towerIndex,
        x: t.x,
        y: t.y,
        vx: Math.cos(angle) * 520,
        vy: Math.sin(angle) * 520,
        life: (st.range * 1.15) / 520,
        dmg,
        burst,
        bounces: st.bounces,
        hits: [],
        st,
      });
    }
  }

  function updateTowers(S) {
    S.towers.forEach((t, index) => {
      if (!t.active) return;
      t.cd -= DT;
      const st = towerStats(t);
      let best = null;
      for (const e of S.enemies) {
        if (e.hp <= 0 || e.d < 0) continue;
        if (Math.hypot(e.x - t.x, e.y - t.y) > st.range) continue;
        if (!best || e.d > best.d) best = e;
      }
      if (!best) {
        t.idle += DT;
        if (t.idle > 1) t.ramp = 0;
        return;
      }
      t.idle = 0;
      if (t.cd > 0) return;
      fire(S, t, index, st, best);
      let cd = st.cd;
      if (st.power === "clock") {
        t.ramp = Math.min(st.rampMax, t.ramp + 0.06);
        cd *= 1 - t.ramp;
      }
      t.cd = cd;
    });
  }

  function updateBullets(S) {
    const keep = [];
    for (const b of S.bullets) {
      // 날아가는 동안 탑의 고물을 바꿔도 이미 쏜 탄의 효과는 쏜 때 그대로다.
      const st = b.st;
      if (b.kind === "lob") {
        b.t += DT;
        const f = Math.min(1, b.t / b.dur);
        b.x = b.sx + (b.tx - b.sx) * f;
        b.y = b.sy + (b.ty - b.sy) * f;
        if (f < 1) {
          keep.push(b);
          continue;
        }
        const radius = b.burst ? st.gasSplash : st.splash || 40;
        splash(S, st, b.tower, b.x, b.y, radius, b.dmg);
        continue;
      }

      b.life -= DT;
      let alive = b.life > 0;
      for (let sub = 0; sub < 2 && alive; sub++) {
        b.x += (b.vx * DT) / 2;
        b.y += (b.vy * DT) / 2;
        const hit = S.enemies.find(
          (e) => e.hp > 0 && !b.hits.includes(e.id) && Math.hypot(e.x - b.x, e.y - b.y) <= ENEMIES[e.type].r + 5,
        );
        if (!hit) continue;
        b.hits.push(hit.id);
        applyHit(S, st, b.tower, hit, b.dmg, b.hits);
        if (b.burst) splash(S, st, b.tower, hit.x, hit.y, st.gasSplash, b.dmg * 0.5);
        if (b.bounces > 0) {
          let nextTarget = null;
          let nearest = Infinity;
          for (const e of S.enemies) {
            if (e.hp <= 0 || b.hits.includes(e.id)) continue;
            const d = Math.hypot(e.x - hit.x, e.y - hit.y);
            if (d < 135 && d < nearest) {
              nearest = d;
              nextTarget = e;
            }
          }
          if (nextTarget) {
            b.bounces -= 1;
            b.dmg *= 0.88;
            b.burst = false;
            b.x = hit.x;
            b.y = hit.y;
            const a = Math.atan2(nextTarget.y - b.y, nextTarget.x - b.x);
            b.vx = Math.cos(a) * 520;
            b.vy = Math.sin(a) * 520;
            b.life = Math.max(b.life, 0.45);
            continue;
          }
        }
        alive = false;
      }
      if (alive && b.x > -30 && b.x < W + 30 && b.y > -30 && b.y < FIELD_H + 30) keep.push(b);
    }
    S.bullets = keep;
  }

  function updatePuddles(S) {
    for (const p of S.puddles) {
      p.t -= DT;
      for (const e of S.enemies) {
        if (e.hp <= 0) continue;
        if (Math.hypot(e.x - p.x, e.y - p.y) <= p.r + ENEMIES[e.type].r) e.hp -= p.dps * DT;
      }
    }
    S.puddles = S.puddles.filter((p) => p.t > 0);
  }

  function rollScrap(S, slot) {
    const pool = SCRAP_IDS.filter((id) => !S.melted.includes(id) && (!slot || SCRAPS[id].slot === slot));
    if (!pool.length) return null;
    const weights = pool.map((id) => (S.target.includes(id) ? 3 : 1));
    let roll = next(S) * weights.reduce((sum, w) => sum + w, 0);
    for (let i = 0; i < pool.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return pool[i];
    }
    return pool[pool.length - 1];
  }

  // 다른 고물이나 탑과 겹치지 않는 가까운 자리를 고른다.
  function freeSpot(S, x, y) {
    const clampX = (v) => Math.max(36, Math.min(W - 36, v));
    const clampY = (v) => Math.max(36, Math.min(FIELD_H - 50, v));
    let px = clampX(x);
    let py = clampY(y);
    for (let i = 0; i < 14; i++) {
      const blocked =
        S.field.some((f) => Math.hypot(f.x - px, f.y - py) < 66) ||
        S.towers.some((t) => Math.hypot(t.x - px, t.y - py) < 76);
      if (!blocked) break;
      const angle = i * 2.4;
      const radius = 40 + i * 12;
      px = clampX(x + Math.cos(angle) * radius);
      py = clampY(y + Math.sin(angle) * radius);
    }
    return [px, py];
  }

  function placeScrap(S, scrap, x, y, ttl) {
    const [px, py] = freeSpot(S, x, y);
    const item = {
      id: S.nextId++,
      scrap,
      x: px,
      y: py,
      ttl: ttl || SCRAP_TTL,
    };
    S.field.push(item);
    S.seen[scrap] = (S.seen[scrap] || 0) + 1;
    S.events.push({ type: "drop", scrap, x: item.x, y: item.y });
    return item;
  }

  const FIRST_DROPS = { 1: "barrel", 3: "war", 6: "power" };

  function maybeDrop(S, e) {
    let slot = FIRST_DROPS[S.kills] || null;
    let drops = slot ? 1 : 0;
    if (e.type === "brute") drops = 2;
    else if (!slot && S.field.length < MAX_FIELD && next(S) < 0.16) drops = 1;
    for (let i = 0; i < drops && S.field.length < MAX_FIELD; i++) {
      const scrap = rollScrap(S, slot);
      if (scrap) placeScrap(S, scrap, e.x + i * 40, e.y);
      slot = null;
    }
  }

  function cleanupDead(S) {
    const living = [];
    for (const e of S.enemies) {
      if (e.hp > 0) {
        living.push(e);
        continue;
      }
      S.kills += 1;
      S.events.push({ type: "kill", enemy: e.type, x: e.x, y: e.y });
      maybeDrop(S, e);
    }
    S.enemies = living;
  }

  function startWave(S) {
    S.wave += 1;
    S.nextWaveTick = S.tick + WAVE_TICKS;
    const w = S.wave;
    for (const t of S.towers) t.active = S.wave >= t.unlock;
    const add = (type, n, start, gap) => {
      for (let i = 0; i < n; i++) S.queue.push({ tick: S.tick + Math.round((start + i * gap) * 30), type, wave: w });
    };
    add("rat", 6 + w, 0, 0.6);
    if (w >= 3) add("can", Math.floor((w - 1) * 0.8), 3, 1.3);
    if (w >= 2 && w % 2 === 0) add("wasp", 2 + w, 6, 0.35);
    if (w % 4 === 0) add("brute", w / 4, 9, 3);
    S.queue.sort((a, b) => a.tick - b.tick);
    S.events.push({ type: "wave", wave: w });
  }

  function spawnQueued(S) {
    while (S.queue.length && S.queue[0].tick <= S.tick) {
      const item = S.queue.shift();
      const def = ENEMIES[item.type];
      const w = item.wave - 1;
      const hp = def.hp * (1 + 0.3 * w + 0.045 * w * w);
      const [x, y] = posAt(0);
      S.enemies.push({ id: S.nextId++, type: item.type, hp, maxHp: hp, d: 0, x, y, slow: 0, slowT: 0 });
    }
  }

  function moveEnemies(S) {
    const leaked = [];
    for (const e of S.enemies) {
      const def = ENEMIES[e.type];
      if (e.slowT > 0) e.slowT -= DT;
      const slow = e.slowT > 0 ? e.slow : 0;
      e.d += def.speed * (1 - slow) * DT;
      [e.x, e.y] = posAt(e.d);
      if (e.d >= PATH_LEN) leaked.push(e);
    }
    if (!leaked.length) return;
    for (const e of leaked) {
      S.fort -= ENEMIES[e.type].leak;
      S.events.push({ type: "leak", enemy: e.type });
    }
    S.enemies = S.enemies.filter((e) => !leaked.includes(e));
  }

  function step(S) {
    if (S.over) return;
    S.tick += 1;
    if (S.tick >= S.nextWaveTick && S.wave < MAX_WAVES) startWave(S);
    spawnQueued(S);
    moveEnemies(S);
    updateTowers(S);
    updateBullets(S);
    updatePuddles(S);
    for (const item of S.field) item.ttl -= DT;
    S.field = S.field.filter((item) => item.ttl > 0);
    cleanupDead(S);

    if (S.fort <= 0) {
      S.over = "lose";
      S.events.push({ type: "over", result: "lose" });
    } else if (S.wave >= MAX_WAVES && !S.queue.length && !S.enemies.length) {
      S.over = "win";
      S.events.push({ type: "over", result: "win" });
    }
  }

  function attachScrap(S, towerIndex, scrap) {
    const t = S.towers[towerIndex];
    if (!t || !t.active) return false;
    const slot = SCRAPS[scrap].slot;
    const current = t.parts[slot];
    if (current && current.id === scrap) {
      if (current.lv >= MAX_LV) return false;
      current.lv += 1;
      S.events.push({ type: "attach", tower: towerIndex, scrap, lv: current.lv });
      return true;
    }
    t.parts[slot] = { id: scrap, lv: 1 };
    if (current) placeScrap(S, current.id, t.x + 46, t.y + 30);
    S.events.push({ type: "attach", tower: towerIndex, scrap, lv: 1, names: towerStats(t).names });
    return true;
  }

  function takeField(S, id) {
    const index = S.field.findIndex((item) => item.id === id);
    if (index < 0) return null;
    return S.field.splice(index, 1)[0];
  }

  function canMelt(S, scrap) {
    const slot = SCRAPS[scrap].slot;
    const left = SCRAP_IDS.filter((id) => SCRAPS[id].slot === slot && !S.melted.includes(id) && id !== scrap);
    return left.length > 0;
  }

  function meltScrap(S, scrap) {
    if (!S.melted.includes(scrap)) S.melted.push(scrap);
    S.fort = Math.min(FORT_HP, S.fort + 1);
    S.events.push({ type: "melt", scrap });
  }

  // 플레이어 행동의 유일한 입구. 성공하면 true를 돌려준다.
  function act(S, action) {
    if (S.over) return false;
    if (action.type === "attach") {
      const item = S.field.find((f) => f.id === action.id);
      if (!item || !attachScrap(S, action.tower, item.scrap)) return false;
      takeField(S, action.id);
      return true;
    }
    if (action.type === "attachHand") {
      if (!S.hand || !attachScrap(S, action.tower, S.hand)) return false;
      S.hand = null;
      return true;
    }
    if (action.type === "hold") {
      const item = S.field.find((f) => f.id === action.id);
      if (!item) return false;
      takeField(S, action.id);
      if (S.hand) placeScrap(S, S.hand, item.x, item.y);
      S.hand = item.scrap;
      S.events.push({ type: "hold", scrap: item.scrap });
      return true;
    }
    if (action.type === "melt") {
      const item = S.field.find((f) => f.id === action.id);
      if (!item || !canMelt(S, item.scrap)) return false;
      takeField(S, action.id);
      meltScrap(S, item.scrap);
      return true;
    }
    if (action.type === "meltHand") {
      if (!S.hand || !canMelt(S, S.hand)) return false;
      const scrap = S.hand;
      S.hand = null;
      meltScrap(S, scrap);
      return true;
    }
    return false;
  }

  function outcome(S, startTick, horizon) {
    while (!S.over && S.tick - startTick < horizon) {
      step(S);
      S.events.length = 0;
    }
    return { survived: S.over !== "lose", ticks: S.tick - startTick, fort: S.fort, kills: S.kills };
  }

  function score(result) {
    return (result.survived ? 1e7 : 0) + result.ticks * 100 + result.fort * 50 + result.kills;
  }

  function applyPair(S, towerIndex, a, b) {
    for (const id of [a, b]) S.towers[towerIndex].parts[SCRAPS[id].slot] = { id, lv: 1 };
  }

  function candidatePairs(snapshot, seen) {
    const ids = Object.keys(seen);
    const list = [];
    snapshot.towers.forEach((t, tower) => {
      if (!t.active) return;
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const a = ids[i];
          const b = ids[j];
          if (SCRAPS[a].slot === SCRAPS[b].slot) continue;
          const slotA = t.parts[SCRAPS[a].slot];
          const slotB = t.parts[SCRAPS[b].slot];
          if (slotA && slotA.id === a && slotB && slotB.id === b) continue;
          list.push({ tower, a, b, synergy: synergyName(a, b) });
        }
      }
    });
    list.sort((x, y) => Number(Boolean(y.synergy)) - Number(Boolean(x.synergy)));
    return list.slice(0, 72);
  }

  // 후보 하나를 평가할 때마다 yield한다. 화면 쪽에서 프레임을 나눠 돌린다.
  function* searchMissed(snapshot, seen, actualTicks) {
    const horizon = Math.round(WAVE_TICKS * 1.5);
    const baseline = outcome(clone(snapshot), snapshot.tick, horizon);
    const candidates = candidatePairs(snapshot, seen);
    let best = null;
    let bestScore = score(baseline);
    for (const c of candidates) {
      const trial = clone(snapshot);
      applyPair(trial, c.tower, c.a, c.b);
      const result = outcome(trial, snapshot.tick, horizon);
      const value = score(result);
      if (value > bestScore) {
        bestScore = value;
        best = Object.assign({}, c, {
          survived: result.survived,
          gainSec: Math.round((result.ticks - actualTicks) / 30),
          horizon,
        });
      }
      yield candidates.length;
    }
    return best;
  }

  function findMissed(snapshot, seen, actualTicks) {
    const search = searchMissed(snapshot, seen, actualTicks);
    let result = search.next();
    while (!result.done) result = search.next();
    return result.value;
  }

  function buildSummary(S) {
    return S.towers.filter((t) => t.active).map((t) => Object.values(t.parts).filter(Boolean).map((p) => p.id));
  }

  return {
    W,
    FIELD_H,
    DT,
    MAX_WAVES,
    WAVE_TICKS,
    FORT_HP,
    MAX_LV,
    PICK_R,
    SCRAPS,
    SCRAP_IDS,
    SLOT_NAMES,
    SYNERGIES,
    SYNERGY_INFO,
    ENEMIES,
    PATH,
    PATH_LEN,
    TOWER_SPOTS,
    posAt,
    create,
    clone,
    step,
    act,
    canMelt,
    towerStats,
    synergyName,
    applyPair,
    searchMissed,
    findMissed,
    buildSummary,
    outcome,
  };
});
