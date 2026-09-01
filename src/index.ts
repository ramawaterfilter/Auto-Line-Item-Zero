import { api, json } from "./api";
import { authenticatedStaff, beginAuth, finishAuth, logout, uninstallWebhook } from "./auth";
import { isRetryable, messageRetryDelay, discover, processOrder, safeError } from "./processor";
import { appPage, landingPage } from "./ui";
import type { Env, JobMessage } from "./types";

const securityHeaders = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-ancestors https://admin.shopify.com https://*.myshopify.com",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

export default {
  async fetch(request, env): Promise<Response> {
    try {
      const url = new URL(request.url);
      let response: Response;
      if (request.method === "GET" && url.pathname === "/") response = html(landingPage());
      else if (request.method === "GET" && url.pathname === "/auth") response = await beginAuth(request, env);
      else if (request.method === "GET" && url.pathname === "/auth/callback") response = await finishAuth(request, env);
      else if (request.method === "POST" && url.pathname === "/logout") response = logout();
      else if (request.method === "POST" && url.pathname === "/webhooks/app-uninstalled") response = await uninstallWebhook(request, env);
      else if (request.method === "GET" && url.pathname === "/app") {
        const staff = await authenticatedStaff(request, env);
        if (!staff) {
          const requestedShop = url.searchParams.get("shop");
          response = requestedShop ? Response.redirect(`${env.SHOPIFY_APP_URL.replace(/\/$/, "")}/auth?shop=${encodeURIComponent(requestedShop)}`, 302) : Response.redirect(`${env.SHOPIFY_APP_URL.replace(/\/$/, "")}/`, 302);
        } else response = html(appPage());
      } else if (url.pathname.startsWith("/api/")) response = await api(request, env);
      else response = new Response("Not found", { status: 404 });
      const headers = new Headers(response.headers);
      for (const [name, value] of Object.entries(securityHeaders)) headers.set(name, value);
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    } catch (error) {
      console.error(JSON.stringify({ operation: "request", status: "failed", message: safeError(error) }));
      return json({ error: "Unexpected server error" }, 500);
    }
  },

  async queue(batch, env): Promise<void> {
    for (const message of batch.messages) {
      try {
        if (!validMessage(message.body)) { message.ack(); continue; }
        if (message.body.kind === "DISCOVER") await discover(message.body.jobId, env);
        else await processOrder(message.body.jobId, message.body.jobOrderId, env, message.attempts);
        message.ack();
      } catch (error) {
        console.error(JSON.stringify({ operation: "queue", messageId: message.id, attempt: message.attempts, status: "failed", message: safeError(error) }));
        if (isRetryable(error) && message.attempts < 5) message.retry({ delaySeconds: messageRetryDelay(message.attempts) });
        else {
          if (message.body.kind === "DISCOVER") {
            await env.DB.prepare("UPDATE jobs SET status='FAILED', error_message=?, completed_at=?, updated_at=? WHERE id=? AND status IN ('PENDING','DISCOVERING')")
              .bind(safeError(error), new Date().toISOString(), new Date().toISOString(), message.body.jobId).run();
          }
          message.ack();
        }
      }
    }
  },
} satisfies ExportedHandler<Env, JobMessage>;

function validMessage(value: unknown): value is JobMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<JobMessage>;
  return (message.kind === "DISCOVER" && typeof message.jobId === "string") ||
    (message.kind === "PROCESS" && typeof message.jobId === "string" && "jobOrderId" in message && typeof message.jobOrderId === "string");
}

function html(body: string): Response {
  return new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
