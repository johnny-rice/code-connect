import { BaseCommand, getAccessToken, getCodeConnectObjects, getDir } from '../../commands/connect'
import prompts from 'prompts'
import fs from 'fs'
import { exitWithFeedbackMessage, findComponentsInDocument, parseFileKey } from '../helpers'
import { FigmaRestApi, getApiUrl } from '../figma_rest_api'
import { exitWithError, logger, success } from '../../common/logging'
import {
  ReactProjectInfo,
  getReactProjectInfo,
  getGitRepoAbsolutePath,
  parseOrDetermineConfig,
  getProjectInfoFromConfig,
  CodeConnectConfig,
  ProjectInfo,
  CodeConnectExecutableParserConfig,
  checkForEnvAndToken,
} from '../../connect/project'
import { parseFigmaNode } from '../validation'
import chalk from 'chalk'
import path from 'path'
import {
  CreateRequestPayload,
  CreateRequestPayloadMulti,
  CreateResponsePayload,
  FigmaConnection,
  PropMapping,
} from '../parser_executable_types'
import { normalizeComponentName } from '../create'
import { createReactCodeConnect } from '../../react/create'
import { CodeConnectJSON } from '../../connect/figma_connect'
import boxen from 'boxen'
import {
  createCodeConnectConfig,
  getComponentOptionsMap,
  getFilepathExportsFromFiles,
  parseFilepathExport,
  getIncludesGlob,
  isValidFigmaUrl,
  createEnvFile,
  addTokenToEnvFile,
} from './helpers'
import stripAnsi from 'strip-ansi'
import { callParser, handleMessages } from '../parser_executables'
import ora from 'ora'
import { z } from 'zod'
import { fromError } from 'zod-validation-error'
import { autoLinkComponents } from './autolinking'
import { extractDataAndGenerateAllPropsMappings } from './prop_mapping_helpers'
import { isFetchError, request } from '../../common/fetch'
import { ComponentTypeSignature } from '../../react/parser'

type ConnectedComponentMappings = { componentName: string; filepathExport: string }[]

const NONE = '(None)'
const MAX_COMPONENTS_TO_MAP = 40

function clearQuestion(prompt: prompts.PromptObject<string>, answer: string) {
  const displayedAnswer =
    (Array.isArray(prompt.choices) && prompt.choices.find((c) => c.value === answer)?.title) ||
    answer
  const lengthOfDisplayedQuestion =
    stripAnsi(prompt.message as string).length + stripAnsi(displayedAnswer).length + 5 // 2 chars before, 3 chars between Q + A
  const rowsToRemove = Math.ceil(lengthOfDisplayedQuestion / process.stdout.columns)

  process.stdout.moveCursor(0, -rowsToRemove)
  process.stdout.clearScreenDown()
}

type CliDataResponse = {
  document: FigmaRestApi.Node
  componentSets: string[]
  components: Record<string, { componentSetId: string }>
}

async function fetchTopLevelComponentsFromFile({
  accessToken,
  figmaUrl,
  cmd,
}: {
  accessToken: string
  figmaUrl: string
  cmd: BaseCommand
}) {
  // TODO enter create flow if node-id specified
  const fileKey = parseFileKey(figmaUrl)

  const apiUrl = getApiUrl(figmaUrl ?? '') + `/code_connect/${fileKey}/cli_data`

  try {
    const spinner = ora({
      text: `Fetching component information from ${cmd.verbose ? `${apiUrl}\n` : 'Figma...'}`,
      color: 'green',
    }).start()

    const response = await (
      process.env.CODE_CONNECT_MOCK_DOC_RESPONSE
        ? Promise.resolve({
            response: { status: 200 },
            data: JSON.parse(
              fs.readFileSync(process.env.CODE_CONNECT_MOCK_DOC_RESPONSE, 'utf-8'),
            ) as CliDataResponse,
          })
        : request.get<CliDataResponse>(apiUrl, {
            headers: {
              'X-Figma-Token': accessToken,
              'Content-Type': 'application/json',
            },
          })
    ).finally(() => {
      if (cmd.verbose) {
        spinner.stopAndPersist()
      } else {
        spinner.stop()
      }
    })

    if (response.response.status === 200) {
      return findComponentsInDocument(response.data.document).filter(
        ({ id }) =>
          id in response.data.componentSets || !response.data.components[id].componentSetId,
      )
    } else {
      logger.error(`Failed to fetch components from Figma with status: ${response.response.status}`)
      logger.debug('Failed to fetch components from Figma with Body:', response.data)
    }
  } catch (err) {
    if (isFetchError(err)) {
      if (err.response) {
        logger.error(
          `Failed to fetch components from Figma (${err.response.status}): ${err.response.status} ${
            err.data?.err ?? err.data?.message
          }`,
        )
      } else {
        logger.error(`Failed to fetch components from Figma: ${err.message}`)
      }
      logger.debug(JSON.stringify(err.data))
    } else {
      logger.error(err)
    }
    exitWithFeedbackMessage(1)
  }
}

