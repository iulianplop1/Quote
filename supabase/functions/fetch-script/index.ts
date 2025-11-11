import { serve } from 'https://deno.land/std@0.203.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    })
  }

  try {
    const body = await req.json().catch(() => null)
    const url = body?.url

    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      return new Response(
        JSON.stringify({ error: 'Invalid or missing url. Provide an absolute http(s) URL.' }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        },
      )
    }

    const upstream = await fetch(url, {
      headers: {
        'User-Agent': 'QuoteApp/1.0 (+https://iulianplop1.github.io/Quote/)',
        Accept: 'text/html, text/plain',
      },
    })

    if (!upstream.ok) {
      return new Response(
        JSON.stringify({
          error: `Upstream request failed with status ${upstream.status}`,
        }),
        {
          status: upstream.status,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        },
      )
    }

    const text = await upstream.text()
    const contentType = upstream.headers.get('content-type') ?? 'text/plain'

    return new Response(
      JSON.stringify({
        content: text,
        contentType,
        fetchedAt: new Date().toISOString(),
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      },
    )
  } catch (error) {
    console.error('fetch-script error:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to fetch script content.' }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      },
    )
  }
})

