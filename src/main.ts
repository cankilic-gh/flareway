import './ui/styles.css';
import { World } from './render/world';
import { App } from './app';
import { loadSettings } from './input/settings';
import type { QualityId } from './render/quality';
import { $ } from './ui/dom';

const boot = async (): Promise<void> => {
  const params = new URLSearchParams(window.location.search);
  const testMode = params.get('test') === '1';
  const qParam = params.get('quality');
  const quality: QualityId = qParam === 'low' || qParam === 'normal' || qParam === 'high' ? qParam : loadSettings().quality;
  const canvas = $<HTMLCanvasElement>('scene');
  let world: World;
  try {
    world = await World.create(canvas, quality);
  } catch (err) {
    $('loading').hidden = true;
    $('fatal').hidden = false;
    console.error(err);
    return;
  }
  for (const e of world.loadErrors) console.warn(`[flareway] asset fallback: ${e}`);
  const app = new App(world, testMode);
  if (testMode) {
    const { installTestApi } = await import('./testApi');
    installTestApi(app);
  }
  app.run();
  app.showTitle();
};

void boot();
