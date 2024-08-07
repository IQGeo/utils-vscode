import vscode from 'vscode'; // eslint-disable-line
import fs from 'fs';
import path from 'path';
import util from 'util';
import Utils from '../utils';

const LANGUAGE_MAP = {
    js: 'javascript',
    py: 'python',
    yml: 'yaml',
    md: 'markdown',
    txt: 'plaintext',
};

export class IQGeoSearch {
    constructor(iqgeoVSCode, context) {
        this.iqgeoVSCode = iqgeoVSCode;

        this._symbolSelector = undefined;
        this._lastQuery = '';
        this._viewColumn = undefined;
        this._sideBarVisible = false;
        this._fileIconConfig = undefined;
        this._fileIconCache = {};

        vscode.window.onDidChangeActiveTextEditor((editor) => {
            this._viewColumn = editor?.viewColumn;
        });

        context.subscriptions.push(
            vscode.commands.registerCommand('iqgeo.searchSymbols', (args = {}) =>
                this._searchSymbols(args)
            )
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('iqgeo.searchRoot', () => this._searchRootFolder())
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('iqgeo.searchWorkspace', () => this._searchWorkspace())
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('iqgeo.searchCore', () => this._searchCore())
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('iqgeo.searchEditor', () => {
                const rootFolder = this.iqgeoVSCode.rootFolders[0];
                this._runSearch(rootFolder, true);
            })
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('iqgeo.goToPreviousSymbol', () =>
                this._goToNextSymbol(false)
            )
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('iqgeo.goToNextSymbol', () =>
                this._goToNextSymbol(true)
            )
        );
    }

    _searchRootFolder() {
        const rootFolder = this.iqgeoVSCode.rootFolders[0];
        this._runSearch(rootFolder);
    }

    _searchWorkspace() {
        const workspaceFolder = this.iqgeoVSCode.getWorkspaceFolder();
        this._runSearch(workspaceFolder);
    }

    _searchCore() {
        const core = path.join(this.iqgeoVSCode.rootFolders[0], 'core');
        if (fs.existsSync(core)) {
            this._runSearch(core);
        }
    }

    _runSearch(folder = undefined, inEditor = false) {
        let query = '';

        const editor = vscode.window.activeTextEditor;
        if (editor) {
            query = Utils.selectedText();
            if (!query) {
                const doc = editor.document;
                const pos = editor.selection.active;
                query = Utils.currentWord(doc, pos);
            }
        }

        const commandName = inEditor ? 'search.action.openEditor' : 'workbench.action.findInFiles';

        vscode.commands.executeCommand(commandName, {
            query,
            filesToInclude: folder,
            filesToExclude: '*.txt, *.csv, *.svg, *.*_config, node_modules, bundles, dist',
        });
    }

    _searchSymbols({ query, currentWord = false, sideBarVisible = false }) {
        let newQuery = this._lastQuery;

        if (query) {
            newQuery = query;
            this._lastQuery = newQuery;
        } else if (currentWord) {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                const doc = editor.document;
                const pos = editor.selection.active;
                newQuery = Utils.currentWord(doc, pos);
                if (newQuery) {
                    if (
                        this.iqgeoVSCode.getClassData(newQuery, 'javascript') ||
                        this.iqgeoVSCode.getClassData(newQuery, 'python')
                    ) {
                        newQuery = `^${newQuery}$.`;
                    }
                }
                this._lastQuery = newQuery;
            }
        } else {
            const selection = Utils.selectedText();
            if (selection && selection !== '') {
                newQuery = selection;
                this._lastQuery = newQuery;
            }
        }

        this._sideBarVisible = sideBarVisible;

