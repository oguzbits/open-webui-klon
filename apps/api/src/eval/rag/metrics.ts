export interface EvalHit {
  filename: string;
  page: number | null;
}

export interface Expectation {
  filename: string;
  /** When given, the hit must also be on this page. */
  page?: number;
}

/** 1-based place of the first hit that matches, or undefined if none does. */
export function rankOf(hits: EvalHit[], expected: Expectation): number | undefined {
  const index = hits.findIndex(
    (hit) =>
      hit.filename === expected.filename &&
      (expected.page === undefined || hit.page === expected.page)
  );
  return index === -1 ? undefined : index + 1;
}

export interface EvalSummary {
  questions: number;
  hitAt1: number;
  hitAtK: number;
  mrr: number;
}

/** Ranks are 1-based places, undefined for a miss; `topK` is the number of hits the search returns. */
export function summarize(ranks: (number | undefined)[], topK: number): EvalSummary {
  const count = ranks.length;
  if (count === 0) return { questions: 0, hitAt1: 0, hitAtK: 0, mrr: 0 };
  const found = ranks.filter((rank): rank is number => rank !== undefined);
  return {
    questions: count,
    hitAt1: found.filter((rank) => rank === 1).length / count,
    hitAtK: found.filter((rank) => rank <= topK).length / count,
    mrr: found.reduce((sum, rank) => sum + 1 / rank, 0) / count,
  };
}
