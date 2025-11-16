// Utilities to play original movie audio segments for a quote
// Requires a video URL (from your licensed source) and an SRT subtitles URL.
// Stores nothing server-side; this is a pure client-side player.

// Helper function to convert URLs to use proxy in development
function getProxiedUrl(url) {
  if (!url) return url
  // Only use proxy in development (when running on localhost)
  const isDevelopment = import.meta.env.DEV && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  
  if (isDevelopment && url.includes('bold.webghostpiano.workers.dev')) {
    // Convert https://bold.webghostpiano.workers.dev/video.m3u8?q=... 
    // to /api/video/video.m3u8?q=...
    const urlObj = new URL(url)
    return `/api/video${urlObj.pathname}${urlObj.search}`
  }
  
  return url
}

// Parse SRT text into entries: { startMs, endMs, text }
export function parseSrtToEntries(srtText) {
  if (!srtText || typeof srtText !== 'string') {
    throw new Error('SRT content is empty or invalid. Please ensure you uploaded a valid SRT file.')
  }
  
  const trimmed = srtText.trim()
  if (!trimmed) {
    throw new Error('SRT file appears to be empty. Please check your subtitle file.')
  }
  
  const entries = []
  const blocks = trimmed.replace(/\r/g, '').split('\n\n')
  let validBlocks = 0
  let totalBlocks = blocks.length
  
  for (const block of blocks) {
    const lines = block.trim().split('\n')
    if (lines.length < 2) continue
    
    // index (optional) on line 0 if numeric
    const timeLine = lines[0].includes('-->') ? lines[0] : lines[1]
    const textLines = lines[0].includes('-->') ? lines.slice(1) : lines.slice(2)
    // Support both comma and period separators for milliseconds (00:00:01,000 or 00:00:01.000)
    const match = timeLine.match(/(\d{2}:\d{2}:\d{2}[,\.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,\.]\d{3})/)
    if (!match) continue
    
    try {
      const startMs = timestampToMs(match[1])
      const endMs = timestampToMs(match[2])
      const text = textLines.join(' ').replace(/\s+/g, ' ').trim()
      if (text) {
        entries.push({ startMs, endMs, text })
        validBlocks++
      }
    } catch (e) {
      console.warn('Error parsing SRT block:', e)
      continue
    }
  }
  
  if (entries.length === 0) {
    // Provide helpful error message
    if (totalBlocks === 0 || (totalBlocks === 1 && blocks[0].trim() === '')) {
      throw new Error('SRT file is empty. Please upload a valid SRT subtitle file with timestamp entries.')
    } else if (validBlocks === 0) {
      throw new Error(`SRT file format appears invalid. Found ${totalBlocks} blocks but none could be parsed. Please ensure your SRT file follows the standard format:\n\n1\n00:00:01,000 --> 00:00:03,000\nSubtitle text here\n\n2\n00:00:04,000 --> 00:00:06,000\nMore subtitle text`)
    } else {
      throw new Error('No valid subtitle entries found in SRT file. Please check the file format.')
    }
  }
  
  return entries
}

function timestampToMs(ts) {
  const [h, m, rest] = ts.split(':')
  // Support both comma and period separators
  const separator = rest.includes(',') ? ',' : '.'
  const [s, ms] = rest.split(separator)
  return (
    parseInt(h, 10) * 3600000 +
    parseInt(m, 10) * 60000 +
    parseInt(s, 10) * 1000 +
    parseInt(ms, 10)
  )
}

// Basic fuzzy match: returns best entry index and a score
export function findBestSubtitleMatch(quoteText, entries) {
  const target = normalize(quoteText)
  let bestIdx = -1
  let bestScore = -Infinity
  for (let i = 0; i < entries.length; i++) {
    const score = similarity(target, normalize(entries[i].text))
    if (score > bestScore) {
      bestScore = score
      bestIdx = i
    }
  }
  return { index: bestIdx, score: bestScore }
}

