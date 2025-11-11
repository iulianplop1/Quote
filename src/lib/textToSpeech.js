// Text-to-Speech utility for reading quotes with a cinematic voice
// Supports both ElevenLabs API (premium) and browser TTS (fallback)

import { 
  isElevenLabsAvailable, 
  speakQuoteElevenLabs, 
  pauseElevenLabsAudio, 
  resumeElevenLabsAudio, 
  stopElevenLabsAudio,
  isElevenLabsPlaying,
  isElevenLabsPaused,
  ELEVEN_LABS_VOICE_ID,
  getElevenLabsVoices,
  getCinematicVoices,
} from './elevenLabsTTS'

let synthesis = null
let currentUtterance = null
let selectedVoice = null
let useElevenLabs = false
let currentAudio = null

// Settings for TTS
let ttsSettings = {
  voiceId: null, // For ElevenLabs
  browserVoice: null, // For browser TTS
  speed: 0.65, // Speech rate (0.1 to 10)
  useElevenLabs: null, // Auto-detect or force
}

// Queue for continuous playback
let quoteQueue = []
let isPlayingQueue = false
let currentQueueIndex = 0

// Set TTS settings (voice, speed, etc.)
export function setTTSSettings(settings) {
  if (settings.voiceId !== undefined) ttsSettings.voiceId = settings.voiceId
  if (settings.browserVoice !== undefined) ttsSettings.browserVoice = settings.browserVoice
  if (settings.speed !== undefined) ttsSettings.speed = Math.max(0.1, Math.min(10, settings.speed))
  if (settings.useElevenLabs !== undefined) ttsSettings.useElevenLabs = settings.useElevenLabs
}

// Get current TTS settings
export function getTTSSettings() {
  return { ...ttsSettings }
}

