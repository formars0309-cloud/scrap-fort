// 난수, 기록, 소리. 게임 규칙(sim.js)과 화면(game.js)이 함께 쓴다. 일반 script와 node require 양쪽에서 읽힌다.
(function (root) {
  // 상태 객체의 rng 필드만으로 이어지는 난수. 같은 시드면 같은 수열이 나온다.
  function next(state) {
    state.rng = (state.rng + 0x6d2b79f5) | 0;
    let t = Math.imul(state.rng ^ (state.rng >>> 15), 1 | state.rng);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function randomId() {
    const bytes = new Uint8Array(8);
    if (root.crypto && root.crypto.getRandomValues) root.crypto.getRandomValues(bytes);
    else for (let i = 0; i < 8; i++) bytes[i] = Math.floor(Math.random() * 256);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  // 플레이 기록은 기본적으로 이 기기의 브라우저에만 남는다.
  // 수집 주소는 공개 시험을 결정한 뒤 TELEMETRY_URL에 넣는다.
  const TELEMETRY_URL = "";
  const MAX_EVENTS = 5000;

  function createTelemetry(game, version) {
    const key = "proto:" + game;
    let store = null;
    try {
      store = JSON.parse(root.localStorage.getItem(key));
    } catch {
      store = null;
    }
    if (!store || !Array.isArray(store.events)) {
      store = { visitor: randomId(), game, version, events: [] };
    }
    const session = randomId();
    // 예전 기록에 번호가 없으면 지금 개수에서 이어 센다.
    if (typeof store.seq !== "number") store.seq = store.events.length;

    function save() {
      try {
        root.localStorage.setItem(key, JSON.stringify(store));
      } catch {
        // 저장이 막힌 브라우저에서는 메모리에만 남긴다.
      }
    }

    function log(type, data) {
      // n은 이 기기에서 매긴 사건 번호, v는 사건을 남긴 실행본이다. 누적 내보내기를 합칠 때 중복을 가려낸다.
      store.seq += 1;
      const event = Object.assign({ at: Date.now(), n: store.seq, v: version, session, type }, data);
      store.events.push(event);
      if (store.events.length > MAX_EVENTS) store.events.splice(0, store.events.length - MAX_EVENTS);
      save();
      if (TELEMETRY_URL && root.navigator && root.navigator.sendBeacon) {
        root.navigator.sendBeacon(
          TELEMETRY_URL,
          JSON.stringify({ visitor: store.visitor, game, version, event }),
        );
      }
    }

    // claude.ai 링크에서는 페이지가 직접 내려받을 수 없어 뷰어의 저장 확인창을 거친다.
    // 그 밖(파일로 열기, 일반 호스팅)에서는 바로 내려받는다.
    const viewerDownloads =
      root.claude && typeof root.claude.use === "function"
        ? root.claude.use("downloads").catch(() => null)
        : null;

    function downloadDirect() {
      const blob = new Blob([JSON.stringify(store)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = game + "-" + store.visitor + ".json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    // 결과: "saved"(저장됨), "declined"(취소), "unavailable"(저장 불가)
    async function exportFile() {
      if (!viewerDownloads) {
        downloadDirect();
        return "saved";
      }
      const downloads = await viewerDownloads;
      if (!downloads) return "unavailable";
      try {
        await downloads.save({
          filename: game + "-" + store.visitor + ".json",
          data: JSON.stringify(store),
        });
        return "saved";
      } catch (error) {
        return error && error.code === "declined" ? "declined" : "unavailable";
      }
    }

    return { log, exportFile, data: store };
  }

  // 소리. 녹음된 효과음·배경음악(samples)을 쓰고, 아직 못 읽은 소리는 beep으로 대신한다.
  // samples: { base: "audio/", ext: "m4a", sfx: ["attach", ...], bgm: ["battle", ...] }
  function createSfx(samples) {
    let audio = null;
    let master = null;
    let musicGain = null;
    let muted = false;
    const buffers = {};
    const lastPlayed = {};
    let musicName = null;
    let musicNode = null;
    try {
      muted = root.localStorage.getItem("proto:muted") === "1";
    } catch {
      muted = false;
    }

    function load(name, url) {
      root
        .fetch(url)
        .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error("소리 파일 없음"))))
        .then((data) => audio.decodeAudioData(data))
        .then((buffer) => {
          buffers[name] = buffer;
          if (name === musicName) startMusic();
        })
        .catch(() => {
          // 파일로 직접 연 경우 등 읽기가 막히면 beep으로 남는다.
        });
    }

    function unlock() {
      if (audio) {
        resume();
        return;
      }
      const Context = root.AudioContext || root.webkitAudioContext;
      if (!Context) return;
      audio = new Context();
      master = audio.createGain();
      master.gain.value = muted ? 0 : 1;
      master.connect(audio.destination);
      musicGain = audio.createGain();
      musicGain.gain.value = 0.32;
      musicGain.connect(master);
      resume();
      if (samples && root.fetch) {
        const ext = "." + (samples.ext || "m4a");
        for (const name of samples.sfx || []) load(name, samples.base + "sfx/" + name + ext);
        for (const name of samples.bgm || []) load("bgm:" + name, samples.base + "bgm/" + name + ext);
      }
    }

    // 화면을 떠났다 돌아오면 브라우저가 소리를 멈춰 둔다(iOS는 "interrupted"). 다시 깨운다.
    function resume() {
      if (audio && audio.state !== "running") audio.resume().catch(() => {});
    }

    // 화면이 가려지면 소리를 멈춘다.
    function suspend() {
      if (audio && audio.state === "running") audio.suspend().catch(() => {});
    }

    function beep(freq, duration, type, volume, slide) {
      if (!audio || muted) return;
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      const now = audio.currentTime;
      osc.type = type || "square";
      osc.frequency.setValueAtTime(freq, now);
      if (slide) osc.frequency.exponentialRampToValueAtTime(slide, now + duration);
      gain.gain.setValueAtTime(volume || 0.05, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      osc.connect(gain).connect(master);
      osc.start(now);
      osc.stop(now + duration);
    }

    // 녹음 효과음을 튼다. gap(초) 안에 같은 소리를 또 부르면 건너뛴다. 틀었으면 true.
    function play(name, options) {
      if (!audio || muted) return false;
      const buffer = buffers[name];
      if (!buffer) return false;
      const opts = options || {};
      const now = audio.currentTime;
      if (opts.gap && lastPlayed[name] !== undefined && now - lastPlayed[name] < opts.gap) return true;
      lastPlayed[name] = now;
      const source = audio.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = opts.rate || 1;
      const gain = audio.createGain();
      gain.gain.value = opts.volume === undefined ? 0.6 : opts.volume;
      source.connect(gain).connect(master);
      source.start();
      return true;
    }

    function startMusic() {
      if (!audio || !musicName) return;
      const buffer = buffers[musicName];
      if (!buffer) return;
      if (musicNode && musicNode.name === musicName) return;
      stopMusic();
      const source = audio.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const gain = audio.createGain();
      gain.gain.setValueAtTime(0.0001, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(1, audio.currentTime + 0.8);
      source.connect(gain).connect(musicGain);
      source.start();
      musicNode = { name: musicName, source, gain };
    }

    function stopMusic() {
      if (!musicNode) return;
      const old = musicNode;
      musicNode = null;
      old.gain.gain.setValueAtTime(old.gain.gain.value, audio.currentTime);
      old.gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.6);
      old.source.stop(audio.currentTime + 0.65);
    }

    // 배경음악을 바꾼다. 같은 곡이면 그대로 둔다. null이면 끈다.
    function music(name) {
      const wanted = name ? "bgm:" + name : null;
      if (wanted === musicName) return;
      musicName = wanted;
      if (!audio) return;
      if (!wanted) stopMusic();
      else startMusic();
    }

    function toggle() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 1;
      try {
        root.localStorage.setItem("proto:muted", muted ? "1" : "0");
      } catch {
        // 저장이 막혀도 이번 세션에는 적용된다.
      }
      return muted;
    }

    return { unlock, resume, suspend, beep, play, music, toggle, isMuted: () => muted };
  }

  const api = { next, createTelemetry, createSfx };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Proto = api;
})(typeof self !== "undefined" ? self : globalThis);