function normalize(s) {
  return (s || '')
    .toLowerCase()
    .replace(/["“”‘’]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Simple similarity: overlap ratio on words
function similarity(a, b) {
  if (!a || !b) return 0
  const aWords = new Set(a.split(' '))
  const bWords = new Set(b.split(' '))
  let overlap = 0
  for (const w of aWords) {
    if (bWords.has(w)) overlap++
  }
  return overlap / Math.max(1, Math.max(aWords.size, bWords.size))
}

// Fetch SRT text - supports both URLs and local file content
export async function fetchSrt(srtUrl) {
  // Check if this is local file content (starts with data:local-srt:)
  if (srtUrl && srtUrl.startsWith('data:local-srt:')) {
    // Return the content directly (everything after the prefix)
    return srtUrl.substring('data:local-srt:'.length)
  }
  
  // Otherwise, fetch from URL
  try {
    // Use proxy in development to avoid CORS issues
    const proxiedUrl = getProxiedUrl(srtUrl)
    const res = await fetch(proxiedUrl)
    if (!res.ok) {
      throw new Error(`Failed to fetch subtitles: ${res.status} ${res.statusText}`)
    }
    return await res.text()
  } catch (error) {
    // Check for CORS errors
    if (error.message.includes('Failed to fetch') || error.name === 'TypeError') {
      throw new Error(`CORS error: Cannot fetch subtitles from ${srtUrl}. Please use a direct URL that allows cross-origin requests, or host the SRT file on a CORS-enabled server.`)
    }
    throw error
  }
}

// Play a segment from videoUrl between [startMs, endMs] using a hidden <video>
// Returns a function to stop playback.
export function playVideoSegment(videoUrl, startMs, endMs, { onStart, onEnd, onError } = {}) {
  // Check if URL looks like a page URL (not direct video)
  if (videoUrl.includes('111movies.com/movie/') && !videoUrl.endsWith('.mp4') && !videoUrl.endsWith('.m3u8')) {
    onError?.(new Error('Please provide a direct video URL (ending in .mp4 or .m3u8), not a page URL. The 111movies.com page URL cannot be used directly due to CORS restrictions.'))
    return () => {}
  }
  
  // Use proxy in development to avoid CORS issues
  const proxiedVideoUrl = getProxiedUrl(videoUrl)
  
  // First, check if the video URL is accessible
  const checkVideoAccess = async () => {
    try {
      const testUrl = proxiedVideoUrl
      const response = await fetch(testUrl, { method: 'HEAD' })
      if (!response.ok) {
        let errorMsg = `Video URL returned ${response.status} ${response.statusText}`
        if (response.status === 403) {
          errorMsg += '. The video URL may be protected, expired, or require authentication. Please check if the URL is still valid and accessible.'
        } else if (response.status === 404) {
          errorMsg += '. The video URL was not found. Please verify the URL is correct.'
        } else if (response.status === 401) {
          errorMsg += '. The video URL requires authentication.'
        }
        onError?.(new Error(errorMsg))
        return false
      }
      return true
    } catch (error) {
      // If HEAD request fails, try to continue anyway (might be CORS issue, but video element might still work)
      console.warn('Could not verify video URL accessibility:', error)
      return true
    }
  }
  
  // Reuse a global hidden video element if possible
  let video = document.getElementById('original-audio-hidden-video')
  if (!video) {
    video = document.createElement('video')
    video.id = 'original-audio-hidden-video'
    video.style.position = 'fixed'
    video.style.left = '-9999px'
    video.style.width = '1px'
    video.style.height = '1px'
    video.setAttribute('playsinline', 'true')
    video.setAttribute('webkit-playsinline', 'true')
    document.body.appendChild(video)
  }
  
  video.currentTime = Math.max(0, startMs / 1000)
  const durationSec = Math.max(0.1, (endMs - startMs) / 1000)
  let ended = false
  let errorReported = false
  
  const clearTimers = () => {
    video.oncanplay = null
    video.onerror = null
    video.onloadstart = null
    video.onstalled = null
    video.onabort = null
  }
  
  const reportError = (error) => {
    if (errorReported) return
    errorReported = true
    clearTimers()
    
    let errorMessage = 'Video playback error'
    if (error?.message) {
      errorMessage = error.message
    } else if (typeof error === 'string') {
      errorMessage = error
    } else if (error?.code) {
      // MediaError codes
      switch (error.code) {
        case 1: // MEDIA_ERR_ABORTED
          errorMessage = 'Video playback was aborted. The video URL may be invalid or inaccessible.'
          break
        case 2: // MEDIA_ERR_NETWORK
          errorMessage = 'Network error while loading video. Please check your internet connection and verify the video URL is accessible.'
          break
        case 3: // MEDIA_ERR_DECODE
          errorMessage = 'Video decoding error. The video format may not be supported or the file may be corrupted.'
          break
        case 4: // MEDIA_ERR_SRC_NOT_SUPPORTED
          errorMessage = 'Video format not supported. Please use .mp4 or .m3u8 formats.'
          break
        default:
          errorMessage = `Video playback error (code: ${error.code}). The video URL may be invalid, expired, or inaccessible.`
      }
    }
    
    // Check for common issues
    if (videoUrl.includes('workers.dev') || videoUrl.includes('cloudflare')) {
      errorMessage += ' Note: This appears to be a Cloudflare Workers URL. It may have expired or require authentication.'
    }
    
    onError?.(new Error(errorMessage))
  }
  
  // Check video accessibility first
  checkVideoAccess().then((isAccessible) => {
    if (!isAccessible) return
    
    video.src = proxiedVideoUrl
    
    video.onloadstart = () => {
      // Video started loading
    }
    
    video.oncanplay = () => {
      try {
        onStart && onStart()
        video.currentTime = Math.max(0, startMs / 1000)
        video.muted = false
        video.play().then(() => {
          // Stop after duration
          setTimeout(() => {
            if (ended) return
            ended = true
            try {
              video.pause()
              onEnd && onEnd()
            } catch (e) {
              reportError(e)
            }
          }, durationSec * 1000)
        }).catch((e) => {
          reportError(e)
        })
      } catch (e) {
        reportError(e)
      }
    }
    
    video.onerror = (e) => {
      const mediaError = video.error
      if (mediaError) {
        reportError(mediaError)
      } else {
        reportError('Unknown video playback error. The video URL may be invalid or inaccessible.')
      }
    }
    
    video.onstalled = () => {
      reportError('Video loading stalled. The video URL may be slow or inaccessible.')
    }
    
    video.onabort = () => {
      reportError('Video loading was aborted. The video URL may be invalid or inaccessible.')
    }
    
    // Load source
    video.load()
  })
  
  // Stop function
  return () => {
    try {
      ended = true
      clearTimers()
      video.pause()
      video.src = ''
    } catch {}
  }
}

// High-level: given quote text, video URL, and SRT URL, find timestamps and play segment
export async function playOriginalQuoteSegment(quoteText, videoUrl, srtUrl, { onStart, onEnd, onError } = {}) {
  try {
    if (!srtUrl) {
      throw new Error('Subtitle URL or file is not configured. Please set up subtitles in the media settings.')
    }
    
    const srt = await fetchSrt(srtUrl)
    if (!srt || !srt.trim()) {
      throw new Error('Subtitle file is empty. Please upload a valid SRT file or provide a valid subtitle URL.')
    }
    
    const entries = parseSrtToEntries(srt) // This will throw a helpful error if parsing fails
    
    if (entries.length === 0) {
      throw new Error('No subtitle entries could be parsed from the SRT file. Please check that your SRT file is in the correct format.')
    }
    
    const { index, score } = findBestSubtitleMatch(quoteText, entries)
    if (index < 0 || score < 0.2) {
      throw new Error(`Could not locate quote "${quoteText.substring(0, 50)}..." in subtitles. The quote text may not match the subtitle content, or the subtitles may be for a different version of the movie.`)
    }
    
    // Pad a bit around the line for naturalness
    const startMs = Math.max(0, entries[index].startMs - 300)
    const endMs = entries[index].endMs + 300
    return playVideoSegment(videoUrl, startMs, endMs, { onStart, onEnd, onError })
  } catch (e) {
    onError && onError(e)
    throw e
  }
}

// Per-movie storage of media URLs in localStorage
export function getMovieMediaConfig(movieId) {
  try {
    const raw = localStorage.getItem(`movie-media-${movieId}`)
    return raw ? JSON.parse(raw) : { videoUrl: '', srtUrl: '' }
  } catch {
    return { videoUrl: '', srtUrl: '' }
  }
}

export function setMovieMediaConfig(movieId, { videoUrl, srtUrl }) {
  localStorage.setItem(`movie-media-${movieId}`, JSON.stringify({ videoUrl: videoUrl || '', srtUrl: srtUrl || '' }))
}


