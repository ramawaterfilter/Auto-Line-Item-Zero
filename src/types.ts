export interface Env {
  DB: D1Database;
  JOBS: Queue<JobMessage>;
  SHOPIFY_API_KEY: string;
  SHOPIFY_API_SECRET: string;
  SHOPIFY_APP_URL: string;
  SHOPIFY_API_VERSION: string;
  SHOPIFY_SCOPES: string;
  TOKEN_ENCRYPTION_KEY: string;
  GOOGLE_SERVICE_ACCOUNT_EMAIL: string;
  GOOGLE_PRIVATE_KEY: string;
  GOOGLE_SPREADSHEET_ID: string;
  MAX_DATE_RANGE_DAYS: string;
  TARGET_VARIANT_IDS: string;
  ORDER_EDIT_STAFF_NOTE: string;
}

export type JobMessage =
  | { kind: "DISCOVER"; jobId: string }
  | { kind: "PROCESS"; jobId: string; jobOrderId: string };

export type JobStatus =
  | "PENDING" | "DISCOVERING" | "PROCESSING" | "CANCELLING"
  | "CANCELLED" | "COMPLETED" | "FAILED";

export type OrderStatus =
  | "PENDING" | "PROCESSING" | "SUCCESS" | "SKIPPED" | "FAILED"
  | "AUDIT_AFTER_FAILED" | "CANCELLED";

export interface ShopRow {
  automation_enabled_at?: string | null;
  automation_checked_through?: string | null;
  id: string;
  shop_domain: string;
  access_token_ciphertext: string;
  access_token_iv: string;
  refresh_token_ciphertext: string | null;
  refresh_token_iv: string | null;
  token_expires_at: string | null;
  refresh_token_expires_at: string | null;
  token_refreshing_at?: string | null;
  scopes: string;
  timezone: string;
  status: "ACTIVE" | "UNINSTALLED";
}

export interface JobRow {
  automation_enabled_at?: string | null;
  automatic_order_id?: string | null;
  id: string;
  shop_id: string;
  start_date: string;
  end_date: string;
  timezone: string;
  status: JobStatus;
  selection_ready: number;
  discovery_cursor: string | null;
  total_orders: number;
  eligible_orders: number;
  processed_orders: number;
  success_count: number;
  skipped_count: number;
  failed_count: number;
  rolling_avg_ms: number | null;
  last_order_name: string | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface JobOrderRow {
  id: string;
  job_id: string;
  shop_id: string;
  shopify_order_id: string;
  order_name: string;
  eligible: number | null;
  status: OrderStatus;
  attempts: number;
  before_audit_status: string;
  after_audit_status: string;
  before_row_start: number | null;
  after_row_start: number | null;
  audit_row_count: number | null;
  snapshot_json: string | null;
  result_json: string | null;
  shopify_order_edit_id: string | null;
  error_message: string | null;
}

export interface Money {
  amount: string;
  currencyCode: string;
}

export interface OrderLine {
  id: string;
  quantity: number;
  currentQuantity: number;
  name: string;
  sku: string | null;
  variant: { id: string; title: string; product: { title: string } } | null;
  originalUnitPriceSet: { shopMoney: Money };
}

export interface ShopifyOrder {
  id: string;
  name: string;
  createdAt: string;
  cancelledAt: string | null;
  email: string | null;
  totalPriceSet: { shopMoney: Money };
  lineItems: { nodes: OrderLine[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
}

export interface AuditLine {
  variantId: string;
  productTitle: string;
  variantTitle: string;
  sku: string;
  quantityBefore: number;
  unitPrice: string;
  lineItemId: string;
}

export interface OrderSnapshot {
  orderId: string;
  orderName: string;
  orderCreatedAt: string;
  customerEmail: string;
  orderTotalBefore: string;
  lines: AuditLine[];
}