/**
 * enable selection of a subset of components per page
 * @param components to narrow down from
 * @returns components narrowed down to the selected pages
 */
export async function narrowDownComponentsPerPage(
  components: FigmaRestApi.Component[],
  pages: Record<string, string>,
) {
  const createTitle = (name: string, id: string, pad: number) => {
    const componentsInPage = components.filter((c) => c.pageId === id)
    let namesPreview = componentsInPage
      .slice(0, 4)
      .map((c) => c.name)
      .join(', ')

    namesPreview = componentsInPage.length > 4 ? `${namesPreview}, ...` : `${namesPreview}`
    const componentWord = componentsInPage.length === 1 ? 'Component' : 'Components'

    return `${name.padEnd(pad, ' ')} - ${componentsInPage.length} ${componentWord} ${chalk.dim(
      `(${namesPreview})`,
    )}`
  }

  const longestPageName = Math.max(...Object.values(pages).map((name) => name.length))

  let pagesToMap: string[] = []
  console.info('')
  while (true) {
    const { pagesToMap_temp } = await askQuestion({
      type: 'multiselect',
      name: 'pagesToMap_temp',
      message: `Select the pages with the Figma components you'd like to map (Press ${chalk.green('space')} to select and ${chalk.green('enter')} to continue)`,
      instructions: false,
      choices: Object.entries(pages).map(([id, name]) => ({
        title: createTitle(name, id, longestPageName),
        value: id,
      })),
    })

    if (!pagesToMap_temp || pagesToMap_temp.length === 0) {
      logger.warn('Select at least one page to continue.')
      continue
    }
    pagesToMap = pagesToMap_temp
    break
  }

  return components.filter((c) => pagesToMap.includes(c.pageId))
}

/**
 * Asks a Prompts question and adds spacing
 * @param question Prompts question
 * @returns Prompts answer
 */
async function askQuestion<T extends string = string>(
  question: prompts.PromptObject<T>,
): Promise<prompts.Answers<T>> {
  const answers = await prompts(question)
  logger.info('')
  return answers
}

/**
 * Asks a Prompts question and exits the process if user cancels
 * @param question Prompts question
 * @returns Prompts answer
 */
async function askQuestionOrExit<T extends string = string>(
  question: prompts.PromptObject<T>,
): Promise<prompts.Answers<T>> {
  const answers = await askQuestion(question)
  if (!Object.keys(answers).length) {
    return process.exit(0)
  }
  return answers
}

/**
 * Asks a Prompts question and shows an exit confirmation if user cancels.
 * This should be used for questions further along in the wizard.
 * @param question Prompts question
 * @returns Prompts answer
 */
async function askQuestionWithExitConfirmation<T extends string = string>(
  question: prompts.PromptObject<T>,
): Promise<prompts.Answers<T>> {
  while (true) {
    const answers = await askQuestion(question)

    if (Object.keys(answers).length) {
      return answers
    }

    const { shouldExit } = await askQuestion({
      type: 'select',
      name: 'shouldExit',
      message: 'Are you sure you want to exit?',
      choices: [
        {
          title: 'Yes',
          value: 'yes',
        },
        {
          title: 'No',
          value: 'no',
        },
      ],
    })
    // also exit if no answer provided (esc / ctrl+c)
    if (!shouldExit || shouldExit === 'yes') {
      process.exit(0)
    }
  }
}

function formatComponentTitle(componentName: string, filepathExport: string | null, pad: number) {
  const fileExport = filepathExport ? parseFilepathExport(filepathExport) : null
  const nameLabel = `${chalk.dim('Figma component:')} ${componentName.padEnd(pad, ' ')}`

  const filepathLabel = fileExport ? fileExport.filepath : '-'
  const exportNote = fileExport?.exportName ? ` (${fileExport.exportName})` : ''

  const linkedLabel = `↔️ ${chalk.dim('Code Definition:')} ${filepathLabel}${exportNote}`
  return `${nameLabel}  ${linkedLabel}`
}

