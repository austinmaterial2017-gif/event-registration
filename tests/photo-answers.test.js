import test from "node:test";
import assert from "node:assert/strict";

import {
  answerMetadataForFiles,
  serializePhotoFiles,
  validatePhotoFiles
} from "../public/js/photo-answers.js";

function photo(name, type, size, bytes = [1, 2, 3]) {
  return {
    name,
    type,
    size,
    async arrayBuffer() { return Uint8Array.from(bytes).buffer; }
  };
}

const field = {
  id: "receipt",
  label: "付款证明",
  upload: { maxFiles: 2, maxBytes: 10, accept: ["image/jpeg", "image/png"] }
};

test("photo answers reject excessive count, size, and unsafe file types before upload", () => {
  assert.deepEqual(validatePhotoFiles(field, [photo("a.jpg", "image/jpeg", 4)]), []);
  assert.match(validatePhotoFiles(field, [photo("a.jpg", "image/jpeg", 4), photo("b.png", "image/png", 4), photo("c.jpg", "image/jpeg", 4)])[0], /最多上传 2 张/);
  assert.match(validatePhotoFiles(field, [photo("large.jpg", "image/jpeg", 11)])[0], /超过.*限制/);
  assert.match(validatePhotoFiles(field, [photo("bad.svg", "image/svg+xml", 4)])[0], /格式/);
});

test("photo answer metadata is safe for validation and review", () => {
  assert.deepEqual(answerMetadataForFiles([photo("a.jpg", "image/jpeg", 4)]), [{
    originalName: "a.jpg", mimeType: "image/jpeg", size: 4
  }]);
});

test("photo answers serialize to the API upload envelope only at final submission", async () => {
  assert.deepEqual(await serializePhotoFiles({ receipt: [photo("a.jpg", "image/jpeg", 3, [1, 2, 3])] }), {
    receipt: [{
      originalName: "a.jpg",
      mimeType: "image/jpeg",
      size: 3,
      base64: "AQID"
    }]
  });
});
