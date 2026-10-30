/**
 * The ported API was written against Cloudflare's ambient Worker types. These
 * aliases keep that code untouched while the actual implementation lives in
 * ./r2.ts. Delete this file if you ever move the API back onto Cloudflare.
 */
import type { R2Bucket as LocalBucket, R2GetOptions as LocalGetOptions, R2ListOptions as LocalListOptions, R2Object as LocalObject, R2ObjectBody as LocalObjectBody, R2Objects as LocalObjects, R2PutOptions as LocalPutOptions, R2Range as LocalRange } from './r2';

declare global {
  type R2Bucket = LocalBucket;
  type R2Object = LocalObject;
  type R2ObjectBody = LocalObjectBody;
  type R2Objects = LocalObjects;
  type R2Range = LocalRange;
  type R2GetOptions = LocalGetOptions;
  type R2PutOptions = LocalPutOptions;
  type R2ListOptions = LocalListOptions;
}

export {};
