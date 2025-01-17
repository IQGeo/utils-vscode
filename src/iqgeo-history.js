import vscode from 'vscode'; // eslint-disable-line
import path from 'path';
import Utils from './utils';

const JS_File = {
    scheme: 'file',
    language: 'javascript',
};
const PY_File = {
    scheme: 'file',
    language: 'python',
};
const maxHistorySize = 200;

export class IQGeoHistoryManager {
    constructor(iqgeoVSCode, context) {
        this.iqgeoVSCode = iqgeoVSCode;

        context.subscriptions.push(
            vscode.languages.registerHoverProvider([JS_File, PY_File], this)
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('iqgeo.goTo', (args = {}) => this.goto(args))
        );

        const config = vscode.workspace.getConfiguration('iqgeo-utils-vscode');
        this.enableCodeLens = config.enableCodeLens;
        this.enableHover = config.enableHover;

        vscode.workspace.onDidChangeConfiguration((changeEvent) => {
            if (changeEvent.affectsConfiguration('iqgeo-utils-vscode')) {
                const config = vscode.workspace.getConfiguration('iqgeo-utils-vscode');

                if (
                    this.enableCodeLens !== config.enableCodeLens ||
                    this.enableHover !== config.enableHover
                ) {
                    this.enableCodeLens = config.enableCodeLens;
                    this.enableHover = config.enableHover;

                    if (config.enableCodeLens || config.enableHover) {
                        this.activate();
                    } else {
                        this.deactivate();
                    }
                }
            }
        });
    }

    activate() {
        if (!this.enableCodeLens && !this.enableHover) return;

        this.deactivate();

        this.navigationHistory = [];
        this.navigationIndex = undefined;
        this.lastViewColumn = undefined;
        this.lastFile = undefined;
        this.lastPos = undefined;

        if (this.enableCodeLens) {
            this.provider = vscode.languages.registerCodeLensProvider([JS_File, PY_File], this);
        }

        this.timer = setInterval(() => this._updateNavigationHistory(), 1250);
    }

