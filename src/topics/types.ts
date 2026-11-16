import type { FC } from 'react';

/** Visual state a block can be in; drives its colour. */
export type Mark =
  | 'idle'
  | 'compare'
  | 'swap'
  | 'sorted'
  | 'found'
  | 'active'
  | 'visited'
  | 'frontier'
  | 'path'
  | 'inserted'
  | 'removed';

export type Selected = { title: string; meta: [string, string][] };

export type Step<S = any> = {
  /** Human-readable explanation of what just happened. */
  note: string;
  /** 1-based line in the Java source to highlight. */
  line: number;
  state: S;
};

export type Program<S = any> = {
  java: string;
  steps: Step<S>[];
  startAt?: 'first' | 'last';
};

export type ControlsProps = {
  params: any;
  setParams: (next: any) => void;
};

export type TopicModule = {
  id: string;
  label: string;
  tag: string;
  blurb: string;
  camera: [number, number, number];
  defaults: any;
  build: (params: any) => Program;
  Controls: FC<ControlsProps>;
  View: FC<{ state: any; onInspect: (selected: Selected) => void; animMs?: number }>;
};
