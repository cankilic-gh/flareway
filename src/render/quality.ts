export type QualityId = 'low' | 'normal' | 'high';

export interface QualityPreset {
  id: QualityId;
  label: string;
  maxPixelRatio: number;
  shadowMapSize: number;
  msaaSamples: number;
  bloom: boolean;
  ao: boolean;
  /** Fraction of generated trees that are placed. */
  treeDensity: number;
  nearTreeDistance: number;
  farTreeDistance: number;
  grassTufts: number;
  /** Use the procedural low-detail aircraft deliberately. */
  fallbackAircraft: boolean;
}

export const QUALITY: Record<QualityId, QualityPreset> = {
  low: {
    id: 'low',
    label: 'Low',
    maxPixelRatio: 1,
    shadowMapSize: 1024,
    msaaSamples: 0,
    bloom: false,
    ao: false,
    treeDensity: 0.45,
    nearTreeDistance: 220,
    farTreeDistance: 3500,
    grassTufts: 0,
    fallbackAircraft: false,
  },
  normal: {
    id: 'normal',
    label: 'Normal',
    maxPixelRatio: 1.5,
    shadowMapSize: 2048,
    msaaSamples: 4,
    bloom: true,
    ao: false,
    treeDensity: 1,
    nearTreeDistance: 380,
    farTreeDistance: 6500,
    grassTufts: 9000,
    fallbackAircraft: false,
  },
  high: {
    id: 'high',
    label: 'High',
    maxPixelRatio: 2,
    shadowMapSize: 4096,
    msaaSamples: 4,
    bloom: true,
    ao: true,
    treeDensity: 1,
    nearTreeDistance: 600,
    farTreeDistance: 9000,
    grassTufts: 16000,
    fallbackAircraft: false,
  },
};
