import { exec } from 'child_process'
import { readFileSync, rmSync, existsSync } from 'fs'
import path from 'path'
import { promisify } from 'util'
import { tidyStdOutput } from '../../../__test__/utils'

describe('e2e test for `migrate` command', () => {
  const testParentPath = path.join(__dirname, 'e2e_migrate_command')

  function getTestPath(testName: string) {
    return path.join(testParentPath, testName)
  }

  async function runMigrate(cwd: string, verbose = false) {
    return await promisify(exec)(
      `npx tsx ../../../../../cli connect migrate --skip-update-check --remove-props${verbose ? ' --verbose' : ''}`,
      {
        cwd,
      },
    )
  }

  function cleanupTemplateFiles(testPath: string) {
    const files = ['Button.figma.js', 'Avatar.figma.js']
    files.forEach((file) => {
      const filePath = path.join(testPath, file)
      if (existsSync(filePath)) {
        rmSync(filePath, { force: true })
      }
    })
  }

  it('successfully migrates React Code Connect files to parserless templates', async () => {
    const testPath = getTestPath('react_basic')

    try {
      const result = await runMigrate(testPath)

      // Check that the template files were created
      const buttonTemplatePath = path.join(testPath, 'Button.figma.js')
      const avatarTemplatePath = path.join(testPath, 'Avatar.figma.js')

      expect(existsSync(buttonTemplatePath)).toBe(true)
      expect(existsSync(avatarTemplatePath)).toBe(true)

      // Read the generated template files
      const buttonTemplate = readFileSync(buttonTemplatePath, 'utf-8')
      const avatarTemplate = readFileSync(avatarTemplatePath, 'utf-8')

      // Check that the URL comment is present
      expect(buttonTemplate).toContain('// url=https://figma.com/test/button')
      expect(avatarTemplate).toContain('// url=https://figma.com/test/avatar')

      // Check that v2 API methods are used
      expect(buttonTemplate).toContain('figma.selectedInstance.getString')
      expect(buttonTemplate).toContain('figma.selectedInstance.getBoolean')
      expect(avatarTemplate).toContain('figma.selectedInstance.getString')

      // Check that helpers have been migrated to server-side versions
      expect(buttonTemplate).toContain('figma.helpers.react.renderProp')
      expect(avatarTemplate).toContain('figma.helpers.react.renderProp')

      // Check that the export format is v2 ({ id: ..., example: ... })
      expect(buttonTemplate).toMatch(/export default\s*{\s*id:/s)
      expect(avatarTemplate).toMatch(/export default\s*{\s*id:/s)
      expect(buttonTemplate).toContain('example:')
      expect(avatarTemplate).toContain('example:')

      // Check that figma module is required
      expect(buttonTemplate).toContain('const figma = require("figma")')
      expect(avatarTemplate).toContain('const figma = require("figma")')

      // Check that the templates contain the component usage
      expect(buttonTemplate).toContain('<Button')
      expect(avatarTemplate).toContain('<Avatar')

      // Check that nestable is preserved in metadata (simple JSX example should be nestable: true)
      expect(buttonTemplate).toContain('metadata: { nestable: true }')
      // Check that __props has been removed (no longer needed for parserless templates)
      expect(buttonTemplate).not.toContain('__props')

      // Check the stderr output for successful migration
      expect(tidyStdOutput(result.stderr)).toContain('Migration complete')
      expect(tidyStdOutput(result.stderr)).toContain('2 migrated')
    } finally {
      cleanupTemplateFiles(testPath)
    }
  })

  it('skips files that already exist', async () => {
    const testPath = getTestPath('react_basic')

    try {
      // Run migrate once to create the files
      await runMigrate(testPath)

      // Run migrate again - should skip the existing files and exit with error
      try {
        await runMigrate(testPath)
        fail('Expected command to fail when no files are migrated')
      } catch (e: any) {
        expect(e.code).toBe(1)
        expect(tidyStdOutput(e.stderr)).toContain('2 skipped')
        expect(tidyStdOutput(e.stderr)).toContain('already exists')
        expect(tidyStdOutput(e.stderr)).toContain('No files were migrated')
      }
    } finally {
      cleanupTemplateFiles(testPath)
    }
  })

  it('includes imports in the default export when migrating', async () => {
    const testPath = getTestPath('react_basic')

    try {
      const result = await runMigrate(testPath)

      // Read the generated template file
      const buttonTemplatePath = path.join(testPath, 'Button.figma.js')
      const buttonTemplate = readFileSync(buttonTemplatePath, 'utf-8')

      // Check that imports are present in the default export
      expect(buttonTemplate).toContain('imports:')
      expect(buttonTemplate).toMatch(/imports:\s*\[/)

      // Check that the Button import is included (it should be extracted from the original file)
      expect(buttonTemplate).toContain('import { Button }')
      expect(buttonTemplate).toContain('./Button')

      // Verify the imports are in the correct position (after id, before example)
      const idMatch = buttonTemplate.match(/id:\s*"[^"]+",/)
      const importsMatch = buttonTemplate.match(/imports:\s*\[/)
      const exampleMatch = buttonTemplate.match(/example:/)

      expect(idMatch).not.toBeNull()
      expect(importsMatch).not.toBeNull()
      expect(exampleMatch).not.toBeNull()

      // Verify imports come after id
      if (idMatch && importsMatch) {
        expect(buttonTemplate.indexOf(idMatch[0])).toBeLessThan(
          buttonTemplate.indexOf(importsMatch[0]),
        )
      }

      // Check the stderr output
      expect(tidyStdOutput(result.stderr)).toContain('Migration complete')
    } finally {
      cleanupTemplateFiles(testPath)
    }
  })
})
