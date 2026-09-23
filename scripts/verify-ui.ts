#!/usr/bin/env tsx
/**
 * Browser smoke test for the dashboard.
 *
 * The pages are client components that fill in through React Query after
 * hydration, so fetching their HTML proves only that the skeletons render. This
 * drives a real browser instead: it waits for the data to arrive, asserts the
 * on-chain figures actually appear, and fails on any console error or failed
 * request along the way.
 *
 * Point it at a seeded local deployment (see scripts/seed.ts), otherwise the
 * pages legitimately show empty states and there is nothing to assert.
 *
 *   npm run verify:ui
 *   npm run verify:ui -- --url http://localhost:3000 --screenshots
 */
import { chromium, type Browser, type ConsoleMessage, type Page } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const BASE_URL = valueOf('--url') ?? process.env.VERIFY_UI_URL ?? 'http://localhost:3000';
const SHOTS = args.includes('--screenshots');
const SHOT_DIR = join(process.cwd(), '.upkeep', 'screenshots');

function valueOf(flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

/*//////////////////////////////////////////////////////////////
                         BROWSER LOOKUP
//////////////////////////////////////////////////////////////*/

/** Find a Chromium playwright already cached, or fall back to system Chrome. */
function findBrowser(): string | undefined {
  const cache =
    process.env.PLAYWRIGHT_BROWSERS_PATH ||
    join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');

  if (existsSync(cache)) {
    for (const entry of readdirSync(cache)) {
      if (!entry.startsWith('chromium')) continue;
      for (const candidate of [
        join(cache, entry, 'chrome-win', 'chrome.exe'),
        join(cache, entry, 'chrome-win', 'headless_shell.exe'),
        join(cache, entry, 'chrome-linux', 'chrome'),
        join(cache, entry, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
      ]) {
        if (existsSync(candidate)) return candidate;
      }
    }
  }

  for (const candidate of [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ]) {
    if (existsSync(candidate)) return candidate;
  }

  return undefined;
}

/*//////////////////////////////////////////////////////////////
                             HARNESS
//////////////////////////////////////////////////////////////*/

let checks = 0;
let failures = 0;

function check(label: string, ok: boolean, detail?: string) {
  checks++;
  if (ok) {
    console.log(`  PASS  ${label}${detail ? `  ${detail}` : ''}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `  ${detail}` : ''}`);
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

/** Console errors and failed requests seen on the page currently under test. */
interface PageProblems {
  consoleErrors: string[];
  failedRequests: string[];
}

function watch(page: Page): PageProblems {
  const problems: PageProblems = { consoleErrors: [], failedRequests: [] };

  page.on('console', (message: ConsoleMessage) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    // A bare "Failed to load resource" carries no URL, so check where it came
    // from - otherwise a real 404 hides behind an unmatchable message.
    const source = message.location()?.url ?? '';
    if (/ERR_BLOCKED_BY_CLIENT|chrome-extension/i.test(text + source)) return;
    if (/fonts\.gstatic|fonts\.googleapis|[?&]_rsc=/i.test(source)) return;
    problems.consoleErrors.push(source ? `${text} (${source})` : text);
  });

  page.on('requestfailed', (request) => {
    const url = request.url();
    // Next.js prefetches RSC payloads for links in view; those requests are
    // aborted when the page closes, which is expected rather than an error.
    if (/favicon|fonts\.gstatic|fonts\.googleapis|[?&]_rsc=/i.test(url)) return;
    problems.failedRequests.push(`${request.method()} ${url}`);
  });

  page.on('response', (response) => {
    if (response.status() >= 500) {
      problems.failedRequests.push(`${response.status()} ${response.url()}`);
    }
  });

  return problems;
}

async function visit(browser: Browser, path: string) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const problems = watch(page);

  await page.goto(`${BASE_URL}${path}`, { waitUntil: 'networkidle', timeout: 45_000 });
  // React Query fills in after hydration; give it a beat to settle.
  await page.waitForTimeout(1200);

  return { page, problems };
}

async function shoot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: join(SHOT_DIR, `${name}.png`), fullPage: true });
}

/**
 * Assert visible text, which is what a person would actually see.
 *
 * Case-insensitive on purpose: several labels are uppercased purely in CSS
 * (`text-transform`), and innerText reflects that, so matching exact casing
 * would be asserting the stylesheet rather than the content.
 */
async function seesText(page: Page, needle: string): Promise<boolean> {
  const body = await page.locator('body').innerText();
  return body.toLowerCase().includes(needle.toLowerCase());
}

