import { existsSync } from "node:fs";
import type { Browser, BrowserContext, Page } from "playwright";
import { chromium } from "playwright";
import { STORAGE_STATE_PATH, type RpaConfig } from "../config.js";
import { logger } from "../logger.js";

// ─── Checkatrade selectors — verified live on 2026-07-06 ────────────────
// Login is Auth0-hosted (login.trade.checkatrade.com) and multi-step:
//   1. /login → "Trade log in" → Auth0 identifier screen (email only).
//   2. Submitting the email AUTO-SENDS a passwordless email code and shows
//      an "Enter your email code" screen with a "Login with password"
//      button — click that instead of waiting for the code.
//   3. Password screen → submit → redirects to https://membersapp.checkatrade.com/home.
const LOGIN_URL = "https://membersapp.checkatrade.com/login";
const EMAIL_SELECTOR = "#username";
const PASSWORD_SELECTOR = "#password";
// Both the identifier-step "Continue" and the password-step "Login" button
// share this attribute in Auth0's default template.
const PRIMARY_SUBMIT_SELECTOR = '[data-action-button-primary="true"]';
const LOGIN_WITH_PASSWORD_TEXT = "Login with password";
const DASHBOARD_URL = "https://membersapp.checkatrade.com/home";

export async function getOrCreateContext(
  cfg: RpaConfig,
): Promise<{ browser: Browser; context: BrowserContext; page: Page }> {
  const browser = await chromium.launch({ headless: cfg.headless });
  const hasStorageState = existsSync(STORAGE_STATE_PATH);
  /**
   * O navegador do RPA vive em Londres, aconteça o que acontecer com a máquina.
   *
   * O members app do Checkatrade desenha a data do slot no fuso do NAVEGADOR, e
   * a data dele vem sem hora. Sem fixar nada, o Chromium herdava o fuso do Mac,
   * que é São Paulo, três horas atrás: toda data caía para o dia anterior. Visto
   * no log em 22/08/2026, às 19:25 de Londres, um job com três slots
   * (Morning/Afternoon/Evening) lido como "offered: 2026-08-22 x3" — slots de
   * hoje à noite que não existem. Eram de 23/08.
   *
   * Isso mandou 8 jobs para o OS um dia antes do que o cliente marcou, e dois
   * clientes ligaram no mesmo dia dizendo que era terça e não segunda.
   *
   * O conserto é o relógio, não um "+1 dia" no resultado: somar um dia fixo
   * quebraria no dia em que o RPA rodar de uma máquina em Londres (aí seriam
   * dois erros somados), e quebraria de novo se o Checkatrade passar a mandar a
   * data com hora. Fixando o fuso, o RPA lê exatamente o que o cliente lê.
   */
  const context = await browser.newContext({
    timezoneId: "Europe/London",
    locale: "en-GB",
    ...(hasStorageState ? { storageState: STORAGE_STATE_PATH } : {}),
  });
  const page = await context.newPage();

  if (!hasStorageState) {
    await login(page, cfg);
    await context.storageState({ path: STORAGE_STATE_PATH });
    logger.info("Saved fresh Checkatrade session", { path: STORAGE_STATE_PATH });
  } else if (!(await isLoggedIn(page))) {
    logger.warn("Saved session expired, logging in again");
    await login(page, cfg);
    await context.storageState({ path: STORAGE_STATE_PATH });
  }

  return { browser, context, page };
}

/** True when the URL is the app proper (not the login screen, which also lives on membersapp). */
function urlLooksLoggedIn(url: string): boolean {
  return url.startsWith("https://membersapp.checkatrade.com") && !url.includes("/login");
}

async function isLoggedIn(page: Page): Promise<boolean> {
  // A slow load must not read as "logged out". The old version returned false
  // from a bare catch, so a 15s timeout on a heavy page sent a perfectly good
  // session into login() — which then crashed, because /login redirects
  // straight back into the app when you're already authenticated and the
  // "Trade log in" button it waits for never appears. Retry before concluding.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await page.goto(DASHBOARD_URL, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
      return urlLooksLoggedIn(page.url());
    } catch (err) {
      logger.warn(`isLoggedIn attempt ${attempt} failed to load ${DASHBOARD_URL}: ${String(err)}`);
      await page.waitForTimeout(3_000);
    }
  }
  // Couldn't tell. Say "logged in" — login() is now self-healing, so a wrong
  // guess here costs one wasted navigation instead of a crash loop.
  return true;
}

/** Thrown by the scraper when Checkatrade redirected the cycle to /login. */
export class SessionExpiredError extends Error {
  constructor() {
    super("Checkatrade session expired (redirected to login)");
  }
}

/** Mid-run recovery: log in again on the SAME page/context and persist the fresh session. */
export async function reLogin(page: Page, context: BrowserContext, cfg: RpaConfig): Promise<void> {
  await login(page, cfg);
  await context.storageState({ path: STORAGE_STATE_PATH });
  logger.info("Refreshed Checkatrade session after mid-run expiry");
}

async function login(page: Page, cfg: RpaConfig): Promise<void> {
  // domcontentloaded + folga: o "load" completo da tela de login passa fácil
  // dos 30s padrão no container e derrubava o processo na largada.
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

  // Already authenticated? /login bounces into the app and there is no "Trade
  // log in" button to click — waiting for one threw and killed the process
  // (fatal, since getOrCreateContext failure exits the container). Treat it as
  // success: we're logged in, which is all the caller wanted.
  if (urlLooksLoggedIn(page.url())) {
    logger.info("Already authenticated — /login redirected into the app; skipping login flow");
    return;
  }

  const tradeLogIn = page.getByText("Trade log in", { exact: true });
  if (!(await tradeLogIn.isVisible({ timeout: 15_000 }).catch(() => false))) {
    // No button and no app URL either — an interstitial (Cloudflare, an
    // outage page). Say which, rather than a bare selector timeout.
    const body = await page.locator("body").innerText().catch(() => "");
    if (/Sorry, you have been blocked|Cloudflare Ray ID|Just a moment/i.test(body)) {
      throw new Error("Cloudflare is blocking the login page — wait for the rate limit to clear.");
    }
    throw new Error(`Login page has no "Trade log in" button. URL=${page.url()}`);
  }
  await tradeLogIn.click();

  await page.locator(EMAIL_SELECTOR).waitFor({ timeout: 15_000 });
  await page.locator(EMAIL_SELECTOR).fill(cfg.env.checkatradeEmail);
  await page.locator(PRIMARY_SUBMIT_SELECTOR).click();

  // This lands on the "Enter your email code" passwordless screen — bail
  // out to the password flow instead.
  await page.getByText(LOGIN_WITH_PASSWORD_TEXT, { exact: true }).click({ timeout: 15_000 });

  await page.locator(PASSWORD_SELECTOR).waitFor({ timeout: 15_000 });
  await page.locator(PASSWORD_SELECTOR).fill(cfg.env.checkatradePassword);
  await page.locator(PRIMARY_SUBMIT_SELECTOR).click();

  await page.waitForURL(`${DASHBOARD_URL}**`, { timeout: 30_000 });
}
