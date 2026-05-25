/** Oxlint 自定义插件 - 验证 Taro app.config.ts 配置 */

import fs from 'node:fs';
import path from 'node:path';
import type { Rule, ESLint } from 'eslint';
import type { VariableDeclarator, Property } from 'estree';

// 定义 Taro 应用配置验证规则
const taroAppConfigValidatorRule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description: "Ensure 'pages' array items exist as .tsx files, and 'tabBar.list' contains 2-5 items for WeChat mini-program compatibility",
    },
    messages: {
      tooFewListItems: "WeChat mini-program requires at least 2 tab items. Current tabBar.list has {{count}} item(s). Please add more tabs or remove the tabBar configuration.",
      tooManyListItems: "WeChat mini-program cannot publish with more than 5 tabs. Current tabBar.list has {{count}} items. Please reduce the number of tabs to 5 or fewer.",
      pageFileNotFound: "Page file 'src/{{pagePath}}.tsx' does not exist. Please either create the file or remove '{{pagePath}}' from the pages array in app.config.ts.",
    },
    schema: [],
  },
  create(context: Rule.RuleContext): Rule.RuleListener {
    // 查找项目根目录（包含 package.json 的目录）
    let projectRoot: string = path.dirname(context.filename);
    while (projectRoot !== path.dirname(projectRoot)) {
      if (fs.existsSync(path.join(projectRoot, 'package.json'))) {
        break;
      }
      projectRoot = path.dirname(projectRoot);
    }

    /**
     * 检查页面文件是否存在
     * @param pagePath - 页面路径，如 'pages/home/index'
     * @returns 文件是否存在
     */
    function checkPageFileExists(pagePath: string): boolean {
      const fullPath: string = path.join(projectRoot, 'src', `${pagePath}.tsx`);
      return fs.existsSync(fullPath);
    }

    /**
     * 类型谓词：检查节点是否为 Property 类型
     */
    function isPropertyNode(node: any): node is Property {
      return node.type === "Property";
    }

    /**
     * 检查 pages 数组中的每个路径是否存在对应文件
     */
    function checkPagesArray(elements: any[]): void {
      elements.forEach((element: any) => {
        if (element && element.type === "Literal" && typeof element.value === "string") {
          const pagePath: string = element.value;
          if (!checkPageFileExists(pagePath)) {
            context.report({
              node: element,
              messageId: "pageFileNotFound",
              data: { pagePath },
            });
          }
        }
      });
    }

    return {
      /**
       * 匹配 `const pages = [...]` 形式的变量声明
       */
      VariableDeclarator(node: VariableDeclarator & Rule.NodeParentExtension) {
        if (
          node.id.type === "Identifier" &&
          node.id.name === "pages" &&
          node.init &&
          node.init.type === "ArrayExpression"
        ) {
          checkPagesArray(node.init.elements as any[]);
        }
      },

      /**
       * 匹配 `defineAppConfig({ pages: [...] })` 或任意对象字面量中 `pages: [...]` 属性
       */
      "Property[key.name='pages'][value.type='ArrayExpression']"(node: any) {
        checkPagesArray(node.value.elements);
      },

      /**
       * 访问所有对象属性节点，检查 tabBar.list 数组
       * tabBar: {           <- grandParent (Property)
       *   list: [           <- node (Property)
       *     {...},          <- 数组元素
       *     {...}
       *   ]
       * }
       */
      Property(node: Property & Rule.NodeParentExtension) {
        // 检查是否为 'list' 属性
        if (
          node.key.type === "Identifier" &&
          node.key.name === "list" &&
          node.value.type === "ArrayExpression"
        ) {
          // 通过检查父节点结构，确认这是 tabBar 内的 list
          const parent: any = node.parent;
          if (parent.type === "ObjectExpression") {
            // 检查祖父节点是否为 'tabBar' 属性
            const grandParent: any = parent.parent;
            if (
              isPropertyNode(grandParent) &&
              grandParent.key.type === "Identifier" &&
              grandParent.key.name === "tabBar"
            ) {
              // 获取数组元素数量
              const arrayLength: number = node.value.elements.length;

              // 如果少于 2 个元素，向 context 报告错误
              if (arrayLength < 2) {
                context.report({
                  node: node.value,
                  messageId: "tooFewListItems",
                  data: {
                    count: arrayLength + '',
                  },
                });
              }

              // 如果超过 5 个元素，向 context 报告错误
              if (arrayLength > 5) {
                context.report({
                  node: node.value,
                  messageId: "tooManyListItems",
                  data: {
                    count: arrayLength + '',
                  },
                });
              }
            }
          }
        }
      },
    };
  },
};

const plugin: ESLint.Plugin = {
  meta: {
    name: "taro-app-config-validator",
  },
  rules: {
    "taro-app-config-validator": taroAppConfigValidatorRule,
  },
};

export default plugin;
