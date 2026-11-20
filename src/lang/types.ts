export type LangId = 'java' | 'python' | 'cpp' | 'js';

/** One line of a translated program: which source line it came from. */
export type Translated = { code: string; map: number[] };

export class TranslateError extends Error {
  constructor(message: string, public line: number) {
    super(message);
  }
}

export type LangSample = {
  id: string;
  label: string;
  code: string;
  /** text to preload into the standard-input box when this sample is picked */
  stdin?: string;
};

export type Lang = {
  id: LangId;
  label: string;
  file: string;
  /** what the translator accepts — shown as a hint under the editor */
  subset: string;
  samples: LangSample[];
  defaultSample: string;
};
