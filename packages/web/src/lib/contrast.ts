import { colord, extend, type Colord } from 'colord';
import lch from 'colord/plugins/lch';
import a11y from 'colord/plugins/a11y';

extend([lch, a11y]);

export interface ContrastResult {
  accent: string;
  textColor: string;
  ratio: number;
  meetsAA: boolean;
  adjusted: boolean;
}

const WCAG_AA_NORMAL = 4.5;

function pickPolarity(
  accent: Colord,
  textLight: string,
  textDark: string,
): { textColor: string; ratio: number } {
  const ratioLight = accent.contrast(textLight);
  const ratioDark = accent.contrast(textDark);
  return ratioLight >= ratioDark
    ? { textColor: textLight, ratio: ratioLight }
    : { textColor: textDark, ratio: ratioDark };
}

export function resolveAccent(
  accentHex: string,
  textLight = '#ffffff',
  textDark = '#0a0a0a',
): ContrastResult {
  const accent = colord(accentHex);
  const best = pickPolarity(accent, textLight, textDark);
  if (best.ratio >= WCAG_AA_NORMAL) {
    return {
      accent: accent.toHex(),
      textColor: best.textColor,
      ratio: best.ratio,
      meetsAA: true,
      adjusted: false,
    };
  }
  for (const delta of [0.1, -0.1, 0.2, -0.2]) {
    const lchVal = accent.toLch();
    const adjusted = colord({
      l: Math.max(0, Math.min(100, lchVal.l + delta * 100)),
      c: lchVal.c,
      h: lchVal.h,
    });
    const result = pickPolarity(adjusted, textLight, textDark);
    if (result.ratio >= WCAG_AA_NORMAL) {
      return {
        accent: adjusted.toHex(),
        textColor: result.textColor,
        ratio: result.ratio,
        meetsAA: true,
        adjusted: true,
      };
    }
  }
  return {
    accent: accent.toHex(),
    textColor: best.textColor,
    ratio: best.ratio,
    meetsAA: false,
    adjusted: false,
  };
}
