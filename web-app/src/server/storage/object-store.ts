import "server-only";

export type ObjectMetadata = {
  size?: string | number;
  generation: string;
  contentType?: string;
  cacheControl?: string;
  metadata: Record<string, string>;
};

export type SaveOptions = {
  contentType: string;
  cacheControl?: string;
  metadata?: Record<string, string>;
};

export type WriteUrlOptions = {
  contentType: string;
  cacheControl?: string;
  expiresAt: number;
};

export type ReadWindow = { accessibleAt: number; expires: number };

export type ObjectStore = {
  save(objectPath: string, bytes: Uint8Array, options: SaveOptions): Promise<void>;
  remove(objectPath: string): Promise<void>;
  copy(fromObjectPath: string, toObjectPath: string): Promise<void>;
  head(objectPath: string): Promise<ObjectMetadata | null>;
  setCacheControl(objectPath: string, cacheControl: string): Promise<void>;

  headIn(bucket: string, objectPath: string): Promise<ObjectMetadata | null>;
  download(bucket: string, objectPath: string): Promise<Buffer>;
  readUrl(bucket: string, objectPath: string, expiresAt: number): Promise<string>;
  windowedReadUrl(bucket: string, objectPath: string, window: ReadWindow): Promise<string>;

  writeUrl(objectPath: string, options: WriteUrlOptions): Promise<string>;
};
