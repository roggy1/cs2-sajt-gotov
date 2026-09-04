import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { useLocalStorage } from "@/lib/skins";
import {
  directionFor,
  isAlertMet,
  migrateAlerts,
  migrateNotifications,
  type AlertPriceEntry,
  type AlertSubject,
  type PriceAlert,
  type PriceNotification,
} from "@/lib/alertModel";
import type { MarketplaceId } from "@/lib/markets/types";

// Re-exported as TYPES only, so every consumer can keep importing the alert
// vocabulary from one place without this file exporting values it does not
// own (which is also what keeps Fast Refresh happy).
export type {
  AlertDirection,
  AlertPriceEntry,
  AlertSource,
  AlertSubject,
  PriceAlert,
  PriceNotification,
} from "@/lib/alertModel";

/**
 * Storage and wiring for price alerts.
 *
 * Two separate records on purpose. An ALERT is the user's standing intent
 * ("tell me when this hits €40") and lives until they remove it; a
 * NOTIFICATION is one thing that already happened and is read once. Folding
 * them together would mean either losing the alert when it fires or
 * re-announcing the same crossing on every price refresh.
 *
 * Everything is stored in EUR, the app's internal currency — the display
 * currency is applied at render time by `useMoney`, so switching currency
 * never rewrites a target the user typed.
 */

const ALERTS_KEY = "cs2-price-alerts";
const NOTIFICATIONS_KEY = "cs2-price-notifications";

/** Most recent notifications kept; older ones are dropped on write. */
const MAX_NOTIFICATIONS = 50;

export interface AlertsContextValue {
  alerts: PriceAlert[];
  alertFor: (itemId: string) => PriceAlert | undefined;
  /** Creates or replaces the alert on one holding or wishlist entry. */
  setAlert: (subject: AlertSubject, targetPrice: number, currentPrice?: number | undefined) => void;
  removeAlert: (itemId: string) => void;
  notifications: PriceNotification[];
  unreadCount: number;
  markRead: (id: string) => void;
  markAllRead: () => void;
  clearNotifications: () => void;
  /**
   * Re-checks every alert against the prices it is given.
   *
   * Takes prices rather than records so that holdings (net of the active
   * market's fee) and wishlist entries (a plain tracked price) can be
   * checked in one pass, and so this file never needs to know how either
   * one is priced. Called on load and after each price refresh, and
   * idempotent: running it twice on unchanged prices produces nothing the
   * second time.
   */
  evaluate: (entries: AlertPriceEntry[], marketplace: MarketplaceId) => void;
}

const AlertsCtx = createContext<AlertsContextValue>({
  alerts: [],
  alertFor: () => undefined,
  setAlert: () => {},
  removeAlert: () => {},
  notifications: [],
  unreadCount: 0,
  markRead: () => {},
  markAllRead: () => {},
  clearNotifications: () => {},
  evaluate: () => {},
});

export function AlertsProvider({ children }: { children: ReactNode }) {
  const [alerts, setAlerts] = useLocalStorage<PriceAlert[]>(ALERTS_KEY, [], migrateAlerts);
  const [notifications, setNotifications] = useLocalStorage<PriceNotification[]>(
    NOTIFICATIONS_KEY,
    [],
    migrateNotifications,
  );

  const alertFor = useCallback((itemId: string) => alerts.find((a) => a.id === itemId), [alerts]);

  const setAlert = useCallback(
    (subject: AlertSubject, targetPrice: number, currentPrice?: number | undefined) => {
      const next: PriceAlert = {
        ...subject,
        targetPrice,
        basePrice: currentPrice,
        direction: directionFor(targetPrice, currentPrice),
        createdAt: Date.now(),
        // Armed even when the target is already met: the user just asked to
        // be told about this price, so the next evaluation should say so.
        armed: true,
      };
      setAlerts((prev) => [next, ...prev.filter((a) => a.id !== subject.id)]);
    },
    [setAlerts],
  );

  const removeAlert = useCallback(
    (itemId: string) => setAlerts((prev) => prev.filter((a) => a.id !== itemId)),
    [setAlerts],
  );

  const markRead = useCallback(
    (id: string) =>
      setNotifications((prev) =>
        prev.map((n) => (n.notificationId === id ? { ...n, read: true } : n)),
      ),
    [setNotifications],
  );

  const markAllRead = useCallback(
    () => setNotifications((prev) => prev.map((n) => (n.read ? n : { ...n, read: true }))),
    [setNotifications],
  );

  const clearNotifications = useCallback(() => setNotifications([]), [setNotifications]);

  const evaluate = useCallback(
    (entries: AlertPriceEntry[], marketplace: MarketplaceId) => {
      if (alerts.length === 0) return;

      const priceById = new Map(entries.map((e) => [e.id, e.price]));
      const fired: PriceNotification[] = [];
      let changed = false;

      const nextAlerts = alerts.map((alert) => {
        const price = priceById.get(alert.id);
        // Either the item is gone from its list, or it has no tracked price
        // yet. Neither is a crossing, and neither should re-arm the alert.
        if (price === undefined) return alert;

        // An alert set before any price was known picks its direction from
        // the first quote it ever sees, and deliberately does not fire on
        // that pass — there is nothing to compare against yet.
        if (alert.direction === "either" && alert.basePrice === undefined) {
          changed = true;
          return {
            ...alert,
            basePrice: price,
            direction: directionFor(alert.targetPrice, price),
          };
        }

        const met = isAlertMet(alert, price);

        if (met && alert.armed) {
          const { targetPrice, basePrice, direction, createdAt, armed, triggeredAt, ...subject } =
            alert;
          void basePrice;
          void createdAt;
          void armed;
          void triggeredAt;
          fired.push({
            ...subject,
            notificationId: crypto.randomUUID(),
            price,
            targetPrice,
            market: marketplace,
            direction: direction === "below" ? "down" : "up",
            createdAt: Date.now(),
            read: false,
          });
          changed = true;
          return { ...alert, armed: false, triggeredAt: Date.now() };
        }

        // Back on the other side of the target — ready to fire again.
        if (!met && !alert.armed) {
          changed = true;
          return { ...alert, armed: true };
        }

        return alert;
      });

      if (changed) setAlerts(nextAlerts);
      if (fired.length > 0) {
        setNotifications((prev) => [...fired, ...prev].slice(0, MAX_NOTIFICATIONS));
      }
    },
    // `alerts` is a dependency on purpose: a freshly created alert whose
    // target is ALREADY met should be announced on the next render, not
    // held back until the next price refresh. The pass is idempotent, so
    // the re-run it causes settles immediately with nothing to change.
    [alerts, setAlerts, setNotifications],
  );

  const unreadCount = useMemo(() => notifications.filter((n) => !n.read).length, [notifications]);

  const value = useMemo<AlertsContextValue>(
    () => ({
      alerts,
      alertFor,
      setAlert,
      removeAlert,
      notifications,
      unreadCount,
      markRead,
      markAllRead,
      clearNotifications,
      evaluate,
    }),
    [
      alerts,
      alertFor,
      setAlert,
      removeAlert,
      notifications,
      unreadCount,
      markRead,
      markAllRead,
      clearNotifications,
      evaluate,
    ],
  );

  return <AlertsCtx.Provider value={value}>{children}</AlertsCtx.Provider>;
}

export const useAlerts = () => useContext(AlertsCtx);
