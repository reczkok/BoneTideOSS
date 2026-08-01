export interface BakedRenderQuality {
  shadowSize: 1024 | 2048 | 4096;
  msaa: 1 | 4;
}

export interface LiveRenderOptions {
  fxaa: boolean;
  rays: boolean;
}

export function bakedRenderQuality(value: BakedRenderQuality): BakedRenderQuality {
  return { shadowSize: value.shadowSize, msaa: value.msaa };
}

export function liveRenderOptions(value: LiveRenderOptions): LiveRenderOptions {
  return { fxaa: value.fxaa, rays: value.rays };
}
