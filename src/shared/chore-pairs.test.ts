import { describe, it, expect } from "bun:test";
import { orderForRepoPair, type RepoPair } from "./chore-pairs";

const pairs: RepoPair[] = [
  ["api-contracts", "alumni_connect"],
  ["front-monorepo", "alumni_connect"],
];

describe("orderForRepoPair", () => {
  it("puts the target task first, whatever the selection order", () => {
    const upstream = { id: 1, repo: "api-contracts" };
    const target = { id: 2, repo: "alumni_connect" };
    expect(orderForRepoPair(pairs, [upstream, target])).toEqual([2, 1]);
    expect(orderForRepoPair(pairs, [target, upstream])).toEqual([2, 1]);
  });

  it("matches any of the pairs", () => {
    expect(orderForRepoPair(pairs, [{ id: 3, repo: "front-monorepo" }, { id: 4, repo: "alumni_connect" }])).toEqual([4, 3]);
  });

  it("rejects a selection that is not exactly one task per repo of a pair", () => {
    const ac = { id: 2, repo: "alumni_connect" };
    expect(orderForRepoPair(pairs, [ac])).toBeNull();
    expect(orderForRepoPair(pairs, [ac, { id: 5, repo: "alumni_connect" }])).toBeNull();
    expect(orderForRepoPair(pairs, [{ id: 1, repo: "api-contracts" }, { id: 3, repo: "front-monorepo" }])).toBeNull();
    expect(orderForRepoPair(pairs, [ac, { id: 6, repo: null }])).toBeNull();
    expect(orderForRepoPair(pairs, [ac, { id: 1, repo: "api-contracts" }, { id: 3, repo: "front-monorepo" }])).toBeNull();
  });

  it("orders a three-repo chain as target first, then the upstreams in ship order", () => {
    const chain: RepoPair[] = [...pairs, ["api-contracts", "front-monorepo", "alumni_connect"]];
    const ac = { id: 2, repo: "alumni_connect" };
    const api = { id: 1, repo: "api-contracts" };
    const fm = { id: 3, repo: "front-monorepo" };
    expect(orderForRepoPair(chain, [fm, ac, api])).toEqual([2, 1, 3]);
    expect(orderForRepoPair(chain, [api, ac])).toEqual([2, 1]);
    expect(orderForRepoPair(chain, [ac, api, { id: 4, repo: "api-contracts" }])).toBeNull();
  });
});
