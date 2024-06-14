import * as ts from 'typescript'
import { InternalError, ParserContext, ParserError } from '../react/parser'
import {
  assertIsArrayLiteralExpression,
  assertIsStringLiteral,
  stripQuotes,
} from '../typescript/compiler'
import { convertObjectLiteralToJs } from '../typescript/compiler'
import { assertIsObjectLiteralExpression } from '../typescript/compiler'
import { FigmaConnectAPI } from './api'
import {
  FCCValue,
  _fcc_function,
  _fcc_identifier,
  _fcc_jsxElement,
  _fcc_object,
  _fcc_templateString,
} from '../react/parser_template_helpers'

export const API_PREFIX = 'figma'
export const FIGMA_CONNECT_CALL = `${API_PREFIX}.connect`

export enum IntrinsicKind {
  Enum = 'enum',
  String = 'string',
  Boolean = 'boolean',
  Instance = 'instance',
  Children = 'children',
  NestedProps = 'nested-props',
  ClassName = 'className',
  TextContent = 'text-content',
}

export interface IntrinsicBase {
  kind: IntrinsicKind
  args: {}
}

export type ValueMappingKind = FCCValue | Intrinsic

export interface FigmaBoolean extends IntrinsicBase {
  kind: IntrinsicKind.Boolean
  args: {
    figmaPropName: string
    valueMapping?: Record<'true' | 'false', ValueMappingKind>
  }
}

export interface FigmaEnum extends IntrinsicBase {
  kind: IntrinsicKind.Enum
  args: {
    figmaPropName: string
    valueMapping: Record<string, ValueMappingKind>
  }
}

export interface FigmaString extends IntrinsicBase {
  kind: IntrinsicKind.String
  args: {
    figmaPropName: string
  }
}

export interface FigmaInstance extends IntrinsicBase {
  kind: IntrinsicKind.Instance
  args: {
    figmaPropName: string
  }
}

export interface FigmaChildren extends IntrinsicBase {
  kind: IntrinsicKind.Children
  args: {
    layers: string[]
  }
}

export interface FigmaNestedProps extends IntrinsicBase {
  kind: IntrinsicKind.NestedProps
  args: {
    layer: string
    props: Record<string, Intrinsic>
  }
}

export interface FigmaClassName extends IntrinsicBase {
  kind: IntrinsicKind.ClassName
  args: {
    className: (string | Intrinsic)[]
  }
}

export interface FigmaTextContent extends IntrinsicBase {
  kind: IntrinsicKind.TextContent
  args: {
    layer: string
  }
}

export type Intrinsic =
  | FigmaBoolean
  | FigmaEnum
  | FigmaString
  | FigmaInstance
  | FigmaChildren
  | FigmaNestedProps
  | FigmaClassName
  | FigmaTextContent

const Intrinsics: {
  [key: string]: {
    match: (exp: ts.CallExpression) => exp is ts.CallExpression
    parse: (exp: ts.CallExpression, parser: ParserContext) => Intrinsic
  }
} = {}

/**
 * These functions are used to convert "intrinsic" parser types (which are calls to helper functions
 * like `Figma.boolean() in code)` to an object representing that intrinsic that we can serialize to JSON.
 *
 * Each call to `makeIntrinsic` should take a function from the {@link FigmaConnectAPI},
 * ensuring that the name of the intrinsic that we're parsing matches the name of the function
 *
 * @param staticFunctionMember
 * @param obj
 */
function makeIntrinsic<K extends keyof FigmaConnectAPI>(
  intrinsicName: K,
  obj: (name: string) => any,
) {
  const name = `${API_PREFIX}.${intrinsicName}`
  Intrinsics[name] = {
    match: (exp: ts.CallExpression) => {
      return ts.isCallExpression(exp) && exp.getText().startsWith(name)
    },
    ...obj(name),
  }
}

