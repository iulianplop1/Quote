import { supabase } from './supabase'

const DEFAULT_BUCKET = 'quote-media'
const bucketName = import.meta.env.VITE_SUPABASE_MEDIA_BUCKET || DEFAULT_BUCKET

export function getMediaBucketName() {
  return bucketName
}

export function buildStoragePath(parts = []) {
  return parts
    .filter(Boolean)
    .map((segment) => segment.replace(/^\/+|\/+$/g, ''))
    .join('/')
}

export async function uploadFileToBucket({ path, file, cacheControl = '3600', upsert = true }) {
  if (!file) {
    throw new Error('No file provided for upload.')
  }

  if (!path) {
    throw new Error('Storage path is required.')
  }

  const { error } = await supabase.storage.from(bucketName).upload(path, file, {
    cacheControl,
    upsert,
    contentType: file.type || undefined,
  })

  if (error) {
    throw error
  }

  const { data } = supabase.storage.from(bucketName).getPublicUrl(path)
  return {
    path,
    publicUrl: data?.publicUrl || '',
    mimeType: file.type || null,
    size: file.size,
    fileName: file.name,
  }
}

export async function deleteFileFromBucket(path) {
  if (!path) return
  const { error } = await supabase.storage.from(bucketName).remove([path])
  if (error) {
    throw error
  }
}

