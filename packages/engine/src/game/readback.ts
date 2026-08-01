import { d } from 'typegpu';
import { ENEMY_TYPES, MAX_ENEMIES, READBACK } from '../config.ts';
import { ActorSnap, type ActorSnapBuffer, STATE } from '../core/schemas.ts';

export class ActorReadback {
  private free: GPUBuffer[] = [];
  private created = 0;
  private generation = 0;
  readonly data: ArrayBuffer;
  readonly f32: Float32Array;
  readonly u32: Uint32Array;
  hasData = false;

  private device: GPUDevice;
  private src: GPUBuffer;
  private size: number;
  private readonly stride = d.sizeOf(ActorSnap) / 4;
  private readonly stateOffset = d.memoryLayoutOf(ActorSnap, (s) => s.state).offset / 4;
  private readonly nearestScratch = { x: 0, z: 0, d2: 0 };
  private readonly hiSlots = Int32Array.from(ENEMY_TYPES, (et) => et.slotEnd - 1);
  private readonly rangeOffsets = new Int32Array(ENEMY_TYPES.length);
  private readonly rangeBytes = new Int32Array(ENEMY_TYPES.length);
  private rangeCount: number;
  private acc = 0;
  snapshotId = 0;

  constructor(device: GPUDevice, snapBuf: ActorSnapBuffer) {
    this.device = device;
    this.src = snapBuf.buffer;
    this.size = d.sizeOf(ActorSnap) * MAX_ENEMIES;
    this.rangeOffsets[0] = 0;
    this.rangeBytes[0] = this.size;
    this.rangeCount = 1;
    this.data = new ArrayBuffer(this.size);
    this.f32 = new Float32Array(this.data);
    this.u32 = new Uint32Array(this.data);
  }

  invalidate() {
    this.hasData = false;
    this.generation++;
  }

  setOccupiedHi(hiPerType: ArrayLike<number>) {
    const stride = d.sizeOf(ActorSnap);
    let n = 0;
    for (let t = 0; t < this.hiSlots.length; t++) {
      this.hiSlots[t] = hiPerType[t];
      const start = ENEMY_TYPES[t].slotStart * stride;
      const bytes = (hiPerType[t] + 1) * stride - start;
      if (bytes <= 0) continue;
      if (n > 0 && this.rangeOffsets[n - 1] + this.rangeBytes[n - 1] === start) {
        this.rangeBytes[n - 1] += bytes;
      } else {
        this.rangeOffsets[n] = start;
        this.rangeBytes[n] = bytes;
        n++;
      }
    }
    this.rangeCount = n;
  }

  nearestAlive(x: number, z: number, maxR: number): { x: number; z: number; d2: number } | null {
    if (!this.hasData) return null;
    let bestD2 = maxR * maxR;
    let found = false;
    for (let t = 0; t < ENEMY_TYPES.length; t++) {
      const hi = this.hiSlots[t];
      for (let slot = ENEMY_TYPES[t].slotStart; slot <= hi; slot++) {
        const base = slot * this.stride;
        if (this.u32[base + this.stateOffset] !== STATE.ALIVE) continue;
        const dx = this.f32[base] - x;
        const dz = this.f32[base + 1] - z;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestD2) {
          bestD2 = d2;
          this.nearestScratch.x = this.f32[base];
          this.nearestScratch.z = this.f32[base + 1];
          found = true;
        }
      }
    }
    if (!found) return null;
    this.nearestScratch.d2 = bestD2;
    return this.nearestScratch;
  }

  countAliveInArc(
    x: number,
    z: number,
    dirX: number,
    dirZ: number,
    range: number,
    arcCos: number,
  ): number {
    if (!this.hasData) return 0;
    const r2 = range * range;
    let count = 0;
    for (let t = 0; t < ENEMY_TYPES.length; t++) {
      const hi = this.hiSlots[t];
      for (let slot = ENEMY_TYPES[t].slotStart; slot <= hi; slot++) {
        const base = slot * this.stride;
        if (this.u32[base + this.stateOffset] !== STATE.ALIVE) continue;
        const dx = this.f32[base] - x;
        const dz = this.f32[base + 1] - z;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r2 || d2 < 1e-8) continue;
        const inv = 1 / Math.sqrt(d2);
        if ((dx * dirX + dz * dirZ) * inv > arcCos) count++;
      }
    }
    return count;
  }

  private pending: GPUBuffer | null = null;
  private readonly pendingOffsets = new Int32Array(ENEMY_TYPES.length);
  private readonly pendingBytes = new Int32Array(ENEMY_TYPES.length);
  private pendingCount = 0;

  tick(enc: GPUCommandEncoder, dt: number) {
    this.acc += dt;
    if (READBACK.hz > 0 && this.hasData && this.acc < 1 / READBACK.hz) return;
    if (this.pending) return;
    if (this.rangeCount === 0) return;
    let staging = this.free.pop();
    if (!staging) {
      if (this.created >= 3) return;
      staging = this.device.createBuffer({
        size: this.size,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      this.created++;
    }
    this.acc = 0;
    for (let i = 0; i < this.rangeCount; i++) {
      const off = this.rangeOffsets[i];
      const bytes = this.rangeBytes[i];
      enc.copyBufferToBuffer(this.src, off, staging, off, bytes);
      this.pendingOffsets[i] = off;
      this.pendingBytes[i] = bytes;
    }
    this.pendingCount = this.rangeCount;
    this.pending = staging;
  }

  afterSubmit() {
    const buf = this.pending;
    if (!buf) return;
    this.pending = null;
    const count = this.pendingCount;
    const gen = this.generation;
    buf.mapAsync(GPUMapMode.READ).then(
      () => {
        if (gen === this.generation) {
          const mapped = new Uint8Array(buf.getMappedRange());
          const dst = new Uint8Array(this.data);
          for (let i = 0; i < count; i++) {
            const off = this.pendingOffsets[i];
            const bytes = this.pendingBytes[i];
            dst.set(mapped.subarray(off, off + bytes), off);
          }
          this.hasData = true;
          this.snapshotId++;
        }
        buf.unmap();
        this.free.push(buf);
      },
      () => this.free.push(buf),
    );
  }
}
