/**
 * The shape of a board, and the values every caller shares.
 *
 * TRMNL stores each user's form values and sends them with every poll, so a
 * request carries one user's whole board. There is no session and nothing
 * persisted on our side — the settings *are* the request. `jsonSettings.ts`
 * turns that request into the types declared here.
 *
 * This module holds what does not depend on how a board arrives: the transit
 * type union and its aliases, the defaults a missing field falls back to,
 * the destination scale's bounds, and `DEMO_CARDS` — the board shown to
 * anyone who has configured nothing, which is also what the public recipe
 * listing previews.
 */

// `pickers` imports only JSON the Worker already loads for the board, so
// this costs nothing at runtime — see `valueFromLabel`.
import { valueFromLabel } from "./pickers";

/** Transit types a slot may select, matching the dashboard's own union. */
export const TRANSIT_TYPES = [
  "subway",
  "railroad-lirr",
  "railroad-mtn",
  "bus",
  "ferry",
] as const;

export type TransitType = (typeof TRANSIT_TYPES)[number];

/** One configured card. */
export interface CardSettings {
  /** 1-based slot, which fixes the card's place in the 3x2 grid. */
  slot: number;
  transitType: TransitType;
  /** Every stop ID this card merges — a complex or a bus corner has several. */
  stopIds: string[];
  /** Minutes to reach the stop. Departures inside it are dropped. */
  walkTime: number;
  /** Overrides the station name as the card heading. */
  title?: string;
  /**
   * Show only these routes, as the rider names them — "7", "S", "A".
   *
   * Empty means every route the stop carries, which is the default and what
   * most cards want. It earns its place at a complex: Times Square is five
   * platform groups and twelve routes on one card, and someone who only
   * rides the 1/2/3 does not want nine other lines competing for the rows.
   */
  routes?: string[];
  /**
   * Show only one of a card's two directions, or both when unset.
   *
   * A card is usually half wasted: someone leaving home only ever rides
   * one way, and the other column is a list of trains they will not take.
   * Narrowing to one direction gives the rows they do want the whole card.
   *
   * 1 and 2 rather than compass points or "inbound", because what the two
   * mean differs by network and there is no shared vocabulary. On a
   * railroad 1 is city-bound and 2 is outbound, which `isCityBound()`
   * already decides per trip. On subway and bus the card simply has two
   * columns and the numbers are their order — the heading above each says
   * which is which, so a rider can see what they picked.
   */
  direction?: 1 | 2;
}

/** A whole board, as one poll describes it. */
export interface BoardSettings {
  cards: CardSettings[];
  /** True when nothing was configured and the demo board stood in. */
  isDemo: boolean;
  use24HourTime: boolean;
  urgentThresholdMinutes: number;
  /**
   * How large a destination is drawn, relative to the row's own size.
   *
   * A destination is the one thing on a row whose useful length varies by
   * station: "96 St" fits anywhere, "Coney Island-Stillwell Av" does not
   * fit a split subway column at any size the rest of the row can spare.
   * Rather than pick one compromise, the size is the user's — smaller
   * trades legibility for more of the name, larger does the reverse.
   */
  destinationScale: number;
  /** Departures to request per stop, for the feeds that take a limit. */
  fetchDepartures: number;
}

export const MAX_SLOTS = 6;
export const DEFAULT_WALK_TIME = 5;

/** Destinations at the row's own size, which is what the panel shipped with. */
export const DEFAULT_DESTINATION_SCALE = 1;
/**
 * Minutes before you must leave, below which a row is highlighted.
 *
 * Was 10, which marked 33 of the demo board's 62 rows: once half the panel
 * is inverted the highlight has stopped distinguishing anything. 5 is the
 * value at which it still picks out a minority — and it must match the
 * form's own default, or a field left untouched and a field cleared mean
 * different things.
 */
export const DEFAULT_URGENT_THRESHOLD = 5;
export const DEFAULT_FETCH_DEPARTURES = 8;




/**
 * Hold the destination scale inside the range where a row still works.
 *
 * Clamped rather than validated: a board must render whatever arrives,
 * and a destination at 3x or 0.1x is not a board. The ends are where the
 * row stops working — below 0.7 the 1-bit panel cannot resolve the
 * glyphs, above 1.3 a destination crowds out the clock beside it.
 *
 * Shared with the JSON parser so both read the same setting the same way.
 */
export function clampDestinationScale(value: number): number {
  return Math.min(1.3, Math.max(0.7, value));
}

export function parseTransitType(value: string): TransitType | undefined {
  const normalised = value.trim().toLowerCase();
  // The form shows friendly names; map them to the internal union rather than
  // making users' stored settings depend on our type spelling.
  const aliases: Record<string, TransitType> = {
    subway: "subway",
    lirr: "railroad-lirr",
    "railroad-lirr": "railroad-lirr",
    "metro-north": "railroad-mtn",
    mtn: "railroad-mtn",
    "railroad-mtn": "railroad-mtn",
    bus: "bus",
    ferry: "ferry",
  };
  return aliases[normalised];
}


/**
 * The board a plugin shows before anyone has configured it.
 *
 * Two problems, one answer. A new installer would otherwise see a blank panel
 * and have to guess that the fault is their own empty form. And the public
 * recipe page renders a preview from whatever the author's own instance holds,
 * which would publish the author's home stations to everyone browsing the
 * directory.
 *
 * So an unconfigured board shows a demonstration instead: three well-known
 * Manhattan stations nobody lives at, exercising all three transit types, with
 * walk times that make the filtering visible. It is real live data — the
 * stations exist and the feeds are current — so the preview shows what the
 * plugin genuinely does rather than a mock-up of it.
 */
export const DEMO_CARDS: CardSettings[] = [
  {
    slot: 1,
    transitType: "subway",
    // Times Square, all five platform groups, as the picker would supply them.
    stopIds: ["127", "725", "902", "A27", "R16"],
    walkTime: 5,
    title: "Times Sq-42 St",
  },
  {
    slot: 2,
    transitType: "subway",
    // The same complex narrowed to one platform group, which is how a rider
    // splits a station carrying twelve routes into something readable. Shown
    // beneath the full card so the preview demonstrates the difference.
    stopIds: ["R16"],
    walkTime: 5,
    routes: ["N", "Q", "R", "W"],
    title: "Custom name",
  },
  {
    slot: 3,
    transitType: "railroad-lirr",
    // Jamaica, not Penn Station. At a terminal most trains run to their
    // branch's namesake, so badge and destination repeat on three rows in
    // four — "Ronkonkoma | Ronkonkoma" — and the card reads as a column of
    // the same word twice. Jamaica is the LIRR's hub, where nearly every
    // train passes through: 10 branches, 13 destinations, and trains in
    // both directions, which is what the Metro-North card beside it shows.
    stopIds: ["102"],
    walkTime: 10,
    title: "Jamaica",
  },
  {
    slot: 4,
    transitType: "bus",
    // Both sides of the street. A bus stop ID is one direction, so a corner
    // takes two — the single thing about bus cards a new installer most
    // needs to see, and the preview can show it for free.
    stopIds: ["403257", "403465"],
    walkTime: 5,
    title: "W 42 St/5 Av",
  },
  {
    slot: 5,
    transitType: "railroad-mtn",
    stopIds: ["1"], // Grand Central
    walkTime: 10,
    title: "Grand Central",
  },
  {
    slot: 6,
    transitType: "ferry",
    stopIds: ["87"], // Wall St/Pier 11, the busiest landing
    walkTime: 5,
    title: "Wall St/Pier 11",
  },
];