makeIntrinsic('boolean', (name) => {
  return {
    parse: (exp: ts.CallExpression, ctx: ParserContext): FigmaBoolean => {
      const figmaPropNameIdentifier = exp.arguments?.[0]
      assertIsStringLiteral(
        figmaPropNameIdentifier,
        ctx.sourceFile,
        `${name} takes at least one argument, which is the Figma property name`,
      )
      const valueMappingArg = exp.arguments?.[1]
      let valueMapping
      if (valueMappingArg) {
        assertIsObjectLiteralExpression(
          valueMappingArg,
          ctx.sourceFile,
          `${name} second argument should be an object literal, that sets values for 'true' and 'false'`,
        )
        valueMapping = parsePropsObject(valueMappingArg, ctx) as Record<
          'true' | 'false',
          ValueMappingKind
        >
      }
      return {
        kind: IntrinsicKind.Boolean,
        args: {
          figmaPropName: stripQuotes(figmaPropNameIdentifier),
          valueMapping,
        },
      }
    },
  }
})

makeIntrinsic('enum', (name) => {
  return {
    parse: (exp: ts.CallExpression, ctx: ParserContext): FigmaEnum => {
      const { sourceFile } = ctx
      const figmaPropNameIdentifier = exp.arguments?.[0]
      assertIsStringLiteral(
        figmaPropNameIdentifier,
        sourceFile,
        `${name} takes at least one argument, which is the Figma property name`,
      )
      const valueMapping = exp.arguments?.[1]
      assertIsObjectLiteralExpression(
        valueMapping,
        sourceFile,
        `${name} second argument should be an object literal, that maps Figma prop values to code`,
      )
      return {
        kind: IntrinsicKind.Enum,
        args: {
          figmaPropName: stripQuotes(figmaPropNameIdentifier),
          valueMapping: parsePropsObject(valueMapping, ctx),
        },
      }
    },
  }
})

makeIntrinsic('string', (name) => {
  return {
    parse: (exp: ts.CallExpression, ctx: ParserContext): FigmaString => {
      const { sourceFile } = ctx
      const figmaPropNameIdentifier = exp.arguments?.[0]
      assertIsStringLiteral(
        figmaPropNameIdentifier,
        sourceFile,
        `${name} takes at least one argument, which is the Figma property name`,
      )
      return {
        kind: IntrinsicKind.String,
        args: {
          figmaPropName: stripQuotes(figmaPropNameIdentifier),
        },
      }
    },
  }
})

makeIntrinsic('instance', (name) => {
  return {
    parse: (exp: ts.CallExpression, ctx: ParserContext): FigmaInstance => {
      const { sourceFile } = ctx
      const figmaPropNameIdentifier = exp.arguments?.[0]
      assertIsStringLiteral(
        figmaPropNameIdentifier,
        sourceFile,
        `${name} takes at least one argument, which is the Figma property name`,
      )
      return {
        kind: IntrinsicKind.Instance,
        args: {
          figmaPropName: stripQuotes(figmaPropNameIdentifier),
        },
      }
    },
  }
})

makeIntrinsic('children', (name) => {
  return {
    parse: (exp: ts.CallExpression, ctx: ParserContext): FigmaChildren => {
      const { sourceFile } = ctx
      const layerName = exp.arguments?.[0]
      const layers: string[] = []
      if (ts.isStringLiteral(layerName)) {
        layers.push(stripQuotes(layerName))
      } else if (ts.isArrayLiteralExpression(layerName) && layerName.elements.length > 0) {
        layerName.elements.forEach((el) => {
          assertIsStringLiteral(el, sourceFile)
          const name = stripQuotes(el)
          if (name.includes('*')) {
            throw new ParserError(
              `Wildcards can not be used with an array of strings. Use a single string literal instead.`,
              {
                node: layerName,
                sourceFile,
              },
            )
          }
          layers.push(stripQuotes(el))
        })
      } else {
        throw new ParserError(
          `Invalid argument to ${name}, should be a string literal or an array of strings`,
          {
            node: layerName,
            sourceFile,
          },
        )
      }

      return {
        kind: IntrinsicKind.Children,
        args: {
          layers,
        },
      }
    },
  }
})

