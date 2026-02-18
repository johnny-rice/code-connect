import { parseRawFile } from '../connect'
import { CodeConnectConfig } from '../../connect/project'
import { SyntaxHighlightLanguage } from '../../connect/label_language_mapping'
import fs from 'fs'
import path from 'path'
import os from 'os'

describe('parseRawFile', () => {
  let tempDir: string
  let tempFilePath: string

  beforeEach(() => {
    // Create a temporary directory and file for testing
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'parseRawFile-test-'))
    tempFilePath = path.join(tempDir, 'test.figma.template.js')
  })

  afterEach(() => {
    // Clean up temporary files
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath)
    }
    if (fs.existsSync(tempDir)) {
      fs.rmdirSync(tempDir)
    }
  })

  it('parses a raw file without documentUrlSubstitutions', () => {
    const fileContent = `// url=https://figma.com/design/abc123?node-id=1:1
const figma = require('figma')
export default figma.code\`<Button />\``

    fs.writeFileSync(tempFilePath, fileContent)

    const result = parseRawFile(tempFilePath, undefined)

    expect(result.figmaNode).toBe('https://figma.com/design/abc123?node-id=1:1')
  })

  it('applies documentUrlSubstitutions when config is provided', () => {
    const fileContent = `// url=https://figma.com/design/SOURCE-FILE?node-id=1:1
const figma = require('figma')
export default figma.code\`<Button />\``

    fs.writeFileSync(tempFilePath, fileContent)

    const config: CodeConnectConfig = {
      parser: 'react',
      documentUrlSubstitutions: {
        'https://figma.com/design/SOURCE-FILE': 'https://figma.com/design/TARGET-FILE',
      },
    }

    const result = parseRawFile(tempFilePath, undefined, config)

    expect(result.figmaNode).toBe('https://figma.com/design/TARGET-FILE?node-id=1:1')
  })

  it('applies multiple documentUrlSubstitutions', () => {
    const fileContent = `// url=https://figma.com/design/SOURCE-FILE/My-Component?node-id=1:1
const figma = require('figma')
export default figma.code\`<Button />\``

    fs.writeFileSync(tempFilePath, fileContent)

    const config: CodeConnectConfig = {
      parser: 'react',
      documentUrlSubstitutions: {
        'SOURCE-FILE': 'TARGET-FILE',
        'My-Component': 'Your-Component',
      },
    }

    const result = parseRawFile(tempFilePath, undefined, config)

    expect(result.figmaNode).toBe('https://figma.com/design/TARGET-FILE/Your-Component?node-id=1:1')
  })

  it('does not modify URL when no matching substitutions', () => {
    const fileContent = `// url=https://figma.com/design/OTHER-FILE?node-id=1:1
const figma = require('figma')
export default figma.code\`<Button />\``

    fs.writeFileSync(tempFilePath, fileContent)

    const config: CodeConnectConfig = {
      parser: 'react',
      documentUrlSubstitutions: {
        'SOURCE-FILE': 'TARGET-FILE',
      },
    }

    const result = parseRawFile(tempFilePath, undefined, config)

    expect(result.figmaNode).toBe('https://figma.com/design/OTHER-FILE?node-id=1:1')
  })

  it('preserves isParserless flag and other metadata', () => {
    const fileContent = `// url=https://figma.com/design/SOURCE-FILE?node-id=1:1
const figma = require('figma')
export default figma.code\`<Button />\``

    fs.writeFileSync(tempFilePath, fileContent)

    const config: CodeConnectConfig = {
      parser: 'react',
      documentUrlSubstitutions: {
        'SOURCE-FILE': 'TARGET-FILE',
      },
    }

    const result = parseRawFile(tempFilePath, 'Python', config)

    expect(result.figmaNode).toBe('https://figma.com/design/TARGET-FILE?node-id=1:1')
    expect(result.label).toBe('Python')
    expect(result.templateData.isParserless).toBe(true)
    expect(result.templateData.nestable).toBe(true)
  })

  it('uses language from config when provided', () => {
    const fileContent = `// url=https://figma.com/design/abc123?node-id=1:1
const figma = require('figma')
export default figma.code\`<Button />\``

    fs.writeFileSync(tempFilePath, fileContent)

    const config: CodeConnectConfig = {
      parser: 'react',
      language: SyntaxHighlightLanguage.Kotlin,
    }

    const result = parseRawFile(tempFilePath, 'React', config)

    expect(result.language).toBe(SyntaxHighlightLanguage.Kotlin)
    expect(result.label).toBe('React')
  })

  it('parses component field from comment', () => {
    const fileContent = `// component=Button
// url=https://figma.com/design/abc123?node-id=1:1
const figma = require('figma')
export default figma.code\`<Button />\``

    fs.writeFileSync(tempFilePath, fileContent)
    const result = parseRawFile(tempFilePath, undefined)

    expect(result.component).toBe('Button')
    expect(result.figmaNode).toBe('https://figma.com/design/abc123?node-id=1:1')
  })

  it('parses source field from comment', () => {
    const fileContent = `// source=src/button.tsx
// url=https://figma.com/design/abc123?node-id=1:1
const figma = require('figma')
export default figma.code\`<Button />\``

    fs.writeFileSync(tempFilePath, fileContent)
    const result = parseRawFile(tempFilePath, undefined)

    expect(result.source).toBe('src/button.tsx')
  })

  it('parses fields in any order', () => {
    const fileContent = `// url=https://figma.com/design/abc123?node-id=1:1
// component=Button
// source=src/button.tsx
const figma = require('figma')
export default figma.code\`<Button />\``

    fs.writeFileSync(tempFilePath, fileContent)
    const result = parseRawFile(tempFilePath, undefined)

    expect(result.figmaNode).toBe('https://figma.com/design/abc123?node-id=1:1')
    expect(result.component).toBe('Button')
    expect(result.source).toBe('src/button.tsx')
  })

  it('handles missing optional fields', () => {
    const fileContent = `// url=https://figma.com/design/abc123?node-id=1:1
const figma = require('figma')
export default figma.code\`<Button />\``

    fs.writeFileSync(tempFilePath, fileContent)
    const result = parseRawFile(tempFilePath, undefined)

    expect(result.figmaNode).toBe('https://figma.com/design/abc123?node-id=1:1')
    expect(result.component).toBeUndefined()
  })

  it('throws error when url field is missing', () => {
    const fileContent = `// component=Button
const figma = require('figma')
export default figma.code\`<Button />\``

    fs.writeFileSync(tempFilePath, fileContent)

    expect(() => parseRawFile(tempFilePath, undefined)).toThrow('Missing required url field')
  })

  it('trims whitespace from field values', () => {
    const fileContent = `// component=  Button
// source=  src/button.tsx
// url=  https://figma.com/design/abc123?node-id=1:1
const figma = require('figma')
export default figma.code\`<Button />\``

    fs.writeFileSync(tempFilePath, fileContent)
    const result = parseRawFile(tempFilePath, undefined)

    expect(result.component).toBe('Button')
    expect(result.source).toBe('src/button.tsx')
    expect(result.figmaNode).toBe('https://figma.com/design/abc123?node-id=1:1')
  })
})
