export type GameMode = 'landing' | 'takeoff';
export type Screen = 'title' | 'playing' | 'paused' | 'goaround' | 'result';

export interface FlowState {
  screen: Screen;
  mode: GameMode;
  code: string;
  attempt: number;
  goArounds: number;
}

export type FlowEvent =
  | { type: 'start'; mode: GameMode; code: string }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'goAround' }
  | { type: 'goAroundDone' }
  | { type: 'finish' }
  | { type: 'retry' }
  | { type: 'newConditions'; code: string }
  | { type: 'title' };

export const initialFlow = (): FlowState => ({ screen: 'title', mode: 'landing', code: '', attempt: 0, goArounds: 0 });

/** Pure game-flow transitions. Invalid events leave the state unchanged. */
export const flowReduce = (s: FlowState, e: FlowEvent): FlowState => {
  switch (e.type) {
    case 'start':
      return { screen: 'playing', mode: e.mode, code: e.code, attempt: s.attempt + 1, goArounds: 0 };
    case 'pause':
      return s.screen === 'playing' ? { ...s, screen: 'paused' } : s;
    case 'resume':
      return s.screen === 'paused' ? { ...s, screen: 'playing' } : s;
    case 'goAround':
      return s.screen === 'playing' && s.mode === 'landing' ? { ...s, screen: 'goaround' } : s;
    case 'goAroundDone':
      return s.screen === 'goaround' ? { ...s, screen: 'playing', goArounds: s.goArounds + 1 } : s;
    case 'finish':
      return s.screen === 'playing' ? { ...s, screen: 'result' } : s;
    case 'retry':
      return s.screen === 'title' ? s : { ...s, screen: 'playing', attempt: s.attempt + 1, goArounds: 0 };
    case 'newConditions':
      return s.screen === 'title' ? s : { ...s, screen: 'playing', code: e.code, attempt: s.attempt + 1, goArounds: 0 };
    case 'title':
      return { ...s, screen: 'title' };
  }
};
