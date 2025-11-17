// Persist per-movie media URLs (video, audio, and SRT) using IndexedDB and localStorage only.
// Supports both URLs and local file content. Audio files stored as Blobs in IndexedDB for efficiency.

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
  // Simplified: Just use local storage (IndexedDB + localStorage)
  // No Supabase calls - everything stored locally
  return await getMovieMediaConfigLocal(movieId)
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
    console.log(`[setMovieMediaConfigPersisted] Storing audio content for movie ${movieId}, content type:`, typeof content, 'is blob-stored:', content === 'blob-stored')
    
    // If it's a blob-stored marker, the blob is already in IndexedDB, just mark it
    if (content === 'blob-stored') {
      const storageKey = LS_AUDIO_PREFIX + movieId
      // Ensure the marker is set
      localStorage.setItem(storageKey + '-idb', 'true')
      audioUrlToStore = LOCAL_AUDIO_PREFIX + 'blob-stored'
      console.log(`[setMovieMediaConfigPersisted] Audio blob already stored in IndexedDB`)
    } else if (!content || content === 'stored' || (typeof content === 'string' && content.trim() === '')) {
      console.error(`[setMovieMediaConfigPersisted] Audio content is empty or marker!`)
      throw new Error('Audio file content is missing. Please re-upload your audio file.')
    } else {
      // Legacy: storing base64 string content
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
    }
  } else {
    const storageKey = LS_AUDIO_PREFIX + movieId
    localStorage.removeItem(storageKey)
    localStorage.removeItem(storageKey + '-idb')
    localStorage.removeItem(storageKey + '-type')
    removeAudioFromIndexedDB(storageKey)
  }
  
  await setMovieMediaConfigLocal(movieId, { videoUrl, audioUrl: audioUrlToStore, srtUrl: srtUrlToStore })
  
  // Always return true - local storage always succeeds
  return true
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
    const blobMarker = LOCAL_AUDIO_PREFIX + 'blob-stored'
    const isAudioMarker = cfg.audioUrl === audioMarker || cfg.audioUrl === 'stored' || 
                         (isLocalAudioContent(cfg.audioUrl) && getLocalAudioContent(cfg.audioUrl) === 'stored')
    const isBlobMarker = cfg.audioUrl === blobMarker ||
                         (isLocalAudioContent(cfg.audioUrl) && getLocalAudioContent(cfg.audioUrl) === 'blob-stored')
    
    if (isBlobMarker || isAudioMarker) {
      const storageKey = LS_AUDIO_PREFIX + movieId
      
      // For blob-stored, always check IndexedDB first (blobs are always in IndexedDB)
      // For regular stored, check the flag
      const useIndexedDB = isBlobMarker || localStorage.getItem(storageKey + '-idb') === 'true'
      
      console.log(`[getMovieMediaConfigLocal] Loading audio content for movie ${movieId}, useIndexedDB: ${useIndexedDB}, isBlob: ${isBlobMarker}`)
      
      let localAudioContent = null
      if (useIndexedDB) {
        localAudioContent = await getAudioFromIndexedDB(storageKey)
        console.log(`[getMovieMediaConfigLocal] Audio content from IndexedDB, type: ${typeof localAudioContent}, isBlob: ${localAudioContent instanceof Blob}`)
        
        // If blob marker but got a string, it might be legacy data - try localStorage
        if (isBlobMarker && typeof localAudioContent === 'string' && localAudioContent.length < 100) {
          console.log(`[getMovieMediaConfigLocal] Blob marker but got string, checking if blob exists...`)
          // The blob should be there, but let's verify by checking if it's actually a blob
          // Try to get it again or check localStorage for the actual blob
          const blobFromStorage = await getAudioFromIndexedDB(storageKey)
          if (blobFromStorage instanceof Blob) {
            localAudioContent = blobFromStorage
            console.log(`[getMovieMediaConfigLocal] Found blob in IndexedDB`)
          }
        }
      } else {
        localAudioContent = localStorage.getItem(storageKey)
        console.log(`[getMovieMediaConfigLocal] Audio content from localStorage, type: ${typeof localAudioContent}, length: ${localAudioContent ? localAudioContent.length : 'null'}`)
      }
      
      // Check if content exists and is valid
      if (localAudioContent) {
        if (localAudioContent instanceof Blob) {
          // It's a Blob - create blob URL immediately
          const blobUrl = URL.createObjectURL(localAudioContent)
          const mimeType = localStorage.getItem(storageKey + '-type') || localAudioContent.type || 'audio/mpeg'
          const dataUrl = `data:${mimeType};blob-url:${blobUrl}`
          cfg.audioUrl = createLocalAudioUrl(dataUrl)
          console.log(`[getMovieMediaConfigLocal] Audio blob loaded, created blob URL, size: ${localAudioContent.size} bytes, type: ${mimeType}`)
        } else if (typeof localAudioContent === 'string') {
          // If it's "blob-stored" marker string, try to load from IndexedDB as blob
          if (localAudioContent === 'blob-stored' || localAudioContent.trim() === 'blob-stored') {
            console.log(`[getMovieMediaConfigLocal] Found blob-stored marker, loading blob from IndexedDB...`)
            const blobFromIDB = await getAudioFromIndexedDB(storageKey)
            if (blobFromIDB instanceof Blob) {
              const blobUrl = URL.createObjectURL(blobFromIDB)
              const mimeType = localStorage.getItem(storageKey + '-type') || blobFromIDB.type || 'audio/mpeg'
              const dataUrl = `data:${mimeType};blob-url:${blobUrl}`
              cfg.audioUrl = createLocalAudioUrl(dataUrl)
              console.log(`[getMovieMediaConfigLocal] Audio blob loaded from IndexedDB (from marker), size: ${blobFromIDB.size} bytes`)
            } else {
              console.warn(`[getMovieMediaConfigLocal] Blob marker found but blob not in IndexedDB`)
              cfg.audioUrl = ''
            }
          } else {
            // Legacy: base64 string content
            const isValidContent = localAudioContent.length > 100
            
            if (isValidContent) {
              // The stored content should be the full data URL (data:audio/mpeg;base64,...)
              // or just the base64 content. Wrap it with createLocalAudioUrl to create the proper format
              cfg.audioUrl = createLocalAudioUrl(localAudioContent)
              console.log(`[getMovieMediaConfigLocal] Audio content loaded successfully (legacy base64), final URL length: ${cfg.audioUrl.length}`)
            } else {
              console.warn(`Local audio content is too short or invalid for movie ${movieId}, length: ${localAudioContent.length}`)
              cfg.audioUrl = ''
            }
          }
        } else {
          // If it's not a string or Blob, something went wrong
          console.warn(`Local audio content is unexpected type for movie ${movieId}, type: ${typeof localAudioContent}`)
          cfg.audioUrl = ''
        }
      } else {
        console.warn(`Local audio content not found for movie ${movieId}, storageKey: ${storageKey}, useIndexedDB: ${useIndexedDB}`)
        cfg.audioUrl = ''
      }
    } else if (isLocalAudioContent(cfg.audioUrl)) {
      const content = getLocalAudioContent(cfg.audioUrl)
      console.log(`[getMovieMediaConfigLocal] Audio URL is local content (not marker), extracted content length: ${content ? content.length : 0}`)
      
      if (!content || content === 'stored' || (typeof content === 'string' && content.trim() === '')) {
        console.log(`[getMovieMediaConfigLocal] Audio content is marker/empty, loading from storage...`)
        const storageKey = LS_AUDIO_PREFIX + movieId
        const useIndexedDB = localStorage.getItem(storageKey + '-idb') === 'true'
        
        let localAudioContent = null
        if (useIndexedDB) {
          localAudioContent = await getAudioFromIndexedDB(storageKey)
          console.log(`[getMovieMediaConfigLocal] Audio content from IndexedDB (fallback), type: ${typeof localAudioContent}, length: ${localAudioContent ? (typeof localAudioContent === 'string' ? localAudioContent.length : 'non-string') : 'null'}`)
        } else {
          localAudioContent = localStorage.getItem(storageKey)
          console.log(`[getMovieMediaConfigLocal] Audio content from localStorage (fallback), type: ${typeof localAudioContent}, length: ${localAudioContent ? localAudioContent.length : 'null'}`)
        }
        
        // Check if content exists and is valid
        if (localAudioContent) {
          // For IndexedDB, content might not have trim method, so check differently
          if (typeof localAudioContent === 'string') {
            // Audio content should be long (at least 100 chars for small files, usually much longer)
            const isValidContent = localAudioContent.length > 100
            
            if (isValidContent) {
              cfg.audioUrl = createLocalAudioUrl(localAudioContent)
              console.log(`[getMovieMediaConfigLocal] Audio content loaded from storage (fallback), final URL length: ${cfg.audioUrl.length}`)
            } else {
              console.warn(`Local audio content is too short or invalid for movie ${movieId} (fallback), length: ${localAudioContent.length}`)
              cfg.audioUrl = ''
            }
          } else {
            // If it's not a string, it might be a Blob or other type - try to use it
            console.warn(`Local audio content is not a string for movie ${movieId} (fallback), type: ${typeof localAudioContent}`)
            cfg.audioUrl = ''
          }
        } else {
          console.warn(`Local audio content not found for movie ${movieId} (fallback)`)
          cfg.audioUrl = ''
        }
      } else {
        // Content is already there and valid, keep it as is
        console.log(`[getMovieMediaConfigLocal] Audio content is already valid, length: ${content.length}`)
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
    console.log(`[setMovieMediaConfigLocal] Audio content extracted, length:`, content ? content.length : 0, 'is blob-stored:', content === 'blob-stored')
    
    // Don't overwrite existing content with a marker!
    if (!content || content === 'stored' || content === 'blob-stored' || (typeof content === 'string' && content.trim() === '')) {
      console.log(`[setMovieMediaConfigLocal] Audio is marker, not overwriting existing content`)
      // Check if we already have content stored
      const storageKey = LS_AUDIO_PREFIX + movieId
      const useIndexedDB = localStorage.getItem(storageKey + '-idb') === 'true' || content === 'blob-stored'
      let existingContent = null
      if (useIndexedDB) {
        existingContent = await getAudioFromIndexedDB(storageKey)
      } else {
        existingContent = localStorage.getItem(storageKey)
      }
      if (existingContent && existingContent !== 'stored' && existingContent !== 'blob-stored') {
        // Keep the marker that matches the storage type
        if (content === 'blob-stored' || (existingContent instanceof Blob)) {
          audioUrlToStore = LOCAL_AUDIO_PREFIX + 'blob-stored'
        } else {
          audioUrlToStore = LOCAL_AUDIO_PREFIX + 'stored'
        }
      } else {
        // No existing content, clear it
        localStorage.removeItem(storageKey)
        localStorage.removeItem(storageKey + '-idb')
        localStorage.removeItem(storageKey + '-type')
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



