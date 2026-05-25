/** Oxlint 自定义插件 - 检查 <video> 元素上的内联 style 属性 */

import type { Rule, ESLint } from 'eslint';
import type { Node } from 'estree';

const checkVideoStyleRule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow inline style prop on <video> elements in weapp',
    },
    messages: {
      noVideoInlineStyle:
        'Do not use inline `style` on <video> — weapp renders the native video as an overlay that ignores ALL inline styles on the video element AND ignores `maxHeight`/`overflow` on its parent container. Moving the style to the parent div does NOT fix this. Correct fix: wrap the video in a container with explicit `height` (not `maxHeight`) and use `className="w-full h-full"` on the video itself — e.g. `<div style={{height: \'56vw\'}}><video className="w-full h-full" controls src={url} /></div>`. Use `height: \'{ratio}vw\'` where ratio = 100 × (video height / video width), e.g. 56vw for 16:9 landscape, 178vw for 9:16 portrait.',
    },
    schema: [],
  },
  create(context: Rule.RuleContext): Rule.RuleListener {
    return {
      JSXOpeningElement(node: Node) {
        const jsxNode = node as any

        // 只处理 <video> 标签
        if (jsxNode.name?.type !== 'JSXIdentifier' || jsxNode.name?.name !== 'video') {
          return
        }

        // 检查是否有 style 属性
        for (const attr of jsxNode.attributes ?? []) {
          if (attr.type === 'JSXAttribute' && attr.name?.type === 'JSXIdentifier' && attr.name?.name === 'style') {
            context.report({
              node: attr as unknown as Node,
              messageId: 'noVideoInlineStyle',
            })
          }
        }
      },
    }
  },
}

const plugin: ESLint.Plugin = {
  meta: {
    name: 'check-video-style',
  },
  rules: {
    'no-video-inline-style': checkVideoStyleRule,
  },
}

export default plugin