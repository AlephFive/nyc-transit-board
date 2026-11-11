/**
 * The four card builders, against captured feeds.
 *
 * These are the functions that turn a decoded feed into what the panel
 * renders. They are exported so they can be driven directly here: reached
 * only through `buildBoard`, a builder is covered by whatever that happens
 * to exercise on its way past, which is not the same as being tested. The
 * rules `buildBoard.ts` documents in comments are asserted here instead.
 *
 * **No network.** A builder reaches its feed through `sharedFeed`, which
 * returns a cached promise when the key is already present. Seeding the
 * cache is therefore the whole mock: the fetcher behind it is never called,
 * and a test that forgets to seed fails loudly on a real fetch rather than
 * quietly passing on an empty card.
 *
 * Fixtures are rebased to now on load, so the walk-time filter sees live
 * departures. See `fixtures/load.ts` for why that matters.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  subwayCard,
  railroadCard,
  busCard,
  ferryCard,
  emptyFeedCache,
  subwayLinesFor,
  subwayRoutesFor,
  type FeedCache,
  type SharedOptions,
  type BoardCard,
} from "../src/buildBoard.ts";
import type { CardSettings } from "../src/settings.ts";
import { subwayFeedKey } from "../../EInk-NYC-Home-Dashboard/src/utils/subway/feedLookup.ts";
import { loadFeed, editFeed } from "./fixtures/load.ts";

/** Row options as `buildBoard` builds them, with a generous row budget. */
const options: SharedOptions = {
  limit: 16,
  fetchLimit: 20,
  settings: { use24HourTime: false, urgentThresholdMinutes: 10 },
};

/** A card carrying the fields every builder reads, overridable per test. */
function cardFor(overrides: Partial<CardSettings> = {}): CardSettings {
  return {
    slot: 1,
    transitType: "subway",
    stopIds: ["721"],
    walkTime: 0,
    ...overrides,
  } as CardSettings;
}

/**
 * Seed a subway feed under the key the builder will look for.
 *
 * The key is derived through the same exported helpers the builder uses, so
 * a change to the derivation moves both together instead of silently missing
 * the cache and reaching the network.
 */
function seedSubway(feeds: FeedCache, card: CardSettings, feed: unknown) {
  const lines = subwayLinesFor(subwayRoutesFor(card.stopIds));
  feeds.subway.set(
    subwayFeedKey(lines),
    Promise.resolve({ feedMessage: feed } as never)
  );
}

/** Every row across every column of a card. */
const allRows = (card: BoardCard) => (card.k ?? []).flatMap((col) => col.r);

describe("subwayCard", () => {
  test("builds two direction columns from a feed", async () => {
    const feeds = emptyFeedCache();
    const card = cardFor();
    seedSubway(feeds, card, loadFeed("subway-vernon"));

    const built = await subwayCard(card, options, feeds);

    assert.equal(built.e, undefined, "a healthy feed must not error");
    assert.equal(built.k?.length, 2, "Vernon Blvd runs both ways");
    assert.ok(allRows(built).length > 0, "a rebased fixture must yield rows");
  });

  test("the heading and bullets come from the station table", async () => {
    const feeds = emptyFeedCache();
    const card = cardFor();
    seedSubway(feeds, card, loadFeed("subway-vernon"));

    const built = await subwayCard(card, options, feeds);

    assert.match(built.n, /Vernon/);
    // Bullets are what a rider reads. An internal feed id reaching the panel
    // is the bug `routeLabel.ts` exists to prevent.
    assert.deepEqual(built.b, ["7"]);
  });

  test("both columns are kept when neither direction runs", async () => {
    // Truncating every trip to this stop leaves nothing boardable either
    // way. Dropping a column here would claim the service does not exist,
    // which is a different statement from "nothing is due".
    const feeds = emptyFeedCache();
    const card = cardFor();
    const terminating = editFeed(loadFeed("subway-vernon"), (trip) => {
      trip.tripUpdate.stopTimeUpdate = trip.tripUpdate.stopTimeUpdate.slice(
        0,
        1
      );
    });
    seedSubway(feeds, card, terminating);

    const built = await subwayCard(card, options, feeds);

    assert.equal(built.k?.length, 2);
  });

  test("direction narrows the card to one column", async () => {
    const feeds = emptyFeedCache();
    const card = cardFor({ direction: 1 });
    seedSubway(feeds, card, loadFeed("subway-vernon"));

    const built = await subwayCard(card, options, feeds);

    assert.equal(built.k?.length, 1);
  });

  test("routes filter a multi-route station", async () => {
    const feeds = emptyFeedCache();
    const unfiltered = cardFor({ stopIds: ["A41"] });
    seedSubway(feeds, unfiltered, loadFeed("subway-jay-st"));
    const both = await subwayCard(unfiltered, options, feeds);

    const feedsA = emptyFeedCache();
    const filtered = cardFor({ stopIds: ["A41"], routes: ["A"] });
    seedSubway(feedsA, filtered, loadFeed("subway-jay-st"));
    const onlyA = await subwayCard(filtered, options, feedsA);

    assert.ok(allRows(both).length > 0, "the unfiltered card has rows");
    const badges = new Set(allRows(onlyA).map((row) => row[0]));
    assert.deepEqual([...badges].sort(), ["A"], "only the A survives");
  });

  test("a failing feed errors the card instead of throwing", async () => {
    const feeds = emptyFeedCache();
    const card = cardFor();
    const lines = subwayLinesFor(subwayRoutesFor(card.stopIds));
    feeds.subway.set(
      subwayFeedKey(lines),
      Promise.reject(new Error("feed exploded"))
    );

    const built = await subwayCard(card, options, feeds);

    assert.equal(built.e, "feed exploded");
    assert.equal(built.k, undefined, "a failed card carries no columns");
    // The heading survives, so the card still says what it is.
    assert.match(built.n, /Vernon/);
  });
});

