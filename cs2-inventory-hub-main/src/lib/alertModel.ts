/**
 * The price-alert domain model.
 *
 * Deliberately free of React: these are the rules that decide whether a
 * price counts as "reached", and they are the part worth reading (and
 * testing) on their own. `alerts.tsx` holds the provider that stores them
 * and wires them to the UI.
 */
import { catalogDisplayName } from "@/lib/catalog/doppler";
import type { Skin, WishItem } from "@/lib/skins";
import type { MarketplaceId } from "@/lib/markets/types";
import type { Wear } from "@/lib/wear";

/**
 * Which way the price has to move to satisfy the alert.
 *
 * Derived from the price at the moment the alert was created rather than
 * asked of the user: a target ABOVE today's price can only be a "tell me
 * when it rises", and one below can only be a drop. `either` is the
 * fallback for an alert set on an item with no known price yet — the first
 * quote that arrives decides the direction.
 */
export type AlertDirection = "above" | "below" | "either";

/**
 * Which list the watched item lives in.
 *
 * Kept on the record because the two lists answer different questions — a
 * portfolio alert usually watches for a rise, a wishlist alert for a drop —
 * and because an id is only unique WITHIN its list.
 */
export type AlertSource = "portfolio" | "wishlist";

/**
 * Everything the alert layer needs to know about the thing being watched.
 *
 * Holdings and wishlist entries are different records with different
 * fields, so both are converted to this shape at the edge (see
 * `subjectFromSkin` / `subjectFromWish`). The alert layer itself then has
 * exactly one kind of subject to reason about, and the notification it
 * produces already carries what the Inspect link needs.
 */
export interface AlertSubject {
  id: string;
  /** Display name, phase suffix included. */
  name: string;
  wear?: Wear | undefined;
  image?: string | undefined;
  stattrak?: boolean | undefined;
  souvenir?: boolean | undefined;
  /** Catalog id, when the item was picked from the item database. */
  catalogId?: string | undefined;
  source: AlertSource;
}

export function subjectFromSkin(skin: Skin): AlertSubject {
  return {
    id: skin.id,
    name: catalogDisplayName(skin),
    wear: skin.wear,
    image: skin.image,
    stattrak: skin.stattrak,
    souvenir: skin.souvenir,
    source: "portfolio",
  };
}

export function subjectFromWish(item: WishItem): AlertSubject {
  return {
    id: item.id,
    name: item.name,
    wear: item.wear,
    image: item.image,
    catalogId: item.catalogId,
    source: "wishlist",
  };
}

export interface PriceAlert extends AlertSubject {
  /** Target price in EUR. */
  targetPrice: number;
  /** Market price when the alert was set, in EUR — the reference the
   * direction is derived from. */
  basePrice?: number | undefined;
  direction: AlertDirection;
  createdAt: number;
  /**
   * False while the target is currently met.
   *
   * This is what keeps one crossing to one notification. It only re-arms
   * once the price moves back to the other side of the target, so a
   * portfolio sitting above its target for a week does not generate a
   * notification on every refresh.
   */
  armed: boolean;
  triggeredAt?: number | undefined;
}

export interface PriceNotification extends AlertSubject {
  /** Unique per notification — `id` on the subject identifies the ITEM. */
  notificationId: string;
  /** Price that triggered it, in EUR. */
  price: number;
  targetPrice: number;
  market: MarketplaceId;
  /** Which way the price moved into the target. */
  direction: "up" | "down";
  createdAt: number;
  read: boolean;
}

/** One item's current price, as handed to `evaluate`. */
export interface AlertPriceEntry {
  id: string;
  /** EUR, already net of fees where that applies. `undefined` = untracked,
   * which never triggers and never re-arms. */
  price: number | undefined;
}

/**
 * Brings alerts written by an older build up to date.
 *
 * The first version keyed alerts on `skinId` and only ever watched the
 * portfolio. Rewriting them here (rather than tolerating both shapes
 * everywhere) keeps every downstream reader on one record type.
 */
export function migrateAlerts(raw: unknown): PriceAlert[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const legacy = entry as Partial<PriceAlert> & { skinId?: string };
    const id = legacy.id ?? legacy.skinId;
    if (!id || typeof legacy.targetPrice !== "number") return [];
    return [{ ...legacy, id, source: legacy.source ?? "portfolio" } as PriceAlert];
  });
}

/** Same migration for stored notifications. */
export function migrateNotifications(raw: unknown): PriceNotification[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const legacy = entry as Partial<PriceNotification> & { skinId?: string; id?: string };
    const itemId = legacy.skinId ?? legacy.id;
    const notificationId = legacy.notificationId ?? legacy.id;
    if (!itemId || !notificationId || typeof legacy.price !== "number") return [];
    return [
      {
        ...legacy,
        id: itemId,
        notificationId,
        source: legacy.source ?? "portfolio",
      } as PriceNotification,
    ];
  });
}

/** Direction implied by a target relative to the price when it was set. */
export function directionFor(targetPrice: number, basePrice: number | undefined): AlertDirection {
  if (basePrice === undefined || !Number.isFinite(basePrice)) return "either";
  if (targetPrice > basePrice) return "above";
  if (targetPrice < basePrice) return "below";
  return "either";
}

/** Whether a live price satisfies an alert right now. */
export function isAlertMet(alert: PriceAlert, price: number): boolean {
  switch (alert.direction) {
    case "above":
      return price >= alert.targetPrice;
    case "below":
      return price <= alert.targetPrice;
    case "either":
      // No reference price existed, so any exact hit or crossing counts.
      return price === alert.targetPrice;
  }
}
