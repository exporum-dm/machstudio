// 노션 "DM 업무 관리 › 콘텐츠" → 콘텐츠 캘린더(ContentItem) 가져오기 (2026-11-03).
//
// 입력: notion-dump 로 받은 JSON 파일(노션 API 로 받은 콘텐츠 + 본문). 이 스크립트는 노션을 직접 부르지 않는다.
// 다시 돌려도 안전 — notionId 로 겹치지 않게 갱신한다(노션 쪽에서 고친 내용으로 덮어쓴다).
//
// usage: node scripts/import-notion-content.mjs <dump.json> [--apply]
//   --apply 없으면 무엇을 넣을지 요약만 보여 준다(DB 안 씀).
import "dotenv/config";
import { config } from "dotenv";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import pg from "pg";

config({ path: ".env.local" });

const [file] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const apply = process.argv.includes("--apply");
if (!file) { console.error("usage: node scripts/import-notion-content.mjs <dump.json> [--apply]"); process.exit(1); }

const WORKSPACE_ID = "cmp6zn9t600005csaxd2uno40"; // Exporum
const OWNER_EMAIL = "hook2@exporum.com";

/** 노션 프로젝트 → machstudio 프로젝트 이름. null = 새로 만들 프로젝트 이름과 같다 */
const PROJECT_MAP = {
  "2026 코리아 엑스포": "Korea Expo",
  "2027 서울바앤스피릿쇼": "Seoul Bar & Spirits Show",
  "인디뷰티 서울": "Indie Beauty Seoul",
  "2026 에듀테크 코리아 페어": "Edtech Korea Fair",
  "서울 국제 주얼리 & 액세서리 쇼": "The MOST",
  "STK 2026": "STK",
  // 2026-11-03 사용자 결정: 둘 다 새 프로젝트로
  "2027 대한민국 교육박람회": "대한민국 교육박람회",
  "엑스포럼 리브랜딩": "엑스포럼",
};
const NEW_PROJECTS = ["대한민국 교육박람회", "엑스포럼"];

const STATUS_MAP = { "대기": "waiting", "기획 중": "planning", "진행 중": "doing", "디자인 중": "design", "컨펌 대기": "confirm", "완료": "done", "중단": "stopped" };
const PLATFORM_MAP = {
  Instagram: "인스타그램", Facebook: "페이스북", YouTube: "유튜브", Blog: "블로그", Thread: "스레드", X: "X", Tiktok: "틱톡",
  LinkedIn: "링크드인", KakaoTalk: "카카오톡", Homepage: "홈페이지", Stibee: "스티비", SMS: "SMS", Notion: "노션",
};
/** 계정이 없는 사람의 이름(노션 표시 이름보다 정확한 이름) */
const NAME_OVERRIDE = { "lynlea@exporum.com": "엄재호" };

const cuid = () => `c${Date.now().toString(36)}${randomBytes(8).toString("hex").slice(0, 12)}`;

const dump = JSON.parse(readFileSync(file, "utf8"));
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const members = (await client.query(
  `select u.id, u.name, u.email from "WorkspaceMember" m join "User" u on u.id = m."userId" where m."workspaceId" = $1`, [WORKSPACE_ID],
)).rows;
const memberByEmail = new Map(members.map((m) => [m.email.toLowerCase(), m]));
const owner = memberByEmail.get(OWNER_EMAIL);
const projects = (await client.query(`select id, name from "Project" where "workspaceId" = $1 and "deletedAt" is null`, [WORKSPACE_ID])).rows;
const projectByName = new Map(projects.map((p) => [p.name.trim(), p.id]));

const toCreate = NEW_PROJECTS.filter((n) => !projectByName.has(n));
const unmapped = new Map();
const assigneeStat = new Map();