export function getComponentChoicesForPrompt(
  components: FigmaRestApi.Component[],
  linkedNodeIdsToFilepathExports: Record<string, string>,
  connectedComponentsMappings: ConnectedComponentMappings,
  dir: string,
): prompts.Choice[] {
  const longestNameLength = [...components, ...connectedComponentsMappings].reduce(
    (longest, component) =>
      Math.max(
        longest,
        'name' in component ? component.name.length : component.componentName.length,
      ),
    0,
  )

  const nameCompare = (a: FigmaRestApi.Component, b: FigmaRestApi.Component) =>
    a.name.localeCompare(b.name)

  const linkedComponents = components
    .filter((c) => !!linkedNodeIdsToFilepathExports[c.id])
    .sort(nameCompare)
  const unlinkedComponents = components
    .filter((c) => !linkedNodeIdsToFilepathExports[c.id])
    .sort(nameCompare)

  const formatComponentChoice = (c: FigmaRestApi.Component) => {
    const filepathExport = linkedNodeIdsToFilepathExports[c.id]
      ? path.relative(dir, linkedNodeIdsToFilepathExports[c.id])
      : null
    return {
      title: formatComponentTitle(c.name, filepathExport, longestNameLength),
      value: c.id,
      description: `${chalk.green('Edit Match')}`,
    }
  }

  return [
    ...linkedComponents.map(formatComponentChoice),
    ...unlinkedComponents.map(formatComponentChoice),
    ...connectedComponentsMappings.map((connectedComponent) => ({
      title: formatComponentTitle(
        connectedComponent.componentName,
        connectedComponent.filepathExport,
        longestNameLength,
      ),
      disabled: true,
    })),
  ]
}

function getUnconnectedComponentChoices(componentPaths: string[], dir: string) {
  return [
    {
      title: NONE,
      value: NONE,
    },
    ...componentPaths.map((absPath) => {
      return {
        title: path.relative(dir, absPath),
        value: absPath,
      }
    }),
  ]
}

type ManualLinkingArgs = {
  unconnectedComponents: FigmaRestApi.Component[]
  connectedComponentsMappings: ConnectedComponentMappings
  linkedNodeIdsToFilepathExports: Record<string, string>
  filepathExports: string[]
  cmd: BaseCommand
}

const escapeHandler = () => {
  let escPressed = false
  const keypressListener = (_: any, key: { name: string }) => {
    if (key.name === 'escape') {
      escPressed = true
    }
  }
  process.stdin.on('keypress', keypressListener)
  return {
    escPressed: () => escPressed,
    reset: () => {
      escPressed = false
    },
    destroy: () => {
      process.stdin.removeListener('keypress', keypressListener)
    },
  }
}

