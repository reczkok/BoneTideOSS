import { AUDIO } from '@bonetide/engine/config.ts';
import { SOUND_IDS, SOUNDS, type SoundDef, type SoundId } from '@bonetide/engine/audio/manifest.ts';
import type { MusicTrack, PlayOpts, Sfx, SfxLoop } from '@bonetide/engine/audio/contract.ts';

export type { MusicTrack, PlayOpts, Sfx, SfxLoop };
const MUSIC_SLUG: Record<MusicTrack, SoundId> = {
  menu: 'music_menu',
  battle: 'music_battle',
  boss: 'music_boss',
};

const EXTS = ['ogg', 'mp3', 'm4a', 'wav'];

type LoadState = 'idle' | 'loading' | 'ready' | 'absent';

interface Slot {
  state: LoadState;
  buffers: AudioBuffer[];
  lastAt: number;
  lastVariant: number;
  active: number;
}

interface LiveLoop {
  id: SoundId;
  src: AudioBufferSourceNode;
  gain: GainNode;
  pan: StereoPannerNode | null;
}

interface LiveMusic {
  track: MusicTrack;
  src: AudioBufferSourceNode;
  gain: GainNode;
  startedAt: number;
  stem: { src: AudioBufferSourceNode; gain: GainNode } | null;
}

