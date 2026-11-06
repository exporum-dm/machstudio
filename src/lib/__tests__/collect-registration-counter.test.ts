import { describe,it,expect,vi } from "vitest";
import { Prisma } from "@/generated/prisma";
import { nextDomesticRegistrationNo } from "../collect-registration-counter";
describe("domestic sequence allocation",()=>{
  it("increments an existing durable counter",async()=>{
    const query=vi.fn().mockResolvedValue([{lastValue:42}]);
    expect(await nextDomesticRegistrationNo({$queryRaw:query} as unknown as Prisma.TransactionClient,"90")).toBe("90000042");
    expect(query).toHaveBeenCalledTimes(1);
  });
  it("initializes or resolves a concurrent first allocation in the same transaction",async()=>{
    const query=vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{lastValue:1}]);
    expect(await nextDomesticRegistrationNo({$queryRaw:query} as unknown as Prisma.TransactionClient,"07")).toBe("07000001");
    expect(query.mock.calls[1][0].text).toContain("ON CONFLICT");
  });
  it("stops rather than wrapping at the six-digit limit",async()=>{
    const query=vi.fn().mockResolvedValue([]);
    await expect(nextDomesticRegistrationNo({$queryRaw:query} as unknown as Prisma.TransactionClient,"90")).rejects.toThrow("한도");
  });
});
