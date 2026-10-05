export type TerminalTextStyle = {
  color?: string;
  backgroundColor?: string;
  fontWeight?: "bold";
  opacity?: number;
  fontStyle?: "italic";
  textDecoration?: string;
};
export type TerminalTextSpan = { text: string; style: TerminalTextStyle };

const ansiColors = [
  "#000000",
  "#cd0000",
  "#00cd00",
  "#cdcd00",
  "#0000ee",
  "#cd00cd",
  "#00cdcd",
  "#e5e5e5",
  "#7f7f7f",
  "#ff0000",
  "#00ff00",
  "#ffff00",
  "#5c5cff",
  "#ff00ff",
  "#00ffff",
  "#ffffff",
];
function indexedColor(value: number): string | undefined {
  if (!Number.isInteger(value) || value < 0 || value > 255) return;
  if (value < 16) return ansiColors[value];
  if (value >= 232) {
    const gray = 8 + (value - 232) * 10;
    return `rgb(${gray}, ${gray}, ${gray})`;
  }
  const index = value - 16;
  const levels = [0, 95, 135, 175, 215, 255];
  return `rgb(${levels[Math.floor(index / 36)]}, ${levels[Math.floor(index / 6) % 6]}, ${levels[index % 6]})`;
}

// Interpret only SGR colors/attributes. No HTML, links, cursor actions or arbitrary CSS.
// Unknown and incomplete terminal control sequences are discarded, including OSC/DCS.
export function terminalTextSpans(line: string): TerminalTextSpan[] {
  const spans: TerminalTextSpan[] = [];
  let style: TerminalTextStyle = {};
  let text = "";
  const flush = () => {
    if (text) spans.push({ text, style: { ...style } });
    text = "";
  };
  const sgr = (parameters: string) => {
    if (!/^[\d;]*$/.test(parameters)) return;
    const codes = parameters.split(";").map(Number);
    for (let n = 0; n < codes.length; n++) {
      const code = codes[n];
      if (code === 0) style = {};
      else if (code === 1) style.fontWeight = "bold";
      else if (code === 2) style.opacity = 0.65;
      else if (code === 3) style.fontStyle = "italic";
      else if (code === 4) style.textDecoration = "underline";
      else if (code === 9) style.textDecoration = "line-through";
      else if (code === 22) {
        delete style.fontWeight;
        delete style.opacity;
      } else if (code === 23) delete style.fontStyle;
      else if (code === 24 || code === 29) delete style.textDecoration;
      else if (code === 39) delete style.color;
      else if (code === 49) delete style.backgroundColor;
      else if (code === 38 || code === 48) {
        const key = code === 38 ? "color" : "backgroundColor";
        const mode = codes[++n];
        if (mode === 5) {
          const color = indexedColor(codes[++n]);
          if (color) style[key] = color;
        } else if (mode === 2) {
          const rgb = codes.slice(n + 1, n + 4);
          n += 3;
          if (rgb.length === 3 && rgb.every((v) => Number.isInteger(v) && v >= 0 && v <= 255))
            style[key] = `rgb(${rgb.join(", ")})`;
        } else break;
      } else if (code >= 30 && code <= 37) style.color = ansiColors[code - 30];
      else if (code >= 90 && code <= 97) style.color = ansiColors[code - 90 + 8];
      else if (code >= 40 && code <= 47) style.backgroundColor = ansiColors[code - 40];
      else if (code >= 100 && code <= 107) style.backgroundColor = ansiColors[code - 100 + 8];
    }
  };

  for (let i = 0; i < line.length; ) {
    const char = line[i++];
    let control = char;
    if (char === "\x1b") control = line[i++] ?? "";
    if ((char === "\x1b" && control === "[") || char === "\x9b") {
      flush();
      const start = i;
      while (i < line.length && !/[@-~]/.test(line[i])) i++;
      if (line[i] === "m") sgr(line.slice(start, i));
      i++;
    } else if (
      (char === "\x1b" && "]PX^_".includes(control) && control) ||
      "\x90\x98\x9d\x9e\x9f".includes(char)
    ) {
      while (i < line.length) {
        if (
          line[i++] === "\x9c" ||
          (line[i - 1] === "\x07" && (control === "]" || char === "\x9d"))
        )
          break;
        if (line[i - 1] === "\x1b" && line[i] === "\\") {
          i++;
          break;
        }
      }
    } else if (char === "\x1b") {
      // ESC with intermediate bytes, for example a character-set selector.
      while (control >= " " && control <= "/" && i < line.length) control = line[i++];
    } else if (char === "\n" || char === "\r" || char === "\t") text += " ";
    else if (char >= " " && !(char >= "\x7f" && char <= "\x9f")) text += char;
  }
  flush();
  return spans;
}
