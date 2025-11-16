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
  
  // Check if this is actually a binary file (like MP3) that was incorrectly read as text
  if (srtText.startsWith('ID3') || srtText.startsWith('\x00') || srtText.includes('\x00')) {
    throw new Error('Error: This appears to be a binary file (possibly an audio file like MP3), not a subtitle file. Please upload a valid SRT subtitle file (.srt format).')
  }
  
  const trimmed = srtText.trim()
  if (!trimmed) {
    throw new Error('SRT file appears to be empty. Please check your subtitle file.')
  }
  
  const entries = []
  // Normalize line endings and split by double newlines (or single newline followed by number)
  let normalized = trimmed.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  
  // Split by double newlines, but also handle cases where blocks might be separated differently
  let blocks = normalized.split(/\n\s*\n/)
  
  // If we only got one block, try splitting by pattern: number followed by newline and timestamp
  if (blocks.length === 1 || (blocks.length === 2 && blocks[1].trim() === '')) {
    // Try splitting by pattern: \n followed by a number and newline
    blocks = normalized.split(/\n(?=\d+\s*\n\d{2}:\d{2}:\d{2})/)
    // If still one block, try without the number requirement
    if (blocks.length <= 1) {
      blocks = normalized.split(/\n(?=\d{2}:\d{2}:\d{2}[,\.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,\.]\d{3})/)
    }
  }
  
  let validBlocks = 0
  let totalBlocks = blocks.length
  
  for (const block of blocks) {
    const lines = block.trim().split('\n').map(l => l.trim()).filter(l => l.length > 0)
    if (lines.length < 2) continue
    
    // Find the timestamp line (contains -->)
    let timeLine = null
    let timeLineIndex = -1
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('-->')) {
        timeLine = lines[i]
        timeLineIndex = i
        break
      }
    }
    
    if (!timeLine) continue
    
    // Get text lines (everything after the timestamp line)
    const textLines = lines.slice(timeLineIndex + 1)
    
    // Support both comma and period separators for milliseconds (00:00:01,000 or 00:00:01.000)
    const match = timeLine.match(/(\d{2}:\d{2}:\d{2}[,\.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,\.]\d{3})/)
    if (!match) continue
    
    try {
      const startMs = timestampToMs(match[1])
      const endMs = timestampToMs(match[2])
      
      // Join text lines and clean up HTML tags and extra whitespace
      let text = textLines.join(' ')
        .replace(/<[^>]+>/g, '') // Remove HTML tags like <i>, </i>, etc.
        .replace(/\s+/g, ' ') // Normalize whitespace
        .trim()
      
      if (text) {
        entries.push({ startMs, endMs, text })
        validBlocks++
      }
    } catch (e) {
      console.warn('Error parsing SRT block:', e, 'Block:', block.substring(0, 100))
      continue
    }
  }
  
  if (entries.length === 0) {
    // Provide helpful error message
    if (totalBlocks === 0 || (totalBlocks === 1 && blocks[0].trim() === '')) {
      throw new Error('SRT file is empty. Please upload a valid SRT subtitle file with timestamp entries.')
    } else if (validBlocks === 0) {
      // Show a sample of the first block for debugging
      const firstBlockSample = blocks[0].substring(0, 200).replace(/\n/g, '\\n')
      throw new Error(`SRT file format appears invalid. Found ${totalBlocks} block(s) but none could be parsed.\n\nFirst block sample: ${firstBlockSample}\n\nPlease ensure your SRT file follows the standard format:\n\n1\n00:00:01,000 --> 00:00:03,000\nSubtitle text here\n\n2\n00:00:04,000 --> 00:00:06,000\nMore subtitle text`)
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
    const content = srtUrl.substring('data:local-srt:'.length)
    
    // If content is just "stored", it's a marker and we need to load from localStorage
    // But we don't have movieId here, so this shouldn't happen if getMovieMediaConfigLocal works correctly
    // If it does happen, return an error
    if (content === 'stored') {
      throw new Error('Subtitle content marker found but actual content is missing. Please re-upload your subtitle file.')
    }
    
    // Return the content directly (everything after the prefix)
    return content
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

// Play a segment from audioUrl between [startMs, endMs] using a hidden <audio>
// Returns a function to stop playback.
export function playAudioSegment(audioUrl, startMs, endMs, { onStart, onEnd, onError } = {}) {
  // Check if this is local audio content
  let audioSrc = audioUrl
  if (audioUrl && audioUrl.startsWith('data:local-audio:')) {
    const content = audioUrl.substring('data:local-audio:'.length)
    if (content === 'stored') {
      onError?.(new Error('Audio content marker found but actual content is missing. Please re-upload your audio file.'))
      return () => {}
    }
    // The content should be a data URL (data:audio/mpeg;base64,...)
    // Use it directly as the audio source
    audioSrc = content
  }
  
  // Reuse a global hidden audio element if possible
  let audio = document.getElementById('original-audio-hidden-audio')
  if (!audio) {
    audio = document.createElement('audio')
    audio.id = 'original-audio-hidden-audio'
    audio.style.position = 'fixed'
    audio.style.left = '-9999px'
    document.body.appendChild(audio)
  }
  
  audio.currentTime = Math.max(0, startMs / 1000)
  const durationSec = Math.max(0.1, (endMs - startMs) / 1000)
  let ended = false
  let errorReported = false
  
  const clearTimers = () => {
    audio.oncanplay = null
    audio.onerror = null
    audio.onloadstart = null
    audio.onstalled = null
    audio.onabort = null
  }
  
  const reportError = (error) => {
    if (errorReported) return
    errorReported = true
    clearTimers()
    
    let errorMessage = 'Audio playback error'
    if (error?.message) {
      errorMessage = error.message
    } else if (typeof error === 'string') {
      errorMessage = error
    } else if (error?.code) {
      switch (error.code) {
        case 1:
          errorMessage = 'Audio playback was aborted. The audio URL may be invalid or inaccessible.'
          break
        case 2:
          errorMessage = 'Network error while loading audio. Please check your internet connection.'
          break
        case 3:
          errorMessage = 'Audio decoding error. The audio format may not be supported.'
          break
        case 4:
          errorMessage = 'Audio format not supported. Please use .mp3, .wav, .ogg, or .m4a formats.'
          break
        default:
          errorMessage = `Audio playback error (code: ${error.code}).`
      }
    }
    
    onError?.(new Error(errorMessage))
  }
  
  audio.src = audioSrc
  audio.volume = 1.0
  
  audio.onloadstart = () => {
    // Audio started loading
  }
  
  audio.oncanplay = () => {
    try {
      onStart && onStart()
      audio.currentTime = Math.max(0, startMs / 1000)
      audio.play().then(() => {
        // Stop after duration
        setTimeout(() => {
          if (ended) return
          ended = true
          try {
            audio.pause()
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
  
  audio.onerror = (e) => {
    const mediaError = audio.error
    if (mediaError) {
      reportError(mediaError)
    } else {
      reportError('Unknown audio playback error.')
    }
  }
  
  audio.onstalled = () => {
    reportError('Audio loading stalled.')
  }
  
  audio.onabort = () => {
    reportError('Audio loading was aborted.')
  }
  
  audio.load()
  
  // Stop function
  return () => {
    try {
      ended = true
      clearTimers()
      audio.pause()
      audio.src = ''
      // Clean up blob URL if we created one
      if (audioSrc.startsWith('blob:')) {
        URL.revokeObjectURL(audioSrc)
      }
    } catch {}
  }
}

// Play a segment from videoUrl between [startMs, endMs] using a hidden <video>
// Returns a function to stop playback.
export function playVideoSegment(videoUrl, startMs, endMs, { onStart, onEnd, onError } = {}) {
  // Check if URL looks like a page URL (not direct video)
  const isPageUrl = (url) => {
    if (!url) return false
    // Check for common page URL patterns
    const pagePatterns = [
      /\/movie\/watch\//,
      /\/movie\/\d+/,
      /\/watch\//,
      /\/play\//,
      /\/stream\//,
    ]
    const pageDomains = [
      '111movies.com',
      '456movie.net',
      'fmovies.to',
      '123movies',
    ]
    
    // Check if it's a known page domain
    if (pageDomains.some(domain => url.includes(domain))) {
      // But allow if it ends with video extensions
      if (url.endsWith('.mp4') || url.endsWith('.m3u8') || url.endsWith('.webm') || url.endsWith('.mkv')) {
        return false
      }
      return true
    }
    
    // Check for page URL patterns
    if (pagePatterns.some(pattern => pattern.test(url))) {
      // But allow if it ends with video extensions
      if (url.endsWith('.mp4') || url.endsWith('.m3u8') || url.endsWith('.webm') || url.endsWith('.mkv')) {
        return false
      }
      return true
    }
    
    return false
  }
  
  if (isPageUrl(videoUrl)) {
    onError?.(new Error(
      'This appears to be a page URL, not a direct video URL.\n\n' +
      'Please use the "Extract from Page" button in the media settings to extract the actual video URL from the page.\n\n' +
      'Direct video URLs should end with .mp4, .m3u8, or similar video file extensions.\n\n' +
      'Page URLs cannot be used directly due to CORS restrictions and security policies.'
    ))
    return () => {}
  }
  
  // Use proxy in development to avoid CORS issues
  const proxiedVideoUrl = getProxiedUrl(videoUrl)
  
  // First, check if the video URL is accessible
  const checkVideoAccess = async () => {
    try {
      const testUrl = proxiedVideoUrl
      // Use a timeout to avoid hanging
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 5000) // 5 second timeout
      
      try {
        const response = await fetch(testUrl, { 
          method: 'HEAD',
          signal: controller.signal,
          mode: 'no-cors' // Don't fail on CORS - let the video element try
        })
        clearTimeout(timeoutId)
        
        // With no-cors mode, we can't read the response, so assume it's OK
        // The video element will handle actual errors
        return true
      } catch (fetchError) {
        clearTimeout(timeoutId)
        // If it's an abort (timeout) or CORS error, continue anyway
        // The video element might still be able to play it
        if (fetchError.name === 'AbortError') {
          console.warn('Video URL check timed out, continuing anyway')
        } else {
          console.warn('Could not verify video URL accessibility (may be CORS), continuing anyway:', fetchError)
        }
        return true // Continue anyway - let the video element try
      }
    } catch (error) {
      // If HEAD request fails, try to continue anyway (might be CORS issue, but video element might still work)
      console.warn('Could not verify video URL accessibility:', error)
      return true // Continue anyway - the video element might still work
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
        let errorMsg = ''
        // Provide more specific error messages
        if (mediaError.code === 4) { // MEDIA_ERR_SRC_NOT_SUPPORTED
          errorMsg = 'Video format not supported or URL is invalid.\n\n' +
            'Please ensure:\n' +
            '1. You are using a direct video URL (ending in .mp4, .m3u8, etc.), not a page URL\n' +
            '2. If you have a page URL, use the "Extract from Page" button to get the actual video URL\n' +
            '3. The video URL is accessible and not protected by CORS\n' +
            '4. The video format is supported by your browser'
          onError?.(new Error(errorMsg))
        } else {
          reportError(mediaError)
        }
      } else {
        // Check if the URL looks like a page URL
        if (videoUrl.includes('/movie/') || videoUrl.includes('/watch/') || videoUrl.includes('/play/')) {
          onError?.(new Error(
            'This appears to be a page URL, not a direct video URL.\n\n' +
            'Please use the "Extract from Page" button in the media settings to extract the actual video URL from the page.\n\n' +
            'Direct video URLs should end with .mp4, .m3u8, or similar video file extensions.'
          ))
        } else {
          reportError(new Error('Unknown video playback error. The video URL may be invalid, inaccessible, or in an unsupported format.'))
        }
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