        this._createSymbolSelector();
        this._previewSymbol = undefined;
        this._symbolSelector.value = newQuery;
        this._symbolSelectorActive = true;
        this._symbolSelector.show();
        this._updateSymbolSelector();
    }

    _previewColumn() {
        if (!this._sideBarVisible) {
            return 1;
        }

        let maxView = 2;
        vscode.window.visibleTextEditors.forEach((editor) => {
            const col = editor?.viewColumn ?? 0;
            if (col > maxView) {
                maxView = col;
            }
        });
        return maxView;
    }

    _getPreviewEditor() {
        if (this._previewSymbol) {
            const col = this._previewColumn();
            const fileName = this._previewSymbol._fileName;
            return vscode.window.visibleTextEditors.find(
                (editor) => editor?.viewColumn === col && editor.document.fileName === fileName
            );
        }
    }

    _closeSymbolPreview() {
        const editor = this._getPreviewEditor();
        if (editor) {
            this._previewSymbol = undefined;
            // vscode.commands.executeCommand("workbench.action.closeActiveEditor");
            editor.hide();
        }
    }

    _createSymbolSelector() {
        if (!this._symbolSelector) {
            this._symbolSelector = vscode.window.createQuickPick();
            this._symbolSelector.placeholder =
                'Search Definitions (<method> or <class> or <class>.<method> + supports ^ and $)';

            // ENH: prevent re-sorting of items when available in api.

            this._symbolSelector.onDidChangeValue(
                Utils.debounce(() => {
                    this._lastQuery = this._symbolSelector.value;
                    this._updateSymbolSelector();
                }, 250)
            );

            this._symbolSelector.onDidChangeActive(
                Utils.debounce(() => {
                    if (
                        this._symbolSelectorActive &&
                        vscode.workspace.getConfiguration('iqgeo-utils-vscode').enableSearchPreview
                    ) {
                        const selection = this._symbolSelector.activeItems;
                        if (selection.length > 0) {
                            const col = this._previewColumn();
                            this._goToSymbol(selection[0].symbol, {
                                viewColumn: col,
                                preview: true,
                                preserveFocus: true,
                            });
                            this._previewSymbol = selection[0].symbol;
                        } else {
                            this._closeSymbolPreview();
                        }
                    }
                }, 350)
            );

            this._symbolSelector.onDidAccept(() => {
                this._symbolSelectorActive = false;
                const selection = this._symbolSelector.selectedItems;
                if (selection.length > 0) {
                    if (
                        vscode.workspace.getConfiguration('iqgeo-utils-vscode')
                            .openSearchResultAtPreview
                    ) {
                        this._previewSymbol = undefined;
                        this._goToSymbol(selection[0].symbol, {
                            viewColumn: this._previewColumn(),
                            preview: false,
                        });
                    } else {
                        if (this._previewColumn() !== this._viewColumn) {
                            // Close the preview and open symbol in active editor group.
                            this._closeSymbolPreview();
                        } else {
                            this._previewSymbol = undefined;
                        }
                        this._goToSymbol(selection[0].symbol, {});
                    }
                }
            });

            this._symbolSelector.onDidHide(() => {
                this._symbolSelectorActive = false;
                this._closeSymbolPreview();
            });
        }

        this._symbolSelector.items = [];
    }

    _updateSymbolSelector() {
        const { value } = this._symbolSelector;

        if (value && value.length > 1) {
            const symbols = this.iqgeoVSCode.getSymbols(value.toLowerCase(), {
                searchClasses: true,
                searchAll: true,
            });
            const list = this._getSearchList(symbols);

            this._symbolSelector.items = list;
        } else {
            this._symbolSelector.items = [];
        }
    }

    _getSearchList(symbols) {
        const list = [];
        const symbolsLength = symbols.length;

        for (let index = 0; index < symbolsLength; index++) {
            const sym = symbols[index];

            const iconPath = this._getFileIcon(sym._fileName);
            let label;

            if (sym.kind === vscode.SymbolKind.File) {
                label = iconPath ? sym.name : `$(${sym._icon}) ${sym.name}`;
            } else {
                const name = sym.name.replace(/\./g, '\u2009.\u2009');
                label = `$(${sym._icon}) ${name}`;
            }

            let description = sym._partialPath;
            if (!description) {
                description = this._partialPath(sym._fileName);
                sym._partialPath = description;
            }

            list.push({
                label,
                description,
                iconPath,
                alwaysShow: true,
                symbol: sym,
            });
        }

        return list;
    }

    _goToSymbol(sym, { viewColumn, preview, preserveFocus = false }) {
        const symRange = sym.location.range;
        const workbenchConfig = vscode.workspace.getConfiguration('workbench');

        if (viewColumn === undefined) {
            viewColumn = this._viewColumn;
        }
        if (preview === undefined) {
            preview = workbenchConfig.editor.enablePreviewFromCodeNavigation;
        }

        vscode.window.showTextDocument(sym.location.uri, {
            selection: symRange,
            viewColumn,
            preview,
            preserveFocus,
        });
    }

    _goToNextSymbol(next = true) {
        let editor = this._getPreviewEditor();
        let preview = true;
        if (!editor) {
            editor = vscode.window.activeTextEditor;
            preview = false;
        }

        if (editor) {
            const doc = editor.document;
            if (doc.languageId === 'javascript' || doc.languageId === 'python') {
                const sortedSymbols = this.iqgeoVSCode.getSymbolsForFile(doc.fileName);
                const line = editor.selection.active.line;
                let symLine;
                let targetIndex;

                for (const [index, sym] of sortedSymbols.entries()) {
                    symLine = sym.location.range.start.line;
                    if (symLine >= line) {
                        if (next) {
                            targetIndex = symLine === line ? index + 1 : index;
                        } else {
                            targetIndex = index - 1;
                        }
                        break;
                    }
                }

                if (targetIndex === undefined && !next && line > symLine) {
                    targetIndex = sortedSymbols.length - 1;
                }

                if (
                    targetIndex !== undefined &&
                    targetIndex >= 0 &&
                    targetIndex < sortedSymbols.length
                ) {
                    const goToSym = sortedSymbols[targetIndex];
                    if (preview) {
                        const col = this._previewColumn();
                        this._goToSymbol(goToSym, {
                            viewColumn: col,
                            preview: true,
                            preserveFocus: true,
                        });
                    } else {
                        this._goToSymbol(goToSym, {});
                    }
                }
            }
        }
    }

    _getFileIcon(fileName) {
        if (this._fileIconConfig === undefined) {
            this._fileIconConfig = null;

            const extName = vscode.workspace.getConfiguration('workbench').iconTheme;
            let ext = vscode.extensions.all.find((ext) => ext.id.endsWith(extName));
            if (!ext) {
                ext = vscode.extensions.all.filter(
                    (ext) => ext.isActive && ext.packageJSON.contributes.iconThemes
                )[0];
            }

            if (ext) {
                try {
                    let configPath = ext.packageJSON.contributes.iconThemes[0].path;
                    configPath = path.join(ext.extensionPath, configPath);
                    this._fileIconConfig = JSON.parse(fs.readFileSync(configPath).toString());
                    this._fileIconConfig._configPath = path.dirname(configPath);
                } catch (e) {
                    this.iqgeoVSCode.outputChannel.error(util.format(e));
                    return;
                }
            }
        }

        if (!this._fileIconConfig) return;

        let key = path.basename(fileName);
        let id =
            this._fileIconConfig.fileNames[key] ??
            this._fileIconConfig.fileNames[key.toLowerCase()];
        if (!id) {
            const parts = key.split('.');
            key = parts.length > 2 ? parts.slice(-2).join('.') : parts.slice(-1)[0];
        }

        let iconPath = this._fileIconCache[key];
        if (iconPath !== undefined) return iconPath;

        if (!id) {
            id = this._fileIconConfig.fileExtensions[key];
            if (!id) {
                const langId = LANGUAGE_MAP[key] ?? key;
                id = this._fileIconConfig.languageIds[langId] ?? key;
            }
        }

        let iconDef = this._fileIconConfig.iconDefinitions[id];

        if (!iconDef) {
            // Use default file icon
            iconDef = this._fileIconConfig.iconDefinitions[this._fileIconConfig.file];
        }

        if (iconDef) {
            iconPath = path.join(this._fileIconConfig._configPath, iconDef.iconPath);
            this._fileIconCache[key] = iconPath;
            return iconPath;
        }

        this._fileIconCache[key] = null;
    }

    _partialPath(fileName) {
        for (const root of this.iqgeoVSCode.rootFolders) {
            if (fileName.startsWith(root)) {
                return fileName.substring(root.length);
            }
        }
        return fileName;
    }
}
