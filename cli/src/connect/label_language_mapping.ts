/**
 * Default Code Connect labels for native parsers
 */
export enum CodeConnectLabel {
  React = 'React',
  Storybook = 'Storybook',
  SwiftUI = 'SwiftUI',
  Compose = 'Compose',
  WebComponents = 'Web Components',
  HTML = 'HTML',
  Vue = 'Vue',
  Angular = 'Angular',
  Code = 'Code', // Default/fallback label
}

/**
 * Supported Code Connect languages for syntax highlighting and formatting
 */
export enum CodeConnectLanguage {
  TypeScript = 'typescript',
  Swift = 'swift',
  Kotlin = 'kotlin',
  HTML = 'html',
  Raw = 'raw', // Fallback for unknown languages
}

/**
 * Maps Code Connect labels to their corresponding language for syntax highlighting.
 * This is used for raw template files to infer the correct language.
 */
const LABEL_TO_LANGUAGE_MAP: Record<CodeConnectLabel, CodeConnectLanguage> = {
  [CodeConnectLabel.React]: CodeConnectLanguage.TypeScript,
  [CodeConnectLabel.Storybook]: CodeConnectLanguage.TypeScript,
  [CodeConnectLabel.SwiftUI]: CodeConnectLanguage.Swift,
  [CodeConnectLabel.Compose]: CodeConnectLanguage.Kotlin,
  [CodeConnectLabel.WebComponents]: CodeConnectLanguage.HTML,
  [CodeConnectLabel.HTML]: CodeConnectLanguage.HTML,
  [CodeConnectLabel.Vue]: CodeConnectLanguage.TypeScript,
  [CodeConnectLabel.Angular]: CodeConnectLanguage.TypeScript,
  [CodeConnectLabel.Code]: CodeConnectLanguage.Raw,
}

/**
 * Infers the appropriate language for a raw template file based on its label.
 * Falls back to 'raw' if the label is not recognized.
 *
 * @param label - The label associated with the Code Connect file
 * @returns The corresponding language identifier for syntax highlighting
 */
export function getInferredLanguageForRaw(label: string): string {
  // Try to match against known labels (enum values)
  const knownLabel = Object.values(CodeConnectLabel).find((enumLabel) => enumLabel === label)

  if (knownLabel) {
    return LABEL_TO_LANGUAGE_MAP[knownLabel as CodeConnectLabel]
  }

  // Fallback to raw for unknown labels
  return CodeConnectLanguage.Raw
}
