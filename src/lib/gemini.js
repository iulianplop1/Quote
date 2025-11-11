import { GoogleGenerativeAI } from '@google/generative-ai'

const apiKey = import.meta.env.VITE_GEMINI_API_KEY

if (!apiKey) {
  throw new Error('Missing Gemini API key')
}

const genAI = new GoogleGenerativeAI(apiKey)
// Using gemini-2.5-flash per latest request, with 1.5-flash as a fallback if the model is overloaded
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
    try {
      return await fallbackModel.generateContent(prompt)
    } catch (fallbackError) {
      console.error('Fallback model also failed:', fallbackError)
      throw lastError // Throw original error instead of fallback error
    }
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
export async function parseScript(scriptText, movieTitle, onProgress) {
  // Increased chunk size to reduce API calls and improve speed
  const MAX_CHUNK_SIZE = 20000
  const chunks = chunkText(scriptText, MAX_CHUNK_SIZE)
  const allQuotes = []
  const PARALLEL_CHUNKS = 3 // Process up to 3 chunks in parallel for speed

  // Process chunks in batches for better performance
  for (let batchStart = 0; batchStart < chunks.length; batchStart += PARALLEL_CHUNKS) {
    const batchEnd = Math.min(batchStart + PARALLEL_CHUNKS, chunks.length)
    const batchPromises = []

    for (let index = batchStart; index < batchEnd; index += 1) {
      const chunkPrompt = `You are a movie script parser specializing in identifying iconic, cinematic, and deeply meaningful quotes. This is part ${index + 1} of ${chunks.length} of the script for "${movieTitle}".

Extract ONLY the most epic, memorable, and profound dialogue lines. Return a JSON array in this exact format:

[
  {
    "character": "CHARACTER_NAME",
    "quote": "The dialogue line.",
    "significance": 9
  },
  ...
]

CRITICAL RULES FOR QUALITY:
1. ONLY extract quotes that are:
   - Iconic and memorable (people would remember and quote them)
   - Deeply meaningful, philosophical, or thought-provoking
   - Cinematic and epic in tone
   - Thematically significant to the story
   - Poetic, metaphorical, or profound

2. SKIP generic quotes like:
   - Commands or instructions ("Give them over", "Hang them", "Go there")
   - Simple statements of fact ("He's gone", "It's over")
   - Filler dialogue ("Yes", "No", "Okay", "What?", "Hello")
   - Casual conversation or small talk
   - Exposition that's not profound
   - Action-oriented dialogue without deeper meaning

3. Significance scoring (1-10):
   - 9-10: Iconic, legendary quotes that define the movie (e.g., "You merely adopted the dark. I was born in it.")
   - 7-8: Deeply meaningful, memorable quotes with philosophical weight
   - 5-6: Significant quotes with some depth
   - 1-4: Skip these - don't include quotes below 7

4. Focus on quotes that:
   - Have metaphorical or symbolic meaning
   - Reveal character philosophy or worldview
   - Make profound statements about life, humanity, or themes
   - Are poetic, quotable, or memorable
   - Have emotional depth and resonance

5. Quality over quantity: Only extract 5-15 of the BEST quotes per chunk. Better to have fewer exceptional quotes than many mediocre ones.

6. Remove stage directions and action lines - only include dialogue
7. Character names should be clean (no extra formatting)
8. Return ONLY valid JSON, no markdown or extra text
9. If a character name is unclear, use "UNKNOWN"

Examples of GOOD quotes to extract:
- "You merely adopted the dark. I was born in it, molded by it."
- "Perception of reality is more real than reality itself."
- "Why do we fall? So we can learn to pick ourselves up."

Examples of BAD quotes to SKIP:
- "Give them over for judgement."
- "Hang them where the world will see."
- "He's coming this way."
- "What do you want?"

Script part:
${chunks[index]}`

      // Create a promise for this chunk
      const chunkPromise = (async () => {
        try {
          if (onProgress) {
            onProgress(index + 1, chunks.length)
          }

          const result = await generateContentWithRetry(chunkPrompt)
          const response = await result.response
          const text = response.text()

          // Clean the response to extract JSON
          let jsonMatch = text.match(/\[[\s\S]*\]/)
          if (!jsonMatch) {
            // Try to find JSON even if it's wrapped in markdown code blocks
            jsonMatch = text.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/)
            if (jsonMatch) {
              jsonMatch = [jsonMatch[1], jsonMatch[1]]
            }
          }
          
          if (!jsonMatch) {
            throw new Error('No JSON found in response')
          }

          let jsonText = jsonMatch[0]
          
          // Clean up common JSON issues
          // Remove trailing commas before closing brackets/braces
          jsonText = jsonText.replace(/,(\s*[}\]])/g, '$1')
          // Fix unescaped quotes in strings (basic attempt)
          jsonText = jsonText.replace(/"([^"]*)":\s*"([^"]*)"([^,}\]]*)"([^,}\]]*)/g, (match, key, val, rest) => {
            // If there's an unescaped quote, escape it
            if (rest.includes('"') && !rest.includes('\\"')) {
              return `"${key}": "${val}"${rest.replace(/"/g, '\\"')}`
            }
            return match
          })

          let quotes
          try {
            quotes = JSON.parse(jsonText)
          } catch (parseError) {
            // If parsing still fails, try to extract valid objects manually
            console.warn(`JSON parse failed for chunk ${index + 1}, attempting manual extraction:`, parseError)
            const objectMatches = jsonText.match(/\{[^}]*"character"[^}]*"quote"[^}]*"significance"[^}]*\}/g)
            if (objectMatches && objectMatches.length > 0) {
              quotes = objectMatches.map(match => {
                try {
                  return JSON.parse(match)
                } catch {
                  // Extract fields manually as last resort
                  const charMatch = match.match(/"character"\s*:\s*"([^"]+)"/)
                  const quoteMatch = match.match(/"quote"\s*:\s*"([^"]+)"/)
                  const sigMatch = match.match(/"significance"\s*:\s*(\d+)/)
                  if (charMatch && quoteMatch && sigMatch) {
                    return {
                      character: charMatch[1],
                      quote: quoteMatch[1],
                      significance: parseInt(sigMatch[1], 10) || 5
                    }
                  }
                  return null
                }
              }).filter(Boolean)
            } else {
              throw new Error(`Failed to parse JSON: ${parseError.message}`)
            }
          }

          if (!Array.isArray(quotes)) {
            throw new Error('Parsed JSON is not an array')
          }

          return quotes
        } catch (error) {
          console.error(`Error parsing script chunk ${index + 1}:`, error)
          // Return empty array instead of throwing to allow other chunks to complete
          return []
        }
      })()

      batchPromises.push(chunkPromise)
    }

    // Wait for all chunks in this batch to complete
    const batchResults = await Promise.all(batchPromises)
    batchResults.forEach(quotes => {
      if (Array.isArray(quotes)) {
        allQuotes.push(...quotes)
      }
    })
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
  const prompt = `You are searching for the most iconic, profound, and deeply meaningful quotes related to the theme of "${theme}" from these movie scripts.

Find up to 10 quotes that are:
- Epic, cinematic, and memorable
- Deeply meaningful and thought-provoking
- Thematically relevant to "${theme}"
- Iconic quotes that people would remember and quote
- Philosophically profound or poetically resonant

Return a JSON array in this exact format:
[
  {
    "character": "CHARACTER_NAME",
    "quote": "The quote",
    "movie": "Movie Title"
  },
  ...
]

CRITICAL RULES:
1. ONLY include quotes that are:
   - Iconic and quotable (memorable, epic, cinematic)
   - Deeply meaningful, philosophical, or profound
   - Thematically relevant to "${theme}"
   - Poetic, metaphorical, or thought-provoking
   - Have emotional depth and resonance

2. SKIP generic quotes like:
   - Commands or instructions
   - Simple statements of fact
   - Filler dialogue or casual conversation
   - Action-oriented dialogue without deeper meaning
   - Quotes that mention the theme but aren't profound

3. Prioritize quality over quantity - only the BEST quotes
4. Return ONLY valid JSON, no markdown or extra text
5. Character names should be clean (no extra formatting)
6. If a character name is unclear, use "UNKNOWN"

Examples of GOOD quotes for theme "darkness":
- "You merely adopted the dark. I was born in it, molded by it."
- "The night is darkest just before the dawn."

Examples of BAD quotes to SKIP:
- "It's dark in here."
- "Turn on the lights."
- "I don't like the darkness."

Scripts:
${scripts.map(s => `Movie: ${s.title}\n${s.text?.substring(0, 50000) || ''}`).join('\n\n---\n\n')}`

  try {
    const result = await generateContentWithRetry(prompt)
    const response = await result.response
    const text = response.text()
    
    // Clean the response to extract JSON (similar to parseScript)
    let jsonMatch = text.match(/\[[\s\S]*\]/)
    if (!jsonMatch) {
      // Try to find JSON even if it's wrapped in markdown code blocks
      jsonMatch = text.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/)
      if (jsonMatch) {
        jsonMatch = [jsonMatch[1], jsonMatch[1]]
      }
    }
    
    if (!jsonMatch) {
      console.error('No JSON found in response. Response text:', text.substring(0, 500))
      throw new Error('No JSON found in response. The AI may not have returned valid JSON.')
    }
    
    let jsonText = jsonMatch[0]
    
    // Clean up common JSON issues
    // Remove trailing commas before closing brackets/braces
    jsonText = jsonText.replace(/,(\s*[}\]])/g, '$1')
    
    let quotes
    try {
      quotes = JSON.parse(jsonText)
    } catch (parseError) {
      // If parsing still fails, try to extract valid objects manually
      console.warn('JSON parse failed, attempting manual extraction:', parseError)
      const objectMatches = jsonText.match(/\{[^}]*"character"[^}]*"quote"[^}]*"movie"[^}]*\}/g)
      if (objectMatches && objectMatches.length > 0) {
        quotes = objectMatches.map(match => {
          try {
            return JSON.parse(match)
          } catch {
            // Extract fields manually as last resort
            const charMatch = match.match(/"character"\s*:\s*"([^"]+)"/)
            const quoteMatch = match.match(/"quote"\s*:\s*"([^"]+)"/)
            const movieMatch = match.match(/"movie"\s*:\s*"([^"]+)"/)
            if (charMatch && quoteMatch && movieMatch) {
              return {
                character: charMatch[1],
                quote: quoteMatch[1],
                movie: movieMatch[1]
              }
            }
            return null
          }
        }).filter(Boolean)
      } else {
        throw new Error(`Failed to parse JSON: ${parseError.message}`)
      }
    }

    if (!Array.isArray(quotes)) {
      throw new Error('Parsed JSON is not an array')
    }
    
    return quotes
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

