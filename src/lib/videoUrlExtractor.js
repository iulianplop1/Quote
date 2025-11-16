import { supabase } from './supabase'

// Extract video URLs from HTML content
function extractVideoUrls(html) {
  const videoUrls = []
  
  // Parse HTML
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  
  // Method 1: Find <video> tags
  const videoTags = doc.querySelectorAll('video source, video[src]')
  videoTags.forEach(video => {
    const src = video.getAttribute('src') || video.getAttribute('data-src')
    if (src && (src.includes('.mp4') || src.includes('.m3u8') || src.includes('.webm'))) {
      videoUrls.push(src)
    }
  })
  
  // Method 2: Find video URLs in script tags (common in streaming sites)
  const scripts = doc.querySelectorAll('script')
  scripts.forEach(script => {
    const scriptText = script.textContent || script.innerHTML
    if (!scriptText) return
    
    // Look for m3u8 URLs
    const m3u8Matches = scriptText.match(/https?:\/\/[^\s"']+\.m3u8[^\s"']*/gi)
    if (m3u8Matches) {
      videoUrls.push(...m3u8Matches)
    }
    
    // Look for mp4 URLs
    const mp4Matches = scriptText.match(/https?:\/\/[^\s"']+\.mp4[^\s"']*/gi)
    if (mp4Matches) {
      videoUrls.push(...mp4Matches)
    }
    
    // Look for common video player variables (jwplayer, videojs, etc.)
    const playerVarMatches = scriptText.match(/(?:file|src|source|url|videoUrl|streamUrl|hlsUrl)\s*[:=]\s*["']([^"']+\.(?:m3u8|mp4|webm))["']/gi)
    if (playerVarMatches) {
      playerVarMatches.forEach(match => {
        const urlMatch = match.match(/["']([^"']+\.(?:m3u8|mp4|webm))["']/i)
        if (urlMatch && urlMatch[1]) {
          videoUrls.push(urlMatch[1])
        }
      })
    }
    
    // Look for JSON data with video URLs
    try {
      const jsonMatches = scriptText.match(/\{[^{}]*"(?:file|src|source|url|videoUrl|streamUrl|hlsUrl|playlist)"\s*:\s*"([^"]+)"[^{}]*\}/gi)
      if (jsonMatches) {
        jsonMatches.forEach(match => {
          try {
            const json = JSON.parse(match)
            const url = json.file || json.src || json.source || json.url || json.videoUrl || json.streamUrl || json.hlsUrl || json.playlist
            if (url && typeof url === 'string' && (url.includes('.mp4') || url.includes('.m3u8'))) {
              videoUrls.push(url)
            }
          } catch (e) {
            // Not valid JSON, try regex
            const urlMatch = match.match(/"([^"]+\.(?:m3u8|mp4|webm))"/i)
            if (urlMatch && urlMatch[1]) {
              videoUrls.push(urlMatch[1])
            }
          }
        })
      }
    } catch (e) {
      // Ignore JSON parsing errors
    }
  })
  
  // Method 3: Look for iframe sources (embedded players)
  const iframes = doc.querySelectorAll('iframe[src]')
  iframes.forEach(iframe => {
    const src = iframe.getAttribute('src')
    if (src && (src.includes('.mp4') || src.includes('.m3u8'))) {
      videoUrls.push(src)
    }
  })
  
  // Method 4: Look for data attributes
  const dataElements = doc.querySelectorAll('[data-video-src], [data-src], [data-file], [data-url]')
  dataElements.forEach(el => {
    const src = el.getAttribute('data-video-src') || el.getAttribute('data-src') || el.getAttribute('data-file') || el.getAttribute('data-url')
    if (src && (src.includes('.mp4') || src.includes('.m3u8'))) {
      videoUrls.push(src)
    }
  })
  
  // Method 5: Search entire HTML for video URL patterns
  const htmlText = html
  const urlPatterns = [
    /https?:\/\/[^\s"<>']+\.m3u8[^\s"<>']*/gi,
    /https?:\/\/[^\s"<>']+\.mp4[^\s"<>']*/gi,
  ]
  
  urlPatterns.forEach(pattern => {
    const matches = htmlText.match(pattern)
    if (matches) {
      videoUrls.push(...matches)
    }
  })
  
  // Clean and deduplicate URLs
  const cleanedUrls = videoUrls
    .map(url => {
      // Remove query parameters that might break the URL
      try {
        const urlObj = new URL(url)
        // Keep important query params but clean up
        return urlObj.origin + urlObj.pathname + (urlObj.search || '')
      } catch (e) {
        // If URL parsing fails, try to clean it manually
        return url.split('?')[0].split('"')[0].split("'")[0].trim()
      }
    })
    .filter(url => {
      // Filter out invalid URLs
      if (!url || url.length < 10) return false
      if (!url.startsWith('http://') && !url.startsWith('https://')) return false
      // Prefer m3u8 and mp4
      return url.includes('.m3u8') || url.includes('.mp4') || url.includes('.webm')
    })
    .filter((url, index, self) => self.indexOf(url) === index) // Remove duplicates
  
  // Sort: prefer m3u8, then mp4
  cleanedUrls.sort((a, b) => {
    if (a.includes('.m3u8') && !b.includes('.m3u8')) return -1
    if (!a.includes('.m3u8') && b.includes('.m3u8')) return 1
    if (a.includes('.mp4') && !b.includes('.mp4')) return -1
    if (!a.includes('.mp4') && b.includes('.mp4')) return 1
    return 0
  })
  
  return cleanedUrls
}

// Fetch page and extract video URLs
export async function extractVideoUrlFromPage(pageUrl) {
  try {
    if (!pageUrl || !pageUrl.startsWith('http')) {
      throw new Error('Please provide a valid HTTP/HTTPS URL')
    }
    
    // Try Supabase Edge Function first
    let html = null
    try {
      const { data, error } = await supabase.functions.invoke('fetch-script', {
        body: { url: pageUrl },
      })
      
      if (!error && data?.content) {
        html = data.content
      }
    } catch (e) {
      console.warn('Edge Function failed, trying direct fetch:', e)
    }
    
    // Fallback: Try direct fetch (may fail due to CORS)
    if (!html) {
      try {
        const response = await fetch(pageUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
        })
        if (response.ok) {
          html = await response.text()
        }
      } catch (e) {
        console.warn('Direct fetch failed:', e)
      }
    }
    
    // Fallback: Try CORS proxies
    if (!html) {
      const proxies = [
        `https://api.allorigins.win/get?url=${encodeURIComponent(pageUrl)}`,
        `https://corsproxy.io/?${encodeURIComponent(pageUrl)}`,
      ]
      
      for (const proxyUrl of proxies) {
        try {
          const resp = await fetch(proxyUrl)
          if (resp.ok) {
            if (proxyUrl.includes('allorigins.win')) {
              const data = await resp.json()
              html = data.contents
            } else {
              html = await resp.text()
            }
            if (html && html.length > 100) break
          }
        } catch (e) {
          continue
        }
      }
    }
    
    if (!html || html.length < 100) {
      throw new Error('Could not fetch the webpage. The page may be protected or inaccessible.')
    }
    
    // Extract video URLs
    const videoUrls = extractVideoUrls(html)
    
    if (videoUrls.length === 0) {
      throw new Error('No video URLs found on this page. The page may not contain a video player, or the video URL format is not recognized.')
    }
    
    return {
      success: true,
      videoUrls,
      primaryUrl: videoUrls[0], // Best match (usually m3u8)
      allUrls: videoUrls,
    }
  } catch (error) {
    console.error('Error extracting video URL:', error)
    throw error
  }
}

