// Fetch script from URL (e.g., imsdb.com)
export async function fetchScriptFromUrl(url) {
  // Prefer a public reader service that sets permissive CORS
  const jinaUrl =
    `https://r.jina.ai/${url.startsWith('http') ? url : `https://${url}`}`

  try {
    const response = await fetch(jinaUrl, { headers: { 'Accept': 'text/html, text/plain' } })
    if (!response.ok) {
      throw new Error(`Reader fetch failed with ${response.status}`)
    }
    const text = await response.text()
    // r.jina.ai returns readable HTML/text. Do a light cleanup.
    const cleaned = text
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<\/?[^>]+(>|$)/g, ' ') // strip tags
      .replace(/\s+\n/g, '\n')
      .trim()
    if (cleaned.length < 50) {
      throw new Error('Reader returned too little content')
    }
    return cleaned
  } catch (err) {
    console.error('Primary fetch failed, attempting legacy proxy...', err)
    // Fallback to legacy proxy if available
    try {
      const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`
      const resp = await fetch(proxyUrl)
      const data = await resp.json()
      const parser = new DOMParser()
      const doc = parser.parseFromString(data.contents, 'text/html')
      const scriptContent = doc.querySelector('pre') || doc.querySelector('.scrtext') || doc.body
      const scripts = scriptContent.querySelectorAll('script, style')
      scripts.forEach(el => el.remove())
      return scriptContent.innerText || scriptContent.textContent
    } catch (fallbackErr) {
      console.error('Fallback proxy failed:', fallbackErr)
      throw new Error('Failed to fetch script from URL')
    }
  }
}