makeIntrinsic('nestedProps', (name) => {
  return {
    parse: (exp: ts.CallExpression, ctx: ParserContext): FigmaNestedProps => {
      const { sourceFile } = ctx
      const layerName = exp.arguments?.[0]
      const mapping = exp.arguments?.[1]

      assertIsStringLiteral(
        layerName,
        sourceFile,
        `Invalid argument to ${name}, \`layerName\` should be a string literal`,
      )
      assertIsObjectLiteralExpression(
        mapping,
        sourceFile,
        `Invalid argument to ${name}, \`props\` should be an object literal`,
      )

      return {
        kind: IntrinsicKind.NestedProps,
        args: {
          layer: stripQuotes(layerName),
          props: parsePropsObject(mapping, ctx),
        },
      }
    },
  }
})

makeIntrinsic('className', (name) => {
  return {
    parse: (exp: ts.CallExpression, ctx: ParserContext): FigmaClassName => {
      const { sourceFile } = ctx
      const classNameArg = exp.arguments?.[0]
      const className: (string | Intrinsic)[] = []
      assertIsArrayLiteralExpression(classNameArg, sourceFile, `${name} takes an array of strings`)

      classNameArg.elements.forEach((el) => {
        if (ts.isStringLiteral(el)) {
          className.push(stripQuotes(el))
        } else if (ts.isCallExpression(el)) {
          className.push(parseIntrinsic(el, ctx))
        }
      })

      return {
        kind: IntrinsicKind.ClassName,
        args: {
          className,
        },
      }
    },
  }
})

makeIntrinsic('textContent', (name) => {
  return {
    parse: (exp: ts.CallExpression, ctx: ParserContext): FigmaTextContent => {
      const { sourceFile } = ctx
      const layerNameArg = exp.arguments?.[0]
      assertIsStringLiteral(
        layerNameArg,
        sourceFile,
        `${name} takes a single argument which is the Figma layer name`,
      )

      return {
        kind: IntrinsicKind.TextContent,
        args: {
          layer: stripQuotes(layerNameArg),
        },
      }
    },
  }
})

/**
 * Parses a call expression to an intrinsic
 *
 * @param exp Expression to parse
 * @param parserContext parser context
 * @returns
 */
export function parseIntrinsic(exp: ts.CallExpression, parserContext: ParserContext): Intrinsic {
  for (const key in Intrinsics) {
    if (Intrinsics[key].match(exp)) {
      return Intrinsics[key].parse(exp, parserContext)
    }
  }

  throw new ParserError(`Unknown intrinsic: ${exp.getText()}`, {
    node: exp,
    sourceFile: parserContext.sourceFile,
  })
}

/**
 * Replace newlines in enum values with \\n so that we don't output
 * broken JS with newlines inside the string
 */
function replaceNewlines(str: string) {
  return str.toString().replaceAll('\n', '\\n').replaceAll("'", "\\'")
}

export function valueMappingToString(
  valueMapping: Record<string, ValueMappingKind>,
  childLayer?: string,
): string {
  // For enums (and booleans with a valueMapping provided), convert the
  // value mapping to an object.
  return (
    '{\n' +
    Object.entries(valueMapping)
      .map(([key, value]) => {
        if (
          typeof value === 'boolean' ||
          typeof value === 'number' ||
          typeof value === 'undefined'
        ) {
          return `"${key}": ${value}`
        }

        if (typeof value === 'string') {
          return `"${key}": '${replaceNewlines(value)}'`
        }

        if ('kind' in value) {
          // Mappings can be nested, e.g. an enum value can be figma.instance(...)
          return `"${key}": ${intrinsicToString(value as Intrinsic, childLayer)}`
        }

        const v = replaceNewlines(value.value)
        switch (value.type) {
          case 'function':
            return `"${key}": _fcc_function('${v}')`
          case 'identifier':
            return `"${key}": _fcc_identifier('${v}')`
          case 'object':
            return `"${key}": _fcc_object('${v}')`
          case 'template-string':
            return `"${key}": _fcc_templateString('${v}')`
          case 'jsx-element':
            return `"${key}": _fcc_jsxElement('${v}')`
          default:
            throw new InternalError(`Unknown helper type: ${value}`)
        }
      })
      .join(',\n') +
    '}'
  )
}

