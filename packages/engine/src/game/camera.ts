import type { d, TgpuUniform } from 'typegpu';
import type { CanvasLike } from '../core/canvas.ts';
import { mat4 } from 'wgpu-matrix';
import { CAMERA } from '../config.ts';
import type { CameraData } from '../core/schemas.ts';
import { lerp, saturate } from '../core/mathx.ts';

export function createCamera(
  canvas: CanvasLike,
  cameraUniform: Pick<TgpuUniform<typeof CameraData>, 'write'>,
) {
  const viewM = new Float32Array(16);
  const projM = new Float32Array(16);
  const viewProj = new Float32Array(16);
  const invViewProj = new Float32Array(16);
  const eye = new Float32Array(3);
  const target = new Float32Array(3);
  const up = new Float32Array([0, 1, 0]);
  const nearP = new Float32Array(4);
  const farP = new Float32Array(4);
  const camPos = new Float32Array(3);
  const camRight = new Float32Array(3);
  const camUp = new Float32Array(3);
  const groundScratch = { x: 0, z: 0 };
  const zRangeScratch = { minZ: -Infinity, maxZ: Infinity };

  let shakeAmp = 0;
  let zoom = 1;

  const cameraScratch: d.InferInput<typeof CameraData> = {
    viewProj,
    invViewProj,
    camPos,
    time: 0,
    camRight,
    camUp,
  };

  function transformPoint(nx: number, ny: number, nz: number, out: Float32Array) {
    const m = invViewProj;
    const w = m[3] * nx + m[7] * ny + m[11] * nz + m[15];
    out[0] = (m[0] * nx + m[4] * ny + m[8] * nz + m[12]) / w;
    out[1] = (m[1] * nx + m[5] * ny + m[9] * nz + m[13]) / w;
    out[2] = (m[2] * nx + m[6] * ny + m[10] * nz + m[14]) / w;
  }

  return {
    shake(amp: number) {
      shakeAmp = Math.max(shakeAmp, amp);
    },
    setZoom(z: number) {
      zoom = Math.min(CAMERA.zoomMax, Math.max(CAMERA.zoomMin, z));
    },
    update(dt: number, focusX: number, focusZ: number, time: number) {
      shakeAmp = Math.max(0, shakeAmp - 2.2 * dt * (0.3 + shakeAmp));
      const shakeX = (Math.random() - 0.5) * shakeAmp;
      const shakeZ = (Math.random() - 0.5) * shakeAmp;
      eye[0] = focusX + CAMERA.offset[0] * zoom + shakeX;
      eye[1] = CAMERA.offset[1] * zoom + (Math.random() - 0.5) * shakeAmp * 0.5;
      eye[2] = focusZ + CAMERA.offset[2] * zoom + shakeZ;
      target[0] = focusX + shakeX;
      target[1] = 0.8;
      target[2] = focusZ + shakeZ;
      mat4.lookAt(eye, target, up, viewM);
      const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
      mat4.perspective((CAMERA.fovDeg * Math.PI) / 180, aspect, CAMERA.near, CAMERA.far, projM);
      mat4.multiply(projM, viewM, viewProj);
      mat4.invert(viewProj, invViewProj);
      const c = cameraScratch;
      camPos[0] = eye[0];
      camPos[1] = eye[1];
      camPos[2] = eye[2];
      c.time = time;
      camRight[0] = viewM[0];
      camRight[1] = viewM[4];
      camRight[2] = viewM[8];
      camUp[0] = viewM[1];
      camUp[1] = viewM[5];
      camUp[2] = viewM[9];
      cameraUniform.write(c);
    },
    groundPoint(mouseX: number, mouseY: number): { x: number; z: number } {
      const nx = (mouseX / canvas.clientWidth) * 2 - 1;
      const ny = -((mouseY / canvas.clientHeight) * 2 - 1);
      transformPoint(nx, ny, 0, nearP);
      transformPoint(nx, ny, 1, farP);
      const dy = farP[1] - nearP[1];
      const t = Math.abs(dy) > 1e-6 ? -nearP[1] / dy : 0;
      groundScratch.x = lerp(nearP[0], farP[0], t);
      groundScratch.z = lerp(nearP[2], farP[2], t);
      return groundScratch;
    },
    viewGroundZRange(): { minZ: number; maxZ: number } {
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (let c = 0; c < 4; c++) {
        const nx = c % 2 === 0 ? -1 : 1;
        const ny = c < 2 ? -1 : 1;
        transformPoint(nx, ny, 0, nearP);
        transformPoint(nx, ny, 1, farP);
        const dy = farP[1] - nearP[1];
        const t = Math.abs(dy) > 1e-6 ? saturate(-nearP[1] / dy) : 0;
        const z = lerp(nearP[2], farP[2], t);
        minZ = Math.min(minZ, z);
        maxZ = Math.max(maxZ, z);
      }
      zRangeScratch.minZ = minZ;
      zRangeScratch.maxZ = maxZ;
      return zRangeScratch;
    },
  };
}

export type Camera = ReturnType<typeof createCamera>;
