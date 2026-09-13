import { test, expect, type Page } from "playwright/test";
import { build } from "vite";

let script: string;
test.beforeAll(async () => {
  const result = await build({
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    configFile: false,
    logLevel: "silent",
    build: {
      write: false,
      minify: false,
      lib: {
        entry: "app/javascript/user_sponsorship_asset_file_form.tsx",
        name: "SponsorshipUpload",
        formats: ["iife"],
      },
    },
  });
  const output = Array.isArray(result) ? result[0] : result;
  if (!("output" in output) || output.output[0].type !== "chunk")
    throw new Error("Missing test bundle");
  script = output.output[0].code;
});

async function openForm(
  page: Page,
  { existing = false, failUpload = false, holdUpload = false } = {},
) {
  let uploads = 0;
  let submissions = 0;
  let releaseUpload!: () => void;
  const uploadGate = new Promise<void>((resolve) => {
    releaseUpload = resolve;
  });
  await page.route("http://localhost/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/session") {
      await route.fulfill({
        json: {
          id: "99",
          url: "http://localhost/upload",
          fields: {},
          report_to: "http://localhost/report",
        },
      });
    } else if (path === "/upload") {
      uploads++;
      if (holdUpload) await uploadGate;
      await route.fulfill({
        status: failUpload && uploads === 1 ? 500 : 204,
        headers: { "x-amz-version-id": "version-1" },
      });
    } else if (path === "/report") {
      await route.fulfill({ json: { ok: true } });
    } else if (path === "/sponsorship") {
      submissions++;
      await route.fulfill({ contentType: "text/html", body: "Saved" });
    } else {
      await route.fulfill({
        contentType: "text/html",
        body: `
        <form class="sponsorships_form" method="post" action="/sponsorship">
          <input aria-label="Company" name="company" value="Example" required>
          <div class="submit_error d-none"></div>
          <div class="sponsorships_form_asset_file" data-session-endpoint="http://localhost/session" data-session-endpoint-method="POST">
            <input type="hidden" name="sponsorship[asset_file_id]" value="${
              existing ? "42" : ""
            }">
            <div class="sponsorships_form_asset_file_form"></div>
          </div>
          <div class="sponsorships_form_logo_preview"
            data-preview-alt="Logo" data-validation-checking="Checking" data-validation-error="Invalid logo"
            data-image-load-error="Cannot read image" data-format-label="Format" data-dimensions-label="Size"
            data-required-dimensions="2894 px" data-aspect-ratio-valid="Square" data-aspect-ratio-error="Not square"
            data-rgb-valid="RGB" data-rgb-error="Not RGB" data-transparency-valid="Opaque" data-transparency-error="Transparent"
            data-resolution-label="DPI" data-missing-dpi="Missing DPI" data-required-dpi="350 dpi">${
              existing ? "Existing logo" : ""
            }</div>
          <input type="checkbox" name="sponsorship[logo_confirmation]" value="1" required aria-label="Confirm logo">
          <input type="submit" value="Save">
        </form>`,
      });
    }
  });
  await page.goto("http://localhost/");
  await page.addScriptTag({ content: script });
  await page.evaluate(() =>
    document.dispatchEvent(new Event("DOMContentLoaded")),
  );
  await expect(
    page.locator(existing ? "button" : 'input[type="file"]'),
  ).toBeVisible();
  return {
    uploads: () => uploads,
    submissions: () => submissions,
    releaseUpload,
  };
}

async function selectValidLogo(page: Page) {
  await page
    .locator('input[type="file"]')
    .setInputFiles("spec/fixtures/files/sponsor_logo.png");
  await expect(
    page.locator(".sponsorships_form_logo_preview .text-success"),
  ).toHaveCount(6);
  await page.getByRole("checkbox").check();
}

test("uploads only a validated and confirmed file", async ({ page }) => {
  const state = await openForm(page);
  await expect(page.locator("form")).toHaveCount(1);
  await page
    .locator('input[type="file"]')
    .setInputFiles("spec/fixtures/files/test_image.png");
  await expect(
    page.locator(".sponsorships_form_logo_preview .text-danger"),
  ).not.toHaveCount(0);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  expect(state.uploads()).toBe(0);
  expect(state.submissions()).toBe(0);
  await selectValidLogo(page);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("body")).toHaveText("Saved");
  expect(state.uploads()).toBe(1);
  expect(state.submissions()).toBe(1);
});

test("replace and cancel never submit the form and preserve the existing logo", async ({
  page,
}) => {
  const state = await openForm(page, { existing: true });
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Replace", exact: true }).click();
  expect(state.submissions()).toBe(0);
  await page
    .locator('input[type="file"]')
    .setInputFiles("spec/fixtures/files/test_image.png");
  await expect(
    page.locator(".sponsorships_form_logo_preview .text-danger"),
  ).not.toHaveCount(0);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("checkbox")).toBeChecked();
  await expect(page.locator(".sponsorships_form_logo_preview")).toHaveText(
    "Existing logo",
  );
  expect(state.submissions()).toBe(0);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("body")).toHaveText("Saved");
  expect(state.uploads()).toBe(0);
});

test("allows retry after an upload failure", async ({ page }) => {
  const state = await openForm(page, { failUpload: true });
  await selectValidLogo(page);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".submit_error")).toContainText("ERROR");
  await expect(page.locator('input[type="file"]')).toBeEnabled();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("body")).toHaveText("Saved");
  expect(state.uploads()).toBe(2);
});

test("rechecks fields changed during upload without uploading twice", async ({
  page,
}) => {
  const state = await openForm(page, { holdUpload: true });
  await selectValidLogo(page);
  const uploading = page.waitForRequest("http://localhost/upload");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await uploading;
  await page.getByRole("textbox", { name: "Company" }).fill("");
  state.releaseUpload();
  await expect(
    page.getByRole("button", { name: "Save", exact: true }),
  ).toBeEnabled();
  expect(state.submissions()).toBe(0);
  await page.getByRole("textbox", { name: "Company" }).fill("Updated");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("body")).toHaveText("Saved");
  expect(state.uploads()).toBe(1);
});
