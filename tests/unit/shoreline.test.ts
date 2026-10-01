import { describe, expect, it } from 'vitest';
import { Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';
import { SHORE_SAMPLES, measureShoreline } from '../../src/render/airfieldView';

const SEA = -2.49;

describe('measured shoreline', () => {
  it('returns one smoothed radius per island angle', () => {
    const tex = measureShoreline([], SEA);
    expect(tex.image.width).toBe(SHORE_SAMPLES);
  });

  it('clamps to the inner limit when no land is above the sea', () => {
    const data = measureShoreline([], SEA).image.data as Float32Array;
    expect(Math.min(...data)).toBeCloseTo(0.96, 5);
    expect(Math.max(...data)).toBeCloseTo(0.96, 5);
  });

  it('clamps to the outer limit when land covers the whole search band', () => {
    const plane = new PlaneGeometry(4000, 4000);
    plane.rotateX(-Math.PI / 2);
    const land = new Mesh(plane, new MeshBasicMaterial());
    land.position.y = 1;
    const data = measureShoreline([land], SEA).image.data as Float32Array;
    expect(Math.min(...data)).toBeCloseTo(1.05, 5);
  });

  it('ignores land that sits below the sea', () => {
    const plane = new PlaneGeometry(4000, 4000);
    plane.rotateX(-Math.PI / 2);
    const land = new Mesh(plane, new MeshBasicMaterial());
    land.position.y = SEA - 1;
    const data = measureShoreline([land], SEA).image.data as Float32Array;
    expect(Math.max(...data)).toBeCloseTo(0.96, 5);
  });
});
