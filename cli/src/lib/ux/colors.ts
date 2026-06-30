const LIME = "\u001B[38;2;198;244;50m";
const RED = "\u001B[38;2;220;38;38m";
const BOLD = "\u001B[1m";
const DIM = "\u001B[2m";
const RESET = "\u001B[0m";

export interface Colors {
  bold: (text: string) => string;
  dim: (text: string) => string;
  lime: (text: string) => string;
  red: (text: string) => string;
}

export function createColors(isTTY: boolean | undefined): Colors {
  const on = isTTY === true && !process.env.NO_COLOR;
  return {
    bold: (t) => (on ? `${BOLD}${t}${RESET}` : t),
    dim: (t) => (on ? `${DIM}${t}${RESET}` : t),
    lime: (t) => (on ? `${LIME}${t}${RESET}` : t),
    red: (t) => (on ? `${RED}${t}${RESET}` : t),
  };
}

export const stdoutColors: Colors = createColors(process.stdout.isTTY);
