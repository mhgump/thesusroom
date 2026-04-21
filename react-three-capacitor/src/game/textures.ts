import * as THREE from 'three';

export function createGreyTexture(shade: number, size = 256): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const v = Math.round(Math.max(0, Math.min(1, shade)) * 255);
  ctx.fillStyle = `rgb(${v},${v},${v})`;
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = 'rgba(0,0,0,0.07)';
  ctx.lineWidth = 1;
  const step = size / 8;
  for (let i = 0; i <= 8; i++) {
    const p = i * step + 0.5;
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(size, p); ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export const Textures = {
  ground: () => {
    const t = createGreyTexture(0.3);
    t.repeat.set(5, 3);
    return t;
  },
  wallInner: () => {
    const t = createGreyTexture(0.55);
    t.repeat.set(4, 1);
    return t;
  },
  wallOuter: () => {
    const t = createGreyTexture(0.45);
    t.repeat.set(4, 1);
    return t;
  },
  wallTop: () => createGreyTexture(0.6, 128),
  player: () => createGreyTexture(0.75, 128),
  barrierSide: () => createGreyTexture(0.35),
  barrierTop: () => createGreyTexture(0.75),

  // Fallback floor: dark grey base with visible light-grey grid.
  // Caller must set texture.repeat based on room size.
  fallbackGround: (): THREE.CanvasTexture => {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'rgb(40,40,40)';
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = 'rgba(160,160,160,0.4)';
    ctx.lineWidth = 1;
    const step = 256 / 8;
    for (let i = 0; i <= 8; i++) {
      const p = i * step + 0.5;
      ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, 256); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(256, p); ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  },

  // Fallback outside-wall: black with white vertical stripes.
  // Caller must set texture.repeat based on scene extent.
  fallbackOutsideWall: (): THREE.CanvasTexture => {
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    for (let i = 0; i < 128; i += 16) {
      ctx.fillRect(i, 0, 8, 128);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  },
};
