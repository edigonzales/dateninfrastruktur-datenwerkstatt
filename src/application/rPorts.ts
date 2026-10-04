import type {REngine} from './ports';
export interface ManagedREngine extends REngine {
  readonly epoch: number;
  readonly mutation: number;
}
export interface RLimits {
  timeoutMs: number;
  warningRows: number;
  hardRows: number;
  transferBytes: number;
}
