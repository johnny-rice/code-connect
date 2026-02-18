import fs from 'fs'
import path from 'path'
import * as prettier from 'prettier'
import { CodeConnectJSON } from '../connect/figma_connect'

export function writeTemplateFile(
  doc: CodeConnectJSON,
  outputDir: string | undefined,
  baseDir: string,
  localSourcePath?: string,
  filePathsCreated?: Set<string>,
  removeProps?: boolean,
): { outputPath: string; skipped: boolean } {
  const suffix = '.figma.js'

  // Determine base output filename
  let baseOutputPath: string

  if (outputDir) {
    // Use specified output directory
    const filename = `${doc.component || 'template'}${suffix}`
    baseOutputPath = path.join(outputDir, filename)
  } else if (localSourcePath) {
    // Use same directory as local source file
    const sourceDir = path.dirname(localSourcePath)
    let sourceBasename = path.basename(localSourcePath)

    // If this is a Code Connect file, extract the base component name
    // Handles patterns like: Button.figma.tsx, Button.figmadoc.tsx, Button.figma.template.js
    // Should all become: Button.figma.js
    const codeConnectPattern = /\.(figma|figmadoc)(\.[^.]+)+$/
    if (codeConnectPattern.test(sourceBasename)) {
      // Extract everything before the .figma/.figmadoc pattern
      sourceBasename = sourceBasename.replace(codeConnectPattern, '')
    } else {
      // For regular component files, strip extension normally
      sourceBasename = path.basename(localSourcePath, path.extname(localSourcePath))
    }

    const filename = `${sourceBasename}${suffix}`
    baseOutputPath = path.join(sourceDir, filename)
  } else {
    // No source info, use current directory
    const filename = `${doc.component || 'template'}${suffix}`
    baseOutputPath = path.join(baseDir, filename)
  }

  // Check if file already exists on disk (pre-existing file, not created in this run)
  const existsOnDisk = fs.existsSync(baseOutputPath)
  const createdInThisRun = filePathsCreated && filePathsCreated.has(baseOutputPath)

  if (existsOnDisk && !createdInThisRun) {
    // This file existed before the migration run, skip it
    return { outputPath: baseOutputPath, skipped: true }
  }

  // Handle duplicate names (either created in this run or would conflict with an existing file)
  let outputPath = baseOutputPath
  if (createdInThisRun || existsOnDisk) {
    // Find a unique name by appending _1, _2, etc. before the suffix
    const dir = path.dirname(baseOutputPath)
    const basename = path.basename(baseOutputPath)

    // Remove the suffix to get the base name (works for any suffix like .figma.js or .figma.ts)
    const baseNameWithoutSuffix = basename.endsWith(suffix)
      ? basename.slice(0, -suffix.length)
      : basename

    let counter = 1
    do {
      outputPath = path.join(dir, `${baseNameWithoutSuffix}_${counter}${suffix}`)
      counter++
    } while ((filePathsCreated && filePathsCreated.has(outputPath)) || fs.existsSync(outputPath))
  }

  let template = doc.template

  template = removeSwiftHelpers(template)
  // Helpers have not been injected - replace reference with server-side versions
  template = migrateTemplateToUseServerSideHelpers(template)
  // Remove __props definition and from metadata (if flag is set)
  if (removeProps) {
    template = removePropsDefinitionAndMetadata(template)
  }
  // V1 -> V2 codemods
  template = migrateV1TemplateToV2(template)
  // Add required id to template (set to TODO if no usable name)
  template = addId(template, doc.component || 'TODO')
  // Add imports if present
  template = addImports(template, doc.templateData?.imports)
  // Add nestable to metadata (default to false)
  template = addNestableToMetadata(template, !!doc.templateData?.nestable)
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

  // Build comment header lines
  const commentLines: string[] = [`// url=${doc.figmaNode}`] // URL is required
  if (doc.source) {
    commentLines.push(`// source=${doc.source}`)
  }
  if (doc.component) {
    commentLines.push(`// component=${doc.component}`)
  }
  commentLines.push(``)

  const fileContent = commentLines.join('\n') + '\n' + template

  // Ensure output directory exists
  const outputDirPath = path.dirname(outputPath)
  if (!fs.existsSync(outputDirPath)) {
    fs.mkdirSync(outputDirPath, { recursive: true })
  }

  // Write the file
  fs.writeFileSync(outputPath, fileContent, 'utf-8')

  // Track the created file path
  if (filePathsCreated) {
    filePathsCreated.add(outputPath)
  }

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

export function addImports(template: string, imports: string[] | undefined): string {
  if (!imports || imports.length === 0) {
    return template
  }

  // Escape imports for safe insertion into JS
  const importsJson = JSON.stringify(imports)

  // Add imports after the id field if it exists, otherwise at the start
  // Match: export default { id: '...', (with optional whitespace/newlines)
  const withId = template.replace(
    /(export default\s*\{\s*id:\s*'[^']*',)/,
    `$1 imports: ${importsJson},`,
  )

  // If id replacement worked, return
  if (withId !== template) {
    return withId
  }

  // Otherwise, add at the start (after opening brace)
  return template.replace(/export default\s*\{/, `export default { imports: ${importsJson},`)
}

export function addNestableToMetadata(template: string, nestable: boolean): string {
  // Find "metadata: {" and replace with "metadata: { nestable: <value>,"
  return template.replace(/metadata:\s*\{/, `metadata: { nestable: ${nestable},`)
}

/**
 * Migrates V1 templates to V2 API.
 *
 * This performs safe, incremental transformations. The following patterns
 * are intentionally NOT migrated as they're still supported in V2:
 *
 * - __props metadata building pattern - still valid JavaScript
 * - __renderWithFn__() - complex transformation, still supported
 *
 * These may be addressed in future migrations.
 */
export const migrateV1TemplateToV2 = (template: string): string => {
  let migrated = template

  // 1. Core object rename
  migrated = migrated.replace(/figma\.currentLayer/g, 'figma.selectedInstance')

  // 2. Normalize template types to figma.code
  migrated = migrated.replace(/figma\.html/g, 'figma.code')
  migrated = migrated.replace(/figma\.tsx/g, 'figma.code')
  migrated = migrated.replace(/figma\.swift/g, 'figma.code')
  migrated = migrated.replace(/figma\.kotlin/g, 'figma.code')

  // 3. Property accessor methods
  migrated = migrated.replace(/\.__properties__\.string\(/g, '.getString(')
  migrated = migrated.replace(/\.__properties__\.boolean\(/g, '.getBoolean(')
  migrated = migrated.replace(/\.__properties__\.enum\(/g, '.getEnum(')
  migrated = migrated.replace(/\.__properties__\.__instance__\(/g, '.getInstanceSwap(')
  // .__properties__.instance() auto-renders, so we need to add .executeTemplate().example
  migrated = migrated.replace(
    /\.__properties__\.instance\(([^)]+)\)/g,
    '.getInstanceSwap($1)?.executeTemplate().example',
  )

  // 4. Alias for __properties__ on selectedInstance
  migrated = migrated.replace(/figma\.selectedInstance\.__properties__\./g, 'figma.properties.')

  // 5. Other method renames
  migrated = migrated.replace(/\.__getPropertyValue__\(/g, '.getPropertyValue(')

  // 6. __findChildWithCriteria__ - migrate based on type parameter
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

  // 7. __find__() - migrate to findInstance()
  migrated = migrated.replace(
    /\.__find__\(("([^"]+)"|'([^']+)')\)/g,
    (match, quote, doubleQuoted, singleQuoted) => {
      const name = doubleQuoted || singleQuoted
      return `.findInstance("${name}")`
    },
  )

  // 8. __render__() - migrate to executeTemplate().example (but not if part of __findChildWithCriteria__)
  migrated = migrated.replace(/\.__render__\(\)/g, '.executeTemplate().example')

  // 9. __getProps__() - migrate to executeTemplate().metadata.props
  migrated = migrated.replace(/\.__getProps__\(\)/g, '.executeTemplate().metadata.props')

  // 10. Export format - simple case
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

  // 11. Export format - spread operator case
  // { ...figma.code`...`, metadata: ... } → { example: figma.code`...`, metadata: ... }
  migrated = migrated.replace(
    /\{\s*\.\.\.figma\.(code|tsx|html|swift|kotlin)`/g,
    '{ example: figma.$1`',
  )

  return migrated
}

/**
 * Removes the __props definition and props assignments. These are only used by icons
 * helpers and significantly bloat templates.
 */
export function removePropsDefinition(template: string): string {
  // Match from "const __props = {" through everything up until (but not including) "export default {"
  // Uses [\s\S] to match any character including newlines
  return template.replace(/const\s+__props\s*=\s*\{[\s\S]*?(?=export\s+default\s*\{)/g, '\n')
}

/**
 * Removes the __props definition/assignments and removes __props from the default export
 */
export function removePropsDefinitionAndMetadata(template: string): string {
  // First remove the __props definition and assignments
  let result = removePropsDefinition(template)
  const exportMatch = result.match(/(export\s+default\s+\{[\s\S]*$)/)
  if (exportMatch) {
    const exportSection = exportMatch[1]
    const cleanedExport = exportSection
      .replace(/metadata:\s*\{\s*__props\s*\}/g, 'metadata: {}') // metadata: { __props }
      .replace(/metadata:\s*\{\s*__props\s*,/g, 'metadata: {') // metadata: { __props, ...
      .replace(/,\s*__props\s*\}/g, ' }') // metadata: { ..., __props }
      .replace(/,\s*__props\s*,/g, ',') // metadata: { ..., __props, ... }

    result = result.substring(0, result.indexOf(exportSection)) + cleanedExport
  }

  return result
}

type CodeConnectObjectsForFigmaUrl = {
  main: CodeConnectJSON | null
  variants: CodeConnectJSON[]
}

/**
 * For each figmaUrl in the given codeConnectObjects, return the main (non-variant)
 * codeConnectObject plus a list of any variants
 */
export const groupCodeConnectObjectsByFigmaUrl = (codeConnectObjects: CodeConnectJSON[]) => {
  return codeConnectObjects.reduce(
    (acc, obj) => {
      const figmaUrl = obj.figmaNode
      if (!acc[figmaUrl]) {
        acc[figmaUrl] = { main: null, variants: [] }
      }

      if (obj.variant && Object.keys(obj.variant).length > 0) {
        acc[figmaUrl].variants.push(obj)
      } else {
        acc[figmaUrl].main = obj
      }

      return acc
    },
    {} as Record<string, CodeConnectObjectsForFigmaUrl>,
  )
}

function removeSwiftHelpers(template: string): string {
  return template.replace(
    `function __fcc_renderSwiftChildren(children, prefix) {
  if (children === undefined) {
    return children
  }
  return children.flatMap((child, index) => {
    if (child.type === 'CODE') {
      let code = child.code.split('\\n').map((line) => {
        return line.trim() !== '' ? \`\${prefix}\${line}\` : line;
      }).join('\\n')
      if (index !== children.length - 1) {
        code = code + '\\n'
      }
      return {
        ...child,
        code: code,
      }
    } else {
        let elements = []
        const shouldAddNewline = index > 0 && children[index - 1].type === 'CODE' && !children[index - 1].code.endsWith('\\n')
        elements.push({ type: 'CODE', code: \`\${shouldAddNewline ? '\\n' : ''}\${prefix}\` })
        elements.push(child)
        if (index !== children.length - 1) {
            elements.push({ type: 'CODE', code: '\\n' })
        }
        return elements
    }
  })
}
`,
    '',
  )
}
