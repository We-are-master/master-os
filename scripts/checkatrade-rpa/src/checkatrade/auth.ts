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
  const context = await browser.newContext(hasStorageState ? { storageState: STORAGE_STATE_PATH } : {});
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

async function isLoggedIn(page: Page): Promise<boolean> {
  try {
    await page.goto(DASHBOARD_URL, { waitUntil: "domcontentloaded", timeout: 15_000 });
    // Auth0 redirects an expired session away to login.trade.checkatrade.com.
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    return page.url().startsWith("https://membersapp.checkatrade.com");
  } catch {
    return false;
  }
}

async function login(page: Page, cfg: RpaConfig): Promise<void> {
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });
  await page.getByText("Trade log in", { exact: true }).click();

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
