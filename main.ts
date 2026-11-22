// tiny stack VM — make.fun tiny-stack-vm-01, ISA v1
// Contract: data stack 256 x i32 (all arithmetic wraps), memory 256 words,
// call stack 64, step limit 1e6, output cap 65536 bytes. Exit codes: 0 =
// halt/EXIT, 2 stack underflow, 3 stack overflow, 4 div by zero, 5 bad
// opcode, 6 bad address, 7 call overflow, 8 RET with empty call stack,
// 9 pc or immediate out of bounds, 10 step limit, 11 output limit.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

function run(P: Uint8Array, I: Uint8Array): [Uint8Array, number] {
  const st = new Int32Array(256), mem = new Int32Array(256), cs = new Int32Array(64);
  const out = new Uint8Array(65536);
  let sp = 0, cp = 0, pc = 0, steps = 0, ip = 0, ol = 0, code = 0;
  const T = (e: number) => { throw { e }; };
  try {
    for (;;) {
      // fetch, in trap order: step limit, pc in bounds, immediate in bounds
      if (steps >= 1e6) T(10);
      if (pc < 0 || pc >= P.length) T(9);
      const op = P[pc];
      const il = op === 1 ? 1 : op === 2 ? 4 : op >= 0x30 && op <= 0x33 ? 2 : 0;
      if (pc + 1 + il > P.length) T(9);
      let im = 0;
      if (il === 1) im = (P[pc + 1] << 24) >> 24;
      else if (il === 2) im = P[pc + 1] | (P[pc + 2] << 8);
      else if (il === 4) im = P[pc + 1] | (P[pc + 2] << 8) | (P[pc + 3] << 16) | (P[pc + 4] << 24);
      const sm = (im << 16) >> 16;
      steps++;
      const a = st[sp - 2], b = st[sp - 1];
      switch (op) {
        case 0x00: T(0); break;
        case 0x01: case 0x02:
          if (sp > 255) T(3);
          st[sp++] = im; pc += 1 + il; break;
        case 0x03: if (sp < 1) T(2); sp--; pc++; break;
        case 0x04:
          if (sp < 1) T(2);
          if (sp > 255) T(3);
          st[sp] = st[sp - 1]; sp++; pc++; break;
        case 0x05: if (sp < 2) T(2); st[sp - 2] = b; st[sp - 1] = a; pc++; break;
        case 0x06:
          if (sp < 2) T(2);
          if (sp > 255) T(3);
          st[sp] = a; sp++; pc++; break;
        case 0x07: {
          if (sp < 3) T(2);
          const c = st[sp - 1];
          st[sp - 1] = st[sp - 3]; st[sp - 3] = st[sp - 2]; st[sp - 2] = c;
          pc++; break;
        }
        case 0x10: case 0x11: case 0x12: case 0x13: case 0x14: case 0x15: case 0x16:
        case 0x18: case 0x19: case 0x1a: case 0x1c: case 0x1d: case 0x1e:
        case 0x20: case 0x21: case 0x22: {
          if (sp < 2) T(2);
          let r = 0;
          if (op === 0x10) r = (a + b) | 0;
          else if (op === 0x11) r = (a - b) | 0;
          else if (op === 0x12) r = Math.imul(a, b);
          else if (op === 0x13) { if (!b) T(4); r = ((a - a % b) / b) | 0; }
          else if (op === 0x14) { if (!b) T(4); r = (a % b) | 0; }
          else if (op === 0x15) { if (!b) T(4); const u = a >>> 0, v = b >>> 0; r = ((u - u % v) / v) | 0; }
          else if (op === 0x16) { if (!b) T(4); r = ((a >>> 0) % (b >>> 0)) | 0; }
          else if (op === 0x18) r = a & b;
          else if (op === 0x19) r = a | b;
          else if (op === 0x1a) r = a ^ b;
          else if (op === 0x1c) r = a << (b & 31);
          else if (op === 0x1d) r = a >> (b & 31);
          else if (op === 0x1e) r = (a >>> (b & 31)) | 0;
          else if (op === 0x20) r = a === b ? 1 : 0;
          else if (op === 0x21) r = a < b ? 1 : 0;
          else r = (a >>> 0) < (b >>> 0) ? 1 : 0;
          st[sp - 2] = r; sp--; pc++; break;
        }
        case 0x17: if (sp < 1) T(2); st[sp - 1] = (-b) | 0; pc++; break;
        case 0x1b: if (sp < 1) T(2); st[sp - 1] = ~b; pc++; break;
        case 0x30: pc += 3 + sm; break;
        case 0x31: if (sp < 1) T(2); sp--; pc += 3; if (b === 0) pc += sm; break;
        case 0x32: if (sp < 1) T(2); sp--; pc += 3; if (b !== 0) pc += sm; break;
        case 0x33: if (cp > 63) T(7); cs[cp++] = pc + 3; pc = im; break;
        case 0x34: if (cp < 1) T(8); pc = cs[--cp]; break;
        case 0x40: if (sp < 1) T(2); if (b < 0 || b > 255) T(6); st[sp - 1] = mem[b]; pc++; break;
        case 0x41: if (sp < 2) T(2); if (b < 0 || b > 255) T(6); mem[b] = a; sp -= 2; pc++; break;
        case 0x50: {
          if (sp < 1) T(2);
          sp--;
          const s = String(b);
          if (ol + s.length > 65536) T(11);
          for (let i = 0; i < s.length; i++) out[ol++] = s.charCodeAt(i);
          pc++; break;
        }
        case 0x51:
          if (sp < 1) T(2);
          sp--;
          if (ol + 1 > 65536) T(11);
          out[ol++] = b & 255; pc++; break;
        case 0x52:
          if (sp > 255) T(3);
          st[sp++] = ip < I.length ? I[ip++] : -1; pc++; break;
        case 0x53: if (sp < 1) T(2); T(b & 255); break;
        default: T(5);
      }
    }
  } catch (x) {
    if (x && typeof x === "object" && "e" in x) code = (x as { e: number }).e;
    else throw x;
  }
  return [out.subarray(0, ol), code];
}

for (let n = 1; n <= 40; n++) {
  const id = "i" + String(n).padStart(3, "0");
  const pd = `/input/${id}/program.bin`;
  if (!existsSync(pd)) continue;
  const P = readFileSync(pd);
  const ip = `/input/${id}/input.bin`;
  const I = existsSync(ip) ? readFileSync(ip) : new Uint8Array(0);
  const [o, c] = run(P, I);
  mkdirSync(`/output/${id}`, { recursive: true });
  writeFileSync(`/output/${id}/stdout.bin`, o);
  writeFileSync(`/output/${id}/exit.txt`, c + "\n");
}
