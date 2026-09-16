import { PermanentError, RetryableError } from "./core";
import type { Env, OrderLine, ShopifyOrder } from "./types";

interface GraphqlEnvelope<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

interface UserError { field?: string[]; message: string }

export async function shopifyGraphql<T>(
  shop: string,
  token: string,
  env: Env,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`https://${shop}/admin/api/${env.SHOPIFY_API_VERSION}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query, variables }),
    });
  } catch {
    throw new RetryableError("Shopify network request failed");
  }
  if (response.status === 429 || response.status >= 500) throw new RetryableError(`Shopify returned HTTP ${response.status}`);
  if (!response.ok) throw new PermanentError(response.status === 401 || response.status === 403 ? "Shopify authorization failed" : `Shopify returned HTTP ${response.status}`);
  const envelope = await response.json<GraphqlEnvelope<T>>();
  if (envelope.errors?.length) throw new PermanentError(`Shopify GraphQL: ${envelope.errors.map((error) => error.message).join("; ")}`);
  if (!envelope.data) throw new RetryableError("Shopify returned no data");
  return envelope.data;
}

export function assertNoUserErrors(errors: UserError[] | undefined, operation: string): void {
  if (errors?.length) throw new PermanentError(`${operation}: ${errors.map((error) => error.message).join("; ")}`);
}

export interface OrderPage {
  nodes: Array<{ id: string; name: string }>;
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

export async function discoverOrderPage(
  shop: string, token: string, env: Env, query: string, cursor: string | null,
): Promise<OrderPage> {
  const data = await shopifyGraphql<{ orders: OrderPage }>(shop, token, env, `query DiscoverOrders($query: String!, $cursor: String) {
    orders(first: 50, after: $cursor, query: $query, sortKey: CREATED_AT) {
      nodes { id name }
      pageInfo { hasNextPage endCursor }
    }
  }`, { query, cursor });
  return data.orders;
}

export async function fetchOrder(shop: string, token: string, env: Env, orderId: string): Promise<ShopifyOrder | null> {
  const data = await shopifyGraphql<{ order: ShopifyOrder | null }>(shop, token, env, `query ProcessOrder($id: ID!, $cursor: String) {
    order(id: $id) {
      id name createdAt cancelledAt email
      totalPriceSet { shopMoney { amount currencyCode } }
      lineItems(first: 250, after: $cursor) {
        nodes { id quantity currentQuantity name sku variant { id title product { title } } originalUnitPriceSet { shopMoney { amount currencyCode } } }
        pageInfo { hasNextPage endCursor }
      }
    }
  }`, { id: orderId, cursor: null });
  if (!data.order) return null;
  const lines = [...data.order.lineItems.nodes];
  let page = data.order.lineItems.pageInfo;
  while (page.hasNextPage) {
    const next = await shopifyGraphql<{ order: { lineItems: ShopifyOrder["lineItems"] } | null }>(shop, token, env, `query MoreOrderLines($id: ID!, $cursor: String!) {
      order(id: $id) {
        lineItems(first: 250, after: $cursor) {
          nodes { id quantity currentQuantity name sku variant { id title product { title } } originalUnitPriceSet { shopMoney { amount currencyCode } } }
          pageInfo { hasNextPage endCursor }
        }
      }
    }`, { id: orderId, cursor: page.endCursor });
    if (!next.order) return null;
    lines.push(...next.order.lineItems.nodes);
    page = next.order.lineItems.pageInfo;
  }
  data.order.lineItems = { nodes: lines, pageInfo: page };
  return data.order;
}

interface CalculatedLine { id: string; quantity: number; variant: { id: string } | null }

export async function editTargetQuantities(
  shop: string, token: string, env: Env, orderId: string, targets: Set<string>,
): Promise<{ editId: string; total: string }> {
  const begun = await shopifyGraphql<{ orderEditBegin: {
    calculatedOrder: { id: string; lineItems: { nodes: CalculatedLine[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } | null;
    orderEditSession: { id: string } | null;
    userErrors: UserError[];
  } }>(shop, token, env, `mutation BeginEdit($id: ID!) {
    orderEditBegin(id: $id) {
      calculatedOrder {
        id
        lineItems(first: 250) { nodes { id quantity variant { id } } pageInfo { hasNextPage endCursor } }
      }
      orderEditSession { id }
      userErrors { field message }
    }
  }`, { id: orderId });
  assertNoUserErrors(begun.orderEditBegin.userErrors, "orderEditBegin");
  const calculated = begun.orderEditBegin.calculatedOrder;
  if (!calculated) throw new PermanentError("Shopify did not create an editable order");
  const lines = [...calculated.lineItems.nodes];
  let page = calculated.lineItems.pageInfo;
  while (page.hasNextPage) {
    const next = await shopifyGraphql<{ node: { lineItems: { nodes: CalculatedLine[]; pageInfo: typeof page } } | null }>(shop, token, env, `query MoreCalculatedLines($id: ID!, $cursor: String!) {
      node(id: $id) { ... on CalculatedOrder {
        lineItems(first: 250, after: $cursor) { nodes { id quantity variant { id } } pageInfo { hasNextPage endCursor } }
      } }
    }`, { id: calculated.id, cursor: page.endCursor });
    if (!next.node) throw new PermanentError("Calculated order became unavailable");
    lines.push(...next.node.lineItems.nodes);
    page = next.node.lineItems.pageInfo;
  }
  const matching = lines.filter((line) => line.variant && targets.has(line.variant.id.slice(line.variant.id.lastIndexOf("/") + 1)) && line.quantity > 0);
  if (!matching.length) throw new PermanentError("No editable target line items remain");
  for (const line of matching) {
    const changed = await shopifyGraphql<{ orderEditSetQuantity: { userErrors: UserError[] } }>(shop, token, env, `mutation ZeroLine($id: ID!, $lineItemId: ID!) {
      orderEditSetQuantity(id: $id, lineItemId: $lineItemId, quantity: 0, restock: false) {
        userErrors { field message }
      }
    }`, { id: calculated.id, lineItemId: line.id });
    assertNoUserErrors(changed.orderEditSetQuantity.userErrors, "orderEditSetQuantity");
  }
  const committed = await shopifyGraphql<{ orderEditCommit: {
    order: { id: string; totalPriceSet: { shopMoney: { amount: string } } } | null;
    userErrors: UserError[];
  } }>(shop, token, env, `mutation CommitEdit($id: ID!, $notifyCustomer: Boolean!, $staffNote: String!) {
    orderEditCommit(id: $id, notifyCustomer: $notifyCustomer, staffNote: $staffNote) {
      order { id totalPriceSet { shopMoney { amount } } }
      userErrors { field message }
    }
  }`, { id: calculated.id, notifyCustomer: false, staffNote: env.ORDER_EDIT_STAFF_NOTE });
  assertNoUserErrors(committed.orderEditCommit.userErrors, "orderEditCommit");
  if (!committed.orderEditCommit.order) throw new RetryableError("Shopify commit returned no order");
  return { editId: begun.orderEditBegin.orderEditSession?.id ?? calculated.id, total: committed.orderEditCommit.order.totalPriceSet.shopMoney.amount };
}

export function matchingLines(lines: OrderLine[], targets: Set<string>): OrderLine[] {
  return lines.filter((line) => line.variant && targets.has(line.variant.id.slice(line.variant.id.lastIndexOf("/") + 1)));
}

export function positiveMatchingLines(lines: OrderLine[], targets: Set<string>): OrderLine[] {
  return matchingLines(lines, targets).filter((line) => line.currentQuantity > 0);
}
