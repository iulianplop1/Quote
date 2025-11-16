// ElevenLabs Text-to-Speech API integration
// Provides high-quality, cinematic voices for reading quotes

const ELEVEN_LABS_API_KEY = import.meta.env.VITE_ELEVEN_LABS_API_KEY
export const ELEVEN_LABS_VOICE_ID = import.meta.env.VITE_ELEVEN_LABS_VOICE_ID || 'TxGEqnHWrfWFTfGW9XjX' // Josh - deep, dramatic, cinematic
const ELEVEN_LABS_API_URL = 'https://api.elevenlabs.io/v1/text-to-speech'

// Popular cinematic voices from ElevenLabs (for quotes):
// - TxGEqnHWrfWFTfGW9XjX: Josh (deep, male, dramatic) - BEST for cinematic quotes
// - ErXwobaYiN019PkySvjV: Antoni (deep, male, cinematic)
// - pNInz6obpgDQGcFmaJgB: Adam (deep, male, clear)
// - VR6AewLTigWG4xSOukaG: Arnold (deep, male, powerful)
// - pMsXgVXv3BLzUgSXRplE: Sam (male, neutral, clear)

let currentAudio = null

/**
 * Check if ElevenLabs is available and configured
 */
export function isElevenLabsAvailable() {
  const hasKey = !!ELEVEN_LABS_API_KEY
  // Only log in development and if there's an issue
  if (import.meta.env.DEV && !hasKey) {
    console.log('ElevenLabs API Key Check: Key not found')
  }
  return hasKey
}

/**
 * Get available voices from ElevenLabs
 */
export async function getElevenLabsVoices() {
  if (!ELEVEN_LABS_API_KEY) {
    throw new Error('ElevenLabs API key not configured')
  }

  try {
    const response = await fetch('https://api.elevenlabs.io/v1/voices', {
      method: 'GET',
      headers: {
        'xi-api-key': ELEVEN_LABS_API_KEY,
      },
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      const errorMsg = errorData.detail?.message || ''
      // If API key doesn't have voices_read permission, fall back to hardcoded voices
      if (response.status === 401 && errorMsg.includes('voices_read')) {
        console.warn('ElevenLabs API key missing voices_read permission. Using hardcoded cinematic voices.')
        return getCinematicVoices()
      }
      throw new Error(
        `Failed to fetch voices: ${response.status} ${response.statusText}. ${errorMsg}`
      )
    }

    const data = await response.json()
    return data.voices || []
  } catch (error) {
    console.error('Error fetching ElevenLabs voices:', error)
    throw error
  }
}

/**
 * Convert text to speech using ElevenLabs API
 * @param {string} text - Text to convert to speech
 * @param {string} voiceId - Voice ID to use (optional, uses default if not provided)
 * @param {object} options - Additional options (stability, similarity_boost, etc.)
 * @returns {Promise<Blob>} - Audio blob
 */
export async function textToSpeechElevenLabs(
  text,
  voiceId = ELEVEN_LABS_VOICE_ID,
  options = {}
) {
  if (!ELEVEN_LABS_API_KEY) {
    throw new Error('ElevenLabs API key not configured. Please add VITE_ELEVEN_LABS_API_KEY to your .env file')
  }

  const {
    stability = 0.5,
    similarity_boost = 0.75,
    style = 0.0,
    use_speaker_boost = true,
  } = options

  try {
    const response = await fetch(`${ELEVEN_LABS_API_URL}/${voiceId}`, {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': ELEVEN_LABS_API_KEY,
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2', // Free tier compatible model
        voice_settings: {
          stability,
          similarity_boost,
          style,
          use_speaker_boost,
        },
      }),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(
        `ElevenLabs API error: ${response.status} ${response.statusText}. ${errorData.detail?.message || errorData.message || ''}`
      )
    }

    const audioBlob = await response.blob()
    return audioBlob
  } catch (error) {
    console.error('Error with ElevenLabs TTS:', error)
    throw error
  }
}

/**
 * Play audio blob using HTML5 Audio API
 * @param {Blob} audioBlob - Audio blob to play
 * @param {Function} onEnd - Callback when playback ends
 * @param {Function} onError - Callback when error occurs
 * @returns {HTMLAudioElement} - Audio element
 */
export function playAudioBlob(audioBlob, onEnd, onError) {
  // Stop any currently playing audio
  if (currentAudio) {
    currentAudio.pause()
    currentAudio.currentTime = 0
    URL.revokeObjectURL(currentAudio.src)
  }

  const audioUrl = URL.createObjectURL(audioBlob)
  const audio = new Audio(audioUrl)
  currentAudio = audio

  audio.addEventListener('ended', () => {
    URL.revokeObjectURL(audioUrl)
    currentAudio = null
    onEnd?.()
  })

  audio.addEventListener('error', (event) => {
    URL.revokeObjectURL(audioUrl)
    currentAudio = null
    onError?.(event.error || new Error('Audio playback error'))
  })

  audio.play().catch((error) => {
    URL.revokeObjectURL(audioUrl)
    currentAudio = null
    onError?.(error)
  })

  return audio
}

/**
 * Pause current audio playback
 */
export function pauseElevenLabsAudio() {
  if (currentAudio && !currentAudio.paused) {
    currentAudio.pause()
    return true
  }
  return false
}

/**
 * Resume current audio playback
 */
export function resumeElevenLabsAudio() {
  if (currentAudio && currentAudio.paused) {
    currentAudio.play().catch((error) => {
      console.error('Error resuming audio:', error)
    })
    return true
  }
  return false
}

/**
 * Stop current audio playback
 */
export function stopElevenLabsAudio() {
  if (currentAudio) {
    currentAudio.pause()
    currentAudio.currentTime = 0
    URL.revokeObjectURL(currentAudio.src)
    currentAudio = null
    return true
  }
  return false
}

/**
 * Check if audio is currently playing
 */
export function isElevenLabsPlaying() {
  return currentAudio && !currentAudio.paused && !currentAudio.ended
}

/**
 * Check if audio is currently paused
 */
export function isElevenLabsPaused() {
  return currentAudio && currentAudio.paused && !currentAudio.ended
}

/**
 * Get recommended cinematic voices for quotes
 */
export function getCinematicVoices() {
  return [
    { id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh', description: 'Deep, male, dramatic - Best for cinematic quotes' },
    { id: 'ErXwobaYiN019PkySvjV', name: 'Antoni', description: 'Deep, male, cinematic' },
    { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam', description: 'Deep, male, clear' },
    { id: 'VR6AewLTigWG4xSOukaG', name: 'Arnold', description: 'Deep, male, powerful' },
    { id: 'pMsXgVXv3BLzUgSXRplE', name: 'Sam', description: 'Male, neutral, clear' },
  ]
}

/**
 * Speak text using ElevenLabs (main function)
 */
export async function speakQuoteElevenLabs(text, onEnd, onError, voiceId = ELEVEN_LABS_VOICE_ID) {
  try {
    // Generate audio using ElevenLabs
    const audioBlob = await textToSpeechElevenLabs(text, voiceId, {
      stability: 0.5, // Balanced stability
      similarity_boost: 0.75, // High similarity to voice
      style: 0.0, // Neutral style
      use_speaker_boost: true, // Enhance voice quality
    })

    // Play the audio
    const audio = playAudioBlob(audioBlob, onEnd, onError)
    return audio
  } catch (error) {
    console.error('Error speaking with ElevenLabs:', error)
    onError?.(error)
    throw error
  }
}
