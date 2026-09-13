import { readFileSync } from "node:fs";
import { test, expect } from "playwright/test";
import { build } from "vite";
import type { SponsorLogoValidator } from "../../app/javascript/sponsor_logo_validator";

declare global {
  interface Window {
    SponsorLogo: { SponsorLogoValidator: typeof SponsorLogoValidator };
    logoValidator: SponsorLogoValidator;
  }
}

let script: string;
test.beforeAll(async () => {
  const result = await build({
    configFile: false,
    logLevel: "silent",
    build: {
      write: false,
      minify: false,
      lib: {
        entry: "app/javascript/sponsor_logo_validator.ts",
        name: "SponsorLogo",
        formats: ["iife"],
      },
    },
  });
  const output = Array.isArray(result) ? result[0] : result;
  if (!("output" in output) || output.output[0].type !== "chunk")
    throw new Error("Missing test bundle");
  script = output.output[0].code;
});

const png = readFileSync("spec/fixtures/files/sponsor_logo.png");
const messages = {
  previewAlt: "ロゴのプレビュー",
  validationChecking: "確認中",
  validationError: "要件を満たしていません",
  imageLoadError: "画像を読み込めません",
  formatLabel: "形式",
  dimensionsLabel: "サイズ",
  requiredDimensions: "2894 × 2894 px",
  aspectRatioValid: "正方形",
  aspectRatioError: "正方形にしてください",
  rgbValid: "RGB",
  rgbError: "RGBにしてください",
  transparencyValid: "透過なし",
  transparencyError: "透過を削除してください",
  resolutionLabel: "解像度",
  missingDpi: "DPI情報がありません",
  requiredDpi: "350 dpi",
};

test.beforeEach(async ({ page }) => {
  await page.setContent(`
    <form><input type="file"><div id="preview"><span>Existing logo</span></div>
    <input type="checkbox" required><button type="button">Cancel replacement</button></form>`);
  await page.addScriptTag({ content: script });
  await page.evaluate((messages) => {
    const preview = document.querySelector<HTMLElement>("#preview")!;
    Object.assign(preview.dataset, messages);
    window.logoValidator = new window.SponsorLogo.SponsorLogoValidator(
      preview,
      document.querySelector<HTMLInputElement>('input[type="checkbox"]')!,
    );
    document
      .querySelector<HTMLInputElement>('input[type="file"]')!
      .addEventListener("change", (event) => {
        const file = (event.target as HTMLInputElement).files?.[0] ?? null;
        void window.logoValidator.validate(file);
      });
    document.querySelector("button")!.addEventListener("click", () => {
      void window.logoValidator.validate(null);
    });
  }, messages);
});

test("requires explicit confirmation after a valid image finishes loading", async ({
  page,
}) => {
  const confirmation = page.getByRole("checkbox");
  await confirmation.check();
  await page
    .locator('input[type="file"]')
    .setInputFiles("spec/fixtures/files/sponsor_logo.png");
  await expect(page.locator("#preview .text-success")).toHaveCount(6);
  await expect(page.locator("#preview img")).toHaveAttribute(
    "alt",
    messages.previewAlt,
  );
  await expect(confirmation).not.toBeChecked();
  await confirmation.check();
  expect(
    await page
      .locator("form")
      .evaluate((form: HTMLFormElement) => form.checkValidity()),
  ).toBe(true);
});

test("rejects a decodable image without DPI even when confirmation is checked", async ({
  page,
}) => {
  // Remove the pHYs chunk from the real PNG while preserving its image data and CRCs.
  const bytes = [...png.subarray(0, 33), ...png.subarray(54)];
  await page.evaluate(async (bytes) => {
    await window.logoValidator.validate(
      new File([new Uint8Array(bytes)], "no-dpi.png", { type: "image/png" }),
    );
  }, bytes);
  await expect(page.locator("#preview")).toContainText(messages.missingDpi);
  await page.getByRole("checkbox").check();
  await expect(page.getByRole("checkbox")).toHaveJSProperty(
    "validationMessage",
    messages.validationError,
  );
});

test("does not let an older successful validation replace a newer error", async ({
  page,
}) => {
  await page.evaluate(
    async (bytes) => {
      const data = new Uint8Array(bytes).buffer;
      const oldFile = new File([data], "old.png", { type: "image/png" });
      let finish!: (buffer: ArrayBuffer) => void;
      oldFile.arrayBuffer = () =>
        new Promise((resolve) => {
          finish = resolve;
        });
      const oldValidation = window.logoValidator.validate(oldFile);
      const newValidation = window.logoValidator.validate(
        new File(["broken"], "new.png", { type: "image/png" }),
      );
      finish(data);
      await Promise.all([oldValidation, newValidation]);
    },
    [...png],
  );
  await expect(page.locator("#preview")).toContainText(messages.imageLoadError);
  await expect(page.locator("#preview .text-success")).toHaveCount(0);
});

test("cancel restores the existing preview and its confirmation during validation", async ({
  page,
}) => {
  await page.getByRole("checkbox").check();
  await page.evaluate(
    async (bytes) => {
      const data = new Uint8Array(bytes).buffer;
      const file = new File([data], "replacement.png", { type: "image/png" });
      let finish!: (buffer: ArrayBuffer) => void;
      file.arrayBuffer = () =>
        new Promise((resolve) => {
          finish = resolve;
        });
      const pending = window.logoValidator.validate(file);
      await window.logoValidator.validate(null);
      finish(data);
      await pending;
    },
    [...png],
  );
  await expect(page.locator("#preview")).toHaveText("Existing logo");
  await expect(page.getByRole("checkbox")).toBeChecked();
  await expect(page.getByRole("checkbox")).toHaveJSProperty(
    "validationMessage",
    "",
  );
});
