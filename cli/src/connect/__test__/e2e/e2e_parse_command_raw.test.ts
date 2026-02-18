import { promisify } from 'util'
import { exec } from 'child_process'
import { tidyStdOutput } from '../../../__test__/utils'
import path from 'path'

describe('e2e test for `parse` command (raw)', () => {
  const cliVersion = require('../../../../package.json').version

  it('successfully parses raw template file', async () => {
    const testPath = path.join(__dirname, 'e2e_parse_command/raw')
    const expectedFile = path.join(testPath, 'test-component.figma.template.js')

    const result = await promisify(exec)(
      `npx tsx ../../../cli connect parse --skip-update-check --dir ${testPath}`,
      {
        cwd: __dirname,
      },
    )

    expect(tidyStdOutput(result.stderr)).toBe(
      `Config file found, parsing ${testPath} using specified include globs\n${expectedFile}`,
    )

    const json = JSON.parse(result.stdout)

    expect(json).toMatchObject([
      {
        figmaNode: 'https://figma.com/design/abc?node=1:1',
        label: 'Code',
        language: 'plaintext',
        sourceLocation: { line: -1 },
        template: `const figma = require('figma')
const text = figma.currentLayer.__properties__.string('Text')

export default figma.code\`def python_code():
  return \${text}\`
`,
        templateData: { nestable: true, isParserless: true },
        metadata: {
          cliVersion,
        },
      },
    ])
  })

  it('successfully applies documentUrlSubstitutions to raw template file', async () => {
    const testPath = path.join(__dirname, 'e2e_parse_command/raw_with_substitutions')
    const expectedFile = path.join(testPath, 'test-component.figma.template.js')

    const result = await promisify(exec)(
      `npx tsx ../../../cli connect parse --skip-update-check --dir ${testPath}`,
      {
        cwd: __dirname,
      },
    )

    expect(tidyStdOutput(result.stderr)).toBe(
      `Config file found, parsing ${testPath} using specified include globs\n${expectedFile}`,
    )

    const json = JSON.parse(result.stdout)

    expect(json).toMatchObject([
      {
        // URL should be substituted from https://figma.com/design/SOURCE-FILE to https://figma.com/design/TARGET-FILE
        figmaNode: 'https://figma.com/design/TARGET-FILE?node-id=1:1',
        label: 'Code',
        language: 'plaintext',
        sourceLocation: { line: -1 },
        template: `const figma = require('figma')
const text = figma.currentLayer.__properties__.string('Text')

export default figma.code\`def python_code():
  return \${text}\`
`,
        templateData: { nestable: true, isParserless: true },
        metadata: {
          cliVersion,
        },
      },
    ])
  })
})
