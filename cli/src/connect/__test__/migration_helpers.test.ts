import { migrateV1TemplateToV2, migrateTemplateToUseServerSideHelpers } from '../migration_helpers'

describe('migrateV1TemplateToV2', () => {
  describe('Core object rename', () => {
    it('should rename figma.currentLayer to figma.selectedInstance', () => {
      const input = `const figma = require('figma')
const prop = figma.currentLayer.__properties__.string('Text')`
      const expected = `const figma = require('figma')
const prop = figma.selectedInstance.getString('Text')`
      expect(migrateV1TemplateToV2(input)).toBe(expected)
    })

    it('should handle multiple occurrences of figma.currentLayer', () => {
      const input = `const prop1 = figma.currentLayer.__properties__.string('Text')
const prop2 = figma.currentLayer.__properties__.boolean('Bool')`
      const expected = `const prop1 = figma.selectedInstance.getString('Text')
const prop2 = figma.selectedInstance.getBoolean('Bool')`
      expect(migrateV1TemplateToV2(input)).toBe(expected)
    })
  })

  describe('Property accessor methods', () => {
    it('should migrate __properties__.string() to getString()', () => {
      const input = `const text = figma.currentLayer.__properties__.string('Label')`
      const expected = `const text = figma.selectedInstance.getString('Label')`
      expect(migrateV1TemplateToV2(input)).toBe(expected)
    })

    it('should migrate __properties__.boolean() to getBoolean()', () => {
      const input = `const disabled = figma.currentLayer.__properties__.boolean('Disabled')`
      const expected = `const disabled = figma.selectedInstance.getBoolean('Disabled')`
      expect(migrateV1TemplateToV2(input)).toBe(expected)
    })

    it('should migrate __properties__.boolean() with options to getBoolean()', () => {
      const input = `const icon = figma.currentLayer.__properties__.boolean('Icon', {
"true": 'icon',
"false": undefined})`
      const expected = `const icon = figma.selectedInstance.getBoolean('Icon', {
"true": 'icon',
"false": undefined})`
      expect(migrateV1TemplateToV2(input)).toBe(expected)
    })

    it('should migrate __properties__.enum() to getEnum()', () => {
      const input = `const size = figma.currentLayer.__properties__.enum('Size', {
"Large": 'large',
"Small": 'small'})`
      const expected = `const size = figma.selectedInstance.getEnum('Size', {
"Large": 'large',
"Small": 'small'})`
      expect(migrateV1TemplateToV2(input)).toBe(expected)
    })

    it('should migrate __properties__.__instance__() to getInstanceSwap()', () => {
      const input = `const instance = figma.currentLayer.__properties__.__instance__('Icon')`
      const expected = `const instance = figma.selectedInstance.getInstanceSwap('Icon')`
      expect(migrateV1TemplateToV2(input)).toBe(expected)
    })

    it('should handle all property methods in the same template', () => {
      const input = `const str = figma.currentLayer.__properties__.string('Text')
const bool = figma.currentLayer.__properties__.boolean('Disabled')
const enumVal = figma.currentLayer.__properties__.enum('Size', { "Large": 'lg' })
const inst = figma.currentLayer.__properties__.__instance__('Icon')`
      const expected = `const str = figma.selectedInstance.getString('Text')
const bool = figma.selectedInstance.getBoolean('Disabled')
const enumVal = figma.selectedInstance.getEnum('Size', { "Large": 'lg' })
const inst = figma.selectedInstance.getInstanceSwap('Icon')`
      expect(migrateV1TemplateToV2(input)).toBe(expected)
    })
  })

  describe('Other method renames', () => {
    it('should migrate __getPropertyValue__() to getPropertyValue()', () => {
      const input = `const value = figma.currentLayer.__getPropertyValue__('PropName')`
      const expected = `const value = figma.selectedInstance.getPropertyValue('PropName')`
      expect(migrateV1TemplateToV2(input)).toBe(expected)
    })
  })

  describe('Export format - simple case', () => {
    it('should wrap simple figma.code export in V2 format', () => {
      const input = `export default figma.code\`<Component />\``
      const expected = `export default { example: figma.code\`<Component />\` }`
      expect(migrateV1TemplateToV2(input)).toBe(expected)
    })

    it('should wrap simple figma.tsx export in V2 format', () => {
      const input = `export default figma.tsx\`<Component />\``
      const expected = `export default { example: figma.tsx\`<Component />\` }`
      expect(migrateV1TemplateToV2(input)).toBe(expected)
    })

    it('should wrap simple figma.html export in V2 format', () => {
      const input = `export default figma.html\`<div></div>\``
      const expected = `export default { example: figma.html\`<div></div>\` }`
      expect(migrateV1TemplateToV2(input)).toBe(expected)
    })

    it('should wrap simple figma.swift export in V2 format', () => {
      const input = `export default figma.swift\`Button()\``
      const expected = `export default { example: figma.swift\`Button()\` }`
      expect(migrateV1TemplateToV2(input)).toBe(expected)
    })

    it('should wrap simple figma.kotlin export in V2 format', () => {
      const input = `export default figma.kotlin\`Button()\``
      const expected = `export default { example: figma.kotlin\`Button()\` }`
      expect(migrateV1TemplateToV2(input)).toBe(expected)
    })

    it('should handle multiline template literals', () => {
      const input = `export default figma.tsx\`<Button>
  \${label}
</Button>\``
      const expected = `export default { example: figma.tsx\`<Button>
  \${label}
</Button>\` }`
      expect(migrateV1TemplateToV2(input)).toBe(expected)
    })
  })

  describe('Export format - spread operator case', () => {
    it('should migrate spread operator export format', () => {
      const input = `export default { ...figma.tsx\`<Component />\`, metadata: { __props } }`
      const expected = `export default { example: figma.tsx\`<Component />\`, metadata: { __props } }`
      expect(migrateV1TemplateToV2(input)).toBe(expected)
    })

    it('should handle spread operator with various template types', () => {
      const input = `export default { ...figma.code\`code\`, metadata: { __props } }`
      const expected = `export default { example: figma.code\`code\`, metadata: { __props } }`
      expect(migrateV1TemplateToV2(input)).toBe(expected)
    })

    it('should handle spread operator with whitespace variations', () => {
      const input = `export default {  ...figma.tsx\`<Component />\`, metadata: { __props } }`
      const expected = `export default { example: figma.tsx\`<Component />\`, metadata: { __props } }`
      expect(migrateV1TemplateToV2(input)).toBe(expected)
    })
  })

  describe('Real-world template examples', () => {
    it('should migrate a complete V1 template with props and metadata', () => {
      const input = `const figma = require('figma')

const variant = figma.currentLayer.__properties__.enum('Variant', {
"Primary": 'primary',
"Secondary": 'secondary'})
const disabled = figma.currentLayer.__properties__.boolean('Disabled')
const label = figma.currentLayer.__properties__.string('Label')
const __props = {}
if (variant && variant.type !== 'ERROR') {
  __props["variant"] = variant
}
if (disabled && disabled.type !== 'ERROR') {
  __props["disabled"] = disabled
}
if (label && label.type !== 'ERROR') {
  __props["label"] = label
}

export default { ...figma.tsx\`<Button\${_fcc_renderReactProp('variant', variant)}\${_fcc_renderReactProp('disabled', disabled)}>
  \${_fcc_renderReactChildren(label)}
</Button>\`, metadata: { __props } }`

      const expected = `const figma = require('figma')

const variant = figma.selectedInstance.getEnum('Variant', {
"Primary": 'primary',
"Secondary": 'secondary'})
const disabled = figma.selectedInstance.getBoolean('Disabled')
const label = figma.selectedInstance.getString('Label')
const __props = {}
if (variant && variant.type !== 'ERROR') {
  __props["variant"] = variant
}
if (disabled && disabled.type !== 'ERROR') {
  __props["disabled"] = disabled
}
if (label && label.type !== 'ERROR') {
  __props["label"] = label
}

export default { example: figma.tsx\`<Button\${_fcc_renderReactProp('variant', variant)}\${_fcc_renderReactProp('disabled', disabled)}>
  \${_fcc_renderReactChildren(label)}
</Button>\`, metadata: { __props } }`

      expect(migrateV1TemplateToV2(input)).toBe(expected)
    })

    it('should migrate a simple template without metadata', () => {
      const input = `const figma = require('figma')
const text = figma.currentLayer.__properties__.string('Text')

export default figma.code\`def python_code():
  return \${text}\``

      const expected = `const figma = require('figma')
const text = figma.selectedInstance.getString('Text')

export default { example: figma.code\`def python_code():
  return \${text}\` }`

      expect(migrateV1TemplateToV2(input)).toBe(expected)
    })
  })

  describe('Legacy find methods', () => {
    describe('__findChildWithCriteria__', () => {
      it('should migrate TEXT type with __render__() to findText().textContent', () => {
        const input = `const text = figma.selectedInstance.__findChildWithCriteria__({ name: 'Label', type: "TEXT" }).__render__()`
        const expected = `const text = figma.selectedInstance.findText('Label').textContent`
        expect(migrateV1TemplateToV2(input)).toBe(expected)
      })

      it('should handle TEXT type with reversed parameter order', () => {
        const input = `const text = figma.selectedInstance.__findChildWithCriteria__({ type: "TEXT", name: 'Label' }).__render__()`
        const expected = `const text = figma.selectedInstance.findText('Label').textContent`
        expect(migrateV1TemplateToV2(input)).toBe(expected)
      })

      it('should migrate INSTANCE type to findInstance()', () => {
        const input = `const instance = figma.selectedInstance.__findChildWithCriteria__({ name: 'Icon', type: 'INSTANCE' })`
        const expected = `const instance = figma.selectedInstance.findInstance('Icon')`
        expect(migrateV1TemplateToV2(input)).toBe(expected)
      })

      it('should handle INSTANCE type with reversed parameter order', () => {
        const input = `const instance = figma.selectedInstance.__findChildWithCriteria__({ type: 'INSTANCE', name: 'Icon' })`
        const expected = `const instance = figma.selectedInstance.findInstance('Icon')`
        expect(migrateV1TemplateToV2(input)).toBe(expected)
      })

      it('should migrate TEXT type without __render__() to findText()', () => {
        const input = `const textHandle = figma.selectedInstance.__findChildWithCriteria__({ name: 'Label', type: 'TEXT' })`
        const expected = `const textHandle = figma.selectedInstance.findText('Label')`
        expect(migrateV1TemplateToV2(input)).toBe(expected)
      })

      it('should handle TEXT type with double quotes', () => {
        const input = `const text = figma.selectedInstance.__findChildWithCriteria__({ name: 'Label', type: "TEXT" }).__render__()`
        const expected = `const text = figma.selectedInstance.findText('Label').textContent`
        expect(migrateV1TemplateToV2(input)).toBe(expected)
      })

      it('should handle INSTANCE type with double quotes', () => {
        const input = `const instance = figma.selectedInstance.__findChildWithCriteria__({ name: 'Icon', type: "INSTANCE" })`
        const expected = `const instance = figma.selectedInstance.findInstance('Icon')`
        expect(migrateV1TemplateToV2(input)).toBe(expected)
      })
    })

    describe('__find__', () => {
      it('should migrate __find__() to findInstance() with single quotes', () => {
        const input = `const child = figma.selectedInstance.__find__('ChildName')`
        const expected = `const child = figma.selectedInstance.findInstance("ChildName")`
        expect(migrateV1TemplateToV2(input)).toBe(expected)
      })

      it('should migrate __find__() to findInstance() with double quotes', () => {
        const input = `const child = figma.selectedInstance.__find__("ChildName")`
        const expected = `const child = figma.selectedInstance.findInstance("ChildName")`
        expect(migrateV1TemplateToV2(input)).toBe(expected)
      })

      it('should handle multiple __find__() calls', () => {
        const input = `const child1 = figma.selectedInstance.__find__('Child1')
const child2 = figma.selectedInstance.__find__('Child2')`
        const expected = `const child1 = figma.selectedInstance.findInstance("Child1")
const child2 = figma.selectedInstance.findInstance("Child2")`
        expect(migrateV1TemplateToV2(input)).toBe(expected)
      })
    })
  })

  describe('Template execution methods', () => {
    describe('__render__', () => {
      it('should migrate __render__() to executeTemplate().example', () => {
        const input = `const rendered = instance.__render__()`
        const expected = `const rendered = instance.executeTemplate().example`
        expect(migrateV1TemplateToV2(input)).toBe(expected)
      })

      it('should handle multiple __render__() calls', () => {
        const input = `const r1 = instance1.__render__()
const r2 = instance2.__render__()`
        const expected = `const r1 = instance1.executeTemplate().example
const r2 = instance2.executeTemplate().example`
        expect(migrateV1TemplateToV2(input)).toBe(expected)
      })

      it('should not double-migrate __render__() from __findChildWithCriteria__()', () => {
        // __render__() should already be handled by __findChildWithCriteria__ migration
        const input = `const text = figma.selectedInstance.__findChildWithCriteria__({ name: 'Label', type: "TEXT" }).__render__()`
        const result = migrateV1TemplateToV2(input)
        // Should become findText().textContent, not findText().__render__() or findText().executeTemplate().example
        expect(result).toBe(`const text = figma.selectedInstance.findText('Label').textContent`)
        expect(result).not.toContain('__render__')
        expect(result).not.toContain('executeTemplate')
      })
    })

    describe('__getProps__', () => {
      it('should migrate __getProps__() to executeTemplate().metadata.props', () => {
        const input = `const props = instance.__getProps__()`
        const expected = `const props = instance.executeTemplate().metadata.props`
        expect(migrateV1TemplateToV2(input)).toBe(expected)
      })

      it('should handle multiple __getProps__() calls', () => {
        const input = `const p1 = instance1.__getProps__()
const p2 = instance2.__getProps__()`
        const expected = `const p1 = instance1.executeTemplate().metadata.props
const p2 = instance2.executeTemplate().metadata.props`
        expect(migrateV1TemplateToV2(input)).toBe(expected)
      })
    })
  })

  describe('Real-world generated patterns', () => {
    it('should migrate TextContent intrinsic pattern', () => {
      // This is the pattern generated by intrinsics.ts for TextContent
      const input = `figma.selectedInstance.__findChildWithCriteria__({ name: 'Label', type: "TEXT" }).__render__()`
      const expected = `figma.selectedInstance.findText('Label').textContent`
      expect(migrateV1TemplateToV2(input)).toBe(expected)
    })

    it('should migrate NestedProps intrinsic pattern', () => {
      // This is the pattern generated by intrinsics.ts for NestedProps
      const input = `const nestedLayer0 = figma.selectedInstance.__find__("IconLayer")
return nestedLayer0.type === "ERROR" ? nestedLayer0 : {
  iconName: nestedLayer0.getString('Name')
}`
      const expected = `const nestedLayer0 = figma.selectedInstance.findInstance("IconLayer")
return nestedLayer0.type === "ERROR" ? nestedLayer0 : {
  iconName: nestedLayer0.getString('Name')
}`
      expect(migrateV1TemplateToV2(input)).toBe(expected)
    })

    it('should migrate GetProps modifier pattern', () => {
      // This is the pattern generated by modifiers.ts for GetProps
      const input = `const props = nestedInstance.__getProps__()`
      const expected = `const props = nestedInstance.executeTemplate().metadata.props`
      expect(migrateV1TemplateToV2(input)).toBe(expected)
    })
  })

  describe('Instance property accessor', () => {
    it('should migrate __properties__.instance() to getInstanceSwap().executeTemplate().example', () => {
      const input = `const icon = figma.selectedInstance.__properties__.instance('Icon')`
      const expected = `const icon = figma.selectedInstance.getInstanceSwap('Icon').executeTemplate().example`
      expect(migrateV1TemplateToV2(input)).toBe(expected)
    })

    it('should handle __properties__.instance() with double quotes', () => {
      const input = `const icon = figma.selectedInstance.__properties__.instance("Icon")`
      const expected = `const icon = figma.selectedInstance.getInstanceSwap("Icon").executeTemplate().example`
      expect(migrateV1TemplateToV2(input)).toBe(expected)
    })

    it('should handle multiple __properties__.instance() calls', () => {
      const input = `const icon1 = figma.selectedInstance.__properties__.instance('Icon1')
const icon2 = figma.selectedInstance.__properties__.instance('Icon2')`
      const expected = `const icon1 = figma.selectedInstance.getInstanceSwap('Icon1').executeTemplate().example
const icon2 = figma.selectedInstance.getInstanceSwap('Icon2').executeTemplate().example`
      expect(migrateV1TemplateToV2(input)).toBe(expected)
    })

    it('should handle __properties__.instance() in template literals', () => {
      const input = `export default { example: figma.code\`<Component icon=\${figma.selectedInstance.__properties__.instance('Icon')} />\` }`
      const expected = `export default { example: figma.code\`<Component icon=\${figma.selectedInstance.getInstanceSwap('Icon').executeTemplate().example} />\` }`
      expect(migrateV1TemplateToV2(input)).toBe(expected)
    })

    it('should not confuse __properties__.instance() with __properties__.__instance__()', () => {
      // __properties__.__instance__() should only add .getInstanceSwap(), not .executeTemplate().example
      const input = `const instanceHandle = figma.selectedInstance.__properties__.__instance__('Icon')`
      const expected = `const instanceHandle = figma.selectedInstance.getInstanceSwap('Icon')`
      expect(migrateV1TemplateToV2(input)).toBe(expected)
    })
  })

  describe('Patterns intentionally NOT migrated', () => {
    it('should leave __properties__.children() as-is (still supported)', () => {
      const input = `const children = figma.currentLayer.__properties__.children(['Child1', 'Child2'])`
      const result = migrateV1TemplateToV2(input)
      // Should migrate currentLayer but leave .children() alone
      expect(result).toContain('figma.selectedInstance')
      expect(result).toContain('.__properties__.children(')
    })

    it('should leave __renderWithFn__() as-is (complex transformation)', () => {
      const input = `const rendered = instance.__renderWithFn__(({prop1, prop2}) => figma.code\\\`<Component prop1=\${prop1} />\\\`)`
      const result = migrateV1TemplateToV2(input)
      // Should still contain __renderWithFn__ as it's not migrated
      expect(result).toContain('__renderWithFn__')
    })

    it('should leave __props metadata pattern as-is', () => {
      const input = `const __props = {}
if (variant && variant.type !== 'ERROR') {
  __props["variant"] = variant
}`
      const result = migrateV1TemplateToV2(input)
      expect(result).toBe(input)
    })
  })

  describe('Edge cases', () => {
    it('should handle already migrated V2 templates (idempotent)', () => {
      const input = `const figma = require('figma')
const text = figma.selectedInstance.getString('Text')
export default { example: figma.code\`<Component />\` }`
      const result = migrateV1TemplateToV2(input)
      expect(result).toBe(input)
    })

    it('should handle partially migrated templates', () => {
      const input = `const prop1 = figma.selectedInstance.getString('Text')
const prop2 = figma.currentLayer.__properties__.boolean('Bool')`
      const expected = `const prop1 = figma.selectedInstance.getString('Text')
const prop2 = figma.selectedInstance.getBoolean('Bool')`
      expect(migrateV1TemplateToV2(input)).toBe(expected)
    })

    it('should handle empty template', () => {
      expect(migrateV1TemplateToV2('')).toBe('')
    })

    it('should handle template with no migrations needed', () => {
      const input = `const figma = require('figma')
const value = 'static'
export default { example: figma.code\`\${value}\` }`
      expect(migrateV1TemplateToV2(input)).toBe(input)
    })
  })

  describe('Composition with other migrations', () => {
    it('should work correctly when chained with migrateTemplateToUseServerSideHelpers', () => {
      const input = `const figma = require('figma')
const label = figma.currentLayer.__properties__.string('Label')

export default figma.tsx\`<Button>\${_fcc_renderReactChildren(label)}</Button>\``

      // First migrate helpers, then V2
      const afterHelpers = migrateTemplateToUseServerSideHelpers(input)
      const afterV2 = migrateV1TemplateToV2(afterHelpers)

      expect(afterV2).toContain('figma.selectedInstance.getString')
      expect(afterV2).toContain('figma.helpers.react.renderChildren')
      expect(afterV2).toContain('export default { example: figma.tsx')
    })

    it('should work correctly in reverse order (V2 then helpers)', () => {
      const input = `const figma = require('figma')
const label = figma.currentLayer.__properties__.string('Label')

export default figma.tsx\`<Button>\${_fcc_renderReactChildren(label)}</Button>\``

      // First migrate V2, then helpers
      const afterV2 = migrateV1TemplateToV2(input)
      const afterHelpers = migrateTemplateToUseServerSideHelpers(afterV2)

      expect(afterHelpers).toContain('figma.selectedInstance.getString')
      expect(afterHelpers).toContain('figma.helpers.react.renderChildren')
      expect(afterHelpers).toContain('export default { example: figma.tsx')
    })
  })
})
