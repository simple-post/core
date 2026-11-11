import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
const manifest = JSON.parse(readFileSync("lib/i18n/social-assets.json", "utf8"));
assert.deepEqual(
  Object.keys(manifest.locales).sort(),
  ["en", "es", "pt-BR", "fr", "de", "ja", "it", "ko", "zh-Hans", "zh-Hant", "ar", "hi", "id", "tr", "bg"].sort(),
  "Every supported locale needs artwork",
);
const english = JSON.parse(readFileSync("lib/i18n/social-messages/en.json", "utf8"));
const locales = Object.keys(manifest.locales);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const artworkHash = digest(
  Buffer.concat([
    readFileSync("components/social-artwork.tsx"),
    readFileSync("scripts/prepare-social-artwork.mjs"),
    readFileSync("public/simplepost-logo.png"),
  ]),
);
const hashes = new Set();
for (const locale of locales) {
  const catalogBytes = readFileSync(`lib/i18n/social-messages/${locale}.json`);
  const messages = JSON.parse(catalogBytes);
  assert.equal(
    manifest.sources?.[locale]?.artworkSha256,
    artworkHash,
    `${locale}: artwork component changed; capture again`,
  );
  assert.equal(
    manifest.sources?.[locale]?.catalogSha256,
    digest(catalogBytes),
    `${locale}: artwork catalog changed; capture again`,
  );
  assert.deepEqual(Object.keys(messages).sort(), Object.keys(english).sort());
  for (const [key, value] of Object.entries(messages)) {
    assert.ok(typeof value === "string" && value.trim());
    if (locale !== "en") assert.notEqual(value, english[key], `${locale}: untranslated artwork copy`);
  }
  const asset = manifest.locales[locale];
  assert.equal(asset, `/social/${locale}/card.jpg`, `${locale}: reviewed artwork pending`);
  const bytes = readFileSync(`public${asset}`);
  let width, height;
  if (bytes.subarray(1, 4).toString() === "PNG") {
    width = bytes.readUInt32BE(16);
    height = bytes.readUInt32BE(20);
  } else {
    assert.equal(bytes.readUInt16BE(0), 65_496);
    for (let offset = 2; offset < bytes.length; ) {
      assert.equal(bytes[offset++], 255);
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++],
        length = bytes.readUInt16BE(offset);
      if ([192, 193, 194].includes(marker)) {
        height = bytes.readUInt16BE(offset + 3);
        width = bytes.readUInt16BE(offset + 5);
        break;
      }
      assert.ok(length >= 2);
      offset += length;
    }
  }
  assert.deepEqual([width, height], [1200, 630], `${locale}: invalid image size`);
  const hash = digest(bytes);
  assert.equal(manifest.sources[locale].imageSha256, hash, `${locale}: unreviewed image change`);
  assert.ok(!hashes.has(hash), `${locale}: duplicated artwork image`);
  hashes.add(hash);
}
console.warn(`Reviewed artwork and four actual artwork/metadata messages validated for ${locales.length} locales.`);
