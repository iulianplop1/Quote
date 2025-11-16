// Persist per-movie media URLs (video and SRT) in Supabase if possible, with localStorage fallback.
// Supports both URLs and local file content for subtitles.
import { supabase } from './supabase'

const LS_PREFIX = 'movie-media-'
const LS_SRT_PREFIX = 'movie-srt-content-'
const LS_AUDIO_PREFIX = 'movie-audio-content-'
const IDB_STORE_NAME = 'movie-audio-files'
const MAX_LOCALSTORAGE_SIZE = 4 * 1024 * 1024 // 4MB limit for localStorage

// Check if srtUrl is actually local file content (starts with special prefix)
const LOCAL_SRT_PREFIX = 'data:local-srt:'
const LOCAL_AUDIO_PREFIX = 'data:local-audio:'

// IndexedDB helper functions for large audio files
async function getIndexedDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('QuoteAppDB', 1)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
    request.onupgradeneeded = (event) => {
      const db = event.target.result
      if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
        db.createObjectStore(IDB_STORE_NAME)
      }
    }
  })
}

async function setAudioInIndexedDB(key, value) {
  try {
    const db = await getIndexedDB()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([IDB_STORE_NAME], 'readwrite')
      const store = transaction.objectStore(IDB_STORE_NAME)
      const request = store.put(value, key)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  } catch (error) {
    console.error('IndexedDB error:', error)
    throw error
  }
}

async function getAudioFromIndexedDB(key) {
  try {
    const db = await getIndexedDB()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([IDB_STORE_NAME], 'readonly')
      const store = transaction.objectStore(IDB_STORE_NAME)
      const request = store.get(key)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  } catch (error) {
    console.error('IndexedDB error:', error)
    return null
  }
}

async function removeAudioFromIndexedDB(key) {
  try {
    const db = await getIndexedDB()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([IDB_STORE_NAME], 'readwrite')
      const store = transaction.objectStore(IDB_STORE_NAME)
      const request = store.delete(key)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  } catch (error) {
    console.error('IndexedDB error:', error)
  }
}
export function isLocalSrtContent(srtUrl) {
  return srtUrl && srtUrl.startsWith(LOCAL_SRT_PREFIX)
}
export function isLocalAudioContent(audioUrl) {
  return audioUrl && audioUrl.startsWith(LOCAL_AUDIO_PREFIX)
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
// Create a local audio data URL from content
export function createLocalAudioUrl(content) {
  return LOCAL_AUDIO_PREFIX + content
}
// Extract content from local audio data URL
export function getLocalAudioContent(audioUrl) {
  if (isLocalAudioContent(audioUrl)) {
    return audioUrl.substring(LOCAL_AUDIO_PREFIX.length)
  }
  return null
}

export async function getMovieMediaConfigPersisted(movieId) {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return await getMovieMediaConfigLocal(movieId)
    // Try reading from movie_media table if it exists
    const { data, error } = await supabase
      .from('movie_media')
      .select('video_url, audio_url, srt_url')
      .eq('user_id', user.id)
      .eq('movie_id', movieId)
      .maybeSingle()
    if (error) {
      // Table might not exist (404) or other error; silently fall back to local
      // PGRST116 = not found, 400 = bad request (might be schema/permission issue)
      // PGRST301 = bad request (column doesn't exist or wrong format)
      // Suppress these expected errors completely
      if (error.code !== 'PGRST116' && error.code !== 'PGRST301' && error.code !== '23505') {
        // Only log unexpected errors
        console.debug('movie_media table not accessible, using localStorage:', error.message, error.code)
      }
      return await getMovieMediaConfigLocal(movieId)
    }
    if (data) {
      const cfg = { videoUrl: data.video_url || '', audioUrl: data.audio_url || '', srtUrl: data.srt_url || '' }
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
      
      // If audioUrl is a marker for local storage, load it from localStorage/IndexedDB
      if (cfg.audioUrl === LOCAL_AUDIO_PREFIX + 'stored' || 
          (isLocalAudioContent(cfg.audioUrl) && getLocalAudioContent(cfg.audioUrl) === 'stored')) {
        const storageKey = LS_AUDIO_PREFIX + movieId
        const useIndexedDB = localStorage.getItem(storageKey + '-idb') === 'true'
        
        let localAudioContent = null
        if (useIndexedDB) {
          localAudioContent = await getAudioFromIndexedDB(storageKey)
        } else {
          localAudioContent = localStorage.getItem(storageKey)
        }
        
        if (localAudioContent) {
          cfg.audioUrl = createLocalAudioUrl(localAudioContent)
        } else {
          console.warn(`Local audio content not found for movie ${movieId} from Supabase`)
          cfg.audioUrl = ''
        }
      }
      
      // Don't call setMovieMediaConfigLocal here - it would overwrite with markers
      // The cfg already has the full content loaded, so just update the main config entry
      localStorage.setItem(LS_PREFIX + movieId, JSON.stringify({ 
        videoUrl: cfg.videoUrl || '', 
        audioUrl: cfg.audioUrl || '',
        srtUrl: cfg.srtUrl || '' 
      }))
      return cfg
    }
    return await getMovieMediaConfigLocal(movieId)
  } catch {
    return await getMovieMediaConfigLocal(movieId)
  }
}