const rows = dump.items.filter((it) => !it.archived).map((it) => {
  const notionProject = it.projects[0] ?? null;
  const target = notionProject ? PROJECT_MAP[notionProject] : null;
  if (notionProject && !target) unmapped.set(notionProject, (unmapped.get(notionProject) ?? 0) + 1);
  const assignees = it.people.map((p) => {
    const m = p.email ? memberByEmail.get(p.email.toLowerCase()) : null;
    const a = m ? { id: m.id, name: m.name || m.email.split("@")[0] } : { id: null, name: NAME_OVERRIDE[p.email?.toLowerCase()] ?? p.name ?? "" };
    const k = `${a.name}${a.id ? "" : " (계정 없음)"}`;
    assigneeStat.set(k, (assigneeStat.get(k) ?? 0) + 1);
    return a;
  }).filter((a) => a.id || a.name);
  const range = it.date?.end ? `기간: ${it.date.start.slice(0, 10)} ~ ${it.date.end.slice(0, 10)}\n\n` : "";
  return {
    notionId: it.notionId,
    sourceUrl: it.url,
    title: (it.title || "").trim().slice(0, 200) || "(제목 없음)",
    date: it.date?.start ? it.date.start.slice(0, 10) : null,
    status: STATUS_MAP[it.status] ?? "waiting",
    channels: [...new Set(it.platforms.map((p) => PLATFORM_MAP[p] ?? p))],
    formats: [...new Set(it.formats)],
    campaign: it.campaign || "",
    assignees,
    body: (range + (it.body || "").trim()).slice(0, 20000),
    projectName: target,
    createdAt: it.createdTime,
  };
});

const count = (f) => { const m = {}; for (const r of rows) for (const v of [].concat(f(r))) m[v] = (m[v] ?? 0) + 1; return m; };
console.log(`항목 ${rows.length}건 (보관 제외)`);
console.log("새로 만들 프로젝트:", toCreate.length ? toCreate.join(", ") : "없음");
console.log("프로젝트별:", count((r) => r.projectName ?? "(프로젝트 없음)"));
console.log("상태:", count((r) => r.status));
console.log("담당:", Object.fromEntries(assigneeStat));
if (unmapped.size) console.log("⚠ 짝 없는 노션 프로젝트:", Object.fromEntries(unmapped));

if (!apply) { console.log("\n(미리보기 — --apply 로 실제 반영)"); await client.end(); process.exit(0); }
if (!owner) throw new Error(`${OWNER_EMAIL} 가 워크스페이스 멤버가 아님`);

try {
  await client.query("BEGIN");
  for (const name of toCreate) {
    const id = cuid();
    await client.query(`insert into "Project" (id, name, "workspaceId", "createdAt", "updatedAt") values ($1, $2, $3, now(), now())`, [id, name, WORKSPACE_ID]);
    await client.query(
      `insert into "ActivityLog" (id, "workspaceId", "userId", action, meta, "createdAt") values ($1, $2, $3, 'project.created', $4, now())`,
      [cuid(), WORKSPACE_ID, owner.id, JSON.stringify({ projectId: id, name, via: "notion-content-import" })],
    );
    projectByName.set(name, id);
  }
  let inserted = 0, updated = 0;
  for (const r of rows) {
    const projectId = r.projectName ? projectByName.get(r.projectName) ?? null : null;
    const res = await client.query(
      `insert into "ContentItem" (id, "workspaceId", "projectId", title, date, time, status, channels, formats, campaign, assignees, body, link, "notionId", "sourceUrl", "createdById", "createdAt", "updatedAt")
       values ($1, $2, $3, $4, $5, '', $6, $7, $8, $9, $10, $11, '', $12, $13, $14, $15, now())
       on conflict ("notionId") do update set
         "projectId" = excluded."projectId", title = excluded.title, date = excluded.date, status = excluded.status,
         channels = excluded.channels, formats = excluded.formats, campaign = excluded.campaign, assignees = excluded.assignees,
         body = excluded.body, "sourceUrl" = excluded."sourceUrl", "updatedAt" = now()
       returning (xmax = 0) as inserted`,
      [cuid(), WORKSPACE_ID, projectId, r.title, r.date, r.status, r.channels, r.formats, r.campaign, JSON.stringify(r.assignees), r.body,
        r.notionId, r.sourceUrl, owner.id, r.createdAt],
    );
    if (res.rows[0].inserted) inserted++; else updated++;
  }
  await client.query(
    `insert into "ActivityLog" (id, "workspaceId", "userId", action, meta, "createdAt") values ($1, $2, $3, 'content.notion_imported', $4, now())`,
    [cuid(), WORKSPACE_ID, owner.id, JSON.stringify({ inserted, updated })],
  );
  await client.query("COMMIT");
  console.log(`✓ 새로 ${inserted}건 · 갱신 ${updated}건`);
} catch (e) {
  await client.query("ROLLBACK");
  console.error("✗ 되돌림:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
