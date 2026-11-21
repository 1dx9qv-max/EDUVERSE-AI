import { onRequest, type PagesEnv } from './functions/api/[[path]].ts';

export default {
  async fetch(request: Request, env: PagesEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      return onRequest({ request, env });
    }
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response('Static asset binding (ASSETS) is not configured.', { status: 500 });
  },
};
