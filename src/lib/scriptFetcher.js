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
    const { data, error } = await supabase.functions.invoke('fetch-script', {
      body: { url },
    })

    if (error) {
      throw error
    }

    if (!data?.content) {
      throw new Error('No content returned from fetch-script function')
    }

    const cleaned = sanitizeHtmlToText(data.content)
    if (!cleaned || cleaned.length < 50) {
      throw new Error('Fetched content is too short to parse')
    }

    return cleaned
  } catch (err) {
    console.error('Error fetching script:', err)
    throw new Error('Failed to fetch script from URL')
  }
}

