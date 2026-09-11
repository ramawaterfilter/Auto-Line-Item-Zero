import worker from "./index";
import agentationScript from "../.generated/agentation.txt";

// Only `npm run dev` uses this entry point. Deployments use src/index.ts.
export default {
  ...worker,
  async fetch(...args: Parameters<typeof worker.fetch>): Promise<Response> {
    const [request] = args;
    const pathname = new URL(request.url).pathname;
    if (request.method === "GET" && pathname === "/__dev/agentation.js") {
      return new Response(agentationScript, {
        headers: {
          "Content-Type": "application/javascript; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    const response = await worker.fetch(...args);
    if (pathname !== "/app" || !response.headers.get("Content-Type")?.includes("text/html")) {
      return response;
    }
    return new HTMLRewriter().on("body", {
      element(element) {
        element.append('<div id="agentation-root"></div><script src="/__dev/agentation.js" defer></script>', { html: true });
      },
    }).transform(response);
  },
};