async function runManualLinking({
  unconnectedComponents,
  linkedNodeIdsToFilepathExports,
  filepathExports,
  connectedComponentsMappings,
  cmd,
}: ManualLinkingArgs) {
  const filesToComponentOptionsMap = getComponentOptionsMap(filepathExports)
  const dir = getDir(cmd)
  const escHandler = escapeHandler()
  while (true) {
    // Don't show exit confirmation as we're relying on esc behavior
    const { nodeId } = await prompts(
      {
        type: 'select',
        name: 'nodeId',
        message: `Select a Figma component match you'd like to edit (Press ${chalk.green(
          'esc',
        )} when you're ready to continue on)`,
        choices: getComponentChoicesForPrompt(
          unconnectedComponents,
          linkedNodeIdsToFilepathExports,
          connectedComponentsMappings,
          dir,
        ),
        warn: 'This component already has a local Code Connect file.',
        hint: ' ',
      },
      {
        onSubmit: clearQuestion,
      },
    )
    if (!nodeId) {
      break
    }
    const pathChoices = getUnconnectedComponentChoices(Object.keys(filesToComponentOptionsMap), dir)
    const prevSelectedKey = linkedNodeIdsToFilepathExports[nodeId]

    const { filepath: prevSelectedFilepath, exportName: prevSelectedComponent } = prevSelectedKey
      ? parseFilepathExport(prevSelectedKey)
      : {
          filepath: null,
          exportName: null,
        }

    escHandler.reset()
    const { pathToComponent } = await prompts(
      {
        type: 'autocomplete',
        name: 'pathToComponent',
        message: 'Choose a path to your code component (type to filter results)',
        choices: pathChoices,
        // default suggest uses .startsWith(input) which isn't very useful for full paths
        suggest: (input, choices) =>
          Promise.resolve(
            choices.filter((i) => i.value.toUpperCase().includes(input.toUpperCase())),
          ),
        // preselect if editing an existing choice
        initial: prevSelectedFilepath
          ? pathChoices.findIndex(({ value }) => value === prevSelectedFilepath)
          : 0,
      },
      {
        onSubmit: clearQuestion,
      },
    )
    if (escHandler.escPressed()) {
      continue
    }
    if (pathToComponent) {
      if (pathToComponent === NONE) {
        delete linkedNodeIdsToFilepathExports[nodeId]
      } else {
        const fileExports = filesToComponentOptionsMap[pathToComponent]
        if (fileExports.length === 0) {
          // Not TS, default to filepath
          linkedNodeIdsToFilepathExports[nodeId] = pathToComponent
        } else {
          escHandler.reset()
          const { filepathExport } = await prompts(
            {
              type: 'autocomplete',
              name: 'filepathExport',
              message: `Choose an export of ${path.parse(pathToComponent).base} (type to filter results)`,
              choices: fileExports,
              // default suggest uses .startsWith(input)
              suggest: (input, choices) =>
                Promise.resolve(
                  choices.filter((i) => i.value.toUpperCase().includes(input.toUpperCase())),
                ),
              // preselect if editing an existing choice
              initial:
                prevSelectedComponent && prevSelectedFilepath === pathToComponent
                  ? fileExports.findIndex(({ title }) => title === prevSelectedComponent)
                  : 0,
            },
            {
              onSubmit: clearQuestion,
            },
          )
          if (escHandler.escPressed()) {
            continue
          }
          linkedNodeIdsToFilepathExports[nodeId] = filepathExport
        }
      }
    }
  }
  escHandler.destroy()
}

async function runManualLinkingWithConfirmation(manualLinkingArgs: ManualLinkingArgs) {
  let outDir = manualLinkingArgs.cmd.outDir || null

  while (true) {
    await runManualLinking(manualLinkingArgs)

    if (!outDir) {
      console.info(
        '\nA Code Connect file is created for each Figma component to code definition match.',
      )
      const { outputDirectory } = await askQuestionWithExitConfirmation({
        type: 'text',
        name: 'outputDirectory',
        message: `In which directory would you like to store Code Connect files? (Press ${chalk.green('enter')} to co-locate your files alongside your component files)`,
      })
      outDir = outputDirectory
    }

    const linkedNodes = Object.keys(manualLinkingArgs.linkedNodeIdsToFilepathExports)
    if (!linkedNodes.length) {
      const { confirmation } = await askQuestionOrExit({
        type: 'select',
        name: 'confirmation',
        message: `No Code Connect files linked. Are you sure you want to exit?`,
        choices: [
          {
            title: 'Back to edit',
            value: 'backToEdit',
          },
          {
            title: 'Exit',
            value: 'exit',
          },
        ],
      })
      if (confirmation === 'exit') {
        process.exit(0)
      }
    } else {
      const { confirmation } = await askQuestionWithExitConfirmation({
        type: 'select',
        name: 'confirmation',
        message: `You're ready to create ${chalk.green(linkedNodes.length)} Code Connect file${
          linkedNodes.length == 1 ? '' : 's'
        }. Continue?`,
        choices: [
          {
            title: 'Create files',
            value: 'create',
          },
          {
            title: 'Back to editing',
            value: 'backToEdit',
          },
        ],
      })
      if (confirmation === 'backToEdit') {
        outDir = manualLinkingArgs.cmd.outDir || null
      } else {
        return outDir
      }
    }
  }
}

interface AddPayloadArgs {
  payloadType: 'MULTI_EXPORT' | 'SINGLE_EXPORT'
  filepath: string
  sourceExport: string
  reactTypeSignature?: ComponentTypeSignature
  propMapping?: PropMapping
  figmaNodeUrl: string
  moreComponentProps: FigmaRestApi.Component
  destinationDir: string
  sourceFilepath: string
  normalizedName: string
  config: CodeConnectConfig
}

