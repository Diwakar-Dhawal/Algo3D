/** Values that flow through the interpreter. */
export type Val =
  | { t: 'int'; v: number }
  | { t: 'double'; v: number }
  | { t: 'bool'; v: boolean }
  | { t: 'char'; v: string }
  | { t: 'str'; v: string }
  | { t: 'null' }
  | { t: 'ref'; id: number }
  | { t: 'ns'; name: string }
  | { t: 'stream' };

export type HeapObj =
  | { id: number; kind: 'array'; elemType: string; cells: Val[]; dims: number[] }
  | { id: number; kind: 'list'; elemType: string; items: Val[] }
  | { id: number; kind: 'object'; className: string; fields: { name: string; value: Val }[] };

/* ---------- trace shapes consumed by the UI ---------- */

export type TraceVal =
  | { kind: 'prim'; text: string; type: string }
  | { kind: 'ref'; id: number; type: string }
  | { kind: 'null'; type: string }
  | { kind: 'ns'; text: string; type: string };

export type TraceVar = {
  name: string;
  value: TraceVal;
  prev?: TraceVal;
  type: string;
};

export type TraceFrame = {
  id: number;
  method: string;
  owner: string;
  line: number;
  vars: TraceVar[];
  thisRef?: TraceVal;
};

export type TraceObj = {
  id: number;
  kind: 'array' | 'object' | 'list';
  label: string;
  type: string;
  cells: TraceVal[];
  fields?: { name: string; value: TraceVal }[];
};

export type Effect = {
  to: { obj: number; index?: number; field?: string };
  value: TraceVal;
  prev?: TraceVal;
};

export type StepKind = 'stmt' | 'call' | 'return' | 'write' | 'error' | 'end';

export type TraceStep = {
  line: number;
  kind: StepKind;
  note: string;
  stack: TraceFrame[];
  heap: TraceObj[];
  stdout: string;
  effects: Effect[];
};

export type Trace = {
  steps: TraceStep[];
  stdout: string;
  heap: TraceObj[];
  error?: string;
  compileError?: { line: number; message: string };
  entry?: string;
};

export class ParseError extends Error {
  constructor(message: string, public line: number) {
    super(message);
  }
}
