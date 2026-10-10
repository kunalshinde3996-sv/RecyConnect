import { expect, test, type Browser, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// The demo, automated: one browser context per role (like three separate windows).
// Resident requests -> collector claims, photographs, scans, weighs, hands off -> admin sees the
// alerts and confirms receipt -> everyone sees the completed chain of custody.
// Also records every API response the collector's browser receives and fails on any qrToken.

const PHOTO = fileURLToPath(new URL('../public/demo-photos/plastic-bottles.png', import.meta.url));
const API = (process.env.VITE_API_URL || 'http://localhost:5000').replace(/\/$/, '');

async function loginAs(browser: Browser, email: string, options: { mobile?: boolean } = {}) {
  const context = await browser.newContext(options.mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {});
  const page = await context.newPage();
  await page.goto('/login');
  await page.getByRole('button', { name: new RegExp(email.replace(/[.@]/g, '\\$&')) }).click();
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
  return page;
}

/** Collects the bodies of all API responses this page receives. */
function recordApiResponses(page: Page) {
  const bodies: { url: string; text: string }[] = [];
  page.on('response', async (res) => {
    if (!res.url().startsWith(API)) return;
    try {
      bodies.push({ url: res.url(), text: await res.text() });
    } catch {
      /* preflight / no body */
    }
  });
  return bodies;
}

test('full pickup lifecycle across resident, collector and admin', async ({ browser }) => {
  const address = `UI Test ${Date.now()}, 7 Residency Rd, Bengaluru`;
  const facility = 'GreenCycle MRF, Whitefield';

  // --- Resident: request a pickup and read the QR code text ---
  const resident = await loginAs(browser, 'arjun.resident@recyconnect.dev');
  await resident.getByLabel('Pickup address').fill(address);
  await resident.getByLabel('What are you recycling?').selectOption('plastic');
  await resident.getByLabel('Notes for the collector (optional)').fill('Rinsed PET bottles by the gate');
  await resident.getByRole('button', { name: 'Request pickup' }).click();
  await expect(resident.getByText('Pickup requested!')).toBeVisible();
  const qrToken = (await resident.getByTestId('qr-token').textContent())!.trim();
  expect(qrToken).toMatch(/^[0-9a-f-]{36}$/);

  // --- Collector (phone-sized): claim, photo, AI result, scan/enter code, weigh, hand off ---
  const collector = await loginAs(browser, 'ravi.collector@recyconnect.dev', { mobile: true });
  const collectorResponses = recordApiResponses(collector);
  await collector.reload();
  const card = collector.getByRole('listitem').filter({ hasText: address });
  await card.getByRole('button', { name: 'Claim pickup' }).click();
  await expect(collector).toHaveURL(/\/collector\/pickups\//);
  await expect(collector.getByText(address)).toBeVisible();

  await collector.getByTestId('photo-input').setInputFiles(PHOTO);
  await expect(collector.getByText('AI category')).toBeVisible({ timeout: 60_000 }); // worker round-trip
  await expect(collector.getByText(/Contamination flagged|No contamination/).first()).toBeVisible();

  await collector.getByTestId('qr-input').fill('00000000-0000-0000-0000-000000000000');
  await collector.getByLabel('Weight (kg)').fill('3.4');
  await collector.getByRole('button', { name: 'Confirm collection' }).click();
  await expect(collector.getByText("That code doesn't match this pickup")).toBeVisible();

  await collector.getByTestId('qr-input').fill(qrToken);
  await collector.getByRole('button', { name: 'Confirm collection' }).click();
  await expect(collector.getByText('QR verified')).toBeVisible();

  await collector.getByLabel('Recycling facility').fill(facility);
  await collector.getByRole('button', { name: 'Record hand-off' }).click();
  await expect(collector.getByText('Waiting for the recycler to confirm receipt.')).toBeVisible();

  // --- Admin: hand-off alert appears, confirm receipt, confirmation alert appears ---
  const admin = await loginAs(browser, 'admin@recyconnect.dev');
  const alerts = admin.getByTestId('alerts-panel');
  await expect(alerts).toContainText(`Pickup at ${address} handed off to ${facility}`);
  await expect(admin.getByTestId('alerts-unread')).not.toHaveText('0');

  await admin.getByLabel('Status').selectOption('handed_off');
  const row = admin.getByRole('row', { name: `Open timeline for pickup at ${address}` });
  await row.getByRole('button', { name: 'Confirm recycler receipt' }).click();
  await expect(row).toBeHidden(); // no longer handed_off
  await expect(alerts).toContainText(`${facility} confirmed receipt of the pickup from ${address}`);

  // Clicking the alert opens the chain of custody, now complete.
  await alerts.getByRole('button', { name: new RegExp(`confirmed receipt of the pickup from ${address}`) }).click();
  const dialog = admin.getByRole('dialog');
  await expect(dialog).toContainText('Completed');
  await expect(dialog).toContainText(facility);

  // --- Resident sees it completed ---
  await resident.reload();
  await expect(resident.getByText('Scanned by your collector on collection.')).toBeVisible();

  // --- The collector's browser never received the resident's secret ---
  await collector.reload();
  await expect(collector.getByText('Recycler confirmed receipt')).toBeVisible();
  expect(collectorResponses.length).toBeGreaterThan(5);
  const leaks = collectorResponses.filter((r) => r.text.includes(qrToken) || /"qrToken"\s*:/.test(r.text));
  expect(leaks.map((l) => l.url)).toEqual([]);
});