export async function addPayload(
  payloads: Record<string, CreateRequestPayloadMulti | CreateRequestPayload>,
  args: AddPayloadArgs,
) {
  const {
    payloadType,
    filepath,
    sourceExport,
    reactTypeSignature,
    propMapping,
    figmaNodeUrl,
    moreComponentProps,
    destinationDir,
    sourceFilepath,
    normalizedName,
    config,
  } = args

  if (payloadType === 'MULTI_EXPORT') {
    const figmaConnection: FigmaConnection = {
      sourceExport,
      reactTypeSignature,
      propMapping,
      component: {
        figmaNodeUrl,
        ...moreComponentProps,
      },
    }

    if (payloads[filepath]) {
      ;(payloads[filepath] as CreateRequestPayloadMulti).figmaConnections.push(figmaConnection)
    } else {
      const payload: CreateRequestPayloadMulti = {
        mode: 'CREATE',
        destinationDir,
        sourceFilepath,
        normalizedName,
        figmaConnections: [figmaConnection],
        config,
      }
      payloads[filepath] = payload
    }
  }

  if (payloadType === 'SINGLE_EXPORT') {
    const payload: CreateRequestPayload = {
      mode: 'CREATE',
      destinationDir,
      sourceFilepath,
      component: {
        figmaNodeUrl,
        normalizedName,
        ...moreComponentProps,
      },
      config,
    }
    payloads[filepath] = payload
  }
}

export async function createCodeConnectFiles({
  linkedNodeIdsToFilepathExports,
  figmaFileUrl,
  unconnectedComponentsMap,
  outDir: outDirArg,
  projectInfo,
  cmd,
  accessToken,
  useAi,
}: {
  figmaFileUrl: string
  linkedNodeIdsToFilepathExports: Record<string, string>
  unconnectedComponentsMap: Record<string, FigmaRestApi.Component>
  outDir: string | null
  projectInfo: ProjectInfo
  cmd: BaseCommand
  accessToken: string
  useAi: boolean
}) {
  const filepathExportsToComponents = Object.entries(linkedNodeIdsToFilepathExports).reduce(
    (map, [nodeId, filepathExport]) => {
      map[filepathExport] = unconnectedComponentsMap[nodeId]
      return map
    },
    {} as Record<string, FigmaRestApi.Component>,
  )

  let embeddingsFetchSpinner: ora.Ora | null = null

  if (useAi) {
    embeddingsFetchSpinner = ora({
      text: 'Computing embeddings...',
      color: 'green',
    }).start()
  }

  const propMappingsAndData =
    projectInfo.config.parser === 'react'
      ? await extractDataAndGenerateAllPropsMappings({
          filepathExportsToComponents,
          projectInfo,
          cmd,
          figmaUrl: figmaFileUrl,
          accessToken,
          useAi,
        })
      : null

  if (embeddingsFetchSpinner) {
    embeddingsFetchSpinner.stop()
  }

  let allFilesCreated = true

  const payloads: Record<string, CreateRequestPayloadMulti | CreateRequestPayload> = {}

  for (const [nodeId, filepathExport] of Object.entries(linkedNodeIdsToFilepathExports)) {
    const urlObj = new URL(figmaFileUrl)
    urlObj.search = ''
    urlObj.searchParams.append('node-id', nodeId)
    const { filepath, exportName } = parseFilepathExport(filepathExport)

    const { name } = path.parse(filepath)

    const outDir = outDirArg || path.dirname(filepath)

    const payloadType =
      projectInfo.config.parser === 'react' || projectInfo.config.parser === 'html'
        ? 'MULTI_EXPORT'
        : 'SINGLE_EXPORT'

    addPayload(payloads, {
      payloadType,
      filepath,
      sourceExport: exportName || '?',
      reactTypeSignature: propMappingsAndData?.propMappingData[filepathExport]?.signature,
      propMapping: propMappingsAndData?.propMappings[filepathExport],
      figmaNodeUrl: urlObj.toString(),
      moreComponentProps: unconnectedComponentsMap[nodeId],
      destinationDir: outDir,
      sourceFilepath: filepath,
      normalizedName: normalizeComponentName(name),
      config: projectInfo.config,
    })
  }

  for (const payloadKey of Object.keys(payloads)) {
    const payload = payloads[payloadKey]
    let result: z.infer<typeof CreateResponsePayload>
    if (projectInfo.config.parser === 'react') {
      result = await createReactCodeConnect(payload as CreateRequestPayloadMulti)
    } else {
      try {
        const stdout = await callParser(
          // We use `as` because the React parser makes the types difficult
          // TODO remove once React is an executable parser
          projectInfo.config as CodeConnectExecutableParserConfig,
          payload as CreateRequestPayload,
          projectInfo.absPath,
        )

        result = CreateResponsePayload.parse(stdout)
      } catch (e) {
        throw fromError(e)
      }
    }

    const { hasErrors } = handleMessages(result.messages)

    if (!hasErrors) {
      result.createdFiles.forEach((file) => {
        logger.info(success(`Created ${file.filePath}`))
      })
    } else {
      allFilesCreated = false
    }
  }
  return allFilesCreated
}

