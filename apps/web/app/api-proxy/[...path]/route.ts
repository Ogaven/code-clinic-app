import { NextRequest, NextResponse } from 'next/server'

// Read at REQUEST TIME (runtime) — not baked in at build time.
// Set API_URL in Railway Web service Variables to your API service URL.
const API_URL = process.env.API_URL || 'http://localhost:4000'

async function handler(
  request: NextRequest,
  { params }: { params: { path: string[] } },
) {
  const path = params.path.join('/')
  const { search } = new URL(request.url)
  const targetUrl = `${API_URL}/${path}${search}`

  // Forward headers, drop hop-by-hop headers that would cause issues
  const headers: Record<string, string> = {}
  request.headers.forEach((value, key) => {
    if (!['host', 'connection', 'keep-alive', 'te', 'trailers', 'transfer-encoding', 'upgrade'].includes(key)) {
      headers[key] = value
    }
  })

  try {
    const isBodyMethod = !['GET', 'HEAD'].includes(request.method)
    const body = isBodyMethod ? await request.arrayBuffer() : undefined

    const upstream = await fetch(targetUrl, {
      method: request.method,
      headers,
      body: body ? Buffer.from(body) : undefined,
    })

    // Forward response headers, strip problematic ones
    const resHeaders = new Headers()
    upstream.headers.forEach((value, key) => {
      if (!['content-encoding', 'transfer-encoding', 'connection'].includes(key)) {
        resHeaders.set(key, value)
      }
    })

    const resBody = await upstream.arrayBuffer()
    return new NextResponse(resBody, {
      status: upstream.status,
      headers: resHeaders,
    })
  } catch (err) {
    console.error('[api-proxy] upstream error:', err)
    return NextResponse.json(
      { error: 'Cannot reach API server. Check API_URL env var.' },
      { status: 502 },
    )
  }
}

export const GET     = handler
export const POST    = handler
export const PUT     = handler
export const PATCH   = handler
export const DELETE  = handler
export const OPTIONS = handler
