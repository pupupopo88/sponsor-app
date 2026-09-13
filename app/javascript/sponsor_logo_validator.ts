import {
  validateSponsorImage,
  type SponsorImageValidation,
} from "./sponsor_image_validator";

type MessageKey =
  | "previewAlt"
  | "validationChecking"
  | "validationError"
  | "imageLoadError"
  | "formatLabel"
  | "dimensionsLabel"
  | "requiredDimensions"
  | "aspectRatioValid"
  | "aspectRatioError"
  | "rgbValid"
  | "rgbError"
  | "transparencyValid"
  | "transparencyError"
  | "resolutionLabel"
  | "missingDpi"
  | "requiredDpi";
type ValidationResult = { valid: boolean; message: string };

export class SponsorLogoValidator {
  private readonly originalPreview: Node[];
  private originalConfirmation = false;
  private replacing = false;
  private sequence = 0;

  constructor(
    private readonly preview: HTMLElement,
    private readonly confirmation: HTMLInputElement,
  ) {
    this.originalPreview = Array.from(preview.childNodes, (node) =>
      node.cloneNode(true),
    );
  }

  async validate(file: File | null) {
    const sequence = ++this.sequence;
    if (!file) {
      if (this.replacing) {
        this.preview.replaceChildren(
          ...this.originalPreview.map((node) => node.cloneNode(true)),
        );
        this.confirmation.checked = this.originalConfirmation;
        this.confirmation.setCustomValidity("");
        this.replacing = false;
      }
      return;
    }

    if (!this.replacing) this.originalConfirmation = this.confirmation.checked;
    this.replacing = true;
    this.confirmation.checked = false;
    this.confirmation.setCustomValidity(this.message("validationChecking"));
    const checking = document.createElement("p");
    checking.className = "text-muted mt-2";
    checking.textContent = this.message("validationChecking");
    this.preview.replaceChildren(checking);

    let url: string | undefined;
    try {
      const image = document.createElement("img");
      image.className = "img-thumbnail";
      image.alt = this.message("previewAlt");
      url = URL.createObjectURL(file);
      image.src = url;
      this.preview.prepend(image);
      const [buffer] = await Promise.all([file.arrayBuffer(), image.decode()]);
      if (sequence !== this.sequence) return;
      const validation = validateSponsorImage(buffer);
      this.renderResults(this.validationResults(validation));
      this.confirmation.checked = false;
      this.confirmation.setCustomValidity(
        validation.valid ? "" : this.message("validationError"),
      );
    } catch {
      if (sequence !== this.sequence) return;
      const message = this.message("imageLoadError");
      this.confirmation.checked = false;
      this.confirmation.setCustomValidity(message);
      this.renderResults([{ valid: false, message }]);
    } finally {
      if (url) URL.revokeObjectURL(url);
    }
  }

  private validationResults({
    metadata,
    dimensionsValid,
    square,
    opaque,
    dpiValid,
  }: SponsorImageValidation): ValidationResult[] {
    const dimensions = `${metadata.width.toLocaleString()} × ${metadata.height.toLocaleString()} px`;
    const { dpiX, dpiY } = metadata;
    const resolution =
      dpiX === null || dpiY === null
        ? this.message("missingDpi")
        : Math.round(dpiX) === Math.round(dpiY)
          ? `${Math.round(dpiX)} dpi`
          : `${Math.round(dpiX)} × ${Math.round(dpiY)} dpi`;
    return [
      {
        valid: true,
        message: `${this.message("formatLabel")}: ${metadata.format}`,
      },
      {
        valid: dimensionsValid,
        message: `${this.message("dimensionsLabel")}: ${dimensions}${
          dimensionsValid ? "" : ` (${this.message("requiredDimensions")})`
        }`,
      },
      {
        valid: square,
        message: this.message(square ? "aspectRatioValid" : "aspectRatioError"),
      },
      {
        valid: metadata.rgb,
        message: this.message(metadata.rgb ? "rgbValid" : "rgbError"),
      },
      {
        valid: opaque,
        message: this.message(
          opaque ? "transparencyValid" : "transparencyError",
        ),
      },
      {
        valid: dpiValid,
        message: `${this.message("resolutionLabel")}: ${resolution}${
          dpiValid ? "" : ` (${this.message("requiredDpi")})`
        }`,
      },
    ];
  }

  private renderResults(results: ValidationResult[]) {
    this.preview.querySelectorAll("p").forEach((element) => element.remove());
    results.forEach(({ valid, message }) => {
      const result = document.createElement("p");
      result.className = valid ? "text-success mb-1" : "text-danger mb-1";
      result.textContent = `${valid ? "✓" : "✗"} ${message}`;
      this.preview.appendChild(result);
    });
  }

  private message(key: MessageKey) {
    // The Rails partial supplies all messages in the current locale.
    return this.preview.dataset[key]!;
  }
}