function reportProblems(label: string, problems: PageProblems) {
  check(`${label}: no console errors`, problems.consoleErrors.length === 0, problems.consoleErrors[0]);
  check(
    `${label}: no failed requests`,
    problems.failedRequests.length === 0,
    problems.failedRequests[0],
  );
}

/*//////////////////////////////////////////////////////////////
                              RUN
//////////////////////////////////////////////////////////////*/

async function main() {
  const executablePath = findBrowser();
  if (!executablePath) {
    console.error('No Chromium or Chrome found. Install one, or run: npx playwright install chromium');
    process.exit(1);
  }

  console.log('upKEEP UI verification');
  console.log(`  url     : ${BASE_URL}`);
  console.log(`  browser : ${executablePath}`);

  const browser = await chromium.launch({ executablePath, headless: true });

  try {
    /*//////////////////////////////////////////////////////////////
                              LANDING
    //////////////////////////////////////////////////////////////*/

    section('Landing page');
    {
      const { page, problems } = await visit(browser, '/');
      check('Renders the hero', await seesText(page, 'Financial conditions that act on Arc'));
      check('States the network', await seesText(page, 'Arc Mainnet'));
      check('Shows the fee', await seesText(page, '0.05%'));
      check('Positions as an engine', await seesText(page, 'first condition type'));
      check('Shows the SDK example', await seesText(page, 'createUpkeepClient'));

      // Positioning from the bio.
      check('Carries the positioning line', await seesText(page, 'Reusable automation'));
      check('States permissioned execution', await seesText(page, 'Permissioned execution'));
      check('States the architecture claim', await seesText(page, 'Post-quantum-ready architecture'));
      check('Shows the primitive', await seesText(page, 'Condition'));
      check('Shows the migration path', await seesText(page, 'Same upKEEP conditions'));

      // Reuse has to be demonstrated, not just claimed: the same three slots
      // filled differently, with an honest status on each row.
      check('Demonstrates reuse', await seesText(page, 'The same three slots'));
      check('Shows a reused workflow', await seesText(page, 'Agent budgets'));
      check('Marks what runs today', await seesText(page, 'Available today'));
      check('Marks what is not built', await seesText(page, 'Needs a new evaluator'));
      // The payout workflow is now live on the same evaluator, not "not enabled".
      check('Payouts are marked live', await seesText(page, 'same deployed evaluator'));
      // Reuse by other builders, with its real status rather than a promise.
      check('Covers SDK reuse', await seesText(page, 'Developers can build on it too'));
      check('States the SDK works today', await seesText(page, 'written, tested and in use'));
      check('States npm is still to come', await seesText(page, 'npm install @upkeep/sdk'));

      /*
       * The landing page is where a security claim is most likely to creep in,
       * so the prohibited phrases are checked against the rendered marketing
       * copy, not just the SDK constants.
       */
      const landingBody = (await page.locator('body').innerText()).toLowerCase();
      for (const banned of ['quantum safe','quantum-safe','quantum proof','quantum-proof']) {
        check(`Landing never claims "${banned}"`, !landingBody.includes(banned));
      }
      // "post-quantum secure" may appear only as an explicit denial.
      const secureClaims = landingBody.split('post-quantum secure').length - 1;
      const denials = (landingBody.match(/not post-quantum secure/g) ?? []).length;
      check('Any "post-quantum secure" mention is a denial', secureClaims === denials,
        `${secureClaims} mention(s), ${denials} denial(s)`);

      check('Carries the honest disclaimer',
        await seesText(page, 'makes no post-quantum security claim'));

      reportProblems('Landing', problems);
      await shoot(page, 'landing');
      await page.close();
    }

    /*//////////////////////////////////////////////////////////////
                             EXECUTIONS
        Reads real chain logs and needs no connected wallet, so it
        is the best proof that live data reaches the UI.
    //////////////////////////////////////////////////////////////*/

    section('Executions (live chain data)');
    {
      const { page, problems } = await visit(browser, '/executions');

      check('Page header', await seesText(page, 'Executions'));

      const hasRow = await seesText(page, '$500.00');
      check('Shows the seeded execution amount', hasRow, '$500.00');
      check('Shows the protocol fee', await seesText(page, '$0.25'));
      check('Shows the net amount', await seesText(page, '$499.75'));
      check('Shows a confirmed status', await seesText(page, 'Confirmed'));
      check('Shows aggregate stats', await seesText(page, 'USDC automated'));

      // A real explorer link, not a demo placeholder.
      const explorerLink = await page
        .locator('a[href*="/tx/0x"]')
        .first()
        .getAttribute('href')
        .catch(() => null);
      check('Links the transaction to the explorer', Boolean(explorerLink), explorerLink ?? undefined);

      reportProblems('Executions', problems);
      await shoot(page, 'executions');
      await page.close();
    }

    /*//////////////////////////////////////////////////////////////
                        CONDITION DETAIL
    //////////////////////////////////////////////////////////////*/

    section('Condition detail (the triggered one)');
    {
      const { page, problems } = await visit(browser, '/conditions/2');

      check('Shows the live balance', await seesText(page, '$1,740.00'));
      check('Shows the threshold', await seesText(page, '$2,000.00'));
      check('Shows the triggered status', await seesText(page, 'Triggered'));
      check('Shows the latch state', await seesText(page, 'Latched'));
      check('Shows the IF/THEN rule', await seesText(page, 'Transfer'));
      check('Shows the permission block', await seesText(page, 'Maximum transfer'));
      check('States the scope limit', await seesText(page, 'can only execute the action defined above'));
      check('Shows execution history', await seesText(page, '$500.00'));

      // The Security panel: present, honest, and free of prohibited claims.
      check('Shows the Security section', await seesText(page, 'Security'));
      check('Names the authorization mechanism', await seesText(page, 'Executor authorization'));
      check('Shows migration readiness', await seesText(page, 'Ready for authorization upgrade'));

      const body = (await page.locator('body').innerText()).toLowerCase();
      for (const banned of ['quantum safe','quantum-safe','post-quantum secure','quantum proof','quantum-proof']) {
        check(`Never claims "${banned}"`, !body.includes(banned));
      }

      reportProblems('Condition detail', problems);
      await shoot(page, 'condition-detail');
      await page.close();
    }

    /*//////////////////////////////////////////////////////////////
                    WALLET-GATED AND STATIC PAGES
    //////////////////////////////////////////////////////////////*/

    section('Remaining pages');
    for (const [path, needle, name] of [
      ['/dashboard', 'Connect a wallet to get started', 'dashboard'],
      ['/conditions', 'Persistent financial rules', 'conditions'],
      ['/conditions/new', 'Connect a wallet to continue', 'new-condition'],
      ['/wallets', 'Connect a wallet to get started', 'wallets'],
      ['/settings', 'Maximum authorized transfer', 'settings'],
      ['/docs', 'USDC is the gas token', 'docs'],
    ] as const) {
      const { page, problems } = await visit(browser, path);
      check(`${path} renders`, await seesText(page, needle), needle);
      reportProblems(path, problems);
      await shoot(page, name);
      await page.close();
    }

    /*//////////////////////////////////////////////////////////////
                              MOBILE
    //////////////////////////////////////////////////////////////*/

    section('Mobile layout');
    {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const problems = watch(page);
      await page.goto(`${BASE_URL}/executions`, { waitUntil: 'networkidle', timeout: 45_000 });
      await page.waitForTimeout(1200);

      // A horizontal scrollbar on the page body is the classic mobile failure.
      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      check('No horizontal page overflow at 390px', !overflows);
      check('Bottom navigation is present', await seesText(page, 'Overview'));

      reportProblems('Mobile', problems);
      await shoot(page, 'mobile-executions');
      await page.close();
    }

    /*//////////////////////////////////////////////////////////////
                             DARK MODE
    //////////////////////////////////////////////////////////////*/

    section('Dark mode');
    {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
        colorScheme: 'dark',
      });
      const problems = watch(page);
      await page.goto(`${BASE_URL}/executions`, { waitUntil: 'networkidle', timeout: 45_000 });
      await page.waitForTimeout(1200);

      const background = await page.evaluate(
        () => getComputedStyle(document.body).backgroundColor,
      );
      // Dark surfaces, but never pure black.
      const rgb = background.match(/\d+/g)?.map(Number) ?? [255, 255, 255];
      const isDark = rgb[0] < 60 && rgb[1] < 60 && rgb[2] < 60;
      const isPureBlack = rgb[0] === 0 && rgb[1] === 0 && rgb[2] === 0;

      check('Dark surface applied', isDark, background);
      check('Not pure black', !isPureBlack, background);
      check('Data still renders in dark mode', await seesText(page, '$500.00'));

      reportProblems('Dark mode', problems);
      await shoot(page, 'dark-executions');
      await page.close();
    }
  } finally {
    await browser.close();
  }

  console.log('');
  if (SHOTS) console.log(`Screenshots written to ${SHOT_DIR}`);
  if (failures === 0) {
    console.log(`UI verification PASSED: ${checks}/${checks} checks.`);
    process.exit(0);
  } else {
    console.log(`UI verification FAILED: ${failures}/${checks} checks failed.`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('UI verification crashed:', error);
  process.exit(1);
});