export function convertRemoteFileUrlToRelativePath({
  remoteFileUrl,
  gitRootPath,
  dir,
}: {
  remoteFileUrl: string
  gitRootPath: string
  dir: string
}) {
  if (!gitRootPath) {
    return null
  }
  const pathWithinRepo = remoteFileUrl.replace(new RegExp(`.*?(tree|blob)/[^/]*`), '')

  if (!pathWithinRepo) {
    return null
  }
  const absPath = path.join(gitRootPath, pathWithinRepo)

  return path.relative(dir, absPath)
}

export async function getUnconnectedComponentsAndConnectedComponentMappings(
  cmd: BaseCommand,
  figmaFileUrl: string,
  componentsFromFile: FigmaRestApi.Component[],
  projectInfo: ProjectInfo<CodeConnectConfig> | ReactProjectInfo,
) {
  const dir = getDir(cmd)
  const fileKey = parseFileKey(figmaFileUrl)

  const codeConnectObjects = await getCodeConnectObjects(cmd, projectInfo, true)

  const connectedNodeIdsInFileToCodeConnectObjectMap = codeConnectObjects.reduce(
    (map, codeConnectJson) => {
      const parsedNode = parseFigmaNode(cmd.verbose, codeConnectJson, true)

      if (parsedNode && parsedNode.fileKey === fileKey) {
        map[parsedNode.nodeId] = codeConnectJson
      }

      return map
    },
    {} as Record<string, CodeConnectJSON>,
  )

  const unconnectedComponents: FigmaRestApi.Component[] = []
  const connectedComponentsMappings: ConnectedComponentMappings = []

  const gitRootPath = getGitRepoAbsolutePath(dir)

  componentsFromFile.map((c) => {
    if (c.id in connectedNodeIdsInFileToCodeConnectObjectMap) {
      const cc = connectedNodeIdsInFileToCodeConnectObjectMap[c.id]
      const relativePath = convertRemoteFileUrlToRelativePath({
        remoteFileUrl: cc.source!,
        gitRootPath,
        dir,
      })
      connectedComponentsMappings.push({
        componentName: c.name,
        filepathExport: relativePath ?? '(Unknown file)',
      })
    } else {
      unconnectedComponents.push(c)
    }
  })

  return {
    unconnectedComponents,
    connectedComponentsMappings,
  }
}

async function askForTopLevelDirectoryOrDetermineFromConfig({
  dir,
  hasConfigFile,
  config,
  cmd,
}: {
  dir: string
  hasConfigFile: boolean
  config: CodeConnectConfig
  cmd: BaseCommand
}) {
  let componentDirectory: string | null = null

  while (true) {
    if (!hasConfigFile) {
      const { componentDirectory: componentDirectoryAnswer } = await askQuestionOrExit({
        type: 'text',
        message: `Which top-level directory contains the code to be connected to your Figma design system? (Press ${chalk.green(
          'enter',
        )} to use current directory)`,
        name: 'componentDirectory',
        format: (val) => val || process.cwd(), // should this be || dir?
        validate: (value) => {
          if (!value) {
            return true
          }
          const isValidDir = fs.existsSync(value) && fs.lstatSync(value).isDirectory()

          if (!isValidDir) return 'Please enter a valid directory path.'
          return true
        },
      })
      componentDirectory = componentDirectoryAnswer
    }

    const configToUse: CodeConnectConfig = componentDirectory
      ? {
          ...config,
          include: getIncludesGlob({
            dir,
            componentDirectory,
            config,
          }),
        }
      : config

    const spinner = ora({
      text: 'Parsing local files...',
      color: 'green',
      spinner: {
        // Don't show spinner as ts.createProgram blocks thread
        frames: [''],
      },
    }).start()

    let projectInfo = await getProjectInfoFromConfig(dir, configToUse)
    if (projectInfo.config.parser === 'react') {
      projectInfo = getReactProjectInfo(projectInfo as ReactProjectInfo)
    }

    const filepathExports = getFilepathExportsFromFiles(projectInfo, cmd)
    spinner.stop()

    if (!filepathExports.length) {
      if (hasConfigFile) {
        logger.error(
          'No files found. Please update the include/exclude globs in your config file and try again.',
        )
        exitWithFeedbackMessage(1)
      } else {
        logger.error(
          'No files for your project type could be found in that directory. Please enter a different directory.',
        )
      }
    } else {
      return {
        projectInfo,
        componentDirectory,
        filepathExports,
      }
    }
  }
}

