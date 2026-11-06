import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { normalizeCollectForm, resolveCollectFormConfigOrgTokens } from "@/lib/collect-form-config";
import { resolveOrgProfile, type WorkspaceLegalProfile } from "@/lib/legal-templates";
import { getClientIp, rateLimitAsync } from "@/lib/ratelimit";
import { CollectFormRuntime } from "@/components/form-builder/CollectFormRuntime";

export const dynamic = "force-dynamic";
export const metadata = {robots:{index:false,follow:false}};
export default async function RegistrationPage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{type?:string;lang?:string}>}) {
  const {id}=await params, query=await searchParams;
  const h=await headers();
  const limit=await rateLimitAsync(`collect-public-page:${getClientIp(new Request("https://x",{headers:h}))}`,{limit:120,windowMs:60000});
  if(!limit.allowed) return <main className="p-8 text-center">잠시 후 다시 시도해 주세요.</main>;
  const source=await prisma.collectSource.findUnique({where:{id},select:{isActive:true,deletedAt:true,mode:true,formConfig:true,workspace:{select:{legalProfile:true}}}});
  if(!source || source.deletedAt || !source.isActive || source.mode!=="builder") notFound();
  const normalized=normalizeCollectForm(source.formConfig);
  const org=resolveOrgProfile(source.workspace.legalProfile as WorkspaceLegalProfile|null,normalized.legal.country);
  const config=resolveCollectFormConfigOrgTokens(normalized,org);
  return <main className="min-h-dvh bg-background px-4 py-8 sm:py-14"><div className="mx-auto max-w-3xl"><CollectFormRuntime config={config} sourceId={id} forceType={typeof query.type==="string"?query.type:undefined} locale={typeof query.lang==="string"?query.lang:undefined} serverNow={new Date().toISOString()} preview={false}/></div></main>;
}
