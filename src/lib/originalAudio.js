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

// Find the best matching span of subtitle entries for a quote
// Returns start index, end index, and score
// Strategy: Find the first entry that contains the start of the quote, then expand forward
// to find the last entry that contains the end of the quote
export function findBestSubtitleMatch(quoteText, entries) {
  const target = normalize(quoteText)
  const targetWords = target.split(' ').filter(w => w.length > 0)
  
  // Get more words from start and end for better matching
  const firstWords = targetWords.slice(0, Math.min(6, targetWords.length))
  const lastWords = targetWords.slice(Math.max(0, targetWords.length - 6))
  const firstPhrase = firstWords.join(' ')
  const lastPhrase = lastWords.join(' ')
  
  console.log('[findBestSubtitleMatch] Looking for quote start:', firstPhrase, 'and end:', lastPhrase)
  
  // Step 1: Find the first entry that contains words from the beginning of the quote
  // Use a more specific match - look for the actual first words in sequence
  let startIdx = -1
  for (let i = 0; i < entries.length; i++) {
    const entryText = normalize(entries[i].text)
    
    // Check if this entry contains the first 3+ words in sequence
    // This is more specific than just checking individual words
    const firstThreeWords = firstWords.slice(0, Math.min(3, firstWords.length))
    const firstFourWords = firstWords.slice(0, Math.min(4, firstWords.length))
    
    // Check if entry contains the first few words in sequence
    const hasFirstSequence = containsWordSequence(entryText, firstThreeWords) || containsWordSequence(entryText, firstFourWords)
    
    // Also check individual word matches (at least 3 words from start)
    const matchingFirstWords = firstWords.filter(word => 
      word.length > 2 && containsWholeWord(entryText, word)
    )
    
    // More strict: need sequence match OR at least 3 word matches
    if (hasFirstSequence || matchingFirstWords.length >= 3) {
      startIdx = i
      console.log(`[findBestSubtitleMatch] Found potential start at entry ${i}: "${entries[i].text}"`)
      break
    }
  }
  
  // Step 2: If we found a start, expand forward to find the end
  if (startIdx >= 0) {
    const spanResult = findBestSpanFromStart(entries, startIdx, target, lastWords)
    if (spanResult) {
      return spanResult
    }
  }
  
  // Fallback: Try to find best single entry match, then expand
  console.log('[findBestSubtitleMatch] Fallback: searching for best single entry match')
  let bestSingleIdx = -1
  let bestSingleScore = -Infinity
  for (let i = 0; i < entries.length; i++) {
    const score = similarity(target, normalize(entries[i].text))
    if (score > bestSingleScore) {
      bestSingleScore = score
      bestSingleIdx = i
    }
  }
  
  if (bestSingleScore > 0.2) {
    // Expand forward and backward from the best match
    let bestStart = bestSingleIdx
    let bestEnd = bestSingleIdx
    
    // Expand forward (up to 15 entries)
    for (let end = bestSingleIdx; end < Math.min(bestSingleIdx + 15, entries.length); end++) {
      const combinedText = entries.slice(bestSingleIdx, end + 1)
        .map(e => normalize(e.text))
        .join(' ')
      const score = similarity(target, combinedText)
      if (score > bestSingleScore) {
        bestSingleScore = score
        bestEnd = end
      }
    }
    
    // Expand backward (up to 10 entries)
    for (let start = Math.max(0, bestSingleIdx - 10); start <= bestSingleIdx; start++) {
      const combinedText = entries.slice(start, bestEnd + 1)
        .map(e => normalize(e.text))
        .join(' ')
      const score = similarity(target, combinedText)
      if (score > bestSingleScore) {
        bestSingleScore = score
        bestStart = start
      }
    }
    
    console.log(`[findBestSubtitleMatch] Fallback: using entry ${bestStart} to ${bestEnd}, score: ${bestSingleScore.toFixed(3)}`)
    return { startIndex: bestStart, endIndex: bestEnd, score: bestSingleScore }
  }
  
  console.log('[findBestSubtitleMatch] No match found')
  return { startIndex: -1, endIndex: -1, score: 0 }
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

function escapeRegex(str = '') {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function containsWholeWord(text, word) {
  if (!word) return false
  const pattern = new RegExp(`\\b${escapeRegex(word)}\\b`, 'i')
  return pattern.test(text)
}

function containsWordSequence(text, words = []) {
  if (!text || !words || words.length === 0) return false
  const escapedWords = words
    .filter(Boolean)
    .map(word => escapeRegex(word))
    .join('\\s+')
  if (!escapedWords) return false
  const pattern = new RegExp(`\\b${escapedWords}\\b`, 'i')
  return pattern.test(text)
}

function findBestSpanFromStart(entries, startIdx, target, lastWords) {
  const maxLookahead = Math.min(entries.length, startIdx + 40)
  let bestEndIdx = startIdx
  let bestScore = 0
  let bestLengthDiff = Infinity
  const normalizedTarget = target
  const accumulated = []
  
  for (let i = startIdx; i < maxLookahead; i++) {
    const entryText = normalize(entries[i].text)
    accumulated.push(entryText)
    const combinedText = accumulated.join(' ')
    const combinedScore = similarity(normalizedTarget, combinedText)
    const lengthDiff = Math.abs(combinedText.length - normalizedTarget.length)
    
    // If combined text already contains the whole quote, stop here
    if (combinedText.includes(normalizedTarget)) {
      console.log(`[findBestSubtitleMatch] Combined text contains target at entry ${i}, score forced to 1.000`)
      return { startIndex: startIdx, endIndex: i, score: 1 }
    }
    
    // Prefer matches that contain the last few words
    const lastThreeWords = lastWords.slice(Math.max(0, lastWords.length - 3))
    const lastFourWords = lastWords.slice(Math.max(0, lastWords.length - 4))
    const hasLastSequence = containsWordSequence(entryText, lastThreeWords) || containsWordSequence(entryText, lastFourWords)
    
    // Track best score, with slight preference toward shorter spans when scores are similar
    const isBetterScore = combinedScore > bestScore + 0.02
    const isSimilarScoreShorterSpan = Math.abs(combinedScore - bestScore) <= 0.02 && lengthDiff < bestLengthDiff
    
    if (isBetterScore || isSimilarScoreShorterSpan || hasLastSequence) {
      bestEndIdx = i
      bestScore = Math.max(bestScore, combinedScore, hasLastSequence ? Math.max(combinedScore, 0.25) : combinedScore)
      bestLengthDiff = lengthDiff
      if (hasLastSequence) {
        console.log(`[findBestSubtitleMatch] Last phrase sequence hit at entry ${i}, tentative end set with score ${bestScore.toFixed(3)}`)
      }
    }
    
    // Once we pass 5 entries beyond the best end, break to avoid overly long spans
    if (i - bestEndIdx > 5 && bestScore > 0.1) {
      break
    }
  }
  
  if (bestEndIdx > startIdx) {
    const combinedText = entries.slice(startIdx, bestEndIdx + 1).map(e => normalize(e.text)).join(' ')
    const combinedScore = similarity(normalizedTarget, combinedText)
    console.log(`[findBestSubtitleMatch] Selected span ${startIdx}-${bestEndIdx} with score ${combinedScore.toFixed(3)}`)
    return { startIndex: startIdx, endIndex: bestEndIdx, score: Math.max(combinedScore, 0.15) }
  }
  
  return null
}

// Fetch SRT text - supports both URLs and local file content
export async function fetchSrt(srtUrl) {
  console.log('fetchSrt called with:', srtUrl ? (srtUrl.substring(0, 50) + '...') : 'null')
  
  // Check if this is local file content (starts with data:local-srt:)
  if (srtUrl && srtUrl.startsWith('data:local-srt:')) {
    const content = srtUrl.substring('data:local-srt:'.length)
    console.log('Local SRT detected, content length:', content.length, 'starts with:', content.substring(0, 30))
    
    // If content is just "stored", it's a marker and we need to load from localStorage
    // But we don't have movieId here, so this shouldn't happen if getMovieMediaConfigLocal works correctly
    // If it does happen, return an error
    if (content === 'stored' || content.trim() === 'stored') {
      console.error('SRT marker found but content missing')
      throw new Error('Subtitle content marker found but actual content is missing. Please re-upload your subtitle file.')
    }
    
    // Return the content directly (everything after the prefix)
    console.log('Returning SRT content, length:', content.length)
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
  let blobUrlToCleanup = null // Track blob URLs we create so we can revoke them later
  if (audioUrl && audioUrl.startsWith('data:local-audio:')) {
    const content = audioUrl.substring('data:local-audio:'.length)
    if (content === 'stored' || content === 'blob-stored') {
      // This shouldn't happen if getMovieMediaConfigLocal worked correctly
      // But if it does, provide a helpful error
      onError?.(new Error('Audio file content is missing. The audio file may have been cleared from storage. Please re-upload your audio file in the media settings.'))
      return () => {}
    }
    
    console.log('[playAudioSegment] Processing local audio content, length:', content.length, 'starts with:', content.substring(0, 50))
    
    // Check if it's a blob URL format (data:audio/mpeg;blob-url:blob:...)
    const blobUrlMatch = content.match(/^data:audio\/[^;]+;blob-url:(.+)$/)
    if (blobUrlMatch && blobUrlMatch[1]) {
      // It's already a blob URL, use it directly
      audioSrc = blobUrlMatch[1]
      console.log('[playAudioSegment] Using existing blob URL')
    } else if (content.startsWith('data:audio/')) {
      // Legacy: base64 data URL - convert to blob URL
      const base64Match = content.match(/^data:audio\/[^;]+;base64,(.+)$/)
      if (base64Match && base64Match[1]) {
        const base64Data = base64Match[1]
        console.log('[playAudioSegment] Converting base64 to blob, base64 length:', base64Data.length)
        
        // Use fetch which handles data URLs efficiently
        fetch(content)
          .then(response => response.blob())
          .then(blob => {
            blobUrlToCleanup = URL.createObjectURL(blob)
            console.log('[playAudioSegment] Created blob URL via fetch, size:', blob.size, 'bytes, mimeType:', blob.type)
            
            // Update the audio source and load
            const audioEl = document.getElementById('original-audio-hidden-audio')
            if (audioEl && !checkEnded()) {
              audioEl.src = blobUrlToCleanup
              audioEl.volume = 1.0
              audioEl.muted = false
              audioEl.load()
              console.log('[playAudioSegment] Updated audio source to blob URL')
            }
          })
          .catch(fetchError => {
            console.error('[playAudioSegment] Error converting data URL to blob:', fetchError)
            // Fallback to using data URL directly
            audioSrc = content
            console.log('[playAudioSegment] Falling back to data URL due to conversion error')
          })
        
        // For now, use the data URL directly - it will be updated to blob URL when ready
        audioSrc = content
      } else {
        audioSrc = content
        console.log('[playAudioSegment] Using data URL directly (could not parse base64)')
      }
    } else {
      // Content is just base64, try to create data URL
      audioSrc = `data:audio/mpeg;base64,${content}`
      console.log('[playAudioSegment] Created data URL from base64 content, length:', audioSrc.length)
    }
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
  
  // Create a closure to access ended variable in async callbacks
  const checkEnded = () => ended
  const setEnded = (value) => { ended = value }
  
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
  
  console.log('[playAudioSegment] Setting audio source, type:', typeof audioSrc, 'starts with:', audioSrc ? audioSrc.substring(0, 50) : 'null')
  audio.src = audioSrc
  audio.volume = 1.0
  audio.muted = false // Explicitly unmute
  console.log('[playAudioSegment] Audio element configured, volume:', audio.volume, 'muted:', audio.muted, 'src length:', audioSrc ? audioSrc.length : 0)
  
  audio.onloadstart = () => {
    console.log('[playAudioSegment] Audio started loading')
  }
  
  // Track if we've already started playback to prevent multiple attempts
  let playbackStarted = false
  
  audio.oncanplay = () => {
    console.log('[playAudioSegment] Audio can play, readyState:', audio.readyState, 'duration:', audio.duration, 'currentTime:', audio.currentTime)
    
    // Prevent multiple play attempts
    if (playbackStarted || checkEnded()) {
      console.log('[playAudioSegment] Playback already started or ended, skipping')
      return
    }
    
    playbackStarted = true
    
    try {
      const targetTime = Math.max(0, startMs / 1000)
      audio.currentTime = targetTime
      audio.muted = false
      audio.volume = 1.0
      console.log('[playAudioSegment] Set currentTime to:', targetTime, 'actual:', audio.currentTime, 'muted:', audio.muted, 'volume:', audio.volume)
      
      // Call onStart before playing
      onStart && onStart()
      
      // Use a flag to track if play() is in progress
      let playPromise = null
      try {
        playPromise = audio.play()
      } catch (e) {
        // If play() throws synchronously, handle it
        playbackStarted = false
        reportError(e)
        return
      }
      
      if (playPromise) {
        playPromise.then(() => {
          console.log('[playAudioSegment] Audio play() promise resolved, playing:', !audio.paused, 'currentTime:', audio.currentTime)
          // Only set up timeout if playback wasn't ended
          if (checkEnded()) {
            console.log('[playAudioSegment] Playback ended before timeout setup')
            return
          }
          
          console.log('[playAudioSegment] Setting timeout to stop playback after', durationSec, 'seconds')
          // Stop after duration
          setTimeout(() => {
            if (checkEnded()) {
              console.log('[playAudioSegment] Playback already ended in timeout')
              return
            }
            setEnded(true)
            console.log('[playAudioSegment] Stopping playback after duration')
            try {
              audio.pause()
              onEnd && onEnd()
            } catch (e) {
              // Ignore errors from pause if already ended
              if (!checkEnded()) {
                reportError(e)
              }
            }
          }, durationSec * 1000)
        }).catch((e) => {
          console.error('[playAudioSegment] Audio play() promise rejected:', e)
          playbackStarted = false
          // Ignore "interrupted by pause" errors - they're expected if user stops playback
          if (e.message && e.message.includes('interrupted by a call to pause')) {
            // This is expected when stopping playback, don't report as error
            console.log('[playAudioSegment] Play interrupted by pause (expected)')
            return
          }
          if (!checkEnded()) {
            reportError(e)
          }
        })
      } else {
        console.log('[playAudioSegment] play() did not return a promise')
        playbackStarted = false
      }
    } catch (e) {
      playbackStarted = false
      if (!checkEnded()) {
        reportError(e)
      }
    }
  }
  
  audio.onerror = (e) => {
    console.error('[playAudioSegment] Audio error event:', e)
    const mediaError = audio.error
    if (mediaError) {
      console.error('[playAudioSegment] Media error code:', mediaError.code, 'message:', mediaError.message)
      reportError(mediaError)
    } else {
      console.error('[playAudioSegment] Unknown audio playback error')
      reportError('Unknown audio playback error.')
    }
  }
  
  audio.onstalled = () => {
    console.warn('[playAudioSegment] Audio loading stalled')
    reportError('Audio loading stalled.')
  }
  
  audio.onabort = () => {
    console.warn('[playAudioSegment] Audio loading was aborted')
    reportError('Audio loading was aborted.')
  }
  
  audio.onloadeddata = () => {
    console.log('[playAudioSegment] Audio data loaded, duration:', audio.duration)
  }
  
  audio.onloadedmetadata = () => {
    console.log('[playAudioSegment] Audio metadata loaded, duration:', audio.duration, 'readyState:', audio.readyState)
  }
  
  audio.onplay = () => {
    console.log('[playAudioSegment] Audio play event fired, playing:', !audio.paused)
  }
  
  audio.onpause = () => {
    console.log('[playAudioSegment] Audio pause event fired')
  }
  
  audio.onended = () => {
    console.log('[playAudioSegment] Audio ended event fired')
  }
  
  console.log('[playAudioSegment] Calling audio.load()')
  audio.load()
  
  // Stop function
  return () => {
    try {
      setEnded(true)
      clearTimers()
      
      // Only pause if audio is actually playing/loading
      if (audio && (audio.readyState > 0 || !audio.paused)) {
        try {
          audio.pause()
        } catch (e) {
          // Ignore pause errors when stopping
        }
      }
      
      // Clear source after a brief delay to avoid interrupting play()
      setTimeout(() => {
        try {
          if (audio) {
            audio.src = ''
          }
          // Clean up blob URL if we created one
          if (blobUrlToCleanup) {
            URL.revokeObjectURL(blobUrlToCleanup)
            console.log('[playAudioSegment] Revoked blob URL')
          } else if (audioSrc && audioSrc.startsWith('blob:')) {
            URL.revokeObjectURL(audioSrc)
          }
        } catch {}
      }, 100)
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

// High-level: given quote text, audio URL/file, and SRT URL/file, find timestamps and play audio segment
// If startTime and endTime are provided (in milliseconds), use them directly instead of searching subtitles
export async function playOriginalQuoteSegment(quoteText, audioUrl, srtUrl, { onStart, onEnd, onError, subtitleOffset = 0, startTime = null, endTime = null } = {}) {
  try {
    if (!audioUrl) {
      throw new Error('Audio file is not configured. Please upload an audio file in the media settings.')
    }
    
    // Check if audioUrl is still a marker (shouldn't happen, but handle it)
    if (audioUrl && audioUrl.startsWith('data:local-audio:')) {
      const content = audioUrl.substring('data:local-audio:'.length)
      if (content === 'stored' || content.trim() === 'stored') {
        throw new Error('Audio file content is missing. The audio file may have been cleared from storage. Please re-upload your audio file in the media settings.')
      }
    }
    
    let startMs, endMs
    
    // If timestamps are provided, use them directly
    if (startTime !== null && endTime !== null && startTime !== undefined && endTime !== undefined) {
      console.log('Using stored timestamps:', { startTime, endTime })
      // Pad a bit around for naturalness (500ms before start, 500ms after end)
      // Apply subtitle offset (in milliseconds)
      const baseStartMs = startTime - 500
      const baseEndMs = endTime + 500
      startMs = Math.max(0, baseStartMs + subtitleOffset)
      endMs = baseEndMs + subtitleOffset
      console.log(`Playing using stored timestamps: ${startMs}ms to ${endMs}ms (${((endMs - startMs) / 1000).toFixed(2)}s), offset: ${subtitleOffset}ms`)
    } else {
      // Fallback to searching subtitles if timestamps not available
      if (!srtUrl) {
        throw new Error('Subtitle file is not configured. Please upload a subtitle file in the media settings.')
      }
      
      const srt = await fetchSrt(srtUrl)
      if (!srt || !srt.trim()) {
        throw new Error('Subtitle file is empty. Please upload a valid SRT file.')
      }
      
      console.log('SRT fetched, length:', srt.length, 'first 200 chars:', srt.substring(0, 200))
      
      const entries = parseSrtToEntries(srt) // This will throw a helpful error if parsing fails
      console.log('SRT parsed, found', entries.length, 'entries')
      
      if (entries.length === 0) {
        throw new Error('No subtitle entries could be parsed from the SRT file. Please check that your SRT file is in the correct format.')
      }
      
      console.log('Searching for quote in subtitles:', quoteText.substring(0, 50))
      const { startIndex, endIndex, score } = findBestSubtitleMatch(quoteText, entries)
      console.log('Best match found:', { startIndex, endIndex, score, startEntry: startIndex >= 0 ? entries[startIndex] : null, endEntry: endIndex >= 0 ? entries[endIndex] : null })
      // Lower threshold to 0.1 since we're using more lenient matching
      if (startIndex < 0 || endIndex < 0 || score < 0.1) {
        throw new Error(`Could not locate quote "${quoteText.substring(0, 50)}..." in subtitles. The quote text may not match the subtitle content, or the subtitles may be for a different version of the movie.`)
      }
      
      // Use the span from startIndex to endIndex
      // Pad a bit around for naturalness (500ms before start, 500ms after end)
      // Apply subtitle offset (in milliseconds) - positive values shift forward, negative shift backward
      const baseStartMs = entries[startIndex].startMs - 500
      const baseEndMs = entries[endIndex].endMs + 500
      startMs = Math.max(0, baseStartMs + subtitleOffset)
      endMs = baseEndMs + subtitleOffset
      
      console.log(`Playing from entry ${startIndex} to ${endIndex}, time range: ${startMs}ms to ${endMs}ms (${((endMs - startMs) / 1000).toFixed(2)}s), offset: ${subtitleOffset}ms`)
    }
    
    // Play audio segment from the uploaded audio file
    return playAudioSegment(audioUrl, startMs, endMs, { onStart, onEnd, onError })
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


