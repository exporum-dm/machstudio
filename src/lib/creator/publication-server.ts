import { prisma } from "@/lib/prisma";
import { publicationSchema } from "./model";

export function isPublicationKind(value: string): value is "roster" | "awards" {
  return value === "roster" || value === "awards";
}

export async function loadPublication(id: string, kind: "roster" | "awards") {
  const program = await prisma.creatorProgram.findFirst({ where: { id, project: { deletedAt: null, workspace: { deletedAt: null } } }, select: { [kind]: true } });
  const parsed = publicationSchema.safeParse(program?.[kind]);
  return parsed.success && parsed.data.entries.length ? parsed.data : null;
}