export async function setMovieMediaConfigPersisted(movieId, { videoUrl, audioUrl, srtUrl }) {
  // If srtUrl is local content, store it separately in localStorage
  let srtUrlToStore = srtUrl || ''
  if (isLocalSrtContent(srtUrl)) {
    const content = getLocalSrtContent(srtUrl)
    console.log(`[setMovieMediaConfigPersisted] Storing SRT content for movie ${movieId}, length:`, content ? content.length : 0)
    
    if (!content || content === 'stored' || content.trim() === '') {
      console.error(`[setMovieMediaConfigPersisted] SRT content is empty or marker! Content:`, content ? content.substring(0, 50) : 'null')
      throw new Error('SRT file content is missing. Please re-upload your subtitle file.')
    }
    
    localStorage.setItem(LS_SRT_PREFIX + movieId, content)
    console.log(`[setMovieMediaConfigPersisted] SRT content stored successfully, length:`, content.length)
    // Store a marker in the main config
    srtUrlToStore = LOCAL_SRT_PREFIX + 'stored'
  } else {
    // Remove local content if switching to URL
    localStorage.removeItem(LS_SRT_PREFIX + movieId)
  }
  
  // Handle audioUrl storage - use IndexedDB for large files
  let audioUrlToStore = audioUrl || ''
  if (isLocalAudioContent(audioUrl)) {
    const content = getLocalAudioContent(audioUrl)
    console.log(`[setMovieMediaConfigPersisted] Storing audio content for movie ${movieId}, content length:`, content ? content.length : 0)
    
    if (!content || content === 'stored' || (typeof content === 'string' && content.trim() === '')) {
      console.error(`[setMovieMediaConfigPersisted] Audio content is empty or marker!`)
      throw new Error('Audio file content is missing. Please re-upload your audio file.')
    }
    
    const contentSize = new Blob([content]).size
    console.log(`[setMovieMediaConfigPersisted] Audio content size:`, contentSize, 'bytes')
    const storageKey = LS_AUDIO_PREFIX + movieId
    
    try {
      if (contentSize > MAX_LOCALSTORAGE_SIZE) {
        // Use IndexedDB for large files
        await setAudioInIndexedDB(storageKey, content)
        localStorage.removeItem(storageKey) // Remove from localStorage if it exists
        // Mark as stored in IndexedDB
        localStorage.setItem(storageKey + '-idb', 'true')
      } else {
        // Use localStorage for small files
        localStorage.setItem(storageKey, content)
        localStorage.removeItem(storageKey + '-idb')
        await removeAudioFromIndexedDB(storageKey) // Remove from IndexedDB if it exists
      }
      audioUrlToStore = LOCAL_AUDIO_PREFIX + 'stored'
    } catch (error) {
      if (error.name === 'QuotaExceededError') {
        // Fallback to IndexedDB if localStorage quota exceeded
        try {
          await setAudioInIndexedDB(storageKey, content)
          localStorage.setItem(storageKey + '-idb', 'true')
          audioUrlToStore = LOCAL_AUDIO_PREFIX + 'stored'
        } catch (idbError) {
          throw new Error('Audio file is too large to store. Please use an audio URL instead.')
        }
      } else {
        throw error
      }
    }
  } else {
    const storageKey = LS_AUDIO_PREFIX + movieId
    localStorage.removeItem(storageKey)
    localStorage.removeItem(storageKey + '-idb')
    removeAudioFromIndexedDB(storageKey)
  }
  
  await setMovieMediaConfigLocal(movieId, { videoUrl, audioUrl: audioUrlToStore, srtUrl: srtUrlToStore })
  
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return false
    // Only store URLs in Supabase, not file content
    const srtUrlForSupabase = isLocalSrtContent(srtUrl) ? LOCAL_SRT_PREFIX + 'stored' : (srtUrl || '')
    const audioUrlForSupabase = isLocalAudioContent(audioUrl) ? LOCAL_AUDIO_PREFIX + 'stored' : (audioUrl || '')
    // Upsert into movie_media if exists
    // Build the data object without updated_at first, then add it if needed
    const upsertData = {
      user_id: user.id,
      movie_id: movieId,
      video_url: videoUrl || '',
      audio_url: audioUrlForSupabase || '',
      srt_url: srtUrlForSupabase || '',
    }
    
    // Try with updated_at first, fall back without it if it fails
    const { error } = await supabase
      .from('movie_media')
      .upsert({
        ...upsertData,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,movie_id' })
    
    // If no error, success!
    if (!error) {
      return true
    }
    
    // If error is due to updated_at column, try without it
    if (error.code === 'PGRST301' || error.message?.includes('column') || error.message?.includes('updated_at')) {
      const { error: error2 } = await supabase
        .from('movie_media')
        .upsert(upsertData, { onConflict: 'user_id,movie_id' })
      
      if (error2) {
        // Use the second error if it exists
        if (error2.code !== 'PGRST116' && error2.code !== 'PGRST301') {
          console.debug('movie_media table not accessible, using localStorage only:', error2.message, error2.code)
        }
        return false
      }
      return true
    }
    
    // Other errors - table may not exist (404) or other error; silently ignore
    // PGRST116 = not found, 400 = bad request (might be schema/permission issue)
    // PGRST301 = bad request (column doesn't exist or wrong format)
    // 23505 = unique constraint violation (expected in some cases)
    // Suppress these expected errors completely
    if (error.code !== 'PGRST116' && error.code !== 'PGRST301' && error.code !== '23505') {
      // Only log unexpected errors
      console.debug('movie_media table not accessible, using localStorage only:', error.message, error.code)
    }
    return false
  } catch {
    return false
  }
}

export async function getMovieMediaConfigLocal(movieId) {
  try {
    const raw = localStorage.getItem(LS_PREFIX + movieId)
    const cfg = raw ? JSON.parse(raw) : { videoUrl: '', audioUrl: '', srtUrl: '' }
    console.log(`[getMovieMediaConfigLocal] Loading config for movie ${movieId}:`, {
      srtUrlType: cfg.srtUrl ? (cfg.srtUrl.startsWith('data:local-srt:') ? 'local' : 'other') : 'empty',
      srtUrlLength: cfg.srtUrl ? cfg.srtUrl.length : 0,
      srtUrlPreview: cfg.srtUrl ? cfg.srtUrl.substring(0, 50) : 'empty'
    })
    
    // Check if srtUrl is a marker for local storage (could be stored with or without prefix)
    const marker = LOCAL_SRT_PREFIX + 'stored'
    const isMarker = cfg.srtUrl === marker || cfg.srtUrl === 'stored' || 
                     (isLocalSrtContent(cfg.srtUrl) && getLocalSrtContent(cfg.srtUrl) === 'stored')
    
    if (isMarker) {
      console.log(`[getMovieMediaConfigLocal] SRT marker detected, loading from storage...`)
      // Load the actual content from localStorage
      const localContent = localStorage.getItem(LS_SRT_PREFIX + movieId)
      if (localContent && localContent.trim()) {
        console.log(`[getMovieMediaConfigLocal] SRT content loaded from localStorage, length:`, localContent.length)
        cfg.srtUrl = createLocalSrtUrl(localContent)
      } else {
        console.warn(`[getMovieMediaConfigLocal] Local SRT content not found for movie ${movieId}. Marker was: ${cfg.srtUrl}`)
        // Try to check if content exists with different key format
        const altKey = `movie-srt-${movieId}`
        const altContent = localStorage.getItem(altKey)
        if (altContent && altContent.trim()) {
          console.log(`[getMovieMediaConfigLocal] Found SRT content with alternate key, migrating...`)
          localStorage.setItem(LS_SRT_PREFIX + movieId, altContent)
          cfg.srtUrl = createLocalSrtUrl(altContent)
        } else {
          cfg.srtUrl = ''
        }
      }
    } else if (isLocalSrtContent(cfg.srtUrl)) {
      // It's already a full data URL with content, verify it's not just the marker
      const content = getLocalSrtContent(cfg.srtUrl)
      console.log(`[getMovieMediaConfigLocal] SRT is local content, checking...`, {
        contentLength: content ? content.length : 0,
        isStored: content === 'stored',
        isEmpty: !content || (typeof content === 'string' && content.trim() === '')
      })
      
      if (!content || content === 'stored' || (typeof content === 'string' && content.trim() === '')) {
        // It's a marker or empty, try to load from localStorage
        console.log(`[getMovieMediaConfigLocal] SRT content is marker/empty, loading from localStorage...`)
        const localContent = localStorage.getItem(LS_SRT_PREFIX + movieId)
        if (localContent && localContent.trim()) {
          console.log(`[getMovieMediaConfigLocal] SRT content loaded from localStorage (fallback), length:`, localContent.length)
          cfg.srtUrl = createLocalSrtUrl(localContent)
        } else {
          console.warn(`[getMovieMediaConfigLocal] Local SRT content not found for movie ${movieId}, data URL was empty or marker`)
          cfg.srtUrl = ''
        }
      } else {
        console.log(`[getMovieMediaConfigLocal] SRT content is valid, length:`, content.length)
      }
      // Otherwise, it's already the full content, keep it as is
    } else {
      console.log(`[getMovieMediaConfigLocal] SRT is not local content or empty`)
    }
    
    // Handle audioUrl local storage
    const audioMarker = LOCAL_AUDIO_PREFIX + 'stored'
    const isAudioMarker = cfg.audioUrl === audioMarker || cfg.audioUrl === 'stored' || 
                         (isLocalAudioContent(cfg.audioUrl) && getLocalAudioContent(cfg.audioUrl) === 'stored')
    
    if (isAudioMarker) {
      const storageKey = LS_AUDIO_PREFIX + movieId
      const useIndexedDB = localStorage.getItem(storageKey + '-idb') === 'true'
      
      let localAudioContent = null
      if (useIndexedDB) {
        localAudioContent = await getAudioFromIndexedDB(storageKey)
      } else {
        localAudioContent = localStorage.getItem(storageKey)
      }
      
      // Check if content exists and is valid
      if (localAudioContent) {
        // For IndexedDB, content might not have trim method, so check differently
        if (typeof localAudioContent === 'string') {
          if (localAudioContent.trim && localAudioContent.trim()) {
            cfg.audioUrl = createLocalAudioUrl(localAudioContent)
          } else if (localAudioContent.length > 0) {
            // Even if trim() returns empty, if it has length, it might be valid (could be base64)
            cfg.audioUrl = createLocalAudioUrl(localAudioContent)
          } else {
            console.warn(`Local audio content is empty for movie ${movieId}`)
            cfg.audioUrl = ''
          }
        } else {
          // If it's not a string, it might be a Blob or other type - try to use it
          console.warn(`Local audio content is not a string for movie ${movieId}, type: ${typeof localAudioContent}`)
          cfg.audioUrl = ''
        }
      } else {
        console.warn(`Local audio content not found for movie ${movieId}`)
        cfg.audioUrl = ''
      }
    } else if (isLocalAudioContent(cfg.audioUrl)) {
      const content = getLocalAudioContent(cfg.audioUrl)
      if (!content || content === 'stored' || (typeof content === 'string' && content.trim() === '')) {
        const storageKey = LS_AUDIO_PREFIX + movieId
        const useIndexedDB = localStorage.getItem(storageKey + '-idb') === 'true'
        
        let localAudioContent = null
        if (useIndexedDB) {
          localAudioContent = await getAudioFromIndexedDB(storageKey)
        } else {
          localAudioContent = localStorage.getItem(storageKey)
        }
        
        // Check if content exists and is valid
        if (localAudioContent) {
          // For IndexedDB, content might not have trim method, so check differently
          if (typeof localAudioContent === 'string') {
            if (localAudioContent.trim && localAudioContent.trim()) {
              cfg.audioUrl = createLocalAudioUrl(localAudioContent)
            } else if (localAudioContent.length > 0) {
              // Even if trim() returns empty, if it has length, it might be valid (could be base64)
              cfg.audioUrl = createLocalAudioUrl(localAudioContent)
            } else {
              cfg.audioUrl = ''
            }
          } else {
            // If it's not a string, it might be a Blob or other type - try to use it
            console.warn(`Local audio content is not a string for movie ${movieId}, type: ${typeof localAudioContent}`)
            cfg.audioUrl = ''
          }
        } else {
          cfg.audioUrl = ''
        }
      }
    }
    
    return cfg
  } catch (error) {
    console.error('Error loading movie media config:', error)
    return { videoUrl: '', audioUrl: '', srtUrl: '' }
  }
}

export async function setMovieMediaConfigLocal(movieId, { videoUrl, audioUrl, srtUrl }) {
  // If srtUrl is local content, store it separately
  let srtUrlToStore = srtUrl || ''
  if (isLocalSrtContent(srtUrl)) {
    const content = getLocalSrtContent(srtUrl)
    console.log(`[setMovieMediaConfigLocal] SRT content extracted, length:`, content ? content.length : 0)
    
    // Don't overwrite existing content with a marker!
    if (content && content !== 'stored' && content.trim() !== '') {
      localStorage.setItem(LS_SRT_PREFIX + movieId, content)
      console.log(`[setMovieMediaConfigLocal] SRT content stored, length:`, content.length)
      srtUrlToStore = LOCAL_SRT_PREFIX + 'stored'
    } else {
      // If it's a marker, don't overwrite - keep existing content
      console.log(`[setMovieMediaConfigLocal] SRT is marker, not overwriting existing content`)
      // Check if we already have content stored
      const existingContent = localStorage.getItem(LS_SRT_PREFIX + movieId)
      if (existingContent && existingContent !== 'stored') {
        srtUrlToStore = LOCAL_SRT_PREFIX + 'stored'
      } else {
        // No existing content, clear it
        localStorage.removeItem(LS_SRT_PREFIX + movieId)
        srtUrlToStore = ''
      }
    }
  } else {
    localStorage.removeItem(LS_SRT_PREFIX + movieId)
  }
  
  // If audioUrl is local content, store it separately - use IndexedDB for large files
  let audioUrlToStore = audioUrl || ''
  if (isLocalAudioContent(audioUrl)) {
    const content = getLocalAudioContent(audioUrl)
    console.log(`[setMovieMediaConfigLocal] Audio content extracted, length:`, content ? content.length : 0)
    
    // Don't overwrite existing content with a marker!
    if (!content || content === 'stored' || (typeof content === 'string' && content.trim() === '')) {
      console.log(`[setMovieMediaConfigLocal] Audio is marker, not overwriting existing content`)
      // Check if we already have content stored
      const storageKey = LS_AUDIO_PREFIX + movieId
      const useIndexedDB = localStorage.getItem(storageKey + '-idb') === 'true'
      let existingContent = null
      if (useIndexedDB) {
        existingContent = await getAudioFromIndexedDB(storageKey)
      } else {
        existingContent = localStorage.getItem(storageKey)
      }
      if (existingContent && existingContent !== 'stored') {
        audioUrlToStore = LOCAL_AUDIO_PREFIX + 'stored'
      } else {
        // No existing content, clear it
        localStorage.removeItem(storageKey)
        localStorage.removeItem(storageKey + '-idb')
        await removeAudioFromIndexedDB(storageKey)
        audioUrlToStore = ''
      }
    } else {
      // We have actual content, store it
      const contentSize = new Blob([content]).size
      const storageKey = LS_AUDIO_PREFIX + movieId
    
    try {
      if (contentSize > MAX_LOCALSTORAGE_SIZE) {
        // Use IndexedDB for large files
        await setAudioInIndexedDB(storageKey, content)
        localStorage.removeItem(storageKey)
        localStorage.setItem(storageKey + '-idb', 'true')
      } else {
        // Use localStorage for small files
        localStorage.setItem(storageKey, content)
        localStorage.removeItem(storageKey + '-idb')
        await removeAudioFromIndexedDB(storageKey)
      }
      audioUrlToStore = LOCAL_AUDIO_PREFIX + 'stored'
    } catch (error) {
      if (error.name === 'QuotaExceededError') {
        // Fallback to IndexedDB if localStorage quota exceeded
        try {
          await setAudioInIndexedDB(storageKey, content)
          localStorage.setItem(storageKey + '-idb', 'true')
          audioUrlToStore = LOCAL_AUDIO_PREFIX + 'stored'
        } catch (idbError) {
          console.error('Failed to store audio in IndexedDB:', idbError)
          // Continue anyway - the audio is still in memory
          audioUrlToStore = LOCAL_AUDIO_PREFIX + 'stored'
        }
      } else {
        console.error('Error storing audio:', error)
        // Continue anyway - the audio is still in memory
        audioUrlToStore = LOCAL_AUDIO_PREFIX + 'stored'
      }
    }
    }
  } else {
    const storageKey = LS_AUDIO_PREFIX + movieId
    localStorage.removeItem(storageKey)
    localStorage.removeItem(storageKey + '-idb')
    removeAudioFromIndexedDB(storageKey)
  }
  
  localStorage.setItem(LS_PREFIX + movieId, JSON.stringify({ 
    videoUrl: videoUrl || '', 
    audioUrl: audioUrlToStore,
    srtUrl: srtUrlToStore 
  }))
}



