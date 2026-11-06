import { describe, it, expect, vi, beforeEach } from "vitest";
const mocks=vi.hoisted(()=>({findUnique:vi.fn().mockResolvedValue(null)}));
vi.mock("@/lib/prisma",()=>({prisma:{collectRecord:{findUnique:mocks.findUnique}}}));
vi.mock("next/navigation",()=>({notFound:()=>{throw new Error("NOT_FOUND")}}));
vi.mock("next/headers",()=>({headers:async()=>new Headers()}));
vi.mock("@/lib/ratelimit",()=>({getClientIp:()=>"127.0.0.1",rateLimitAsync:async()=>({allowed:true})}));
import TicketPage from "../page";
beforeEach(()=>vi.clearAllMocks());
describe("sequential ticket access",()=>{
  it("does not query personal data with a sequential number alone",async()=>{
    await expect(TicketPage({params:Promise.resolve({regNo:"90000001"})})).rejects.toThrow("NOT_FOUND");
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });
  it("requires the ticket key to match the same registration record",async()=>{
    await TicketPage({params:Promise.resolve({regNo:"90000001"}),searchParams:Promise.resolve({key:"unrelated-record-id"})});
    expect(mocks.findUnique).toHaveBeenCalledWith(expect.objectContaining({where:{registrationNo:"90000001",id:"unrelated-record-id"}}));
  });
  it("preserves existing random-number ticket links",async()=>{
    await TicketPage({params:Promise.resolve({regNo:"1234567890128"})});
    expect(mocks.findUnique).toHaveBeenCalledWith(expect.objectContaining({where:{registrationNo:"1234567890128"}}));
  });
});
