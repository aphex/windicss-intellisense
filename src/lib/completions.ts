import { ExtensionContext, workspace, languages, Range, Position, CompletionItem, CompletionItemKind, Color, ColorInformation, Hover, SnippetString } from 'vscode';
import { highlightCSS, isColor, getConfig, rem2px, hex2RGB } from '../utils';
import { fileTypes, patterns } from '../utils/filetypes';
import { ClassParser } from 'windicss/utils/parser';
import { HTMLParser } from '../utils/parser';
import type { Core } from '../interfaces';
import type { Disposable } from 'vscode';
import { Style } from 'windicss/utils/style';

const DISPOSABLES: Disposable[] = [];
let initialized = false;

export function registerCompletions(ctx: ExtensionContext, core: Core): Disposable[] {

  function createDisposables() {
    const disposables: Disposable[] = [];

    if (!getConfig('windicss.enableCodeCompletion')) return;

    const attrs: {[key:string]: string[]} = {};
    for (const utility of core.utilities) {
      const key = utility.match(/[^-]+/)?.[0];
      const body = utility.match(/-.+/)?.[0].slice(1) || '~';
      if (key) {
        attrs[key] = key in attrs ? [...attrs[key], body] : [ body ];
      }
    }

    const colors: {[key:string]: {value: string, doc: string}[]} = {};
    for (const { label, documentation } of core.colorCompletions) {
      const key = label.match(/[^-]+/)?.[0];
      const body = label.match(/-.+/)?.[0].slice(1) || '~';
      if (key) {
        const item = { value: body, doc: documentation };
        colors[key] = key in colors ? [...colors[key], item] : [ item ];
      }
    }

    const dynamics: {[key:string]: {value: string, position: number}[]} = {};
    for (const { label, position } of core.dynamicCompletions) {
      const key = label.match(/[^-]+/)?.[0];
      const body = label.match(/-.+/)?.[0].slice(1) || '~';
      if (key) {
        const item = { value: body, position };
        dynamics[key] = key in dynamics ? [...dynamics[key], item] : [ item ];
      }
    }

    const separator = core.processor?.config('separator', ':') as string;

    function isAttr(word: string) {
      const lastKey = word.match(/[^:-]+$/)?.[0] || word;
      return lastKey in attrs || lastKey in core.variants;
    }

    function isAttrVariant(word: string) {
      const lastKey = word.match(/[^:-]+$/)?.[0] || word;
      return lastKey in core.variants;
    }

    function isAttrUtility(word?: string) {
      if (!word) return;
      const lastKey = word.match(/[^:-]+$/)?.[0] || word;
      return lastKey in attrs ? lastKey : undefined;
    }

    function buildEmptyStyle(style: Style) {
      return highlightCSS(style.build().replace('{\n  & {}\n}', '{\n  ...\n}').replace('{}', '{\n  ...\n}').replace('...\n}\n}', '  ...\n  }\n}'));
    }

    function buildAttrDoc(attr: string, variant?: string, separator?: string) {
      let style;
      if (variant) {
        style = core.variants[variant]();
        style.selector = `[${core.processor?.e(attr)}~="${variant}${separator}&"]`;
      } else {
        style = new Style(`[${core.processor?.e(attr)}~="&"]`);
      }
      return buildEmptyStyle(style);
    }

    function buildVariantDoc(variant?: string, attributify = false) {
      if (!variant) return '';
      const style = core.variants[variant]();
      if (attributify) {
        style.selector = `[${core.processor?.e(variant)}~="&"]`;
      } else {
        style.selector = '&';
      }

      return buildEmptyStyle(style);
    }

    for (const { extension, type } of fileTypes) {
      disposables.push(languages.registerCompletionItemProvider(
        extension,
        {
          provideCompletionItems(document, position) {

            const text = document.getText(new Range(new Position(0, 0), position));
            if (text.match(patterns[type]) === null) {
              const key = text.match(/\S+(?=\s*=\s*["']?[^"']*$)/)?.[0];
              if ((!key) || !(['js', 'html'].includes(type) && isAttrVariant(key))) return [];
            }

            const staticCompletion = getConfig('windicss.enableUtilityCompletion') ? core.staticCompletions.map((classItem, index) => {
              const item = new CompletionItem(classItem, CompletionItemKind.Constant);
              item.sortText = '1-' + index.toString().padStart(8, '0');
              return item;
            }): [];

            const variantsCompletion = getConfig('windicss.enableVariantCompletion') ? Object.keys(core.variants).map((variant, index) => {
              const item = new CompletionItem(variant + separator, CompletionItemKind.Module);
              item.detail = variant;
              item.sortText = '2-' + index.toString().padStart(8, '0');
              // trigger suggestion after select variant
              item.command = {
                command: 'editor.action.triggerSuggest',
                title: variant,
              };
              return item;
            }): [];

            const dynamicCompletion = getConfig('windicss.enableDynamicCompletion') ? core.dynamicCompletions.map(({ label, position }, index) => {
              const item = new CompletionItem(label, CompletionItemKind.Variable);
              item.sortText = '3-' + index.toString().padStart(8, '0');
              item.command = {
                command: 'cursorMove',
                arguments: [{
                  to: 'left',
                  select: true,
                  value: position,
                }],
                title: label,
              };
              return item;
            }): [];

            const colorsCompletion = core.colorCompletions.map(({ label, documentation }, index) => {
              const color = new CompletionItem(label, CompletionItemKind.Color);
              color.sortText = '0-' + index.toString().padStart(8, '0');
              color.documentation = documentation;
              return color;
            });

            return [...variantsCompletion, ...colorsCompletion, ...staticCompletion, ...dynamicCompletion];
          },

          resolveCompletionItem(item) {
            switch (item.kind) {
            case CompletionItemKind.Constant:
              item.documentation = highlightCSS(getConfig('windicss.enableRemToPxPreview') ? rem2px(core.processor?.interpret(item.label).styleSheet.build()) : core.processor?.interpret(item.label).styleSheet.build());
              break;
            case CompletionItemKind.Module:
              item.documentation = buildVariantDoc(item.detail);
              item.detail = undefined;
              break;
            case CompletionItemKind.Variable:
              // TODO
              break;
            case CompletionItemKind.Color:
              item.detail = core.processor?.interpret(item.label).styleSheet.build();
              break;
            }
            return item;
          },
        },
        '.',
        ':',
        '(',
        ' ',
      ));

      disposables.push(languages.registerCompletionItemProvider(
        extension,
        {
          provideCompletionItems(document, position) {
            const text = document.getText(new Range(new Position(0, 0), position));
            if (text.match(/(<\w+\s*)[^>]*$/) !== null) {
              const key = text.match(/\S+(?=\s*=\s*["']?[^"']*$)/)?.[0];
              if (!key) {
                return Object.keys(attrs).map((name, index) => {
                  const item = new CompletionItem(name, CompletionItemKind.Field);
                  item.sortText = '0-' + name;
                  item.insertText = new SnippetString(`${name}="$1"`);
                  item.command = {
                    command: 'editor.action.triggerSuggest',
                    title: name,
                  };
                  return item;
                }).concat(Object.keys(core.variants).map((name, index) => {
                  const item = new CompletionItem(name, CompletionItemKind.Value);
                  item.sortText = '1-' + name;
                  item.insertText = new SnippetString(`${name}="$1"`);
                  item.command = {
                    command: 'editor.action.triggerSuggest',
                    title: name,
                  };
                  return item;
                }));
              }
            }
            return [];
          },
          resolveCompletionItem(item) {
            switch (item.kind) {
            case CompletionItemKind.Field:
              item.documentation = buildAttrDoc(item.label);
              break;
            case CompletionItemKind.Value:
              item.documentation = buildVariantDoc(item.label, true);
              break;
            }
            return item;
          },
        },
        ':',
        ' '
      ));

      disposables.push(languages.registerCompletionItemProvider(
        extension,
        {
          provideCompletionItems(document, position) {
            const text = document.getText(new Range(new Position(0, 0), position));
            if (text.match(/(<\w+\s*)[^>]*$/) !== null) {
              const key = isAttrUtility(text.match(/\S+(?=\s*=\s*["']?[^"']*$)/)?.[0]);
              if (key) {
                const variantsCompletion = getConfig('windicss.enableVariantCompletion') ? Object.keys(core.variants).map((variant, index) => {
                  const item = new CompletionItem(variant + separator, CompletionItemKind.Module);
                  item.detail = key + ',' + variant;
                  item.sortText = '2-' + index.toString().padStart(8, '0');
                  item.command = {
                    command: 'editor.action.triggerSuggest',
                    title: variant,
                  };
                  return item;
                }): [];

                const valuesCompletion = attrs[key].map((value, index) => {
                  const item = new CompletionItem(value, CompletionItemKind.Constant);
                  item.detail = key;
                  item.sortText = '1-' + index.toString().padStart(8, '0');
                  return item;
                });

                const dynamicCompletion = getConfig('windicss.enableDynamicCompletion') && key in dynamics? dynamics[key].map(({ value, position }, index) => {
                  const item = new CompletionItem(value, CompletionItemKind.Variable);
                  item.sortText = '3-' + index.toString().padStart(8, '0');
                  item.command = {
                    command: 'cursorMove',
                    arguments: [{
                      to: 'left',
                      select: true,
                      value: position,
                    }],
                    title: value,
                  };
                  return item;
                }): [];

                const colorsCompletion = key in colors ? colors[key].map(({ value, doc }, index) => {
                  const color = new CompletionItem(value, CompletionItemKind.Color);
                  color.sortText = '0-' + index.toString().padStart(8, '0');
                  color.detail = key;
                  color.documentation = doc;
                  return color;
                }) : [];

                return [ ...colorsCompletion, ...valuesCompletion, ...dynamicCompletion, ...variantsCompletion];
              }
            }
            return [];
          },

          resolveCompletionItem(item) {
            switch (item.kind) {
            case CompletionItemKind.Constant:
              const css = core.processor?.attributify({ [item.detail ?? ''] : [ item.label ] }).styleSheet.build();
              item.documentation = highlightCSS(getConfig('windicss.enableRemToPxPreview') ? rem2px(css) : css);
              item.detail = undefined;
              break;
            case CompletionItemKind.Module:
              const [attr, variant] = item.detail?.split(',') || [];
              item.documentation = buildAttrDoc(attr, variant, separator);
              item.detail = undefined;
              break;
            case CompletionItemKind.Variable:
              // TODO
              break;
            case CompletionItemKind.Color:
              item.detail = core.processor?.attributify({ [item.detail ?? ''] : [ item.label ] }).styleSheet.build();
              break;
            }
            return item;
          },
        },
        '"',
        '=',
        '\'',
        ':',
        ' ',
      ));

      // moved hover & color swatches out of patterns loop, to only calculcate them one time per file
      if (getConfig('windicss.enableHoverPreview')) {
        disposables.push(languages.registerHoverProvider(extension, {
          // hover class show css preview
          provideHover: (document, position, token) => {
            const range = document.getWordRangeAtPosition(position, /[^\s();{}'"=`]+/);
            const word = document.getText(range);
            if (!range || !word)
              return;
            if (['class', 'className'].includes(word)) {
              // hover variant attr
              const text = document.getText(new Range(range.end, document.lineAt(document.lineCount-1).range.end));
              const match = text.match(/((?<=^=\s*["'])[^"']*(?=["']))|((?<=^=\s*)[^"'>\s]+)/);
              if (match) {
                const style = core.processor?.interpret(match[0]).styleSheet.build();
                if (style)
                  return new Hover(
                    highlightCSS(getConfig('windicss.enableRemToPxPreview')
                      ? rem2px(style)
                      : style) ?? '',
                    range,
                  );
              }
            }

            if (isAttr(word)) {
              // hover attr
              const text = document.getText(new Range(range.end, document.lineAt(document.lineCount-1).range.end));
              const match = text.match(/((?<=^=\s*["'])[^"']*(?=["']))|((?<=^=\s*)[^"'>\s]+)/);
              if (match) {
                const style = core.processor?.attributify({ [word] : match[0].trim().split(/\s/).filter(i => i) }).styleSheet.build();
                if (style)
                  return new Hover(
                    highlightCSS(getConfig('windicss.enableRemToPxPreview')
                      ? rem2px(style)
                      : style) ?? '',
                    range,
                  );
              }
            }
            const text = document.getText(new Range(new Position(0, 0), position));
            const key = text.match(/\S+(?=\s*=\s*["']?[^"']*$)/)?.[0] ?? '';
            const style = isAttr(key)? core.processor?.attributify({ [key]: [ word ] }) :  core.processor?.interpret(word);
            if (style && style.ignored.length === 0) {
              return new Hover(
                highlightCSS(getConfig('windicss.enableRemToPxPreview')
                  ? rem2px(style.styleSheet.build())
                  : style.styleSheet.build()) ?? '',
                range,
              );
            }
          },
        })
        );
      }

      if (getConfig('windicss.enableColorDecorators')) {
        disposables.push(languages.registerColorProvider(extension, {
          // insert color before class
          provideDocumentColors: (document, token) => {
            const colors: ColorInformation[] = [];
            // try one time update instead of line
            const documentText = document.getText();
            const parser = new HTMLParser(documentText);

            for (const attr of parser.parseAttrs()) {
              if (attr.key in attrs) {
                const regex = /\S+/igm;
                const data = attr.value.raw;
                let match;
                while ((match = regex.exec(data as string))) {
                  if (match && match[0] in core.colors) {
                    const color = hex2RGB(core.colors[match[0]] as string);
                    if (color) colors.push(new ColorInformation(new Range(document.positionAt(attr.value.start + match.index), document.positionAt(attr.value.start + match.index + 1)), new Color(color[0]/255, color[1]/255, color[2]/255, 1)));
                  }
                }
              } else if (['class', 'className'].includes(attr.key) || attr.key in core.variants) {
                const elements = new ClassParser(attr.value.raw, core.processor?.config('separator', ':') as string, Object.keys(core.variants)).parse(false);
                const isValidateColor = (utility: string) => core.processor?.validate(utility).ignored.length === 0 && isColor(utility, core.colors);
                for (const element of elements) {
                  if (element.type === 'group' && Array.isArray(element.content)) {
                    for (const e of element.content) {
                      const color = isValidateColor(e.raw);
                      if(color) colors.push(new ColorInformation(new Range(document.positionAt(attr.value.start + e.start), document.positionAt(attr.value.start + e.start + 1)), new Color(color[0]/255, color[1]/255, color[2]/255, 1)));
                    }
                  }
                  const color = element.type === 'utility' && isValidateColor(element.raw);
                  if(color) colors.push(new ColorInformation(new Range(document.positionAt(attr.value.start + element.start), document.positionAt(attr.value.start + element.start + 1)), new Color(color[0]/255, color[1]/255, color[2]/255, 1)));
                }
              }
            }

            return colors;
          },
          provideColorPresentations: (color, ctx, token) => {
            return [];
          },
        })
        );
      }
    }

    ctx.subscriptions.push(...disposables);
    return disposables;
  }

  function init() {
    DISPOSABLES.forEach(i => i.dispose());
    DISPOSABLES.length = 0;
    DISPOSABLES.push(...createDisposables() || []);
  }

  if (!initialized) {
    workspace.onDidChangeConfiguration(init, null, ctx.subscriptions);
    initialized = true;
  }

  init();

  return DISPOSABLES;
}