export async function runWizard(cmd: BaseCommand) {
  logger.info(
    boxen(
      `${chalk.bold(`Welcome to ${chalk.green('Code Connect')}`)}\n\n` +
        `Follow a few simple steps to connect your Figma design system to your codebase.\n` +
        `When you're done, you'll be able to see your component code while inspecting in\n` +
        `Figma's Dev Mode.\n\n` +
        `Learn more at ${chalk.cyan('https://www.figma.com/developers/code-connect')}.\n\n` +
        `Please raise bugs or feedback at ${chalk.cyan(
          'https://github.com/figma/code-connect/issues',
        )}.\n\n` +
        `${chalk.red.bold(
          'Note: ',
        )}This process will create and modify Code Connect files. Make sure you've\n` +
        `committed necessary changes in your codebase first.`,
      {
        padding: 1,
        margin: 1,
        textAlignment: 'center',
      },
    ),
  )

  const dir = getDir(cmd)
  const { hasConfigFile, config } = await parseOrDetermineConfig(dir, cmd.config)
  const { hasEnvFile, envHasFigmaToken } = await checkForEnvAndToken(dir)

  // This isn't ideal as you see the intro text followed by an error, but we'll
  // add support for this soon so I think it's OK
  if (config.parser === 'html') {
    exitWithError(
      'HTML projects are currently not supported by Code Connect interactive setup. Please use the "npx figma connect create" command instead.',
    )
  }

  let accessToken = getAccessToken(cmd)

  if (!accessToken) {
    const { accessTokenEntered } = await askQuestionOrExit({
      type: 'text',
      message: `No access token detected. Visit https://help.figma.com/hc/en-us/articles/8085703771159-Manage-personal-access-tokens
      for instructions on how to do this, ensuring you have both the File Content and Code Connect Write scopes \n\n  Please enter your access token:`,
      name: 'accessTokenEntered',
      validate: (value) => !!value || 'Please enter an access token.',
    })
    accessToken = accessTokenEntered
  }

  logger.info('')

  if (!hasEnvFile) {
    // If there is no .env file, we should ask the user if they want to create one
    // to store the Figma token.

    const { createConfigFile } = await askQuestionOrExit({
      type: 'select',
      name: 'createConfigFile',
      message:
        "It looks like you don't have a .env file. Would you like to generate one now to store the Figma access token?",
      choices: [
        {
          title: 'Yes',
          value: 'yes',
        },
        {
          title: 'No',
          value: 'no',
        },
      ],
    })

    if (createConfigFile === 'yes') {
      await createEnvFile({ dir, accessToken })
    }
  } else if (!envHasFigmaToken) {
    // If there is a .env file but no Figma token, we should ask the user if they want to add it.
    const { addFigmaToken } = await askQuestionOrExit({
      type: 'select',
      name: 'addFigmaToken',
      message: 'Would you like to add your Figma access token to your .env file?',
      choices: [
        {
          title: 'Yes',
          value: 'yes',
        },
        {
          title: 'No',
          value: 'no',
        },
      ],
    })

    if (addFigmaToken === 'yes') {
      addTokenToEnvFile({ dir, accessToken })
    }
  }

  const { componentDirectory, projectInfo, filepathExports } =
    await askForTopLevelDirectoryOrDetermineFromConfig({
      dir,
      hasConfigFile,
      config,
      cmd,
    })

  let figmaFileUrl: any
  if (config.interactiveSetupFigmaFileUrl) {
    logger.info(`Using Figma file URL from config: ${config.interactiveSetupFigmaFileUrl}\n`)
    figmaFileUrl = config.interactiveSetupFigmaFileUrl
  } else {
    let { figmaFileUrl: answer } = await askQuestionOrExit({
      type: 'text',
      message:
        "What is the URL of the Figma file containing design components you'd like to connect?",
      name: 'figmaFileUrl',
      validate: (value: string) => isValidFigmaUrl(value) || 'Please enter a valid Figma file URL.',
    })

    figmaFileUrl = answer
  }

  let componentsFromFile = await fetchTopLevelComponentsFromFile({
    accessToken,
    figmaUrl: figmaFileUrl,
    cmd,
  })

  if (!componentsFromFile) {
    exitWithFeedbackMessage(1)
  }

  if (!hasConfigFile) {
    const { createConfigFile } = await askQuestionOrExit({
      type: 'select',
      name: 'createConfigFile',
      message:
        "It looks like you don't have a Code Connect config file (figma.config.json). Would you like to generate one now from your provided answers?",
      choices: [
        {
          title: 'Yes',
          value: 'yes',
        },
        {
          title: 'No',
          value: 'no',
        },
      ],
    })
    if (createConfigFile === 'yes') {
      await createCodeConnectConfig({ dir, componentDirectory, config, figmaUrl: figmaFileUrl })
    }
  }

  let useAi = false

  if (projectInfo.config.parser === 'react') {
    const { useAi: useAiSelection } = await askQuestionOrExit({
      type: 'select',
      name: 'useAi',
      message:
        'Code Connect offers AI support to map properties between the Figma file and components in your codebase. Data is used only for mapping and is not stored or used for AI training. To learn more, visit https://help.figma.com/hc/en-us/articles/23920389749655-Code-Connect',
      choices: [
        {
          title: 'Do not use AI for prop mapping (default)',
          value: 'no',
        },
        {
          title: 'Use AI for prop mapping',
          value: 'yes',
        },
      ],
    })

    useAi = useAiSelection === 'yes'
  }

  const pagesFromFile: Record<string, string> = componentsFromFile.reduce(
    (acc, c) => {
      acc[c.pageId] = c.pageName
      return acc
    },
    {} as Record<string, string>,
  )
  const pagesFromFileCount = Object.keys(pagesFromFile).length

  if (componentsFromFile.length > MAX_COMPONENTS_TO_MAP && pagesFromFileCount > 1) {
    logger.info(
      `${componentsFromFile.length} Figma components found in the Figma file across ${pagesFromFileCount} pages.`,
    )
    componentsFromFile = await narrowDownComponentsPerPage(componentsFromFile, pagesFromFile)
  }

  const linkedNodeIdsToFilepathExports = {}

  const { unconnectedComponents, connectedComponentsMappings } =
    await getUnconnectedComponentsAndConnectedComponentMappings(
      cmd,
      figmaFileUrl,
      componentsFromFile,
      projectInfo,
    )

  autoLinkComponents({
    unconnectedComponents,
    linkedNodeIdsToFilepathExports,
    filepathExports,
  })

  logger.info(
    boxen(
      `${chalk.bold(`Connecting your Figma components`)}\n\n` +
        `${chalk.green(
          `${chalk.bold(Object.keys(linkedNodeIdsToFilepathExports).length)} ${
            Object.keys(linkedNodeIdsToFilepathExports).length === 1
              ? 'component was automatically matched based on its name'
              : 'components were automatically matched based on their names'
          }`,
        )}\n` +
        `${chalk.yellow(
          `${chalk.bold(unconnectedComponents.length)} ${
            unconnectedComponents.length === 1
              ? 'component has not been matched'
              : 'components have not been matched'
          }`,
        )}\n\n` +
        `Match up Figma components with their code definitions. When you're finished, you\n` +
        `can specify the directory you want to create Code Connect files in.`,
      {
        padding: 1,
        margin: 1,
        textAlignment: 'center',
      },
    ),
  )

  const outDir = await runManualLinkingWithConfirmation({
    unconnectedComponents,
    connectedComponentsMappings,
    linkedNodeIdsToFilepathExports,
    filepathExports,
    cmd,
  })

  const unconnectedComponentsMap = unconnectedComponents.reduce(
    (map, component) => {
      map[component.id] = component
      return map
    },
    {} as Record<string, FigmaRestApi.Component>,
  )

  const success = await createCodeConnectFiles({
    linkedNodeIdsToFilepathExports,
    unconnectedComponentsMap,
    figmaFileUrl,
    outDir,
    projectInfo,
    cmd,
    accessToken,
    useAi,
  })

  if (success) {
    logger.info(`\nUse the 'publish' command to make mappings visible in Figma Dev Mode.`)
  }
}
