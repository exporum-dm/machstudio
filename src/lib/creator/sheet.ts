import { normalizeCell, type Cells, type Column } from "./model";

function readDelimited(raw: string, separator: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < raw.length; index++) {
    const char = raw[index];
    if (quoted) {
      if (char === '"' && raw[index + 1] === '"') { value += '"'; index++; }
      else if (char === '"') quoted = false;
      else value += char;
    } else if (char === '"' && !value) quoted = true;
    else if (char === separator) { row.push(value); value = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && raw[index + 1] === "\n") index++;
      row.push(value);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      value = "";
    } else value += char;
  }
  if (quoted) throw new Error("닫히지 않은 따옴표가 있어요.");
  row.push(value);
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}

export function pasteCandidates(raw: string, columns: Column[]): Cells[] {
  if (raw.length > 500000) throw new Error("한 번에 250행, 500KB 이하를 붙여 넣어 주세요.");
  const content = raw.replace(/^\uFEFF/, "");
  const separator = content.split(/\r?\n/, 1)[0].includes("\t") ? "\t" : ",";
  const rows = readDelimited(content, separator);
  const first = rows[0] ?? [];
  const matched = first.map((cell) => columns.find(({ key, label }) => [key, label].includes(cell.trim())));
  const hasHeader = matched.some(Boolean) && matched.every((column, index) => column || first[index].trim() === "신청서 제출");
  const selected = hasHeader ? matched : columns;
  const data = hasHeader ? rows.slice(1) : rows;
  if (!data.length) throw new Error("추가할 후보 행을 붙여 넣어 주세요.");
  if (data.length > 250) throw new Error("한 번에 250행까지 붙여 넣을 수 있어요.");
  return data.map((row, index) => {
    if (row.length > selected.length) throw new Error((index + 1) + "행의 열이 표보다 많아요.");
    return Object.fromEntries(row.flatMap((value, cellIndex) => {
      const column = selected[cellIndex];
      if (!column) return [];
      try { return [[column.key, normalizeCell(column, value)]] as const; }
      catch (error) { throw new Error((index + 1) + "행 · " + (error instanceof Error ? error.message : "셀 값을 확인해 주세요.")); }
    }));
  });
}

function csv(value: unknown) {
  let text = String(value ?? "");
  if (typeof value === "string" && /^[\s]*[=+\-@]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

export function candidateCsv(columns: Column[], rows: { cells: unknown; submitted: boolean }[]) {
  return "\uFEFF" + [
    [...columns.map(({ label }) => label), "신청서 제출"].map(csv).join(","),
    ...rows.map((row) => [...columns.map(({ key }) => (row.cells as Cells)[key]), row.submitted ? "제출 완료" : "미제출"].map(csv).join(",")),
  ].join("\r\n");
}