describe("railroadCard", () => {
  const lirrCard = (overrides: Partial<CardSettings> = {}) =>
    cardFor({ transitType: "railroad-lirr", stopIds: ["102"], ...overrides });

  /**
   * Seed a railroad feed with the `_railroad` tag the extractor filters on.
   *
   * `fetchMultipleRailroads()` stamps every entity with its source railroad
   * as it merges the two feeds, because LIRR and Metro-North reuse stop IDs
   * — `extractDataByStop` drops any entity whose tag does not match. A
   * fixture is a *raw* single-railroad capture and carries no tag, so
   * seeding it untagged yields a card of zero rows that still looks healthy.
   */
  function seedRailroad(
    feeds: FeedCache,
    feed: { entity: unknown[] },
    railroad = "lirr"
  ) {
    const tagged = {
      entity: feed.entity.map((entity) => ({
        ...(entity as object),
        _railroad: railroad,
      })),
    };
    feeds.railroad.set(
      railroad,
      Promise.resolve({ feedMessage: tagged } as never)
    );
  }

  test("builds one list, not two columns", async () => {
    const feeds = emptyFeedCache();
    seedRailroad(feeds, loadFeed("lirr-jamaica"));

    const built = await railroadCard(lirrCard(), options, feeds);

    assert.equal(built.e, undefined);
    assert.equal(built.k?.length, 1, "a railroad card is a single list");
    assert.ok(allRows(built).length > 0);
  });

  test("the card is tagged rather than given bullets", async () => {
    const feeds = emptyFeedCache();
    seedRailroad(feeds, loadFeed("lirr-jamaica"));

    const built = await railroadCard(lirrCard(), options, feeds);

    assert.deepEqual(built.b, ["LIRR"]);
  });

  test("badges are branch names, not feed route ids", async () => {
    const feeds = emptyFeedCache();
    seedRailroad(feeds, loadFeed("lirr-jamaica"));

    const built = await railroadCard(lirrCard(), options, feeds);

    const badges = allRows(built).map((row) => row[0]);
    assert.ok(badges.length > 0, "Jamaica must produce rows");
    for (const badge of badges) {
      assert.doesNotMatch(badge, /Branch/, `"${badge}" still says Branch`);
      // A raw feed route id is a bare number; a rider reads a branch name.
      assert.doesNotMatch(badge, /^\d+$/, `"${badge}" is a feed route id`);
    }
  });

  test("a single list gets double the row budget", async () => {
    const feeds = emptyFeedCache();
    seedRailroad(feeds, loadFeed("lirr-jamaica"));

    const built = await railroadCard(lirrCard(), { ...options, limit: 2 }, feeds);

    // Two columns worth of rows in one column. The fixture holds 20 trips,
    // so the cap binds here rather than the feed.
    assert.ok(
      allRows(built).length <= 4,
      `expected at most 4 rows, got ${allRows(built).length}`
    );
  });

  test("a failing feed errors the card", async () => {
    const feeds = emptyFeedCache();
    feeds.railroad.set("lirr", Promise.reject(new Error("LIRR down")));

    const built = await railroadCard(lirrCard(), options, feeds);

    assert.equal(built.e, "LIRR down");
    assert.deepEqual(built.b, ["LIRR"], "the tag survives the failure");
  });
});

