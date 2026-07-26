// Deterministic QR Code Model 2 encoder for UTF-8 byte payloads (versions 1-6, level L).
// Kept local so tickets never send their verification payload to a third party.
const VERSION_SPECS = [
  null,
  { data: [19], ecc: 7 },
  { data: [34], ecc: 10 },
  { data: [55], ecc: 15 },
  { data: [80], ecc: 20 },
  { data: [108], ecc: 26 },
  { data: [68, 68], ecc: 18 }
];

function appendBits(bits, value, length) {
  for (let index = length - 1; index >= 0; index -= 1) bits.push(((value >>> index) & 1) !== 0);
}

function multiply(left, right) {
  let result = 0;
  for (let index = 7; index >= 0; index -= 1) {
    result = (result << 1) ^ ((result >>> 7) * 0x11d);
    result ^= ((right >>> index) & 1) * left;
  }
  return result;
}

function divisorFor(degree) {
  const result = Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let index = 0; index < degree; index += 1) {
    for (let offset = 0; offset < result.length; offset += 1) {
      result[offset] = multiply(result[offset], root);
      if (offset + 1 < result.length) result[offset] ^= result[offset + 1];
    }
    root = multiply(root, 2);
  }
  return result;
}

function remainderFor(data, divisor) {
  const result = Array(divisor.length).fill(0);
  for (const byte of data) {
    const factor = byte ^ result.shift();
    result.push(0);
    divisor.forEach((coefficient, index) => { result[index] ^= multiply(coefficient, factor); });
  }
  return result;
}

function createCodewords(text) {
  const bytes = [...new TextEncoder().encode(text)];
  const version = VERSION_SPECS.findIndex((spec, index) =>
    index > 0 && 4 + 8 + bytes.length * 8 <= spec.data.reduce((sum, count) => sum + count, 0) * 8);
  if (version < 1) throw new RangeError("QR payload is too long.");

  const spec = VERSION_SPECS[version];
  const dataCapacity = spec.data.reduce((sum, count) => sum + count, 0);
  const bits = [];
  appendBits(bits, 0b0100, 4);
  appendBits(bits, bytes.length, 8);
  bytes.forEach((byte) => appendBits(bits, byte, 8));
  appendBits(bits, 0, Math.min(4, dataCapacity * 8 - bits.length));
  while (bits.length % 8 !== 0) bits.push(false);

  const data = [];
  for (let index = 0; index < bits.length; index += 8) {
    data.push(bits.slice(index, index + 8).reduce((value, bit) => (value << 1) | Number(bit), 0));
  }
  for (let pad = 0; data.length < dataCapacity; pad += 1) data.push(pad % 2 === 0 ? 0xec : 0x11);

  const divisor = divisorFor(spec.ecc);
  const blocks = [];
  let offset = 0;
  for (const length of spec.data) {
    const blockData = data.slice(offset, offset + length);
    blocks.push({ data: blockData, ecc: remainderFor(blockData, divisor) });
    offset += length;
  }
  const codewords = [];
  const longest = Math.max(...spec.data);
  for (let index = 0; index < longest; index += 1) {
    blocks.forEach((block) => { if (index < block.data.length) codewords.push(block.data[index]); });
  }
  for (let index = 0; index < spec.ecc; index += 1) blocks.forEach((block) => codewords.push(block.ecc[index]));
  return { version, codewords };
}

function formatBits(mask) {
  const data = (1 << 3) | mask; // Error-correction level L.
  let remainder = data;
  for (let index = 0; index < 10; index += 1) remainder = (remainder << 1) ^ (((remainder >>> 9) & 1) * 0x537);
  return ((data << 10) | remainder) ^ 0x5412;
}

function drawFormat(matrix, functions, mask) {
  const size = matrix.length;
  const bits = formatBits(mask);
  const set = (x, y, bit) => {
    matrix[y][x] = ((bits >>> bit) & 1) !== 0;
    functions[y][x] = true;
  };
  for (let index = 0; index <= 5; index += 1) set(8, index, index);
  set(8, 7, 6); set(8, 8, 7); set(7, 8, 8);
  for (let index = 9; index < 15; index += 1) set(14 - index, 8, index);
  for (let index = 0; index < 8; index += 1) set(size - 1 - index, 8, index);
  for (let index = 8; index < 15; index += 1) set(8, size - 15 + index, index);
  matrix[size - 8][8] = true;
  functions[size - 8][8] = true;
}

function drawFunctionPatterns(matrix, functions, version) {
  const size = matrix.length;
  const set = (x, y, dark) => {
    if (x >= 0 && y >= 0 && x < size && y < size) {
      matrix[y][x] = dark;
      functions[y][x] = true;
    }
  };
  const finder = (centerX, centerY) => {
    for (let y = -4; y <= 4; y += 1) {
      for (let x = -4; x <= 4; x += 1) {
        const distance = Math.max(Math.abs(x), Math.abs(y));
        set(centerX + x, centerY + y, distance !== 2 && distance !== 4);
      }
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  for (let index = 8; index < size - 8; index += 1) {
    set(6, index, index % 2 === 0);
    set(index, 6, index % 2 === 0);
  }
  if (version > 1) {
    const last = size - 7;
    for (const centerY of [6, last]) {
      for (const centerX of [6, last]) {
        if (functions[centerY][centerX]) continue;
        for (let y = -2; y <= 2; y += 1) {
          for (let x = -2; x <= 2; x += 1) set(centerX + x, centerY + y, Math.max(Math.abs(x), Math.abs(y)) !== 1);
        }
      }
    }
  }
  drawFormat(matrix, functions, 0);
}

export function encodeQrMatrix(value) {
  if (typeof value !== "string" || value.length === 0) throw new TypeError("QR payload must be a non-empty string.");
  const { version, codewords } = createCodewords(value);
  const size = version * 4 + 17;
  const matrix = Array.from({ length: size }, () => Array(size).fill(false));
  const functions = Array.from({ length: size }, () => Array(size).fill(false));
  drawFunctionPatterns(matrix, functions, version);

  const bits = [];
  codewords.forEach((byte) => appendBits(bits, byte, 8));
  let bitIndex = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right -= 1;
    for (let vertical = 0; vertical < size; vertical += 1) {
      const y = upward ? size - 1 - vertical : vertical;
      for (let offset = 0; offset < 2; offset += 1) {
        const x = right - offset;
        if (functions[y][x]) continue;
        const raw = bitIndex < bits.length && bits[bitIndex];
        matrix[y][x] = Boolean(raw) !== ((x + y) % 2 === 0); // Mask pattern 0.
        bitIndex += 1;
      }
    }
    upward = !upward;
  }
  return matrix;
}

export function renderQrSvg(value, { scale = 5, border = 4 } = {}) {
  const matrix = encodeQrMatrix(value);
  const size = matrix.length + border * 2;
  const path = [];
  matrix.forEach((row, y) => row.forEach((dark, x) => {
    if (dark) path.push(`M${x + border},${y + border}h1v1h-1z`);
  }));
  return `<svg class="ticket-qr" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size * scale}" height="${size * scale}" role="img" aria-label="电子凭证二维码"><rect width="100%" height="100%" fill="#fff"/><path d="${path.join("")}" fill="#111"/></svg>`;
}
