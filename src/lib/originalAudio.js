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
  const entries = []
  const blocks = srtText.replace(/\r/g, '').split('\n\n')
  for (const block of blocks) {
    const lines = block.trim().split('\n')
    if (lines.length < 2) continue
    // index (optional) on line 0 if numeric
    const timeLine = lines[0].includes('-->') ? lines[0] : lines[1]
    const textLines = lines[0].includes('-->') ? lines.slice(1) : lines.slice(2)
    const match = timeLine.match(/(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/)
    if (!match) continue
    const startMs = timestampToMs(match[1])
    const endMs = timestampToMs(match[2])
    const text = textLines.join(' ').replace(/\s+/g, ' ').trim()
    if (text) {
      entries.push({ startMs, endMs, text })
    }
  }
  return entries
}

function timestampToMs(ts) {
  const [h, m, rest] = ts.split(':')
  const [s, ms] = rest.split(',')
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
  video.src = proxiedVideoUrl
  video.currentTime = Math.max(0, startMs / 1000)
  const durationSec = Math.max(0.1, (endMs - startMs) / 1000)
  let ended = false
  const clearTimers = () => {
    video.oncanplay = null
    video.onerror = null
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
            onError && onError(e)
          }
        }, durationSec * 1000)
      }).catch((e) => {
        onError && onError(e)
      })
    } catch (e) {
      onError && onError(e)
    }
  }
  video.onerror = (e) => {
    onError && onError(e?.error || new Error('Video playback error'))
  }
  // Load source
  video.load()
  // Stop function
  return () => {
    try {
      video.pause()
    } catch {}
  }
}

// High-level: given quote text, video URL, and SRT URL, find timestamps and play segment
export async function playOriginalQuoteSegment(quoteText, videoUrl, srtUrl, { onStart, onEnd, onError } = {}) {
  try {
    const srt = await fetchSrt(srtUrl)
    const entries = parseSrtToEntries(srt)
    if (!entries.length) throw new Error('No subtitles parsed')
    const { index, score } = findBestSubtitleMatch(quoteText, entries)
    if (index < 0 || score < 0.2) {
      throw new Error('Could not locate quote in subtitles')
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


