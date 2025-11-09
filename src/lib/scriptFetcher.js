// Fetch script from URL (e.g., imsdb.com)
export async function fetchScriptFromUrl(url) {
  try {
    // Use a CORS proxy for development, or set up proper backend
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`
    const response = await fetch(proxyUrl)
    const data = await response.json()
    
    // Parse HTML to extract script text
    const parser = new DOMParser()
    const doc = parser.parseFromString(data.contents, 'text/html')
    
    // Try to find script content (imsdb.com specific)
    const scriptContent = doc.querySelector('pre') || doc.querySelector('.scrtext') || doc.body
    
    // Remove script and style tags
    const scripts = scriptContent.querySelectorAll('script, style')
    scripts.forEach(el => el.remove())
    
    return scriptContent.innerText || scriptContent.textContent
  } catch (error) {
    console.error('Error fetching script:', error)
    throw new Error('Failed to fetch script from URL')
  }
}

