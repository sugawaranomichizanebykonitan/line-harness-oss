const NEW_ORIGIN = 'https://frei-career.frei-career-consulting.workers.dev';

export default {
  fetch(request: Request): Response {
    const incoming = new URL(request.url);
    const destination = new URL(incoming.pathname + incoming.search, NEW_ORIGIN);
    return Response.redirect(destination.toString(), 308);
  },
};
