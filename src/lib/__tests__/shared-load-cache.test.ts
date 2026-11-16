import { describe, expect, it, vi } from "vitest";
import { SharedLoadCache, VerdictMemo } from "@/lib/shared-load-cache";

describe("SharedLoadCache — 동시에 몰려도 DB 에는 한 번", () => {
  it("동시 요청 500개가 조회 하나를 같이 기다린다", async () => {
    const cache = new SharedLoadCache<number>(2000);
    let resolve!: (v: number) => void;
    const load = vi.fn(() => new Promise<number>((r) => { resolve = r; }));
    const all = Array.from({ length: 500 }, () => cache.get("w", load, 0, 1000));
    resolve(42);
    expect(await Promise.all(all)).toEqual(Array(500).fill(42));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("ttl 안에서는 저장된 값, 지나면 다시 읽는다", async () => {
    const cache = new SharedLoadCache<number>(2000);
    const load = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    expect(await cache.get("w", load, 0, 1000)).toBe(1);
    expect(await cache.get("w", load, 0, 2999)).toBe(1);
    expect(await cache.get("w", load, 0, 3000)).toBe(2);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("즉시 알림의 v(바뀐 시각)보다 먼저 시작한 값은 쓰지 않는다", async () => {
    const cache = new SharedLoadCache<string>(2000);
    const load = vi.fn().mockResolvedValueOnce("옛 공지").mockResolvedValueOnce("새 공지");
    expect(await cache.get("w", load, 0, 1000)).toBe("옛 공지");
    // 1500 에 공지가 바뀌었다 — 1000 에 시작한 값은 ttl 안이어도 버린다
    expect(await cache.get("w", load, 1500, 1600)).toBe("새 공지");
    // 그 뒤로는 새 값을 다시 나눠 준다
    expect(await cache.get("w", load, 1500, 1700)).toBe("새 공지");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("실패한 조회는 저장하지 않는다", async () => {
    const cache = new SharedLoadCache<number>(2000);
    const load = vi.fn().mockRejectedValueOnce(new Error("EMAXCONN")).mockResolvedValueOnce(7);
    await expect(cache.get("w", load, 0, 1000)).rejects.toThrow("EMAXCONN");
    expect(await cache.get("w", load, 0, 1001)).toBe(7);
  });

  it("웨비나마다 따로", async () => {
    const cache = new SharedLoadCache<string>(2000);
    expect(await cache.get("a", async () => "A", 0, 1000)).toBe("A");
    expect(await cache.get("b", async () => "B", 0, 1000)).toBe("B");
  });
});

describe("VerdictMemo — 등록자 확인 기억", () => {
  it("확인된 건 오래, 아닌 건 짧게", () => {
    const memo = new VerdictMemo(600_000, 30_000);
    memo.set("ok", true, 0);
    memo.set("no", false, 0);
    expect(memo.get("ok", 100_000)).toBe(true);
    expect(memo.get("no", 10_000)).toBe(false);
    expect(memo.get("no", 31_000)).toBeUndefined();
    expect(memo.get("ok", 601_000)).toBeUndefined();
  });
});
