export type SponsorImageMetadata = {
  format: "JPEG" | "PNG";
  width: number;
  height: number;
  rgb: boolean;
  hasTransparency: boolean;
  dpiX: number | null;
  dpiY: number | null;
};

type Resolution = { dpiX: number; dpiY: number };
const METERS_PER_INCH = 0.0254;
const CENTIMETERS_PER_INCH = 2.54;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8];
const JPEG_MARKER = { end: 0xd9, scan: 0xda, jfif: 0xe0, exif: 0xe1 };
const JPEG_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);
const EXIF_TAG = {
  xResolution: 0x011a,
  yResolution: 0x011b,
  resolutionUnit: 0x0128,
};

const startsWith = (view: DataView, bytes: number[]) =>
  bytes.length <= view.byteLength &&
  bytes.every((byte, index) => view.getUint8(index) === byte);

const textAt = (view: DataView, offset: number, length: number) =>
  Array.from({ length }, (_, index) =>
    String.fromCharCode(view.getUint8(offset + index)),
  ).join("");

const slice = (view: DataView, offset: number, length: number) => {
  if (offset < 0 || length < 0 || offset + length > view.byteLength) {
    throw new Error("Truncated image metadata");
  }
  return new DataView(view.buffer, view.byteOffset + offset, length);
};

function inspectPng(view: DataView): SponsorImageMetadata {
  let metadata: SponsorImageMetadata | null = null;
  let offset = PNG_SIGNATURE.length;
  while (offset + 12 <= view.byteLength) {
    const length = view.getUint32(offset);
    const type = textAt(view, offset + 4, 4);
    // A chunk consists of length, type, data and CRC. Decoding is checked by the browser.
    slice(view, offset, length + 12);
    const data = slice(view, offset + 8, length);
    if (!metadata && type !== "IHDR") throw new Error("Missing PNG header");

    if (type === "IHDR") {
      if (metadata || length !== 13) throw new Error("Invalid PNG header");
      const colorType = data.getUint8(9);
      metadata = {
        format: "PNG",
        width: data.getUint32(0),
        height: data.getUint32(4),
        rgb: colorType === 2 || colorType === 6,
        // Reject alpha channels even if all pixels are opaque.
        hasTransparency: colorType === 4 || colorType === 6,
        dpiX: null,
        dpiY: null,
      };
      if (metadata.width === 0 || metadata.height === 0)
        throw new Error("Invalid PNG dimensions");
    } else if (metadata) {
      if (type === "tRNS") metadata.hasTransparency = true;
      if (type === "pHYs") {
        if (length !== 9) throw new Error("Invalid PNG resolution");
        if (data.getUint8(8) === 1) {
          metadata.dpiX = data.getUint32(0) * METERS_PER_INCH;
          metadata.dpiY = data.getUint32(4) * METERS_PER_INCH;
        }
      }
      if (type === "IEND") {
        if (length !== 0) throw new Error("Invalid PNG end");
        return metadata;
      }
    }
    offset += length + 12;
  }
  throw new Error("Incomplete PNG");
}

