import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { abort, getNextRouter, highlightCodeDifferences } from './utils';
import type { BuildTool } from '../types';

export async function modifyConfigFile(detectedBuildTool: BuildTool) {
  try {
    let configFileContent = await getExistingConfigContent(detectedBuildTool);
    const oldCode = configFileContent;
    const filePath = path.join(process.cwd(), detectedBuildTool.configFilePath);
    /**
     * If the config file already has million js configured, abort
     */
    configFileContent.includes('million') ||
    configFileContent.includes('million/compiler')
      ? abort(
          `${chalk.red(
            `Million js already configured in ${detectedBuildTool.configFilePath}.`,
          )}.\n Please refer docs: https://million.dev/docs/install#use-the-compiler if facing any errors.`,
        )
      : '';

    const detectedModuleType: 'esm' | 'cjs' | 'unknown' =
      detectModuleType(configFileContent);
    /**
     * 1. Add import or require command for million to the top of the file
     * 2. Update 'export default' or 'module.exports'
     * 3. Update file with new code
     */
    if (detectedModuleType === 'cjs') {
      // 1.
      const importStatement = `const million = require('million/compiler');\n`;
      configFileContent = importStatement + configFileContent;

      // 2.
      const regex = /module\.exports\s*=\s*(?<exportContent>[^;]+)/;
      const match = regex.exec(configFileContent);

      if (match) {
        const oldExportExpression = match[1];
        const newExportExpression = await wrapExportCode(
          detectedBuildTool,
          oldExportExpression!,
        );

        // 3.
        const newCode = configFileContent.replace(
          regex,
          `module.exports = ${newExportExpression}`,
        );

        await fs.promises.writeFile(filePath, newCode, {
          encoding: 'utf-8',
          flag: 'w',
        });

        highlightCodeDifferences(oldCode, newCode, detectedBuildTool);
      }
    } else if (detectedModuleType === 'esm') {
      // 1.
      const importStatement = `import million from 'million/compiler';\n`;
      configFileContent = importStatement + configFileContent;

      // 2.
      const regex = /export\s+default\s+(?<exportContent>[^;]+)/;
      const match = regex.exec(configFileContent);

      if (match) {
        const oldExportExpression = match[1];
        const newExportExpression = await wrapExportCode(
          detectedBuildTool,
          oldExportExpression!,
        );

        // 3.
        const newCode = configFileContent.replace(
          regex,
          `export default ${newExportExpression}`,
        );

        await fs.promises.writeFile(filePath, newCode, {
          encoding: 'utf-8',
          flag: 'w',
        });

        highlightCodeDifferences(oldCode, newCode, detectedBuildTool);
      }
    } else {
      /**
       *  If we can't detect the module type, we can't modify the config file
       *  Refer user to read installation docs
       * */

      abort(
        `${chalk.yellow(
          `Could not detect module type for ${detectedBuildTool.configFilePath}.`,
        )}\nPlease refer docs:${chalk.cyan(
          'https://million.dev/docs/install#use-the-compiler',
        )} to setup manually.`,
      );
    }
  } catch (e) {
    return abort();
  }
}

export async function getExistingConfigContent(
  detectedBuildTool: BuildTool,
): Promise<string> {
  const configFilePath = path.join(
    process.cwd(),
    detectedBuildTool.configFilePath,
  );

  // Read the config file
  const configContent = await fs.promises.readFile(configFilePath, {
    encoding: 'utf-8',
  });
  return configContent;
}

function detectModuleType(fileContent: string): 'cjs' | 'esm' | 'unknown' {
  // Check for CommonJS require/module.exports patterns
  if (fileContent.includes('module.exports =')) {
    return 'cjs';
  }

  // Check for ESM import/export statements
  if (fileContent.includes('export default')) {
    return 'esm';
  }

  return 'unknown';
}

async function wrapExportCode(
  buildtool: BuildTool,
  oldExportExpression: string,
): Promise<string> {
  let [firstPart, ...rest]: string[] = [];

  switch (buildtool.name) {
    case 'next':
      /**
       * million.next(nextConfig, millionConfig);
       * */
      return handleNextCase(oldExportExpression);
    case 'vite':
      /**
       * defineConfig({
       *   plugins: [million.vite({ auto: true }), react(), ],
       * });
       */
      [firstPart, ...rest] = oldExportExpression.split('plugins: [');
      return `${firstPart!}plugins: [million.vite({ auto: true }), ${rest.join(
        'plugins: [',
      )}`;

    case 'astro':
      /**
       * defineConfig({
       *   vite: {
       *     plugins: [million.vite({ mode: 'react', server: true, auto: true }), ]
       *   }
       * });
       */
      [firstPart, ...rest] = oldExportExpression.split('plugins: [');
      return `${firstPart!}plugins: [million.vite({ mode: 'react', server: true, auto: true }), ${rest.join(
        'plugins: [',
      )}`;

    case 'gatsby':
      /**
       * ({ actions }) => {
       *   actions.setWebpackConfig({
       *     plugins: [million.webpack({ mode: 'react', server: true, auto: true }), ],
       *   })
       * }
       */
      [firstPart, ...rest] = oldExportExpression.split('plugins: [');
      return `${firstPart!}[plugins: million.webpack({ mode: 'react', server: true, auto: true }), ${rest.join(
        'plugins: [',
      )}`;
    case 'craco':
      /**
       * {
       *   webpack: {
       *     plugins: { add: [million.webpack({ auto: true }), ] }
       *   },
       * }
       */
      [firstPart, ...rest] = oldExportExpression.split('plugins: [');
      return `${firstPart!}plugins: [million.webpack({ auto: true }), ${rest.join(
        'plugins: [',
      )}`;

    case 'webpack':
      /**
       * {
       *   plugins: [million.webpack({ auto: true }), ],
       * }
       */
      [firstPart, ...rest] = oldExportExpression.split('plugins: [');
      return `${firstPart!}plugins: [million.webpack({ auto: true }), ${rest.join(
        'plugins: [',
      )}`;

    case 'rollup':
      /**
       * {
       *   plugins: [million.rollup({ auto: true }), ],
       * }
       */
      [firstPart, ...rest] = oldExportExpression.split('plugins: [');
      return `${firstPart!}plugins: [million.rollup({ auto: true }), ${rest.join(
        'plugins: [',
      )}`;
    default:
      return '';
  }
}

async function handleNextCase(oldExportExpression: string): Promise<string> {
  const nextRouter: 'app' | 'pages' = await getNextRouter();
  return `million.next(
  ${oldExportExpression}, { auto: ${
    nextRouter === 'app' ? '{ rsc: true }' : 'true'
  } }
)`;
}
