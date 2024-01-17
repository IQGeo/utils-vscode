const vscode = require('vscode'); // eslint-disable-line
const Utils = require('./utils');

class IQGeoSearch {
    constructor(iqgeoVSCode, context) {
        this.iqgeoVSCode = iqgeoVSCode;

        this._symbolSelector = undefined;
        this._lastQuery = '';
        this._lastGoToRange = undefined;
        this._viewColumn = undefined;
        this._sideBarVisible = false;

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
            vscode.commands.registerCommand('iqgeo.searchEditor', () => this._runEditorSearch())
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

    _runSearch(folder) {
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

        vscode.commands.executeCommand('workbench.action.findInFiles', {
            query,
            filesToInclude: folder,
            filesToExclude: '*.txt, *.csv, *.svg, *.*_config, node_modules, bundles',
        });
    }

    _runEditorSearch() {
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

        vscode.commands.executeCommand('search.action.openEditor', {
            query,
            // filesToExclude: '*.txt, *.csv, *.svg, *.*_config, node_modules, bundles',
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
                        this.iqgeoVSCode.getClassData(newQuery, false) ||
                        this.iqgeoVSCode.getClassData(newQuery, true)
                    ) {
                        newQuery = `^${newQuery}$.`;
                    }
                }
                this._lastQuery = newQuery;
            }
        } else if (!Utils.rangesEqual(Utils.selectedRange(), this._lastGoToRange)) {
            const selection = Utils.selectedText();
            if (selection && selection !== '') {
                newQuery = selection;
                this._lastQuery = newQuery;
            }
            this._lastGoToRange = undefined;
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
                    if (this._previewColumn() !== this._viewColumn) {
                        // Close the preview and open in column with prvious focus
                        this._closeSymbolPreview();
                    } else {
                        this._previewSymbol = undefined;
                    }
                    this._goToSymbol(selection[0].symbol, {});
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
            const name = sym.name.replace(/\./g, '\u2009.\u2009');
            const label = `$(${sym._icon}) ${name}`;
            let description = sym._partialPath;

            if (!description) {
                description = this._partialPath(sym._fileName);
                sym._partialPath = description;
            }

            list.push({
                label,
                description,
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

        this._lastGoToRange = symRange;

        vscode.window.showTextDocument(sym.location.uri, {
            selection: symRange,
            viewColumn,
            preview,
            preserveFocus,
        });
    }

    _getSymbolsForFile(fileName) {
        const symbols = [];

        for (const [className, classData] of this.iqgeoVSCode.allClasses()) {
            if (classData.fileName === fileName) {
                const classSym = this.iqgeoVSCode.getClassSymbol(className, classData);
                symbols.push(classSym);

                for (const [methodName, methodData] of Object.entries(classData.methods)) {
                    const name = `${className}.${methodName}`;
                    const sym = this.iqgeoVSCode.getMethodSymbol(name, methodData);
                    symbols.push(sym);
                }
            }
        }

        symbols.sort((a, b) => {
            return a.location.range.start.line - b.location.range.start.line;
        });

        return symbols;
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
                const sortedSymbols = this._getSymbolsForFile(doc.fileName);
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

    _partialPath(fileName) {
        for (const root of this.iqgeoVSCode.rootFolders) {
            if (fileName.startsWith(root)) {
                return fileName.substring(root.length);
            }
        }
        return fileName;
    }
}

module.exports = IQGeoSearch;
