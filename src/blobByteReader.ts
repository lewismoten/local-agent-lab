/** Reads small windows from a Blob without buffering the complete media file. */
export class BlobByteReader {
  private offset = -1;
  private window = new Uint8Array(0);
  readonly blob: Blob;
  private readonly windowBytes: number;
  constructor(blob: Blob, windowBytes = 64 * 1024) {
    this.blob = blob;
    this.windowBytes = windowBytes;
  }

  async read(start: number, length: number): Promise<Uint8Array> {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || start < 0 || length < 0
      || length > this.windowBytes || start + length > this.blob.size)
      throw new Error('Invalid media timing field.');
    if (!length) return new Uint8Array(0);
    if (start < this.offset || start + length > this.offset + this.window.length) {
      this.offset = start;
      this.window = new Uint8Array(await this.blob.slice(start, Math.min(this.blob.size, start + this.windowBytes)).arrayBuffer());
    }
    return this.window.subarray(start - this.offset, start - this.offset + length);
  }
}
