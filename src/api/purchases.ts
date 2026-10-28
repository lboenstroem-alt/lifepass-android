/**
 * The member's purchase history, `GET /purchases`: the Android port of iOS
 * `Purchase` and `PaymentService.fetchPurchases`
 * (Services/PaymentService.swift).
 *
 * One row is an ORDER the member started or paid: a plan's first payment, a
 * visitor pass, a gift, a top-up, a partner-code or channel grant, a monthly
 * company co-pay share. Monthly renewals that Kling charges on a self-paid
 * plan are not orders and are not listed: Kling emails their receipts.
 *
 * Read strictly where iOS is strict (the id is a UUID, every required member
 * has its type), and leniently where the contract says the set can grow:
 * `productType` and `status` stay raw strings, so a value a newer server adds
 * never fails the page.
 */
import { apiGet } from './client';
import { parseIsoDate, wireId } from './wire';

export interface Purchase {
  /** The order id, lower case. */
  readonly id: string;
  readonly productSlug: string;
  /** As stored, not localised. */
  readonly productName: string;
  /** `subscription` | `topup` | `tourist_pack` | `employer_plan` | `pass`, or a newer value, kept raw. */
  readonly productType: string;
  /** Whole ISK, net of any discount code. 0 for a free code or a gift. */
  readonly amountIsk: number;
  /** `pending` | `paid` | `fulfilled` | `cancelled` | `refunded`, or a newer value, kept raw. */
  readonly status: string;
  readonly createdAt: Date;
  readonly fulfilledAt: Date | null;
}

export interface PurchasesPage {
  readonly data: readonly Purchase[];
  readonly pagination: {
    /** Opaque: sent back exactly as the last page returned it. */
    readonly nextCursor: string | null;
    readonly hasMore: boolean;
    readonly limit: number | null;
  };
}

/** One page, as iOS asks for it. */
export const PURCHASES_PAGE_SIZE = 20;

/**
 * Paid for, whether or not delivered yet. A pending checkout is not a receipt
 * and is never shown as one.
 */
export function isPurchasePaid(purchase: Pick<Purchase, 'status'>): boolean {
  return purchase.status === 'paid' || purchase.status === 'fulfilled';
}

/** A shape the decoder refuses; the API client turns it into `DecodingError`. */
export class PurchaseShapeError extends Error {
  constructor(readonly path: string) {
    super(`unexpected purchases shape at ${path}`);
    this.name = 'PurchaseShapeError';
  }
}

type Json = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function object(value: unknown, path: string): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new PurchaseShapeError(path);
  return value as Json;
}

function string(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new PurchaseShapeError(path);
  return value;
}

function int(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new PurchaseShapeError(path);
  return value;
}

function date(value: unknown, path: string): Date {
  const parsed = parseIsoDate(string(value, path));
  if (!parsed) throw new PurchaseShapeError(path);
  return parsed;
}

function decodePurchase(value: unknown, path: string): Purchase {
  const raw = object(value, path);
  const id = string(raw.id, `${path}.id`);
  if (!UUID.test(id)) throw new PurchaseShapeError(`${path}.id`);
  return {
    id: wireId(id),
    productSlug: string(raw.productSlug, `${path}.productSlug`),
    productName: string(raw.productName, `${path}.productName`),
    productType: string(raw.productType, `${path}.productType`),
    amountIsk: int(raw.amountIsk, `${path}.amountIsk`),
    status: string(raw.status, `${path}.status`),
    createdAt: date(raw.createdAt, `${path}.createdAt`),
    fulfilledAt:
      raw.fulfilledAt === undefined || raw.fulfilledAt === null ? null : date(raw.fulfilledAt, `${path}.fulfilledAt`),
  };
}

/** `GET /purchases`' `data`: `{ data, pagination }` (iOS `Paginated<Purchase>`). */
export function decodePurchasesPage(value: unknown): PurchasesPage {
  const raw = object(value, 'page');
  if (!Array.isArray(raw.data)) throw new PurchaseShapeError('data');
  const pagination = object(raw.pagination, 'pagination');
  if (typeof pagination.hasMore !== 'boolean') throw new PurchaseShapeError('pagination.hasMore');
  const nextCursor = pagination.nextCursor;
  if (nextCursor !== undefined && nextCursor !== null && typeof nextCursor !== 'string') {
    throw new PurchaseShapeError('pagination.nextCursor');
  }
  const limit = pagination.limit;
  if (limit !== undefined && limit !== null && !(typeof limit === 'number' && Number.isInteger(limit))) {
    throw new PurchaseShapeError('pagination.limit');
  }
  return {
    data: raw.data.map((row, index) => decodePurchase(row, `data[${index}]`)),
    pagination: {
      nextCursor: typeof nextCursor === 'string' ? nextCursor : null,
      hasMore: pagination.hasMore,
      limit: typeof limit === 'number' ? limit : null,
    },
  };
}

/**
 * `GET /purchases?limit=20[&cursor=…]`: the member's orders, newest first, one
 * page. The cursor is opaque: sent back exactly as the last page returned it.
 * A server without the route answers 404; Receipts then sends the member to
 * the website's purchase history.
 */
export function fetchPurchases(
  options: { readonly limit?: number; readonly cursor?: string | null; readonly signal?: AbortSignal } = {},
): Promise<PurchasesPage> {
  return apiGet<PurchasesPage>(
    '/purchases',
    { limit: options.limit ?? PURCHASES_PAGE_SIZE, cursor: options.cursor ?? undefined },
    { signal: options.signal, decode: decodePurchasesPage },
  );
}