describe("ferryCard", () => {
  const wallSt = (overrides: Partial<CardSettings> = {}) =>
    cardFor({ transitType: "ferry", stopIds: ["87"], ...overrides });

  /** Ferry passes the feed straight through, not `.feedMessage`. */
  const seedFerry = (feeds: FeedCache) =>
    feeds.ferry.set("ferry", Promise.resolve(loadFeed("ferry-wall-st") as never));

  test("builds one list of sailings", async () => {
    const feeds = emptyFeedCache();
    seedFerry(feeds);

    const built = await ferryCard(wallSt(), options, feeds);

    assert.equal(built.e, undefined);
    assert.equal(built.k?.length, 1);
    // The bug this pins: a NYC Ferry trip reports one leg, so inferring
    // "terminates here" from the stop sequence marked every sailing terminal
    // and `isBoardable()` discarded the lot — zero rows on a healthy feed.
    assert.ok(allRows(built).length > 0, "sailings must survive isBoardable");
  });

  test("two ferry cards share one keyed feed", async () => {
    const feeds = emptyFeedCache();
    seedFerry(feeds);

    await ferryCard(wallSt(), options, feeds);
    await ferryCard(wallSt({ slot: 2 }), options, feeds);

    assert.equal(feeds.ferry.size, 1, "one feed covers the whole system");
  });

  test("a failing feed errors the card", async () => {
    const feeds = emptyFeedCache();
    feeds.ferry.set("ferry", Promise.reject(new Error("no boats")));

    const built = await ferryCard(wallSt(), options, feeds);

    assert.equal(built.e, "no boats");
  });
});

describe("busCard", () => {
  const corner = (overrides: Partial<CardSettings> = {}) =>
    cardFor({
      transitType: "bus",
      stopIds: ["505506", "505513"],
      ...overrides,
    });

  /** A SIRI body reporting a retired stop: HTTP 200, failure in the body. */
  const siriError = {
    Siri: {
      ServiceDelivery: {
        StopMonitoringDelivery: [
          {
            ErrorCondition: {
              OtherError: { ErrorText: "No such stop: MTA NYCT_505513." },
            },
          },
        ],
      },
    },
  };

  /** A healthy SIRI body with nothing currently due. */
  const siriEmpty = {
    Siri: {
      ServiceDelivery: {
        StopMonitoringDelivery: [{ MonitoredStopVisit: [] }],
      },
    },
  };

  /**
   * Answer the bus card's SIRI calls from memory.
   *
   * `BuildEnv` carries only the API key — the SIRI call goes through the
   * shared bus module to the global `fetch`, so that is what a test has to
   * stand in for. Restored after each case so a leaked stub cannot make a
   * later test pass on data it never fetched.
   */
  async function withSiri<T>(
    reply: (stopId: string) => unknown,
    run: () => Promise<T>
  ): Promise<T> {
    const real = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const ref = url.searchParams.get("MonitoringRef") ?? "";
      return new Response(JSON.stringify(reply(ref)), {
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    try {
      return await run();
    } finally {
      globalThis.fetch = real;
    }
  }

  const env = { MTA_API_KEY: "test-key" };

  test("one retired stop does not discard the live one", async () => {
    // The failure this guards: a corner is two IDs, the MTA retires them one
    // at a time, and a shared rejection would fail the whole card.
    const built = await withSiri(
      (ref) => (ref.endsWith("505513") ? siriError : siriEmpty),
      () => busCard(corner(), options, env)
    );

    assert.ok(built, "a half-working corner still builds a card");
    assert.equal(built.e, undefined, "one dead ID must not error the card");
  });

  test("a wholly dead corner does not look healthy", async () => {
    const built = await withSiri(
      () => siriError,
      () => busCard(corner(), options, env)
    );

    // Reported as an error or dropped outright are both correct; rendering
    // as a healthy empty card is not.
    if (built) assert.ok(built.e, "every stop failed, so the card must say so");
  });
});
