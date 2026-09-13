import { readFileSync } from "node:fs";
import { test, expect, type Page } from "playwright/test";
import ts from "typescript";

const script = ts.transpileModule(
  readFileSync("app/javascript/user_sponsorships_form.ts", "utf8"),
  { compilerOptions: { target: ts.ScriptTarget.ES2020 } },
).outputText;

async function initializeForm(page: Page, html: string) {
  await page.setContent(`<form class="sponsorships_form">${html}</form>`);
  await page.addScriptTag({ content: script });
  await page.evaluate(() =>
    document.dispatchEvent(new Event("DOMContentLoaded")),
  );
}

const attributes = ["email", "address", "organization", "unit", "name"];
const billingForm = (existingName = "") => `
  ${attributes
    .map(
      (attribute) =>
        `<input name="sponsorship[contact_attributes][${attribute}]" value="Primary ${attribute}">`,
    )
    .join("")}
  <section class="sponsorships_form_billing_contact">
    <input type="checkbox" aria-label="Separate billing contact">
    <fieldset>${attributes
      .map(
        (attribute) =>
          `<input name="sponsorship[alternate_billing_contact_attributes][${attribute}]" value="${
            attribute === "name" ? existingName : ""
          }">`,
      )
      .join("")}</fieldset>
  </section>`;

const field = (page: Page, kind: string, attribute: string) =>
  page.locator(`[name="sponsorship[${kind}_attributes][${attribute}]"]`);

test("billing fields follow the primary contact until individually edited", async ({
  page,
}) => {
  await initializeForm(page, billingForm());
  const checkbox = page.getByRole("checkbox");
  const primary = field(page, "contact", "name");
  const alternate = field(page, "alternate_billing_contact", "name");
  await expect(alternate).toBeDisabled();
  await checkbox.check();
  await expect(alternate).toHaveValue("Primary name");
  await primary.fill("Updated name");
  await expect(alternate).toHaveValue("Updated name");
  await alternate.fill("");
  await primary.fill("Another name");
  await checkbox.uncheck();
  await checkbox.check();
  await expect(alternate).toHaveValue("");
  await field(page, "contact", "address").fill("Updated address");
  await expect(field(page, "alternate_billing_contact", "address")).toHaveValue(
    "Updated address",
  );
});

test("existing billing details are preserved and untouched fields catch up when enabled", async ({
  page,
}) => {
  await initializeForm(page, billingForm("Billing name"));
  await page.getByRole("checkbox").check();
  await field(page, "contact", "name").fill("Changed primary");
  await expect(field(page, "alternate_billing_contact", "name")).toHaveValue(
    "Billing name",
  );
  await page.getByRole("checkbox").uncheck();
  await field(page, "contact", "address").fill("Changed while disabled");
  await page.getByRole("checkbox").check();
  await expect(field(page, "alternate_billing_contact", "address")).toHaveValue(
    "Changed while disabled",
  );
});

const boothForm = `
  <div class="sponsorships_form_plans">
    <input type="radio" name="plan" value="eligible" data-booth="1" data-plan-name="Gold" checked>
    <input type="radio" name="plan" value="ineligible" data-booth="0" data-plan-name="Silver">
  </div>
  <div class="sponsorships_form_booth_request">
    <input type="radio" name="booth" value="true" required>
    <input type="radio" name="booth" value="false" required>
  </div>
  <small class="sponsorships_form_booth_request_uneligible"></small>
  <textarea class="sponsorships_form_customization_request"></textarea>
  <small class="sponsorships_form_profile_help"></small>
  <small class="sponsorships_acceptance_help"></small>
  <section class="sponsorships_form_fallback_section">
    <select name="sponsorship[fallback_option]">
      <option value=""></option>
      <option value="without-booth" data-conditions='[{"booth_request":false}]' data-priority-human='["!withdraw"]'>Without booth</option>
      <option value="with-booth" data-conditions='[{"booth_request":true}]' data-priority-human='["!withdraw"]'>With booth</option>
    </select>
    <div class="sponsorships_form_fallback_priority"><ol></ol></div>
  </section>`;

test("booth choice stays explicit and controls fallback choices", async ({
  page,
}) => {
  await initializeForm(page, boothForm);
  const fallback = page.locator(".sponsorships_form_fallback_section");
  const select = fallback.locator("select");
  const yes = page.locator('[name="booth"][value="true"]');
  const no = page.locator('[name="booth"][value="false"]');
  await expect(yes).not.toBeChecked();
  await expect(no).not.toBeChecked();
  await expect(fallback).toHaveClass(/d-none/);
  await no.check();
  await expect(fallback).not.toHaveClass(/d-none/);
  await select.selectOption("without-booth");
  await expect(
    page.locator(".sponsorships_form_fallback_priority"),
  ).not.toHaveClass(/d-none/);
  await yes.check();
  await expect(select).toHaveValue("");
  await expect(
    page.locator(".sponsorships_form_fallback_priority"),
  ).toHaveClass(/d-none/);
  await page.locator('[name="plan"][value="ineligible"]').check();
  await expect(no).toBeChecked();
  await expect(yes).toBeDisabled();
  await page.locator('[name="plan"][value="eligible"]').check();
  await expect(yes).not.toBeChecked();
  await expect(no).not.toBeChecked();
  await expect(fallback).toHaveClass(/d-none/);
});
