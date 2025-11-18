import { supabase } from './supabase'
import { buildStoragePath, deleteFileFromBucket, uploadFileToBucket } from './storage'

const TABLE_NAME = 'movie_media_configs'

async function getCurrentUserId() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error) {
    throw error
  }

  if (!user) {
    throw new Error('You must be signed in to manage media.')
  }

  return user.id
}

async function fetchExistingConfig(movieId) {
  if (!movieId) return null

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select('*')
    .eq('movie_id', movieId)
    .maybeSingle()

  if (error && error.code !== 'PGRST116') {
    throw error
  }

  return data || null
}

export async function getMovieMediaConfigPersisted(movieId) {
  const existing = await fetchExistingConfig(movieId)

  return {
    audioUrl: existing?.audio_url || '',
    srtUrl: existing?.srt_url || '',
    subtitleOffset: existing?.subtitle_offset || 0,
    audioFileName: existing?.audio_file_name || '',
    srtFileName: existing?.srt_file_name || '',
  }
}

export async function setMovieMediaConfigPersisted(
  movieId,
  { audioFile = null, srtFile = null, subtitleOffset = 0 } = {}
) {
  if (!movieId) {
    throw new Error('movieId is required to save media configuration.')
  }

  const userId = await getCurrentUserId()
  const existing = await fetchExistingConfig(movieId)

  let audioInfo = {
    path: existing?.audio_storage_path || null,
    url: existing?.audio_url || '',
    fileName: existing?.audio_file_name || '',
    mimeType: existing?.audio_mime_type || '',
  }

  let srtInfo = {
    path: existing?.srt_storage_path || null,
    url: existing?.srt_url || '',
    fileName: existing?.srt_file_name || '',
  }

  if (audioFile) {
    if (audioInfo.path) {
      try {
        await deleteFileFromBucket(audioInfo.path)
      } catch (error) {
        console.warn('Unable to delete previous audio file:', error.message)
      }
    }

    const audioPath = buildStoragePath([
      'users',
      userId,
      'movies',
      movieId,
      'audio',
      `${Date.now()}-${audioFile.name}`,
    ])

    const uploadedAudio = await uploadFileToBucket({ path: audioPath, file: audioFile })
    audioInfo = {
      path: uploadedAudio.path,
      url: uploadedAudio.publicUrl,
      fileName: uploadedAudio.fileName,
      mimeType: uploadedAudio.mimeType,
    }
  }

  if (srtFile) {
    if (srtInfo.path) {
      try {
        await deleteFileFromBucket(srtInfo.path)
      } catch (error) {
        console.warn('Unable to delete previous subtitle file:', error.message)
      }
    }

    const srtPath = buildStoragePath([
      'users',
      userId,
      'movies',
      movieId,
      'subtitles',
      `${Date.now()}-${srtFile.name}`,
    ])

    const uploadedSrt = await uploadFileToBucket({ path: srtPath, file: srtFile })
    srtInfo = {
      path: uploadedSrt.path,
      url: uploadedSrt.publicUrl,
      fileName: uploadedSrt.fileName,
    }
  }

  const upsertPayload = {
    user_id: userId,
    movie_id: movieId,
    audio_storage_path: audioInfo.path,
    audio_url: audioInfo.url,
    audio_file_name: audioInfo.fileName,
    audio_mime_type: audioInfo.mimeType,
    srt_storage_path: srtInfo.path,
    srt_url: srtInfo.url,
    srt_file_name: srtInfo.fileName,
    subtitle_offset: Number.isFinite(subtitleOffset) ? Math.round(subtitleOffset) : 0,
  }

  const { error } = await supabase.from(TABLE_NAME).upsert(upsertPayload, { onConflict: 'movie_id' })
  if (error) {
    throw error
  }

  return {
    audioUrl: audioInfo.url,
    srtUrl: srtInfo.url,
    subtitleOffset: upsertPayload.subtitle_offset,
    audioFileName: audioInfo.fileName,
    srtFileName: srtInfo.fileName,
  }
}

