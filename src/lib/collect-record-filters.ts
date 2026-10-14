/**
 * 등록자 DB 열 필터 — 열마다 "포함 검색 · 값 고르기 · 비어 있음" 을 건다.
 *
 * 예전엔 검색창·기간·UTM 소스/매체 두 칸뿐이라 "나이대 25-34 만", "Schedule Check 안 한 사람만"
 * 같은 걸 못 걸렀다(2026-10-14 요청). 목록·CSV·"필터 결과 전체 선택(→삭제)" 이 모두 같은
 * 쿼리스트링(cf)을 쓰므로, 여기서 만든 조건 하나가 세 군데에 똑같이 걸린다 — 화면에 보이는 것보다
 * 많이 지워지는 일이 없게.
 *
 * 열 이름은 화이트리스트(고정 열) 또는 `field:<항목 키>`. 항목 키와 값은 전부 파라미터로 바인딩한다.
 */
import { Prisma } from "@/generated/prisma";

import {
  CHECKIN_VALUES,
  EMPTY_VALUE,
  type ColumnFilter,
  type ColumnFilterKey,
} from "@/lib/collect-record-filter-model";

export * from "@/lib/collect-record-filter-model";

const likePattern = (value: string) => `%${value.replace(/[%_\\]/g, (m) => "\\" + m)}%`;

/** 열의 "글자 값" SQL — 항목은 data->>key, 고정 열은 컬럼. 없으면 ''. */
function textExpr(c: ColumnFilterKey): Prisma.Sql {
  if (c === "utmSource") return Prisma.sql`COALESCE("utmSource", '')`;
  if (c === "utmMedium") return Prisma.sql`COALESCE("utmMedium", '')`;
  if (c === "registrationNo") return Prisma.sql`COALESCE("registrationNo", '')`;
  const key = c.slice(6);
  return Prisma.sql`COALESCE("data"->>${key}, '')`;
}

/**
 * 값 하나와 같은가. 항목 값은 세 모양으로 저장된다 — 글자, 참/거짓(화면에선 TRUE/FALSE),
 * 여러 개를 담은 배열(체크박스 묶음). 배열은 그 안에 그 값이 있으면 맞다.
 */
function equalsValue(c: ColumnFilterKey, value: string): Prisma.Sql {
  if (!c.startsWith("field:")) {
    return value === EMPTY_VALUE ? Prisma.sql`${textExpr(c)} = ''` : Prisma.sql`${textExpr(c)} = ${value}`;
  }
  const key = c.slice(6);
  if (value === EMPTY_VALUE) {
    return Prisma.sql`(COALESCE("data"->>${key}, '') = '' OR "data"->${key} = '[]'::jsonb)`;
  }
  const bool = value === "TRUE" ? "true" : value === "FALSE" ? "false" : null;
  return Prisma.sql`(
    "data"->>${key} = ${value}
    ${bool ? Prisma.sql`OR "data"->>${key} = ${bool}` : Prisma.empty}
    OR (jsonb_typeof("data"->${key}) = 'array' AND "data"->${key} @> jsonb_build_array(${value}::text))
  )`;
}

function isEmptyExpr(c: ColumnFilterKey): Prisma.Sql {
  if (!c.startsWith("field:")) return Prisma.sql`${textExpr(c)} = ''`;
  const key = c.slice(6);
  return Prisma.sql`(COALESCE("data"->>${key}, '') = '' OR "data"->${key} = '[]'::jsonb OR "data"->>${key} = 'false')`;
}

/** 필터 → WHERE 조각들(AND 로 묶인다). 레코드 테이블 별칭 없이 "CollectRecord" 의 컬럼을 쓴다. */
export function columnFilterConditions(filters: ColumnFilter[]): Prisma.Sql[] {
  const conds: Prisma.Sql[] = [];
  for (const f of filters) {
    if (f.c === "checkin") {
      // 현장 입장 — 체크인 기록이 있는가. 포함 검색·비어 있음은 의미가 없어 값만 본다.
      const wantIn = f.values?.includes(CHECKIN_VALUES.in);
      const wantOut = f.values?.includes(CHECKIN_VALUES.out);
      if (wantIn === wantOut) continue;
      const exists = Prisma.sql`EXISTS (SELECT 1 FROM "CollectCheckIn" ci WHERE ci."recordId" = "CollectRecord"."id")`;
      conds.push(wantIn ? exists : Prisma.sql`NOT ${exists}`);
      continue;
    }
    if (f.contains) conds.push(Prisma.sql`${textExpr(f.c)} ILIKE ${likePattern(f.contains)}`);
    if (f.values?.length) conds.push(Prisma.sql`(${Prisma.join(f.values.map((v) => equalsValue(f.c, v)), " OR ")})`);
    if (f.empty === "empty") conds.push(isEmptyExpr(f.c));
    if (f.empty === "notEmpty") conds.push(Prisma.sql`NOT ${isEmptyExpr(f.c)}`);
  }
  return conds;
}

/**
 * 값 목록(값 고르기 칸) — 그 열에 실제로 들어 있는 값과 건수, 많은 순 상위 limit 개.
 * 배열 값(체크박스 묶음)은 펼쳐서 값마다 센다.
 */
export function distinctValuesSql(sourceId: string, c: ColumnFilterKey, limit = 200): Prisma.Sql {
  if (!c.startsWith("field:")) {
    return Prisma.sql`
      SELECT ${textExpr(c)} AS v, count(*)::int AS n FROM "CollectRecord"
      WHERE "sourceId" = ${sourceId}
      GROUP BY 1 ORDER BY 2 DESC, 1 ASC LIMIT ${limit}`;
  }
  const key = c.slice(6);
  return Prisma.sql`
    SELECT x.v AS v, count(*)::int AS n
    FROM "CollectRecord" r
    CROSS JOIN LATERAL (
      SELECT jsonb_array_elements_text(r."data"->${key}) AS v WHERE jsonb_typeof(r."data"->${key}) = 'array'
      UNION ALL
      SELECT COALESCE(r."data"->>${key}, '') WHERE jsonb_typeof(r."data"->${key}) IS DISTINCT FROM 'array'
    ) x
    WHERE r."sourceId" = ${sourceId}
    GROUP BY 1 ORDER BY 2 DESC, 1 ASC LIMIT ${limit}`;
}
