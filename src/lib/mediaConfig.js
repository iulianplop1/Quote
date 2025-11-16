// Persist per-movie media URLs (video and SRT) in Supabase if possible, with localStorage fallback.
// Supports both URLs and local file content for subtitles.
import { supabase } from './supabase'

const LS_PREFIX = 'movie-media-'
const LS_SRT_PREFIX = 'movie-srt-content-'

// Check if srtUrl is actually local file content (starts with special prefix)
const LOCAL_SRT_PREFIX = 'data:local-srt:'
export function isLocalSrtContent(srtUrl) {
  return srtUrl && srtUrl.startsWith(LOCAL_SRT_PREFIX)
}

// Extract content from local SRT data URL
export function getLocalSrtContent(srtUrl) {
  if (isLocalSrtContent(srtUrl)) {
    return srtUrl.substring(LOCAL_SRT_PREFIX.length)
  }
  return null
}

// Create a local SRT data URL from content
export function createLocalSrtUrl(content) {
  return LOCAL_SRT_PREFIX + content
}

export async function getMovieMediaConfigPersisted(movieId) {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return getMovieMediaConfigLocal(movieId)
    // Try reading from movie_media table if it exists
    const { data, error } = await supabase
      .from('movie_media')
      .select('video_url, srt_url')
      .eq('user_id', user.id)
      .eq('movie_id', movieId)
      .maybeSingle()
    if (error) {
      // Table might not exist (404) or other error; silently fall back to local
      if (error.code !== 'PGRST116') {
        // Only log non-404 errors (PGRST116 = not found)
        console.debug('movie_media table not accessible, using localStorage:', error.message)
      }
      return getMovieMediaConfigLocal(movieId)
    }
    if (data) {
      const cfg = { videoUrl: data.video_url || '', srtUrl: data.srt_url || '' }
      // If srtUrl is a marker for local storage, load it from localStorage
      if (cfg.srtUrl === LOCAL_SRT_PREFIX + 'stored') {
        const localContent = localStorage.getItem(LS_SRT_PREFIX + movieId)
        if (localContent) {
          cfg.srtUrl = createLocalSrtUrl(localContent)
        } else {
          cfg.srtUrl = ''
        }
      } else if (isLocalSrtContent(cfg.srtUrl) && cfg.srtUrl.endsWith('stored')) {
        // Handle case where it might be stored as data:local-srt:stored
        const localContent = localStorage.getItem(LS_SRT_PREFIX + movieId)
        if (localContent) {
          cfg.srtUrl = createLocalSrtUrl(localContent)
        } else {
          cfg.srtUrl = ''
        }
      }
      // Cache to localStorage too
      setMovieMediaConfigLocal(movieId, cfg)
      return cfg
    }
    return getMovieMediaConfigLocal(movieId)
  } catch {
    return getMovieMediaConfigLocal(movieId)
  }
}

export async function setMovieMediaConfigPersisted(movieId, { videoUrl, srtUrl }) {
  // If srtUrl is local content, store it separately in localStorage
  let srtUrlToStore = srtUrl || ''
  if (isLocalSrtContent(srtUrl)) {
    const content = getLocalSrtContent(srtUrl)
    localStorage.setItem(LS_SRT_PREFIX + movieId, content)
    // Store a marker in the main config
    srtUrlToStore = LOCAL_SRT_PREFIX + 'stored'
  } else {
    // Remove local content if switching to URL
    localStorage.removeItem(LS_SRT_PREFIX + movieId)
  }
  
  setMovieMediaConfigLocal(movieId, { videoUrl, srtUrl: srtUrlToStore })
  
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return false
    // Only store URLs in Supabase, not file content
    const srtUrlForSupabase = isLocalSrtContent(srtUrl) ? LOCAL_SRT_PREFIX + 'stored' : (srtUrl || '')
    // Upsert into movie_media if exists
    const { error } = await supabase
      .from('movie_media')
      .upsert({
        user_id: user.id,
        movie_id: movieId,
        video_url: videoUrl || '',
        srt_url: srtUrlForSupabase,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,movie_id' })
    if (error) {
      // Table may not exist (404) or other error; silently ignore
      if (error.code !== 'PGRST116') {
        // Only log non-404 errors
        console.debug('movie_media table not accessible, using localStorage only:', error.message)
      }
      return false
    }
    return true
  } catch {
    return false
  }
}

export function getMovieMediaConfigLocal(movieId) {
  try {
    const raw = localStorage.getItem(LS_PREFIX + movieId)
    const cfg = raw ? JSON.parse(raw) : { videoUrl: '', srtUrl: '' }
    
    // Check if srtUrl is a marker for local storage (could be stored with or without prefix)
    const marker = LOCAL_SRT_PREFIX + 'stored'
    const isMarker = cfg.srtUrl === marker || cfg.srtUrl === 'stored' || 
                     (isLocalSrtContent(cfg.srtUrl) && getLocalSrtContent(cfg.srtUrl) === 'stored')
    
    if (isMarker) {
      // Load the actual content from localStorage
      const localContent = localStorage.getItem(LS_SRT_PREFIX + movieId)
      if (localContent && localContent.trim()) {
        cfg.srtUrl = createLocalSrtUrl(localContent)
      } else {
        console.warn(`Local SRT content not found for movie ${movieId}. Marker was: ${cfg.srtUrl}`)
        // Try to check if content exists with different key format
        const altKey = `movie-srt-${movieId}`
        const altContent = localStorage.getItem(altKey)
        if (altContent && altContent.trim()) {
          console.log(`Found SRT content with alternate key, migrating...`)
          localStorage.setItem(LS_SRT_PREFIX + movieId, altContent)
          cfg.srtUrl = createLocalSrtUrl(altContent)
        } else {
          cfg.srtUrl = ''
        }
      }
    } else if (isLocalSrtContent(cfg.srtUrl)) {
      // It's already a full data URL with content, verify it's not just the marker
      const content = getLocalSrtContent(cfg.srtUrl)
      if (!content || content === 'stored' || content.trim() === '') {
        // It's a marker or empty, try to load from localStorage
        const localContent = localStorage.getItem(LS_SRT_PREFIX + movieId)
        if (localContent && localContent.trim()) {
          cfg.srtUrl = createLocalSrtUrl(localContent)
        } else {
          console.warn(`Local SRT content not found for movie ${movieId}, data URL was empty or marker`)
          cfg.srtUrl = ''
        }
      }
      // Otherwise, it's already the full content, keep it as is
    }
    
    return cfg
  } catch (error) {
    console.error('Error loading movie media config:', error)
    return { videoUrl: '', srtUrl: '' }
  }
}

export function setMovieMediaConfigLocal(movieId, { videoUrl, srtUrl }) {
  // If srtUrl is local content, store it separately
  let srtUrlToStore = srtUrl || ''
  if (isLocalSrtContent(srtUrl)) {
    const content = getLocalSrtContent(srtUrl)
    localStorage.setItem(LS_SRT_PREFIX + movieId, content)
    srtUrlToStore = LOCAL_SRT_PREFIX + 'stored'
  } else {
    localStorage.removeItem(LS_SRT_PREFIX + movieId)
  }
  
  localStorage.setItem(LS_PREFIX + movieId, JSON.stringify({ videoUrl: videoUrl || '', srtUrl: srtUrlToStore }))
}



