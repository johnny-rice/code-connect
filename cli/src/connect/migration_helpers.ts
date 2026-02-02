import fs from 'fs'
import path from 'path'
import * as prettier from 'prettier'
import { CodeConnectJSON } from '../connect/figma_connect'

export function writeTemplateFile(
  doc: CodeConnectJSON,
  outputDir: string | undefined,
  baseDir: string,
  localSourcePath?: string,
): { outputPath: string; skipped: boolean } {
  const suffix = '.figma.template.js'

  // Determine output filename
  let outputPath: string

  if (outputDir) {
    // Use specified output directory
    const filename = `${doc.component || 'template'}${suffix}`
    outputPath = path.join(outputDir, filename)
  } else if (localSourcePath) {
    // Use same directory as local source file
    const sourceDir = path.dirname(localSourcePath)
    const sourceBasename = path.basename(localSourcePath, path.extname(localSourcePath))
    const filename = `${sourceBasename}${suffix}`
    outputPath = path.join(sourceDir, filename)
  } else {
    // No source info, use current directory
    const filename = `${doc.component || 'template'}${suffix}`
    outputPath = path.join(baseDir, filename)
  }

  // Check if file exists and skip (always skip existing files)
  if (fs.existsSync(outputPath)) {
    return { outputPath, skipped: true }
  }

  let template = doc.template

  // Helpers have not been injected - replace reference with server-side versions
  template = migrateTemplateToUseServerSideHelpers(template)
  // V1 -> V2 codemods
  template = migrateV1TemplateToV2(template)
  // Add required id to template (set to TODO if no usable name)
  template = addId(template, doc.component || 'TODO')
  // Format for ease of use
  template = prettier.format(template, {
    parser: 'typescript',
    semi: false,
    trailingComma: 'all',
    // pluginSearchDirs: false is needed as otherwise prettier picks up other
    // prettier plugins in our monorepo and fails with race condition errors
    pluginSearchDirs: false,
  })

  // Create the template file content
  // Format: first line is the URL, rest is the template
  const fileContent = `// url=${doc.figmaNode}\n${template}`

  // Ensure output directory exists
  const outputDirPath = path.dirname(outputPath)
  if (!fs.existsSync(outputDirPath)) {
    fs.mkdirSync(outputDirPath, { recursive: true })
  }

  // Write the file
  fs.writeFileSync(outputPath, fileContent, 'utf-8')

  return { outputPath, skipped: false }
}

// Renames must match helpers in code_connect_js_api.raw_source.ts
export function migrateTemplateToUseServerSideHelpers(template: string) {
  return (
    template
      // React helpers
      .replace(/_fcc_renderReactProp/g, 'figma.helpers.react.renderProp')
      .replace(/_fcc_renderReactChildren/g, 'figma.helpers.react.renderChildren')
      .replace(/_fcc_jsxElement/g, 'figma.helpers.react.jsxElement')
      .replace(/_fcc_function/g, 'figma.helpers.react.function')
      .replace(/_fcc_identifier/g, 'figma.helpers.react.identifier')
      .replace(/_fcc_object/g, 'figma.helpers.react.object')
      .replace(/_fcc_templateString/g, 'figma.helpers.react.templateString')
      .replace(/_fcc_renderPropValue/g, 'figma.helpers.react.renderPropValue')
      .replace(/_fcc_stringifyObject/g, 'figma.helpers.react.stringifyObject')
      .replace(/_fcc_reactComponent/g, 'figma.helpers.react.reactComponent')
      .replace(/_fcc_array/g, 'figma.helpers.react.array')
      .replace(/isReactComponentArray/g, 'figma.helpers.react.isReactComponentArray')
      // Swift helpers
      .replace(/__fcc_renderSwiftChildren/g, 'figma.helpers.swift.renderChildren')
      // Kotlin/Compose helpers
      .replace(/__fcc_renderComposeChildren/g, 'figma.helpers.kotlin.renderChildren')
  )
}

