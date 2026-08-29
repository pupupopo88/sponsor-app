export type SponsorImageMetadata = {
  format: "JPEG" | "PNG";
  width: number;
  height: number;
  rgb: boolean;
  dpiX: number | null;
  dpiY: number | null;
};

export type SponsorImageValidation = {
  metadata: SponsorImageMetadata;
  dimensionsValid: boolean;
  square: boolean;
  dpiValid: boolean;
  valid: boolean;
};

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const REQUIRED_SIZE = 2894;
const REQUIRED_DPI = 350;

const bytesEqual = (view: DataView, offset: number, bytes: number[]) =>
  bytes.every(
    (byte, index) =>
      offset + index < view.byteLength &&
      view.getUint8(offset + index) === byte,
  );

const textAt = (view: DataView, offset: number, length: number) =>
  Array.from({ length }, (_, index) =>
    String.fromCharCode(view.getUint8(offset + index)),
  ).join("");

type PngChunk = {
  type: string;
  dataOffset: number;
  dataLength: number;
};

function* pngChunks(view: DataView): Generator<PngChunk> {
  let offset = PNG_SIGNATURE.length;

  while (offset + 12 <= view.byteLength) {
    const dataLength = view.getUint32(offset);
    const type = textAt(view, offset + 4, 4);
    const dataOffset = offset + 8;
    const nextOffset = dataOffset + dataLength + 4;
    if (nextOffset > view.byteLength) throw new Error("Invalid PNG chunk");

    yield { type, dataOffset, dataLength };

    if (type === "IEND") return;
    offset = nextOffset;
  }
}

const inspectPng = (view: DataView): SponsorImageMetadata => {
  let width = 0;
  let height = 0;
  let colorType: number | null = null;
  let hasTransparency = false;
  let dpiX: number | null = null;
  let dpiY: number | null = null;

  for (const { type, dataOffset, dataLength } of pngChunks(view)) {
    if (type === "IHDR" && dataLength === 13) {
      width = view.getUint32(dataOffset);
      height = view.getUint32(dataOffset + 4);
      colorType = view.getUint8(dataOffset + 9);
      hasTransparency = colorType === 4 || colorType === 6;
    } else if (type === "tRNS") {
      hasTransparency = true;
    } else if (
      type === "pHYs" &&
      dataLength === 9 &&
      view.getUint8(dataOffset + 8) === 1
    ) {
      dpiX = view.getUint32(dataOffset) * 0.0254;
      dpiY = view.getUint32(dataOffset + 4) * 0.0254;
    }
  }

  if (width <= 0 || height <= 0 || colorType === null)
    throw new Error("Invalid PNG");

  return {
    format: "PNG",
    width,
    height,
    rgb: colorType === 2 && !hasTransparency,
    dpiX,
    dpiY,
  };
};

type ExifResolution = { dpiX: number; dpiY: number };

const inspectExifResolution = (
  view: DataView,
  dataOffset: number,
  dataLength: number,
): ExifResolution | null => {
  if (dataLength < 14 || textAt(view, dataOffset, 6) !== "Exif\0\0")
    return null;

  const tiffOffset = dataOffset + 6;
  const littleEndianMarker = view.getUint16(tiffOffset, false);
  const littleEndian = littleEndianMarker === 0x4949;
  if (!littleEndian && littleEndianMarker !== 0x4d4d) return null;
  if (view.getUint16(tiffOffset + 2, littleEndian) !== 42) return null;

  const segmentEnd = dataOffset + dataLength;
  const inBounds = (offset: number, length: number) =>
    offset >= tiffOffset && offset + length <= segmentEnd;
  const ifdOffset = tiffOffset + view.getUint32(tiffOffset + 4, littleEndian);
  if (!inBounds(ifdOffset, 2)) return null;

  const entryCount = view.getUint16(ifdOffset, littleEndian);
  let xResolution: number | null = null;
  let yResolution: number | null = null;
  let resolutionUnit: number | null = null;

  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = ifdOffset + 2 + index * 12;
    if (!inBounds(entryOffset, 12)) return null;

    const tag = view.getUint16(entryOffset, littleEndian);
    const type = view.getUint16(entryOffset + 2, littleEndian);
    const count = view.getUint32(entryOffset + 4, littleEndian);

    if (tag === 0x0128 && type === 3 && count === 1) {
      resolutionUnit = view.getUint16(entryOffset + 8, littleEndian);
    }

    if ((tag === 0x011a || tag === 0x011b) && type === 5 && count === 1) {
      const valueOffset =
        tiffOffset + view.getUint32(entryOffset + 8, littleEndian);
      if (!inBounds(valueOffset, 8)) return null;
      const numerator = view.getUint32(valueOffset, littleEndian);
      const denominator = view.getUint32(valueOffset + 4, littleEndian);
      if (denominator === 0) return null;
      if (tag === 0x011a) xResolution = numerator / denominator;
      else yResolution = numerator / denominator;
    }
  }

  if (xResolution === null || yResolution === null) return null;
  if (resolutionUnit === 2) return { dpiX: xResolution, dpiY: yResolution };
  if (resolutionUnit === 3)
    return { dpiX: xResolution * 2.54, dpiY: yResolution * 2.54 };
  return null;
};

