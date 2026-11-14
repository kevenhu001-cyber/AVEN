import { createMockEventStream, mockRequest } from '@/mocks/handlers';
import { NextResponse, type NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Local mock API surface for the personal Web. It only exists when the process was
 * started with AVEN_WEB_MOCK=1 (see scripts/mock-web.mjs); without the flag every
 * request here is unreachable because next.config rewrites /api/v1/* to the real API
 * in beforeFiles. The mock layer serves labelled synthetic data and implements no
 * business rules — it must never be exposed as a real backend.
 */
function isWebMockEnabled(): boolean {
  return process.env.AVEN_WEB_MOCK === '1';
}

function notFound() {
  return NextResponse.json({ error: { code: 'NOT_FOUND', request_id: 'mock' } }, { status: 404 });
}

async function handle(request: NextRequest, method: string): Promise<NextResponse | Response> {
  if (!isWebMockEnabled()) return notFound();
  const { pathname, searchParams } = request.nextUrl;
  const prefix = '/api/v1/';
  if (!pathname.startsWith(prefix)) return notFound();
  const segments = pathname.slice(prefix.length).split('/').filter(Boolean);
  let body: unknown;
  if (method !== 'GET' && method !== 'DELETE') {
    try {
      body = await request.json();
    } catch {
      body = undefined;
    }
  }
  const headerEntries: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headerEntries[key.toLowerCase()] = value;
  });
  const result = mockRequest(method, segments, searchParams, body, headerEntries);
  if (!result) return notFound();
  const responseHeaders = new Headers(result.headers);
  if (result.kind === 'json') {
    return NextResponse.json(result.body, { status: result.status, headers: responseHeaders });
  }
  if (result.kind === 'empty') {
    return new NextResponse(null, { status: result.status, headers: responseHeaders });
  }
  const stream = createMockEventStream(result.runId);
  responseHeaders.set('Content-Type', 'text/event-stream; charset=utf-8');
  responseHeaders.set('Cache-Control', 'no-cache, no-transform');
  responseHeaders.set('Connection', 'keep-alive');
  return new NextResponse(stream, { status: result.status, headers: responseHeaders });
}

export async function GET(request: NextRequest) {
  return handle(request, 'GET');
}
export async function POST(request: NextRequest) {
  return handle(request, 'POST');
}
export async function PUT(request: NextRequest) {
  return handle(request, 'PUT');
}
export async function PATCH(request: NextRequest) {
  return handle(request, 'PATCH');
}
export async function DELETE(request: NextRequest) {
  return handle(request, 'DELETE');
}
