import { runJava } from '../jvm/interp';
import { SAMPLES as JAVA_SAMPLES } from '../jvm/samples';
import type { Trace } from '../jvm/types';
import { cppToJava } from './cpp';
import { applyInputs } from './inputs';
import { jsToJava } from './js';
import { atLine } from './out';
import { pythonToJava } from './python';
import { CPP_SAMPLES, JS_SAMPLES, PY_SAMPLES } from './samples';
import { TranslateError, type Lang, type LangId, type Translated } from './types';

const TRANSLATORS: Partial<Record<LangId, (source: string) => Translated>> = {
  python: pythonToJava,
  cpp: cppToJava,
  js: jsToJava,
};

export const LANGS: Lang[] = [
  {
    id: 'java',
    label: 'Java',
    file: 'Solution.java',
    subset: 'arrays, Lists, Maps, Sets, lambdas, streams, your own classes',
    defaultSample: 'bubble',
    samples: JAVA_SAMPLES.map((sample) => ({ id: sample.id, label: sample.label, code: sample.code })),
  },
  {
    id: 'python',
    label: 'Python',
    file: 'solution.py',
    subset: 'def functions, lists, for range(...), print() — no classes, dicts or imports',
    defaultSample: PY_SAMPLES[0].id,
    samples: PY_SAMPLES,
  },
  {
    id: 'js',
    label: 'JavaScript',
    file: 'solution.js',
    subset: 'function, arrays, push/pop, for/while, console.log — no classes, objects or arrow functions',
    defaultSample: JS_SAMPLES[0].id,
    samples: JS_SAMPLES,
  },
  {
    id: 'cpp',
    label: 'C++',
    file: 'solution.cpp',
    subset: 'functions, structs, vector<int>, cout — no templates, iterators or STL containers',
    defaultSample: CPP_SAMPLES[0].id,
    samples: CPP_SAMPLES,
  },
];

export function langById(id: LangId): Lang {
  return LANGS.find((lang) => lang.id === id) ?? LANGS[0];
}

export function sampleCode(lang: LangId, sampleId: string): string {
  const def = langById(lang);
  const sample = def.samples.find((item) => item.id === sampleId) ?? def.samples[0];
  return sample.code;
}

function remap(trace: Trace, map: number[]): Trace {
  return {
    ...trace,
    steps: trace.steps.map((step) => ({
      ...step,
      line: atLine(map, step.line),
      stack: step.stack.map((frame) => ({ ...frame, line: atLine(map, frame.line) })),
    })),
    compileError: trace.compileError
      ? { line: atLine(map, trace.compileError.line), message: trace.compileError.message }
      : undefined,
  };
}

/** Runs any supported language through the same tracing engine. */
export function runIn(language: LangId, source: string, inputs = ''): Trace {
  const applied = inputs.trim() ? applyInputs(language, source, inputs) : null;
  if (applied?.error) return { steps: [], stdout: '', heap: [], compileError: applied.error };

  const program = applied ? applied.code : source;
  const inputMap = applied ? applied.map : null;

  if (language === 'java') {
    const trace = runJava(program);
    return inputMap ? remap(trace, inputMap) : trace;
  }

  const translate = TRANSLATORS[language];
  if (!translate) return runJava(program);

  let translated: Translated;
  try {
    translated = translate(program);
  } catch (error) {
    if (error instanceof TranslateError) {
      return { steps: [], stdout: '', heap: [], compileError: { line: error.line, message: error.message } };
    }
    return { steps: [], stdout: '', heap: [], error: (error as Error).message };
  }

  const trace = runJava(translated.code);
  const map = inputMap ? translated.map.map((line) => atLine(inputMap, line)) : translated.map;
  return remap(trace, map);
}
