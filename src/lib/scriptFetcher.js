import { supabase } from './supabase'

function sanitizeHtmlToText(html) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  const scriptContent = doc.querySelector('pre, .scrtext') || doc.body
  const scripts = scriptContent.querySelectorAll('script, style')
  scripts.forEach((el) => el.remove())
  return (scriptContent.innerText || scriptContent.textContent || '').trim()
}

// Fetch script from URL (e.g., imsdb.com) through Supabase Edge Function
export async function fetchScriptFromUrl(url) {
  try {
    // Try Supabase Edge Function first
    const { data, error } = await supabase.functions.invoke('fetch-script', {
      body: { url },
    })

    if (!error && data?.content) {
      const cleaned = sanitizeHtmlToText(data.content)
      if (cleaned && cleaned.length >= 50) {
        return cleaned
      }
    }

    // Fallback: Try multiple CORS proxies
    console.warn('Edge Function unavailable, trying fallback proxies...')
    
    const proxies = [
      `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
      `https://corsproxy.io/?${encodeURIComponent(url)}`,
      `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
    ]
    
    for (const proxyUrl of proxies) {
      try {
        const resp = await fetch(proxyUrl, {
          headers: {
            'Accept': 'text/html, text/plain',
          },
        })
        
        if (!resp.ok) continue
        
        let proxyData
        if (proxyUrl.includes('allorigins.win')) {
          proxyData = await resp.json()
          if (proxyData?.contents) {
            const cleaned = sanitizeHtmlToText(proxyData.contents)
            if (cleaned && cleaned.length >= 50) {
              return cleaned
            }
          }
        } else {
          const text = await resp.text()
          if (text && text.length >= 50) {
            const cleaned = sanitizeHtmlToText(text)
            if (cleaned && cleaned.length >= 50) {
              return cleaned
            }
          }
        }
      } catch (proxyErr) {
        console.warn(`Proxy ${proxyUrl} failed:`, proxyErr)
        continue
      }
    }
    
    throw new Error('All proxy attempts failed')
  } catch (err) {
    console.error('Error fetching script:', err)
    throw new Error('Failed to fetch script from URL')
  }
}

