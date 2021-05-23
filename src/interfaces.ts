import type { Processor } from 'windicss/lib';
import type { ResolvedVariants } from 'windicss/types/interfaces';

export type DictStr = { [key: string]: string | string[] };

export type DeepNestDictStr = { [key:string]: string | DeepNestDictStr };

export interface Core {
  processor?: Processor,
  utilities: string[],
  variants: ResolvedVariants,
  colors: {
    label: string;
    documentation: string;
  }[],
  dynamics: {
    label: string;
    position: number;
  }[];
}


export interface Attr {
  static: {
    [key:string]: string[]
  },
  color: {
    [key:string]: {
      label: string
      doc: string
    }[]
  },
  dynamic: {
    [key:string]: {
      label: string
      pos: number
    }[]
  }
}

export interface Completion {
  static: string[],
  color: {
    label: string
    doc: string
  }[],
  dynamic: {
    label: string
    pos: number
  }[]
  attr: Attr
}
