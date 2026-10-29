const HEADER_LIMIT = 16384;
const FRAMING_LIMIT = 65536;

/** Incremental HTTP/1 response framing for a single bounded Envoy JSON read. */
export class ProxyHttpResponse {
  private phase: 'headers' | 'length' | 'size' | 'data' | 'separator' | 'trailers' | 'done' =
    'headers';
  private line = '';
  private headers: string[] = [];
  private headerBytes = 0;
  private framingBytes = 0;
  private chunks = 0;
  private remaining = 0;
  private body: Uint8Array;
  private written = 0;

  constructor(private readonly maxBytes: number) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 4194304)
      throw new Error('Proxy response bounds must be between 1 byte and 4 MiB');
    this.body = new Uint8Array(maxBytes);
  }

  get complete() {
    return this.phase === 'done';
  }

  push(bytes: Uint8Array) {
    let offset = 0;
    while (offset < bytes.length) {
      if (this.phase === 'done') throw new Error('Unexpected data after the proxy HTTP response');
      if (this.phase === 'length' || this.phase === 'data') {
        const count = Math.min(this.remaining, bytes.length - offset);
        if (this.written + count > this.maxBytes)
          throw new Error('Proxy response exceeds its byte limit');
        this.body.set(bytes.subarray(offset, offset + count), this.written);
        this.written += count;
        this.remaining -= count;
        offset += count;
        if (!this.remaining) this.phase = this.phase === 'length' ? 'done' : 'separator';
        continue;
      }
      const byte = bytes[offset++];
      if (this.phase === 'headers') {
        if (++this.headerBytes > HEADER_LIMIT) throw new Error('Proxy HTTP headers exceed 16 KiB');
      } else if (++this.framingBytes > FRAMING_LIMIT) {
        throw new Error('Proxy chunk framing exceeds 64 KiB');
      }
      if (
        (byte < 32 && byte !== 9 && byte !== 13 && byte !== 10) ||
        byte > 126 ||
        this.line.length >= HEADER_LIMIT
      )
        throw new Error('Malformed proxy HTTP framing');
      this.line += String.fromCharCode(byte);
      if (byte !== 10) continue;
      if (!this.line.endsWith('\r\n') || this.line.slice(0, -2).includes('\r'))
        throw new Error('Malformed proxy HTTP line ending');
      const line = this.line.slice(0, -2);
      this.line = '';
      this.consumeLine(line);
    }
  }

  json(): unknown {
    if (!this.complete) throw new Error('Incomplete proxy HTTP response');
    return JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(this.body.subarray(0, this.written))
    );
  }

  private consumeLine(line: string) {
    if (this.phase === 'headers') {
      if (line) {
        this.headers.push(line);
      } else {
        this.startBody();
      }
    } else if (this.phase === 'size') {
      if (!/^[0-9a-fA-F]{1,8}$/.test(line))
        throw new Error('Unsupported or invalid proxy HTTP chunk size');
      if (++this.chunks > 8192) throw new Error('Proxy response exceeds 8192 chunks');
      this.remaining = parseInt(line, 16);
      if (this.written + this.remaining > this.maxBytes)
        throw new Error('Proxy response exceeds its byte limit');
      this.phase = this.remaining ? 'data' : 'trailers';
    } else if (this.phase === 'separator') {
      if (line) throw new Error('Malformed proxy HTTP chunk separator');
      this.phase = 'size';
    } else if (this.phase === 'trailers') {
      if (!line) this.phase = 'done';
      else if (!/^[!#$%&'*+.^_`|~0-9a-z-]+:[\t -~]*$/i.test(line))
        throw new Error('Malformed proxy HTTP trailer');
      else if (/^(content-length|transfer-encoding|content-encoding|content-type):/i.test(line))
        throw new Error('Unexpected proxy HTTP framing trailer');
    }
  }

  private startBody() {
    const status = /^HTTP\/1\.[01] ([0-9]{3})(?: [\t -~]*)?$/.exec(this.headers[0] ?? '');
    if (!status) throw new Error('Proxy admin returned an invalid HTTP response');
    if (status[1] !== '200') throw new Error(`Proxy admin returned HTTP ${status[1]}`);
    const headers = new Map<string, string>();
    for (const line of this.headers.slice(1)) {
      const match = /^([!#$%&'*+.^_`|~0-9a-z-]+):([\t -~]*)$/i.exec(line);
      if (!match) throw new Error('Malformed proxy HTTP header');
      const name = match[1].toLowerCase();
      if (headers.has(name)) throw new Error('Duplicate proxy HTTP header');
      headers.set(name, match[2].trim());
    }
    if (!/^application\/json(?:\s*;.*)?$/i.test(headers.get('content-type') ?? ''))
      throw new Error('Proxy admin did not return JSON content');
    const encoding = headers.get('content-encoding');
    if (encoding && encoding.toLowerCase() !== 'identity')
      throw new Error('Compressed proxy responses are not supported');
    const transfer = headers.get('transfer-encoding');
    const length = headers.get('content-length');
    if (transfer !== undefined) {
      if (transfer.toLowerCase() !== 'chunked' || length !== undefined)
        throw new Error('Unsupported or ambiguous proxy HTTP framing');
      this.phase = 'size';
    } else {
      if (length === undefined || !/^[0-9]+$/.test(length))
        throw new Error('Proxy response requires explicit length or chunked framing');
      this.remaining = Number(length);
      if (!Number.isSafeInteger(this.remaining) || this.remaining > this.maxBytes)
        throw new Error('Proxy response exceeds its byte limit');
      this.phase = this.remaining ? 'length' : 'done';
    }
  }
}