// Initialize speech synthesis and find the best voice
export function initializeSpeechSynthesis() {
  // Check if ElevenLabs is available and prefer it (unless overridden)
  if (ttsSettings.useElevenLabs === null) {
    useElevenLabs = isElevenLabsAvailable()
  } else {
    useElevenLabs = ttsSettings.useElevenLabs && isElevenLabsAvailable()
  }
  
  if (useElevenLabs) {
    console.log('ElevenLabs TTS available - using premium voices')
    return true
  }

  // Fallback to browser TTS
  if (typeof window === 'undefined' || !window.speechSynthesis) {
    return false
  }

  synthesis = window.speechSynthesis

  // Wait for voices to load
  const loadVoices = () => {
    const voices = synthesis.getVoices()
    
    if (voices.length === 0) {
      return false
    }

    // Use selected browser voice if set, otherwise find best voice
    if (ttsSettings.browserVoice) {
      const voice = voices.find(v => v.name === ttsSettings.browserVoice || v.voiceURI === ttsSettings.browserVoice)
      if (voice) {
        selectedVoice = voice
        console.log('Using selected browser voice:', voice.name)
        return true
      }
    }

    // Prefer natural-sounding, less robotic voices
    // Neural/Enhanced voices sound more natural (Chrome/Edge)
    // macOS voices like Alex, Daniel, etc. are also good
    const preferredVoices = [
      // Neural voices (most natural, less robotic)
      'Google US English (Neural)',
      'Microsoft Mark - English (United States)',
      'Microsoft Aria - English (United States)',
      'Microsoft Jenny - English (United States)',
      
      // Enhanced/Neural voices
      'en-US-Neural2',
      'en-US-Journey',
      'en-US-Wavenet',
      
      // macOS natural voices
      'Alex', // Very natural, deep
      'Daniel', // Natural, clear
      'Fred', // Deep, natural
      'Tom', // Natural male voice
      
      // Windows natural voices
      'Microsoft David Desktop',
      'Microsoft Mark Desktop',
      
      // Fallback to any enhanced/neural voice
      ...voices.filter(v => 
        v.name.toLowerCase().includes('neural') ||
        v.name.toLowerCase().includes('enhanced') ||
        v.name.toLowerCase().includes('wavenet') ||
        v.name.toLowerCase().includes('journey')
      ).map(v => v.name)
    ]

    // First, try to find neural/enhanced voices (most natural)
    for (const preferred of preferredVoices) {
      const voice = voices.find(v => 
        v.name.toLowerCase().includes(preferred.toLowerCase()) ||
        (preferred.toLowerCase().includes('neural') && v.name.toLowerCase().includes('neural')) ||
        (preferred.toLowerCase().includes('wavenet') && v.name.toLowerCase().includes('wavenet'))
      )
      if (voice) {
        selectedVoice = voice
        console.log('Selected voice:', voice.name)
        return true
      }
    }

    // Try to find voices that sound less robotic (prefer local voices over remote)
    // Local voices often sound more natural
    const localVoices = voices.filter(v => v.localService === true)
    if (localVoices.length > 0) {
      // Prefer male/local voices
      const naturalVoice = localVoices.find(v => {
        const name = v.name.toLowerCase()
        return name.includes('alex') || 
               name.includes('daniel') ||
               name.includes('fred') ||
               name.includes('tom') ||
               name.includes('david') ||
               name.includes('mark')
      }) || localVoices[0]
      
      if (naturalVoice) {
        selectedVoice = naturalVoice
        console.log('Selected local voice:', naturalVoice.name)
        return true
      }
    }

    // Fallback: find any voice that's not obviously robotic
    // Avoid "Microsoft Zira" and "Microsoft Hazel" which can sound robotic
    const nonRoboticVoices = voices.filter(v => {
      const name = v.name.toLowerCase()
      return !name.includes('zira') && 
             !name.includes('hazel') &&
             !name.includes('robotic')
    })

    if (nonRoboticVoices.length > 0) {
      selectedVoice = nonRoboticVoices[0]
      console.log('Selected fallback voice:', selectedVoice.name)
      return true
    }

    // Last resort: use any available voice
    selectedVoice = voices[0]
    console.log('Using default voice:', selectedVoice.name)
    return true
  }

  // Load voices (may need to wait)
  if (synthesis.getVoices().length > 0) {
    return loadVoices()
  }

  // Voices might not be loaded yet - wait for them
  const checkVoices = () => {
    if (synthesis.getVoices().length > 0) {
      loadVoices()
    }
  }
  
  synthesis.addEventListener('voiceschanged', checkVoices, { once: true })
  
  // Also try immediately in case voices are already loaded
  return loadVoices()
}

// Speak text with cinematic voice
export async function speakQuote(text, onEnd, onError) {
  // Initialize if needed - check ElevenLabs availability first
  if (!useElevenLabs) {
    initializeSpeechSynthesis()
  }

  // Stop any current speech
  stopSpeaking()

  // Use ElevenLabs if available (much better quality)
  if (useElevenLabs) {
    try {
      const voiceId = ttsSettings.voiceId || ELEVEN_LABS_VOICE_ID
      currentAudio = await speakQuoteElevenLabs(text, onEnd, onError, voiceId)
      // Apply speed to audio if available
      if (currentAudio && ttsSettings.speed !== 0.65) {
        currentAudio.playbackRate = ttsSettings.speed / 0.65 // Normalize to default speed
      }
      return currentAudio
    } catch (error) {
      // If ElevenLabs fails, fall back to browser TTS
      console.warn('ElevenLabs failed, falling back to browser TTS:', error)
      useElevenLabs = false
      // Continue to browser TTS fallback below
    }
  }

  // Fallback to browser TTS
  if (!synthesis) {
    if (!initializeSpeechSynthesis()) {
      onError?.('Speech synthesis not available')
      return null
    }
  }

  // Double-check synthesis is available before using it
  if (!synthesis || typeof window === 'undefined' || !window.speechSynthesis) {
    onError?.('Speech synthesis not available')
    return null
  }

  // Create utterance
  currentUtterance = new SpeechSynthesisUtterance(text)
  
  // Configure voice
  if (selectedVoice) {
    currentUtterance.voice = selectedVoice
  }

  // Configure speech parameters for natural, cinematic voice
  // Use speed from settings
  currentUtterance.rate = ttsSettings.speed || 0.65
  // Moderate pitch - not too low (avoids robotic sound), not too high
  currentUtterance.pitch = 0.85 // Higher than before (0.7) to sound more natural
  currentUtterance.volume = 1.0 // Maximum volume
  currentUtterance.lang = 'en-US'

  // Event handlers
  currentUtterance.onend = () => {
    currentUtterance = null
    onEnd?.()
  }

  currentUtterance.onerror = (event) => {
    console.error('Speech synthesis error:', event)
    currentUtterance = null
    onError?.(event.error)
  }

  // Speak
  synthesis.speak(currentUtterance)

  return currentUtterance
}