    deactivate() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
            if (this.provider) {
                this.provider.dispose();
            }
        }
    }

    _updateNavigationHistory() {
        // const start = new Date();

        const editor = vscode.window.activeTextEditor;
        if (!editor) return;
        const doc = editor.document;
        if (!doc) return;

        if (doc.languageId !== 'javascript' && doc.languageId !== 'python') return;

        const viewColumn = editor.viewColumn;
        const fileName = doc.fileName;
        const pos = editor.selection.active;

        const updateHistory =
            this.lastViewColumn !== viewColumn ||
            this.lastFile !== fileName ||
            this.lastPos.line !== pos.line;

        const updateLenses = updateHistory || this.lastPos.character !== pos.character;

        if (!updateHistory && !updateLenses) return;

        this.lastViewColumn = viewColumn;
        this.lastFile = fileName;
        this.lastPos = { line: pos.line, character: pos.character };

        if (updateHistory) {
            const sym = this._getCurrentSymbol(fileName, pos.line);
            if (!sym) return;

            const name = sym._methodName ?? sym._className ?? fileName;

            const index = this.navigationHistory.findLastIndex(
                (item) => item.fileName === fileName && item.name === name
            );

            // console.log('Update History:', fileName, name, index);

            if (index !== -1) {
                this.navigationIndex = index;
            } else {
                if (this.navigationIndex !== undefined) {
                    this.navigationHistory = this.navigationHistory.slice(
                        0,
                        this.navigationIndex + 1
                    );
                }

                const symRange = sym.location.range;
                const rangeArgs = [
                    symRange.start.line,
                    symRange.start.character,
                    symRange.end.line,
                    symRange.end.character,
                ];
                const historyItem = {
                    fileName,
                    name,
                    range: rangeArgs,
                    viewColumn,
                };

                this.navigationHistory.push(historyItem);

                if (this.navigationHistory.length > maxHistorySize) {
                    this.navigationHistory = this.navigationHistory.slice(-maxHistorySize);
                }
                this.navigationIndex = this.navigationHistory.length - 1;
            }
        }

        if (this.enableCodeLens) {
            // Force update of code lenses
            this.provider.dispose();
            this.provider = vscode.languages.registerCodeLensProvider([JS_File, PY_File], this);
        }

        // const end = new Date();
        // console.log('updateNavigationHistory():', end - start, 'ms');
    }

    goto(historyItem) {
        if (!historyItem) return;

        const uri = vscode.Uri.file(historyItem.fileName);
        const selection = new vscode.Selection(...historyItem.range);

        vscode.window.showTextDocument(uri, {
            selection,
            viewColumn: historyItem.viewColumn,
            // preview,
            // preserveFocus,
        });
    }

    async provideCodeLenses(doc) {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document !== doc) return;

        if (this.navigationIndex === undefined) return;

        let pos = editor.selection.active;
        if (doc.isDirty) {
            // Position the actions before the current function whilst editing to avoid to much movement of the actions.
            const currentItem = this.navigationHistory[this.navigationIndex];
            pos = new vscode.Position(currentItem.range[0], 0);
        }

        const range = new vscode.Range(pos, pos);

        // console.log('provideCodeLenses', doc.fileName, pos.line);

        const navigationLenses = [];

        const { items, titles } = this._getHistoryItems();

        for (const [index, item] of items.entries()) {
            const lens = new vscode.CodeLens(range, {
                title: titles[index],
                command: 'iqgeo.goTo',
                arguments: [item],
            });
            navigationLenses.push(lens);
        }

        const currentWord = Utils.currentWord(doc, pos);
        if (currentWord) {
            let lens = new vscode.CodeLens(range, {
                title: '$(search) Search',
                command: 'iqgeo.searchWorkspace',
            });
            navigationLenses.push(lens);

            lens = new vscode.CodeLens(range, {
                title: '$(list-flat) Symbols',
                command: 'iqgeo.searchSymbols',
                arguments: [{ query: currentWord, currentWord: true }],
            });
            navigationLenses.push(lens);

            lens = new vscode.CodeLens(range, {
                title: '$(go-to-file) Go to',
                command: 'iqgeo.goToDefinition',
            });
            navigationLenses.push(lens);
        }

        return navigationLenses;
    }

    async provideHover(doc, pos) {
        if (!this.enableHover) return;

        try {
            const hoverString = await this._getHoverString(doc, pos);

            if (hoverString.length > 0) {
                const range = new vscode.Range(pos.line, pos.character, pos.line, pos.character);
                const mdString = new vscode.MarkdownString(hoverString, true);
                mdString.isTrusted = true;
                return new vscode.Hover(mdString, range);
            }
        } catch (error) {
            console.error(error);
        }
    }

    async _getHoverString(doc, pos) {
        let hoverString = '';

        const lineSeparator = '  \n';
        const inSelection = this._posInSelection(pos);
        const currentText = inSelection ? Utils.selectedText() : Utils.currentWord(doc, pos);

        if (currentText) {
            let truncatedText =
                currentText.length > 80 ? `${currentText.substring(0, 78)}..` : currentText;
            truncatedText = truncatedText.replace(/\n/g, '⮐');
            hoverString += `\`\`\`'${truncatedText}'\`\`\``;

            const searchString = this._getSearchHoverString(doc, currentText);
            if (searchString) {
                hoverString += `${lineSeparator}$(search)\u2002${searchString}`;
            }

            if (!currentText.includes('\n')) {
                let secondLine = false;
                const inComment = this._posInComment(doc, pos);
                const inCurrentWord = this._cursorInCurrentWord(doc, pos);

                if (inSelection || !inComment) {
                    const searchCommand = vscode.Uri.parse(
                        `command:iqgeo.searchSymbols?${encodeURIComponent(
                            JSON.stringify([{ query: currentText, currentWord: inCurrentWord }])
                        )}`
                    );

                    hoverString += `${lineSeparator}$(list-flat)\u2002[Search Definitions](${searchCommand} "Search definitions for the current text")`;
                    secondLine = true;
                }

                // const classData = this.iqgeoVSCode.getClassData(currentText);
                // if (classData) {
                //     const searchCommand = vscode.Uri.parse(
                //         `command:iqgeo.searchSymbols?${encodeURIComponent(
                //             JSON.stringify([{ query: `^${currentText}$.` }])
                //         )}`
                //     );
                //     if (secondLine) {
                //         hoverString += ` | `;
                //     } else {
                //         hoverString += `${lineSeparator}`;
                //         secondLine = true;
                //     }
                //     hoverString += `$(list-unordered)\u2002[Search Class](${searchCommand} "Search class methods")`;
                // }

                if (inSelection || inCurrentWord) {
                    const gotoCommand = vscode.Uri.parse('command:iqgeo.goToDefinition');
                    if (secondLine) {
                        hoverString += ` | `;
                    } else {
                        hoverString += `${lineSeparator}`;
                    }
                    hoverString += `$(go-to-file)\u2002[Go to](${gotoCommand} "Go to definition")`;
                }
            }
        }

        const historyString = this._getHistoryHoverString();
        if (historyString) {
            hoverString += `${lineSeparator}${historyString}`;
        }

        return hoverString;
    }

    _getSearchHoverString(doc, currentText) {
        const rootPath = vscode.workspace.workspaceFolders[0].uri.fsPath;
        const searchStrings = [];

        let dir = doc.fileName;

        while (dir !== rootPath && !/[/\\]$/.test(dir)) {
            dir = path.dirname(dir);

            let searchPath = path.relative(rootPath, dir);
            if (searchPath && searchPath !== dir) {
                searchPath = `.${path.sep}${searchPath}`;
            } else {
                searchPath = dir;
            }

            let searchLabel = path.basename(dir);
            if (dir === rootPath) {
                searchLabel = 'Workspace';
            }

            const args = [
                {
                    query: currentText,
                    filesToInclude: searchPath,
                    triggerSearch: true,
                },
            ];
            const command = vscode.Uri.parse(
                `command:workbench.action.findInFiles?${encodeURIComponent(JSON.stringify(args))}`
            );

            searchStrings.push(`[${searchLabel}](${command} "Search in ${searchPath}")`);
        }

        if (dir !== rootPath) {
            const args = [
                {
                    query: currentText,
                    filesToInclude: './',
                    triggerSearch: true,
                },
            ];
            const command = vscode.Uri.parse(
                `command:workbench.action.findInFiles?${encodeURIComponent(JSON.stringify(args))}`
            );
            searchStrings.push(`[Workspace](${command} "Search in Workspace")`);
        }

        return searchStrings.reverse().join(' | ');
    }

    _getHistoryHoverString() {
        if (this.navigationIndex === undefined) return;

        const historyStrings = [];

        const { items, titles } = this._getHistoryItems();

        for (const [index, item] of items.entries()) {
            const title = titles[index];
            const gotoCommand = vscode.Uri.parse(
                `command:iqgeo.goTo?${encodeURIComponent(JSON.stringify([item]))}`
            );

            historyStrings.push(`[${title}](${gotoCommand} "Go to ${title}")`);
        }

        return historyStrings.join(' | ');
    }

    _getHistoryItems() {
        const inc = this.navigationIndex < 2 ? 3 : 2;
        const max = Math.min(this.navigationIndex + inc, this.navigationHistory.length - 1);
        const dec = max > this.navigationIndex ? 4 : 3;
        const min = Math.max(max - dec, 0);

        const items = [];
        const splitPaths = [];
        const titles = [];

        for (let index = min; index < max + 1; index++) {
            if (index !== this.navigationIndex) {
                const historyItem = this.navigationHistory[index];
                items.push(historyItem);

                const parts = historyItem.fileName.split(path.sep);
                parts.push('');
                parts.push(historyItem.name);
                parts.reverse();
                splitPaths.push(parts);
            }
        }

        const minParts = Math.min(...splitPaths.map((parts) => parts.length));

        const getUniqueName = (index) => {
            let title = splitPaths[index][0];

            for (let i = 1; i < minParts; i++) {
                const names = splitPaths.map((parts) => parts[0] + parts[i]);
                const testName = names.splice(index, 1)[0];
                if (!names.includes(testName)) {
                    if (i > 1) {
                        title = `(${splitPaths[index][i]}) ${splitPaths[index][0]}`;
                    }
                    break;
                }
            }
            return title;
        };

        let count = 0;
        for (let index = min; index < max + 1; index++) {
            if (index !== this.navigationIndex) {
                const name = getUniqueName(count);
                const title =
                    index < this.navigationIndex
                        ? `${'<'.repeat(this.navigationIndex - index)} ${name}`
                        : `${name} ${'>'.repeat(index - this.navigationIndex)}`;
                titles.push(title);
                count++;
            }
        }

        return { items, titles };
    }

    _getCurrentSymbol(fileName, line) {
        const sortedSymbols = this.iqgeoVSCode.getSymbolsForFile(fileName);
        let symLine;
        let targetIndex;

        for (const [index, sym] of sortedSymbols.entries()) {
            symLine = sym.location.range.start.line;
            if (symLine == line) {
                targetIndex = index;
                break;
            } else if (symLine > line) {
                targetIndex = index - 1;
                break;
            }
        }

        if (targetIndex === undefined && line > symLine) {
            targetIndex = sortedSymbols.length - 1;
        }

        if (targetIndex !== undefined && targetIndex >= 0) {
            return sortedSymbols[targetIndex];
        }
    }

    _posInComment(doc, pos) {
        const lineText = doc.lineAt(pos.line).text;
        const text = this._stringBeforeComment(doc, lineText);

        return pos.character > text.length;
    }

    _posInSelection(pos) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return false;

        const selection = editor.selection;

        if (selection.start.line === selection.end.line) {
            // Single line
            if (selection.start.character === selection.end.character) return false;

            return (
                pos.line === selection.start.line &&
                pos.character >= selection.start.character &&
                pos.character <= selection.end.character
            );
        }

        // Multi line
        if (pos.line === selection.start.line) {
            return pos.character >= selection.start.character;
        }
        if (pos.line === selection.end.line) {
            return pos.character <= selection.end.character;
        }
        return pos.line >= selection.start.line && pos.line <= selection.end.line;
    }

    _cursorInCurrentWord(doc, pos) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return false;

        const cursorPos = editor.selection.active;
        if (pos.line !== cursorPos.line) return false;

        const currentWord = Utils.currentWord(doc, pos);
        const currentLine = doc.lineAt(pos.line).text;
        const wordStart = currentLine.indexOf(currentWord, pos.character - currentWord.length);
        const wordEnd = wordStart + currentWord.length;

        return cursorPos.character >= wordStart && cursorPos.character <= wordEnd;
    }

    _stringBeforeComment(doc, text) {
        const testStr = doc.languageId === 'javascript' ? '//' : '#';
        let index = text.indexOf(testStr);

        while (index > -1) {
            if (Utils.withinString(text, index)) {
                index = text.indexOf(testStr, index + 1);
            } else {
                return text.substring(0, index);
            }
        }

        return text;
    }
}
