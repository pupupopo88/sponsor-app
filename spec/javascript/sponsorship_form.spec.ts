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
