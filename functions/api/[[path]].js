// Every /api/ request on the site goes to the sign-in service (cloudflare/service.js). The project list is built in.
import { handle } from '../../cloudflare/service.js';
import projects from '../../cloudflare/projects.json';

export const onRequest = (context) => handle(context.request, context.env, projects, Date.now(), { waitUntil: (p) => context.waitUntil(p) });
