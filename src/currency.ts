import * as vscode from "vscode";

export type DisplayCurrency = "USD" | "EUR";

export interface CurrencyPrefs {
  currency: DisplayCurrency;
  /** How many EUR for 1 USD. Used only when currency is EUR. */
  eurPerUsd: number;
}

const DEFAULT_EUR_PER_USD = 0.92;

export function getCurrencyPrefs(): CurrencyPrefs {
  const cfg = vscode.workspace.getConfiguration("cursorUsage");
  const raw = cfg.get<string>("currency", "USD");
  const currency: DisplayCurrency = raw === "EUR" ? "EUR" : "USD";
  const eurPerUsd = cfg.get<number>("eurPerUsd", DEFAULT_EUR_PER_USD);
  return {
    currency,
    eurPerUsd:
      typeof eurPerUsd === "number" && eurPerUsd > 0
        ? eurPerUsd
        : DEFAULT_EUR_PER_USD,
  };
}

export async function setDisplayCurrency(
  currency: DisplayCurrency
): Promise<void> {
  await vscode.workspace
    .getConfiguration("cursorUsage")
    .update("currency", currency, vscode.ConfigurationTarget.Global);
}

/** Format USD-cent amounts from Cursor APIs into the selected display currency. */
export function formatMoneyFromUsdCents(
  usdCents: number | null | undefined,
  prefs: CurrencyPrefs
): string {
  if (usdCents == null || !Number.isFinite(usdCents)) {
    return "—";
  }
  const usd = usdCents / 100;
  if (prefs.currency === "EUR") {
    return `€${(usd * prefs.eurPerUsd).toFixed(2)}`;
  }
  return `$${usd.toFixed(2)}`;
}
