import { inspectSponsorImage } from "./sponsor_image_metadata";
export type { SponsorImageMetadata } from "./sponsor_image_metadata";

const SPONSOR_IMAGE_REQUIREMENTS = { edgeLength: 2894, dpi: 350 } as const;

export function validateSponsorImage(buffer: ArrayBuffer) {
  const metadata = inspectSponsorImage(buffer);
  const dimensionsValid =
    metadata.width === SPONSOR_IMAGE_REQUIREMENTS.edgeLength &&
    metadata.height === SPONSOR_IMAGE_REQUIREMENTS.edgeLength;
  const square = metadata.width === metadata.height;
  const opaque = !metadata.hasTransparency;
  // PNG stores pixels per meter; rounding allows the corresponding integer density.
  const dpiValid = [metadata.dpiX, metadata.dpiY].every(
    (dpi) => dpi !== null && Math.round(dpi) === SPONSOR_IMAGE_REQUIREMENTS.dpi,
  );
  return {
    metadata,
    dimensionsValid,
    square,
    opaque,
    dpiValid,
    valid: dimensionsValid && metadata.rgb && opaque && dpiValid,
  };
}

export type SponsorImageValidation = ReturnType<typeof validateSponsorImage>;
