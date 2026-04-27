const LIME = "\x1b[38;2;198;244;50m";
const RED = "\x1b[38;2;220;38;38m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

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
