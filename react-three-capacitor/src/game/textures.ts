import * as THREE from 'three';

export function createGreyTexture(shade: number, size = 256): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const v = Math.round(Math.max(0, Math.min(1, shade)) * 255);
  ctx.fillStyle = `rgb(${v},${v},${v})`;
  ctx.fillRect(0, 0, size, size);

  // Subtle grid lines
  ctx.strokeStyle = 'rgba(0,0,0,0.07)';
  ctx.lineWidth = 1;
  const step = size / 8;
  for (let i = 0; i <= 8; i++) {
    const p = i * step + 0.5;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// Pre-built defaults for each surface type
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
};
