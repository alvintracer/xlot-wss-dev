import assert from "node:assert/strict";
import test from "node:test";
import { createAes256CbcCodec } from "../lib/aes-cbc.js";

test("AES-256-CBC codec produces Base64 and round-trips UTF-8", () => {
  const codec = createAes256CbcCodec({
    key: "0123456789abcdef0123456789abcdef",
    iv: "abcdef0123456789",
  });
  const plaintext = JSON.stringify({ walletAddress: "0x1234", label: "테스트" });
  const encrypted = codec.encryptUtf8(plaintext);
  assert.match(encrypted, /^[A-Za-z0-9+/]+={0,2}$/);
  assert.notEqual(encrypted, plaintext);
  assert.equal(codec.decryptUtf8(encrypted), plaintext);
});

test("AES material must resolve to exact provider lengths", () => {
  assert.throws(
    () => createAes256CbcCodec({ key: "short", iv: "short" }),
    /exactly 32 bytes/,
  );
});
