import { validateSponsorImage } from "./sponsor_image_validator";
import type {
  SponsorImageMetadata,
  SponsorImageValidation,
} from "./sponsor_image_validator";

type ValidationResult = {
  valid: boolean;
  message: string;
};

export class SponsorLogoValidator {
  private readonly originalPreview: string;
  private readonly originalConfirmation: boolean;
  private sequence = 0;

  constructor(
    private readonly preview: HTMLElement,
    private readonly confirmation: HTMLInputElement,
  ) {
    this.originalPreview = preview.innerHTML;
    this.originalConfirmation = confirmation.checked;
  }

  async validate(file: File | null) {
    const sequence = ++this.sequence;

    if (!file) {
      this.reset();
      return;
    }

    this.markAsChecking();
    const { image, loaded, url } = this.createPreview(file);
    this.preview.replaceChildren(image, this.checkingMessage());

    try {
      const [buffer] = await Promise.all([file.arrayBuffer(), loaded]);
      if (sequence !== this.sequence) return;
      this.render(validateSponsorImage(buffer));
    } catch (_error) {
      if (sequence === this.sequence) this.renderLoadError();
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  private reset() {
    this.preview.innerHTML = this.originalPreview;
    this.confirmation.checked = this.originalConfirmation;
    this.confirmation.setCustomValidity("");
  }

  private markAsChecking() {
    this.confirmation.checked = false;
    this.confirmation.setCustomValidity(
      this.message("validationChecking", "Checking the image"),
    );
  }

  private createPreview(file: File) {
    const image = document.createElement("img");
    image.className = "img-thumbnail";
    image.alt = "Logo preview";
    image.style.maxWidth = "320px";
    image.style.maxHeight = "320px";

    const loaded = new Promise<void>((resolve, reject) => {
      image.addEventListener("load", () => resolve(), { once: true });
      image.addEventListener("error", () => reject(), { once: true });
    });
    const url = URL.createObjectURL(file);
    image.src = url;

    return { image, loaded, url };
  }

  private checkingMessage() {
    const checking = document.createElement("p");
    checking.className = "text-muted mt-2";
    checking.textContent = this.message(
      "validationChecking",
      "Checking the image...",
    );
    return checking;
  }

  private render(validation: SponsorImageValidation) {
    const results = this.validationResults(validation);
    this.preview.querySelectorAll("p").forEach((element) => element.remove());
    results.forEach((result) => this.appendResult(result));

    this.confirmation.checked = false;
    this.confirmation.setCustomValidity(
      validation.valid
        ? ""
        : this.message(
            "validationError",
            "The logo does not meet the requirements",
          ),
    );
  }

  private validationResults(
    validation: SponsorImageValidation,
  ): ValidationResult[] {
    const { metadata, dimensionsValid, square, dpiValid } = validation;

    return [
      {
        valid: true,
        message: `${this.message("formatLabel", "Format")}: ${metadata.format}`,
      },
      {
        valid: dimensionsValid,
        message: this.dimensionsMessage(metadata, dimensionsValid),
      },
      {
        valid: square,
        message: this.message(
          square ? "aspectRatioValid" : "aspectRatioError",
          square ? "Square" : "The image must be square",
        ),
      },
      {
        valid: metadata.rgb,
        message: this.message(
          metadata.rgb ? "rgbValid" : "rgbError",
          metadata.rgb ? "Color mode: RGB" : "Color mode must be RGB",
        ),
      },
      {
        valid: dpiValid,
        message: this.resolutionMessage(metadata, dpiValid),
      },
    ];
  }

  private dimensionsMessage(metadata: SponsorImageMetadata, valid: boolean) {
    const dimensions = `${metadata.width.toLocaleString()} × ${metadata.height.toLocaleString()} px`;
    const requirement = valid
      ? ""
      : ` (${this.message("requiredDimensions", "")})`;
    return `${this.message(
      "dimensionsLabel",
      "Dimensions",
    )}: ${dimensions}${requirement}`;
  }

  private resolutionMessage(metadata: SponsorImageMetadata, valid: boolean) {
    const resolution =
      metadata.dpiX === null || metadata.dpiY === null
        ? this.message("missingDpi", "DPI information is missing")
        : Math.round(metadata.dpiX) === Math.round(metadata.dpiY)
          ? `${Math.round(metadata.dpiX)} dpi`
          : `${Math.round(metadata.dpiX)} × ${Math.round(metadata.dpiY)} dpi`;
    const requirement = valid
      ? ""
      : ` (${this.message("requiredDpi", "350 dpi is required")})`;
    return `${this.message(
      "resolutionLabel",
      "Resolution",
    )}: ${resolution}${requirement}`;
  }

  private renderLoadError() {
    const message = this.message("imageLoadError", "Unable to load image");
    this.confirmation.checked = false;
    this.confirmation.setCustomValidity(message);
    this.preview.querySelectorAll("p").forEach((element) => element.remove());
    this.appendResult({ valid: false, message });
  }

  private appendResult({ valid, message }: ValidationResult) {
    const result = document.createElement("p");
    result.className = valid ? "text-success mb-1" : "text-danger mb-1";
    result.textContent = `${valid ? "✓" : "✗"} ${message}`;
    this.preview.appendChild(result);
  }

  private message(key: string, fallback: string) {
    return this.preview.dataset[key] || fallback;
  }
}
