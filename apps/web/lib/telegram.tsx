"use client";

import {
  backButton,
  bindViewportCssVars,
  closeMiniApp,
  hapticFeedbackImpactOccurred,
  hapticFeedbackNotificationOccurred,
  init,
  isTMA,
  isThemeParamsDark,
  mainButton,
  miniApp,
  offBackButtonClick,
  offMainButtonClick,
  onBackButtonClick,
  onMainButtonClick,
  retrieveRawInitData,
  themeParams,
  viewport,
} from "@telegram-apps/sdk-react";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { setTelegramInitData } from "./session";

/** Every SDK call is optional: older clients lack some features, and none of them may break the page. */
const safe = <T,>(fn: () => T): T | undefined => {
  try {
    return fn();
  } catch {
    return undefined;
  }
};

interface Tg {
  inTelegram: boolean;
  ready: boolean;
  close: () => void;
}
const Ctx = createContext<Tg>({ inTelegram: false, ready: false, close: () => undefined });
export const useTelegram = () => useContext(Ctx);

/**
 * Mini App bootstrap: init, ready(), expand(), Telegram theme → CSS variables, and initData for
 * every API call. `onOutside` runs when the page was opened in a normal browser.
 */
export function TelegramProvider({ children, onOutside }: { children: ReactNode; onOutside: () => void }) {
  const [state, setState] = useState<Tg>({ inTelegram: false, ready: false, close: () => undefined });

  useEffect(() => {
    const inTg = Boolean(safe(() => isTMA()));
    if (!inTg) {
      onOutside();
      return;
    }
    safe(() => init());
    safe(() => miniApp.mountSync());
    safe(() => themeParams.mountSync());
    safe(() => themeParams.bindCssVars());
    safe(() => miniApp.bindCssVars());
    void safe(() => viewport.mount())?.then(() => {
      safe(() => viewport.expand());
      safe(() => bindViewportCssVars()); // --tg-viewport-* incl. safe-area insets
    });
    // follow Telegram light/dark so our palette (and contrast) matches the chat around it
    const dark = safe(() => isThemeParamsDark());
    if (dark != null) document.documentElement.dataset.theme = dark ? "dark" : "light";
    safe(() => backButton.mount());
    safe(() => mainButton.mount());
    safe(() => miniApp.ready());
    setTelegramInitData(safe(() => retrieveRawInitData()) ?? null);
    setState({ inTelegram: true, ready: true, close: () => safe(() => closeMiniApp()) });
    return () => setTelegramInitData(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}

/** Haptics for the moments that matter. No-ops outside Telegram or on clients without them. */
export const haptic = {
  success: () => void safe(() => hapticFeedbackNotificationOccurred("success")),
  error: () => void safe(() => hapticFeedbackNotificationOccurred("error")),
  tap: () => void safe(() => hapticFeedbackImpactOccurred("light")),
};

/** Shows Telegram's BackButton while mounted. */
export function useBackButton(onBack: () => void) {
  const { inTelegram } = useTelegram();
  useEffect(() => {
    if (!inTelegram) return;
    safe(() => backButton.show());
    safe(() => onBackButtonClick(onBack));
    return () => {
      safe(() => offBackButtonClick(onBack));
      safe(() => backButton.hide());
    };
  }, [inTelegram, onBack]);
}

/** Telegram's MainButton as the screen's primary action (Buy / Lock it). Hidden when `text` is null. */
export function useMainButton(text: string | null, onClick: () => void, opts: { enabled?: boolean; loading?: boolean } = {}) {
  const { inTelegram } = useTelegram();
  const { enabled = true, loading = false } = opts;
  useEffect(() => {
    if (!inTelegram) return;
    if (!text) {
      safe(() => mainButton.setParams({ isVisible: false }));
      return;
    }
    safe(() => mainButton.setParams({ text, isVisible: true, isEnabled: enabled && !loading, isLoaderVisible: loading }));
    safe(() => onMainButtonClick(onClick));
    return () => {
      safe(() => offMainButtonClick(onClick));
      safe(() => mainButton.setParams({ isVisible: false }));
    };
  }, [inTelegram, text, onClick, enabled, loading]);
}
