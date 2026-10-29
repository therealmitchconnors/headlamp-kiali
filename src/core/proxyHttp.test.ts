import { ProxyHttpResponse } from './proxyHttp';

const encode = (text: string) => new TextEncoder().encode(text);
const headers = 'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n';
function response(body = '{"version":"synthetic"}') {
  return encode(`${headers}Content-Length: ${encode(body).length}\r\n\r\n${body}`);
}
it.each([1, 2, 7, 16384, 100000])('decodes exact JSON with %s-byte input frames', size => {
  const body = JSON.stringify({ text: '€'.repeat(10000) });
  const bytes = response(body);
  const parser = new ProxyHttpResponse(65536);
  for (let offset = 0; offset < bytes.length; offset += size)
    parser.push(bytes.subarray(offset, offset + size));
  expect(parser.complete).toBe(true);
  expect(parser.json()).toEqual(JSON.parse(body));
});
it.each([1, 3, 1024])(
  'handles chunked UTF-8, split CRLF and trailers with %s-byte frames',
  size => {
    const bytes = encode(
      `${headers}Transfer-Encoding: chunked\r\n\r\n3\r\n{"x\r\n7\r\n":"€"\r\n1\r\n}\r\n0\r\nx-test: ok\r\n\r\n`
    );
    const parser = new ProxyHttpResponse(100);
    for (let offset = 0; offset < bytes.length; offset += size)
      parser.push(bytes.subarray(offset, offset + size));
    expect(parser.json()).toEqual({ x: '€' });
  }
);
it.each([
  ['HTTP/1.1 403 Forbidden\r\n\r\n', 'HTTP 403'],
  ['garbage\r\n\r\n', 'invalid HTTP'],
  [headers + 'Content-Length: 2\r\nContent-Length: 2\r\n\r\n{}', 'Duplicate'],
  [headers + 'Content-Length: 2\r\nTransfer-Encoding: chunked\r\n\r\n', 'ambiguous'],
  [headers + '\r\n{}', 'explicit length'],
  [headers + 'Content-Length: -1\r\n\r\n', 'explicit length'],
  [headers + 'Content-Length: 101\r\n\r\n', 'byte limit'],
  [headers + 'Content-Length: 2\r\nContent-Encoding: gzip\r\n\r\n', 'Compressed'],
  ['HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 2\r\n\r\n{}', 'JSON'],
  [headers + 'Transfer-Encoding: gzip\r\n\r\n', 'Unsupported'],
  [headers + 'Transfer-Encoding: chunked\r\n\r\nffff\r\n', 'byte limit'],
  [headers + 'Transfer-Encoding: chunked\r\n\r\nx\r\n', 'chunk size'],
  [headers + 'Transfer-Encoding: chunked\r\n\r\n0\r\nContent-Length: 0\r\n\r\n', 'trailer'],
  [headers + 'Transfer-Encoding: chunked\r\n\r\n2\r\n{}x\r\n0\r\n\r\n', 'separator'],
  [headers + 'Content-Length: 2\r\n\r\n{}extra', 'Unexpected data'],
  ['HTTP/1.1 200 OK\n', 'line ending'],
  [headers + 'x: ' + 'a'.repeat(16384), '16 KiB'],
])('rejects malformed or unsupported framing %#', (input, message) => {
  expect(() => new ProxyHttpResponse(100).push(encode(input))).toThrow(message);
});
it('rejects incomplete content, invalid JSON/UTF-8, and excessive chunk counts', () => {
  const incomplete = new ProxyHttpResponse(100);
  incomplete.push(encode(headers + 'Content-Length: 5\r\n\r\n{}'));
  expect(incomplete.complete).toBe(false);
  expect(() => incomplete.json()).toThrow('Incomplete');
  const invalid = new ProxyHttpResponse(100);
  invalid.push(response('not json'));
  expect(() => invalid.json()).toThrow();
  const utf8 = new ProxyHttpResponse(100);
  utf8.push(encode(headers + 'Content-Length: 1\r\n\r\n'));
  utf8.push(new Uint8Array([255]));
  expect(() => utf8.json()).toThrow();
  const chunks = new ProxyHttpResponse(10000);
  expect(() =>
    chunks.push(encode(headers + 'Transfer-Encoding: chunked\r\n\r\n' + '1\r\nx\r\n'.repeat(8193)))
  ).toThrow('8192');
});
it('accepts the exact byte bound but rejects larger or invalid bounds', () => {
  const parser = new ProxyHttpResponse(2);
  parser.push(response('{}'));
  expect(parser.json()).toEqual({});
  expect(() => new ProxyHttpResponse(2).push(response('{"a":1}'))).toThrow('byte limit');
  for (const limit of [0, -1, 1.5, 4194305, Infinity])
    expect(() => new ProxyHttpResponse(limit)).toThrow('bounds');
});
