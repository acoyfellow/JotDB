import { JotDB } from "./JotDB";

export { JotDB };

export default {
  async fetch(request: Request, env: { JOTDB: DurableObjectNamespace }, ctx: ExecutionContext): Promise<Response> {
    // This is just a stub to satisfy the module worker requirement
    // The actual functionality is in the JotDB class
    return new Response("JotDB Durable Object", { status: 200 });
  }
};