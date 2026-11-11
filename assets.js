// 고물 요새의 그림·소리 목록과 그림 좌표. 화면 코드(game.js)가 읽는다.
// 그림은 art/build_assets.py가 art/final의 정본에서 만든 img/*.webp다.
// 탑 좌표는 모두 탑 그림의 768 캔버스 기준이며, 포신 분리 영역은 build_assets.py의 MOUNT_AREA와 짝이다.
(function (root) {
  const SLOTS = ["barrel", "war", "power"];

  const ASSETS = {
    SLOTS,
    TOWER_SCALE: 0.23,
    TOWER_CANVAS: 768,
    TOWER_CENTER: [384, 520],
    // 탑 그림의 중심을 탑 좌표보다 이만큼 아래에 둔다.
    TOWER_DROP: 10,
    // 탑 이름표(궁합 이름, 붙이기 미리보기)를 쓰는 높이.
    TOWER_LABEL_Y: 72,
    // 포신: 통이 도는 축, 포구, 조준각을 얼마나 따라가는지. 파이프는 박격포라 살짝만 기운다.
    BARREL: {
      pipe: { pivot: [540, 424], muzzle: [690, 339], turn: 0.15, mountOnTop: true },
      spring: { pivot: [505, 414], muzzle: [695, 414], turn: 1 },
      funnel: { pivot: [538, 416], muzzle: [698, 413], turn: 1 },
      rebar: { pivot: [500, 440], muzzle: [729, 435], turn: 1 },
    },
    // 포신이 없을 때 탄이 나오는 자리.
    BARE_MUZZLE: [384, 400],
    MAX_AIM: (100 * Math.PI) / 180,
    // 받침 위 너트 세 개의 중심. 고물이 꽂히는 자리다.
    SOCKET: { power: [222, 422], war: [385, 355], barrel: [514, 471] },
    // 덧댐 철판을 붙이는 자리.
    PATCH_AT: { power: [215, 430], war: [400, 395], barrel: [560, 500] },
    // 적 그림의 화면 폭.
    ENEMY_SIZE: { rat: 37, can: 55, wasp: 41, brute: 98 },
    // 걷는 적의 보폭(길 위 거리)과 한 걸음에 튀는 높이.
    ENEMY_STEP: { rat: [9, 2], can: [12, 2.5], brute: [17, 3.5] },
    // 길 밖 장식: 그림, x, y, 크기.
    PROPS: [
      ["map/prop-1", 452, 176, 60],
      ["map/prop-2", 150, 388, 62],
      ["map/prop-4", 410, 604, 58],
      ["map/prop-5", 40, 398, 50],
      ["map/prop-6", 500, 724, 56],
      ["map/prop-3", 498, 62, 46],
    ],
    SOUNDS: {
      base: "audio/",
      ext: "m4a",
      sfx: [
        "attach", "blast", "brute", "die", "drop", "fire", "forthit", "ice", "lose",
        "melt", "pick", "pierce", "shoot", "synergy", "tap", "wave", "win", "zap",
      ],
      bgm: ["battle", "workshop"],
    },
    // 게임이 읽는 그림 이름 전부. scraps는 sim.js의 SCRAPS다.
    imageNames(scraps) {
      const ids = Object.keys(scraps);
      const towerParts = ids.flatMap((id) =>
        scraps[id].slot === "barrel" ? ["tower/mount-" + id, "tower/tube-" + id] : ["tower/" + scraps[id].slot + "-" + id],
      );
      return [
        ...ids.map((id) => "scraps/" + id),
        ...towerParts,
        ...SLOTS.map((slot) => "plates/" + slot),
        "tower/base", "tower/patch", "tower/muzzle",
        ...Object.keys(ASSETS.ENEMY_SIZE).flatMap((id) => ["enemies/" + id + "-1", "enemies/" + id + "-2"]),
        "map/ground", "map/fort", "map/gate", "map/path-tile",
        ...ASSETS.PROPS.map((prop) => prop[0]),
        "ui/tray", "ui/panel", "ui/slot-hand", "ui/slot-furnace", "ui/heart", "ui/star",
        "ui/btn-pause", "ui/btn-play", "ui/btn-sound-on", "ui/btn-sound-off", "ui/btn-codex",
        "fx/blast-1", "fx/blast-2", "fx/blast-3", "fx/blast-4", "fx/fire-1", "fx/fire-2",
        "fx/spark", "fx/frost", "fx/smoke", "fx/scrap-pop",
        "key/title",
      ];
    },
  };

  if (typeof module !== "undefined" && module.exports) module.exports = ASSETS;
  else root.ScrapAssets = ASSETS;
})(typeof self !== "undefined" ? self : globalThis);
