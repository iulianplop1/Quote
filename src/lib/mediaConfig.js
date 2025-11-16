// Persist per-movie media URLs (video and SRT) in Supabase if possible, with localStorage fallback.
import { supabase } from './supabase'

const LS_PREFIX = 'movie-media-'

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
  setMovieMediaConfigLocal(movieId, { videoUrl, srtUrl })
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return false
    // Upsert into movie_media if exists
    const { error } = await supabase
      .from('movie_media')
      .upsert({
        user_id: user.id,
        movie_id: movieId,
        video_url: videoUrl || '',
        srt_url: srtUrl || '',
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
    return raw ? JSON.parse(raw) : { videoUrl: '', srtUrl: '' }
  } catch {
    return { videoUrl: '', srtUrl: '' }
  }
}

export function setMovieMediaConfigLocal(movieId, { videoUrl, srtUrl }) {
  localStorage.setItem(LS_PREFIX + movieId, JSON.stringify({ videoUrl: videoUrl || '', srtUrl: srtUrl || '' }))
}