// Pause speaking
export function pauseSpeaking() {
  if (useElevenLabs && currentAudio) {
    return pauseElevenLabsAudio()
  }
  
  if (synthesis && synthesis.speaking) {
    synthesis.pause()
    return true
  }
  return false
}

// Resume speaking
export function resumeSpeaking() {
  if (useElevenLabs && currentAudio) {
    return resumeElevenLabsAudio()
  }
  
  if (synthesis && synthesis.paused) {
    synthesis.resume()
    return true
  }
  return false
}

// Stop speaking
export function stopSpeaking() {
  if (useElevenLabs && currentAudio) {
    stopElevenLabsAudio()
    currentAudio = null
    return
  }
  
  if (synthesis) {
    synthesis.cancel()
  }
  currentUtterance = null
}

// Check if currently speaking
export function isSpeaking() {
  if (useElevenLabs && currentAudio) {
    return isElevenLabsPlaying()
  }
  
  return synthesis ? synthesis.speaking : false
}

// Check if currently paused
export function isPaused() {
  if (useElevenLabs && currentAudio) {
    return isElevenLabsPaused()
  }
  
  return synthesis ? synthesis.paused : false
}

// Get available voices (for debugging)
export function getAvailableVoices() {
  if (!synthesis) {
    initializeSpeechSynthesis()
  }
  return synthesis ? synthesis.getVoices() : []
}

// Queue functions for continuous playback
export function addQuotesToQueue(quotes) {
  quoteQueue = [...quoteQueue, ...quotes]
}

export function clearQueue() {
  quoteQueue = []
  isPlayingQueue = false
  currentQueueIndex = 0
}

export function getQueueLength() {
  return quoteQueue.length
}

export function isQueuePlaying() {
  return isPlayingQueue
}

// Play all quotes in queue continuously
export async function playQuoteQueue(onProgress, onComplete, onError) {
  if (quoteQueue.length === 0) {
    onComplete?.()
    return
  }

  isPlayingQueue = true
  currentQueueIndex = 0

  const playNext = async () => {
    if (!isPlayingQueue || currentQueueIndex >= quoteQueue.length) {
      isPlayingQueue = false
      quoteQueue = []
      currentQueueIndex = 0
      onComplete?.()
      return
    }

    const quote = quoteQueue[currentQueueIndex]
    const quoteText = typeof quote === 'string' ? quote : `"${quote.quote}"${quote.character ? ` by ${quote.character}` : ''}`
    
    onProgress?.(currentQueueIndex + 1, quoteQueue.length, quote)

    try {
      await speakQuote(
        quoteText,
        () => {
          // On end, play next quote
          currentQueueIndex++
          playNext()
        },
        (error) => {
          // On error, continue with next quote
          console.error('Error playing quote in queue:', error)
          currentQueueIndex++
          playNext()
        }
      )
    } catch (error) {
      console.error('Error starting quote in queue:', error)
      currentQueueIndex++
      playNext()
    }
  }

  playNext()
}

export function stopQueue() {
  isPlayingQueue = false
  stopSpeaking()
  clearQueue()
}

// Export voice-related functions
export { getElevenLabsVoices, getCinematicVoices, isElevenLabsAvailable }

