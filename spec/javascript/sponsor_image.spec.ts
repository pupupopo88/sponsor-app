import { readFileSync } from "node:fs";
import { test, expect } from "playwright/test";
import { validateSponsorImage } from "../../app/javascript/sponsor_image_validator";

const concat = (chunks: Buffer[]) =>
  Buffer.concat(chunks.map((chunk) => Uint8Array.from(chunk)));
const buffer = (bytes: Buffer) => Uint8Array.from(bytes).buffer;
const validPng = readFileSync("spec/fixtures/files/sponsor_logo.png");

// These metadata fixtures deliberately omit pixel decoding; the UI tests use a real PNG.
function png({
  width = 2894,
  height = 2894,
  color = 2,
  density = 13780,
  unit = 1,
  transparent = false,
} = {}) {
  const chunk = (name: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    return concat([length, Buffer.from(name), data, Buffer.alloc(4)]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = color;
  const physical = Buffer.alloc(9);
  physical.writeUInt32BE(density, 0);
  physical.writeUInt32BE(density, 4);
  physical[8] = unit;
  return concat([
    validPng.subarray(0, 8),
    chunk("IHDR", header),
    ...(density ? [chunk("pHYs", physical)] : []),
    ...(transparent ? [chunk("tRNS", Buffer.alloc(6))] : []),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function exif(littleEndian: boolean, unit = 2, denominator = 1) {
  const tiff = Buffer.alloc(66);
  const short = (value: number, offset: number) =>
    littleEndian
      ? tiff.writeUInt16LE(value, offset)
      : tiff.writeUInt16BE(value, offset);
  const long = (value: number, offset: number) =>
    littleEndian
      ? tiff.writeUInt32LE(value, offset)
      : tiff.writeUInt32BE(value, offset);
  tiff.write(littleEndian ? "II" : "MM");
  short(42, 2);
  long(8, 4);
  short(3, 8);
  [0x011a, 0x011b, 0x0128].forEach((tag, index) => {
    const offset = 10 + index * 12;
    short(tag, offset);
    short(index === 2 ? 3 : 5, offset + 2);
    long(1, offset + 4);
    if (index === 2) short(unit, offset + 8);
    else long(50 + index * 8, offset + 8);
  });
  long(unit === 3 ? 13780 : 350, 50);
  long(unit === 3 ? 100 : denominator, 54);
  long(unit === 3 ? 13780 : 350, 58);
  long(unit === 3 ? 100 : denominator, 62);
  return concat([Buffer.from("Exif\0\0"), tiff]);
}

function jpeg({
  components = 3,
  density = 350,
  unit = 1,
  exifData = null as Buffer | null,
  frameMarker = 0xc0,
} = {}) {
  const segment = (marker: number, data: Buffer) => {
    const header = Buffer.from([0xff, marker, 0, 0]);
    header.writeUInt16BE(data.length + 2, 2);
    return concat([header, data]);
  };
  const jfif = Buffer.alloc(14);
  jfif.write("JFIF\0");
  jfif[5] = 1;
  jfif[6] = 2;
  jfif[7] = unit;
  jfif.writeUInt16BE(density, 8);
  jfif.writeUInt16BE(density, 10);
  const frame = Buffer.alloc(6 + components * 3);
  frame[0] = 8;
  frame.writeUInt16BE(2894, 1);
  frame.writeUInt16BE(2894, 3);
  frame[5] = components;
  return concat([
    Buffer.from([0xff, 0xd8]),
    segment(0xe0, jfif),
    ...(exifData ? [segment(0xe1, exifData)] : []),
    segment(frameMarker, frame),
    Buffer.from([0xff, 0xd9]),
  ]);
}

test("accepts the required RGB PNG and accounts for density rounding", () => {
  const result = validateSponsorImage(buffer(validPng));
  expect(result.valid).toBe(true);
  expect(result.metadata).toMatchObject({
    width: 2894,
    height: 2894,
    rgb: true,
    hasTransparency: false,
  });
  expect(result.metadata.dpiX).toBeCloseTo(350, 0);
});

for (const [description, options] of [
  ["missing DPI", { density: 0 }],
  ["unspecified DPI unit", { unit: 0 }],
  ["wrong DPI", { density: 2835 }],
  ["wrong size", { width: 100, height: 100 }],
  ["non-square dimensions", { width: 100 }],
  ["alpha channel", { color: 6 }],
  ["grayscale", { color: 0 }],
  ["indexed color", { color: 3 }],
  ["transparent RGB color", { transparent: true }],
] as const) {
  test(`rejects PNG with ${description}`, () => {
    expect(validateSponsorImage(buffer(png(options))).valid).toBe(false);
  });
}

test("reports RGB and transparency independently", () => {
  const result = validateSponsorImage(buffer(png({ color: 6 })));
  expect(result.metadata.rgb).toBe(true);
  expect(result.opaque).toBe(false);
});

for (const frameMarker of [0xc0, 0xc2]) {
  test(`reads JFIF density from JPEG frame ${frameMarker}`, () => {
    expect(validateSponsorImage(buffer(jpeg({ frameMarker }))).valid).toBe(
      true,
    );
  });
}
for (const littleEndian of [true, false]) {
  test(`prefers ${
    littleEndian ? "little" : "big"
  }-endian EXIF over JFIF`, () => {
    expect(
      validateSponsorImage(
        buffer(jpeg({ density: 72, exifData: exif(littleEndian) })),
      ).valid,
    ).toBe(true);
  });
}

test("converts centimeter density in JFIF and EXIF", () => {
  const jfif = validateSponsorImage(buffer(jpeg({ density: 138, unit: 2 })));
  expect(jfif.metadata.dpiX).toBeCloseTo(350.52);
  expect(jfif.valid).toBe(false);
  expect(
    validateSponsorImage(buffer(jpeg({ density: 72, exifData: exif(true, 3) })))
      .valid,
  ).toBe(true);
});

test("rejects JPEG with missing DPI, grayscale or CMYK components", () => {
  expect(validateSponsorImage(buffer(jpeg({ unit: 0 }))).valid).toBe(false);
  for (const components of [1, 4]) {
    expect(validateSponsorImage(buffer(jpeg({ components }))).valid).toBe(
      false,
    );
  }
});

test("ignores malformed EXIF without reading outside its segment", () => {
  const data = exif(true);
  data.writeUInt32LE(0xffffffff, 10);
  expect(validateSponsorImage(buffer(jpeg({ exifData: data }))).valid).toBe(
    true,
  );
  expect(
    validateSponsorImage(buffer(jpeg({ exifData: exif(true, 2, 0) }))).valid,
  ).toBe(true);
});

test("rejects unsupported and truncated files", () => {
  for (const data of [
    Buffer.alloc(0),
    Buffer.from("not an image"),
    validPng.subarray(0, 25),
    jpeg().subarray(0, 12),
  ]) {
    expect(() => validateSponsorImage(buffer(data))).toThrow();
  }
  const corrupt = png();
  corrupt.writeUInt32BE(0xffffffff, 8);
  expect(() => validateSponsorImage(buffer(corrupt))).toThrow();
});
