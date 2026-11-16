/**
 * 묶음 캐시 — 같은 값을 여러 요청이 동시에 원할 때 **DB 에는 한 번만** 묻는다(인스턴스 안에서).
 *
 * 왜: 웨비나 시청자 수백 명이 같은 /live-state 를 몇 초 간격으로 부른다. 예전엔 요청마다 질의 9개가
 * 나가 시청자 수만큼 DB 부하가 늘었다(2026-08-11 연결 고갈 사고). 이제는 인스턴스당 ttl 마다 한 번.
 *
 * - ttlMs 안에서는 저장된 값을 준다.
 * - 이미 누가 불러오는 중이면 그 결과를 같이 기다린다(동시에 몰려도 한 번).
 * - minStartedAt: "이 시각 **뒤에 시작한** 조회만 받겠다" — 운영자가 바꾼 직후의 즉시 알림이
 *   옛 캐시를 받지 않게 한다(webinar-live-signal 의 at).
 * - 실패한 조회는 저장하지 않는다(다음 요청이 다시 시도).
 */
type Entry<T> = { value: T; startedAt: number };
type Pending<T> = { promise: Promise<T>; startedAt: number };

export class SharedLoadCache<T> {
  private values = new Map<string, Entry<T>>();
  private pending = new Map<string, Pending<T>>();

  constructor(private readonly ttlMs: number, private readonly maxKeys = 500) {}

  async get(key: string, load: () => Promise<T>, minStartedAt = 0, now = Date.now()): Promise<T> {
    const hit = this.values.get(key);
    if (hit && now - hit.startedAt < this.ttlMs && hit.startedAt >= minStartedAt) return hit.value;
    const inflight = this.pending.get(key);
    if (inflight && inflight.startedAt >= minStartedAt) return inflight.promise;

    const startedAt = now;
    const promise = load().then(
      (value) => {
        const current = this.values.get(key);
        if (!current || current.startedAt <= startedAt) {
          if (this.values.size >= this.maxKeys && !this.values.has(key)) {
            const oldest = this.values.keys().next().value;
            if (oldest !== undefined) this.values.delete(oldest);
          }
          this.values.set(key, { value, startedAt });
        }
        return value;
      },
    ).finally(() => {
      if (this.pending.get(key)?.promise === promise) this.pending.delete(key);
    });
    this.pending.set(key, { promise, startedAt });
    return promise;
  }

  clear() {
    this.values.clear();
    this.pending.clear();
  }
}

/**
 * 짧은 기억 — "이 등록번호가 이 웨비나 등록자인가" 같은 확인 결과를 잠깐 들고 있는다.
 * 확인된 것(true)은 오래, 아닌 것(false)은 짧게 — 방금 등록한 사람이 곧바로 인정받게.
 */
export class VerdictMemo {
  private map = new Map<string, { ok: boolean; until: number }>();
  constructor(private readonly okMs: number, private readonly noMs: number, private readonly maxKeys = 20_000) {}

  get(key: string, now = Date.now()): boolean | undefined {
    const v = this.map.get(key);
    if (!v) return undefined;
    if (v.until < now) { this.map.delete(key); return undefined; }
    return v.ok;
  }

  set(key: string, ok: boolean, now = Date.now()) {
    if (this.map.size >= this.maxKeys) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, { ok, until: now + (ok ? this.okMs : this.noMs) });
  }
}
