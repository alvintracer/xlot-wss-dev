import bff from '../services/institution-bff/dist/server.cjs';

export default function handleVercelRequest(request, response) {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  const routedPath = url.searchParams.get('path');
  if (routedPath && /^[a-z0-9/_-]+$/i.test(routedPath)) {
    request.url = `/${routedPath.replace(/^\/+/, '')}`;
  }
  return bff.handleBffRequest(request, response);
}
