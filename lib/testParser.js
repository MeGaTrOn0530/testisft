/**
 * Parse test questions from a text file
 * Format:
 * # Question text
 * + Correct answer
 * - Incorrect answer
 * - Incorrect answer
 * - Incorrect answer
 *
 * For questions with images:
 * # Question text
 * @image.jpg
 * + Correct answer
 * - Incorrect answer
 *
 * For questions with multiple correct answers:
 * # Question text
 * + Correct answer 1
 * - Incorrect answer
 * + Correct answer 2
 * - Incorrect answer
 */
function parseTestFile(fileContent) {
    const lines = fileContent.split("\n").map((line) => line.trim())
    const questions = []
  
    let currentQuestion = null
  
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
  
      // Skip empty lines
      if (!line) continue
  
      // New question
      if (line.startsWith("#")) {
        // Save previous question if exists
        if (currentQuestion) {
          questions.push(currentQuestion)
        }
  
        // Create new question
        currentQuestion = {
          text: line.substring(1).trim(),
          type: "multiple-choice",
          options: [],
          image: null,
        }
      }
      // Image for question
      else if (line.startsWith("@") && currentQuestion) {
        currentQuestion.image = line.substring(1).trim()
      }
      // Answer options
      else if ((line.startsWith("+") || line.startsWith("-")) && currentQuestion) {
        const isCorrect = line.startsWith("+")
        const text = line.substring(1).trim()
  
        currentQuestion.options.push({
          id: `option-${Date.now()}-${currentQuestion.options.length}`,
          text: text,
          correct: isCorrect,
        })
      }
    }
  
    // Add the last question
    if (currentQuestion) {
      questions.push(currentQuestion)
    }
  
    return questions
  }
  
  /**
   * Select a random subset of questions from a larger pool
   */
  function selectRandomQuestions(questions, count) {
    // If count is greater than available questions, return all questions
    if (count >= questions.length) {
      return [...questions]
    }
  
    // Shuffle and select the first 'count' questions
    return [...questions].sort(() => Math.random() - 0.5).slice(0, count)
  }
  
  module.exports = {
    parseTestFile,
    selectRandomQuestions,
  }
  