export function addId(template: string, id: string): string {
  return template.replace(/export default \{/, `export default { id: '${id}',`)
}

/**
 * Migrates V1 templates to V2 API.
 *
 * This performs safe, incremental transformations. The following patterns
 * are intentionally NOT migrated as they're still supported in V2:
 *
 * - .__properties__.children() - no direct V2 equivalent, still supported
 * - __props metadata building pattern - still valid JavaScript
 * - __renderWithFn__() - complex transformation, still supported
 *
 * These may be addressed in future migrations.
 */
export const migrateV1TemplateToV2 = (template: string): string => {
  let migrated = template

  // 1. Core object rename
  migrated = migrated.replace(/figma\.currentLayer/g, 'figma.selectedInstance')

  // 2. Property accessor methods
  migrated = migrated.replace(/\.__properties__\.string\(/g, '.getString(')
  migrated = migrated.replace(/\.__properties__\.boolean\(/g, '.getBoolean(')
  migrated = migrated.replace(/\.__properties__\.enum\(/g, '.getEnum(')
  migrated = migrated.replace(/\.__properties__\.__instance__\(/g, '.getInstanceSwap(')
  // .__properties__.instance() auto-renders, so we need to add .executeTemplate().example
  migrated = migrated.replace(
    /\.__properties__\.instance\(([^)]+)\)/g,
    '.getInstanceSwap($1).executeTemplate().example',
  )

  // 3. Other method renames
  migrated = migrated.replace(/\.__getPropertyValue__\(/g, '.getPropertyValue(')

  // 4. __findChildWithCriteria__ - migrate based on type parameter
  // For TEXT type with __render__(): __findChildWithCriteria__({ name: 'X', type: "TEXT" }).__render__() → findText('X').textContent
  migrated = migrated.replace(
    /\.__findChildWithCriteria__\(\{\s*name:\s*'([^']+)',\s*type:\s*"TEXT"\s*\}\)\.__render__\(\)/g,
    ".findText('$1').textContent",
  )
  migrated = migrated.replace(
    /\.__findChildWithCriteria__\(\{\s*type:\s*"TEXT",\s*name:\s*'([^']+)'\s*\}\)\.__render__\(\)/g,
    ".findText('$1').textContent",
  )
  // For INSTANCE type: __findChildWithCriteria__({ type: 'INSTANCE', name: 'X' }) → findInstance('X')
  migrated = migrated.replace(
    /\.__findChildWithCriteria__\(\{\s*name:\s*'([^']+)',\s*type:\s*['"]INSTANCE['"]\s*\}\)/g,
    ".findInstance('$1')",
  )
  migrated = migrated.replace(
    /\.__findChildWithCriteria__\(\{\s*type:\s*['"]INSTANCE['"],\s*name:\s*'([^']+)'\s*\}\)/g,
    ".findInstance('$1')",
  )
  // For TEXT type without __render__(): __findChildWithCriteria__({ type: 'TEXT', name: 'X' }) → findText('X')
  migrated = migrated.replace(
    /\.__findChildWithCriteria__\(\{\s*name:\s*'([^']+)',\s*type:\s*['"]TEXT['"]\s*\}\)/g,
    ".findText('$1')",
  )
  migrated = migrated.replace(
    /\.__findChildWithCriteria__\(\{\s*type:\s*['"]TEXT['"],\s*name:\s*'([^']+)'\s*\}\)/g,
    ".findText('$1')",
  )

  // 5. __find__() - migrate to findInstance()
  migrated = migrated.replace(
    /\.__find__\(("([^"]+)"|'([^']+)')\)/g,
    (match, quote, doubleQuoted, singleQuoted) => {
      const name = doubleQuoted || singleQuoted
      return `.findInstance("${name}")`
    },
  )

  // 6. __render__() - migrate to executeTemplate().example (but not if part of __findChildWithCriteria__)
  migrated = migrated.replace(/\.__render__\(\)/g, '.executeTemplate().example')

  // 7. __getProps__() - migrate to executeTemplate().metadata.props
  migrated = migrated.replace(/\.__getProps__\(\)/g, '.executeTemplate().metadata.props')

  // 8. Export format - simple case
  // Match export default figma.code` (or tsx, html, etc) and wrap in { example: ... }
  migrated = migrated.replace(
    /export default figma\.(code|tsx|html|swift|kotlin)`/g,
    'export default { example: figma.$1`',
  )
  // Close the template literal for simple exports (look for backtick at end, handling multiline)
  // Use a more robust approach: find the last backtick that's not followed by more content
  migrated = migrated.replace(
    /(export default \{ example: figma\.\w+`[\s\S]*?)`(?=\s*$)/gm,
    '$1` }',
  )

  // 9. Export format - spread operator case
  // { ...figma.code`...`, metadata: ... } → { example: figma.code`...`, metadata: ... }
  migrated = migrated.replace(
    /\{\s*\.\.\.figma\.(code|tsx|html|swift|kotlin)`/g,
    '{ example: figma.$1`',
  )

  return migrated
}