const isStartOfFrame = (marker: number) =>
  (marker >= 0xc0 && marker <= 0xc3) ||
  (marker >= 0xc5 && marker <= 0xc7) ||
  (marker >= 0xc9 && marker <= 0xcb) ||
  (marker >= 0xcd && marker <= 0xcf);

type JpegSegment = {
  marker: number;
  dataOffset: number;
  dataLength: number;
};

function* jpegSegments(view: DataView): Generator<JpegSegment> {
  let offset = 2;

  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) {
      offset += 1;
      continue;
    }

    while (offset < view.byteLength && view.getUint8(offset) === 0xff)
      offset += 1;
    if (offset >= view.byteLength) return;

    const marker = view.getUint8(offset);
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) return;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 2 > view.byteLength) throw new Error("Invalid JPEG segment");

    const segmentLength = view.getUint16(offset);
    if (segmentLength < 2 || offset + segmentLength > view.byteLength) {
      throw new Error("Invalid JPEG segment");
    }

    yield {
      marker,
      dataOffset: offset + 2,
      dataLength: segmentLength - 2,
    };
    offset += segmentLength;
  }
}

const inspectJpeg = (view: DataView): SponsorImageMetadata => {
  let width = 0;
  let height = 0;
  let components: number | null = null;
  let jfifResolution: ExifResolution | null = null;
  let exifResolution: ExifResolution | null = null;

  for (const { marker, dataOffset, dataLength } of jpegSegments(view)) {
    if (
      marker === 0xe0 &&
      dataLength >= 12 &&
      textAt(view, dataOffset, 5) === "JFIF\0"
    ) {
      const unit = view.getUint8(dataOffset + 7);
      const densityX = view.getUint16(dataOffset + 8);
      const densityY = view.getUint16(dataOffset + 10);
      if (unit === 1) jfifResolution = { dpiX: densityX, dpiY: densityY };
      if (unit === 2)
        jfifResolution = { dpiX: densityX * 2.54, dpiY: densityY * 2.54 };
    } else if (marker === 0xe1) {
      exifResolution =
        inspectExifResolution(view, dataOffset, dataLength) || exifResolution;
    } else if (isStartOfFrame(marker) && dataLength >= 6) {
      height = view.getUint16(dataOffset + 1);
      width = view.getUint16(dataOffset + 3);
      components = view.getUint8(dataOffset + 5);
    }
  }

  if (width <= 0 || height <= 0 || components === null)
    throw new Error("Invalid JPEG");
  const resolution = exifResolution || jfifResolution;

  return {
    format: "JPEG",
    width,
    height,
    rgb: components === 3,
    dpiX: resolution?.dpiX ?? null,
    dpiY: resolution?.dpiY ?? null,
  };
};

const inspectSponsorImage = (buffer: ArrayBuffer): SponsorImageMetadata => {
  const view = new DataView(buffer);
  if (bytesEqual(view, 0, PNG_SIGNATURE)) return inspectPng(view);
  if (view.byteLength >= 2 && view.getUint16(0) === 0xffd8)
    return inspectJpeg(view);
  throw new Error("Unsupported image format");
};

export const validateSponsorImage = (
  buffer: ArrayBuffer,
): SponsorImageValidation => {
  const metadata = inspectSponsorImage(buffer);
  const dimensionsValid =
    metadata.width === REQUIRED_SIZE && metadata.height === REQUIRED_SIZE;
  const square = metadata.width === metadata.height;
  const dpiValid =
    metadata.dpiX !== null &&
    metadata.dpiY !== null &&
    Math.round(metadata.dpiX) === REQUIRED_DPI &&
    Math.round(metadata.dpiY) === REQUIRED_DPI;

  return {
    metadata,
    dimensionsValid,
    square,
    dpiValid,
    valid: dimensionsValid && square && metadata.rgb && dpiValid,
  };
};
