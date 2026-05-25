/** Oxlint 自定义插件 - 检查图片文件是否存在 */

import fs from 'node:fs';
import path from 'node:path';
import { ResolverFactory, type ResolveResult } from 'oxc-resolver';
import type { Rule, ESLint } from 'eslint';
import type { ImportDeclaration } from 'estree';

// 图片文件扩展名正则
const IMAGE_EXTENSIONS: RegExp = /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i;

// 创建 resolver 实例（全局复用）
let resolverInstance: ResolverFactory | null = null;

/**
 * 获取或创建 resolver 实例
 * @param projectRoot - 项目根目录
 * @returns ResolverFactory 实例
 */
function getResolver(projectRoot: string): ResolverFactory {
  if (!resolverInstance) {
    resolverInstance = new ResolverFactory({
      // 指定要解析的文件扩展名
      extensions: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico'],
      // 条件导出名称（Conditional Exports）用于解析 npm 包中 package.json 的 exports 字段时使用的条件优先级
      conditionNames: ['import', 'require', 'node', 'default'],
      // TypeScript 配置，用于解析路径别名
      tsconfig: {
        configFile: path.join(projectRoot, 'tsconfig.json'),
        references: 'auto',
      },
    });
  }

  return resolverInstance;
}

// 定义图片导入检查规则
const checkImageImportRule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description: "Check if imported image files exist",
    },
    messages: {
      imageNotFound: "Image file '{{source}}' does not exist or cannot be resolved",
    },
    schema: [],
  },
  create(context: Rule.RuleContext): Rule.RuleListener {
    // 查找项目根目录
    let projectRoot: string = path.dirname(context.filename);
    while (projectRoot !== path.dirname(projectRoot)) {
      if (fs.existsSync(path.join(projectRoot, 'package.json'))) {
        break;
      }
      projectRoot = path.dirname(projectRoot);
    }

    // 获取 resolver
    const resolver: ResolverFactory = getResolver(projectRoot);
    const currentDir: string = path.dirname(context.filename);

    return {
      ImportDeclaration(node: ImportDeclaration & Rule.NodeParentExtension) {
        const source: string | null = node.source.value as string | null;

        // 只检查图片文件
        if (typeof source !== 'string' || !IMAGE_EXTENSIONS.test(source)) {
          return;
        }

        try {
          // 使用 oxc-resolver 解析图片路径
          const resolved: ResolveResult = resolver.sync(currentDir, source);

          // 检查解析后的文件是否存在
          if (!resolved.path || !fs.existsSync(resolved.path)) {
            context.report({
              node: node.source,
              messageId: "imageNotFound",
              data: {
                source: source,
              },
            });
          }
        } catch {
          // 解析失败，说明文件不存在或路径无效
          context.report({
            node: node.source,
            messageId: "imageNotFound",
            data: {
              source: source,
            },
          });
        }
      },
    };
  },
};

const plugin: ESLint.Plugin = {
  meta: {
    name: "check-image-exists",
  },
  rules: {
    "no-missing-image": checkImageImportRule,
  },
};

export default plugin;
