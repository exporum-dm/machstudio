/**
 * 주간업무보고 엑셀 — DM 주간 업무 보고 시트와 같은 자리(B2 부터)·같은 시트 이름(YYMMDD).
 * 회사 양식 파일에 시트째 옮기거나 칸을 그대로 붙여 넣을 수 있게.
 */
import * as XLSX from "xlsx";
import { reportSheetName } from "@/lib/worklog";

export function buildReportWorkbook(table: string[][], opts: { title: string; reportDate: string; hideOwners: boolean }): Buffer {
  const aoa: string[][] = [
    [],
    ["", opts.title, opts.hideOwners ? "*담당자, 결과 및 산출물 숨김처리" : "", "", "", "", "", "", "", opts.reportDate.replace(/-/g, "/")],
    [],
    ...table.map((row) => ["", ...row]),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  // "전주 달성"(C~F) · "금주 목표"(G~J) 머리 병합 — 시트와 같은 모양.
  sheet["!merges"] = [
    { s: { r: 3, c: 2 }, e: { r: 3, c: 5 } },
    { s: { r: 3, c: 6 }, e: { r: 3, c: 9 } },
  ];
  sheet["!cols"] = [{ wch: 2 }, { wch: 26 }, { wch: 48 }, { wch: 10 }, { wch: 6 }, { wch: 30 }, { wch: 48 }, { wch: 10 }, { wch: 6 }, { wch: 20 }];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, reportSheetName(opts.reportDate));
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
