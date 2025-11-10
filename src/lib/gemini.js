import { GoogleGenerativeAI } from '@google/generative-ai'

const apiKey = import.meta.env.VITE_GEMINI_API_KEY

if (!apiKey) {
  throw new Error('Missing Gemini API key')
}

const genAI = new GoogleGenerativeAI(apiKey)
// Using gemini-2.5-flash per latest request, with 1.5 as a fallback if the model is overloaded
const primaryModel = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })
const fallbackModel = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })
const overloadPattern = /overloaded|503|service unavailable/i

async function generateContentWithRetry(prompt, attempts = 3) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await primaryModel.generateContent(prompt)
    } catch (error) {
      lastError = error
      const message = error?.message ?? ''
      if (
        attempt < attempts &&
        overloadPattern.test(message)
      ) {
        const waitMs = 1000 * attempt
        console.warn(
          `Gemini request overloaded (attempt ${attempt}/${attempts}). Retrying in ${waitMs}ms...`
        )
        await new Promise((resolve) => setTimeout(resolve, waitMs))
        continue
      }
      break
    }
  }

  const fallbackMessage = lastError?.message ?? ''
  if (overloadPattern.test(fallbackMessage)) {
    console.warn('Gemini 2.5 is overloaded after retries. Falling back to gemini-1.5-flash.')
    return fallbackModel.generateContent(prompt)
  }

  throw lastError
}

export { primaryModel as model }

function chunkText(text, chunkSize) {
  const chunks = []
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize))
  }
  return chunks
}

// Parse script and extract quotes with significance scores
export async function parseScript(scriptText, movieTitle) {
  const MAX_CHUNK_SIZE = 12000
  const chunks = chunkText(scriptText, MAX_CHUNK_SIZE)
  const allQuotes = []

  for (let index = 0; index < chunks.length; index += 1) {
    const chunkPrompt = `You are a movie script parser. This is part ${index + 1} of ${chunks.length} of the script for "${movieTitle}".
Analyze only this part and extract every line of dialogue. Return a JSON array in this exact format:

[
  {
    "character": "CHARACTER_NAME",
    "quote": "The dialogue line.",
    "significance": 7
  },
  ...
]

Rules:
1. Extract ALL dialogue lines, not just important ones
2. For "significance", score each quote from 1-10 based on how memorable, thematic, or impactful it is to the story
3. Remove stage directions and action lines - only include dialogue
4. Character names should be clean (no extra formatting)
5. Return ONLY valid JSON, no markdown or extra text
6. If a character name is unclear, use "UNKNOWN"

Script part:
${chunks[index]}`

    try {
      const result = await generateContentWithRetry(chunkPrompt)
      const response = await result.response
      const text = response.text()

      // Clean the response to extract JSON
      const jsonMatch = text.match(/\[[\s\S]*\]/)
      if (!jsonMatch) {
        throw new Error('No JSON found in response')
      }

      const quotes = JSON.parse(jsonMatch[0])
      allQuotes.push(...quotes)
    } catch (error) {
      console.error(`Error parsing script chunk ${index + 1}:`, error)
      throw error
    }
  }

  return allQuotes
}

// Get quote context
export async function getQuoteContext(quote, scriptText) {
  const prompt = `Find this quote in the script: "${quote}"

Return the 2-3 lines of dialogue or action that came immediately before this quote. Format as a simple text response, no JSON.`

  try {
    const result = await generateContentWithRetry(prompt + '\n\nScript:\n' + scriptText)
    const response = await result.response
    return response.text()
  } catch (error) {
    console.error('Error getting context:', error)
    throw error
  }
}

// Thematic search
export async function searchThemes(theme, scripts) {
  const prompt = `Search through these movie scripts and find up to 5 quotes related to the theme of "${theme}".

Return a JSON array in this format:
[
  {
    "character": "CHARACTER_NAME",
    "quote": "The quote",
    "movie": "Movie Title"
  },
  ...
]

Scripts:
${scripts.map(s => `Movie: ${s.title}\n${s.text}`).join('\n\n---\n\n')}`

  try {
    const result = await generateContentWithRetry(prompt)
    const response = await result.response
    const text = response.text()
    
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (!jsonMatch) {
      throw new Error('No JSON found in response')
    }
    
    return JSON.parse(jsonMatch[0])
  } catch (error) {
    console.error('Error searching themes:', error)
    throw error
  }
}

// Character analysis
export async function analyzeCharacter(characterName, movieTitle, scriptText) {
  const prompt = `Analyze all of ${characterName}'s lines from "${movieTitle}" and provide a brief summary (2-3 sentences) of their personality, motivations, and role in the story.

Script:
${scriptText}`

  try {
    const result = await generateContentWithRetry(prompt)
    const response = await result.response
    return response.text()
  } catch (error) {
    console.error('Error analyzing character:', error)
    throw error
  }
}