export function createAudioEngine() {
  const ctx = new AudioContext();

  const master = ctx.createGain();
  master.connect(ctx.destination);
  const musicBus = ctx.createGain();
  musicBus.connect(master);
  const uiBus = ctx.createGain();
  uiBus.connect(master);
  const worldDuck = ctx.createGain();
  worldDuck.connect(master);
  const worldBus = ctx.createGain();
  worldBus.connect(worldDuck);
  const busOf: Record<string, GainNode> = { music: musicBus, ui: uiBus, world: worldBus };

  let masterLevel = 1;
  let hidden = false;
  const applyMaster = () => {
    master.gain.setTargetAtTime(hidden ? 0 : masterLevel, ctx.currentTime, 0.05);
  };

  const unlock = () => {
    if (ctx.state !== 'running') void ctx.resume();
    if (ctx.state === 'running') {
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
    }
  };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
  document.addEventListener('visibilitychange', () => {
    hidden = document.visibilityState === 'hidden';
    applyMaster();
  });

  const AUDIO_BASE = `${import.meta.env.BASE_URL}audio/`;
  const slots = new Map<SoundId, Slot>();
  const slot = (id: SoundId): Slot => {
    let s = slots.get(id);
    if (!s) {
      s = { state: 'idle', buffers: [], lastAt: -100, lastVariant: -1, active: 0 };
      slots.set(id, s);
    }
    return s;
  };

  let index: Set<string> | null = null;
  let indexPromise: Promise<void> | null = null;
  const loadIndex = () =>
    (indexPromise ??= fetch(`${AUDIO_BASE}index.json`)
      .then(async (res) => {
        if (!res.ok) return;
        index = new Set((await res.json()) as string[]);
      })
      .catch(() => {}));

  async function fetchVariant(name: string): Promise<AudioBuffer | null> {
    for (const ext of EXTS) {
      if (index && !index.has(`${name}.${ext}`)) continue;
      try {
        const res = await fetch(`${AUDIO_BASE}${name}.${ext}`);
        if (!res.ok) continue;
        if ((res.headers.get('content-type') ?? '').includes('text/html')) continue;
        return await ctx.decodeAudioData(await res.arrayBuffer());
      } catch {}
    }
    return null;
  }

  let missing: string[] = [];
  let missingTimer = 0;
  function reportMissing(id: SoundId) {
    missing.push(id);
    clearTimeout(missingTimer);
    missingTimer = window.setTimeout(() => {
      console.info(`[audio] no asset for ${missing.length} sound(s): ${missing.join(', ')}`);
      missing = [];
    }, 1500);
  }

  async function load(id: SoundId): Promise<void> {
    const s = slot(id);
    if (s.state !== 'idle') return;
    s.state = 'loading';
    await loadIndex();
    const def: SoundDef = SOUNDS[id];
    const n = def.variants ?? 1;
    const names = n === 1 ? [id as string] : Array.from({ length: n }, (_, i) => `${id}_${i + 1}`);
    const loaded = (await Promise.all(names.map(fetchVariant))).filter(
      (b): b is AudioBuffer => b !== null,
    );
    if (loaded.length === 0) {
      s.state = 'absent';
      reportMissing(id);
      return;
    }
    s.buffers = loaded;
    s.state = 'ready';
    syncMusic();
  }

  function preloadAll() {
    const queue = [...SOUND_IDS];
    const next = async (): Promise<void> => {
      const id = queue.shift();
      if (!id) return;
      await load(id);
      return next();
    };
    for (let lane = 0; lane < 4; lane++) void next();
  }

  let listenerX = 0;
  let listenerZ = 0;
  const canPan = typeof ctx.createStereoPanner === 'function';

  const spatialScratch = { att: 1, pan: 0 };
  function spatial(x: number, z: number): { att: number; pan: number } | null {
    const dx = x - listenerX;
    const dz = z - listenerZ;
    const d2 = dx * dx + dz * dz;
    if (d2 > AUDIO.maxDistance * AUDIO.maxDistance) return null;
    const ref2 = AUDIO.refDistance * AUDIO.refDistance;
    spatialScratch.att = ref2 / (ref2 + d2);
    spatialScratch.pan = Math.max(-AUDIO.panMax, Math.min(AUDIO.panMax, dx / AUDIO.panScale));
    return spatialScratch;
  }

  function play(id: SoundId, opts?: PlayOpts) {
    const def: SoundDef = SOUNDS[id];
    const s = slot(id);
    if (s.state === 'idle') void load(id);
    if (s.state !== 'ready' || ctx.state !== 'running') return;

    const now = ctx.currentTime;
    if (now - s.lastAt < (def.minInterval ?? 0)) return;
    if (s.active >= (def.maxConcurrent ?? 6)) return;

    let att = 1;
    let pan = 0;
    if (opts?.x !== undefined && opts.z !== undefined) {
      const sp = spatial(opts.x, opts.z);
      if (!sp) return;
      att = sp.att;
      pan = sp.pan;
    }

    let v = 0;
    if (s.buffers.length > 1) {
      v = Math.floor(Math.random() * (s.buffers.length - 1));
      if (v >= s.lastVariant) v++;
    }
    s.lastVariant = v;
    s.lastAt = now;

    const src = ctx.createBufferSource();
    src.buffer = s.buffers[v];
    const jitter = def.jitter ?? 0.04;
    src.playbackRate.value = (opts?.rate ?? 1) * (1 + jitter * (Math.random() * 2 - 1));
    const g = ctx.createGain();
    g.gain.value = (def.gain ?? 1) * (opts?.gain ?? 1) * att;
    src.connect(g);
    let tail: AudioNode = g;
    if (pan !== 0 && canPan) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      tail = p;
    }
    tail.connect(busOf[def.bus ?? 'world']);
    s.active++;
    src.addEventListener(
      'ended',
      () => {
        s.active--;
        tail.disconnect();
      },
      { once: true },
    );
    src.start();
  }

  const loops = new Map<string, LiveLoop>();

  function stopLoop(key: string, fade = AUDIO.loopFade) {
    const live = loops.get(key);
    if (!live) return;
    loops.delete(key);
    const now = ctx.currentTime;
    live.gain.gain.setTargetAtTime(0, now, fade / 3);
    live.src.stop(now + fade + 0.1);
    live.src.addEventListener('ended', () => live.gain.disconnect(), { once: true });
  }

  function loop(key: string, id: SoundId | null, opts?: PlayOpts) {
    if (id === null) {
      stopLoop(key);
      return;
    }
    const def: SoundDef = SOUNDS[id];
    const s = slot(id);
    if (s.state === 'idle') void load(id);
    if (s.state !== 'ready') return;

    let att = 1;
    let pan = 0;
    if (opts?.x !== undefined && opts.z !== undefined) {
      const sp = spatial(opts.x, opts.z);
      att = sp?.att ?? 0;
      pan = sp?.pan ?? 0;
    }
    const target = (def.gain ?? 1) * (opts?.gain ?? 1) * att;
    const rate = opts?.rate ?? 1;

    let live = loops.get(key);
    if (live && live.id !== id) {
      stopLoop(key);
      live = undefined;
    }
    const now = ctx.currentTime;
    if (!live) {
      const src = ctx.createBufferSource();
      src.buffer = s.buffers[0];
      src.loop = true;
      src.playbackRate.value = rate;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(g);
      let tail: AudioNode = g;
      let p: StereoPannerNode | null = null;
      if (canPan) {
        p = ctx.createStereoPanner();
        p.pan.value = pan;
        g.connect(p);
        tail = p;
      }
      tail.connect(busOf[def.bus ?? 'world']);
      src.start();
      live = { id, src, gain: g, pan: p };
      loops.set(key, live);
    }
    live.gain.gain.setTargetAtTime(target, now, 0.09);
    live.src.playbackRate.setTargetAtTime(rate, now, 0.09);
    live.pan?.pan.setTargetAtTime(pan, now, 0.09);
  }

  function stopAllLoops() {
    for (const key of loops.keys()) stopLoop(key);
  }

  let desired: MusicTrack | null = null;
  let current: LiveMusic | null = null;
  let intensity = 0;

  function stopMusic(fade: number) {
    if (!current) return;
    const now = ctx.currentTime;
    const dying = current;
    current = null;
    dying.gain.gain.setTargetAtTime(0, now, fade / 3);
    dying.src.stop(now + fade + 0.2);
    dying.src.addEventListener('ended', () => dying.gain.disconnect(), { once: true });
    if (dying.stem) {
      dying.stem.gain.gain.setTargetAtTime(0, now, fade / 3);
      dying.stem.src.stop(now + fade + 0.2);
    }
  }

  function syncMusic() {
    if (current?.track === desired) {
      attachStem();
      return;
    }
    if (desired === null) {
      stopMusic(AUDIO.musicStopFade);
      return;
    }
    const def: SoundDef = SOUNDS[MUSIC_SLUG[desired]];
    const s = slot(MUSIC_SLUG[desired]);
    if (s.state === 'idle') void load(MUSIC_SLUG[desired]);
    if (s.state !== 'ready') return;
    stopMusic(AUDIO.musicFade);

    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = s.buffers[0];
    src.loop = true;
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setTargetAtTime(def.gain ?? 1, now, AUDIO.musicFade / 3);
    src.connect(g);
    g.connect(musicBus);
    src.start();
    current = { track: desired, src, gain: g, startedAt: now, stem: null };
    attachStem();
  }

  function attachStem() {
    if (!current || current.track !== 'battle' || current.stem) return;
    const s = slot('music_battle_intensity');
    if (s.state === 'idle') void load('music_battle_intensity');
    if (s.state !== 'ready') return;
    const buf = s.buffers[0];
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(g);
    g.connect(musicBus);
    src.start(ctx.currentTime, (ctx.currentTime - current.startedAt) % buf.duration);
    current.stem = { src, gain: g };
    applyIntensity();
  }

  function applyIntensity() {
    current?.stem?.gain.gain.setTargetAtTime(intensity, ctx.currentTime, 0.8);
  }

  return {
    play: play as Sfx,
    loop: loop as SfxLoop,
    stopAllLoops,
    preloadAll,
    setListener(x: number, z: number) {
      listenerX = x;
      listenerZ = z;
    },
    music(track: MusicTrack | null) {
      if (track === desired) return;
      desired = track;
      syncMusic();
    },
    musicIntensity(v: number) {
      const next = Math.max(0, Math.min(1, v));
      if (Math.abs(next - intensity) < 0.02) return;
      intensity = next;
      applyIntensity();
    },
    setWorldDuck(level: number) {
      worldDuck.gain.setTargetAtTime(level, ctx.currentTime, AUDIO.duckFade / 3);
    },
    setVolumes(masterVol: number, musicVol: number, sfxVol: number) {
      masterLevel = masterVol * masterVol;
      applyMaster();
      musicBus.gain.setTargetAtTime(musicVol * musicVol, ctx.currentTime, 0.05);
      worldBus.gain.setTargetAtTime(sfxVol * sfxVol, ctx.currentTime, 0.05);
      uiBus.gain.setTargetAtTime(sfxVol * sfxVol, ctx.currentTime, 0.05);
    },
  };
}

export type AudioEngine = ReturnType<typeof createAudioEngine>;
