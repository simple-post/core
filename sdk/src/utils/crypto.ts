/**
 * Convert DER-encoded ECDSA signature to raw R||S format for ES256 JWT/JWS.
 *
 * Node.js crypto.sign() outputs ECDSA signatures in DER format, but JWT/JWS
 * requires raw R||S format (64 bytes: 32 for R + 32 for S concatenated).
 */
export function derToRaw(derSignature: Buffer): Buffer {
  // DER format: 0x30 [total-length] 0x02 [r-length] [r] 0x02 [s-length] [s]
  let offset = 2; // Skip 0x30 and total length

  // Read R
  if (derSignature[offset] !== 0x02) throw new Error("Invalid DER signature");
  offset++;
  const rLength = derSignature[offset];
  offset++;
  let r = derSignature.subarray(offset, offset + rLength);
  offset += rLength;

  // Read S
  if (derSignature[offset] !== 0x02) throw new Error("Invalid DER signature");
  offset++;
  const sLength = derSignature[offset];
  offset++;
  let s = derSignature.subarray(offset, offset + sLength);

  // Remove leading zeros if present (DER uses minimal encoding)
  if (r.length === 33 && r[0] === 0) r = r.subarray(1);
  if (s.length === 33 && s[0] === 0) s = s.subarray(1);

  // Pad to 32 bytes each
  const rPadded = Buffer.alloc(32);
  const sPadded = Buffer.alloc(32);
  r.copy(rPadded, 32 - r.length);
  s.copy(sPadded, 32 - s.length);

  return Buffer.concat([rPadded, sPadded]);
}