export function intrinsicToString({ kind, args }: Intrinsic, childLayer?: string): string {
  const selector = childLayer ?? `figma.currentLayer`
  switch (kind) {
    case IntrinsicKind.String:
    case IntrinsicKind.Instance: {
      // Outputs:
      // `const propName = figma.properties.string('propName')`, or
      // `const propName = figma.properties.boolean('propName')`, or
      // `const propName = figma.properties.instance('propName')`
      return `${selector}.__properties__.${kind}('${args.figmaPropName}')`
    }
    case IntrinsicKind.Boolean: {
      if (args.valueMapping) {
        const mappingString = valueMappingToString(args.valueMapping)
        // Outputs: `const propName = figma.properties.boolean('propName', { ... mapping object from above ... })`
        return `${selector}.__properties__.boolean('${args.figmaPropName}', ${mappingString})`
      }
      return `${selector}.__properties__.boolean('${args.figmaPropName}')`
    }
    case IntrinsicKind.Enum: {
      const mappingString = valueMappingToString(args.valueMapping)

      // Outputs: `const propName = figma.properties.enum('propName', { ... mapping object from above ... })`
      return `${selector}.__properties__.enum('${args.figmaPropName}', ${mappingString})`
    }
    case IntrinsicKind.Children: {
      // Outputs: `const propName = figma.properties.children(["Layer 1", "Layer 2"])`
      return `${selector}.__properties__.children([${args.layers.map((layerName) => `"${layerName}"`).join(',')}])`
    }
    case IntrinsicKind.ClassName: {
      // Outputs: `const propName = ['btn-base', figma.currentLayer.__properties__.enum('Size, { Large: 'btn-large' })].join(" ")`
      return `[${args.className.map((className) => (typeof className === 'string' ? `"${className}"` : `${intrinsicToString(className, childLayer)}`)).join(', ')}].filter(v => !!v).join(' ')`
    }
    case IntrinsicKind.TextContent: {
      return `${selector}.__findChildWithCriteria__({ name: '${args.layer}', type: "TEXT" }).textContent`
    }
    case IntrinsicKind.NestedProps: {
      throw new ParserError(
        `Deeply nested props should be expressed on the root level by passing the name of the inner layer`,
      )
    }
    default:
      throw new InternalError(`Unknown intrinsic: ${kind}`)
  }
}

function expressionToFccEnumValue(valueNode: ts.Expression, sourceFile: ts.SourceFile): FCCValue {
  if (ts.isParenthesizedExpression(valueNode)) {
    return expressionToFccEnumValue(valueNode.expression, sourceFile)
  }

  if (ts.isJsxElement(valueNode) || ts.isJsxSelfClosingElement(valueNode)) {
    return _fcc_jsxElement(valueNode.getText())
  }

  if (ts.isArrowFunction(valueNode) || ts.isFunctionExpression(valueNode)) {
    return _fcc_function(valueNode.getText())
  }

  if (ts.isObjectLiteralExpression(valueNode)) {
    return _fcc_object(valueNode.getText())
  }

  if (ts.isTemplateLiteral(valueNode)) {
    const str = valueNode.getText().replaceAll('`', '')
    return _fcc_templateString(str)
  }

  if (ts.isPropertyAccessExpression(valueNode)) {
    return _fcc_identifier(valueNode.getText())
  }

  // Fall back to the default conversion in `convertObjectLiteralToJs`
  return undefined
}

/**
 * Parses the `props` field in a `figma.connect()` call, returning a mapping of
 * prop names to their respective intrinsic types
 *
 * @param objectLiteral An object literal expression
 * @param parserContext Parser context
 * @returns
 */
export function parsePropsObject(
  objectLiteral: ts.ObjectLiteralExpression,
  parserContext: ParserContext,
): PropMappings {
  const { sourceFile, checker } = parserContext
  return convertObjectLiteralToJs(objectLiteral, sourceFile, checker, (valueNode) => {
    if (ts.isCallExpression(valueNode)) {
      return parseIntrinsic(valueNode, parserContext)
    }
    return expressionToFccEnumValue(valueNode, sourceFile)
  }) as PropMappings
}

export type PropMappings = Record<string, Intrinsic>
