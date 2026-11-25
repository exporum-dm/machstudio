import { createHash } from "node:crypto";
import { config } from "dotenv";
import pg from "pg";

config({ path: ".env.local" });
const programId = process.argv[2];
if (!programId || !process.env.DATABASE_URL) throw new Error("Usage: node scripts/import-education-creator-guides.mjs <programId>");

const common = "게시 전 초안을 제출하고 검수 결과를 확인해 주세요. 승인 후 인스타그램 게시 링크와 지정된 Drive 폴더에 업로드한 원본 영상의 파일 링크를 제출해 주세요.";
const guides = [
  ["pre-dec", "사전 릴스 1편 · 12월 중순", "예정 게시 시기는 12월 중순입니다. 세부 주제와 촬영 방향은 운영자가 전달하는 브리프를 확인해 주세요."],
  ["pre-jan-early", "사전 릴스 2편 · 1월 초", "예정 게시 시기는 1월 초입니다. 세부 주제와 촬영 방향은 운영자가 전달하는 브리프를 확인해 주세요."],
  ["pre-jan-mid", "사전 릴스 3편 · 1월 중순", "예정 게시 시기는 1월 중순입니다. 세부 주제와 촬영 방향은 운영자가 전달하는 브리프를 확인해 주세요."],
  ["on-site", "현장 방문 릴스 · 1월 27~29일", "2027년 1월 27~29일 중 하루, 코엑스 1층 A·B홀에 방문해 릴스를 촬영하고 현장 방문 후 게시해 주세요. 세부 촬영 방향은 운영자가 전달하는 브리프를 확인해 주세요."],
];

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query("BEGIN");
  const edition = await client.query(
    'SELECT p.id FROM "CreatorProgram" p JOIN "Project" x ON x.id=p."projectId" WHERE p.id=$1 AND p."deletedAt" IS NULL AND x.name=$2 AND x."deletedAt" IS NULL FOR UPDATE OF p',
    [programId, "Education Korea"],
  );
  if (edition.rowCount !== 1) throw new Error("Education Korea 회차를 찾을 수 없어요.");
  let imported = 0;
  for (const [key, title, guide] of guides) {
    const id = "edm_" + createHash("sha256").update(programId + ":" + key).digest("hex").slice(0, 24);
    const mission = await client.query(
      `INSERT INTO "CreatorMission" (id,"programId",title,guide,platforms,draft,proof,"driveProof",published)
       VALUES ($1,$2,$3,$4,ARRAY['instagram'],true,'off','required',false) ON CONFLICT (id) DO NOTHING`,
      [id, programId, title, guide + "\n\n" + common],
    );
    if (!mission.rowCount) continue;
    await client.query(
      `INSERT INTO "CreatorAssignment" (id,"missionId","participantId",stage)
       SELECT $1 || id,$2,id,'draft' FROM "CreatorParticipant" WHERE "programId"=$3 AND "withdrawnAt" IS NULL`,
      [id + "_", id, programId],
    );
    imported++;
  }
  await client.query("COMMIT");
  console.log("교육박람회 미션 초안 " + imported + "개를 추가했어요.");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