function inspectExifResolution(segment: DataView): Resolution | null {
  if (segment.byteLength < 14 || textAt(segment, 0, 6) !== "Exif\0\0")
    return null;
  const tiff = slice(segment, 6, segment.byteLength - 6);
  const byteOrder = tiff.getUint16(0);
  if (byteOrder !== 0x4949 && byteOrder !== 0x4d4d) return null;
  const littleEndian = byteOrder === 0x4949;
  if (tiff.getUint16(2, littleEndian) !== 42) return null;
  const inBounds = (offset: number, length: number) =>
    offset >= 8 && offset + length <= tiff.byteLength;
  const ifdOffset = tiff.getUint32(4, littleEndian);
  if (!inBounds(ifdOffset, 2)) return null;
  const entries = tiff.getUint16(ifdOffset, littleEndian);
  let dpiX: number | null = null;
  let dpiY: number | null = null;
  let unit: number | null = null;

  for (let index = 0; index < entries; index++) {
    // TIFF IFD entries are 12 bytes: tag, type, count, then value/offset.
    const offset = ifdOffset + 2 + index * 12;
    if (!inBounds(offset, 12)) return null;
    const tag = tiff.getUint16(offset, littleEndian);
    const type = tiff.getUint16(offset + 2, littleEndian);
    const count = tiff.getUint32(offset + 4, littleEndian);
    if (count !== 1) continue;
    if (tag === EXIF_TAG.resolutionUnit && type === 3) {
      unit = tiff.getUint16(offset + 8, littleEndian);
    } else if (
      (tag === EXIF_TAG.xResolution || tag === EXIF_TAG.yResolution) &&
      type === 5
    ) {
      const valueOffset = tiff.getUint32(offset + 8, littleEndian);
      if (!inBounds(valueOffset, 8)) return null;
      const numerator = tiff.getUint32(valueOffset, littleEndian);
      const denominator = tiff.getUint32(valueOffset + 4, littleEndian);
      if (denominator === 0) return null;
      if (tag === EXIF_TAG.xResolution) dpiX = numerator / denominator;
      else dpiY = numerator / denominator;
    }
  }
  if (dpiX === null || dpiY === null) return null;
  if (unit === 2) return { dpiX, dpiY };
  if (unit === 3)
    return {
      dpiX: dpiX * CENTIMETERS_PER_INCH,
      dpiY: dpiY * CENTIMETERS_PER_INCH,
    };
  return null;
}

function* jpegSegments(view: DataView) {
  let offset = JPEG_SIGNATURE.length;
  while (offset < view.byteLength) {
    if (view.getUint8(offset) !== 0xff) throw new Error("Invalid JPEG marker");
    while (offset < view.byteLength && view.getUint8(offset) === 0xff) offset++;
    if (offset >= view.byteLength) throw new Error("Incomplete JPEG marker");
    const marker = view.getUint8(offset++);
    if (marker === JPEG_MARKER.end || marker === JPEG_MARKER.scan) return;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const length = slice(view, offset, 2).getUint16(0);
    if (length < 2) throw new Error("Invalid JPEG segment");
    yield { marker, data: slice(view, offset + 2, length - 2) };
    offset += length;
  }
  throw new Error("Incomplete JPEG");
}

function inspectJpeg(view: DataView): SponsorImageMetadata {
  let width = 0;
  let height = 0;
  let components = 0;
  let jfif: Resolution | null = null;
  let exif: Resolution | null = null;
  for (const { marker, data } of jpegSegments(view)) {
    if (
      marker === JPEG_MARKER.jfif &&
      data.byteLength >= 12 &&
      textAt(data, 0, 5) === "JFIF\0"
    ) {
      const unit = data.getUint8(7);
      const dpiX = data.getUint16(8);
      const dpiY = data.getUint16(10);
      if (unit === 1) jfif = { dpiX, dpiY };
      if (unit === 2)
        jfif = {
          dpiX: dpiX * CENTIMETERS_PER_INCH,
          dpiY: dpiY * CENTIMETERS_PER_INCH,
        };
    } else if (marker === JPEG_MARKER.exif) {
      exif = inspectExifResolution(data) ?? exif;
    } else if (JPEG_FRAME_MARKERS.has(marker)) {
      if (data.byteLength < 6) throw new Error("Invalid JPEG frame");
      height = data.getUint16(1);
      width = data.getUint16(3);
      components = data.getUint8(5);
      if (data.byteLength < 6 + components * 3)
        throw new Error("Incomplete JPEG frame");
    }
  }
  if (width === 0 || height === 0 || components === 0)
    throw new Error("Missing JPEG dimensions");
  // Prefer EXIF resolution when both EXIF and JFIF density are present.
  const resolution = exif ?? jfif;
  return {
    format: "JPEG",
    width,
    height,
    rgb: components === 3,
    hasTransparency: false,
    dpiX: resolution?.dpiX ?? null,
    dpiY: resolution?.dpiY ?? null,
  };
}

export function inspectSponsorImage(buffer: ArrayBuffer): SponsorImageMetadata {
  const view = new DataView(buffer);
  if (startsWith(view, PNG_SIGNATURE)) return inspectPng(view);
  if (startsWith(view, JPEG_SIGNATURE)) return inspectJpeg(view);
  throw new Error("Unsupported image format");
}
